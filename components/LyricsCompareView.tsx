import React from 'react';
import { useLang } from '../App';

interface LyricsCompareViewProps {
  variantA: string;
  variantB: string;
  onChoose: (index: 0 | 1) => void;
}

const LyricsCompareView: React.FC<LyricsCompareViewProps> = ({ variantA, variantB, onChoose }) => {
  const { tr } = useLang();

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-white">
          {tr.lyrics.compareTitle}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {tr.lyrics.compareSub}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Variante A */}
        <div className="glass-card rounded-2xl p-4 flex flex-col h-[420px] max-h-[62vh]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-suno-primary">
              {tr.lyrics.variantA}
            </span>
            <button
              type="button"
              onClick={() => onChoose(0)}
              className="btn-create px-4 py-2 rounded-xl text-white text-[10px] font-black uppercase tracking-wider shadow-md hover:opacity-95 transition-opacity"
            >
              {tr.lyrics.chooseThis}
            </button>
          </div>
          <pre className="flex-1 overflow-auto rounded-xl bg-white/5 dark:bg-black/20 p-4 text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed custom-scrollbar">
            {variantA || '…'}
          </pre>
        </div>

        {/* Variante B */}
        <div className="glass-card rounded-2xl p-4 flex flex-col h-[420px] max-h-[62vh]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-suno-secondary">
              {tr.lyrics.variantB}
            </span>
            <button
              type="button"
              onClick={() => onChoose(1)}
              className="btn-create px-4 py-2 rounded-xl text-white text-[10px] font-black uppercase tracking-wider shadow-md hover:opacity-95 transition-opacity"
            >
              {tr.lyrics.chooseThis}
            </button>
          </div>
          <pre className="flex-1 overflow-auto rounded-xl bg-white/5 dark:bg-black/20 p-4 text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed custom-scrollbar">
            {variantB || '…'}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default LyricsCompareView;
