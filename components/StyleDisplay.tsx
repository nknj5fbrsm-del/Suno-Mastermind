
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GeneratedStyle } from '../types';
import { useLang } from '../App';
import StyleDictionary from './StyleDictionary';

/** Inhalt für das Style-Info-Modal (Referenzen, Wirkung, Warum Empfehlung) – Hell- und Dunkelmodus. */
const StyleInfoModalContent: React.FC<{ data: GeneratedStyle }> = ({ data }) => {
  const { tr } = useLang();
  return (
    <div className="space-y-4 p-1 text-zinc-800 dark:text-zinc-200">
      {data.similarArtists && (
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
            <i className="fas fa-users text-suno-secondary text-[7px]"></i> {tr.style.references}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.similarArtists.split(',').map((a, i) => (
              <span key={i} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-suno-secondary/15 dark:bg-suno-secondary/25 text-suno-secondary border border-suno-secondary/25 dark:border-suno-secondary/40">{a.trim()}</span>
            ))}
          </div>
        </div>
      )}
      {data.promptEffect && (
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400 mb-1 flex items-center gap-1">
            <i className="fas fa-wave-square text-suno-primary text-[7px]"></i> {tr.style.effect}
          </p>
          <p className="text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed italic">{data.promptEffect}</p>
        </div>
      )}
      {data.recommendationReason && (
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400 mb-1 flex items-center gap-1">
            <i className="fas fa-lightbulb text-suno-primary text-[7px]"></i> {tr.style.whyRec}
          </p>
          <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{data.recommendationReason}</p>
        </div>
      )}
    </div>
  );
};

interface StyleDisplayProps {
  data: GeneratedStyle;
  dataVariants?: [GeneratedStyle, GeneratedStyle];
  onRegenerate: () => void;
  onUpdatePrompt?: (prompt: string) => void;
  onUpdatePromptVariant?: (index: 0 | 1, prompt: string) => void;
  onEnrichStyleA?: (prompt: string) => Promise<string>;
  onEnrichStyleB?: (prompt: string) => Promise<string>;
  onRegenerateA?: () => Promise<void>;
  onRegenerateB?: () => Promise<void>;
}

const SOFT_LIMIT = 200;
const HARD_LIMIT = 1000;

const SAFE_MIN = 15;
const SAFE_MAX = 85;
const normalize = (val: any) => {
  const n = Number(val);
  if (isNaN(n)) return 50;
  if (n > 0 && n <= 1) return Math.round(n * 100);
  return Math.min(100, Math.max(0, Math.round(n)));
};
const clampSafe = (v: number) => Math.min(SAFE_MAX, Math.max(SAFE_MIN, v));
const clampMood = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
const moodNeutral = (d: GeneratedStyle) => clampMood(d.moodNeutralValue ?? 50);
const normalizePromptBase = (text: string) => text.trim().replace(/[,\s]+$/, '');
const moodStrengthWord = (distance: number) => {
  if (distance < 12) return 'slightly';
  if (distance < 26) return 'moderately';
  if (distance < 40) return 'strongly';
  return 'extremely';
};
const applyMoodToPrompt = (basePrompt: string, style: GeneratedStyle, sliderValue: number) => {
  const base = normalizePromptBase(basePrompt);
  const neutral = moodNeutral(style);
  if (!base) return '';
  if (sliderValue === neutral) return base;
  const direction = sliderValue < neutral ? 'left' : 'right';
  const instruction = direction === 'left'
    ? (style.moodLeftInstruction || 'more melodic and harmonic')
    : (style.moodRightInstruction || 'more experimental and unconventional');
  const distance = Math.abs(sliderValue - neutral);
  const strength = moodStrengthWord(distance);
  return `${base}, ${strength} ${instruction}`;
};

const ValuePills: React.FC<{ weirdness: number; styleInfluence: number }> = ({ weirdness, styleInfluence }) => {
  const { tr } = useLang();
  return (
    <div className="flex flex-wrap gap-2">
      <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-suno-primary/10 dark:bg-suno-primary/15 border border-suno-primary/25">
        <i className="fas fa-brain text-suno-primary text-sm"></i>
        <span className="text-[13px] font-black text-suno-primary tabular-nums">{weirdness ?? 0}%</span>
        <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">{tr.style.weirdness}</span>
      </div>
      <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-suno-secondary/10 dark:bg-suno-secondary/15 border border-suno-secondary/25">
        <i className="fas fa-dna text-suno-secondary text-sm"></i>
        <span className="text-[13px] font-black text-suno-secondary tabular-nums">{styleInfluence ?? 0}%</span>
        <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">{tr.style.influence}</span>
      </div>
    </div>
  );
};

