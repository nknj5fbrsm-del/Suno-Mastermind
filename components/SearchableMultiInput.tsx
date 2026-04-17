import React, { useState, useRef, useEffect } from 'react';
import { useLang } from '../App';

export interface SearchableMultiInputProps {
  label: string;
  icon: string;
  options: string[];
  selected: string[];
  onToggle: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  accent?: string;
}

const SearchableMultiInput: React.FC<SearchableMultiInputProps> = ({
  label,
  icon,
  options,
  selected,
  onToggle,
  placeholder,
  disabled,
  isLoading,
  accent = 'text-suno-primary',
}) => {
  const { tr } = useLang();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const justOpenedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const filtered = options.filter(o => o.toLowerCase().includes(searchTerm.toLowerCase()) && !selected.includes(o));

  const handleAdd = () => {
    const val = searchTerm.trim();
    if (val && !selected.includes(val)) { onToggle(val); }
    setSearchTerm(''); setIsOpen(false);
  };

  const handleInputClick = () => {
    if (disabled) return;
    if (justOpenedRef.current) {
      justOpenedRef.current = false;
      return;
    }
    setIsOpen(prev => !prev);
  };

  const handleInputFocus = () => {
    if (disabled) return;
    justOpenedRef.current = true;
    setIsOpen(true);
  };

  return (
    <div className={`space-y-2 transition-opacity ${disabled ? 'opacity-40 pointer-events-none' : ''}`} ref={wrapperRef}>
      <div className="flex items-center justify-between">
        <label className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${disabled ? 'text-zinc-400 dark:text-zinc-600' : 'text-zinc-700 dark:text-zinc-400'}`}>
          <i className={`fas ${icon} text-[10px] ${accent}`}></i> {label}
        </label>
        {isLoading && <span className={`text-[8px] font-black uppercase tracking-wider ${accent} animate-pulse`}><i className="fas fa-wand-magic-sparkles mr-1"></i>{tr.concept.inspiring}</span>}
      </div>
      <div className={`relative ${isOpen ? 'z-[100]' : ''}`}>
        <input
          type="text"
          disabled={disabled}
          autoComplete="off"
          className={`w-full glass-input rounded-xl px-3.5 py-3 pr-10 text-sm outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100 ${isLoading ? 'border-suno-primary/50' : ''}`}
          value={searchTerm}
          placeholder={placeholder}
          onFocus={handleInputFocus}
          onClick={handleInputClick}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        />
        <button type="button" disabled={disabled || !searchTerm.trim()} onClick={handleAdd}
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] transition-all ${searchTerm.trim() ? 'bg-suno-primary text-white' : 'text-zinc-400 opacity-40'}`}>
          <i className="fas fa-plus"></i>
        </button>
        {isOpen && !disabled && (
          <div className="absolute left-0 right-0 top-full z-[100] mt-1 glass-dropdown rounded-2xl max-h-64 overflow-y-auto custom-scrollbar animate-scale-in mobile-dropdown-fix concept-dropdown-options shadow-xl">
            {filtered.length > 0 ? filtered.map(opt => (
              <button key={opt} type="button"
                className="w-full text-left px-4 py-2.5 text-xs font-semibold hover:bg-suno-primary/10 dark:hover:bg-suno-primary/20 text-zinc-800 dark:text-zinc-200 hover:text-suno-primary transition-colors border-b border-zinc-100 dark:border-zinc-800 last:border-none"
                onClick={() => { onToggle(opt); setSearchTerm(''); setIsOpen(false); }}>
                {opt}
              </button>
            )) : (
              <p className="px-4 py-3 text-[11px] text-zinc-500 dark:text-zinc-400">{tr.concept.optional}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 min-h-[24px]">
        {selected.map(tag => (
          <span key={tag} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-medium bg-suno-primary/10 border border-suno-primary/20 ${accent} group hover:bg-red-500/10 hover:border-red-500/20 transition-all`}>
            {tag}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(tag); }}
              className="w-4 h-4 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-500 text-zinc-500 dark:text-zinc-400 transition-colors flex-shrink-0"
              title={tr.concept.removeSelection}
            >
              <i className="fas fa-times text-[9px]"></i>
            </button>
          </span>
        ))}
      </div>
    </div>
  );
};

export default SearchableMultiInput;
