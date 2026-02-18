
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { SongConcept } from '../types';
import { suggestStyleTags } from '../services/geminiService';
import { useLang } from '../App';

interface LyricDisplayProps {
  lyrics: string;
  concept: SongConcept;
  isInstrumental: boolean;
  onRegenerate: () => void;
  onUpdate: (lyrics: string) => void;
}

const LyricDisplay: React.FC<LyricDisplayProps> = ({ lyrics: initialLyrics, concept, isInstrumental, onRegenerate, onUpdate }) => {
  const { tr } = useLang();
  const [editableLyrics, setEditableLyrics] = useState(initialLyrics);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Saved when textarea is blurred (clicking a tag button blurs it, resetting selectionStart to 0)
  const savedSelectionRef = useRef<{ start: number; end: number; scroll: number }>({ start: 0, end: 0, scroll: 0 });
  // After a tag insert: restore cursor and scroll in the next layout commit
  const restoreCursorRef = useRef<{ pos: number; scroll: number } | null>(null);
  // Prevents the parent-sync effect from overwriting a just-inserted local edit
  const skipSyncRef = useRef(false);

  useEffect(() => {
    if (skipSyncRef.current) { skipSyncRef.current = false; return; }
    setEditableLyrics(initialLyrics);
  }, [initialLyrics]);

  // Synchronously restore cursor + scroll after React commits the DOM
  useLayoutEffect(() => {
    if (restoreCursorRef.current !== null && textareaRef.current) {
      const { pos, scroll } = restoreCursorRef.current;
      textareaRef.current.scrollTop = scroll;
      textareaRef.current.setSelectionRange(pos, pos);
      restoreCursorRef.current = null;
    }
  });

  useEffect(() => {
    const saved = localStorage.getItem('suno-custom-tags');
    if (saved) { try { setCustomTags(JSON.parse(saved)); } catch {} }
  }, []);

  const handleChange = (val: string) => { setEditableLyrics(val); onUpdate(val); };

  const insertTag = (tag: string) => {
    // Use the position saved on blur — clicking a button blurs the textarea,
    // which resets selectionStart/End to 0, so we cannot read them here.
    const { start, end, scroll } = savedSelectionRef.current;
    const insertion = `\n[${tag}]\n`;
    const newVal    = editableLyrics.substring(0, start) + insertion + editableLyrics.substring(end);

    skipSyncRef.current   = true;
    restoreCursorRef.current = { pos: start + insertion.length, scroll };

    handleChange(newVal);
  };

  const addCustomTag = (raw: string) => {
    const tag = raw.trim();
    if (tag && !customTags.includes(tag)) {
      const updated = [...customTags, tag];
      setCustomTags(updated);
      localStorage.setItem('suno-custom-tags', JSON.stringify(updated));
      setNewTagInput('');
    }
  };

  const removeCustomTag = (tag: string) => {
    const updated = customTags.filter(t => t !== tag);
    setCustomTags(updated);
    localStorage.setItem('suno-custom-tags', JSON.stringify(updated));
  };

  const handleAISuggest = async () => {
    if (isSuggesting) return;
    setIsSuggesting(true);
    try {
      const suggestions = await suggestStyleTags(concept, editableLyrics);
      const next = [...customTags];
      suggestions.forEach(s => { if (!next.includes(s)) next.push(s); });
      setCustomTags(next);
      localStorage.setItem('suno-custom-tags', JSON.stringify(next));
    } catch {}
    finally { setIsSuggesting(false); }
  };

  const quickTags = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Solo', 'Outro', 'End'];

  // Strukturvorlagen: komplette Tag-Sequenz per Klick einfügen
  const structureTemplates: { id: keyof typeof tr.lyrics; tags: string[] }[] = [
    { id: 'templatePop',          tags: ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Chorus', 'Outro'] },
    { id: 'templateBallad',       tags: ['Intro', 'Verse', 'Verse', 'Chorus', 'Bridge', 'Chorus', 'Outro'] },
    { id: 'templateRock',         tags: ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Verse', 'Pre-Chorus', 'Chorus', 'Solo', 'Chorus', 'Outro'] },
    { id: 'templateMinimal',      tags: ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Outro'] },
    { id: 'templateInstrumental', tags: ['Intro', 'Verse', 'Break', 'Verse', 'Solo', 'Outro'] },
  ];

  const insertStructure = (tags: string[]) => {
    const { start, end, scroll } = savedSelectionRef.current;
    const block = tags.map(t => `[${t}]`).join('\n\n') + '\n\n';
    const newVal = editableLyrics.substring(0, start) + block + editableLyrics.substring(end);
    skipSyncRef.current = true;
    restoreCursorRef.current = { pos: start + block.length, scroll };
    handleChange(newVal);
  };

  return (
    <section className="space-y-5 animate-fade-up">

      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="section-pill">{tr.lyrics.pill}</p>
          {isInstrumental && (
            <span className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-amber-500/10 text-amber-600 border border-amber-500/20">{tr.concept.instrumental}</span>
          )}
          <div className="gradient-line w-16"></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRegenerate} title={tr.lyrics.regenerate}
            className="glass-btn w-9 h-9 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:text-suno-primary text-sm">
            <i className="fas fa-dice"></i>
          </button>
        </div>
      </div>

      {/* Hinweis: Kopieren auf letzter Seite */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-suno-primary/10 dark:bg-suno-primary/15 border border-suno-primary/25">
        <i className="fas fa-info-circle text-suno-primary text-sm flex-shrink-0"></i>
        <p className="text-[10px] text-zinc-700 dark:text-zinc-300 leading-snug">{tr.lyrics.copyOnLastPage}</p>
      </div>

      {/* ─── Tag Toolbar ─── */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        {/* Strukturvorlagen: komplette Songstruktur einfügen */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[9px] font-black uppercase tracking-[0.15em] text-suno-primary mr-1">{tr.lyrics.structureTemplate}</span>
          {structureTemplates.map(({ id, tags }) => (
            <button key={id} type="button" onClick={() => insertStructure(tags)}
              className="tag-pill text-zinc-600 dark:text-zinc-400 bg-white/50 dark:bg-white/10 hover:bg-suno-primary hover:text-white border border-suno-primary/30">
              {tr.lyrics[id]}
            </button>
          ))}
        </div>
        {/* Einzelne Structure tags */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[9px] font-black uppercase tracking-[0.15em] text-suno-primary mr-1">{tr.lyrics.structure}</span>
          {quickTags.map(tag => (
            <button key={tag} type="button" onClick={() => insertTag(tag)}
              className="tag-pill text-zinc-600 dark:text-zinc-400">
              [{tag}]
            </button>
          ))}
        </div>

        {/* Style tags */}
        <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-white/20 dark:border-white/8">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-suno-secondary">{tr.lyrics.style}</span>
            <button type="button" onClick={handleAISuggest} disabled={isSuggesting}
              className={`glass-btn w-7 h-7 rounded-lg flex items-center justify-center text-suno-secondary text-[10px] ${isSuggesting ? 'animate-pulse opacity-60' : 'hover:bg-suno-secondary hover:text-white'}`}
              title={tr.lyrics.regenerate}>
              <i className={`fas ${isSuggesting ? 'fa-spinner fa-spin' : 'fa-wand-sparkles'}`}></i>
            </button>
          </div>

          {customTags.map(tag => (
            <div key={tag} className="flex items-center">
              <button type="button" onClick={() => insertTag(tag)}
                className="tag-pill text-zinc-600 dark:text-zinc-400 rounded-r-none border-r-0">
                [{tag}]
              </button>
              <button type="button" onClick={() => removeCustomTag(tag)}
                className="h-[26px] px-1.5 rounded-r-xl border border-l-0 border-white/50 dark:border-white/10 bg-white/30 dark:bg-white/5 text-zinc-400 hover:bg-red-500 hover:text-white hover:border-red-500 text-[9px] transition-all">
                <i className="fas fa-times"></i>
              </button>
            </div>
          ))}

          <div className="flex items-center h-[26px]">
            <input type="text" placeholder={tr.lyrics.ownTag}
              className="glass-input h-full rounded-l-xl rounded-r-none px-3 text-[10px] font-bold w-28 md:w-36"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(newTagInput); } }}
            />
            <button type="button" onClick={() => addCustomTag(newTagInput)}
              className="h-full px-2.5 rounded-l-none rounded-r-xl glass-btn text-zinc-500 hover:bg-suno-primary hover:text-white text-[10px] transition-all border-l-0">
              <i className="fas fa-plus"></i>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Editor ─── */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="glass-input w-full rounded-3xl px-6 py-6 font-mono text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed min-h-[420px] h-[62vh] resize-none custom-scrollbar shadow-inner"
          value={editableLyrics}
          onChange={(e) => handleChange(e.target.value)}
          onSelect={(e) => {
            const el = e.currentTarget;
            savedSelectionRef.current = { start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop };
          }}
          onKeyUp={(e) => {
            const el = e.currentTarget;
            savedSelectionRef.current = { start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop };
          }}
          onBlur={(e) => {
            // Critical: save selection before focus leaves (button click resets selectionStart to 0)
            const el = e.currentTarget;
            savedSelectionRef.current = { start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop };
          }}
          spellCheck={false}
          style={{ fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace' }}
        />
        <div className="absolute top-4 right-4 flex items-center gap-2 pointer-events-none">
          <span className="glass-btn px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 pointer-events-none">
            <i className="fas fa-pen-to-square mr-1 opacity-60"></i>{tr.lyrics.liveEdit}
          </span>
        </div>
        <div className="absolute bottom-4 right-4 text-[9px] font-black text-zinc-400 uppercase tracking-wider pointer-events-none">
          {editableLyrics.split('\n').length} {tr.lyrics.lines}
        </div>
      </div>

    </section>
  );
};

export default LyricDisplay;
