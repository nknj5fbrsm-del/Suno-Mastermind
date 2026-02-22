
import React, { useState, useEffect } from 'react';
import { GeneratedStyle } from '../types';
import { useLang } from '../App';

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

const ValuePills: React.FC<{ weirdness: number; styleInfluence: number }> = ({ weirdness, styleInfluence }) => {
  const { tr } = useLang();
  return (
    <div className="flex flex-wrap gap-2">
      <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 dark:bg-black/20 border border-suno-primary/20">
        <i className="fas fa-brain text-suno-primary text-sm"></i>
        <span className="text-[11px] font-black text-zinc-800 dark:text-zinc-200 tabular-nums">{weirdness}%</span>
        <span className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{tr.style.weirdness}</span>
      </div>
      <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 dark:bg-black/20 border border-suno-secondary/20">
        <i className="fas fa-dna text-suno-secondary text-sm"></i>
        <span className="text-[11px] font-black text-zinc-800 dark:text-zinc-200 tabular-nums">{styleInfluence}%</span>
        <span className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{tr.style.influence}</span>
      </div>
    </div>
  );
};

const StyleCard: React.FC<{
  data: GeneratedStyle;
  editablePrompt: string;
  onPromptChange: (value: string) => void;
  variantLabel?: string;
  variantColor?: string;
  accentClass?: string;
  busy?: boolean;
  onEnrich?: () => void;
  onRegenerate?: () => void;
}> = ({ data, editablePrompt, onPromptChange, variantLabel, variantColor, accentClass, busy, onEnrich, onRegenerate }) => {
  const { tr } = useLang();
  const weirdness = clampSafe(normalize(data.weirdness));
  const styleInfluence = clampSafe(normalize(data.styleInfluence));
  const charCount = editablePrompt.length;
  const isOverSoft = charCount > SOFT_LIMIT;
  const isOverHard = charCount > HARD_LIMIT;
  const accent = accentClass || 'suno-primary';

  return (
    <div className="glass-card rounded-2xl p-5 flex flex-col min-h-[420px] max-h-[70vh]">
      {variantLabel && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <span className={`text-[10px] font-black uppercase tracking-wider ${variantColor || 'text-suno-primary'}`}>
            {variantLabel}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onEnrich && (
              <button type="button" onClick={onEnrich} disabled={busy}
                className={`px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-${accent}/15 border border-${accent}/30 text-${accent} hover:bg-${accent}/25 disabled:opacity-50 flex items-center gap-1.5`}>
                <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                {tr.style.enrichStyle}
              </button>
            )}
            {onRegenerate && (
              <button type="button" onClick={onRegenerate} disabled={busy} title={tr.style.regenerate}
                className={`w-8 h-8 rounded-xl flex items-center justify-center glass-btn text-${accent} hover:bg-${accent}/20 disabled:opacity-50`}>
                <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-dice'}`}></i>
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 flex flex-col min-h-0 space-y-4">
        <div className="relative flex-shrink-0">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-suno-primary flex items-center gap-1.5 mb-1.5">
            <i className="fas fa-terminal text-[8px]"></i> Suno V5 Input
          </p>
          <div className="relative">
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-full transition-colors ${isOverHard ? 'bg-red-500' : isOverSoft ? 'bg-amber-500' : `bg-${accent}`}`}></div>
            <textarea
              className={`w-full bg-white/5 dark:bg-black/20 rounded-xl pl-4 pr-2 py-2 text-[13px] font-black leading-relaxed outline-none resize-none h-24 transition-colors disabled:opacity-70 ${
                isOverHard ? 'text-red-500' : 'text-zinc-900 dark:text-white'
              }`}
              value={editablePrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              disabled={busy}
              spellCheck={false}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className={`text-[10px] font-bold ${isOverHard ? 'text-red-500' : isOverSoft ? 'text-amber-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
              {charCount} {tr.style.charLimit}
            </span>
            {isOverHard && <span className="text-[10px] font-black text-red-500">{tr.style.tooLong}</span>}
          </div>
        </div>
        <div className="flex-shrink-0">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-suno-secondary flex items-center gap-1.5 mb-2">
            <i className="fas fa-chart-simple text-[8px]"></i> {tr.style.algorithm}
          </p>
          <ValuePills weirdness={weirdness} styleInfluence={styleInfluence} />
        </div>
        <div className="flex-1 overflow-auto rounded-xl bg-white/5 dark:bg-black/10 p-4 space-y-3 custom-scrollbar min-h-0">
          {data.similarArtists && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1">
                <i className="fas fa-users text-suno-secondary text-[8px]"></i> {tr.style.references}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.similarArtists.split(',').map((a, i) => (
                  <span key={i} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-suno-secondary/10 text-suno-secondary border border-suno-secondary/20">{a.trim()}</span>
                ))}
              </div>
            </div>
          )}
          {data.promptEffect && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400 mb-1 flex items-center gap-1">
                <i className="fas fa-wave-square text-suno-primary text-[8px]"></i> {tr.style.effect}
              </p>
              <p className="text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed italic">{data.promptEffect}</p>
            </div>
          )}
          {data.recommendationReason && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-suno-primary mb-1 flex items-center gap-1">
                <i className="fas fa-lightbulb text-[8px]"></i> {tr.style.whyRec}
              </p>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{data.recommendationReason}</p>
            </div>
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
  const [editablePrompt, setEditablePrompt] = useState(data.prompt);
  const [editableVariant0, setEditableVariant0] = useState(dataVariants?.[0]?.prompt ?? data.prompt);
  const [editableVariant1, setEditableVariant1] = useState(dataVariants?.[1]?.prompt ?? data.prompt);
  const [busyA, setBusyA] = useState(false);
  const [busyB, setBusyB] = useState(false);
  const [busySingle, setBusySingle] = useState(false);

  useEffect(() => { setEditablePrompt(data.prompt); }, [data.prompt]);
  useEffect(() => { if (dataVariants?.[0]) setEditableVariant0(dataVariants[0].prompt); }, [dataVariants?.[0]?.prompt]);
  useEffect(() => { if (dataVariants?.[1]) setEditableVariant1(dataVariants[1].prompt); }, [dataVariants?.[1]?.prompt]);

  const handlePromptChange = (value: string) => {
    setEditablePrompt(value);
    onUpdatePrompt?.(value);
  };
  const handleVariant0Change = (value: string) => {
    setEditableVariant0(value);
    onUpdatePromptVariant?.(0, value);
  };
  const handleVariant1Change = (value: string) => {
    setEditableVariant1(value);
    onUpdatePromptVariant?.(1, value);
  };

  const handleEnrichA = async () => {
    if (!onEnrichStyleA || busyA) return;
    setBusyA(true);
    try {
      const result = await onEnrichStyleA(editableVariant0);
      setEditableVariant0(result);
      onUpdatePromptVariant?.(0, result);
    } finally { setBusyA(false); }
  };
  const handleEnrichB = async () => {
    if (!onEnrichStyleB || busyB) return;
    setBusyB(true);
    try {
      const result = await onEnrichStyleB(editableVariant1);
      setEditableVariant1(result);
      onUpdatePromptVariant?.(1, result);
    } finally { setBusyB(false); }
  };
  const handleRegenA = async () => {
    if (!onRegenerateA || busyA) return;
    setBusyA(true);
    try { await onRegenerateA(); } finally { setBusyA(false); }
  };
  const handleRegenB = async () => {
    if (!onRegenerateB || busyB) return;
    setBusyB(true);
    try { await onRegenerateB(); } finally { setBusyB(false); }
  };
  const handleEnrichSingle = async () => {
    if (!onEnrichStyleA || busySingle) return;
    setBusySingle(true);
    try {
      const result = await onEnrichStyleA(editablePrompt);
      setEditablePrompt(result);
      onUpdatePrompt?.(result);
    } finally { setBusySingle(false); }
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
          <p className="text-[10px] text-zinc-700 dark:text-zinc-300 leading-snug">{tr.style.copyOnLastPage}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StyleCard
            data={dataVariants[0]}
            editablePrompt={editableVariant0}
            onPromptChange={handleVariant0Change}
            variantLabel={tr.lyrics.variant1}
            variantColor="text-suno-primary"
            accentClass="suno-primary"
            busy={busyA}
            onEnrich={onEnrichStyleA ? handleEnrichA : undefined}
            onRegenerate={onRegenerateA ? handleRegenA : undefined}
          />
          <StyleCard
            data={dataVariants[1]}
            editablePrompt={editableVariant1}
            onPromptChange={handleVariant1Change}
            variantLabel={tr.lyrics.variant2}
            variantColor="text-suno-secondary"
            accentClass="suno-secondary"
            busy={busyB}
            onEnrich={onEnrichStyleB ? handleEnrichB : undefined}
            onRegenerate={onRegenerateB ? handleRegenB : undefined}
          />
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
          <button type="button" onClick={handleEnrichSingle} disabled={busySingle}
            className="px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-suno-primary/15 border border-suno-primary/30 text-suno-primary hover:bg-suno-primary/25 disabled:opacity-50 flex items-center gap-1.5">
            <i className={`fas ${busySingle ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
            {tr.style.enrichStyle}
          </button>
          <button onClick={onRegenerate} disabled={busySingle} title={tr.style.regenerate}
            className="glass-btn w-9 h-9 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:text-suno-primary text-sm disabled:opacity-50">
            <i className="fas fa-dice"></i>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-suno-primary/10 dark:bg-suno-primary/15 border border-suno-primary/25">
        <i className="fas fa-info-circle text-suno-primary text-sm flex-shrink-0"></i>
        <p className="text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed">{tr.style.copyOnLastPage}</p>
      </div>

      <div className="glass-card rounded-3xl p-6 md:p-8 relative overflow-hidden">
        <div className="absolute inset-0 suno-gradient-soft rounded-3xl pointer-events-none opacity-40"></div>
        <div className="relative z-10 space-y-4">
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
              className={`w-full bg-transparent pl-4 pr-2 py-2 font-black text-lg md:text-xl leading-relaxed outline-none resize-none h-28 transition-colors disabled:opacity-70 ${isOverHard ? 'text-red-500' : 'text-zinc-900 dark:text-white'}`}
              value={editablePrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              disabled={busySingle}
              spellCheck={false}
              style={{ fontFamily: 'Inter, sans-serif' }}
            />
          </div>
          {isOverHard && (
            <p className="text-[9px] font-black text-red-500 uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
              <i className="fas fa-triangle-exclamation"></i> {tr.style.tooLong}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-suno-secondary flex items-center gap-1.5">
            <i className="fas fa-chart-simple text-[8px]"></i> {tr.style.algorithm}
          </p>
          <ValuePills weirdness={clampSafe(normalize(data.weirdness))} styleInfluence={clampSafe(normalize(data.styleInfluence))} />
          {data.recommendationReason && (
            <>
              <div className="gradient-line"></div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-suno-primary mb-1.5 flex items-center gap-1">
                  <i className="fas fa-lightbulb text-[8px]"></i> {tr.style.whyRec}
                </p>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{data.recommendationReason}</p>
              </div>
            </>
          )}
        </div>
        <div className="glass-card rounded-2xl p-5 flex flex-col gap-4">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-suno-primary flex items-center gap-1.5">
            <i className="fas fa-microchip text-[8px]"></i> {tr.style.insightTitle}
          </p>
          {data.promptEffect && (
            <div>
              <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-400 mb-1.5 flex items-center gap-1">
                <i className="fas fa-wave-square text-suno-primary text-[7px]"></i> {tr.style.effect}
              </p>
              <p className="text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed italic">{data.promptEffect}</p>
            </div>
          )}
          {data.similarArtists && (
            <div className="pt-3 border-t border-white/15 dark:border-white/8">
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1">
                <i className="fas fa-users text-suno-secondary text-[8px]"></i> {tr.style.references}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.similarArtists.split(',').map((a, i) => (
                  <span key={i} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-suno-secondary/10 text-suno-secondary border border-suno-secondary/20">{a.trim()}</span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-auto pt-3 border-t border-white/15 dark:border-white/8">
            <p className="text-[10px] text-center font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400 italic leading-snug">{tr.style.aiNote}</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StyleDisplay;
