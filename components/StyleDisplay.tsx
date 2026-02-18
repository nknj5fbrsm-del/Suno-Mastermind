
import React, { useState, useEffect } from 'react';
import { GeneratedStyle } from '../types';
import { useLang } from '../App';

interface StyleDisplayProps {
  data: GeneratedStyle;
  onRegenerate: () => void;
  onUpdatePrompt?: (prompt: string) => void;
}

const StyleDisplay: React.FC<StyleDisplayProps> = ({ data, onRegenerate, onUpdatePrompt }) => {
  const { tr } = useLang();
  const [editablePrompt, setEditablePrompt] = useState(data.prompt);

  useEffect(() => { setEditablePrompt(data.prompt); }, [data.prompt]);

  const handlePromptChange = (value: string) => {
    setEditablePrompt(value);
    onUpdatePrompt?.(value);
  };

  const normalize = (val: any) => {
    const n = Number(val);
    if (isNaN(n)) return 50;
    if (n > 0 && n <= 1) return Math.round(n * 100);
    return Math.min(100, Math.max(0, Math.round(n)));
  };

  const weirdness     = normalize(data.weirdness);
  const styleInfluence = normalize(data.styleInfluence);
  const charCount     = editablePrompt.length;
  const isTooLong     = charCount > 120;

  const getMeterColor = (val: number) => {
    if (val < 35) return 'bg-emerald-500';
    if (val < 70) return 'bg-suno-primary';
    return 'bg-suno-secondary';
  };

  return (
    <section className="space-y-5 animate-fade-up">

      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="section-pill">{tr.style.pill}</p>
          <div className="gradient-line w-16"></div>
          <span className="text-[9px] font-black text-zinc-400 uppercase tracking-wider hidden sm:block">{tr.style.engine}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRegenerate} title={tr.style.regenerate}
            className="glass-btn w-9 h-9 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:text-suno-primary text-sm">
            <i className="fas fa-dice"></i>
          </button>
        </div>
      </div>

      {/* Hinweis: Kopieren auf letzter Seite */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-suno-primary/10 dark:bg-suno-primary/15 border border-suno-primary/25">
        <i className="fas fa-info-circle text-suno-primary text-sm flex-shrink-0"></i>
        <p className="text-[10px] text-zinc-700 dark:text-zinc-300 leading-snug">{tr.style.copyOnLastPage}</p>
      </div>

      {/* ─── Main Prompt Card ─── */}
      <div className="glass-card rounded-3xl p-6 md:p-8 relative overflow-hidden">
        {/* Background accent */}
        <div className="absolute inset-0 suno-gradient-soft rounded-3xl pointer-events-none opacity-40"></div>
        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-suno-primary flex items-center gap-1.5">
              <i className="fas fa-terminal text-[8px]"></i> Suno V5 Input
            </p>
            <div className={`px-2.5 py-1 rounded-xl text-[9px] font-black border transition-all ${
              isTooLong
                ? 'bg-red-500/12 text-red-500 border-red-500/25 animate-pulse'
                : charCount > 100
                  ? 'bg-amber-500/12 text-amber-600 border-amber-500/25'
                  : 'glass-btn text-zinc-500 border-white/0'
            }`}>
              {charCount} / 120
            </div>
          </div>

          <div className="relative">
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-full transition-colors ${isTooLong ? 'bg-red-500' : 'bg-suno-primary'}`}></div>
            <textarea
              className={`w-full bg-transparent pl-4 pr-2 py-2 font-black text-lg md:text-xl leading-relaxed outline-none resize-none h-28 transition-colors ${
                isTooLong ? 'text-red-500' : 'text-zinc-900 dark:text-white'
              }`}
              value={editablePrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              spellCheck={false}
              style={{ fontFamily: 'Inter, sans-serif' }}
            />
          </div>

          {isTooLong && (
            <p className="text-[9px] font-black text-red-500 uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
              <i className="fas fa-triangle-exclamation"></i> {tr.style.tooLong}
            </p>
          )}
        </div>
      </div>

      {/* ─── Bento Row: Algorithm + Style Insight ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Algorithm */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-suno-secondary flex items-center gap-1.5">
            <i className="fas fa-chart-simple text-[8px]"></i> {tr.style.algorithm}
          </p>

          <div className="space-y-4">
            {[
              { label: tr.style.weirdness, val: weirdness,     icon: 'fa-brain', desc: tr.style.weirdnessDesc },
              { label: tr.style.influence, val: styleInfluence, icon: 'fa-dna',   desc: tr.style.influenceDesc },
            ].map(stat => (
              <div key={stat.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <i className={`fas ${stat.icon} text-[8px]`}></i> {stat.label}
                  </span>
                  <span className="text-[11px] font-black text-zinc-900 dark:text-zinc-100 tabular-nums">{stat.val}<span className="text-[9px] opacity-50">%</span></span>
                </div>
                <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-out ${getMeterColor(stat.val)}`}
                    style={{ width: `${stat.val}%` }}
                  ></div>
                </div>
                <p className="text-[8px] text-zinc-400 mt-1 font-bold uppercase tracking-wide">{stat.desc}</p>
              </div>
            ))}
          </div>

          {data.recommendationReason && (
            <>
              <div className="gradient-line"></div>
              <div>
                <p className="text-[8px] font-black uppercase tracking-[0.15em] text-suno-primary mb-1.5 flex items-center gap-1">
                  <i className="fas fa-lightbulb text-[7px]"></i> {tr.style.whyRec}
                </p>
                <p className="text-[10px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {data.recommendationReason}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Style Insight */}
        <div className="glass-card rounded-2xl p-5 flex flex-col gap-4">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-suno-primary flex items-center gap-1.5">
            <i className="fas fa-microchip text-[8px]"></i> {tr.style.insightTitle}
          </p>

          {data.promptEffect && (
            <div>
              <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-400 mb-1.5 flex items-center gap-1">
                <i className="fas fa-wave-square text-suno-primary text-[7px]"></i> {tr.style.effect}
              </p>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed italic">
                {data.promptEffect}
              </p>
            </div>
          )}

          {data.similarArtists && (
            <div className="pt-3 border-t border-white/15 dark:border-white/8">
              <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-400 mb-2 flex items-center gap-1">
                <i className="fas fa-users text-suno-secondary text-[7px]"></i> {tr.style.references}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.similarArtists.split(',').map((a, i) => (
                  <span key={i} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-suno-secondary/8 text-suno-secondary border border-suno-secondary/15">
                    {a.trim()}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-auto pt-3 border-t border-white/15 dark:border-white/8">
            <p className="text-[8px] text-center font-black uppercase tracking-[0.15em] text-zinc-400 italic">
              {tr.style.aiNote}
            </p>
          </div>
        </div>
      </div>

    </section>
  );
};

export default StyleDisplay;
