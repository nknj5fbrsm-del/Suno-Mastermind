import React, { useState, useEffect, useRef, createContext, useContext, useMemo, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Analytics } from '@vercel/analytics/react';
import { WorkflowStep, SongConcept, GeneratedStyle, SongHistoryItem, ThemeName } from './types';
import { generateLyrics, generateStylePrompt, generateCoverArt, generateRandomTopic, analyzeTopic, enrichRegie, simplifyLyricsText, enrichStylePrompt, generateLyricsTitleSuggestions } from './services/geminiService';
import { loadHistoryFromDB, saveSongToDB, deleteSongFromDB } from './services/storageService';
import { getTokenUsageSnapshot, recordQuotaError, subscribeTokenUsage } from './services/tokenUsageTracker';
import { t, Lang } from './translations';
import {
  buildCoverGenSnapshot,
  buildStyleGenSnapshot,
  computeNeedsCoverRegen,
  computeNeedsStyleRegen,
  type CoverGenSnapshot,
  type StyleGenSnapshot,
} from './pipelineSnapshot';

// Lazy: Step-Views erst bei Bedarf laden (schnellerer Start)
import WorkflowNavigation from './components/WorkflowNavigation';
const ConceptForm = lazy(() => import('./components/ConceptForm'));
const LyricDisplay = lazy(() => import('./components/LyricDisplay'));
const LyricsCompareView = lazy(() => import('./components/LyricsCompareView'));
const StyleDisplay = lazy(() => import('./components/StyleDisplay'));
const ArtworkDisplay = lazy(() => import('./components/ArtworkDisplay'));
const DashboardDisplay = lazy(() => import('./components/DashboardDisplay'));

// ─── Language Context ───────────────────────────────────────────────────────
export const LangContext = createContext<{ lang: Lang; tr: typeof t.de }>({ lang: 'de', tr: t.de });
export const useLang = () => useContext(LangContext);

// ─── Toast Context ───────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info';
type ToastState = { message: string; type: ToastType } | null;
const ToastContext = createContext<{ showToast: (message: string, type?: ToastType) => void }>({ showToast: () => {} });
export const useToast = () => useContext(ToastContext);

