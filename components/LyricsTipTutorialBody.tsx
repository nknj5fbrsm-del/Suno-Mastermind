import React from 'react';

export type LyricsTipSection = { title: string; items: string[] };

interface LyricsTipTutorialBodyProps {
  sections: LyricsTipSection[];
  tagline: string;
}

const LyricsTipTutorialBody: React.FC<LyricsTipTutorialBodyProps> = ({ sections, tagline }) => (
  <div className="space-y-3 text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
    {sections.map((sec, idx) => (
      <div key={idx} className="space-y-1.5">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-suno-primary/90">{sec.title}</p>
        <ul className="list-disc pl-4 space-y-1 marker:text-zinc-400 dark:marker:text-zinc-500">
          {sec.items.map((line, j) => (
            <li key={j}>{line}</li>
          ))}
        </ul>
      </div>
    ))}
    <p className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 pt-2 mt-1 border-t border-white/25 dark:border-white/10">
      {tagline}
    </p>
  </div>
);

export default LyricsTipTutorialBody;
