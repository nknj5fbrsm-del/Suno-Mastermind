
import React, { useState, useRef, useEffect } from 'react';
import { SongConcept } from '../types';
import { analyzeTopic, generateRandomTopic, analyzeAudio, AudioAnalysisResult } from '../services/geminiService';
import { useLang, useToast } from '../App';

interface ConceptFormProps {
  initialConcept: SongConcept;
  onSubmit: (concept: SongConcept) => void;
}

// Optionen kommen aus tr.conceptOptions (übersetzt)

// ─── SEARCHABLE MULTI INPUT ───────────────────────────────────────────────
const SearchableMultiInput: React.FC<{
  label: string;
  icon: string;
  options: string[];
  selected: string[];
  onToggle: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  accent?: string;
}> = ({ label, icon, options, selected, onToggle, placeholder, disabled, isLoading, accent = 'text-suno-primary' }) => {
  const { tr } = useLang();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const justOpenedRef = useRef(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

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
      <div className="relative">
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
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 glass-dropdown rounded-2xl max-h-64 overflow-y-auto custom-scrollbar animate-scale-in mobile-dropdown-fix concept-dropdown-options">
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

      <div className="flex flex-wrap gap-1.5 min-h-[24px]">
        {selected.map(tag => (
          <span key={tag} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-medium bg-suno-primary/10 border border-suno-primary/20 ${accent} group hover:bg-red-500/10 hover:border-red-500/20 transition-all`}>
            {tag}
            <button type="button" onClick={() => onToggle(tag)} className="hover:text-red-500 transition-colors ml-0.5">
              <i className="fas fa-times text-[8px]"></i>
            </button>
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── AUDIO UPLOAD ZONE ────────────────────────────────────────────────────
const ACCEPTED_AUDIO = '.mp3,.wav,.ogg,.flac,.aac,.webm,.m4a';
const MAX_FILE_MB = 18;

interface AudioFile {
  name: string;
  sizeMB: number;
  base64: string;
  mimeType: string;
}

// Kompakte, beschriftete Audio-Upload-Leiste
const AudioUploadBar: React.FC<{
  onAnalysisComplete: (result: AudioAnalysisResult) => void;
}> = ({ onAnalysisComplete }) => {
  const { tr } = useLang();
  const [audioFile, setAudioFile]     = useState<AudioFile | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragging, setIsDragging]   = useState(false);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File): Promise<AudioFile> =>
    new Promise((resolve, reject) => {
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        reject(new Error(`Max. ${MAX_FILE_MB} MB`));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const base64 = dataUrl.split(',')[1];
        resolve({ name: file.name, sizeMB: Math.round((file.size / 1024 / 1024) * 10) / 10, base64, mimeType: file.type || 'audio/mpeg' });
      };
      reader.onerror = () => reject(new Error('Lesefehler'));
      reader.readAsDataURL(file);
    });

  const handleFile = async (file: File) => {
    setError(''); setSuccess(false);
    try { setAudioFile(await readFile(file)); }
    catch (e: any) { setError(e.message || 'Fehler'); }
  };

  const handleAnalyze = async () => {
    if (!audioFile || isAnalyzing) return;
    setIsAnalyzing(true); setError(''); setSuccess(false);
    try {
      const result = await analyzeAudio(audioFile.base64, audioFile.mimeType);
      onAnalysisComplete(result);
      setSuccess(true);
    } catch (e: any) {
      setError(e.message || 'Analyse fehlgeschlagen.');
    } finally { setIsAnalyzing(false); }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl border transition-all duration-200 ${
        isDragging
          ? 'border-suno-primary bg-suno-primary/8 scale-[1.01]'
          : success
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-zinc-200 dark:border-zinc-700/60 bg-white/30 dark:bg-white/[0.03]'
      }`}
    >
      {/* Label */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <i className={`fas text-[10px] ${success ? 'fa-check-circle text-emerald-500' : isAnalyzing ? 'fa-spinner animate-spin text-suno-primary' : 'fa-waveform-lines text-suno-primary'}`}></i>
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 select-none">{tr.concept.referenceAudio}</span>
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 flex-shrink-0"></div>

      {/* State: no file */}
      {!audioFile && (
        <button type="button" onClick={() => fileInputRef.current?.click()}
          className="flex-1 flex items-center gap-1.5 text-[9px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-suno-primary transition-colors text-left">
          <i className="fas fa-arrow-up-from-bracket text-[8px]"></i>
          {isDragging ? tr.concept.fileDrop : tr.concept.fileChoose}
        </button>
      )}

      {/* State: file loaded */}
      {audioFile && (
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <i className="fas fa-file-audio text-suno-primary text-[9px] flex-shrink-0"></i>
          <span className="text-[9px] font-medium text-zinc-600 dark:text-zinc-300 truncate" title={audioFile.name}>{audioFile.name}</span>
          <span className="text-[8px] text-zinc-400 flex-shrink-0">{audioFile.sizeMB} MB</span>
        </div>
      )}

      {/* Analyze btn (only when file loaded, not yet done) */}
      {audioFile && !success && (
        <button type="button" onClick={handleAnalyze} disabled={isAnalyzing}
          className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${
            isAnalyzing ? 'text-suno-primary opacity-60 cursor-wait' : 'btn-create text-white shadow-sm'
          }`}>
            {isAnalyzing ? '…' : <><i className="fas fa-wand-magic-sparkles"></i> {tr.concept.analyze}</>}
        </button>
      )}

      {/* Clear btn */}
      {audioFile && (
        <button type="button" onClick={() => { setAudioFile(null); setSuccess(false); setError(''); }}
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-all text-[9px]">
          <i className="fas fa-times"></i>
        </button>
      )}

      <input ref={fileInputRef} type="file" accept={ACCEPTED_AUDIO} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

      {error && <span className="text-[8px] text-red-500 font-bold flex-shrink-0">{error}</span>}
    </div>
  );
};

// ─── CONCEPT FORM ─────────────────────────────────────────────────────────
const ConceptForm: React.FC<ConceptFormProps> = ({ initialConcept, onSubmit }) => {
  const { tr } = useLang();
  const { showToast } = useToast();
  const opts = tr.conceptOptions;
  const [concept, setConcept] = useState<SongConcept>(initialConcept);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [randomCategory, setRandomCategory] = useState(() => tr.conceptOptions.randomThemes[0]);

  useEffect(() => { setConcept(initialConcept); }, [initialConcept]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSubmit(concept); };

  const handleRandomize = async () => {
    setIsRandomizing(true);
    try {
      const topic = await generateRandomTopic(randomCategory);
      setConcept(prev => ({ ...prev, topic }));
    } catch (err) { console.error(err); }
    finally { setIsRandomizing(false); }
  };

  const handleAnalyze = async () => {
    if (!concept.topic || concept.topic.length < 3) { showToast(tr.concept.enterTopicFirst, 'error'); return; }
    setIsAnalyzing(true);
    try {
      const s = await analyzeTopic(concept.topic, concept.isInstrumental);
      setConcept(prev => ({
        ...prev,
        genre:           s.genre?.length              ? s.genre           : prev.genre,
        mood:            s.mood?.length               ? s.mood            : prev.mood,
        tempo:           s.tempo?.length              ? s.tempo           : prev.tempo,
        instrumentation: s.instrumentation?.length    ? s.instrumentation : (prev.instrumentation ?? []),
        language:        prev.isInstrumental ? [] : (s.language?.length  ? s.language  : prev.language),
        vocals:          prev.isInstrumental ? [] : (s.vocals?.length    ? s.vocals    : prev.vocals),
      }));
    } catch (err) { console.error(err); }
    finally { setIsAnalyzing(false); }
  };

  const toggle = (key: keyof Pick<SongConcept, 'genre'|'mood'|'excludedStyles'|'language'|'vocals'|'tempo'|'instrumentation'>, val: string) => {
    setConcept(prev => {
      const cur = (prev[key] as string[] | undefined) ?? [];
      return { ...prev, [key]: cur.includes(val) ? cur.filter(i => i !== val) : [...cur, val] };
    });
  };

  const handleAudioAnalysis = (result: AudioAnalysisResult) => {
    setConcept(prev => ({
      ...prev,
      // Thema aus Audio-Analyse übernehmen wenn noch leer
      topic:           prev.topic.trim() ? prev.topic : (result.topicSuggestion || prev.topic),
      isInstrumental:  result.isInstrumental ?? prev.isInstrumental,
      // Felder nur überschreiben wenn bisher leer
      genre:           prev.genre.length           ? prev.genre           : (result.genre          ?? []),
      mood:            prev.mood.length            ? prev.mood            : (result.mood           ?? []),
      tempo:           prev.tempo.length           ? prev.tempo           : (result.tempo          ?? []),
      instrumentation: (prev.instrumentation?.length ?? 0) > 0 ? prev.instrumentation! : (result.instrumentation ?? []),
      vocals:          result.isInstrumental ? [] : (prev.vocals.length   ? prev.vocals            : (result.vocals    ?? [])),
      language:        result.isInstrumental ? [] : (prev.language.length ? prev.language          : (result.language  ?? [])),
    }));
  };

  return (
    <div className="relative">
    <form onSubmit={handleSubmit} className="space-y-6 animate-fade-up pb-24">

      {/* ═══ HEADER ═══ */}
      <div className="flex items-center gap-3">
        <p className="section-pill">{tr.concept.newProject}</p>
        <div className="gradient-line flex-1"></div>
      </div>

      {/* ═══ TOPIC CARD ═══ */}
      <div className="glass-card rounded-3xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-100">
            <i className="fas fa-lightbulb text-suno-primary mr-2"></i>{tr.concept.songIdea}
          </h3>

          {/* Instrumental Toggle */}
          <div
            className="flex items-center gap-2 cursor-pointer select-none group"
            onClick={() => setConcept(prev => ({ ...prev, isInstrumental: !prev.isInstrumental }))}
          >
            <span className={`text-[9px] font-black uppercase tracking-wider transition-colors ${!concept.isInstrumental ? 'text-suno-primary' : 'text-zinc-500 dark:text-zinc-600'}`}>{tr.concept.lyrics}</span>
            <div className={`w-10 h-5 rounded-full relative transition-all duration-300 border ${concept.isInstrumental ? 'suno-gradient border-suno-primary/60' : 'bg-zinc-200 dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600'}`}>
              <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-all duration-300 ${concept.isInstrumental ? 'left-[22px]' : 'left-0.5'}`}></div>
            </div>
            <span className={`text-[9px] font-black uppercase tracking-wider transition-colors ${concept.isInstrumental ? 'text-suno-primary' : 'text-zinc-500 dark:text-zinc-600'}`}>{tr.concept.instrumental}</span>
          </div>
        </div>

        <div className="relative">
          <textarea
            className="glass-input w-full rounded-2xl px-4 py-4 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 dark:placeholder:text-zinc-500 resize-none h-32 custom-scrollbar"
            placeholder={concept.isInstrumental ? tr.concept.placeholderInstrumental : tr.concept.placeholder}
            value={concept.topic}
            onChange={(e) => setConcept(prev => ({ ...prev, topic: e.target.value }))}
          />
        </div>

        {/* Referenz-Audio Upload Bar */}
        <AudioUploadBar onAnalysisComplete={handleAudioAnalysis} />

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Randomize */}
          <div className="flex items-center glass-btn rounded-xl overflow-hidden p-0">
            <select
              value={randomCategory}
              onChange={(e) => setRandomCategory(e.target.value)}
              className="bg-transparent text-[9px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 outline-none px-2.5 py-2 cursor-pointer border-r border-white/20 dark:border-white/8"
            >
              {opts.randomThemes.map(theme => <option key={theme} value={theme} className="bg-white dark:bg-zinc-900">{theme}</option>)}
            </select>
            <button type="button" onClick={handleRandomize} disabled={isRandomizing}
              className="px-3 py-2 text-suno-primary hover:bg-suno-primary/10 transition-colors text-sm"
              title={opts.randomizeTitle}>
              <i className={`fas fa-dice ${isRandomizing ? 'animate-spin' : ''}`}></i>
            </button>
          </div>

          {/* Inspiration button */}
          <button type="button" onClick={handleAnalyze}
            disabled={isAnalyzing || !concept.topic}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.15em] transition-all border ${
              isAnalyzing
                ? 'glass-btn text-suno-primary border-suno-primary/30 animate-pulse'
                : 'glass-btn text-suno-primary border-suno-primary/20 hover:bg-suno-primary hover:text-white hover:border-suno-primary'
            }`}>
            {isAnalyzing
              ? <><i className="fas fa-spinner animate-spin"></i> {tr.concept.inspiring}</>
              : <><i className="fas fa-wand-magic-sparkles"></i> {tr.concept.inspire}</>}
          </button>
        </div>
      </div>

      {/* ═══ FIELDS GRID ═══ */}
      <div className="glass-card rounded-3xl p-6 space-y-6">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
          <span className="section-pill">{tr.concept.details}</span>
          <span className="gradient-line flex-1 block"></span>
          <span className="text-zinc-600 dark:text-zinc-400">{tr.concept.optional}</span>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="relative">
            <SearchableMultiInput label={tr.concept.genre} icon="fa-music" options={opts.genres} selected={concept.genre}
              onToggle={(v) => toggle('genre', v)} placeholder={opts.genres.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing} />
          </div>
          <div className="relative">
            <SearchableMultiInput label={tr.concept.mood} icon="fa-face-smile" options={opts.moods} selected={concept.mood}
              onToggle={(v) => toggle('mood', v)} placeholder={opts.moods.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing} accent="text-suno-secondary" />
          </div>
          <div className="relative">
            <SearchableMultiInput label={tr.concept.language} icon="fa-globe" options={opts.languages} selected={concept.language}
              onToggle={(v) => toggle('language', v)} placeholder={opts.languages.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing}
              disabled={concept.isInstrumental} accent="text-emerald-500" />
          </div>
          <div className="relative">
            <SearchableMultiInput label={tr.concept.vocals} icon="fa-microphone" options={opts.vocals} selected={concept.vocals}
              onToggle={(v) => toggle('vocals', v)} placeholder={opts.vocals.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing}
              disabled={concept.isInstrumental} accent="text-blue-500" />
          </div>
          <div className="relative">
            <SearchableMultiInput label={tr.concept.tempo} icon="fa-gauge-high" options={opts.tempos} selected={concept.tempo}
              onToggle={(v) => toggle('tempo', v)} placeholder={opts.tempos.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing} accent="text-yellow-500" />
          </div>
          <div className="relative">
            <SearchableMultiInput label={tr.concept.instruments} icon="fa-guitar" options={opts.instruments} selected={concept.instrumentation ?? []}
              onToggle={(v) => toggle('instrumentation', v)} placeholder={opts.instruments.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing} accent="text-orange-500" />
          </div>
        </div>

        <div className="pt-2 border-t border-white/20 dark:border-white/8">
          <SearchableMultiInput label={tr.concept.exclude} icon="fa-ban" options={opts.exclusions} selected={concept.excludedStyles}
            onToggle={(v) => toggle('excludedStyles', v)} placeholder={opts.exclusions.slice(0, 2).join(', ') + '…'} accent="text-red-400" />
        </div>
      </div>

      {/* ═══ CREATE BUTTON ═══ (Abstand damit Dropdowns nicht überdeckt werden; z-0 damit Dropdowns z-50 darüber liegen) */}
      <div className="relative z-0 mt-20 md:mt-24">
        <div className="absolute -inset-0.5 suno-gradient rounded-3xl blur opacity-30 transition-opacity duration-500 group-hover:opacity-60"></div>
        <button type="submit"
          className="btn-create relative w-full py-5 md:py-6 rounded-3xl text-white font-black text-lg md:text-xl uppercase tracking-[0.2em] shadow-2xl flex items-center justify-center gap-3">
          <i className="fas fa-bolt text-lg"></i>
          {tr.concept.createBtn}
          <span className="absolute right-6 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium normal-case tracking-normal hidden md:block">
            Lyrics · Style · Cover
          </span>
        </button>
      </div>

    </form>

    {/* ═══ STICKY FLOATING CTA ═══ */}
    {concept.topic.trim().length > 2 && (
      <div className="fixed sticky-cta-safe left-1/2 -translate-x-1/2 z-40 animate-fade-up pointer-events-none">
        <button
          type="button"
          onClick={() => onSubmit(concept)}
          className="btn-create pointer-events-auto flex items-center gap-2.5 px-7 py-3.5 rounded-2xl text-white font-black text-sm uppercase tracking-[0.18em]"
          style={{ boxShadow: '0 8px 40px rgba(168,85,247,0.5), 0 2px 16px rgba(0,0,0,0.35)' }}
        >
          <i className="fas fa-bolt"></i>
          {tr.concept.createBtn}
        </button>
      </div>
    )}
    </div>
  );
};

export default ConceptForm;
