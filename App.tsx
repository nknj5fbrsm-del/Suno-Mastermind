import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { WorkflowStep, SongConcept, GeneratedStyle, SongHistoryItem, ThemeName } from './types';
import { generateLyrics, generateStylePrompt, generateCoverArt, generateRandomTopic, analyzeTopic } from './services/geminiService';
import { loadHistoryFromDB, saveSongToDB, deleteSongFromDB } from './services/storageService';
import { t, Lang } from './translations';

// Components
import ConceptForm from './components/ConceptForm';
import LyricDisplay from './components/LyricDisplay';
import LyricsCompareView from './components/LyricsCompareView';
import StyleDisplay from './components/StyleDisplay';
import ArtworkDisplay from './components/ArtworkDisplay';
import DashboardDisplay from './components/DashboardDisplay';
import WorkflowNavigation from './components/WorkflowNavigation';

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
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [toast?.message, onDismiss]);
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
    <div className="absolute -inset-2 rounded-2xl suno-gradient opacity-[0.22] blur-xl pointer-events-none animate-logo-pulse"></div>
    {/* Logo box */}
    <div
      className="logo-glow relative w-11 h-11 rounded-[14px] flex items-center justify-center overflow-hidden transition-transform duration-300 hover:scale-[1.07] cursor-pointer"
      style={{ background: 'linear-gradient(150deg, #1a0830 0%, #0e0d22 55%, #080616 100%)' }}
    >
      {/* Inner gradient layer */}
      <div className="absolute inset-0 suno-gradient opacity-[0.22] pointer-events-none"></div>
      {/* Top-left sheen */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.13] via-transparent to-transparent pointer-events-none"></div>
      {/* Bottom-right shadow */}
      <div className="absolute inset-0 bg-gradient-to-tl from-black/30 via-transparent to-transparent pointer-events-none"></div>
      {/* Icon */}
      <i className="fas fa-compact-disc relative z-10 text-white text-sm" style={{ filter: 'drop-shadow(0 0 6px rgba(168,85,247,0.7))' }}></i>
    </div>
  </div>
);

