import React, { useState, useEffect } from 'react';
import { SongConcept } from '../types';
import { useLang, useToast } from '../App';
import SearchableMultiInput from './SearchableMultiInput';

interface LyricsCompareViewProps {
  variantA: string;
  variantB: string;
  concept?: SongConcept;
  isInstrumental?: boolean;
  onConceptChange?: (patch: Partial<SongConcept>) => void;
  onUpdateVariantA?: (value: string) => void;
  onUpdateVariantB?: (value: string) => void;
  onEnrichRegieA?: (lyrics: string) => Promise<string>;
  onEnrichRegieB?: (lyrics: string) => Promise<string>;
  onSimplifyA?: (lyrics: string) => Promise<string>;
  onSimplifyB?: (lyrics: string) => Promise<string>;
  onRegenerateA?: () => Promise<void>;
  onRegenerateB?: () => Promise<void>;
  /** Wird aufgerufen, wenn Nutzer Sprache oder Gesangsstil für eine Variante ändert – App kann beim Wechsel ins Style-Tab den Style nachziehen. */
  onVariantSettingsChange?: (variant: 1 | 2) => void;
}

type LoadingAction = 'enrich' | 'simplify' | 'regen';

const LyricsCompareView: React.FC<LyricsCompareViewProps> = ({
  variantA, variantB,
  concept,
  isInstrumental = false,
  onConceptChange,
  onUpdateVariantA, onUpdateVariantB,
  onEnrichRegieA, onEnrichRegieB, onSimplifyA, onSimplifyB, onRegenerateA, onRegenerateB, onVariantSettingsChange,
}) => {
  const { tr } = useLang();
  const { showToast } = useToast();

  const toggleLanguage = (val: string) => {
    if (!concept || !onConceptChange) return;
    const cur = concept.language ?? [];
    const next = cur.includes(val) ? cur.filter(i => i !== val) : [...cur, val];
    onConceptChange({ language: next });
    onVariantSettingsChange?.(1);
  };
  const toggleVocals = (val: string) => {
    if (!concept || !onConceptChange) return;
    const cur = concept.vocals ?? [];
    const next = cur.includes(val) ? cur.filter(i => i !== val) : [...cur, val];
    onConceptChange({ vocals: next });
    onVariantSettingsChange?.(1);
  };
  const toggleLanguageV2 = (val: string) => {
    if (!concept || !onConceptChange) return;
    const base = concept.language ?? [];
    const cur = concept.languageVariant2 !== undefined ? concept.languageVariant2 : base;
    const next = cur.includes(val) ? cur.filter(i => i !== val) : [...cur, val];
    onConceptChange({ languageVariant2: next });
    onVariantSettingsChange?.(2);
  };
  const toggleVocalsV2 = (val: string) => {
    if (!concept || !onConceptChange) return;
    const base = concept.vocals ?? [];
    const cur = concept.vocalsVariant2 !== undefined ? concept.vocalsVariant2 : base;
    const next = cur.includes(val) ? cur.filter(i => i !== val) : [...cur, val];
    onConceptChange({ vocalsVariant2: next });
    onVariantSettingsChange?.(2);
  };
  const [editA, setEditA] = useState(variantA);
  const [editB, setEditB] = useState(variantB);
  const [loadingA, setLoadingA] = useState<LoadingAction | null>(null);
  const [loadingB, setLoadingB] = useState<LoadingAction | null>(null);

  useEffect(() => { setEditA(variantA); }, [variantA]);
  useEffect(() => { setEditB(variantB); }, [variantB]);

  const handleChangeA = (value: string) => {
    setEditA(value);
    onUpdateVariantA?.(value);
  };
  const handleChangeB = (value: string) => {
    setEditB(value);
    onUpdateVariantB?.(value);
  };

  const handleEnrichA = async () => {
    if (!onEnrichRegieA || loadingA) return;
    setLoadingA('enrich');
    try {
      const result = await onEnrichRegieA(editA);
      setEditA(result);
      onUpdateVariantA?.(result);
    } finally { setLoadingA(null); }
  };
  const handleEnrichB = async () => {
    if (!onEnrichRegieB || loadingB) return;
    setLoadingB('enrich');
    try {
      const result = await onEnrichRegieB(editB);
      setEditB(result);
      onUpdateVariantB?.(result);
    } finally { setLoadingB(null); }
  };
  const handleSimplifyA = async () => {
    if (isInstrumental) {
      showToast(tr.lyrics.simplifyInstrumentalHint, 'info');
      return;
    }
    if (!onSimplifyA || loadingA) return;
    setLoadingA('simplify');
    try {
      const result = await onSimplifyA(editA);
      setEditA(result);
      onUpdateVariantA?.(result);
    } finally { setLoadingA(null); }
  };
  const handleSimplifyB = async () => {
    if (isInstrumental) {
      showToast(tr.lyrics.simplifyInstrumentalHint, 'info');
      return;
    }
    if (!onSimplifyB || loadingB) return;
    setLoadingB('simplify');
    try {
      const result = await onSimplifyB(editB);
      setEditB(result);
      onUpdateVariantB?.(result);
    } finally { setLoadingB(null); }
  };
  const handleRegenA = async () => {
    if (!onRegenerateA || loadingA) return;
    setLoadingA('regen');
    try {
      await onRegenerateA();
    } finally { setLoadingA(null); }
  };
  const handleRegenB = async () => {
    if (!onRegenerateB || loadingB) return;
    setLoadingB('regen');
    try {
      await onRegenerateB();
    } finally { setLoadingB(null); }
  };

  return (
    <section className="space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-center gap-3">
        <p className="section-pill">{tr.lyrics.pill}</p>
        <div className="gradient-line flex-1"></div>
        <span className="text-[9px] font-black text-zinc-400 uppercase tracking-wider hidden sm:block">{tr.lyrics.twoVariantsTitle}</span>
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-suno-primary/10 dark:bg-suno-primary/15 border border-suno-primary/25">
        <i className="fas fa-info-circle text-suno-primary text-sm flex-shrink-0"></i>
        <p className="text-[11px] text-zinc-100 leading-relaxed">{tr.lyrics.twoVariantsSub}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Spalte 1: Auswahl Sprache & Stil Var 1, darunter Textvariante 1 */}
        <div className="flex flex-col gap-3">
          {!isInstrumental && concept && onConceptChange && (
            <div className="glass-card rounded-2xl p-4 relative z-10">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-600 dark:text-zinc-400">
                  {tr.concept.details}
                </p>
                <span className="text-[9px] font-black uppercase tracking-wider text-suno-primary">
                  {tr.lyrics.variant1}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <SearchableMultiInput
                  label={tr.concept.language}
                  icon="fa-globe"
                  options={tr.conceptOptions.languages}
                  selected={concept.language ?? []}
                  onToggle={toggleLanguage}
                  placeholder={tr.conceptOptions.languages.slice(0, 2).join(', ') + '…'}
                  disabled={isInstrumental}
                  accent="text-emerald-500"
                />
                <SearchableMultiInput
                  label={tr.concept.vocals}
                  icon="fa-microphone"
                  options={tr.conceptOptions.vocals}
                  selected={concept.vocals ?? []}
                  onToggle={toggleVocals}
                  placeholder={tr.conceptOptions.vocals.slice(0, 2).join(', ') + '…'}
                  disabled={isInstrumental}
                  accent="text-blue-500"
                />
              </div>
            </div>
          )}
          <div className="glass-card rounded-2xl p-5 flex flex-col min-h-[420px] max-h-[70vh]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-suno-primary">
                  {tr.lyrics.variant1}
                </span>
                <span className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                  <i className="fas fa-pen-to-square mr-1 opacity-70" />
                  {tr.lyrics.editableHint}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-full">
                <button type="button" onClick={handleEnrichA} disabled={loadingA !== null}
                  className="px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-suno-primary/15 border border-suno-primary/30 text-suno-primary hover:bg-suno-primary/25 disabled:opacity-50 flex items-center gap-1.5">
                  <i className={`fas ${loadingA === 'enrich' ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                  {tr.lyrics.enrichRegie}
                </button>
                <button type="button" onClick={handleSimplifyA} disabled={loadingA !== null}
                  className="px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-suno-primary/15 border border-suno-primary/30 text-suno-primary hover:bg-suno-primary/25 disabled:opacity-50 flex items-center gap-1.5">
                  <i className={`fas ${loadingA === 'simplify' ? 'fa-spinner fa-spin' : 'fa-compress'}`}></i>
                  {tr.lyrics.simplifyText}
                </button>
                <button type="button" onClick={handleRegenA} disabled={loadingA !== null} title={tr.lyrics.regenerate}
                  className="w-8 h-8 rounded-xl flex items-center justify-center glass-btn text-suno-primary hover:bg-suno-primary/20 disabled:opacity-50">
                  <i className={`fas ${loadingA === 'regen' ? 'fa-spinner fa-spin' : 'fa-dice'}`}></i>
                </button>
              </div>
            </div>
            <textarea
              value={editA}
              onChange={(e) => handleChangeA(e.target.value)}
              disabled={loadingA !== null}
              className="lyrics-editor flex-1 min-h-0 w-full overflow-auto rounded-xl bg-white/5 dark:bg-black/20 p-4 text-[13px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed custom-scrollbar border-0 resize-none focus:ring-2 focus:ring-suno-primary/30 outline-none disabled:opacity-70 cursor-text"
              placeholder="…"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Spalte 2: Auswahl Sprache & Stil Var 2, darunter Textvariante 2 */}
        <div className="flex flex-col gap-3">
          {!isInstrumental && concept && onConceptChange && (
            <div className="glass-card rounded-2xl p-4 relative z-10">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-600 dark:text-zinc-400">
                  {tr.concept.details}
                </p>
                <span className="text-[9px] font-black uppercase tracking-wider text-suno-secondary">
                  {tr.lyrics.variant2}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <SearchableMultiInput
                  label={tr.concept.language}
                  icon="fa-globe"
                  options={tr.conceptOptions.languages}
                  selected={concept.languageVariant2 !== undefined ? concept.languageVariant2 : (concept.language ?? [])}
                  onToggle={toggleLanguageV2}
                  placeholder={tr.conceptOptions.languages.slice(0, 2).join(', ') + '…'}
                  disabled={isInstrumental}
                  accent="text-emerald-500"
                />
                <SearchableMultiInput
                  label={tr.concept.vocals}
                  icon="fa-microphone"
                  options={tr.conceptOptions.vocals}
                  selected={concept.vocalsVariant2 !== undefined ? concept.vocalsVariant2 : (concept.vocals ?? [])}
                  onToggle={toggleVocalsV2}
                  placeholder={tr.conceptOptions.vocals.slice(0, 2).join(', ') + '…'}
                  disabled={isInstrumental}
                  accent="text-blue-500"
                />
              </div>
            </div>
          )}
          <div className="glass-card rounded-2xl p-5 flex flex-col min-h-[420px] max-h-[70vh]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-suno-secondary">
                  {tr.lyrics.variant2}
                </span>
                <span className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                  <i className="fas fa-pen-to-square mr-1 opacity-70" />
                  {tr.lyrics.editableHint}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-full">
                <button type="button" onClick={handleEnrichB} disabled={loadingB !== null}
                  className="px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-suno-secondary/15 border border-suno-secondary/30 text-suno-secondary hover:bg-suno-secondary/25 disabled:opacity-50 flex items-center gap-1.5">
                  <i className={`fas ${loadingB === 'enrich' ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                  {tr.lyrics.enrichRegie}
                </button>
                <button type="button" onClick={handleSimplifyB} disabled={loadingB !== null}
                  className="px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-suno-secondary/15 border border-suno-secondary/30 text-suno-secondary hover:bg-suno-secondary/25 disabled:opacity-50 flex items-center gap-1.5">
                  <i className={`fas ${loadingB === 'simplify' ? 'fa-spinner fa-spin' : 'fa-compress'}`}></i>
                  {tr.lyrics.simplifyText}
                </button>
                <button type="button" onClick={handleRegenB} disabled={loadingB !== null} title={tr.lyrics.regenerate}
                  className="w-8 h-8 rounded-xl flex items-center justify-center glass-btn text-suno-secondary hover:bg-suno-secondary/20 disabled:opacity-50">
                  <i className={`fas ${loadingB === 'regen' ? 'fa-spinner fa-spin' : 'fa-dice'}`}></i>
                </button>
              </div>
            </div>
            <textarea
              value={editB}
              onChange={(e) => handleChangeB(e.target.value)}
              disabled={loadingB !== null}
              className="lyrics-editor flex-1 min-h-0 w-full overflow-auto rounded-xl bg-white/5 dark:bg-black/20 p-4 text-[13px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed custom-scrollbar border-0 resize-none focus:ring-2 focus:ring-suno-secondary/30 outline-none disabled:opacity-70 cursor-text"
              placeholder="…"
              spellCheck={false}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default LyricsCompareView;