const ToastBar: React.FC<{ toast: ToastState; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  if (!toast) return null;
  React.useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);
  const bg = toast.type === 'error' ? 'bg-red-600/95' : toast.type === 'success' ? 'bg-emerald-600/95' : 'bg-suno-primary/95';
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] px-5 py-3 rounded-2xl shadow-2xl text-white text-sm font-medium flex items-center gap-3 ${bg} backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-300`}
      style={{ bottom: 'max(24px, calc(env(safe-area-inset-bottom) + 24px))' }}>
      {toast.type === 'error' && <i className="fas fa-circle-exclamation opacity-90"></i>}
      {toast.type === 'success' && <i className="fas fa-check-circle opacity-90"></i>}
      <span>{toast.message}</span>
      <button type="button" onClick={onDismiss} className="ml-1 opacity-70 hover:opacity-100" aria-label="Schließen">
        <i className="fas fa-times text-xs"></i>
      </button>
    </div>
  );
};

const HeaderLogo = () => (
  <div className="relative flex-shrink-0">
    {/* Outer ambient glow */}
    <div className="logo-bg-decor absolute -inset-1.5 sm:-inset-2 rounded-2xl suno-gradient opacity-[0.22] blur-xl pointer-events-none animate-logo-pulse"></div>
    {/* Logo box */}
    <div
      className="logo-glow relative w-9 h-9 sm:w-11 sm:h-11 rounded-[12px] sm:rounded-[14px] flex items-center justify-center overflow-hidden transition-transform duration-300 hover:scale-[1.07] cursor-pointer"
      style={{ background: 'linear-gradient(150deg, #1a0830 0%, #0e0d22 55%, #080616 100%)' }}
    >
      {/* Inner gradient layer */}
      <div className="absolute inset-0 suno-gradient opacity-[0.22] pointer-events-none"></div>
      {/* Top-left sheen */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.13] via-transparent to-transparent pointer-events-none"></div>
      {/* Bottom-right shadow */}
      <div className="absolute inset-0 bg-gradient-to-tl from-black/30 via-transparent to-transparent pointer-events-none"></div>
      {/* Icon */}
      <i className="fas fa-compact-disc relative z-10 text-white text-xs sm:text-sm" style={{ filter: 'drop-shadow(0 0 6px rgba(168,85,247,0.7))' }}></i>
    </div>
  </div>
);

const COVER_COOLDOWN_KEY = 'cover_cooldown_until';
const COVER_COOLDOWN_MS = 90_000;
const QUOTA_POST_COOLDOWN_YELLOW_MS = 30_000;
const formatTokenCount = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
};
const formatSeconds = (value: number): string => {
  const total = Math.max(0, Math.floor(value));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
};

const GeminiMiniLogo = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <linearGradient id="geminiMiniGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="50%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#f472b6" />
      </linearGradient>
    </defs>
    <path d="M12 2.5l2.3 5.2L19.5 10l-5.2 2.3L12 17.5l-2.3-5.2L4.5 10l5.2-2.3L12 2.5z" fill="url(#geminiMiniGrad)" />
  </svg>
);

const App: React.FC = () => {
  const [activeStep, setActiveStep] = useState<WorkflowStep>(WorkflowStep.DASHBOARD);
  /** Cover-Tab erst nach „Weiter“ vom Style; bei Archiv-Recall od. auf Cover: frei. */
  const [coverStepUnlocked, setCoverStepUnlocked] = useState(false);
  /** Lyrics-Tab erst nach „Weiter“ im Konzept (bzw. nach abgeschlossener Kette / Recall). */
  const [lyricsStepUnlocked, setLyricsStepUnlocked] = useState(false);
  /** Style-Tab erst nach „Weiter“ im Lyrics-Schritt. */
  const [styleStepUnlocked, setStyleStepUnlocked] = useState(false);
  /** Einmal Konzept → … → Cover durchlaufen: Weiter-Buttons werden zu reiner Navigation, bis etwas „dirty“ wird. */
  const [workflowChainComplete, setWorkflowChainComplete] = useState(false);
  /** Letzter Stand, mit dem Style-Prompts zur Lyrics/Konzept-Kombination passen. */
  const [styleGenSnap, setStyleGenSnap] = useState<StyleGenSnapshot | null>(null);
  /** Letzter Stand, zu dem das (Dual-)Cover passt. */
  const [coverGenSnap, setCoverGenSnap] = useState<CoverGenSnapshot | null>(null);
  const styleGenSnapRef = useRef<StyleGenSnapshot | null>(null);
  const coverGenSnapRef = useRef<CoverGenSnapshot | null>(null);
  const [activeTheme, setActiveTheme] = useState<ThemeName>('mastermind');
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isQuotaInfoOpen, setIsQuotaInfoOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const themeDropdownRef = useRef<HTMLDivElement>(null);
  const quotaButtonRef = useRef<HTMLDivElement>(null);
  const quotaInfoRef = useRef<HTMLDivElement>(null);
  const [themeDropdownAnchor, setThemeDropdownAnchor] = useState<{ top: number; right: number } | null>(null);
  
  // BYOK State: Wir nutzen jetzt einen String statt nur eines Booleans
  const [manualApiKey, setManualApiKey] = useState<string>(() => localStorage.getItem('gemini_api_key') || '');
  const [isKeySaved, setIsKeySaved] = useState<boolean>(() => !!localStorage.getItem('gemini_api_key'));

  const [concept, setConcept] = useState<SongConcept>({
    topic: '',
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
  const [lyrics, setLyrics] = useState<string>('');
  /** Zwei Lyrics-Varianten zum Vergleichen (Create-Flow); nach Wahl wird eine übernommen. */
  const [lyricsVariants, setLyricsVariants] = useState<[string, string] | null>(null);
  /** Nach Wahl einer Lyrics-Variante: Cover generieren und Song speichern. */
  const [styleData, setStyleData] = useState<GeneratedStyle | null>(null);
  /** Zwei Style-Varianten (passend zu Lyrics 1 und 2); beim Create-Flow beide generiert, auf Style-Seite nebeneinander. */
  const [styleVariants, setStyleVariants] = useState<[GeneratedStyle, GeneratedStyle] | null>(null);
  /** Varianten, deren Sprache/Gesangsstil im Lyrics-Tab geändert wurde – Style wird beim Wechsel ins Style-Tab nachgezogen. */
  const [styleRegenPendingForVariants, setStyleRegenPendingForVariants] = useState<(1 | 2)[]>([]);
  /** Songtitel aus Lyrics-Kontext (gemeinsam für beide Varianten); nach Style-Gen in styleData gemerged. */
  const [songTitleSuggestions, setSongTitleSuggestions] = useState<string[]>([]);
  const [selectedSongTitle, setSelectedSongTitle] = useState<string | null>(null);
  const [songTitlesLoading, setSongTitlesLoading] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string>('');
  const [coverError, setCoverError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>('Generating Magic...');
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [history, setHistory] = useState<SongHistoryItem[]>([]);
  const [currentHistoryItemId, setCurrentHistoryItemId] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('suno-lang') as Lang) || 'de');
  const [toast, setToast] = useState<ToastState>(null);
  const [tokenUsage, setTokenUsage] = useState(() => getTokenUsageSnapshot());
  const [clockMs, setClockMs] = useState<number>(() => Date.now());
  const coverRequestInFlightRef = useRef(false);
  const showToast = React.useCallback((message: string, type: ToastType = 'info') => setToast({ message, type }), []);
  const dismissToast = React.useCallback(() => setToast(null), []);
  const tr = useMemo(() => t[lang], [lang]);
  const langValue = useMemo(() => ({ lang, tr }), [lang, tr]);

  const needsStyleRegenUi = useMemo(
    () => computeNeedsStyleRegen(concept, lyrics, lyricsVariants, styleGenSnap),
    [concept, lyrics, lyricsVariants, styleGenSnap]
  );
  const needsDualCoverRun = useMemo(() => {
    if (!lyricsVariants || lyricsVariants.length < 2 || !styleData) return false;
    return computeNeedsCoverRegen(
      concept,
      lyrics,
      lyricsVariants,
      styleData,
      styleVariants,
      coverUrl,
      styleGenSnap,
      coverGenSnap
    );
  }, [concept, lyrics, lyricsVariants, styleData, styleVariants, coverUrl, styleGenSnap, coverGenSnap]);

  const lyricsNextUsesAi = !workflowChainComplete || needsStyleRegenUi;
  const styleNextUsesAi = !workflowChainComplete || needsStyleRegenUi || needsDualCoverRun;

  useEffect(() => {
    styleGenSnapRef.current = styleGenSnap;
  }, [styleGenSnap]);
  useEffect(() => {
    coverGenSnapRef.current = coverGenSnap;
  }, [coverGenSnap]);

  useEffect(() => {
    if (activeStep === WorkflowStep.ARTWORK && styleData) {
      setWorkflowChainComplete(true);
      setLyricsStepUnlocked(true);
      setStyleStepUnlocked(true);
      setCoverStepUnlocked(true);
    }
  }, [activeStep, styleData]);

  useEffect(() => {
    const unsubscribe = subscribeTokenUsage(setTokenUsage);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    // Theme Initialisierung – App läuft ausschließlich im Dark-Mode
    const savedTheme = (localStorage.getItem('suno-theme') as ThemeName) || 'mastermind';
    setActiveTheme(savedTheme);
    document.documentElement.className = `dark theme-${savedTheme}`;
    
    // History laden
    const fetchHistory = async () => {
      const dbHistory = await loadHistoryFromDB();
      setHistory(dbHistory);
    };
    fetchHistory();

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inMenu = themeMenuRef.current?.contains(target);
      const inDropdown = themeDropdownRef.current?.contains(target);
      const inQuotaButton = quotaButtonRef.current?.contains(target);
      const inQuotaInfo = quotaInfoRef.current?.contains(target);
      if (!inMenu && !inDropdown) setIsThemeMenuOpen(false);
      if (!inQuotaButton && !inQuotaInfo) setIsQuotaInfoOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside as any);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside as any);
    };
  }, []);

  // Key speichern Funktion
  const handleSaveKey = () => {
    if (manualApiKey.trim().length < 20) {
      showToast(tr.errors.invalidApiKey, 'error');
      return;
    }
    localStorage.setItem('gemini_api_key', manualApiKey);
    setIsKeySaved(true);
    // Wir setzen den Key global für den Service (falls dieser darauf wartet)
    (window as any).GEMINI_API_KEY = manualApiKey;
  };

  const handleError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? 'Unbekannter Fehler');
    if (message.includes("API key not valid") || message.includes("403") || message.includes("401")) {
      setIsKeySaved(false);
      showToast(tr.errors.apiKeyInvalid, 'error');
    } else if (/429|quota|resource_exhausted|rate-limit/i.test(message)) {
      recordQuotaError(60_000);
      showToast(tr.errors.aiErrorPrefix + message, 'error');
    } else {
      showToast(tr.errors.aiErrorPrefix + message, 'error');
    }
  }, [showToast, tr]);

  const quotaCooldownLeftSec = useMemo(() => {
    const until = tokenUsage.quota.cooldownUntil ?? 0;
    return Math.max(0, Math.ceil((until - clockMs) / 1000));
  }, [tokenUsage.quota.cooldownUntil, clockMs]);

  const effectiveQuotaStatus = useMemo<'green' | 'yellow' | 'red'>(() => {
    const cooldownUntil = tokenUsage.quota.cooldownUntil ?? 0;
    const cooldownActive = cooldownUntil > clockMs;
    const postCooldownYellowActive =
      cooldownUntil > 0 &&
      clockMs > cooldownUntil &&
      clockMs <= cooldownUntil + QUOTA_POST_COOLDOWN_YELLOW_MS;
    if (cooldownActive) return 'red';
    if (postCooldownYellowActive) return 'yellow';
    if (tokenUsage.quota.usageRatio >= 0.95) return 'red';
    if (tokenUsage.quota.usageRatio >= 0.8) return 'yellow';
    return 'green';
  }, [tokenUsage.quota.cooldownUntil, tokenUsage.quota.usageRatio, clockMs]);

  const quotaStatusUi = useMemo(() => {
    if (effectiveQuotaStatus === 'red') {
      return {
        dot: 'bg-red-500',
        text: lang === 'de' ? 'Stop' : 'Stop',
        hint: quotaCooldownLeftSec > 0
          ? (lang === 'de' ? `Warte ${formatSeconds(quotaCooldownLeftSec)}` : `Wait ${formatSeconds(quotaCooldownLeftSec)}`)
          : (lang === 'de' ? 'Quota-Risiko hoch' : 'High quota risk'),
      };
    }
    if (effectiveQuotaStatus === 'yellow') {
      const cooldownUntil = tokenUsage.quota.cooldownUntil ?? 0;
      const postCooldownWatchSec =
        cooldownUntil > 0 && clockMs > cooldownUntil && clockMs <= cooldownUntil + QUOTA_POST_COOLDOWN_YELLOW_MS
          ? Math.ceil((cooldownUntil + QUOTA_POST_COOLDOWN_YELLOW_MS - clockMs) / 1000)
          : 0;
      return {
        dot: 'bg-amber-400',
        text: lang === 'de' ? 'Vorsicht' : 'Caution',
        hint: postCooldownWatchSec > 0
          ? (lang === 'de' ? `Stabilisiert sich ${formatSeconds(postCooldownWatchSec)}` : `Stabilizing ${formatSeconds(postCooldownWatchSec)}`)
          : (lang === 'de' ? 'Weiter möglich' : 'Likely okay'),
      };
    }
    return {
      dot: 'bg-emerald-400',
      text: lang === 'de' ? 'OK' : 'OK',
      hint: lang === 'de' ? 'Weitergenerieren' : 'Can continue',
    };
  }, [effectiveQuotaStatus, quotaCooldownLeftSec, tokenUsage.quota.cooldownUntil, clockMs, lang]);

  const changeTheme = (theme: ThemeName) => {
    setActiveTheme(theme);
    document.documentElement.className = `dark theme-${theme}`;
    localStorage.setItem('suno-theme', theme);
    setIsThemeMenuOpen(false);
  };

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
    setLyrics(''); setLyricsVariants(null); setStyleData(null); setStyleVariants(null); setStyleRegenPendingForVariants([]); setCoverUrl('');
    setSongTitleSuggestions([]); setSelectedSongTitle(null); setSongTitlesLoading(false);
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
  }, []);

  // Helper zum Bereinigen von %20 und anderen Encodings
  const cleanAiText = (text: string) => {
    try {
      return decodeURIComponent(text.replace(/\+/g, ' '));
    } catch (e) {
      return text;
    }
  };

  const mergeLyricsTitlesIntoStyle = useCallback(
    (style: GeneratedStyle): GeneratedStyle => ({
      ...style,
      titleSuggestions:
        songTitleSuggestions.length > 0 ? songTitleSuggestions : (style.titleSuggestions ?? []),
      selectedTitleSuggestion: selectedSongTitle ?? style.selectedTitleSuggestion,
    }),
    [songTitleSuggestions, selectedSongTitle]
  );

  type TitleRefreshOverride = { concept?: SongConcept; primary?: string; secondary?: string | null };

  const refreshSongTitles = useCallback(
    async (override?: TitleRefreshOverride) => {
      const c = override?.concept ?? concept;
      const primary = override?.primary ?? (lyricsVariants ? lyricsVariants[0] : lyrics);
      const secondary =
        override?.secondary !== undefined
          ? override.secondary
          : lyricsVariants
            ? lyricsVariants[1]
            : null;
      if (c.isInstrumental) {
        if (!c.topic?.trim()) {
          setSongTitleSuggestions([]);
          setSelectedSongTitle(null);
          return;
        }
      } else if (!primary?.trim()) {
        setSongTitleSuggestions([]);
        setSelectedSongTitle(null);
        return;
      }
      setSongTitlesLoading(true);
      try {
        const titles = await generateLyricsTitleSuggestions(c, primary, secondary, lang);
        setSongTitleSuggestions(titles);
        setSelectedSongTitle((prev) => (prev && titles.includes(prev) ? prev : null));
      } catch {
        setSongTitleSuggestions([]);
      } finally {
        setSongTitlesLoading(false);
      }
    },
    [concept, lyrics, lyricsVariants, lang]
  );

  const handleSelectSongTitle = useCallback(
    (title: string) => {
      setSelectedSongTitle(title);
      setStyleData((prev) => (prev ? { ...prev, selectedTitleSuggestion: title } : null));
      showToast(tr.lyrics.titleSelectedForCleanToast, 'info');
      if (!currentHistoryItemId) return;
      setHistory((prev) => {
        const target = prev.find((h) => h.id === currentHistoryItemId);
        if (!target) return prev;
        const updated: SongHistoryItem = {
          ...target,
          styleData: { ...target.styleData, selectedTitleSuggestion: title },
        };
        void saveSongToDB(updated);
        return prev.map((h) => (h.id === currentHistoryItemId ? updated : h));
      });
    },
    [currentHistoryItemId, showToast, tr.lyrics.titleSelectedForCleanToast]
  );

  /** Konzept → Lyrics: `nav` = bestehende Inhalte optional per Snapshot „bestätigen“; `pipeline` = Lyrics/Style/Cover leeren. */
  const handleConceptNext = useCallback((inputConcept: SongConcept, mode: 'nav' | 'pipeline') => {
    setConcept(inputConcept);
    setLyricsStepUnlocked(true);
    setCoverStepUnlocked(false);

    if (mode === 'pipeline') {
      setLyrics('');
      setLyricsVariants(null);
      setStyleData(null);
      setStyleVariants(null);
      setStyleRegenPendingForVariants([]);
      setSongTitleSuggestions([]); setSelectedSongTitle(null); setSongTitlesLoading(false);
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
  }, [lyrics, lyricsVariants, styleData, styleVariants]);

  /** Snapshots an aktuellen Stand anbinden (ohne KI) – „ohne neue KI weiter“. */
  const reanchorStyleAndCoverSnapshots = useCallback(() => {
    if (!styleData) return;
    const sSnap = buildStyleGenSnapshot(concept, lyrics, lyricsVariants);
    setStyleGenSnap(sSnap);
    styleGenSnapRef.current = sSnap;
    const cSnap = buildCoverGenSnapshot(concept, lyrics, lyricsVariants, styleData, styleVariants);
    setCoverGenSnap(cSnap);
    coverGenSnapRef.current = cSnap;
  }, [concept, lyrics, lyricsVariants, styleData, styleVariants]);

  const handleLyricsNextNavOnly = useCallback(() => {
    if (styleData) reanchorStyleAndCoverSnapshots();
    setStyleStepUnlocked(true);
    setCoverStepUnlocked(false);
    setActiveStep(WorkflowStep.STYLE);
  }, [styleData, reanchorStyleAndCoverSnapshots]);

  const handleStyleStepNextNavOnly = useCallback(() => {
    if (styleData) reanchorStyleAndCoverSnapshots();
    setCoverStepUnlocked(true);
    setActiveStep(WorkflowStep.ARTWORK);
  }, [styleData, reanchorStyleAndCoverSnapshots]);

  /** Create-Flow: Konzept aus State, ggf. analysieren, 2 Lyrics + 2 Styles generieren (von Lyrics-Tab aus). */
  const handleGenerateLyrics = useCallback(async () => {
    if (!manualApiKey) {
      showToast(tr.errors.noApiKey, 'error');
      setIsKeySaved(false);
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
      // Sprache/Gesangsstil pro Spalte entkoppeln (Variante 2 sonst Fallback auf dieselben Arrays wie Variante 1).
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
  }, [concept, tr, lang, handleError, refreshSongTitles]);

  const onConceptChange = useCallback((patch: Partial<SongConcept>) => setConcept(prev => ({ ...prev, ...patch })), []);
  const onUpdateLyrics = useCallback((l: string) => setLyrics(l), []);

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

  /** Style-Prompt(s) aus aktuellem Konzept + Lyrics erzeugen und Pipeline-Snapshots setzen (ohne Tab-Wechsel). */
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
  }, [concept, lang, lyrics, lyricsVariants, mergeLyricsTitlesIntoStyle]);

  /** Lyrics „Weiter“: Style-Prompt generieren und zum Style-Tab wechseln (nach kompletter Kette ggf. nur navigieren). */
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
  }, [concept, lyrics, lyricsVariants, workflowChainComplete, styleGenSnap, runStylePromptGeneration, tr.loading.generatingStyle, handleError]);

  /** Tab-Wechsel (z. B. Navigation + „Weiter“ am Style-Ende); bei zwei Lyrics-Varianten: Cover ggf. generieren. */
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
  }, [concept, coverUrl, handleError, lyrics, lyricsVariants, showToast, styleData, styleVariants, tr.loading.generatingCover]);

  /** Style „Weiter“: ggf. Style neu, dann Cover (Dual) oder nur zum Cover-Tab. */
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
  }, [concept, lyrics, lyricsVariants, styleData, styleVariants, coverUrl, runStylePromptGeneration, handleWorkflowStepChange, tr.loading.generatingStyle, handleError]);

  const handleRecall = useCallback((item: SongHistoryItem) => {
    let recalledConcept: SongConcept = {
      ...item.concept,
      timbre: item.concept.timbre ?? [],
    };
    const lv: [string, string] | null =
      item.lyricsVariant2 != null ? [item.lyrics, item.lyricsVariant2] : null;
    const sv: [GeneratedStyle, GeneratedStyle] | null =
      item.styleVariant2 != null ? [item.styleData, item.styleVariant2] : null;
    if (lv != null && !recalledConcept.isInstrumental) {
      if (recalledConcept.languageVariant2 === undefined) {
        recalledConcept = {
          ...recalledConcept,
          languageVariant2: [...(recalledConcept.language ?? [])],
        };
      }
      if (recalledConcept.vocalsVariant2 === undefined) {
        recalledConcept = {
          ...recalledConcept,
          vocalsVariant2: [...(recalledConcept.vocals ?? [])],
        };
      }
    }
    setConcept(recalledConcept);
    setLyrics(item.lyrics);
    setLyricsVariants(lv);
    setStyleData(item.styleData);
    setStyleVariants(sv);
    setStyleRegenPendingForVariants([]);
    setSongTitleSuggestions(item.styleData.titleSuggestions ?? []);
    setSelectedSongTitle(item.styleData.selectedTitleSuggestion ?? null);
    setCoverUrl(item.coverUrl);
    setCurrentHistoryItemId(item.id);
    const sSnap = buildStyleGenSnapshot(recalledConcept, item.lyrics, lv);
    setStyleGenSnap(sSnap);
    styleGenSnapRef.current = sSnap;
    const cSnap = buildCoverGenSnapshot(recalledConcept, item.lyrics, lv, item.styleData, sv);
    setCoverGenSnap(cSnap);
    coverGenSnapRef.current = cSnap;
    setLyricsStepUnlocked(true);
    setStyleStepUnlocked(true);
    setCoverStepUnlocked(true);
    setWorkflowChainComplete(true);
    setActiveStep(WorkflowStep.LYRICS);
  }, []);
  const handleDeleteFromHistory = useCallback(async (id: string) => {
    await deleteSongFromDB(id);
    setHistory(prev => prev.filter(h => h.id !== id));
  }, []);
  const handleToggleFavorite = useCallback(async (id: string) => {
    const target = history.find(h => h.id === id);
    if (!target) return;
    const updated: SongHistoryItem = { ...target, isFavorite: !target.isFavorite };
    await saveSongToDB(updated);
    setHistory(prev => prev.map(h => h.id === id ? updated : h));
  }, [history]);

  const themes: { id: ThemeName; label: string; color: string; desc: string; icon: string }[] = [
    { id: 'mastermind', label: 'Mastermind', color: 'bg-purple-600', icon: 'fa-brain', desc: 'Deep Purple & Pink' },
    { id: 'sunset', label: 'Sunset Glow', color: 'bg-orange-500', icon: 'fa-sun', desc: 'Orange & Red' },
    { id: 'forest', label: 'Forest Tech', color: 'bg-emerald-500', icon: 'fa-tree', desc: 'Emerald & Cyan' }
  ];

  const toggleLang = () => {
    const next: Lang = lang === 'de' ? 'en' : 'de';
    setLang(next);
    localStorage.setItem('suno-lang', next);
  };

  // Design-Dropdown-Position für Portal (damit es auf Mobile nicht von overflow abgeschnitten wird)
  const DROPDOWN_WIDTH = 208; // w-52
  useEffect(() => {
    if (isThemeMenuOpen && themeMenuRef.current) {
      const rect = themeMenuRef.current.getBoundingClientRect();
      const right = Math.min(window.innerWidth - DROPDOWN_WIDTH - 8, Math.max(8, window.innerWidth - rect.right));
      setThemeDropdownAnchor({ top: rect.bottom + 8, right });
    } else {
      setThemeDropdownAnchor(null);
    }
  }, [isThemeMenuOpen]);

  // Beim Wechsel ins Style-Tab: ausstehende Style-Aktualisierungen (wegen geänderter Sprache/Gesangsstil im Lyrics-Tab) nachziehen
  useEffect(() => {
    if (activeStep !== WorkflowStep.STYLE || styleRegenPendingForVariants.length === 0 || !styleVariants || !lyricsVariants) return;
    const toRegen = [...styleRegenPendingForVariants];
    setStyleRegenPendingForVariants([]);
    setLoadingText(tr.loading.generatingStyle);
    setIsLoading(true);
    (async () => {
      try {
        for (const variant of toRegen) {
          if (variant === 1) {
            const styleA = await generateStylePrompt(concept, lang, [lyricsVariants[0]]);
            setStyleVariants(prev => prev ? [mergeLyricsTitlesIntoStyle(styleA), prev[1]] : null);
            setStyleData(mergeLyricsTitlesIntoStyle(styleA));
          } else {
            const conceptForB: SongConcept = {
              ...concept,
              language: (concept.languageVariant2 && concept.languageVariant2.length > 0) ? concept.languageVariant2 : concept.language,
              vocals: (concept.vocalsVariant2 && concept.vocalsVariant2.length > 0) ? concept.vocalsVariant2 : concept.vocals,
            };
            const styleB = await generateStylePrompt(conceptForB, lang, [lyricsVariants[1]]);
            setStyleVariants(prev => prev ? [prev[0], mergeLyricsTitlesIntoStyle(styleB)] : null);
          }
        }
        const snap = buildStyleGenSnapshot(concept, lyrics, lyricsVariants);
        setStyleGenSnap(snap);
        styleGenSnapRef.current = snap;
        setCoverGenSnap(null);
        coverGenSnapRef.current = null;
      } catch (e) {
        handleError(e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [activeStep, styleRegenPendingForVariants, concept, lang, lyrics, lyricsVariants, styleVariants, handleError, tr.loading.generatingStyle, mergeLyricsTitlesIntoStyle]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      <ToastBar toast={toast} onDismiss={dismissToast} />
      {!isKeySaved ? (
        <div className="min-h-screen bg-suno-bg flex items-center justify-center p-6">
          <div className="orb-container" aria-hidden="true">
            <div className="orb orb-1"></div><div className="orb orb-2"></div>
          </div>
          <div className="relative z-10 glass-card w-full max-w-sm p-8 rounded-3xl space-y-6 animate-scale-in">
            <div className="text-center space-y-3">
              <div className="flex justify-center"><HeaderLogo /></div>
              <div>
                <p className="section-pill mx-auto w-fit mb-2">API Setup</p>
                <h3 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white">Suno <span className="suno-badge-shimmer">Mastermind</span></h3>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {tr.apiSetup.description}
              </p>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
                {tr.apiSetup.freeTier}
              </p>
            </div>
            <div className="gradient-line"></div>
            <div className="space-y-3">
              <input
                type="password"
                className="w-full glass-input rounded-xl px-4 py-3 text-sm font-mono text-zinc-900 dark:text-white placeholder:text-zinc-400"
                placeholder="AIzaSy..."
                value={manualApiKey}
                onChange={(e) => setManualApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
              />
              <button onClick={handleSaveKey}
                className="btn-create w-full py-3.5 rounded-xl text-white font-black text-xs uppercase tracking-[0.2em] shadow-lg flex items-center justify-center gap-2">
                <i className="fas fa-rocket"></i> {tr.apiSetup.start}
              </button>
            </div>
            <p className="text-center text-[10px] text-zinc-400">
              {tr.apiSetup.getKeyText} <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-suno-primary hover:underline font-bold">{tr.apiSetup.getKeyLink}</a>
            </p>
          </div>
        </div>
      ) : (
    <LangContext.Provider value={langValue}>
    <div className="min-h-screen flex flex-col bg-suno-bg text-zinc-900 dark:text-zinc-100 transition-colors duration-300">

      {/* ─── ABOUT MODAL (NilsP) ─── */}
      {aboutOpen && createPortal(
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md flex items-center justify-center p-5" onClick={() => setAboutOpen(false)}>
          <div
            className="w-full max-w-lg glass-card rounded-3xl p-6 md:p-7 space-y-5 animate-scale-in overflow-y-auto custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl suno-gradient flex items-center justify-center text-white shadow-md">
                  <i className="fas fa-user text-sm"></i>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-suno-primary">{tr.about.label}</p>
                  <p className="text-sm font-black text-zinc-900 dark:text-zinc-100 leading-tight">{tr.about.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="glass-btn touch-target rounded-xl text-zinc-400 hover:text-red-400"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            <div className="space-y-3 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">
              <p>{tr.about.p1}</p>
              <p>{tr.about.p2}</p>
              <p>{tr.about.p3}</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <a
                href="https://suno.com/@cwzjtpwwwy"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-create flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-white font-black text-[11px] uppercase tracking-[0.18em]"
              >
                <i className="fas fa-headphones text-sm"></i>
                {tr.about.sunoProfileCta}
              </a>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="glass-btn flex-1 py-2.5 rounded-2xl text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-600 dark:text-zinc-300 hover:text-suno-primary"
              >
                {tr.about.close}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ─── HEADER ─── */}
      <header className="glass-header sticky top-0 z-[60] px-0 md:px-8">

        {/* ── Row 1: Logo + Links + Controls (auf Mobile horizontal scrollbar) ── */}
        <div className="overflow-x-auto overflow-y-hidden md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0">
          <div className="flex items-center justify-between py-2.5 min-w-max md:min-w-0 gap-3">

          {/* Left: Logo + Name */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveStep(WorkflowStep.DASHBOARD)}>
              <HeaderLogo />
              <div className="flex flex-col leading-none gap-[3px]">
                <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 dark:text-zinc-400">Suno</span>
                <span className="text-[15px] font-black uppercase tracking-tight suno-badge-shimmer leading-none">Mastermind</span>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden md:block w-px h-7 mx-1 bg-gradient-to-b from-transparent via-zinc-300 dark:via-zinc-600 to-transparent"></div>

            {/* External links – große Icons, auf Mobile sichtbar */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setAboutOpen(true)}
                className="glass-btn flex items-center gap-1.5 px-2.5 py-2 sm:px-3 sm:py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200 hover:text-suno-primary touch-target"
                title="Über NilsP"
              >
                <i className="fas fa-user text-suno-primary text-base sm:text-sm"></i>
                <span className="hidden sm:inline">NilsP</span>
              </button>
              <a href="https://suno.com/create" target="_blank" rel="noopener noreferrer"
                className="glass-btn flex items-center gap-1.5 px-2.5 py-2 sm:px-3 sm:py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200 hover:text-suno-primary touch-target"
                title="Suno Create">
                <i className="fas fa-headphones text-suno-primary text-base sm:text-sm"></i>
                <span className="hidden sm:inline">Suno</span>
              </a>
            </div>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* KI-Status */}
            <div className="relative" ref={quotaButtonRef}>
              <button
                type="button"
                onClick={() => setIsQuotaInfoOpen(prev => !prev)}
                className="glass-btn touch-target rounded-xl flex items-center justify-center gap-1.5 px-2.5 text-zinc-600 dark:text-zinc-300 hover:text-suno-primary"
                title={lang === 'de' ? 'KI-Status anzeigen' : 'Show AI status'}
                aria-expanded={isQuotaInfoOpen}
                aria-haspopup="dialog"
              >
                <GeminiMiniLogo />
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${quotaStatusUi.dot}`}></span>
              </button>
              {isQuotaInfoOpen && (
                <div
                  ref={quotaInfoRef}
                  className="hidden md:block absolute top-[calc(100%+8px)] right-0 w-[320px] rounded-2xl p-3.5 z-[120] shadow-2xl animate-scale-in border border-white/15 bg-zinc-950/95 backdrop-blur-xl"
                  role="dialog"
                  aria-label={lang === 'de' ? 'KI Status Details' : 'AI status details'}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <GeminiMiniLogo />
                      <span className="text-xs font-black uppercase tracking-wider text-zinc-100">
                        {lang === 'de' ? 'Gemini Status' : 'Gemini Status'}
                      </span>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${tokenUsage.quota.status === 'red' ? 'text-red-400' : tokenUsage.quota.status === 'yellow' ? 'text-amber-300' : 'text-emerald-300'}`}>
                      <span className={`inline-block w-2 h-2 rounded-full ${quotaStatusUi.dot}`}></span>
                      {quotaStatusUi.text}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-[11px] text-zinc-200">
                    <p>{quotaStatusUi.hint}</p>
                    <p>{lang === 'de' ? 'Heute verbraucht:' : 'Used today:'} <span className="font-semibold">{formatTokenCount(tokenUsage.todayTotal)}</span></p>
                    <p>{lang === 'de' ? 'Aktuelle Session:' : 'Current session:'} <span className="font-semibold">{formatTokenCount(tokenUsage.sessionTotal)}</span></p>
                    <p className="text-[10px] text-zinc-400 pt-1">
                      {lang === 'de'
                        ? 'Die Ampel bewertet die Wahrscheinlichkeit für weitere Generierung ohne Quota-Fehler. Rot: aktiver Cooldown nach 429. Nach Ablauf folgt 30 Sekunden Gelb (Stabilisierung), danach Grün, sofern kein neuer Fehler auftritt.'
                        : 'The traffic light estimates whether further generation is likely without quota errors. Red: active cooldown after 429. After cooldown, it stays Yellow for 30 seconds (stabilizing), then turns Green if no new error occurs.'}
                    </p>
                    <p className="text-[10px] text-zinc-400">
                      {lang === 'de'
                        ? 'Tokenwerte stammen aus Gemini usageMetadata (Input/Output/Gesamt), wenn vom Modell zurückgegeben.'
                        : 'Token values come from Gemini usageMetadata (input/output/total), when returned by the model.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {/* Language toggle */}
            <button onClick={toggleLang}
              className="glass-btn touch-target rounded-xl flex items-center gap-1 px-3 font-black text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 hover:text-suno-primary"
              title={lang === 'de' ? tr.header.langSwitchToEn : tr.header.langSwitchToDe}>
              <span className={lang === 'de' ? 'text-suno-primary' : ''}>DE</span>
              <span className="opacity-30">/</span>
              <span className={lang === 'en' ? 'text-suno-primary' : ''}>EN</span>
            </button>

            <button onClick={() => setIsKeySaved(false)} className="glass-btn touch-target rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-red-500" title={tr.header.apiKey}>
              <i className="fas fa-key text-sm"></i>
            </button>
            <div className="relative" ref={themeMenuRef}>
              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  setIsThemeMenuOpen((prev) => !prev);
                }}
                className="glass-btn touch-target rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-suno-primary touch-manipulation"
                style={{ touchAction: 'manipulation' }}
                aria-expanded={isThemeMenuOpen}
                aria-haspopup="true"
                title={tr.header.theme}
              >
                <i className="fas fa-palette text-sm"></i>
              </button>
              {isThemeMenuOpen && themeDropdownAnchor && createPortal(
                <div ref={themeDropdownRef} className="fixed w-52 glass-card rounded-2xl p-1.5 z-[70] animate-scale-in shadow-xl touch-manipulation" style={{ top: themeDropdownAnchor.top, right: themeDropdownAnchor.right, touchAction: 'manipulation' }}>
                  {themes.map((th) => (
                    <button key={th.id} type="button" onClick={() => { changeTheme(th.id); setIsThemeMenuOpen(false); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all touch-target ${activeTheme === th.id ? 'bg-suno-primary/10' : 'hover:bg-white/40 dark:hover:bg-white/8'}`}>
                      <div className={`w-7 h-7 rounded-lg ${th.color} flex items-center justify-center text-white text-[10px] shadow`}><i className={`fas ${th.icon}`}></i></div>
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">{th.label}</span>
                      {activeTheme === th.id && <i className="fas fa-check text-suno-primary text-[10px] ml-auto"></i>}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>
          </div>
          </div>
        </div>

        {/* Mobile: KI-Status Mini-Modal */}
        {isQuotaInfoOpen && createPortal(
          <div className="md:hidden fixed inset-0 z-[120] bg-black/75 backdrop-blur-md flex items-start justify-center p-4" onClick={() => setIsQuotaInfoOpen(false)}>
            <div
              className="mt-14 w-full max-w-sm rounded-2xl p-3.5 shadow-2xl animate-scale-in border border-white/15 bg-zinc-950/95 backdrop-blur-xl"
              role="dialog"
              aria-label={lang === 'de' ? 'KI Status Details' : 'AI status details'}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <GeminiMiniLogo />
                  <span className="text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-100">
                    {lang === 'de' ? 'Gemini Status' : 'Gemini Status'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsQuotaInfoOpen(false)}
                  className="glass-btn touch-target rounded-xl text-zinc-400 hover:text-red-400"
                  aria-label={lang === 'de' ? 'Schließen' : 'Close'}
                >
                  <i className="fas fa-times text-xs"></i>
                </button>
              </div>
              <div className="space-y-1.5 text-[11px] text-zinc-200">
                <p className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${quotaStatusUi.dot}`}></span>
                  <span className="font-semibold">{quotaStatusUi.text}</span>
                  <span>{quotaStatusUi.hint}</span>
                </p>
                <p>{lang === 'de' ? 'Heute verbraucht:' : 'Used today:'} <span className="font-semibold">{formatTokenCount(tokenUsage.todayTotal)}</span></p>
                <p>{lang === 'de' ? 'Aktuelle Session:' : 'Current session:'} <span className="font-semibold">{formatTokenCount(tokenUsage.sessionTotal)}</span></p>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 pt-1">
                  {lang === 'de'
                    ? 'Die Ampel bewertet die Wahrscheinlichkeit für weitere Generierung ohne Quota-Fehler. Rot: aktiver Cooldown nach 429. Nach Ablauf folgt 30 Sekunden Gelb (Stabilisierung), danach Grün, sofern kein neuer Fehler auftritt.'
                    : 'The traffic light estimates whether further generation is likely without quota errors. Red: active cooldown after 429. After cooldown, it stays Yellow for 30 seconds (stabilizing), then turns Green if no new error occurs.'}
                </p>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {lang === 'de'
                    ? 'Tokenwerte stammen aus Gemini usageMetadata (Input/Output/Gesamt), wenn vom Modell zurückgegeben.'
                    : 'Token values come from Gemini usageMetadata (input/output/total), when returned by the model.'}
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ── Row 2: Workflow Navigation ── */}
        <div className="border-t border-white/30 dark:border-white/6 py-1.5 px-4 md:px-0">
          <WorkflowNavigation
          activeStep={activeStep}
          setActiveStep={handleWorkflowStepChange}
          hasConcept={!!concept.topic?.trim()}
          lyricsTabEnabled={lyricsStepUnlocked}
          hasLyrics={!!lyrics || !!lyricsVariants}
          styleTabEnabled={styleStepUnlocked}
          hasStyle={!!styleData}
          hasLyricsVariants={!!lyricsVariants}
          coverTabEnabled={!!styleData && (coverStepUnlocked || activeStep === WorkflowStep.ARTWORK)}
        />
        </div>

      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 md:px-8 md:py-10">
        {isLoading && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md md:backdrop-blur-lg flex items-center justify-center z-[9999]">
            <div className="glass-card animate-scale-in text-center px-10 py-8 rounded-3xl min-w-[300px] max-w-[90vw] space-y-5">
              {/* Spinning disc icon */}
              <div className="flex items-center justify-center">
                <div className="w-12 h-12 rounded-full btn-create flex items-center justify-center shadow-lg">
                  <i className="fas fa-compact-disc text-white text-lg animate-spin" style={{animationDuration:'1.5s'}}></i>
                </div>
              </div>

              {/* Status label */}
              <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-800 dark:text-white">{loadingText}</p>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="w-full bg-white/10 dark:bg-white/8 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full rounded-full suno-gradient transition-all duration-700 ease-out"
                    style={{ width: `${loadingProgress}%` }}
                  ></div>
                </div>
                <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 text-right">{loadingProgress}%</p>
              </div>
            </div>
          </div>
        )}
        <Suspense fallback={<div className="min-h-[280px] flex items-center justify-center"><div className="w-10 h-10 rounded-full border-2 border-suno-primary border-t-transparent animate-spin" /></div>}>
        {activeStep === WorkflowStep.DASHBOARD && <DashboardDisplay history={history} onRecall={handleRecall} onDelete={handleDeleteFromHistory} onToggleFavorite={handleToggleFavorite} onStartNew={handleStartNew} />}
        {activeStep === WorkflowStep.CONCEPT && (
          <ConceptForm
            initialConcept={concept}
            onConceptContinue={handleConceptNext}
            onConceptChange={onConceptChange}
            showPipelineChoice={workflowChainComplete && (!!lyrics?.trim() || !!lyricsVariants || !!styleData)}
            nextStepSecondaryLabel={workflowChainComplete ? tr.workflow.conceptNextHintNav : tr.workflow.conceptNextHintFirst}
          />
        )}
        {activeStep === WorkflowStep.LYRICS && (
          <>
          {lyricsVariants ? (
            <LyricsCompareView
              variantA={lyricsVariants[0]}
              variantB={lyricsVariants[1]}
              concept={concept}
              isInstrumental={concept.isInstrumental}
              onConceptChange={onConceptChange}
              onUpdateVariantA={(v) => { setLyricsVariants(prev => prev ? [v, prev[1]] : null); setLyrics(v); }}
              onUpdateVariantB={(v) => { setLyricsVariants(prev => prev ? [prev[0], v] : null); }}
              onEnrichRegieA={(lyrics) => enrichRegie(lyrics, concept)}
              onEnrichRegieB={(lyrics) => enrichRegie(lyrics, concept)}
              onSimplifyA={(lyrics) => simplifyLyricsText(lyrics)}
              onSimplifyB={(lyrics) => simplifyLyricsText(lyrics)}
              onRegenerateA={async () => {
                setLoadingText(tr.loading.generatingLyrics);
                setIsLoading(true);
                try {
                  const conceptForA = concept;
                  const b = lyricsVariants?.[1] ?? '';
                  const result = await generateLyrics(conceptForA);
                  const cleaned = cleanAiText(result);
                  setLyricsVariants(prev => prev ? [cleaned, prev[1]] : null);
                  setLyrics(cleaned);
                  void refreshSongTitles({ primary: cleaned, secondary: b });
                } catch (e) { handleError(e); }
                finally { setIsLoading(false); }
              }}
              onRegenerateB={async () => {
                setLoadingText(tr.loading.generatingLyrics);
                setIsLoading(true);
                try {
                  const conceptForB: SongConcept = {
                    ...concept,
                    language: (concept.languageVariant2 && concept.languageVariant2.length > 0)
                      ? concept.languageVariant2
                      : concept.language,
                    vocals: (concept.vocalsVariant2 && concept.vocalsVariant2.length > 0)
                      ? concept.vocalsVariant2
                      : concept.vocals,
                  };
                  const a = lyricsVariants?.[0] ?? '';
                  const result = await generateLyrics(conceptForB);
                  const cleaned = cleanAiText(result);
                  setLyricsVariants(prev => prev ? [prev[0], cleaned] : null);
                  void refreshSongTitles({ concept: conceptForB, primary: a, secondary: cleaned });
                } catch (e) { handleError(e); }
                finally { setIsLoading(false); }
              }}
              onVariantSettingsChange={(variant) => {
                if (!styleVariants) return;
                setStyleRegenPendingForVariants(prev => prev.includes(variant) ? prev : [...prev, variant]);
              }}
              songTitleSuggestions={songTitleSuggestions}
              selectedSongTitle={selectedSongTitle}
              onSelectSongTitle={handleSelectSongTitle}
              songTitlesLoading={songTitlesLoading}
            />
          ) : (
            <LyricDisplay
              lyrics={lyrics}
              concept={concept}
              isInstrumental={concept.isInstrumental}
              onRegenerate={async () => {
                setLoadingText(tr.loading.generatingLyrics);
                setLoadingProgress(10);
                setIsLoading(true);
                setLyrics('');
                try {
                  setLoadingProgress(50);
                  const result = await generateLyrics(concept, { onChunk: (t) => setLyrics(t) });
                  const cleaned = cleanAiText(result);
                  setLyrics(cleaned);
                  void refreshSongTitles({ primary: cleaned, secondary: null });
                  setLoadingProgress(100);
                } catch (e) {
                  handleError(e);
                } finally {
                  setIsLoading(false);
                  setLoadingProgress(0);
                }
              }}
              onUpdate={onUpdateLyrics}
              onConceptChange={onConceptChange}
              onGenerateLyrics={handleGenerateLyrics}
              isGenerating={isLoading}
              songTitleSuggestions={songTitleSuggestions}
              selectedSongTitle={selectedSongTitle}
              onSelectSongTitle={handleSelectSongTitle}
              songTitlesLoading={songTitlesLoading}
            />
          )}
          {/* Weiter (zu Style) – Style erst hier generieren, gleiches Design wie Konzept */}
          {(() => {
            const canNext = !!(lyricsVariants?.length >= 2 || lyrics?.trim());
            const showLyricsChoice = workflowChainComplete && lyricsNextUsesAi && canNext;
            return (
              <div className="mt-20 md:mt-24 space-y-3">
              <div className={`relative z-0 ${canNext ? 'group' : ''}`}>
                {canNext && (
                  <div className="absolute -inset-0.5 suno-gradient rounded-3xl blur opacity-30 transition-opacity duration-500 group-hover:opacity-60" />
                )}
            <button
              type="button"
              onClick={handleLyricsNext}
              disabled={isLoading || !(lyricsVariants?.length >= 2 || lyrics?.trim())}
              className={`btn-create relative w-full py-5 md:py-6 rounded-3xl text-white font-black text-lg md:text-xl uppercase tracking-[0.2em] shadow-2xl flex items-center justify-center gap-3 disabled:opacity-45 disabled:cursor-not-allowed ${canNext ? '' : 'shadow-lg'}`}
            >
              <i className={`fas ${isLoading ? 'fa-spinner fa-spin' : lyricsNextUsesAi ? 'fa-wand-magic-sparkles' : 'fa-arrow-right'} text-lg`} />
              {tr.concept.nextBtn}
              <span className="absolute right-6 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium normal-case tracking-normal hidden md:block">
                {lyricsNextUsesAi ? tr.workflow.lyricsNextHintAi : tr.workflow.lyricsNextHintNav}
              </span>
            </button>
              </div>
            {showLyricsChoice && (
              <button
                type="button"
                onClick={handleLyricsNextNavOnly}
                disabled={isLoading}
                className="w-full glass-btn border border-white/20 dark:border-white/10 py-3.5 rounded-2xl text-sm font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200 flex items-center justify-center gap-2 disabled:opacity-45"
              >
                <i className="fas fa-arrow-right text-suno-primary"></i>
                {tr.workflow.skipAiToStyle}
              </button>
            )}
              </div>
            );
          })()}
          </>
        )}
        {activeStep === WorkflowStep.STYLE && (
          <>
          {styleData ? (
          styleVariants ? (
            <StyleDisplay
              data={styleData}
              dataVariants={styleVariants}
              onRegenerate={async () => {
                setLoadingText(tr.loading.generatingStyle);
                setIsLoading(true);
                try {
                  const conceptForA = concept;
                  const conceptForB: SongConcept = {
                    ...concept,
                    language: (concept.languageVariant2 && concept.languageVariant2.length > 0)
                      ? concept.languageVariant2
                      : concept.language,
                    vocals: (concept.vocalsVariant2 && concept.vocalsVariant2.length > 0)
                      ? concept.vocalsVariant2
                      : concept.vocals,
                  };
                  const [a, b] = await Promise.all([
                    generateStylePrompt(conceptForA, lang, lyricsVariants ? [lyricsVariants[0]] : undefined),
                    generateStylePrompt(conceptForB, lang, lyricsVariants ? [lyricsVariants[1]] : undefined),
                  ]);
                  setStyleVariants([mergeLyricsTitlesIntoStyle(a), mergeLyricsTitlesIntoStyle(b)]);
                  setStyleData(mergeLyricsTitlesIntoStyle(a));
                } catch (e) {
                  handleError(e);
                } finally {
                  setIsLoading(false);
                }
              }}
              onUpdatePrompt={(p) => setStyleData(prev => prev ? { ...prev, prompt: p } : null)}
              onUpdatePromptVariant={(i, p) => {
                setStyleVariants(prev => prev ? [
                  i === 0 ? { ...prev[0], prompt: p } : prev[0],
                  i === 1 ? { ...prev[1], prompt: p } : prev[1],
                ] : null);
                if (i === 0) setStyleData(prev => prev ? { ...prev, prompt: p } : null);
              }}
              onEnrichStyleA={(prompt) => enrichStylePrompt(prompt, concept)}
              onEnrichStyleB={(prompt) => enrichStylePrompt(prompt, concept)}
              onRegenerateA={async () => {
                const conceptForA = concept;
                const a = await generateStylePrompt(conceptForA, lang, lyricsVariants ? [lyricsVariants[0]] : undefined);
                setStyleVariants(prev => prev ? [mergeLyricsTitlesIntoStyle(a), prev[1]] : null);
                setStyleData(mergeLyricsTitlesIntoStyle(a));
              }}
              onRegenerateB={async () => {
                const conceptForB: SongConcept = {
                  ...concept,
                  language: (concept.languageVariant2 && concept.languageVariant2.length > 0)
                    ? concept.languageVariant2
                    : concept.language,
                  vocals: (concept.vocalsVariant2 && concept.vocalsVariant2.length > 0)
                    ? concept.vocalsVariant2
                    : concept.vocals,
                };
                const b = await generateStylePrompt(conceptForB, lang, lyricsVariants ? [lyricsVariants[1]] : undefined);
                setStyleVariants(prev => prev ? [prev[0], mergeLyricsTitlesIntoStyle(b)] : null);
              }}
            />
          ) : (
            <StyleDisplay data={styleData} onRegenerate={async () => { setLoadingText(tr.loading.generatingStyle); setLoadingProgress(10); setIsLoading(true); try { setLoadingProgress(50); const s = await generateStylePrompt(concept, lang, lyricsVariants ?? undefined); setStyleData(mergeLyricsTitlesIntoStyle(s)); setLoadingProgress(100); } catch(e) { handleError(e); } finally { setIsLoading(false); setLoadingProgress(0); } }} onUpdatePrompt={(prompt) => setStyleData(prev => prev ? { ...prev, prompt } : null)} onEnrichStyleA={(prompt) => enrichStylePrompt(prompt, concept)} />
          )
          ) : (
            <div className="glass-card rounded-2xl p-8 text-center max-w-md mx-auto">
              <p className="text-zinc-600 dark:text-zinc-400 text-sm mb-6">{tr.style.generateFirst}</p>
              <button type="button" onClick={handleLyricsNext} disabled={isLoading || !(lyricsVariants?.length >= 2 || lyrics?.trim())}
                className="btn-create px-6 py-3 rounded-2xl text-white font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed">
                <i className={`fas ${isLoading ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`} />
                {tr.style.generateNow}
              </button>
            </div>
          )
        }
          {styleData && (
            <div className="mt-20 md:mt-24 space-y-3">
            <div className="relative z-0 group">
              <div className="absolute -inset-0.5 suno-gradient rounded-3xl blur opacity-30 transition-opacity duration-500 group-hover:opacity-60" />
              <button
                type="button"
                onClick={() => void handleStyleStepNext()}
                disabled={isLoading}
                className="btn-create relative w-full py-5 md:py-6 rounded-3xl text-white font-black text-lg md:text-xl uppercase tracking-[0.2em] shadow-2xl flex items-center justify-center gap-3 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <i className={`fas ${isLoading ? 'fa-spinner fa-spin' : styleNextUsesAi ? 'fa-wand-magic-sparkles' : 'fa-arrow-right'} text-lg`} />
                {tr.concept.nextBtn}
                <span className="absolute right-6 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium normal-case tracking-normal hidden md:block">
                  {styleNextUsesAi ? tr.workflow.styleNextHintAi : tr.workflow.styleNextHintNav}
                </span>
              </button>
            </div>
            {workflowChainComplete && styleNextUsesAi && (
              <button
                type="button"
                onClick={handleStyleStepNextNavOnly}
                disabled={isLoading}
                className="w-full glass-btn border border-white/20 dark:border-white/10 py-3.5 rounded-2xl text-sm font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200 flex items-center justify-center gap-2 disabled:opacity-45"
              >
                <i className="fas fa-arrow-right text-suno-primary"></i>
                {tr.workflow.skipAiToCover}
              </button>
            )}
            </div>
          )}
          </>
        )}
        {activeStep === WorkflowStep.ARTWORK && styleData && (
          <ArtworkDisplay
            coverUrl={coverUrl}
            songDescription={styleData.songDescription}
            cleanCopyTitle={selectedSongTitle ?? styleData.selectedTitleSuggestion ?? ''}
            lyrics={lyrics}
            lyricsVariants={lyricsVariants}
            stylePrompt={styleData.prompt}
            styleVariants={styleVariants}
            coverError={coverError}
            onUpdateStory={(s) => setStyleData(prev => prev ? { ...prev, songDescription: s } : null)}
            onRegenerateCover={async (style) => {
              if (coverRequestInFlightRef.current) return;
              const cooldownLeft = getCoverCooldownRemainingMs();
              if (cooldownLeft > 0) {
                const sec = Math.ceil(cooldownLeft / 1000);
                const msg = `Cover-Generierung pausiert: bitte ${sec}s warten und erneut versuchen.`;
                setCoverError(msg);
                showToast(msg, 'info');
                return;
              }
              coverRequestInFlightRef.current = true;
              setLoadingText(tr.loading.generatingCover);
              setLoadingProgress(10);
              setIsLoading(true);
              setCoverError(null);
              try {
                setLoadingProgress(50);
                const genCover = await generateCoverArt(concept, style);
                setCoverUrl(genCover);
                if (styleData) {
                  const cSnap = buildCoverGenSnapshot(concept, lyrics, lyricsVariants, styleData, styleVariants);
                  setCoverGenSnap(cSnap);
                  coverGenSnapRef.current = cSnap;
                }
                setLoadingProgress(100);
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
              }
            }}
          />
        )}
      </Suspense>
      </main>
    </div>
    </LangContext.Provider>
      )}
      <Analytics />
    </ToastContext.Provider>
  );
};

export default App;
