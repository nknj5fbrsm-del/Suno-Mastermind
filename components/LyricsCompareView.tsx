import React, { useState, useEffect, useRef } from 'react';
import { SongConcept } from '../types';
import { useLang, useToast } from '../App';
import SearchableMultiInput from './SearchableMultiInput';
import Editor from 'react-simple-code-editor';

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
  const [isSunoToolsOpenA, setIsSunoToolsOpenA] = useState(false);
  const [isSunoToolsOpenB, setIsSunoToolsOpenB] = useState(false);
  const [activeFlowA, setActiveFlowA] = useState<'tight' | 'balanced' | 'breathing' | null>(null);
  const [activeFlowB, setActiveFlowB] = useState<'tight' | 'balanced' | 'breathing' | null>(null);
  const [activeStackA, setActiveStackA] = useState<'stackVerse' | 'stackChorus' | 'stackBridge' | null>(null);
  const [activeStackB, setActiveStackB] = useState<'stackVerse' | 'stackChorus' | 'stackBridge' | null>(null);
  const firstGeneratedARef = useRef(variantA);
  const firstGeneratedBRef = useRef(variantB);
  const seededRef = useRef(false);

  useEffect(() => {
    setEditA(variantA);
    if (!seededRef.current) firstGeneratedARef.current = variantA;
  }, [variantA]);
  useEffect(() => {
    setEditB(variantB);
    if (!seededRef.current) {
      firstGeneratedBRef.current = variantB;
      seededRef.current = true;
    }
  }, [variantB]);

  const resetVariantA = () => {
    const resetA = firstGeneratedARef.current;
    setEditA(resetA);
    onUpdateVariantA?.(resetA);
    setActiveFlowA(null);
    setActiveStackA(null);
  };

  const resetVariantB = () => {
    const resetB = firstGeneratedBRef.current;
    setEditB(resetB);
    onUpdateVariantB?.(resetB);
    setActiveFlowB(null);
    setActiveStackB(null);
  };

  const toolButtonClass = (active: boolean, tone: 'primary' | 'secondary') =>
    active
      ? `tag-pill text-white ${tone === 'primary' ? 'bg-suno-primary border-suno-primary' : 'bg-suno-secondary border-suno-secondary'}`
      : 'tag-pill text-zinc-600 dark:text-zinc-300';

  const isTagLine = (line: string) => /^\s*\[[^\]]+\]\s*$/.test(line.trim());

  const applyFlowProfile = (text: string, mode: 'tight' | 'balanced' | 'breathing') => {
    const normalized = text.replace(/\r\n/g, '\n');
    if (mode === 'tight') {
      // Keep structure, only remove excessive vertical whitespace.
      return normalized.replace(/\n{3,}/g, '\n\n');
    }
    if (mode === 'balanced') {
      // Normalize spacing and keep one visual breath after section tags.
      return normalized
        .replace(/\n{3,}/g, '\n\n')
        .replace(/(^|\n)(\[[^\]]+\])\n(?=\S)/g, '$1$2\n\n');
    }

    const lines = normalized.split('\n');
    const next: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const current = lines[i];
      const following = lines[i + 1];
      next.push(current);
      if (
        following !== undefined &&
        current.trim() &&
        following.trim() &&
        !isTagLine(current) &&
        !isTagLine(following)
      ) {
        next.push('');
      }
    }
    return next.join('\n').replace(/\n{3,}/g, '\n\n');
  };

  const highlightForTone = (text: string, tone: 'primary' | 'secondary') => {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const cls = tone === 'primary' ? 'cm-suno-tag-primary' : 'cm-suno-tag-secondary';
    return escaped.replace(/(\[[^\]]+\])/g, `<span class="${cls}">$1</span>`);
  };

  const calcFlowIssues = (text: string) => {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let hasInlineRegie = false;
    let lowTagDensity = false;
    let sectionTagCount = 0;
    let inSection = false;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (isTagLine(line)) {
        const sectionLike = /^\[(intro|verse|pre-chorus|chorus|bridge|solo|outro|end|break)/i.test(line);
        if (sectionLike) {
          if (inSection && sectionTagCount > 0 && sectionTagCount < 3) lowTagDensity = true;
          inSection = true;
          sectionTagCount = 0;
        } else if (inSection) {
          sectionTagCount += 1;
        }
      } else if (/\[[^\]]+\]/.test(line)) {
        hasInlineRegie = true;
      }
    }
    if (inSection && sectionTagCount > 0 && sectionTagCount < 3) lowTagDensity = true;
    return { hasInlineRegie, lowTagDensity };
  };

  const sectionStacks = [
    { id: 'stackVerse', tags: ['Verse · intimate lead vocal', 'Light room reverb', 'Subtle double-track', 'Warm tape saturation'] },
    { id: 'stackChorus', tags: ['Chorus · wide harmonies', 'Octave doubles', 'Cymbal lift', 'Longer plate reverb'] },
    { id: 'stackBridge', tags: ['Bridge · dynamic drop', 'Sparse drums', 'Filtered texture', 'Final crescendo'] },
  ] as const;

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

  const flowIssuesA = calcFlowIssues(editA);
  const flowIssuesB = calcFlowIssues(editB);

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
          <div className="glass-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setIsSunoToolsOpenA((v) => !v)}
                className="flex-1 flex items-center justify-between gap-3 group min-w-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-suno-primary/15 flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-sliders text-suno-primary text-sm"></i>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-suno-primary text-left">{tr.lyrics.sunoToolsTitle} · {tr.lyrics.variant1}</p>
                </div>
                <i className={`fas fa-chevron-down text-zinc-400 text-[11px] transition-transform flex-shrink-0 ${isSunoToolsOpenA ? 'rotate-180' : ''}`}></i>
              </button>
              <button
                type="button"
                onClick={resetVariantA}
                className="px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25"
              >
                {tr.lyrics.resetVariant} 1
              </button>
            </div>
            {isSunoToolsOpenA && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{tr.lyrics.flowControl}</span>
                  <button type="button" onClick={() => { setActiveFlowA('tight'); handleChangeA(applyFlowProfile(editA, 'tight')); }} className={toolButtonClass(activeFlowA === 'tight', 'primary')}>{tr.lyrics.flowTight}</button>
                  <button type="button" onClick={() => { setActiveFlowA('balanced'); handleChangeA(applyFlowProfile(editA, 'balanced')); }} className={toolButtonClass(activeFlowA === 'balanced', 'primary')}>{tr.lyrics.flowBalanced}</button>
                  <button type="button" onClick={() => { setActiveFlowA('breathing'); handleChangeA(applyFlowProfile(editA, 'breathing')); }} className={toolButtonClass(activeFlowA === 'breathing', 'primary')}>{tr.lyrics.flowBreathing}</button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{tr.lyrics.stackHelper}</span>
                  {sectionStacks.map(({ id, tags }) => {
                    const block = `\n${tags.map(tag => `[${tag}]`).join('\n')}\n`;
                    return (
                      <button key={`a-${id}`} type="button" onClick={() => { setActiveStackA(id); handleChangeA(editA + block); }} className={toolButtonClass(activeStackA === id, 'primary')}>
                        {tr.lyrics[id]}
                      </button>
                    );
                  })}
                </div>
                <div className="rounded-xl px-3 py-2 bg-white/40 dark:bg-white/5 border border-white/50 dark:border-white/10 space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-300">{tr.lyrics.qualityCheckTitle}</p>
                  {!flowIssuesA.lowTagDensity && !flowIssuesA.hasInlineRegie && <p className="text-[10px] text-emerald-600 dark:text-emerald-400">{tr.lyrics.qualityOk}</p>}
                  {flowIssuesA.lowTagDensity && <p className="text-[10px] text-amber-600 dark:text-amber-400">{tr.lyrics.qualityNeedsTagDensity}</p>}
                  {flowIssuesA.hasInlineRegie && <p className="text-[10px] text-amber-600 dark:text-amber-400">{tr.lyrics.qualityHasInlineRegie}</p>}
                </div>
              </>
            )}
          </div>
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
            <div className="flex-1 min-h-0 overflow-hidden rounded-xl bg-white/5 dark:bg-black/20 border border-white/10">
              <Editor
                value={editA}
                onValueChange={handleChangeA}
                highlight={(code) => highlightForTone(code, 'primary')}
                padding={16}
                style={{ height: '100%', overflow: 'auto' }}
                textareaId="lyrics-variant-1-editor"
                textareaClassName="lyrics-code-textarea"
                preClassName="lyrics-code-pre"
                className={`lyrics-code-wrapper ${loadingA !== null ? 'opacity-70 pointer-events-none' : ''}`}
              />
            </div>
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
          <div className="glass-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setIsSunoToolsOpenB((v) => !v)}
                className="flex-1 flex items-center justify-between gap-3 group min-w-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-suno-secondary/15 flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-sliders text-suno-secondary text-sm"></i>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-suno-secondary text-left">{tr.lyrics.sunoToolsTitle} · {tr.lyrics.variant2}</p>
                </div>
                <i className={`fas fa-chevron-down text-zinc-400 text-[11px] transition-transform flex-shrink-0 ${isSunoToolsOpenB ? 'rotate-180' : ''}`}></i>
              </button>
              <button
                type="button"
                onClick={resetVariantB}
                className="px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25"
              >
                {tr.lyrics.resetVariant} 2
              </button>
            </div>
            {isSunoToolsOpenB && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{tr.lyrics.flowControl}</span>
                  <button type="button" onClick={() => { setActiveFlowB('tight'); handleChangeB(applyFlowProfile(editB, 'tight')); }} className={toolButtonClass(activeFlowB === 'tight', 'secondary')}>{tr.lyrics.flowTight}</button>
                  <button type="button" onClick={() => { setActiveFlowB('balanced'); handleChangeB(applyFlowProfile(editB, 'balanced')); }} className={toolButtonClass(activeFlowB === 'balanced', 'secondary')}>{tr.lyrics.flowBalanced}</button>
                  <button type="button" onClick={() => { setActiveFlowB('breathing'); handleChangeB(applyFlowProfile(editB, 'breathing')); }} className={toolButtonClass(activeFlowB === 'breathing', 'secondary')}>{tr.lyrics.flowBreathing}</button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{tr.lyrics.stackHelper}</span>
                  {sectionStacks.map(({ id, tags }) => {
                    const block = `\n${tags.map(tag => `[${tag}]`).join('\n')}\n`;
                    return (
                      <button key={`b-${id}`} type="button" onClick={() => { setActiveStackB(id); handleChangeB(editB + block); }} className={toolButtonClass(activeStackB === id, 'secondary')}>
                        {tr.lyrics[id]}
                      </button>
                    );
                  })}
                </div>
                <div className="rounded-xl px-3 py-2 bg-white/40 dark:bg-white/5 border border-white/50 dark:border-white/10 space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-300">{tr.lyrics.qualityCheckTitle}</p>
                  {!flowIssuesB.lowTagDensity && !flowIssuesB.hasInlineRegie && <p className="text-[10px] text-emerald-600 dark:text-emerald-400">{tr.lyrics.qualityOk}</p>}
                  {flowIssuesB.lowTagDensity && <p className="text-[10px] text-amber-600 dark:text-amber-400">{tr.lyrics.qualityNeedsTagDensity}</p>}
                  {flowIssuesB.hasInlineRegie && <p className="text-[10px] text-amber-600 dark:text-amber-400">{tr.lyrics.qualityHasInlineRegie}</p>}
                </div>
              </>
            )}
          </div>
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
            <div className="flex-1 min-h-0 overflow-hidden rounded-xl bg-white/5 dark:bg-black/20 border border-white/10">
              <Editor
                value={editB}
                onValueChange={handleChangeB}
                highlight={(code) => highlightForTone(code, 'secondary')}
                padding={16}
                style={{ height: '100%', overflow: 'auto' }}
                textareaId="lyrics-variant-2-editor"
                textareaClassName="lyrics-code-textarea"
                preClassName="lyrics-code-pre"
                className={`lyrics-code-wrapper ${loadingB !== null ? 'opacity-70 pointer-events-none' : ''}`}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LyricsCompareView;
