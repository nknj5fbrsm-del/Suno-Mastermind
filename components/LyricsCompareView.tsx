import React, { useState, useEffect } from 'react';
import { useLang } from '../App';

interface LyricsCompareViewProps {
  variantA: string;
  variantB: string;
  onUpdateVariantA?: (value: string) => void;
  onUpdateVariantB?: (value: string) => void;
  onEnrichRegieA?: (lyrics: string) => Promise<string>;
  onEnrichRegieB?: (lyrics: string) => Promise<string>;
  onRegenerateA?: () => Promise<void>;
  onRegenerateB?: () => Promise<void>;
}

const LyricsCompareView: React.FC<LyricsCompareViewProps> = ({
  variantA, variantB,
  onUpdateVariantA, onUpdateVariantB,
  onEnrichRegieA, onEnrichRegieB, onRegenerateA, onRegenerateB,
}) => {
  const { tr } = useLang();
  const [editA, setEditA] = useState(variantA);
  const [editB, setEditB] = useState(variantB);
  const [busyA, setBusyA] = useState(false);
  const [busyB, setBusyB] = useState(false);

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
    if (!onEnrichRegieA || busyA) return;
    setBusyA(true);
    try {
      const result = await onEnrichRegieA(editA);
      setEditA(result);
      onUpdateVariantA?.(result);
    } finally { setBusyA(false); }
  };
  const handleEnrichB = async () => {
    if (!onEnrichRegieB || busyB) return;
    setBusyB(true);
    try {
      const result = await onEnrichRegieB(editB);
      setEditB(result);
      onUpdateVariantB?.(result);
    } finally { setBusyB(false); }
  };
  const handleRegenA = async () => {
    if (!onRegenerateA || busyA) return;
    setBusyA(true);
    try {
      await onRegenerateA();
    } finally { setBusyA(false); }
  };
  const handleRegenB = async () => {
    if (!onRegenerateB || busyB) return;
    setBusyB(true);
    try {
      await onRegenerateB();
    } finally { setBusyB(false); }
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
        <p className="text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed">{tr.lyrics.twoVariantsSub}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Variante 1 */}
        <div className="glass-card rounded-2xl p-5 flex flex-col min-h-[420px] max-h-[70vh]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-suno-primary">
              {tr.lyrics.variant1}
            </span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button type="button" onClick={handleEnrichA} disabled={busyA}
                className="px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-suno-primary/15 border border-suno-primary/30 text-suno-primary hover:bg-suno-primary/25 disabled:opacity-50 flex items-center gap-1.5">
                <i className={`fas ${busyA ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                {tr.lyrics.enrichRegie}
              </button>
              <button type="button" onClick={handleRegenA} disabled={busyA} title={tr.lyrics.regenerate}
                className="w-8 h-8 rounded-xl flex items-center justify-center glass-btn text-suno-primary hover:bg-suno-primary/20 disabled:opacity-50">
                <i className={`fas ${busyA ? 'fa-spinner fa-spin' : 'fa-dice'}`}></i>
              </button>
            </div>
          </div>
          <textarea
            value={editA}
            onChange={(e) => handleChangeA(e.target.value)}
            disabled={busyA}
            className="flex-1 min-h-0 w-full overflow-auto rounded-xl bg-white/5 dark:bg-black/20 p-4 text-[13px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed custom-scrollbar border-0 resize-none focus:ring-2 focus:ring-suno-primary/30 outline-none disabled:opacity-70"
            placeholder="…"
            spellCheck={false}
          />
        </div>

        {/* Variante 2 */}
        <div className="glass-card rounded-2xl p-5 flex flex-col min-h-[420px] max-h-[70vh]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-suno-secondary">
              {tr.lyrics.variant2}
            </span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button type="button" onClick={handleEnrichB} disabled={busyB}
                className="px-2.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-suno-secondary/15 border border-suno-secondary/30 text-suno-secondary hover:bg-suno-secondary/25 disabled:opacity-50 flex items-center gap-1.5">
                <i className={`fas ${busyB ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                {tr.lyrics.enrichRegie}
              </button>
              <button type="button" onClick={handleRegenB} disabled={busyB} title={tr.lyrics.regenerate}
                className="w-8 h-8 rounded-xl flex items-center justify-center glass-btn text-suno-secondary hover:bg-suno-secondary/20 disabled:opacity-50">
                <i className={`fas ${busyB ? 'fa-spinner fa-spin' : 'fa-dice'}`}></i>
              </button>
            </div>
          </div>
          <textarea
            value={editB}
            onChange={(e) => handleChangeB(e.target.value)}
            disabled={busyB}
            className="flex-1 min-h-0 w-full overflow-auto rounded-xl bg-white/5 dark:bg-black/20 p-4 text-[13px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed custom-scrollbar border-0 resize-none focus:ring-2 focus:ring-suno-secondary/30 outline-none disabled:opacity-70"
            placeholder="…"
            spellCheck={false}
          />
        </div>
      </div>
    </section>
  );
};

export default LyricsCompareView;
