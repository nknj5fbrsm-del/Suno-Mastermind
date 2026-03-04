import React, { useState, useMemo } from 'react';
import { useLang } from '../App';
import { STYLE_DICTIONARY } from '../data/styleDictionary';

interface StyleDictionaryProps {
  onInsert: (text: string) => void;
  /** Bei zwei Varianten: Auswahl, in welches Feld eingefügt wird (0 = erste, 1 = zweite). */
  insertTarget?: 0 | 1;
  onInsertTargetChange?: (target: 0 | 1) => void;
  variantLabels?: [string, string];
}

const StyleDictionary: React.FC<StyleDictionaryProps> = ({
  onInsert,
  insertTarget = 0,
  onInsertTargetChange,
  variantLabels = ['Variante 1', 'Variante 2'],
}) => {
  const { lang, tr } = useLang();
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const label = (g: (typeof STYLE_DICTIONARY)[0]) => (lang === 'de' ? g.labelDe : g.labelEn);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q)
      return STYLE_DICTIONARY.map((g) => ({
        ...g,
        terms: g.terms,
      }));
    return STYLE_DICTIONARY.map((g) => ({
      ...g,
      terms: g.terms.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)
      ),
    })).filter((g) => g.terms.length > 0);
  }, [search]);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleInsert = (term: string) => {
    const toAdd = term.trim();
    if (toAdd) onInsert(toAdd);
  };

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-white/10 dark:border-white/5 space-y-3">
        <div className="flex items-center gap-2">
          <i className="fas fa-book text-suno-primary text-sm"></i>
          <h3 className="text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
            {tr.style.dictionaryTitle}
          </h3>
        </div>
        {onInsertTargetChange && variantLabels && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-bold uppercase text-zinc-500 dark:text-zinc-400">
              {tr.style.insertInto}
            </span>
            <div className="flex rounded-xl overflow-hidden border border-white/20 dark:border-white/10">
              {([0, 1] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onInsertTargetChange(t)}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase transition-colors ${
                    insertTarget === t
                      ? 'bg-suno-primary text-white'
                      : 'bg-white/5 dark:bg-black/20 text-zinc-600 dark:text-zinc-400 hover:bg-white/15'
                  }`}
                >
                  {variantLabels[t]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="relative">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-[10px]"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr.style.dictionarySearch}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 dark:bg-black/20 border border-white/10 dark:border-white/5 text-[12px] font-medium text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none focus:ring-2 focus:ring-suno-primary/30"
          />
        </div>
      </div>
      <div className="max-h-[280px] overflow-y-auto custom-scrollbar p-2 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-500 p-3 text-center">
            {tr.style.dictionaryNoResults}
          </p>
        ) : (
          filtered.map((group) => (
            <div key={group.id} className="rounded-xl overflow-hidden border border-white/10 dark:border-white/5">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between px-3 py-2 bg-white/5 dark:bg-black/20 hover:bg-white/10 dark:hover:bg-black/30 transition-colors text-left"
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-suno-primary">
                  {label(group)}
                </span>
                <i
                  className={`fas fa-chevron-down text-[8px] text-zinc-400 transition-transform ${
                    expandedGroups.has(group.id) ? '' : '-rotate-90'
                  }`}
                ></i>
              </button>
              {expandedGroups.has(group.id) && (
                <div className="p-2 space-y-1 bg-white/[0.02] dark:bg-black/10">
                  {group.terms.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => handleInsert(t.name)}
                      className="w-full flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg text-left hover:bg-suno-primary/15 dark:hover:bg-suno-primary/10 border border-transparent hover:border-suno-primary/25 transition-colors group"
                    >
                      <span className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 group-hover:text-suno-primary">
                        {t.name}
                      </span>
                      <span className="text-[9px] text-zinc-500 dark:text-zinc-400 leading-snug line-clamp-2">
                        {t.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default StyleDictionary;
