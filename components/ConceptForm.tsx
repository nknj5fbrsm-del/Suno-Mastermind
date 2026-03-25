
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SongConcept } from '../types';
import {
  analyzeTopic, generateRandomTopic, analyzeAudio, AudioAnalysisResult,
  generateGenreFusion, GenreFusionResult,
  generateCreativeBoost, CreativeBoostResult,
  synthesizeReferenceStyle, ReferenceStyleResult,
} from '../services/geminiService';
import { useLang, useToast } from '../App';
import SearchableMultiInput from './SearchableMultiInput';

interface ConceptFormProps {
  initialConcept: SongConcept;
  onSubmit: (concept: SongConcept) => void;
  /** Wird bei jeder Änderung aufgerufen, damit die App den aktuellen Konzept-Stand behält (z. B. beim Tab-Wechsel ohne „Weiter“). */
  onConceptChange?: (concept: SongConcept) => void;
}

// ─── Deduplizierung inhaltlich (Groß-/Kleinschreibung ignorieren), erste Schreibweise behalten ───
function dedupeByContent(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const key = s.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Tempo: 0/1 Eintrag unverändert; 2+ Einträge → ein Wert oder Bereich "min–max" ───
function normalizeTempoToSingleOrRange(arr: string[]): string[] {
  if (arr.length <= 1) return arr;
  const numbers: number[] = [];
  for (const s of arr) {
    const m = s.trim().match(/\d+/);
    if (m) numbers.push(parseInt(m[0], 10));
  }
  if (numbers.length >= 2) {
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    return [min === max ? String(min) : `${min}–${max}`];
  }
  return [arr[0]];
}

// ─── AUDIO UPLOAD ZONE ────────────────────────────────────────────────────
const ACCEPTED_AUDIO = '.mp3,.wav,.ogg,.flac,.aac,.webm,.m4a';
const MAX_FILE_MB = 18;

interface AudioFile {
  name: string;
  sizeMB: number;
  base64: string;
  mimeType: string;
}

const readAudioFile = (file: File): Promise<AudioFile> =>
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

// ─── REFERENZ-MIXER ───────────────────────────────────────────────────────
// Browserzeile: suno.com/song/UUID
// Share-Button: suno.com/s/KURZID → Redirect auf suno.com/song/UUID
const SUNO_PATH_REGEX = /(?:suno\.com|app\.suno\.ai|[\w-]+\.suno\.\w+)\/(?:song|track)\/([a-f0-9-]{36})/i;
const SUNO_SHORT_REGEX = /(?:https?:\/\/)?(?:suno\.com|app\.suno\.ai)\/s\/([a-zA-Z0-9_-]+)/i;
const UUID_REGEX = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
const SUNO_CDN_BASE = 'https://cdn1.suno.ai';

function extractSunoId(url: string): string | null {
  const trimmed = url.trim();
  const fromPath = trimmed.match(SUNO_PATH_REGEX);
  if (fromPath?.[1]) return fromPath[1];
  if (/suno/i.test(trimmed)) {
    const uuid = trimmed.match(UUID_REGEX);
    if (uuid?.[0]) return uuid[0];
  }
  return null;
}

/** Erkennt Share-Link (suno.com/s/KURZID). Gibt die Short-URL zurück zum Auflösen. */
function getSunoShortUrl(url: string): string | null {
  const trimmed = url.trim();
  const m = trimmed.match(SUNO_SHORT_REGEX);
  if (!m) return null;
  const path = m[0]!;
  return path.startsWith('http') ? path : `https://suno.com/s/${m[1]}`;
}

/** Sucht Song-UUID in HTML (z. B. /song/UUID). */
const SONG_UUID_IN_HTML = /\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;

async function fetchViaProxy(targetUrl: string): Promise<string> {
  const encoded = encodeURIComponent(targetUrl);
  const proxies = [
    'https://api.allorigins.win/raw?url=' + encoded,
    'https://corsproxy.io/?' + encoded,
  ];
  for (const proxyUrl of proxies) {
    try {
      const res = await fetch(proxyUrl, { method: 'GET' });
      if (res.ok) return await res.text();
    } catch {
      continue;
    }
  }
  throw new Error('Proxy nicht erreichbar');
}

/** Löst Suno-Share-Link (z. B. https://suno.com/s/KURZID) auf und liefert die Song-UUID. */
async function resolveSunoShortLink(fullShortUrl: string): Promise<string | null> {
  const url = fullShortUrl.trim().startsWith('http') ? fullShortUrl.trim() : `https://suno.com/s/${fullShortUrl.trim().replace(/^\/s\/?/, '')}`;

  // 1. Direkt (funktioniert nur ohne CORS-Block)
  try {
    const res = await fetch(url, { redirect: 'follow', method: 'GET' });
    const fromUrl = extractSunoId(res.url || '');
    if (fromUrl) return fromUrl;
  } catch {
    /* CORS – Fallback über Proxy */
  }

  // 2. Über CORS-Proxy: Short-URL abrufen (Proxy folgt Redirects), UUID aus HTML
  try {
    const html = await fetchViaProxy(url);
    const m = html.match(SONG_UUID_IN_HTML);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

async function fetchSunoAudio(songId: string): Promise<{ base64: string; mimeType: string; sizeBytes: number }> {
  const url = `${SUNO_CDN_BASE}/${songId}.mp3`;
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(res.status === 404 ? 'Song nicht gefunden (privat oder abgelaufen?).' : `Laden fehlgeschlagen (${res.status}).`);

  const blob = await res.blob();
  const sizeBytes = blob.size;

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string | null;
      if (!result) {
        reject(new Error('Lesefehler'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Lesefehler'));
    reader.readAsDataURL(blob);
  });

  return { base64, mimeType: blob.type || 'audio/mpeg', sizeBytes };
}

interface MixerSlot {
  file: AudioFile | null;
  analysis: AudioAnalysisResult | null;
  analyzing: boolean;
  error: string;
  sourceMode: 'upload' | 'url';
  sunoUrl: string;
  sunoLoading: boolean;
}

const emptySlot = (): MixerSlot => ({
  file: null, analysis: null, analyzing: false, error: '',
  sourceMode: 'upload', sunoUrl: '', sunoLoading: false,
});

const ReferenzMixer: React.FC<{
  onApply: (result: ReferenceStyleResult) => void;
  onApplySingle?: (result: AudioAnalysisResult) => void;
}> = ({ onApply, onApplySingle }) => {
  const { tr } = useLang();
  const { showToast } = useToast();
  const [isOpen, setIsOpen]           = useState(false);
  const [slots, setSlots]             = useState<MixerSlot[]>([emptySlot(), emptySlot(), emptySlot()]);
  const [isSynthesizing, setIsSynth]  = useState(false);
  const [synthResult, setSynthResult] = useState<ReferenceStyleResult | null>(null);
  const fileRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const setSlot = (idx: number, patch: Partial<MixerSlot>) =>
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));

  const handleFile = async (idx: number, file: File) => {
    setSlot(idx, { error: '', analysis: null, sourceMode: 'upload' });
    try {
      const af = await readAudioFile(file);
      setSlot(idx, { file: af });
    } catch (e: any) {
      setSlot(idx, { error: e.message || 'Fehler' });
    }
  };

  const handleSunoLoad = async (idx: number) => {
    const slot = slots[idx];
    const rawUrl = slot.sunoUrl.trim();

    if (!rawUrl) {
      setSlot(idx, { error: tr.concept.refMixerSunoInvalid });
      return;
    }

    let id = extractSunoId(rawUrl);
    if (!id) {
      const shortUrl = getSunoShortUrl(rawUrl);
      if (shortUrl) {
        setSlot(idx, { sunoLoading: true, error: '' });
        try {
          id = await resolveSunoShortLink(shortUrl);
        } catch {
          setSlot(idx, { sunoLoading: false, error: tr.concept.refMixerSunoShareCors });
          return;
        }
        if (!id) {
          setSlot(idx, { sunoLoading: false, error: tr.concept.refMixerSunoInvalid });
          return;
        }
      } else {
        setSlot(idx, { error: tr.concept.refMixerSunoInvalid });
        return;
      }
    }
    setSlot(idx, { sunoLoading: true, error: '' });
    try {
      const { base64, mimeType, sizeBytes } = await fetchSunoAudio(id);
      const sizeMB = Math.round((sizeBytes / 1024 / 1024) * 10) / 10;
      setSlot(idx, {
        file: { name: `Suno-${id.slice(0, 8)}.mp3`, sizeMB, base64, mimeType },
        sunoLoading: false,
        sourceMode: 'url',
      });
    } catch (e: any) {
      const msg = e?.message || (e?.name === 'TypeError' && e?.message?.includes('Failed to fetch') ? tr.concept.refMixerSunoCors : 'Laden fehlgeschlagen.');
      setSlot(idx, { sunoLoading: false, error: msg });
    }
  };

  const clearSlot = (idx: number) => {
    setSlot(idx, emptySlot());
  };

  const analyzeSlot = async (idx: number) => {
    const slot = slots[idx];
    if (!slot.file || slot.analyzing) return;
    setSlot(idx, { analyzing: true, error: '', analysis: null });
    try {
      const result = await analyzeAudio(slot.file.base64, slot.file.mimeType);
      setSlot(idx, { analysis: result, analyzing: false });
    } catch (e: any) {
      setSlot(idx, { error: e.message || 'Analyse fehlgeschlagen.', analyzing: false });
    }
  };

  const analyzeAll = async () => {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].file && !slots[i].analysis && !slots[i].analyzing) {
        await analyzeSlot(i);
      }
    }
  };

  const handleSynthesize = async () => {
    const completed = slots.filter(s => s.analysis !== null).map(s => s.analysis!);
    if (completed.length === 0) return;
    setIsSynth(true);
    setSynthResult(null);
    try {
      const result = await synthesizeReferenceStyle(completed);
      setSynthResult(result);
    } catch (e: any) {
      showToast(e.message || 'Synthese fehlgeschlagen.', 'error');
    } finally { setIsSynth(false); }
  };

  const handleApply = () => {
    if (!synthResult) return;
    onApply(synthResult);
    setSynthResult(null);
  };

  const analyzedCount = slots.filter(s => s.analysis !== null).length;
  const pendingAnalysis = slots.filter(s => s.file && !s.analysis && !s.analyzing).length;
  const anyAnalyzing   = slots.some(s => s.analyzing);

  return (
    <div className="glass-card rounded-3xl overflow-hidden">
      {/* ── Header / Toggle ── */}
      <button
        type="button"
        onClick={() => setIsOpen(p => !p)}
        className="w-full flex items-center justify-between px-6 py-4 group hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-xl bg-suno-primary/15 flex items-center justify-center flex-shrink-0">
            <i className="fas fa-layer-group text-suno-primary text-[11px]"></i>
          </div>
          <div className="text-left min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-black uppercase tracking-wider text-zinc-100">
                {tr.concept.refMixer}
              </span>
              {analyzedCount > 0 && (
                <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/25">
                  {analyzedCount} {tr.concept.refMixerAnalyzed}
                </span>
              )}
            </div>
          </div>
        </div>
        <i className={`fas fa-chevron-down text-zinc-400 text-[11px] transition-transform flex-shrink-0 ml-3 ${isOpen ? 'rotate-180' : ''}`}></i>
      </button>

      {/* ── Body ── */}
      {isOpen && (
        <div className="px-6 pb-6 space-y-4 border-t border-white/10 dark:border-white/8 pt-4">

          {/* Slots */}
          <div className="space-y-2">
            {slots.map((slot, idx) => (
              <div key={idx} className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl border transition-all ${
                slot.analysis
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : slot.error
                  ? 'border-red-500/30 bg-red-500/5'
                  : 'border-zinc-200 dark:border-zinc-700/60 bg-white/30 dark:bg-white/[0.03]'
              }`}>
                {/* Slot icon */}
                <div className="flex-shrink-0">
                  {slot.analysis
                    ? <i className="fas fa-check-circle text-emerald-500 text-[12px]"></i>
                    : slot.analyzing
                    ? <i className="fas fa-spinner animate-spin text-suno-primary text-[11px]"></i>
                    : <i className="fas fa-waveform-lines text-zinc-400 text-[11px]"></i>}
                </div>

                {/* Label / file info or empty slot (upload vs link) */}
                <div className="flex-1 min-w-0">
                  {slot.file ? (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <i className={`${slot.sourceMode === 'url' ? 'fas fa-link' : 'fas fa-file-audio'} text-suno-primary text-[9px] flex-shrink-0`}></i>
                      <span className="text-[9px] font-medium text-zinc-200 truncate" title={slot.file.name}>{slot.file.name}</span>
                      <span className="text-[8px] text-zinc-400 flex-shrink-0">{slot.file.sizeMB} MB</span>
                    </div>
                  ) : (
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-300">{tr.concept.refMixerSlot} {idx + 1}</span>
                        <div className="flex rounded-lg overflow-visible border border-zinc-200 dark:border-zinc-600 bg-zinc-100/50 dark:bg-zinc-800/30">
                          <button
                            type="button"
                            onClick={() => {
                              setSlot(idx, { ...slot, sourceMode: 'upload', error: '' });
                              setTimeout(() => fileRefs[idx].current?.click(), 0);
                            }}
                            className={`relative z-10 min-w-[3.5rem] px-2.5 py-1.5 text-[8px] font-bold uppercase tracking-wider transition-all cursor-pointer rounded-l-md ${slot.sourceMode === 'upload' ? 'bg-suno-primary/25 text-suno-primary hover:bg-suno-primary/35' : 'text-zinc-400 hover:bg-suno-secondary/25 hover:text-suno-secondary hover:ring-2 hover:ring-suno-secondary/50 hover:ring-inset'}`}
                          >
                            {tr.concept.refMixerByFile}
                          </button>
                          <button type="button" onClick={() => setSlot(idx, { ...slot, sourceMode: 'url', error: '' })}
                            className={`relative z-10 min-w-[3.5rem] px-2.5 py-1.5 text-[8px] font-bold uppercase tracking-wider transition-all cursor-pointer rounded-r-md ${slot.sourceMode === 'url' ? 'bg-suno-primary/25 text-suno-primary hover:bg-suno-primary/35' : 'text-zinc-400 hover:bg-suno-primary/15 hover:text-suno-primary'}`}>
                            {tr.concept.refMixerByLink}
                          </button>
                        </div>
                      </div>
                      {slot.sourceMode === 'upload' && (
                        <button type="button" onClick={() => fileRefs[idx].current?.click()}
                          className="flex items-center gap-1.5 text-[9px] font-medium text-zinc-200 hover:text-suno-primary transition-colors">
                          <i className="fas fa-arrow-up-from-bracket text-[8px]"></i>
                          {tr.concept.fileChoose}
                        </button>
                      )}
                      {slot.sourceMode === 'url' && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <input type="url" placeholder={tr.concept.refMixerSunoPlaceholder}
                              value={slot.sunoUrl} onChange={(e) => setSlot(idx, { sunoUrl: e.target.value, error: '' })}
                              className="flex-1 min-w-[140px] max-w-[220px] px-2.5 py-1.5 rounded-lg text-[10px] glass-input border border-zinc-200 dark:border-zinc-600 placeholder:text-zinc-400"
                            />
                            <button type="button" onClick={() => handleSunoLoad(idx)} disabled={slot.sunoLoading}
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${slot.sunoLoading ? 'glass-btn text-suno-primary opacity-70' : 'btn-create text-white shadow-sm'}`}>
                              {slot.sunoLoading ? <i className="fas fa-spinner animate-spin"></i> : <i className="fas fa-download"></i>}
                              {slot.sunoLoading ? tr.concept.refMixerSunoLoading : tr.concept.refMixerSunoLoad}
                            </button>
                          </div>
                          <p className="text-[8px] text-zinc-400">
                            {tr.concept.refMixerLinkHint}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {slot.error && <p className="text-[8px] text-red-500 font-bold mt-0.5">{slot.error}</p>}
                  {slot.analysis && (
                    <p className="text-[8px] text-emerald-500 font-bold mt-0.5 truncate">
                      {(slot.analysis.genre ?? []).slice(0, 2).join(' · ')}
                    </p>
                  )}
                </div>

                {/* Analyze button */}
                {slot.file && !slot.analysis && !slot.analyzing && (
                  <button type="button" onClick={() => analyzeSlot(idx)}
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider btn-create text-white shadow-sm transition-all">
                    <i className="fas fa-wand-magic-sparkles"></i> {tr.concept.refMixerAnalyze}
                  </button>
                )}

                {/* Remove button */}
                {slot.file && (
                  <button type="button" onClick={() => clearSlot(idx)}
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-all text-[9px]">
                    <i className="fas fa-times"></i>
                  </button>
                )}

                <input ref={fileRefs[idx]} type="file" accept={ACCEPTED_AUDIO} className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(idx, f); e.target.value = ''; }} />
              </div>
            ))}
          </div>

          {/* Action row */}
          <div className="flex items-center gap-2 flex-wrap">
            {pendingAnalysis > 1 && (
              <button type="button" onClick={analyzeAll} disabled={anyAnalyzing}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] glass-btn text-suno-primary border border-suno-primary/20 hover:bg-suno-primary/10 transition-all">
                <i className={`fas fa-wand-magic-sparkles ${anyAnalyzing ? 'animate-spin' : ''}`}></i>
                {tr.concept.refMixerAnalyzeAll}
              </button>
            )}

            {analyzedCount === 1 && onApplySingle && (() => {
              const slotWithAnalysis = slots.find(s => s.analysis !== null);
              const singleAnalysis = slotWithAnalysis?.analysis ?? null;
              return singleAnalysis ? (
                <button type="button" onClick={() => onApplySingle(singleAnalysis)}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-bold uppercase tracking-[0.15em] glass-btn text-suno-primary border border-suno-primary/20 hover:bg-suno-primary hover:text-white hover:border-suno-primary transition-all">
                  <i className="fas fa-check"></i> {tr.concept.refMixerApplySingle}
                </button>
              ) : null;
            })()}

            {analyzedCount >= 2 && (
              <button type="button" onClick={handleSynthesize} disabled={isSynthesizing}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-bold uppercase tracking-[0.15em] transition-all border ${
                  isSynthesizing
                    ? 'glass-btn text-suno-primary border-suno-primary/30 animate-pulse'
                    : 'glass-btn text-suno-primary border-suno-primary/20 hover:bg-suno-primary hover:text-white hover:border-suno-primary'
                }`}>
                {isSynthesizing
                  ? <><i className="fas fa-spinner animate-spin"></i> {tr.concept.refMixerSynthesizing}</>
                  : <><i className="fas fa-layer-group"></i> {tr.concept.refMixerSynthesize}</>}
              </button>
            )}
          </div>

          {/* ── Synthesis Result ── */}
          {synthResult && (
            <div className="rounded-2xl border border-suno-primary/30 bg-suno-primary/5 dark:bg-suno-primary/10 p-4 space-y-3 animate-scale-in">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-suno-primary/20 flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-layer-group text-suno-primary text-[11px]"></i>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-suno-primary">{tr.concept.refMixerFusionLabel}</p>
                    <p className="text-sm font-black text-zinc-800 dark:text-zinc-100">{synthResult.fusionLabel}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setSynthResult(null)}
                  className="w-5 h-5 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-500 text-[9px] flex-shrink-0 transition-all">
                  <i className="fas fa-times"></i>
                </button>
              </div>

              {/* Genre / Mood / Tempo pills */}
              <div className="flex flex-wrap gap-1.5">
                {synthResult.genre.map((g, i) => (
                  <span key={`g${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-suno-primary/10 text-suno-primary border border-suno-primary/20">
                    <i className="fas fa-music mr-1 text-[7px]"></i>{g}
                  </span>
                ))}
                {synthResult.mood.map((m, i) => (
                  <span key={`m${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-suno-secondary/10 text-suno-secondary border border-suno-secondary/20">
                    {m}
                  </span>
                ))}
                {synthResult.tempo.map((t, i) => (
                  <span key={`t${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-yellow-500/10 text-yellow-600 border border-yellow-500/20">
                    <i className="fas fa-gauge-high mr-1 text-[7px]"></i>{t}
                  </span>
                ))}
                {synthResult.instrumentation.map((ins, i) => (
                  <span key={`i${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-orange-500/10 text-orange-500 border border-orange-500/20">
                    <i className="fas fa-guitar mr-1 text-[7px]"></i>{ins}
                  </span>
                ))}
              </div>

              {/* Seeds */}
              <div className="space-y-1.5">
                {synthResult.stylePromptSeed && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-white/40 dark:bg-black/20">
                    <i className="fas fa-tag text-suno-primary text-[9px] mt-0.5 flex-shrink-0"></i>
                    <div className="min-w-0">
                      <p className="text-[8px] font-black uppercase tracking-wider text-suno-primary mb-0.5">{tr.concept.refMixerStyleSeed}</p>
                      <p className="text-[10px] text-zinc-600 dark:text-zinc-300 leading-relaxed italic">{synthResult.stylePromptSeed}</p>
                    </div>
                  </div>
                )}
                {synthResult.regieSeed && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-white/40 dark:bg-black/20">
                    <i className="fas fa-clapperboard text-amber-500 text-[9px] mt-0.5 flex-shrink-0"></i>
                    <div className="min-w-0">
                      <p className="text-[8px] font-black uppercase tracking-wider text-amber-500 mb-0.5">{tr.concept.refMixerRegieSeed}</p>
                      <p className="text-[10px] text-zinc-600 dark:text-zinc-300 leading-relaxed font-mono">{synthResult.regieSeed}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={handleApply}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-suno-primary/15 border border-suno-primary/30 text-suno-primary hover:bg-suno-primary hover:text-white transition-all">
                  <i className="fas fa-check"></i> {tr.concept.refMixerApply}
                </button>
                <button type="button" onClick={() => setSynthResult(null)}
                  className="px-3 py-2 rounded-xl text-[10px] font-bold glass-btn text-zinc-500 hover:text-red-500 transition-all">
                  {tr.concept.refMixerDismiss}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── CONCEPT FORM ─────────────────────────────────────────────────────────
const ConceptForm: React.FC<ConceptFormProps> = ({ initialConcept, onSubmit, onConceptChange }) => {
  const { tr } = useLang();
  const { showToast } = useToast();
  const opts = tr.conceptOptions;
  const [concept, setConcept] = useState<SongConcept>(initialConcept);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [randomCategory, setRandomCategory] = useState(() => tr.conceptOptions.randomThemes[0]);

  // Genre-Fusion Lab
  const [isFusing, setIsFusing] = useState(false);
  const [fusionResult, setFusionResult] = useState<GenreFusionResult | null>(null);

  // Kreativ-Boost
  const [isBoosting, setIsBoosting] = useState(false);
  const [boostResult, setBoostResult] = useState<CreativeBoostResult | null>(null);

  // Kreativ-Lab (gesamt ein-/ausklappbar)
  const [isLabOpen, setIsLabOpen] = useState(false);
  const [labHelpModalOpen, setLabHelpModalOpen] = useState(false);
  const [genreFieldPulse, setGenreFieldPulse] = useState(false);
  const genreFieldRef = useRef<HTMLDivElement>(null);
  // Verhindert Flackern im Song-Idee-Feld: Rücksync vom Parent überspringen, wenn die Änderung von uns kam
  const lastSentTopicRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastSentTopicRef.current !== null && initialConcept.topic === lastSentTopicRef.current) {
      lastSentTopicRef.current = null;
      return;
    }
    setConcept(initialConcept);
  }, [initialConcept]);

  // Jede Änderung an die App melden, damit beim Tab-Wechsel (ohne „Weiter“) nichts verloren geht
  useEffect(() => {
    onConceptChange?.(concept);
    lastSentTopicRef.current = concept.topic;
  }, [concept]);

  const focusGenreField = () => {
    setGenreFieldPulse(true);
    genreFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setGenreFieldPulse(false), 2500);
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSubmit(concept); };

  const handleRandomize = async () => {
    setIsRandomizing(true);
    try {
      const topic = await generateRandomTopic(randomCategory);
      setConcept(prev => ({ ...prev, topic }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast(tr.errors.aiErrorPrefix + msg, 'error');
    } finally { setIsRandomizing(false); }
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast(tr.errors.aiErrorPrefix + msg, 'error');
    } finally { setIsAnalyzing(false); }
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
      topic:           prev.topic.trim() ? prev.topic : (result.topicSuggestion || prev.topic),
      isInstrumental:  result.isInstrumental ?? prev.isInstrumental,
      genre:           prev.genre.length           ? prev.genre           : (result.genre          ?? []),
      mood:            prev.mood.length            ? prev.mood            : (result.mood           ?? []),
      tempo:           prev.tempo.length           ? prev.tempo           : (result.tempo          ?? []),
      instrumentation: (prev.instrumentation?.length ?? 0) > 0 ? prev.instrumentation! : (result.instrumentation ?? []),
      vocals:          result.isInstrumental ? [] : (prev.vocals.length   ? prev.vocals            : (result.vocals    ?? [])),
      language:        result.isInstrumental ? [] : (prev.language.length ? prev.language          : (result.language  ?? [])),
    }));
  };

  // ─── Referenz-Mixer ───
  const handleMixerApply = (result: ReferenceStyleResult) => {
    setConcept(prev => {
      const genre = result.genre.length ? dedupeByContent([...prev.genre, ...result.genre]) : prev.genre;
      const mood = result.mood.length ? dedupeByContent([...prev.mood, ...result.mood]) : prev.mood;
      const tempoRaw = result.tempo.length ? dedupeByContent([...prev.tempo, ...result.tempo]) : prev.tempo;
      const tempo = normalizeTempoToSingleOrRange(tempoRaw);
      const instrumentation = result.instrumentation.length ? dedupeByContent([...(prev.instrumentation ?? []), ...result.instrumentation]) : prev.instrumentation;
      return { ...prev, genre, mood, tempo, instrumentation };
    });
    showToast('Referenz-Stil übernommen ✓', 'success');
  };

  // ─── Genre-Fusion Lab ───
  const handleFusion = async () => {
    if (concept.genre.length < 2 || isFusing) return;
    setIsFusing(true);
    setFusionResult(null);
    try {
      const result = await generateGenreFusion(concept.genre, concept);
      setFusionResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast('Fusion fehlgeschlagen: ' + msg, 'error');
    }
    finally { setIsFusing(false); }
  };

  const applyFusion = () => {
    if (!fusionResult) return;
    setConcept(prev => {
      const newInstr = [...(prev.instrumentation ?? [])];
      fusionResult.suggestedInstruments.forEach(i => { if (!newInstr.includes(i)) newInstr.push(i); });
      const newMood = [...prev.mood];
      fusionResult.suggestedMood.forEach(m => { if (!newMood.includes(m)) newMood.push(m); });
      const newTempo = [...prev.tempo];
      if (fusionResult.suggestedBPM && !newTempo.includes(fusionResult.suggestedBPM)) newTempo.push(fusionResult.suggestedBPM);
      const instrumentation = dedupeByContent(newInstr);
      const mood = dedupeByContent(newMood);
      const tempo = normalizeTempoToSingleOrRange(dedupeByContent(newTempo));
      return { ...prev, instrumentation, mood, tempo };
    });
    setFusionResult(null);
  };

  // ─── Kreativ-Boost ───
  const handleBoost = async () => {
    if (isBoosting) return;
    setIsBoosting(true);
    setBoostResult(null);
    try {
      const result = await generateCreativeBoost(concept);
      setBoostResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast('Boost fehlgeschlagen: ' + msg, 'error');
    }
    finally { setIsBoosting(false); }
  };

  const applyBoost = () => {
    if (!boostResult) return;
    setConcept(prev => {
      const newGenre = [...prev.genre];
      boostResult.addGenres.forEach(g => { if (!newGenre.includes(g)) newGenre.push(g); });
      const newInstr = [...(prev.instrumentation ?? [])];
      boostResult.addInstruments.forEach(i => { if (!newInstr.includes(i)) newInstr.push(i); });
      const newMood = [...prev.mood];
      boostResult.addMoods.forEach(m => { if (!newMood.includes(m)) newMood.push(m); });
      return {
        ...prev,
        genre: dedupeByContent(newGenre),
        instrumentation: dedupeByContent(newInstr),
        mood: dedupeByContent(newMood),
      };
    });
    setBoostResult(null);
  };

  const kreativLabContent = isLabOpen ? (
    <div className="space-y-4 pt-2 border-t border-white/10 dark:border-white/5">
      {/* Referenz-Mixer */}
      <ReferenzMixer onApply={handleMixerApply} onApplySingle={handleAudioAnalysis} />

      {/* Fusion & Boost nebeneinander */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Genre-Fusion Block */}
        <div
          className={`rounded-2xl border border-suno-primary/25 bg-suno-primary/5 dark:bg-suno-primary/10 p-4 space-y-3 ${concept.genre.length < 2 ? 'cursor-pointer hover:bg-suno-primary/10 dark:hover:bg-suno-primary/15 transition-colors' : ''}`}
          onClick={concept.genre.length < 2 ? focusGenreField : undefined}
          role={concept.genre.length < 2 ? 'button' : undefined}
          tabIndex={concept.genre.length < 2 ? 0 : undefined}
          onKeyDown={concept.genre.length < 2 ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusGenreField(); } } : undefined}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-suno-primary/20 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-shuffle text-suno-primary text-[10px]"></i>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-suno-primary">{tr.concept.fusionLab}</p>
                <p className="text-[11px] text-zinc-200 dark:text-zinc-100">
                  {concept.genre.length >= 2 ? concept.genre.join(' + ') : tr.concept.genre}
                </p>
              </div>
            </div>
          </div>

          {concept.genre.length >= 2 ? (
            <button
              type="button"
              onClick={handleFusion}
              disabled={isFusing}
              className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[9px] font-bold uppercase tracking-[0.12em] transition-all border ${
                isFusing
                  ? 'glass-btn text-suno-primary border-suno-primary/30 animate-pulse'
                  : 'glass-btn text-suno-primary border-suno-primary/20 hover:bg-suno-primary hover:text-white hover:border-suno-primary'
              }`}
            >
              {isFusing ? (
                <>
                  <i className="fas fa-spinner animate-spin"></i> {tr.concept.fusionLabLoading}
                </>
              ) : (
                <>
                  <i className="fas fa-shuffle"></i> {tr.concept.fusionLab}
                </>
              )}
            </button>
          ) : (
            <p className="text-[9px] text-zinc-500 dark:text-zinc-500">
              {tr.concept.fusionHintMinTwo}
            </p>
          )}

          {fusionResult && (
            <div className="rounded-2xl border border-suno-primary/40 bg-suno-primary/10 dark:bg-suno-primary/20 p-4 space-y-3 animate-scale-in">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-suno-primary/30 flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-shuffle text-suno-primary text-[10px]"></i>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-suno-primary">{tr.concept.fusionLab}</p>
                    <p className="text-[13px] font-black text-zinc-800 dark:text-zinc-100">{fusionResult.fusionName}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setFusionResult(null)}
                  className="w-5 h-5 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-500 text-[9px] flex-shrink-0">
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed italic">{fusionResult.description}</p>

              <div className="flex flex-wrap gap-1.5">
                {fusionResult.suggestedInstruments.map((inst, i) => (
                  <span key={i} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    <i className="fas fa-guitar mr-1 text-[7px]"></i>{inst}
                  </span>
                ))}
                <span className="text-[9px] font-bold px-2 py-1 rounded-lg bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                  <i className="fas fa-gauge-high mr-1 text-[7px]"></i>{fusionResult.suggestedBPM}
                </span>
                {fusionResult.suggestedMood.map((m, i) => (
                  <span key={i} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-suno-secondary/10 text-suno-secondary border border-suno-secondary/20">
                    {m}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={applyFusion}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider bg-suno-primary/15 border border-suno-primary/30 text-suno-primary hover:bg-suno-primary hover:text-white transition-all">
                  <i className="fas fa-check"></i> {tr.concept.fusionApply}
                </button>
                <button type="button" onClick={() => setFusionResult(null)}
                  className="px-2.5 py-1.5 rounded-xl text-[9px] font-bold glass-btn text-zinc-500 hover:text-red-500 transition-all">
                  {tr.concept.fusionDismiss}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Kreativ-Boost Block */}
        <div className="rounded-2xl border border-suno-secondary/25 bg-suno-secondary/5 dark:bg-suno-secondary/10 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-suno-secondary/20 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-bolt text-suno-secondary text-sm"></i>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-suno-secondary">{tr.concept.creativeBoost}</p>
              </div>
            </div>
          </div>

          <button type="button" onClick={handleBoost}
            disabled={isBoosting}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all border ${
              isBoosting
                ? 'glass-btn text-suno-secondary border-suno-secondary/30 animate-pulse'
                : 'glass-btn text-suno-secondary border-suno-secondary/20 hover:bg-suno-secondary hover:text-white hover:border-suno-secondary'
            }`}>
            {isBoosting
              ? <><i className="fas fa-spinner animate-spin"></i> {tr.concept.creativeBoostLoading}</>
              : <><i className="fas fa-bolt"></i> {tr.concept.creativeBoost}</>}
          </button>

          {boostResult && (
            <div className="space-y-3 animate-scale-in">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl bg-suno-secondary/25 flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-bolt text-suno-secondary text-sm"></i>
                  </div>
                  <div>
                    <p className="text-sm font-black text-zinc-800 dark:text-zinc-100">{boostResult.twistTitle}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setBoostResult(null)}
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-all text-[10px] flex-shrink-0">
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <p className="text-[12px] text-zinc-600 dark:text-zinc-300 leading-relaxed">{boostResult.twistDescription}</p>

              <div className="flex flex-wrap gap-1.5">
                {boostResult.addGenres.map((g, i) => (
                  <span key={`g${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-suno-primary/10 text-suno-primary border border-suno-primary/20">
                    <i className="fas fa-music mr-1 text-[7px]"></i>{g}
                  </span>
                ))}
                {boostResult.addInstruments.map((inst, i) => (
                  <span key={`i${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-orange-500/10 text-orange-500 border border-orange-500/20">
                    <i className="fas fa-guitar mr-1 text-[7px]"></i>{inst}
                  </span>
                ))}
                {boostResult.addMoods.map((m, i) => (
                  <span key={`m${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-suno-secondary/10 text-suno-secondary border border-suno-secondary/20">
                    <i className="fas fa-face-smile mr-1 text-[7px]"></i>{m}
                  </span>
                ))}
              </div>

              {boostResult.productionTip && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-white/40 dark:bg-black/20">
                  <i className="fas fa-lightbulb text-amber-500 text-[10px] mt-0.5 flex-shrink-0"></i>
                  <p className="text-[10px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                    <span className="font-black uppercase tracking-wider text-amber-500 mr-1">{tr.concept.boostTip}:</span>
                    {boostResult.productionTip}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={applyBoost}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-suno-secondary/15 border border-suno-secondary/30 text-suno-secondary hover:bg-suno-secondary hover:text-white transition-all">
                  <i className="fas fa-check"></i> {tr.concept.boostApply}
                </button>
                <button type="button" onClick={() => setBoostResult(null)}
                  className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider glass-btn text-zinc-500 hover:text-red-500 transition-all">
                  {tr.concept.boostDismiss}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

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

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Randomize */}
          <div className="flex items-center glass-btn rounded-xl overflow-hidden p-0">
            <select
              value={randomCategory}
              onChange={(e) => setRandomCategory(e.target.value)}
              className="bg-transparent text-[10px] font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 outline-none px-2.5 py-2 cursor-pointer border-r border-white/20 dark:border-white/8"
            >
              {opts.randomThemes.map(theme => <option key={theme} value={theme} className="bg-white dark:bg-zinc-900">{theme}</option>)}
            </select>
            <button type="button" onClick={handleRandomize} disabled={isRandomizing}
              className="px-3 py-2 text-suno-primary hover:bg-suno-primary/10 transition-colors text-sm"
              title={opts.randomizeTitle}>
              <i className={`fas fa-dice ${isRandomizing ? 'animate-spin' : ''}`}></i>
            </button>
          </div>

          {/* Inspiration */}
          <button type="button" onClick={handleAnalyze}
            disabled={isAnalyzing || !concept.topic}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-bold uppercase tracking-[0.15em] transition-all border ${
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

      {/* ═══ KREATIV-LAB ═══ */}
      <div className="glass-card rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setIsLabOpen(v => !v)}
            className="flex-1 flex items-center justify-between gap-3 group min-w-0"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-2xl bg-suno-secondary/15 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-flask text-suno-secondary text-sm"></i>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-suno-secondary">{tr.concept.creativeLab}</p>
                {isLabOpen && (
                  <p className="mt-0.5 text-[9px] font-bold text-zinc-300 md:hidden">
                    {tr.concept.refMixer}
                  </p>
                )}
              </div>
            </div>
            <i className={`fas fa-chevron-down text-zinc-400 text-[11px] transition-transform flex-shrink-0 ${isLabOpen ? 'rotate-180' : ''}`}></i>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLabHelpModalOpen(true); }}
            className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 hover:text-suno-secondary transition-colors px-2 py-1 rounded-lg hover:bg-suno-secondary/10"
          >
            {tr.concept.creativeLabShortDescBtn}
          </button>
        </div>

        {labHelpModalOpen && createPortal(
          <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setLabHelpModalOpen(false)}>
            <div
              className="w-full max-w-md glass-card rounded-3xl p-6 space-y-5 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in overflow-y-auto max-h-[85vh] custom-scrollbar"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-black uppercase tracking-wider text-suno-secondary">{tr.concept.creativeLabModalTitle}</h3>
                <button
                  type="button"
                  onClick={() => setLabHelpModalOpen(false)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
                >
                  <i className="fas fa-times text-sm"></i>
                </button>
              </div>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-xl bg-suno-primary/20 flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-waveform-lines text-suno-primary text-xs"></i>
                  </div>
                  <p className="text-[11px] text-zinc-300 leading-relaxed pt-0.5">{tr.concept.creativeLabDescRefMixer}</p>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-xl bg-suno-primary/20 flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-shuffle text-suno-primary text-xs"></i>
                  </div>
                  <p className="text-[11px] text-zinc-300 leading-relaxed pt-0.5">{tr.concept.creativeLabDescFusion}</p>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-xl bg-suno-secondary/20 flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-bolt text-suno-secondary text-xs"></i>
                  </div>
                  <p className="text-[11px] text-zinc-300 leading-relaxed pt-0.5">{tr.concept.creativeLabDescBoost}</p>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {kreativLabContent}
      </div>

      {/* ═══ FIELDS GRID ═══ */}
      <div className="glass-card rounded-3xl p-6 space-y-6">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
          <span className="section-pill">{tr.concept.details}</span>
          <span className="gradient-line flex-1 block"></span>
          <span className="text-zinc-600 dark:text-zinc-400">{tr.concept.optional}</span>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div
            ref={genreFieldRef}
            className={`relative space-y-2 rounded-2xl transition-all duration-300 ${genreFieldPulse ? 'ring-2 ring-suno-primary/60 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 animate-pulse' : ''}`}
          >
            <SearchableMultiInput label={tr.concept.genre} icon="fa-music" options={opts.genres} selected={concept.genre}
              onToggle={(v) => toggle('genre', v)} placeholder={opts.genres.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing} />
            {concept.genre.length >= 2 && (
              <p className="mt-1 text-[9px] text-zinc-500 dark:text-zinc-500">
                {tr.concept.fusionHintUseLab}
              </p>
            )}
          </div>
          <div className="relative">
            <SearchableMultiInput label={tr.concept.mood} icon="fa-face-smile" options={opts.moods} selected={concept.mood}
              onToggle={(v) => toggle('mood', v)} placeholder={opts.moods.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing} accent="text-suno-secondary" />
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

      {/* ═══ WEITER (zu Lyrics) ═══ */}
      <div className="relative z-0 mt-20 md:mt-24">
        <div className="absolute -inset-0.5 suno-gradient rounded-3xl blur opacity-30 transition-opacity duration-500 group-hover:opacity-60"></div>
        <button type="submit"
          className="btn-create relative w-full py-5 md:py-6 rounded-3xl text-white font-black text-lg md:text-xl uppercase tracking-[0.2em] shadow-2xl flex items-center justify-center gap-3">
          <i className="fas fa-arrow-right text-lg"></i>
          {tr.concept.nextBtn}
          <span className="absolute right-6 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium normal-case tracking-normal hidden md:block">
            Zum Lyrics-Tab
          </span>
        </button>
      </div>

    </form>

    </div>
  );
};

export default ConceptForm;