const App: React.FC = () => {
  const [activeStep, setActiveStep] = useState<WorkflowStep>(WorkflowStep.DASHBOARD);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [activeTheme, setActiveTheme] = useState<ThemeName>('mastermind');
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const themeDropdownRef = useRef<HTMLDivElement>(null);
  const [themeDropdownAnchor, setThemeDropdownAnchor] = useState<{ top: number; right: number } | null>(null);
  
  // BYOK State: Wir nutzen jetzt einen String statt nur eines Booleans
  const [manualApiKey, setManualApiKey] = useState<string>(localStorage.getItem('gemini_api_key') || '');
  const [isKeySaved, setIsKeySaved] = useState<boolean>(!!localStorage.getItem('gemini_api_key'));

  const [concept, setConcept] = useState<SongConcept>({
    topic: '', genre: [], mood: [], tempo: [], language: [], isInstrumental: false, vocals: [], instrumentation: [], excludedStyles: []
  });
  const [lyrics, setLyrics] = useState<string>('');
  /** Zwei Lyrics-Varianten zum Vergleichen (Create-Flow); nach Wahl wird eine übernommen. */
  const [lyricsVariants, setLyricsVariants] = useState<[string, string] | null>(null);
  /** Nach Wahl einer Lyrics-Variante: Cover generieren und Song speichern. */
  const [pendingCreateAfterLyricsPick, setPendingCreateAfterLyricsPick] = useState<{ concept: SongConcept; styleData: GeneratedStyle } | null>(null);
  const [styleData, setStyleData] = useState<GeneratedStyle | null>(null);
  const [coverUrl, setCoverUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>('Generating Magic...');
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [history, setHistory] = useState<SongHistoryItem[]>([]);
  const [lang, setLang] = useState<Lang>((localStorage.getItem('suno-lang') as Lang) || 'de');
  const [toast, setToast] = useState<ToastState>(null);
  const showToast = React.useCallback((message: string, type: ToastType = 'info') => setToast({ message, type }), []);
  const tr = t[lang];

  useEffect(() => {
    // Theme Initialisierung
    const savedTheme = (localStorage.getItem('suno-theme') as ThemeName) || 'mastermind';
    const savedMode = localStorage.getItem('suno-mode') || 'dark';
    setActiveTheme(savedTheme);
    setIsDarkMode(savedMode === 'dark');
    document.documentElement.className = `${savedMode === 'dark' ? 'dark' : ''} theme-${savedTheme}`;
    
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
      if (!inMenu && !inDropdown) setIsThemeMenuOpen(false);
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

  const handleError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? 'Unbekannter Fehler');
    if (message.includes("API key not valid") || message.includes("403") || message.includes("401")) {
      setIsKeySaved(false);
      showToast(tr.errors.apiKeyInvalid, 'error');
    } else {
      showToast(tr.errors.aiErrorPrefix + message, 'error');
    }
  };

  const toggleMode = () => {
    setIsDarkMode(prev => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('suno-mode', next ? 'dark' : 'light');
      return next;
    });
  };

  const changeTheme = (theme: ThemeName) => {
    setActiveTheme(theme);
    document.documentElement.className = `${isDarkMode ? 'dark' : ''} theme-${theme}`;
    localStorage.setItem('suno-theme', theme);
    setIsThemeMenuOpen(false);
  };

  const handleStartNew = () => {
    setConcept({ topic: '', genre: [], mood: [], tempo: [], language: [], isInstrumental: false, vocals: [], instrumentation: [], excludedStyles: [] });
    setLyrics(''); setLyricsVariants(null); setPendingCreateAfterLyricsPick(null); setStyleData(null); setCoverUrl('');
    setActiveStep(WorkflowStep.CONCEPT);
  };

  // Helper zum Bereinigen von %20 und anderen Encodings
  const cleanAiText = (text: string) => {
    try {
      return decodeURIComponent(text.replace(/\+/g, ' '));
    } catch (e) {
      return text;
    }
  };

  const handleConceptSubmit = async (inputConcept: SongConcept) => {
    if (!manualApiKey) {
      showToast(tr.errors.noApiKey, 'error');
      setIsKeySaved(false);
      return;
    }

    setIsLoading(true);
    setLoadingProgress(5);
    setLoadingText(tr.loading.analyzingConcept);
    try {
      let finalConcept = { ...inputConcept };
      if (!finalConcept.topic.trim()) finalConcept.topic = await generateRandomTopic();
      setLoadingProgress(15);
      
      const suggestions = await analyzeTopic(finalConcept.topic, finalConcept.isInstrumental);
      finalConcept = {
        ...finalConcept,
        genre: finalConcept.genre.length ? finalConcept.genre : (suggestions.genre || []),
        mood: finalConcept.mood.length ? finalConcept.mood : (suggestions.mood || []),
        instrumentation: (finalConcept.instrumentation?.length ? finalConcept.instrumentation : (suggestions.instrumentation || [])) as string[],
        tempo: finalConcept.tempo.length ? finalConcept.tempo : (suggestions.tempo || []),
        vocals: finalConcept.isInstrumental ? [] : (finalConcept.vocals.length ? finalConcept.vocals : (suggestions.vocals || [])),
        language: finalConcept.isInstrumental ? [] : (finalConcept.language.length ? finalConcept.language : (suggestions.language || []))
      };
      setConcept(finalConcept);
      setLoadingProgress(30);

      setLoadingText(tr.loading.generatingLyrics);
      setLoadingProgress(35);
      // Zwei Lyrics-Varianten + Style parallel; dann Vergleich anzeigen, Cover erst nach Wahl
      const [genLyricsA, genLyricsB, genStyle] = await Promise.all([
        generateLyrics(finalConcept),
        generateLyrics(finalConcept),
        generateStylePrompt(finalConcept, lang)
      ]);
      setStyleData(genStyle);
      setLyricsVariants([cleanAiText(genLyricsA), cleanAiText(genLyricsB)]);
      setLyrics("");
      setPendingCreateAfterLyricsPick({ concept: finalConcept, styleData: genStyle });
      setLoadingProgress(70);
      setActiveStep(WorkflowStep.LYRICS);
    } catch (error) { 
      handleError(error); 
    } finally { 
      setIsLoading(false);
      setLoadingProgress(0);
    }
  };

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

  return (
    <ToastContext.Provider value={{ showToast }}>
      <ToastBar toast={toast} onDismiss={() => setToast(null)} />
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
    <LangContext.Provider value={{ lang, tr }}>
    <div className="min-h-screen flex flex-col bg-suno-bg text-zinc-900 dark:text-zinc-100 transition-colors duration-300">

      {/* ─── HEADER ─── */}
      <header className="glass-header sticky top-0 z-[60] px-0 md:px-8">

        {/* ── Row 1: Logo + Links + Controls (auf Mobile horizontal scrollbar) ── */}
        <div className="overflow-x-auto overflow-y-hidden md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0">
          <div className="flex items-center justify-between py-2.5 min-w-max md:min-w-0">

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
              <a href="https://suno.com/@cwzjtpwwwy" target="_blank" rel="noopener noreferrer"
                className="glass-btn flex items-center gap-1.5 px-2.5 py-2 sm:px-3 sm:py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 hover:text-suno-primary touch-target"
                title="Mein Suno-Profil">
                <i className="fas fa-user text-suno-primary text-base sm:text-sm"></i>
                <span className="hidden sm:inline">NilsP</span>
              </a>
              <a href="https://suno.com/create" target="_blank" rel="noopener noreferrer"
                className="glass-btn flex items-center gap-1.5 px-2.5 py-2 sm:px-3 sm:py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 hover:text-suno-primary touch-target"
                title="Suno Create">
                <i className="fas fa-headphones text-suno-primary text-base sm:text-sm"></i>
                <span className="hidden sm:inline">Suno</span>
              </a>
            </div>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-1 flex-shrink-0">
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
            {/* Dark/Light toggle – sun = warm gold, moon = cool indigo */}
            <button onClick={toggleMode} className="glass-btn touch-target rounded-xl" title={isDarkMode ? tr.header.lightMode : tr.header.darkMode}>
              {isDarkMode
                ? <i className="fas fa-sun text-base" style={{color:'#f59e0b', filter:'drop-shadow(0 0 6px rgba(245,158,11,0.6))'}}></i>
                : <i className="fas fa-moon text-base" style={{color:'#6366f1', filter:'drop-shadow(0 0 5px rgba(99,102,241,0.5))'}}></i>
              }
            </button>
          </div>
          </div>
        </div>

        {/* ── Row 2: Workflow Navigation ── */}
        <div className="border-t border-white/30 dark:border-white/6 py-1.5 px-4 md:px-0">
          <WorkflowNavigation activeStep={activeStep} setActiveStep={setActiveStep} hasLyrics={!!lyrics} hasStyle={!!styleData} isComparingLyrics={!!lyricsVariants} />
        </div>

      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 md:px-8 md:py-10">
        {isLoading && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-lg flex items-center justify-center z-[9999]">
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
        {activeStep === WorkflowStep.DASHBOARD && <DashboardDisplay history={history} onRecall={(item) => { setConcept(item.concept); setLyrics(item.lyrics); setLyricsVariants(null); setPendingCreateAfterLyricsPick(null); setStyleData(item.styleData); setCoverUrl(item.coverUrl); setActiveStep(WorkflowStep.LYRICS); }} onDelete={async (id) => { await deleteSongFromDB(id); setHistory(prev => prev.filter(h => h.id !== id)); }} onStartNew={handleStartNew} />}
        {activeStep === WorkflowStep.CONCEPT && <ConceptForm initialConcept={concept} onSubmit={handleConceptSubmit} />}
        {activeStep === WorkflowStep.LYRICS && (
          lyricsVariants ? (
            <LyricsCompareView
              variantA={lyricsVariants[0]}
              variantB={lyricsVariants[1]}
              onChoose={async (index) => {
                const chosen = lyricsVariants[index];
                setLyrics(chosen);
                setLyricsVariants(null);
                const pending = pendingCreateAfterLyricsPick;
                setPendingCreateAfterLyricsPick(null);
                if (pending) {
                  setIsLoading(true);
                  setLoadingText(tr.loading.generatingCover);
                  setLoadingProgress(50);
                  try {
                    const genCover = await generateCoverArt(pending.concept);
                    setCoverUrl(genCover);
                    const item = { id: crypto.randomUUID(), timestamp: Date.now(), concept: pending.concept, lyrics: chosen, styleData: pending.styleData, coverUrl: genCover };
                    await saveSongToDB(item);
                    setHistory(prev => [item, ...prev]);
                  } catch (e) { handleError(e); } finally { setIsLoading(false); setLoadingProgress(0); }
                  setActiveStep(WorkflowStep.STYLE);
                }
              }}
            />
          ) : (
            <LyricDisplay lyrics={lyrics} concept={concept} isInstrumental={concept.isInstrumental} onRegenerate={async () => { setLoadingText(tr.loading.generatingLyrics); setLoadingProgress(10); setIsLoading(true); setLyrics(""); try { setLoadingProgress(50); const result = await generateLyrics(concept, { onChunk: (t) => setLyrics(t) }); setLyrics(cleanAiText(result)); setLoadingProgress(100); } catch(e) { handleError(e); } finally { setIsLoading(false); setLoadingProgress(0); } }} onUpdate={(l) => setLyrics(l)} />
          )
        )}
        {activeStep === WorkflowStep.STYLE && styleData && <StyleDisplay data={styleData} onRegenerate={async () => { setLoadingText(tr.loading.generatingStyle); setLoadingProgress(10); setIsLoading(true); try { setLoadingProgress(50); setStyleData(await generateStylePrompt(concept, lang)); setLoadingProgress(100); } catch(e) { handleError(e); } finally { setIsLoading(false); setLoadingProgress(0); } }} onUpdatePrompt={(prompt) => setStyleData(prev => prev ? { ...prev, prompt } : null)} />}
        {activeStep === WorkflowStep.ARTWORK && styleData && <ArtworkDisplay coverUrl={coverUrl} songDescription={styleData.songDescription} lyrics={lyrics} stylePrompt={styleData.prompt} onUpdateStory={(s) => setStyleData(prev => prev ? { ...prev, songDescription: s } : null)} onRegenerateCover={async (style) => { setLoadingText(tr.loading.generatingCover); setLoadingProgress(10); setIsLoading(true); try { setLoadingProgress(50); setCoverUrl(await generateCoverArt(concept, style)); setLoadingProgress(100); } catch(e) { handleError(e); } finally { setIsLoading(false); setLoadingProgress(0); } }} />}
      </main>
    </div>
    </LangContext.Provider>
      )}
    </ToastContext.Provider>
  );
};

export default App;
