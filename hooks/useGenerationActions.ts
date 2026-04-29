import { useCallback, MutableRefObject } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { WorkflowStep, SongConcept, GeneratedStyle, SongHistoryItem } from '../types';
import { generateLyrics, generateStylePrompt, generateCoverArt, generateRandomTopic, analyzeTopic } from '../services/geminiService';
import { recordQuotaError } from '../services/tokenUsageTracker';
import { saveSongToDB } from '../services/storageService';
import { buildCoverGenSnapshot, buildStyleGenSnapshot, computeNeedsCoverRegen, computeNeedsStyleRegen, type CoverGenSnapshot, type StyleGenSnapshot } from '../pipelineSnapshot';
import type { Lang } from '../translations';

interface UseGenerationActionsParams {
  manualApiKey: string;
  concept: SongConcept;
  lyrics: string;
  lyricsVariants: [string, string] | null;
  styleData: GeneratedStyle | null;
  styleVariants: [GeneratedStyle, GeneratedStyle] | null;
  coverUrl: string;
  styleGenSnap: StyleGenSnapshot | null;
  workflowChainComplete: boolean;
  lang: Lang;
  tr: any;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  handleError: (error: unknown) => void;
  refreshSongTitles: (override?: { concept?: SongConcept; primary?: string; secondary?: string | null }) => Promise<void>;
  mergeLyricsTitlesIntoStyle: (style: GeneratedStyle) => GeneratedStyle;
  styleGenSnapRef: MutableRefObject<StyleGenSnapshot | null>;
  coverGenSnapRef: MutableRefObject<CoverGenSnapshot | null>;
  coverRequestInFlightRef: MutableRefObject<boolean>;
  setConcept: Dispatch<SetStateAction<SongConcept>>;
  setLyrics: Dispatch<SetStateAction<string>>;
  setLyricsVariants: Dispatch<SetStateAction<[string, string] | null>>;
  setStyleData: Dispatch<SetStateAction<GeneratedStyle | null>>;
  setStyleVariants: Dispatch<SetStateAction<[GeneratedStyle, GeneratedStyle] | null>>;
  setStyleGenSnap: Dispatch<SetStateAction<StyleGenSnapshot | null>>;
  setCoverGenSnap: Dispatch<SetStateAction<CoverGenSnapshot | null>>;
  setCoverUrl: Dispatch<SetStateAction<string>>;
  setCoverError: Dispatch<SetStateAction<string | null>>;
  setCurrentHistoryItemId: Dispatch<SetStateAction<string | null>>;
  setHistory: Dispatch<SetStateAction<SongHistoryItem[]>>;
  setSongTitleSuggestions: Dispatch<SetStateAction<string[]>>;
  setSelectedSongTitle: Dispatch<SetStateAction<string | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setLoadingText: Dispatch<SetStateAction<string>>;
  setLoadingProgress: Dispatch<SetStateAction<number>>;
  setLyricsStepUnlocked: Dispatch<SetStateAction<boolean>>;
  setStyleStepUnlocked: Dispatch<SetStateAction<boolean>>;
  setCoverStepUnlocked: Dispatch<SetStateAction<boolean>>;
  setActiveStep: Dispatch<SetStateAction<WorkflowStep>>;
}

const COVER_COOLDOWN_KEY = 'cover_cooldown_until';
const COVER_COOLDOWN_MS = 90_000;

const cleanAiText = (text: string) => {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
};

const hasConceptDetails = (c: SongConcept): boolean => {
  const has = (arr?: string[]) => Array.isArray(arr) && arr.length > 0;
  return (
    has(c.genre) ||
    has(c.mood) ||
    has(c.tempo) ||
    has(c.instrumentation) ||
    has(c.timbre) ||
    has(c.excludedStyles) ||
    (!c.isInstrumental && (has(c.language) || has(c.vocals)))
  );
};

