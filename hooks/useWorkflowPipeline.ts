import { useCallback } from 'react';
import { WorkflowStep, SongConcept, GeneratedStyle } from '../types';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  buildCoverGenSnapshot,
  buildStyleGenSnapshot,
  type CoverGenSnapshot,
  type StyleGenSnapshot,
} from '../pipelineSnapshot';

type Mode = 'nav' | 'pipeline';

interface UseWorkflowPipelineParams {
  concept: SongConcept;
  lyrics: string;
  lyricsVariants: [string, string] | null;
  styleData: GeneratedStyle | null;
  styleVariants: [GeneratedStyle, GeneratedStyle] | null;
  setConcept: Dispatch<SetStateAction<SongConcept>>;
  setLyrics: Dispatch<SetStateAction<string>>;
  setLyricsVariants: Dispatch<SetStateAction<[string, string] | null>>;
  setStyleData: Dispatch<SetStateAction<GeneratedStyle | null>>;
  setStyleVariants: Dispatch<SetStateAction<[GeneratedStyle, GeneratedStyle] | null>>;
  setStyleRegenPendingForVariants: Dispatch<SetStateAction<(1 | 2)[]>>;
  setSongTitleSuggestions: Dispatch<SetStateAction<string[]>>;
  setSelectedSongTitle: Dispatch<SetStateAction<string | null>>;
  setSongTitlesLoading: Dispatch<SetStateAction<boolean>>;
  setCoverUrl: Dispatch<SetStateAction<string>>;
  setCoverError: Dispatch<SetStateAction<string | null>>;
  setStyleGenSnap: Dispatch<SetStateAction<StyleGenSnapshot | null>>;
  setCoverGenSnap: Dispatch<SetStateAction<CoverGenSnapshot | null>>;
  styleGenSnapRef: MutableRefObject<StyleGenSnapshot | null>;
  coverGenSnapRef: MutableRefObject<CoverGenSnapshot | null>;
  setLyricsStepUnlocked: Dispatch<SetStateAction<boolean>>;
  setStyleStepUnlocked: Dispatch<SetStateAction<boolean>>;
  setCoverStepUnlocked: Dispatch<SetStateAction<boolean>>;
  setWorkflowChainComplete: Dispatch<SetStateAction<boolean>>;
  setCurrentHistoryItemId: Dispatch<SetStateAction<string | null>>;
  setActiveStep: Dispatch<SetStateAction<WorkflowStep>>;
}

