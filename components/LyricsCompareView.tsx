import React, { useState, useEffect } from 'react';
import { useLang } from '../App';

interface LyricsCompareViewProps {
  variantA: string;
  variantB: string;
  onUpdateVariantA?: (value: string) => void;
  onUpdateVariantB?: (value: string) => void;
}

const LyricsCompareView: React.FC<LyricsCompareViewProps> = ({ variantA, variantB, onUpdateVariantA, onUpdateVariantB }) => {
  const { tr } = useLang();
  const [editA, setEditA] = useState(variantA);
  const [editB, setEditB] = useState(variantB);

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
        <div className="glass-card rounded-2xl p-5 flex flex-col min-h-[420px] max-h-[70vh]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-suno-primary">
              {tr.lyrics.variant1}
            </span>
          </div>
          <textarea
            value={editA}
            onChange={(e) => handleChangeA(e.target.value)}
            className="flex-1 min-h-0 w-full overflow-auto rounded-xl bg-white/5 dark:bg-black/20 p-4 text-[13px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed custom-scrollbar border-0 resize-none focus:ring-2 focus:ring-suno-primary/30 outline-none"
            placeholder="…"
            spellCheck={false}
          />
        </div>

        <div className="glass-card rounded-2xl p-5 flex flex-col min-h-[420px] max-h-[70vh]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-suno-secondary">
              {tr.lyrics.variant2}
            </span>
          </div>
          <textarea
            value={editB}
            onChange={(e) => handleChangeB(e.target.value)}
            className="flex-1 min-h-0 w-full overflow-auto rounded-xl bg-white/5 dark:bg-black/20 p-4 text-[13px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed custom-scrollbar border-0 resize-none focus:ring-2 focus:ring-suno-secondary/30 outline-none"
            placeholder="…"
            spellCheck={false}
          />
        </div>
      </div>
    </section>
  );
};

export default LyricsCompareView;