export function useGenerationActions(params: UseGenerationActionsParams) {
  const {
    manualApiKey,
    concept,
    lyrics,
    lyricsVariants,
    styleData,
    styleVariants,
    coverUrl,
    styleGenSnap,
    workflowChainComplete,
    lang,
    tr,
    showToast,
    handleError,
    refreshSongTitles,
    mergeLyricsTitlesIntoStyle,
    styleGenSnapRef,
    coverGenSnapRef,
    coverRequestInFlightRef,
    setConcept,
    setLyrics,
    setLyricsVariants,
    setStyleData,
    setStyleVariants,
    setStyleGenSnap,
    setCoverGenSnap,
    setCoverUrl,
    setCoverError,
    setCurrentHistoryItemId,
    setHistory,
    setSongTitleSuggestions,
    setSelectedSongTitle,
    setIsLoading,
    setLoadingText,
    setLoadingProgress,
    setLyricsStepUnlocked,
    setStyleStepUnlocked,
    setCoverStepUnlocked,
    setActiveStep,
  } = params;

  const getCoverCooldownRemainingMs = () => {
    const raw = localStorage.getItem(COVER_COOLDOWN_KEY);
    const until = raw ? Number(raw) : 0;
    if (!Number.isFinite(until) || until <= 0) return 0;
    return Math.max(0, until - Date.now());
  };

  const setCoverCooldown = (ms: number) => {
    localStorage.setItem(COVER_COOLDOWN_KEY, String(Date.now() + ms));
  };

  const isCoverQuotaError = (msg: string) => /429|quota|resource_exhausted|rate-limit/i.test(msg);

  const runStylePromptGeneration = useCallback(async () => {
    const hasTwo = lyricsVariants && lyricsVariants.length >= 2;
    const hasOne = lyrics?.trim();
    if (!hasTwo && !hasOne) return;
    if (hasTwo) {
      const conceptForB: SongConcept = {
        ...concept,
        language: (concept.languageVariant2 && concept.languageVariant2.length > 0) ? concept.languageVariant2 : concept.language,
        vocals: (concept.vocalsVariant2 && concept.vocalsVariant2.length > 0) ? concept.vocalsVariant2 : concept.vocals,
      };
      const [styleA, styleB] = await Promise.all([
        generateStylePrompt(concept, lang, [lyricsVariants![0]]),
        generateStylePrompt(conceptForB, lang, [lyricsVariants![1]])
      ]);
      setStyleVariants([mergeLyricsTitlesIntoStyle(styleA), mergeLyricsTitlesIntoStyle(styleB)]);
      setStyleData(mergeLyricsTitlesIntoStyle(styleA));
    } else {
      const styleA = await generateStylePrompt(concept, lang, [lyrics!]);
      setStyleData(mergeLyricsTitlesIntoStyle(styleA));
      setStyleVariants(null);
    }
    const snap = buildStyleGenSnapshot(concept, lyrics, lyricsVariants);
    setStyleGenSnap(snap);
    styleGenSnapRef.current = snap;
    setCoverGenSnap(null);
    coverGenSnapRef.current = null;
  }, [concept, lang, lyrics, lyricsVariants, mergeLyricsTitlesIntoStyle, setStyleVariants, setStyleData, setStyleGenSnap, setCoverGenSnap, styleGenSnapRef, coverGenSnapRef]);

  const handleGenerateLyrics = useCallback(async () => {
    if (!manualApiKey) {
      showToast(tr.errors.noApiKey, 'error');
      return;
    }
    if (!concept.topic?.trim()) {
      showToast(tr.concept.enterTopicFirst, 'error');
      setActiveStep(WorkflowStep.CONCEPT);
      return;
    }
    setIsLoading(true);
    setLoadingProgress(5);
    setLoadingText(tr.loading.analyzingConcept);
    try {
      let finalConcept = { ...concept };
      if (!finalConcept.topic.trim()) finalConcept = { ...finalConcept, topic: await generateRandomTopic() };
      setLoadingProgress(15);
      if (!hasConceptDetails(finalConcept)) {
        const suggestions = await analyzeTopic(finalConcept.topic, finalConcept.isInstrumental, lang);
        finalConcept = {
          ...finalConcept,
          genre: finalConcept.genre.length ? finalConcept.genre : (suggestions.genre || []),
          mood: finalConcept.mood.length ? finalConcept.mood : (suggestions.mood || []),
          instrumentation: (finalConcept.instrumentation?.length ? finalConcept.instrumentation : (suggestions.instrumentation || [])) as string[],
          tempo: finalConcept.tempo.length ? finalConcept.tempo : (suggestions.tempo || []),
          timbre: finalConcept.timbre?.length ? finalConcept.timbre : (suggestions.timbre || []),
          excludedStyles: finalConcept.excludedStyles?.length ? finalConcept.excludedStyles : (suggestions.excludedStyles || []),
          vocals: finalConcept.isInstrumental ? [] : (finalConcept.vocals.length ? finalConcept.vocals : (suggestions.vocals || [])),
          language: finalConcept.isInstrumental ? [] : (finalConcept.language.length ? finalConcept.language : (suggestions.language || []))
        };
      }
      setConcept(finalConcept);
      setLoadingProgress(30);
      setLoadingText(tr.loading.generatingLyrics);
      setLoadingProgress(35);
      const [genLyricsA, genLyricsB] = await Promise.all([
        generateLyrics(finalConcept),
        generateLyrics(finalConcept)
      ]);
      const lyricsA = cleanAiText(genLyricsA);
      const lyricsB = cleanAiText(genLyricsB);
      setLyricsVariants([lyricsA, lyricsB]);
      setLyrics(lyricsA);
      setConcept((prev) =>
        prev.isInstrumental
          ? prev
          : {
              ...prev,
              languageVariant2: [...(prev.language ?? [])],
              vocalsVariant2: [...(prev.vocals ?? [])],
            }
      );
      setLoadingProgress(100);
      setLyricsStepUnlocked(true);
      setCoverStepUnlocked(false);
      setActiveStep(WorkflowStep.LYRICS);
      void refreshSongTitles({ concept: finalConcept, primary: lyricsA, secondary: lyricsB });
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
      setLoadingProgress(0);
    }
  }, [manualApiKey, concept, showToast, tr, setActiveStep, setIsLoading, setLoadingProgress, setLoadingText, lang, setConcept, setLyricsVariants, setLyrics, setLyricsStepUnlocked, setCoverStepUnlocked, refreshSongTitles, handleError]);

  const handleWorkflowStepChange = useCallback(async (step: WorkflowStep) => {
    if (step === WorkflowStep.ARTWORK) {
      setCoverStepUnlocked(true);
    }

    const dualCoverPipeline =
      step === WorkflowStep.ARTWORK &&
      lyricsVariants &&
      lyricsVariants.length >= 2 &&
      styleData &&
      computeNeedsCoverRegen(
        concept,
        lyrics,
        lyricsVariants,
        styleData,
        styleVariants,
        coverUrl,
        styleGenSnapRef.current,
        coverGenSnapRef.current
      );

    if (dualCoverPipeline) {
      if (coverRequestInFlightRef.current) return;
      const cooldownLeft = getCoverCooldownRemainingMs();
      if (cooldownLeft > 0) {
        const sec = Math.ceil(cooldownLeft / 1000);
        const msg = `Cover-Generierung pausiert: bitte ${sec}s warten und erneut versuchen.`;
        setCoverError(msg);
        showToast(msg, 'info');
        setActiveStep(WorkflowStep.ARTWORK);
        return;
      }
      coverRequestInFlightRef.current = true;
      setIsLoading(true);
      setLoadingText(tr.loading.generatingCover);
      setLoadingProgress(50);
      setCoverError(null);
      try {
        const genCover = await generateCoverArt(concept);
        setCoverUrl(genCover);
        const cSnap = buildCoverGenSnapshot(concept, lyrics, lyricsVariants, styleData, styleVariants);
        setCoverGenSnap(cSnap);
        coverGenSnapRef.current = cSnap;
        const item: SongHistoryItem = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          concept,
          lyrics: lyricsVariants[0],
          lyricsVariant2: lyricsVariants[1],
          styleData: styleData!,
          ...(styleVariants ? { styleVariant2: styleVariants[1] } : {}),
          coverUrl: genCover,
        };
        await saveSongToDB(item);
        setCurrentHistoryItemId(item.id);
        setHistory(prev => [item, ...prev]);
      } catch (e) {
        handleError(e);
        const msg = e instanceof Error ? e.message : String(e ?? 'Unbekannter Fehler');
        if (isCoverQuotaError(msg)) {
          setCoverCooldown(COVER_COOLDOWN_MS);
          recordQuotaError(COVER_COOLDOWN_MS);
        }
        setCoverError(msg);
      } finally {
        coverRequestInFlightRef.current = false;
        setIsLoading(false);
        setLoadingProgress(0);
        setActiveStep(WorkflowStep.ARTWORK);
      }
      return;
    }
    setActiveStep(step);
  }, [setCoverStepUnlocked, lyricsVariants, styleData, concept, lyrics, styleVariants, coverUrl, styleGenSnapRef, coverGenSnapRef, coverRequestInFlightRef, setCoverError, showToast, setActiveStep, setIsLoading, setLoadingText, setLoadingProgress, tr.loading.generatingCover, setCoverUrl, setCoverGenSnap, setCurrentHistoryItemId, setHistory, handleError]);

  const handleLyricsNext = useCallback(async () => {
    const hasTwo = lyricsVariants && lyricsVariants.length >= 2;
    const hasOne = lyrics?.trim();
    if (!hasTwo && !hasOne) return;

    if (workflowChainComplete && !computeNeedsStyleRegen(concept, lyrics, lyricsVariants, styleGenSnap)) {
      setActiveStep(WorkflowStep.STYLE);
      return;
    }

    setIsLoading(true);
    setLoadingText(tr.loading.generatingStyle);
    setLoadingProgress(30);
    try {
      await runStylePromptGeneration();
      setLoadingProgress(100);
      setCoverStepUnlocked(false);
      setStyleStepUnlocked(true);
      setActiveStep(WorkflowStep.STYLE);
    } catch (e) { handleError(e); }
    finally { setIsLoading(false); setLoadingProgress(0); }
  }, [lyricsVariants, lyrics, workflowChainComplete, concept, styleGenSnap, setActiveStep, setIsLoading, setLoadingText, setLoadingProgress, tr.loading.generatingStyle, runStylePromptGeneration, setCoverStepUnlocked, setStyleStepUnlocked, handleError]);

  const handleStyleStepNext = useCallback(async () => {
    if (coverRequestInFlightRef.current) return;

    if (computeNeedsStyleRegen(concept, lyrics, lyricsVariants, styleGenSnapRef.current)) {
      setIsLoading(true);
      setLoadingText(tr.loading.generatingStyle);
      setLoadingProgress(30);
      try {
        await runStylePromptGeneration();
        setLoadingProgress(100);
        setStyleStepUnlocked(true);
        setCoverStepUnlocked(false);
      } catch (e) {
        handleError(e);
        return;
      } finally {
        setIsLoading(false);
        setLoadingProgress(0);
      }
    }

    const dualNeedsCover =
      lyricsVariants &&
      lyricsVariants.length >= 2 &&
      styleData &&
      computeNeedsCoverRegen(
        concept,
        lyrics,
        lyricsVariants,
        styleData,
        styleVariants,
        coverUrl,
        styleGenSnapRef.current,
        coverGenSnapRef.current
      );

    if (dualNeedsCover) {
      await handleWorkflowStepChange(WorkflowStep.ARTWORK);
      return;
    }

    setCoverStepUnlocked(true);
    setActiveStep(WorkflowStep.ARTWORK);
  }, [coverRequestInFlightRef, concept, lyrics, lyricsVariants, styleData, styleVariants, coverUrl, styleGenSnapRef, tr.loading.generatingStyle, runStylePromptGeneration, setStyleStepUnlocked, setCoverStepUnlocked, handleError, setIsLoading, setLoadingText, setLoadingProgress, coverGenSnapRef, handleWorkflowStepChange, setActiveStep]);

  return {
    runStylePromptGeneration,
    handleGenerateLyrics,
    handleLyricsNext,
    handleWorkflowStepChange,
    handleStyleStepNext,
  };
}