export function useWorkflowPipeline(params: UseWorkflowPipelineParams) {
  const {
    concept,
    lyrics,
    lyricsVariants,
    styleData,
    styleVariants,
    setConcept,
    setLyrics,
    setLyricsVariants,
    setStyleData,
    setStyleVariants,
    setStyleRegenPendingForVariants,
    setSongTitleSuggestions,
    setSelectedSongTitle,
    setSongTitlesLoading,
    setCoverUrl,
    setCoverError,
    setStyleGenSnap,
    setCoverGenSnap,
    styleGenSnapRef,
    coverGenSnapRef,
    setLyricsStepUnlocked,
    setStyleStepUnlocked,
    setCoverStepUnlocked,
    setWorkflowChainComplete,
    setCurrentHistoryItemId,
    setActiveStep,
  } = params;

  const handleStartNew = useCallback(() => {
    setConcept({
      topic: '',
      chordProgression: undefined,
      genre: [],
      mood: [],
      tempo: [],
      language: [],
      isInstrumental: false,
      vocals: [],
      instrumentation: [],
      timbre: [],
      excludedStyles: [],
    });
    setLyrics('');
    setLyricsVariants(null);
    setStyleData(null);
    setStyleVariants(null);
    setStyleRegenPendingForVariants([]);
    setSongTitleSuggestions([]);
    setSelectedSongTitle(null);
    setSongTitlesLoading(false);
    setCoverUrl('');
    setCoverError(null);
    setCoverStepUnlocked(false);
    setLyricsStepUnlocked(false);
    setStyleStepUnlocked(false);
    setWorkflowChainComplete(false);
    setStyleGenSnap(null);
    setCoverGenSnap(null);
    styleGenSnapRef.current = null;
    coverGenSnapRef.current = null;
    setCurrentHistoryItemId(null);
    setActiveStep(WorkflowStep.CONCEPT);
  }, [
    setConcept,
    setLyrics,
    setLyricsVariants,
    setStyleData,
    setStyleVariants,
    setStyleRegenPendingForVariants,
    setSongTitleSuggestions,
    setSelectedSongTitle,
    setSongTitlesLoading,
    setCoverUrl,
    setCoverError,
    setCoverStepUnlocked,
    setLyricsStepUnlocked,
    setStyleStepUnlocked,
    setWorkflowChainComplete,
    setStyleGenSnap,
    setCoverGenSnap,
    styleGenSnapRef,
    coverGenSnapRef,
    setCurrentHistoryItemId,
    setActiveStep,
  ]);

  const handleConceptNext = useCallback((inputConcept: SongConcept, mode: Mode) => {
    setConcept(inputConcept);
    setLyricsStepUnlocked(true);
    setCoverStepUnlocked(false);

    if (mode === 'pipeline') {
      setLyrics('');
      setLyricsVariants(null);
      setStyleData(null);
      setStyleVariants(null);
      setStyleRegenPendingForVariants([]);
      setSongTitleSuggestions([]);
      setSelectedSongTitle(null);
      setSongTitlesLoading(false);
      setCoverUrl('');
      setCoverError(null);
      setStyleGenSnap(null);
      setCoverGenSnap(null);
      styleGenSnapRef.current = null;
      coverGenSnapRef.current = null;
      setStyleStepUnlocked(false);
    } else if (styleData) {
      const sSnap = buildStyleGenSnapshot(inputConcept, lyrics, lyricsVariants);
      setStyleGenSnap(sSnap);
      styleGenSnapRef.current = sSnap;
      const cSnap = buildCoverGenSnapshot(inputConcept, lyrics, lyricsVariants, styleData, styleVariants);
      setCoverGenSnap(cSnap);
      coverGenSnapRef.current = cSnap;
    }
    setActiveStep(WorkflowStep.LYRICS);
  }, [
    setConcept,
    setLyricsStepUnlocked,
    setCoverStepUnlocked,
    setLyrics,
    setLyricsVariants,
    setStyleData,
    setStyleVariants,
    setStyleRegenPendingForVariants,
    setSongTitleSuggestions,
    setSelectedSongTitle,
    setSongTitlesLoading,
    setCoverUrl,
    setCoverError,
    setStyleGenSnap,
    setCoverGenSnap,
    styleGenSnapRef,
    coverGenSnapRef,
    setStyleStepUnlocked,
    styleData,
    lyrics,
    lyricsVariants,
    styleVariants,
    setActiveStep,
  ]);

  const reanchorStyleAndCoverSnapshots = useCallback(() => {
    if (!styleData) return;
    const sSnap = buildStyleGenSnapshot(concept, lyrics, lyricsVariants);
    setStyleGenSnap(sSnap);
    styleGenSnapRef.current = sSnap;
    const cSnap = buildCoverGenSnapshot(concept, lyrics, lyricsVariants, styleData, styleVariants);
    setCoverGenSnap(cSnap);
    coverGenSnapRef.current = cSnap;
  }, [concept, lyrics, lyricsVariants, styleData, styleVariants, setStyleGenSnap, setCoverGenSnap, styleGenSnapRef, coverGenSnapRef]);

  const handleLyricsNextNavOnly = useCallback(() => {
    if (styleData) reanchorStyleAndCoverSnapshots();
    setStyleStepUnlocked(true);
    setCoverStepUnlocked(false);
    setActiveStep(WorkflowStep.STYLE);
  }, [styleData, reanchorStyleAndCoverSnapshots, setStyleStepUnlocked, setCoverStepUnlocked, setActiveStep]);

  const handleStyleStepNextNavOnly = useCallback(() => {
    if (styleData) reanchorStyleAndCoverSnapshots();
    setCoverStepUnlocked(true);
    setActiveStep(WorkflowStep.ARTWORK);
  }, [styleData, reanchorStyleAndCoverSnapshots, setCoverStepUnlocked, setActiveStep]);

  return {
    handleStartNew,
    handleConceptNext,
    reanchorStyleAndCoverSnapshots,
    handleLyricsNextNavOnly,
    handleStyleStepNextNavOnly,
  };
}