type StyleCardLoading = 'enrich' | 'regen' | null;

const StyleCard: React.FC<{
  data: GeneratedStyle;
  editablePrompt: string;
  onPromptChange: (value: string) => void;
  moodValue: number;
  onMoodChange: (value: number) => void;
  onMoodCommit?: () => void;
  showMoodResetHint?: boolean;
  variantLabel?: string;
  variantColor?: string;
  accentClass?: string;
  loading?: StyleCardLoading;
  onEnrich?: () => void;
  onRegenerate?: () => void;
}> = ({ data, editablePrompt, onPromptChange, moodValue, onMoodChange, onMoodCommit, showMoodResetHint, variantLabel, variantColor, accentClass, loading, onEnrich, onRegenerate }) => {
  const { tr } = useLang();
  const [styleInfoModalOpen, setStyleInfoModalOpen] = useState(false);
  const weirdness = clampSafe(normalize(data.weirdness));
  const styleInfluence = clampSafe(normalize(data.styleInfluence));
  const charCount = editablePrompt.length;
  const isOverSoft = charCount > SOFT_LIMIT;
  const isOverHard = charCount > HARD_LIMIT;
  const accent = accentClass || 'suno-primary';
  const hasStyleInfo = data.similarArtists || data.promptEffect || data.recommendationReason;

  return (
    <div className="glass-card rounded-2xl p-5 flex flex-col min-h-[420px] max-h-[70vh]">
      {variantLabel && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <span className={`text-[10px] font-black uppercase tracking-wider ${variantColor || 'text-suno-primary'}`}>
            {variantLabel}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onEnrich && (
              <button type="button" onClick={onEnrich} disabled={loading !== null}
                className={`px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-${accent}/15 border border-${accent}/30 text-${accent} hover:bg-${accent}/25 disabled:opacity-50 flex items-center gap-1.5`}>
                <i className={`fas ${loading === 'enrich' ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                {tr.style.enrichStyle}
              </button>
            )}
            {onRegenerate && (
              <button type="button" onClick={onRegenerate} disabled={loading !== null} title={tr.style.regenerate}
                className={`w-8 h-8 rounded-xl flex items-center justify-center glass-btn text-${accent} hover:bg-${accent}/20 disabled:opacity-50`}>
                <i className={`fas ${loading === 'regen' ? 'fa-spinner fa-spin' : 'fa-dice'}`}></i>
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 flex flex-col min-h-0 space-y-4">
        <div className="relative flex-shrink-0">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
            <i className={`fas fa-pen-to-square text-${accent} text-[11px]`}></i>
            <span>{tr.lyrics.editableHint}</span>
          </div>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-suno-primary flex items-center gap-1.5 mb-1.5">
            <i className="fas fa-terminal text-[8px]"></i> Suno V5 Input
          </p>
          <div className="relative">
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-full transition-colors ${isOverHard ? 'bg-red-500' : isOverSoft ? 'bg-amber-500' : `bg-${accent}`}`}></div>
            <textarea
              className={`w-full bg-white/5 dark:bg-black/20 rounded-xl pl-4 pr-2 py-2 text-[13px] font-mono leading-relaxed outline-none resize-none h-24 transition-colors disabled:opacity-70 cursor-text ${
                isOverHard ? 'text-red-500' : 'text-zinc-900 dark:text-white'
              }`}
              value={editablePrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              disabled={loading !== null}
              spellCheck={false}
              style={{ fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace' }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className={`text-[10px] font-bold ${isOverHard ? 'text-red-500' : isOverSoft ? 'text-amber-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
              {charCount} {tr.style.charLimit}
            </span>
            {isOverHard && <span className="text-[10px] font-black text-red-500">{tr.style.tooLong}</span>}
          </div>
          <div className="mt-3 rounded-xl border border-suno-primary/20 bg-suno-primary/5 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-black uppercase tracking-[0.14em] text-suno-primary">{tr.style.moodFaderTitle}</p>
              <span className="text-[10px] font-black text-zinc-400">{moodValue}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-bold text-zinc-400">
              <span className="truncate">{data.moodLeftLabel || 'Melodic'}</span>
              <span className="truncate text-right">{data.moodRightLabel || 'Experimental'}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={moodValue}
              onChange={(e) => onMoodChange(Number(e.target.value))}
              onMouseUp={onMoodCommit}
              onTouchEnd={onMoodCommit}
              onKeyUp={onMoodCommit}
              className="mt-2 w-full accent-suno-primary cursor-pointer"
            />
            <p className="mt-1 text-[9px] font-bold text-zinc-500 dark:text-zinc-400">{tr.style.moodFaderNeutral}</p>
            {showMoodResetHint && (
              <p className="mt-1 text-[9px] font-bold text-amber-400">{tr.style.moodFaderResetHint}</p>
            )}
          </div>
        </div>
        <div className="flex-shrink-0">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-suno-secondary flex items-center gap-1.5 mb-2">
            <i className="fas fa-chart-simple text-[8px]"></i> {tr.style.algorithm}
          </p>
          <ValuePills weirdness={weirdness} styleInfluence={styleInfluence} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {hasStyleInfo && (
            <>
              <button
                type="button"
                onClick={() => setStyleInfoModalOpen(true)}
                className="flex items-center gap-1.5 mb-2 flex-shrink-0 w-fit rounded-xl px-3 py-2 text-[9px] font-black uppercase tracking-[0.18em] text-suno-secondary border border-suno-secondary/25 bg-suno-secondary/5 hover:bg-suno-secondary/15 transition-colors"
              >
                <i className="fas fa-circle-info text-suno-secondary text-[8px]"></i> {tr.style.styleInfo}
              </button>
              {styleInfoModalOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30 dark:bg-black/50 backdrop-blur-sm" onClick={() => setStyleInfoModalOpen(false)}>
                  <div
                    className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl overflow-hidden animate-scale-in text-zinc-900 dark:text-zinc-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-800/50">
                      <span className="text-[10px] font-black uppercase tracking-wider text-suno-secondary flex items-center gap-2">
                        <i className="fas fa-circle-info text-suno-secondary"></i> {tr.style.styleInfo}
                      </span>
                      <button type="button" onClick={() => setStyleInfoModalOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                        <i className="fas fa-times text-sm"></i>
                      </button>
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto p-4 custom-scrollbar bg-white dark:bg-zinc-900">
                      <StyleInfoModalContent data={data} />
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const StyleDisplay: React.FC<StyleDisplayProps> = ({
  data, dataVariants, onRegenerate, onUpdatePrompt, onUpdatePromptVariant,
  onEnrichStyleA, onEnrichStyleB, onRegenerateA, onRegenerateB,
}) => {
  const { tr } = useLang();
  const [basePrompt, setBasePrompt] = useState(data.prompt);
  const [editablePrompt, setEditablePrompt] = useState(data.prompt);
  const [baseVariant0, setBaseVariant0] = useState(dataVariants?.[0]?.prompt ?? data.prompt);
  const [editableVariant0, setEditableVariant0] = useState(dataVariants?.[0]?.prompt ?? data.prompt);
  const [baseVariant1, setBaseVariant1] = useState(dataVariants?.[1]?.prompt ?? data.prompt);
  const [editableVariant1, setEditableVariant1] = useState(dataVariants?.[1]?.prompt ?? data.prompt);
  const [moodSingle, setMoodSingle] = useState(moodNeutral(data));
  const [moodA, setMoodA] = useState(moodNeutral(dataVariants?.[0] ?? data));
  const [moodB, setMoodB] = useState(moodNeutral(dataVariants?.[1] ?? data));
  const [showMoodResetHintSingle, setShowMoodResetHintSingle] = useState(false);
  const [showMoodResetHintA, setShowMoodResetHintA] = useState(false);
  const [showMoodResetHintB, setShowMoodResetHintB] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [insertTarget, setInsertTarget] = useState<0 | 1>(0);
  const [loadingA, setLoadingA] = useState<StyleCardLoading>(null);
  const [loadingB, setLoadingB] = useState<StyleCardLoading>(null);
  const [loadingSingle, setLoadingSingle] = useState<StyleCardLoading>(null);
  const [styleInfoModalOpen, setStyleInfoModalOpen] = useState(false);

  const appendToPrompt = (text: string, target: 'single' | 0 | 1) => {
    const prepare = (p: string) => {
      let base = p.trim();
      if (base.endsWith('.')) base = base.slice(0, -1).trim();
      return base ? base + ', ' + text : text;
    };
    if (target === 'single') {
      const next = prepare(editablePrompt);
      setBasePrompt(next);
      setEditablePrompt(next);
      setMoodSingle(moodNeutral(data));
      setShowMoodResetHintSingle(false);
      onUpdatePrompt?.(next);
    } else {
      const current = target === 0 ? editableVariant0 : editableVariant1;
      const next = prepare(current);
      if (target === 0) {
        setBaseVariant0(next);
        setEditableVariant0(next);
        setMoodA(moodNeutral(dataVariants?.[0] ?? data));
        setShowMoodResetHintA(false);
        onUpdatePromptVariant?.(0, next);
      } else {
        setBaseVariant1(next);
        setEditableVariant1(next);
        setMoodB(moodNeutral(dataVariants?.[1] ?? data));
        setShowMoodResetHintB(false);
        onUpdatePromptVariant?.(1, next);
      }
    }
  };

  useEffect(() => {
    const nextBase = data.prompt;
    // Wenn Parent nur den aktuell angezeigten (Slider-)Text spiegelt, nichts resetten.
    if (nextBase === editablePrompt) return;
    setBasePrompt(nextBase);
    const neutral = moodNeutral(data);
    setMoodSingle(neutral);
    setEditablePrompt(applyMoodToPrompt(nextBase, data, neutral));
    setShowMoodResetHintSingle(false);
  }, [data.prompt, data.moodLeftInstruction, data.moodRightInstruction, data.moodNeutralValue, editablePrompt]);
  useEffect(() => {
    if (!dataVariants?.[0]) return;
    const nextBase = dataVariants[0].prompt;
    if (nextBase === editableVariant0) return;
    setBaseVariant0(nextBase);
    const neutral = moodNeutral(dataVariants[0]);
    setMoodA(neutral);
    setEditableVariant0(applyMoodToPrompt(nextBase, dataVariants[0], neutral));
    setShowMoodResetHintA(false);
  }, [dataVariants?.[0]?.prompt, dataVariants?.[0]?.moodLeftInstruction, dataVariants?.[0]?.moodRightInstruction, dataVariants?.[0]?.moodNeutralValue, editableVariant0]);
  useEffect(() => {
    if (!dataVariants?.[1]) return;
    const nextBase = dataVariants[1].prompt;
    if (nextBase === editableVariant1) return;
    setBaseVariant1(nextBase);
    const neutral = moodNeutral(dataVariants[1]);
    setMoodB(neutral);
    setEditableVariant1(applyMoodToPrompt(nextBase, dataVariants[1], neutral));
    setShowMoodResetHintB(false);
  }, [dataVariants?.[1]?.prompt, dataVariants?.[1]?.moodLeftInstruction, dataVariants?.[1]?.moodRightInstruction, dataVariants?.[1]?.moodNeutralValue, editableVariant1]);

  const handlePromptChange = (value: string) => {
    const neutral = moodNeutral(data);
    const hadMood = moodSingle !== neutral;
    setBasePrompt(value);
    setEditablePrompt(value);
    if (hadMood) {
      setMoodSingle(neutral);
      setShowMoodResetHintSingle(true);
    } else {
      setShowMoodResetHintSingle(false);
    }
    onUpdatePrompt?.(value);
  };
  const handleVariant0Change = (value: string) => {
    const style0 = dataVariants?.[0] ?? data;
    const neutral = moodNeutral(style0);
    const hadMood = moodA !== neutral;
    setBaseVariant0(value);
    setEditableVariant0(value);
    if (hadMood) {
      setMoodA(neutral);
      setShowMoodResetHintA(true);
    } else {
      setShowMoodResetHintA(false);
    }
    onUpdatePromptVariant?.(0, value);
  };
  const handleVariant1Change = (value: string) => {
    const style1 = dataVariants?.[1] ?? data;
    const neutral = moodNeutral(style1);
    const hadMood = moodB !== neutral;
    setBaseVariant1(value);
    setEditableVariant1(value);
    if (hadMood) {
      setMoodB(neutral);
      setShowMoodResetHintB(true);
    } else {
      setShowMoodResetHintB(false);
    }
    onUpdatePromptVariant?.(1, value);
  };

  const handleMoodSingleChange = (value: number) => {
    const nextMood = clampMood(value);
    setMoodSingle(nextMood);
    setShowMoodResetHintSingle(false);
    const nextPrompt = applyMoodToPrompt(basePrompt, data, nextMood);
    setEditablePrompt(nextPrompt);
  };
  const handleMoodAChange = (value: number) => {
    const nextMood = clampMood(value);
    const style0 = dataVariants?.[0] ?? data;
    setMoodA(nextMood);
    setShowMoodResetHintA(false);
    const nextPrompt = applyMoodToPrompt(baseVariant0, style0, nextMood);
    setEditableVariant0(nextPrompt);
  };
  const handleMoodBChange = (value: number) => {
    const nextMood = clampMood(value);
    const style1 = dataVariants?.[1] ?? data;
    setMoodB(nextMood);
    setShowMoodResetHintB(false);
    const nextPrompt = applyMoodToPrompt(baseVariant1, style1, nextMood);
    setEditableVariant1(nextPrompt);
  };
  const commitMoodSingle = () => onUpdatePrompt?.(editablePrompt);
  const commitMoodA = () => onUpdatePromptVariant?.(0, editableVariant0);
  const commitMoodB = () => onUpdatePromptVariant?.(1, editableVariant1);

  const handleEnrichA = async () => {
    if (!onEnrichStyleA || loadingA) return;
    setLoadingA('enrich');
    try {
      const result = await onEnrichStyleA(editableVariant0);
      setBaseVariant0(result);
      setEditableVariant0(result);
      setMoodA(moodNeutral(dataVariants?.[0] ?? data));
      setShowMoodResetHintA(false);
      onUpdatePromptVariant?.(0, result);
    } finally { setLoadingA(null); }
  };
  const handleEnrichB = async () => {
    if (!onEnrichStyleB || loadingB) return;
    setLoadingB('enrich');
    try {
      const result = await onEnrichStyleB(editableVariant1);
      setBaseVariant1(result);
      setEditableVariant1(result);
      setMoodB(moodNeutral(dataVariants?.[1] ?? data));
      setShowMoodResetHintB(false);
      onUpdatePromptVariant?.(1, result);
    } finally { setLoadingB(null); }
  };
  const handleRegenA = async () => {
    if (!onRegenerateA || loadingA) return;
    setLoadingA('regen');
    try { await onRegenerateA(); } finally { setLoadingA(null); }
  };
  const handleRegenB = async () => {
    if (!onRegenerateB || loadingB) return;
    setLoadingB('regen');
    try { await onRegenerateB(); } finally { setLoadingB(null); }
  };
  const handleEnrichSingle = async () => {
    if (!onEnrichStyleA || loadingSingle) return;
    setLoadingSingle('enrich');
    try {
      const result = await onEnrichStyleA(editablePrompt);
      setBasePrompt(result);
      setEditablePrompt(result);
      setMoodSingle(moodNeutral(data));
      setShowMoodResetHintSingle(false);
      onUpdatePrompt?.(result);
    } finally { setLoadingSingle(null); }
  };
  const handleRegenSingle = async () => {
    if (!onRegenerate || loadingSingle) return;
    setLoadingSingle('regen');
    try { await onRegenerate(); } finally { setLoadingSingle(null); }
  };

  const charCount = editablePrompt.length;
  const isOverSoft = charCount > SOFT_LIMIT;
  const isOverHard = charCount > HARD_LIMIT;

  if (dataVariants && dataVariants.length >= 2) {
    return (
      <section className="space-y-5 animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <p className="section-pill">{tr.style.pill}</p>
            <div className="gradient-line w-16"></div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-suno-primary/10 dark:bg-suno-primary/15 border border-suno-primary/25">
          <i className="fas fa-info-circle text-suno-primary text-sm flex-shrink-0"></i>
          <p className="text-[10px] text-zinc-100 leading-snug">{tr.style.copyOnLastPage}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StyleCard
            data={dataVariants[0]}
            editablePrompt={editableVariant0}
            onPromptChange={handleVariant0Change}
            moodValue={moodA}
            onMoodChange={handleMoodAChange}
            onMoodCommit={commitMoodA}
            showMoodResetHint={showMoodResetHintA}
            variantLabel={tr.lyrics.variant1}
            variantColor="text-suno-primary"
            accentClass="suno-primary"
            loading={loadingA}
            onEnrich={onEnrichStyleA ? handleEnrichA : undefined}
            onRegenerate={onRegenerateA ? handleRegenA : undefined}
          />
          <StyleCard
            data={dataVariants[1]}
            editablePrompt={editableVariant1}
            onPromptChange={handleVariant1Change}
            moodValue={moodB}
            onMoodChange={handleMoodBChange}
            onMoodCommit={commitMoodB}
            showMoodResetHint={showMoodResetHintB}
            variantLabel={tr.lyrics.variant2}
            variantColor="text-suno-secondary"
            accentClass="suno-secondary"
            loading={loadingB}
            onEnrich={onEnrichStyleB ? handleEnrichB : undefined}
            onRegenerate={onRegenerateB ? handleRegenB : undefined}
          />
        </div>
        <div className="border-t border-white/10 dark:border-white/5 pt-4">
          <button
            type="button"
            onClick={() => setDictionaryOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl glass-card hover:bg-white/10 dark:hover:bg-black/20 transition-colors text-left"
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
              <i className="fas fa-book text-suno-primary"></i>
              {tr.style.dictionaryTitle}
            </span>
            <i className={`fas fa-chevron-down text-[10px] text-zinc-400 transition-transform flex-shrink-0 ${dictionaryOpen ? '' : '-rotate-90'}`}></i>
          </button>
          {dictionaryOpen && (
            <div className="mt-3">
              <StyleDictionary
                onInsert={(text) => appendToPrompt(text, insertTarget)}
                insertTarget={insertTarget}
                onInsertTargetChange={setInsertTarget}
                variantLabels={[tr.lyrics.variant1, tr.lyrics.variant2]}
              />
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="section-pill">{tr.style.pill}</p>
          <div className="gradient-line w-16"></div>
          <span className="text-[9px] font-black text-zinc-400 uppercase tracking-wider hidden sm:block">{tr.style.engine}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={handleEnrichSingle} disabled={loadingSingle !== null}
            className="px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-suno-primary/15 border border-suno-primary/30 text-suno-primary hover:bg-suno-primary/25 disabled:opacity-50 flex items-center gap-1.5">
            <i className={`fas ${loadingSingle === 'enrich' ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
            {tr.style.enrichStyle}
          </button>
          <button onClick={handleRegenSingle} disabled={loadingSingle !== null} title={tr.style.regenerate}
            className="glass-btn w-9 h-9 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:text-suno-primary text-sm disabled:opacity-50">
            <i className={`fas ${loadingSingle === 'regen' ? 'fa-spinner fa-spin' : 'fa-dice'}`}></i>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-suno-primary/10 dark:bg-suno-primary/15 border border-suno-primary/25">
        <i className="fas fa-info-circle text-suno-primary text-sm flex-shrink-0"></i>
        <p className="text-[11px] text-zinc-100 leading-relaxed">{tr.style.copyOnLastPage}</p>
      </div>

      <div className="glass-card rounded-3xl p-6 md:p-8 relative overflow-hidden">
        <div className="absolute inset-0 suno-gradient-soft rounded-3xl pointer-events-none opacity-40"></div>
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
            <i className="fas fa-pen-to-square text-suno-primary text-[11px]" />
            <span>{tr.lyrics.editableHint}</span>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-suno-primary flex items-center gap-1.5">
              <i className="fas fa-terminal text-[8px]"></i> Suno V5 Input
            </p>
            <div className={`px-2.5 py-1 rounded-xl text-[9px] font-black border transition-all ${
              isOverHard ? 'bg-red-500/12 text-red-500 border-red-500/25 animate-pulse' : isOverSoft ? 'bg-amber-500/12 text-amber-600 border-amber-500/25' : 'glass-btn text-zinc-500 border-white/0'
            }`}>
              {charCount} {tr.style.charLimit}
            </div>
          </div>
          <div className="relative">
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-full transition-colors ${isOverHard ? 'bg-red-500' : isOverSoft ? 'bg-amber-500' : 'bg-suno-primary'}`}></div>
            <textarea
              className={`w-full bg-transparent pl-4 pr-2 py-2 font-mono text-sm leading-relaxed outline-none resize-none h-28 transition-colors disabled:opacity-70 cursor-text ${isOverHard ? 'text-red-500' : 'text-zinc-900 dark:text-white'}`}
              value={editablePrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              disabled={loadingSingle !== null}
              spellCheck={false}
              style={{ fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace' }}
            />
          </div>
          <div className="rounded-xl border border-suno-primary/20 bg-suno-primary/5 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-black uppercase tracking-[0.14em] text-suno-primary">{tr.style.moodFaderTitle}</p>
              <span className="text-[10px] font-black text-zinc-400">{moodSingle}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-bold text-zinc-400">
              <span className="truncate">{data.moodLeftLabel || 'Melodic'}</span>
              <span className="truncate text-right">{data.moodRightLabel || 'Experimental'}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={moodSingle}
              onChange={(e) => handleMoodSingleChange(Number(e.target.value))}
              onMouseUp={commitMoodSingle}
              onTouchEnd={commitMoodSingle}
              onKeyUp={commitMoodSingle}
              className="mt-2 w-full accent-suno-primary cursor-pointer"
            />
            <p className="mt-1 text-[9px] font-bold text-zinc-500 dark:text-zinc-400">{tr.style.moodFaderNeutral}</p>
            {showMoodResetHintSingle && (
              <p className="mt-1 text-[9px] font-bold text-amber-400">{tr.style.moodFaderResetHint}</p>
            )}
          </div>
          {isOverHard && (
            <p className="text-[9px] font-black text-red-500 uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
              <i className="fas fa-triangle-exclamation"></i> {tr.style.tooLong}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-5">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-suno-secondary flex items-center gap-1.5">
            <i className="fas fa-chart-simple text-[8px]"></i> {tr.style.algorithm}
          </p>
          <ValuePills weirdness={clampSafe(normalize(data.weirdness))} styleInfluence={clampSafe(normalize(data.styleInfluence))} />
        </div>
        <div className="glass-card rounded-2xl p-5 flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setStyleInfoModalOpen(true)}
            className="flex items-center gap-1.5 flex-shrink-0 w-fit rounded-xl px-3 py-2 text-[9px] font-black uppercase tracking-[0.18em] text-suno-secondary border border-suno-secondary/25 bg-suno-secondary/5 hover:bg-suno-secondary/15 transition-colors"
          >
            <i className="fas fa-circle-info text-suno-secondary text-[8px]"></i> {tr.style.styleInfo}
          </button>
          <div className="pt-3 flex-shrink-0">
            <p className="text-[10px] text-center font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400 italic leading-snug">{tr.style.aiNote}</p>
          </div>
          {styleInfoModalOpen && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30 dark:bg-black/50 backdrop-blur-sm" onClick={() => setStyleInfoModalOpen(false)}>
              <div
                className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl overflow-hidden animate-scale-in text-zinc-900 dark:text-zinc-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-800/50">
                  <span className="text-[10px] font-black uppercase tracking-wider text-suno-secondary flex items-center gap-2">
                    <i className="fas fa-circle-info text-suno-secondary"></i> {tr.style.styleInfo}
                  </span>
                  <button type="button" onClick={() => setStyleInfoModalOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                    <i className="fas fa-times text-sm"></i>
                  </button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-4 custom-scrollbar space-y-4 bg-white dark:bg-zinc-900">
                  <StyleInfoModalContent data={data} />
                  <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
                    <p className="text-[10px] text-center font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400 italic leading-snug">{tr.style.aiNote}</p>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
      <div className="border-t border-white/10 dark:border-white/5 pt-4">
        <button
          type="button"
          onClick={() => setDictionaryOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl glass-card hover:bg-white/10 dark:hover:bg-black/20 transition-colors text-left"
        >
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
            <i className="fas fa-book text-suno-primary"></i>
            {tr.style.dictionaryTitle}
          </span>
          <i className={`fas fa-chevron-down text-[10px] text-zinc-400 transition-transform flex-shrink-0 ${dictionaryOpen ? '' : '-rotate-90'}`}></i>
        </button>
        {dictionaryOpen && (
          <div className="mt-3">
            <StyleDictionary onInsert={(text) => appendToPrompt(text, 'single')} />
          </div>
        )}
      </div>
    </section>
  );
};

export default StyleDisplay;
