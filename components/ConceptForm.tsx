
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SongConcept } from '../types';
import {
  analyzeTopic, generateConceptStoryIdea, analyzeAudio, AudioAnalysisResult,
  generateGenreFusion, GenreFusionResult,
  generateCreativeBoost, CreativeBoostResult,
  generateChaosMode, ChaosModeResult,
  synthesizeReferenceStyle, ReferenceStyleResult, analyzeInspirationImage,
  analyzeChordProgression, analyzeMusicLinkInspiration, MusicLinkInspirationResult,
  generateSongIdeaCopilotDraft, SongIdeaCopilotDraft,
} from '../services/geminiService';
import { useLang, useToast } from '../App';
import SearchableMultiInput from './SearchableMultiInput';
import ChordInspirationModal from './ChordInspirationModal';

interface ConceptFormProps {
  initialConcept: SongConcept;
  /** `nav` = zu Lyrics (bestehende Inhalte); `pipeline` = Lyrics/Style leeren und neu ausrichten. */
  onConceptContinue: (concept: SongConcept, mode: 'nav' | 'pipeline') => void;
  /** Wird bei jeder Änderung aufgerufen, damit die App den aktuellen Konzept-Stand behält (z. B. beim Tab-Wechsel ohne „Weiter“). */
  onConceptChange?: (concept: SongConcept) => void;
  /** Nach abgeschlossener Kette: zwei Buttons (nur wechseln vs. Pipeline zurücksetzen). */
  showPipelineChoice?: boolean;
  /** Rechter Hinweis am Einzel-„Weiter“-Button (nur wenn kein Pipeline-Zweier-Modus). */
  nextStepSecondaryLabel?: string;
}

type CreativeLabToolHelpId = 'refMixer' | 'chords' | 'fusion' | 'boost' | 'chaos';
type CopilotMessage = { role: 'assistant' | 'user'; text: string };

const LabHelpIconButton: React.FC<{
  onClick: () => void;
  accent: 'primary' | 'secondary';
}> = ({ onClick, accent }) => {
  const { tr } = useLang();
  const tone =
    accent === 'primary'
      ? 'text-suno-primary/45 hover:text-suno-primary hover:bg-suno-primary/[0.12] dark:hover:bg-suno-primary/15'
      : 'text-suno-secondary/45 hover:text-suno-secondary hover:bg-suno-secondary/[0.12] dark:hover:bg-suno-secondary/15';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-lg p-1.5 min-h-[1.625rem] min-w-[1.625rem] transition-all duration-200 ${tone}`}
      aria-label={tr.concept.creativeLabToolHelpAria}
    >
      <i className="fas fa-circle-question text-[12px]" aria-hidden />
    </button>
  );
};

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

function normalizeConceptToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[–—\-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CONCEPT_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['acoustic guitar', 'akustikgitarre', 'akustik gitarre'],
  ['electric guitar', 'e-gitarre', 'e gitarre', 'elektrische gitarre'],
  ['rhodes piano', 'rhodes pno', 'rhodes'],
  ['upright bass', 'double bass', 'kontrabass', 'contrabass'],
  ['bass guitar', 'e-bass', 'e bass', 'bassgitarre'],
  ['drums', 'drum kit', 'schlagzeug', 'drum set'],
  ['synthesizer', 'synth', 'synthesiser'],
  ['piano', 'klavier', 'grand piano', 'flügel'],
  ['violin', 'geige'],
  ['cello', 'violoncello'],
  ['saxophone', 'sax', 'saxophon'],
  ['trumpet', 'trompete'],
  ['trombone', 'posaune'],
  ['flute', 'flöte', 'floete'],
  ['clarinet', 'klarinette'],
  ['organ', 'orgel', 'hammond'],
  ['strings', 'string section', 'strings section', 'streicher', 'streichersektion'],
  ['melancholic', 'melancholisch'],
  ['energetic', 'energetisch'],
  ['slow', 'langsam'],
  ['fast', 'schnell'],
];

function synonymGroupId(token: string): number | undefined {
  const n = normalizeConceptToken(token);
  for (let i = 0; i < CONCEPT_SYNONYM_GROUPS.length; i++) {
    for (const m of CONCEPT_SYNONYM_GROUPS[i]) {
      if (normalizeConceptToken(m) === n) return i;
    }
  }
  return undefined;
}

function mergeDetailLists(existing: string[], incoming: string[]): string[] {
  const out: string[] = [...existing];
  const seenNorm = new Set(existing.map((e) => normalizeConceptToken(e)).filter(Boolean));
  const takenGroups = new Set<number>();
  for (const e of existing) {
    const gid = synonymGroupId(e);
    if (gid !== undefined) takenGroups.add(gid);
  }
  for (const inc of incoming) {
    const t = inc.trim();
    if (!t) continue;
    const n = normalizeConceptToken(t);
    if (seenNorm.has(n)) continue;
    const gid = synonymGroupId(t);
    if (gid !== undefined && takenGroups.has(gid)) continue;
    out.push(t);
    seenNorm.add(n);
    if (gid !== undefined) takenGroups.add(gid);
  }
  return dedupeByContent(out);
}

/** Mindestens ein Detail-Feld (Genre, Mood, …) befüllt — erneute Analyse soll nachfragen. */
function hasConceptDetailSelections(c: SongConcept): boolean {
  const nonEmpty = (a?: string[]) => Array.isArray(a) && a.length > 0;
  if (
    nonEmpty(c.genre) ||
    nonEmpty(c.mood) ||
    nonEmpty(c.tempo) ||
    nonEmpty(c.instrumentation) ||
    nonEmpty(c.timbre) ||
    nonEmpty(c.excludedStyles)
  ) {
    return true;
  }
  if (!c.isInstrumental && (nonEmpty(c.language) || nonEmpty(c.vocals))) return true;
  return false;
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
const ACCEPTED_IMAGE = 'image/*,.heic,.heif';
const MAX_IMAGE_MB = 8;

interface AudioFile {
  name: string;
  sizeMB: number;
  base64: string;
  mimeType: string;
}

interface InspirationImageFile {
  name: string;
  sizeMB: number;
  base64: string;
  mimeType: string;
  dataUrl: string;
}

function isSupportedMusicServiceLink(url: string): boolean {
  const value = url.trim().toLowerCase();
  if (!value) return false;
  return (
    value.includes("music.apple.com/") ||
    value.includes("itunes.apple.com/") ||
    value.includes("open.spotify.com/")
  );
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

const readInspirationImageFile = (file: File): Promise<InspirationImageFile> =>
  new Promise((resolve, reject) => {
    const type = (file.type || '').toLowerCase();
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const isKnownImage = type.startsWith('image/') || ['heic', 'heif'].includes(ext);
    if (!isKnownImage) { reject(new Error('INVALID_FILE_TYPE')); return; }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      reject(new Error('FILE_TOO_LARGE'));
      return;
    }
    const finalize = (dataUrl: string, mimeType: string) => {
      const base64 = dataUrl.split(',')[1] || '';
      resolve({
        name: file.name,
        sizeMB: Math.round((file.size / 1024 / 1024) * 10) / 10,
        base64,
        mimeType,
        dataUrl,
      });
    };
    const readAsDataUrl = () => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = String(e.target?.result || '');
        finalize(dataUrl, file.type || 'image/jpeg');
      };
      reader.onerror = () => reject(new Error('READ_ERROR'));
      reader.readAsDataURL(file);
    };
    const normalizeViaCanvas = async () => {
      try {
        const blobUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('READ_ERROR');
            ctx.drawImage(img, 0, 0);
            const jpegData = canvas.toDataURL('image/jpeg', 0.92);
            URL.revokeObjectURL(blobUrl);
            finalize(jpegData, 'image/jpeg');
          } catch {
            URL.revokeObjectURL(blobUrl);
            reject(new Error('READ_ERROR'));
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          reject(new Error('READ_ERROR'));
        };
        img.src = blobUrl;
      } catch {
        reject(new Error('READ_ERROR'));
      }
    };

    const isDirectSupported = ['image/jpeg', 'image/png', 'image/webp'].includes(type);
    if (isDirectSupported) readAsDataUrl();
    else normalizeViaCanvas();
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
  /** Kompakteres Layout für 2-Spalten-Grid (z. B. Kreativ-Lab neben Akkorde) */
  compact?: boolean;
  /** Akzentfarbe der Lab-Karte (Schachbrett mit Akkord-Karte) */
  labAccent?: 'primary' | 'secondary';
  onToolHelp?: () => void;
}> = ({ onApply, onApplySingle, compact, labAccent = 'primary', onToolHelp }) => {
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
      const result = await analyzeAudio(slot.file.base64, slot.file.mimeType, lang);
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

  const headerPad = compact ? 'px-4 py-3' : 'px-6 py-4';
  const bodyPad = compact ? 'px-4 pb-4 pt-3' : 'px-6 pb-6 pt-4';
  const labSec = Boolean(compact && labAccent === 'secondary');
  const iconBox = labSec ? 'bg-suno-secondary/15' : 'bg-suno-primary/15';
  const iconColor = labSec ? 'text-suno-secondary' : 'text-suno-primary';
  const openBtnClass = labSec
    ? 'border border-suno-secondary/35 text-suno-secondary hover:bg-suno-secondary/15 hover:border-suno-secondary/50'
    : 'border border-suno-primary/35 text-suno-primary hover:bg-suno-primary/15 hover:border-suno-primary/50';

  return (
    <div
      className={`glass-card overflow-hidden ${
        compact
          ? `rounded-2xl h-full min-h-0 flex flex-col border ${
              labSec
                ? 'border-suno-secondary/25 bg-suno-secondary/5 dark:bg-suno-secondary/10'
                : 'border-suno-primary/25 bg-suno-primary/5 dark:bg-suno-primary/10'
            }`
          : 'rounded-3xl'
      }`}
    >
      {/* ── Header: kompakt = statisch + „Öffnen“ / „Schließen“; sonst Klappliste mit Chevron ── */}
      {compact ? (
        <>
          <div
            className={`flex items-start justify-between gap-2 ${headerPad} ${
              isOpen ? 'border-b border-white/10 dark:border-white/8' : ''
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBox}`}>
                <i className={`fas fa-layer-group text-[11px] ${iconColor}`}></i>
              </div>
              <div className="text-left min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black uppercase tracking-wider text-suno-secondary">
                    {tr.concept.refMixer}
                  </span>
                  {onToolHelp && (
                    <LabHelpIconButton accent="secondary" onClick={onToolHelp} />
                  )}
                  {analyzedCount > 0 && (
                    <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/25">
                      {analyzedCount} {tr.concept.refMixerAnalyzed}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {isOpen && (
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                {tr.about.close}
              </button>
            )}
          </div>
          {!isOpen && (
            <div className="px-4 pb-4 flex-1 flex flex-col justify-end mt-auto min-h-0">
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all ${openBtnClass}`}
              >
                <i className="fas fa-sliders-h text-[9px]"></i>
                {tr.concept.chordLabOpenBtn}
              </button>
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(p => !p)}
          className={`w-full flex items-center justify-between group hover:bg-white/5 transition-colors ${headerPad}`}
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
      )}

      {/* ── Body ── */}
      {isOpen && (
        <div
          className={`space-y-4 ${compact ? '' : 'border-t border-white/10 dark:border-white/8'} ${bodyPad} ${
            compact ? 'flex-1 min-h-0 overflow-y-auto' : ''
          }`}
        >

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
                    <i className="fas fa-clapperboard text-suno-secondary text-[9px] mt-0.5 flex-shrink-0"></i>
                    <div className="min-w-0">
                      <p className="text-[8px] font-black uppercase tracking-wider text-suno-secondary mb-0.5">{tr.concept.refMixerRegieSeed}</p>
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
const ConceptForm: React.FC<ConceptFormProps> = ({ initialConcept, onConceptContinue, onConceptChange, showPipelineChoice, nextStepSecondaryLabel }) => {
  const { tr, lang } = useLang();
  const { showToast } = useToast();
  const opts = tr.conceptOptions;
  const [concept, setConcept] = useState<SongConcept>(initialConcept);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [randomThemePreset, setRandomThemePreset] = useState<string>(opts.randomThemes[0] ?? 'Zufall');
  const [randomDirectionCustom, setRandomDirectionCustom] = useState('');
  const [isRandomModalOpen, setIsRandomModalOpen] = useState(false);
  const [randomSuggestion, setRandomSuggestion] = useState('');
  const [inspirationImage, setInspirationImage] = useState<InspirationImageFile | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isCopilotModalOpen, setIsCopilotModalOpen] = useState(false);
  const [isCopilotGenerating, setIsCopilotGenerating] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([]);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotQuestionIdx, setCopilotQuestionIdx] = useState(0);
  const [copilotAnswers, setCopilotAnswers] = useState({
    topicIntent: '',
    moodMain: '',
    perspective: '',
    languageAndVocalStyle: '',
    instrumentHints: '',
  });
  const [copilotDraft, setCopilotDraft] = useState<SongIdeaCopilotDraft | null>(null);
  const [musicLinkInput, setMusicLinkInput] = useState('');
  const [musicLinkResult, setMusicLinkResult] = useState<MusicLinkInspirationResult | null>(null);
  const [isAnalyzingMusicLink, setIsAnalyzingMusicLink] = useState(false);
  const [isChordModalOpen, setIsChordModalOpen] = useState(false);
  const [chordDraft, setChordDraft] = useState('');
  const [isChordAnalyzing, setIsChordAnalyzing] = useState(false);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const copilotChatScrollRef = useRef<HTMLDivElement>(null);
  const copilotChatBottomRef = useRef<HTMLDivElement>(null);

  // Genre-Fusion Lab
  const [isFusing, setIsFusing] = useState(false);
  const [fusionResult, setFusionResult] = useState<GenreFusionResult | null>(null);

  // Kreativ-Boost
  const [isBoosting, setIsBoosting] = useState(false);
  const [boostResult, setBoostResult] = useState<CreativeBoostResult | null>(null);

  // Chaos Mode
  const [isChaosing, setIsChaosing] = useState(false);
  const [chaosResult, setChaosResult] = useState<ChaosModeResult | null>(null);

  // Kreativ-Lab (gesamt ein-/ausklappbar)
  const [isLabOpen, setIsLabOpen] = useState(false);
  const [labHelpModalOpen, setLabHelpModalOpen] = useState(false);
  const [creativeToolHelp, setCreativeToolHelp] = useState<CreativeLabToolHelpId | null>(null);
  const [inspireHelpOpen, setInspireHelpOpen] = useState(false);
  const [analyzeAgainModalOpen, setAnalyzeAgainModalOpen] = useState(false);
  const [songIdeaFieldHelpOpen, setSongIdeaFieldHelpOpen] = useState(false);
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

  useEffect(() => {
    if (!opts.randomThemes.includes(randomThemePreset)) {
      setRandomThemePreset(opts.randomThemes[0] ?? randomThemePreset);
    }
  }, [lang, opts.randomThemes, randomThemePreset]);

  const focusGenreField = () => {
    setGenreFieldPulse(true);
    genreFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setGenreFieldPulse(false), 2500);
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onConceptContinue(concept, 'nav'); };

  const handleRandomize = async () => {
    setIsRandomizing(true);
    try {
      const topic = await generateConceptStoryIdea(
        'random',
        lang,
        randomThemePreset,
        randomDirectionCustom
      );
      setRandomSuggestion(topic);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast(tr.errors.aiErrorPrefix + msg, 'error');
    } finally { setIsRandomizing(false); }
  };

  const extractRandomSuggestionForTopic = (text: string): string => {
    const raw = String(text ?? '');
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';

    const cleanLine = (line: string): string => {
      if (/^\[Titel\]\s*/i.test(line)) return `Titel: ${line.replace(/^\[Titel\]\s*/i, '').trim()}`;
      if (/^\[Title\]\s*/i.test(line)) return `Title: ${line.replace(/^\[Title\]\s*/i, '').trim()}`;
      if (/^\[Genre\]\s*/i.test(line)) return `Genre: ${line.replace(/^\[Genre\]\s*/i, '').trim()}`;
      if (/^\[Stimmung\s*&\s*Setting\]\s*/i.test(line)) return `Stimmung & Setting: ${line.replace(/^\[Stimmung\s*&\s*Setting\]\s*/i, '').trim()}`;
      if (/^\[Mood\s*&\s*Setting\]\s*/i.test(line)) return `Mood & Setting: ${line.replace(/^\[Mood\s*&\s*Setting\]\s*/i, '').trim()}`;
      if (/^\[Perspektive\]\s*/i.test(line)) return `Perspektive: ${line.replace(/^\[Perspektive\]\s*/i, '').trim()}`;
      if (/^\[Perspective\]\s*/i.test(line)) return `Perspective: ${line.replace(/^\[Perspective\]\s*/i, '').trim()}`;
      if (/^\[Kernidee\]\s*/i.test(line)) return line.replace(/^\[Kernidee\]\s*/i, '').trim();
      if (/^\[Core idea\]\s*/i.test(line)) return line.replace(/^\[Core idea\]\s*/i, '').trim();
      return line
        .replace(/^Kernidee:\s*/i, '')
        .replace(/^Core idea:\s*/i, '')
        .trim();
    };

    return lines.map(cleanLine).filter(Boolean).join('\n').trim();
  };

  const handleApplyRandomSuggestion = () => {
    const suggestion = extractRandomSuggestionForTopic(randomSuggestion);
    if (!suggestion) return;
    setConcept(prev => ({ ...prev, topic: suggestion }));
    showToast(tr.concept.randomApplySuccess, 'success');
    setIsRandomModalOpen(false);
  };

  const runSongIdeaAnalysis = async (mode: 'merge' | 'replace') => {
    if (!concept.topic || concept.topic.length < 3) { showToast(tr.concept.enterTopicFirst, 'error'); return; }
    setAnalyzeAgainModalOpen(false);
    setIsAnalyzing(true);
    try {
      const s = await analyzeTopic(concept.topic, concept.isInstrumental, lang);
      setConcept(prev => {
        const mergeOrReplace = (existing: string[], incoming: string[]) =>
          mode === 'replace' ? mergeDetailLists([], incoming) : mergeDetailLists(existing, incoming);
        return {
          ...prev,
          genre: mergeOrReplace(prev.genre, s.genre ?? []),
          mood: mergeOrReplace(prev.mood, s.mood ?? []),
          tempo: normalizeTempoToSingleOrRange(mergeOrReplace(prev.tempo, s.tempo ?? [])),
          instrumentation: mergeOrReplace(prev.instrumentation ?? [], s.instrumentation ?? []),
          timbre: mergeOrReplace(prev.timbre ?? [], s.timbre ?? []),
          excludedStyles: mergeOrReplace(prev.excludedStyles ?? [], s.excludedStyles ?? []),
          language: prev.isInstrumental ? [] : mergeOrReplace(prev.language, s.language ?? []),
          vocals: prev.isInstrumental ? [] : mergeOrReplace(prev.vocals, s.vocals ?? []),
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast(tr.errors.aiErrorPrefix + msg, 'error');
    } finally { setIsAnalyzing(false); }
  };

  const handleAnalyzeClick = () => {
    if (!concept.topic || concept.topic.length < 3) { showToast(tr.concept.enterTopicFirst, 'error'); return; }
    if (hasConceptDetailSelections(concept)) {
      setAnalyzeAgainModalOpen(true);
      return;
    }
    void runSongIdeaAnalysis('merge');
  };

  const handleImageFile = async (file: File) => {
    try {
      const img = await readInspirationImageFile(file);
      setInspirationImage(img);
      setConcept(prev => ({
        ...prev,
        imageInspirationText: prev.imageInspirationText ?? '',
        inspirationSource: prev.inspirationSource ?? 'text',
      }));
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'INVALID_FILE_TYPE') showToast(tr.concept.imageInvalidType, 'error');
      else if (code === 'FILE_TOO_LARGE') showToast(tr.concept.imageTooLarge, 'error');
      else showToast(tr.concept.imageReadError, 'error');
    }
  };

  const handleAnalyzeImage = async () => {
    if (!inspirationImage || isAnalyzingImage) return;
    setIsAnalyzingImage(true);
    try {
      const result = await analyzeInspirationImage(inspirationImage.base64, inspirationImage.mimeType, lang);
      const idea = result.songIdeaPrompt || '';
      setConcept(prev => ({
        ...prev,
        imageInspirationText: idea,
        inspirationSource: prev.topic.trim() ? 'mixed' : 'image',
      }));
      showToast(tr.concept.imageAnalyzeSuccess, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      if (/CONTENT_BLOCKED/i.test(msg)) {
        showToast(tr.concept.imageBlocked, 'error');
      } else {
        showToast(tr.concept.imageAnalyzeError, 'error');
      }
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const handleApplyImageIdea = () => {
    const suggestion = (concept.imageInspirationText || '').trim();
    if (!suggestion) return;
    setConcept(prev => ({
      ...prev,
      topic: suggestion,
      inspirationSource: prev.topic.trim() ? 'mixed' : 'image',
    }));
    showToast(tr.concept.imageApplySuccess, 'success');
    setIsImageModalOpen(false);
  };

  const handleAnalyzeMusicLink = async () => {
    const raw = musicLinkInput.trim();
    if (!raw || isAnalyzingMusicLink) return;
    if (!isSupportedMusicServiceLink(raw)) {
      showToast(tr.concept.linkInspirationUnsupported, 'error');
      return;
    }
    setIsAnalyzingMusicLink(true);
    try {
      const result = await analyzeMusicLinkInspiration(raw, lang);
      setMusicLinkResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast(tr.errors.aiErrorPrefix + msg, 'error');
    } finally {
      setIsAnalyzingMusicLink(false);
    }
  };

  const handleApplyMusicLinkIdea = (idea: string) => {
    const suggestion = (idea || '').trim();
    if (!suggestion) return;
    setConcept(prev => ({
      ...prev,
      topic: suggestion,
      inspirationSource: prev.topic.trim() ? 'mixed' : 'text',
    }));
    showToast(tr.concept.linkInspirationApplySuccess, 'success');
    setIsLinkModalOpen(false);
  };

  const trimmedMusicLinkInput = musicLinkInput.trim();
  const isMusicLinkSupported = !trimmedMusicLinkInput || isSupportedMusicServiceLink(trimmedMusicLinkInput);

  const copilotQuestions = [
    tr.concept.copilotQ1,
    tr.concept.copilotQ2,
    tr.concept.copilotQ3,
    tr.concept.copilotQ4,
    tr.concept.copilotQ5,
  ];

  const handleResetCopilot = () => {
    setCopilotDraft(null);
    setCopilotQuestionIdx(0);
    setCopilotInput('');
    setCopilotAnswers({
      topicIntent: '',
      moodMain: '',
      perspective: '',
      languageAndVocalStyle: '',
      instrumentHints: '',
    });
    setCopilotMessages([{ role: 'assistant', text: copilotQuestions[0] }]);
  };

  useEffect(() => {
    if (!isCopilotModalOpen) return;
    if (copilotMessages.length > 0) return;
    setCopilotMessages([{ role: 'assistant', text: copilotQuestions[0] }]);
  }, [isCopilotModalOpen, copilotMessages.length, copilotQuestions]);

  useEffect(() => {
    if (!isCopilotModalOpen) return;
    const id = window.requestAnimationFrame(() => {
      copilotChatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [isCopilotModalOpen, copilotMessages, copilotDraft, isCopilotGenerating]);

  const generateCopilotDraftFromAnswers = async (answers: {
    topicIntent: string;
    moodMain: string;
    perspective: string;
    languageAndVocalStyle: string;
    instrumentHints: string;
  }) => {
    setIsCopilotGenerating(true);
    try {
      const draft = await generateSongIdeaCopilotDraft(
        {
          topicIntent: answers.topicIntent,
          moodMain: answers.moodMain,
          perspective: answers.perspective,
          languageAndVocalStyle: answers.languageAndVocalStyle,
          instrumentHints: answers.instrumentHints,
        },
        lang
      );
      setCopilotDraft(draft);
      setCopilotMessages(prev => [...prev, { role: 'assistant', text: tr.concept.copilotDraftReady }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast(tr.errors.aiErrorPrefix + msg, 'error');
    } finally {
      setIsCopilotGenerating(false);
    }
  };

  const handleCopilotSend = () => {
    const value = copilotInput.trim();
    if (!value || isCopilotGenerating || copilotDraft) return;
    setCopilotMessages(prev => [...prev, { role: 'user', text: value }]);
    setCopilotInput('');
    const nextAnswers = { ...copilotAnswers };
    if (copilotQuestionIdx === 0) nextAnswers.topicIntent = value;
    if (copilotQuestionIdx === 1) nextAnswers.moodMain = value;
    if (copilotQuestionIdx === 2) nextAnswers.perspective = value;
    if (copilotQuestionIdx === 3) nextAnswers.languageAndVocalStyle = value;
    if (copilotQuestionIdx === 4) nextAnswers.instrumentHints = value;
    setCopilotAnswers(nextAnswers);

    if (copilotQuestionIdx < copilotQuestions.length - 1) {
      const nextIdx = copilotQuestionIdx + 1;
      setCopilotQuestionIdx(nextIdx);
      setCopilotMessages(prev => [...prev, { role: 'assistant', text: copilotQuestions[nextIdx] }]);
      return;
    }

    setCopilotMessages(prev => [...prev, { role: 'assistant', text: tr.concept.copilotGenerating }]);
    void generateCopilotDraftFromAnswers(nextAnswers);
  };

  const handleApplyCopilotDraft = () => {
    if (!copilotDraft?.topicShort?.trim()) return;
    const instrumentsLine = (copilotDraft.instrumentHints || []).filter(Boolean).join(' · ');
    const contractLanguage = copilotAnswers.languageAndVocalStyle || '';
    const contractVocals = copilotAnswers.languageAndVocalStyle || '';
    const contractMood = copilotAnswers.moodMain || '';
    const contractPerspective = copilotAnswers.perspective || copilotDraft.perspective || '';
    const contractInstruments = copilotAnswers.instrumentHints || instrumentsLine || '';
    const copilotContract = [
      '[Copilot Contract]',
      `Language: ${contractLanguage}`,
      `Vocals: ${contractVocals}`,
      `Mood: ${contractMood}`,
      `Perspective: ${contractPerspective}`,
      `Instruments: ${contractInstruments}`,
      '[/Copilot Contract]',
    ].join('\n');
    const composed = [
      copilotContract,
      `Thema: ${copilotDraft.topicShort}`,
      `Kernkonflikt: ${copilotDraft.coreConflict}`,
      `Perspektive: ${copilotDraft.perspective}`,
      `Emotionsbogen: ${copilotDraft.emotionArc}`,
      `Bildwelt / Setting: ${copilotDraft.imagerySetting}`,
      instrumentsLine ? `Instrumente: ${instrumentsLine}` : '',
    ].filter(Boolean).join('\n');
    setConcept(prev => ({
      ...prev,
      topic: composed,
      inspirationSource: prev.topic.trim() ? 'mixed' : 'text',
    }));
    showToast(tr.concept.copilotApplySuccess, 'success');
    setIsCopilotModalOpen(false);
  };

  const handleImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsImageDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleImageFile(file);
    }
  };

  const openChordModal = () => {
    setChordDraft(concept.chordProgression ?? '');
    setIsChordModalOpen(true);
  };

  const closeChordModal = () => {
    setConcept((prev) => ({
      ...prev,
      chordProgression: chordDraft.trim() || undefined,
    }));
    setIsChordModalOpen(false);
  };

  const appendChordSnippet = (snippet: string) => {
    const s = snippet.trim();
    if (!s) return;
    setChordDraft((prev) => (prev.trim() ? `${prev.trim()} | ${s}` : s));
  };

  const handleChordAnalyze = async () => {
    const raw = chordDraft.trim();
    if (!raw) {
      showToast(tr.concept.chordEmptyError, 'error');
      return;
    }
    setIsChordAnalyzing(true);
    try {
      const s = await analyzeChordProgression(raw, concept.isInstrumental, lang);
      setConcept((prev) => ({
        ...prev,
        chordProgression: raw,
        genre: mergeDetailLists(prev.genre, s.genre ?? []),
        mood: mergeDetailLists(prev.mood, s.mood ?? []),
        tempo: normalizeTempoToSingleOrRange(mergeDetailLists(prev.tempo, s.tempo ?? [])),
        instrumentation: mergeDetailLists(prev.instrumentation ?? [], s.instrumentation ?? []),
        timbre: mergeDetailLists(prev.timbre ?? [], s.timbre ?? []),
        excludedStyles: mergeDetailLists(prev.excludedStyles ?? [], s.excludedStyles ?? []),
        language: prev.isInstrumental ? [] : mergeDetailLists(prev.language, s.language ?? []),
        vocals: prev.isInstrumental ? [] : mergeDetailLists(prev.vocals, s.vocals ?? []),
      }));
      showToast(tr.concept.chordAnalyzeSuccess, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast(tr.errors.aiErrorPrefix + msg, 'error');
    } finally {
      setIsChordAnalyzing(false);
    }
  };

  const toggle = (key: keyof Pick<SongConcept, 'genre'|'mood'|'excludedStyles'|'language'|'vocals'|'tempo'|'instrumentation'|'timbre'>, val: string) => {
    setConcept(prev => {
      const cur = (prev[key] as string[] | undefined) ?? [];
      return { ...prev, [key]: cur.includes(val) ? cur.filter(i => i !== val) : [...cur, val] };
    });
  };

  const handleAudioAnalysis = (result: AudioAnalysisResult) => {
    setConcept(prev => ({
      ...prev,
      topic: prev.topic.trim() ? prev.topic : (result.topicSuggestion || prev.topic),
      isInstrumental: result.isInstrumental ?? prev.isInstrumental,
      genre: mergeDetailLists(prev.genre, result.genre ?? []),
      mood: mergeDetailLists(prev.mood, result.mood ?? []),
      tempo: normalizeTempoToSingleOrRange(mergeDetailLists(prev.tempo, result.tempo ?? [])),
      instrumentation: mergeDetailLists(prev.instrumentation ?? [], result.instrumentation ?? []),
      timbre: mergeDetailLists(prev.timbre ?? [], result.timbre ?? []),
      excludedStyles: mergeDetailLists(prev.excludedStyles ?? [], result.excludedStyles ?? []),
      vocals: result.isInstrumental ? [] : mergeDetailLists(prev.vocals, result.vocals ?? []),
      language: result.isInstrumental ? [] : mergeDetailLists(prev.language, result.language ?? []),
    }));
  };

  // ─── Referenz-Mixer ───
  const handleMixerApply = (result: ReferenceStyleResult) => {
    setConcept(prev => {
      const genre = mergeDetailLists(prev.genre, result.genre ?? []);
      const mood = mergeDetailLists(prev.mood, result.mood ?? []);
      const tempo = normalizeTempoToSingleOrRange(mergeDetailLists(prev.tempo, result.tempo ?? []));
      const instrumentation = mergeDetailLists(prev.instrumentation ?? [], result.instrumentation ?? []);
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
      const extraTempo = fusionResult.suggestedBPM ? [fusionResult.suggestedBPM] : [];
      const instrumentation = mergeDetailLists(prev.instrumentation ?? [], fusionResult.suggestedInstruments ?? []);
      const mood = mergeDetailLists(prev.mood, fusionResult.suggestedMood ?? []);
      const tempo = normalizeTempoToSingleOrRange(mergeDetailLists(prev.tempo, extraTempo));
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
    setConcept(prev => ({
      ...prev,
      genre: mergeDetailLists(prev.genre, boostResult.addGenres ?? []),
      instrumentation: mergeDetailLists(prev.instrumentation ?? [], boostResult.addInstruments ?? []),
      mood: mergeDetailLists(prev.mood, boostResult.addMoods ?? []),
    }));
    setBoostResult(null);
  };

  // ─── Chaos Mode ───
  const handleChaos = async () => {
    if (isChaosing) return;
    setIsChaosing(true);
    setChaosResult(null);
    try {
      const result = await generateChaosMode(concept);
      setChaosResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      showToast(tr.errors.aiErrorPrefix + msg, 'error');
    } finally {
      setIsChaosing(false);
    }
  };

  const applyChaos = () => {
    if (!chaosResult) return;
    setConcept(prev => ({
      ...prev,
      genre: mergeDetailLists(prev.genre, chaosResult.addGenres ?? []),
      instrumentation: mergeDetailLists(prev.instrumentation ?? [], chaosResult.addInstruments ?? []),
      mood: mergeDetailLists(prev.mood, chaosResult.addMoods ?? []),
    }));
    setChaosResult(null);
  };

  const kreativLabContent = isLabOpen ? (
    <div className="space-y-4 pt-2 border-t border-white/10 dark:border-white/5">
      {/* Obere Reihe: Referenz-Mixer + Akkorde (gleiches Breakpoint wie Fusion & Boost) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        <ReferenzMixer
          compact
          labAccent="secondary"
          onApply={handleMixerApply}
          onApplySingle={handleAudioAnalysis}
          onToolHelp={() => setCreativeToolHelp('refMixer')}
        />
        <div className="rounded-2xl border border-suno-primary/25 bg-suno-primary/5 dark:bg-suno-primary/10 p-4 space-y-3 h-full min-h-0 flex flex-col">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-7 h-7 rounded-xl bg-suno-primary/20 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-guitar text-suno-primary text-[11px]"></i>
              </div>
              <p className="text-xs font-black uppercase tracking-wider text-suno-primary truncate">{tr.concept.chordInspirationBtn}</p>
              <LabHelpIconButton accent="primary" onClick={() => setCreativeToolHelp('chords')} />
            </div>
            {concept.chordProgression?.trim() && (
              <span className="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-suno-primary/20 text-suno-primary text-[8px] font-black flex-shrink-0">
                1
              </span>
            )}
          </div>
          {concept.chordProgression?.trim() && (
            <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate" title={concept.chordProgression}>
              {concept.chordProgression}
            </p>
          )}
          <button
            type="button"
            onClick={openChordModal}
            className="mt-auto w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] border border-suno-primary/35 text-suno-primary hover:bg-suno-primary/15 hover:border-suno-primary/50 transition-all"
          >
            <i className="fas fa-sliders-h text-[9px]"></i>
            {tr.concept.chordLabOpenBtn}
          </button>
        </div>
      </div>

      {/* Untere Reihe: Fusion & Boost */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Genre-Fusion Block */}
        <div className="rounded-2xl border border-suno-primary/25 bg-suno-primary/5 dark:bg-suno-primary/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-suno-primary/20 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-shuffle text-suno-primary text-[11px]"></i>
              </div>
              <p className="text-xs font-black uppercase tracking-wider text-suno-primary truncate">{tr.concept.fusionLab}</p>
              <LabHelpIconButton accent="primary" onClick={() => setCreativeToolHelp('fusion')} />
            </div>
          </div>

          {concept.genre.length >= 2 ? (
            <button
              type="button"
              onClick={handleFusion}
              disabled={isFusing}
              className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all border ${
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
            <button
              type="button"
              onClick={focusGenreField}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] border border-suno-primary/35 text-suno-primary hover:bg-suno-primary/15 hover:border-suno-primary/50 transition-all"
            >
              <i className="fas fa-arrow-down text-[9px]"></i>
              {tr.concept.fusionPickGenresBtn}
            </button>
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-suno-secondary/20 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-bolt text-suno-secondary text-[11px]"></i>
              </div>
              <p className="text-xs font-black uppercase tracking-wider text-suno-secondary truncate">{tr.concept.creativeBoost}</p>
              <LabHelpIconButton accent="secondary" onClick={() => setCreativeToolHelp('boost')} />
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
                  <i className="fas fa-lightbulb text-suno-secondary text-[10px] mt-0.5 flex-shrink-0"></i>
                  <p className="text-[10px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                    <span className="font-black uppercase tracking-wider text-suno-secondary mr-1">{tr.concept.boostTip}:</span>
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

      {/* Chaos Mode (volle Breite) */}
      <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 dark:bg-fuchsia-500/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-xl bg-fuchsia-500/25 flex items-center justify-center flex-shrink-0">
              <i className="fas fa-atom text-fuchsia-400 text-[11px]" aria-hidden />
            </div>
            <p className="text-xs font-black uppercase tracking-wider text-fuchsia-200 truncate">{tr.concept.chaosMode}</p>
            <LabHelpIconButton accent="primary" onClick={() => setCreativeToolHelp('chaos')} />
          </div>
        </div>

        <button
          type="button"
          onClick={handleChaos}
          disabled={isChaosing}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all border ${
            isChaosing
              ? 'glass-btn text-fuchsia-300 border-fuchsia-500/40 animate-pulse'
              : 'glass-btn text-fuchsia-200 border-fuchsia-500/35 hover:bg-fuchsia-500/20 hover:border-fuchsia-400/60'
          }`}
        >
          {isChaosing ? (
            <>
              <i className="fas fa-spinner animate-spin"></i> {tr.concept.chaosModeLoading}
            </>
          ) : (
            <>
              <i className="fas fa-atom"></i> {tr.concept.chaosMode}
            </>
          )}
        </button>

        {chaosResult && (
          <div className="space-y-3 animate-scale-in rounded-2xl border border-fuchsia-500/35 bg-fuchsia-950/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-xl bg-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
                  <i className="fas fa-atom text-fuchsia-300 text-sm" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-zinc-100 truncate">{chaosResult.chaosTitle}</p>
                  <p className="text-[10px] font-mono text-fuchsia-300/90 leading-snug mt-1 break-words">
                    <span className="font-black uppercase tracking-wider text-fuchsia-400/95 mr-1.5">{tr.concept.chaosSystemLabel}:</span>
                    {chaosResult.systemLine}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChaosResult(null)}
                className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-all text-[10px] flex-shrink-0"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <p className="text-[11px] text-zinc-300 leading-relaxed">{chaosResult.chaosDescription}</p>

            <div className="flex flex-wrap gap-1.5">
              {(chaosResult.addGenres ?? []).map((g, i) => (
                <span key={`cg${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/30">
                  <i className="fas fa-music mr-1 text-[7px]" aria-hidden />
                  {g}
                </span>
              ))}
              {(chaosResult.addInstruments ?? []).map((inst, i) => (
                <span key={`ci${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-orange-500/15 text-orange-300 border border-orange-500/25">
                  <i className="fas fa-guitar mr-1 text-[7px]" aria-hidden />
                  {inst}
                </span>
              ))}
              {(chaosResult.addMoods ?? []).map((m, i) => (
                <span key={`cm${i}`} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-suno-secondary/15 text-suno-secondary border border-suno-secondary/25">
                  <i className="fas fa-face-smile mr-1 text-[7px]" aria-hidden />
                  {m}
                </span>
              ))}
            </div>

            {chaosResult.productionTip?.trim() && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-black/25 border border-fuchsia-500/20">
                <i className="fas fa-lightbulb text-fuchsia-400 text-[10px] mt-0.5 flex-shrink-0" aria-hidden />
                <p className="text-[10px] text-zinc-300 leading-relaxed">
                  <span className="font-black uppercase tracking-wider text-fuchsia-300 mr-1">{tr.concept.chaosTip}:</span>
                  {chaosResult.productionTip}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={applyChaos}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-100 hover:bg-fuchsia-500/35 transition-all"
              >
                <i className="fas fa-check"></i> {tr.concept.chaosApply}
              </button>
              <button
                type="button"
                onClick={() => setChaosResult(null)}
                className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider glass-btn text-zinc-500 hover:text-red-500 transition-all"
              >
                {tr.concept.chaosDismiss}
              </button>
            </div>
          </div>
        )}
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
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
              <i className="fas fa-lightbulb text-suno-primary flex-shrink-0"></i>
              <span>{tr.concept.songIdea}</span>
            </h3>
            <LabHelpIconButton accent="primary" onClick={() => setSongIdeaFieldHelpOpen(true)} />
          </div>

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

        <div className="glass-input flex flex-col overflow-hidden rounded-2xl p-0 min-h-[9rem] transition-[box-shadow,border-color] focus-within:border-suno-primary focus-within:shadow-[0_0_0_3px_rgba(168,85,247,0.15)] dark:focus-within:shadow-[0_0_0_3px_rgba(168,85,247,0.2)]">
          <textarea
            className="w-full min-h-[6.5rem] flex-1 cursor-text resize-none border-0 bg-transparent px-4 py-3 text-sm text-zinc-900 caret-suno-primary outline-none ring-0 dark:text-zinc-100 dark:caret-suno-secondary custom-scrollbar placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            placeholder={concept.isInstrumental ? tr.concept.placeholderInstrumental : tr.concept.placeholder}
            aria-label={tr.concept.songIdea}
            value={concept.topic}
            onChange={(e) => setConcept(prev => ({ ...prev, topic: e.target.value }))}
          />
          <div className="flex shrink-0 justify-center border-t border-zinc-200/70 bg-zinc-50/50 px-2 py-1.5 dark:border-white/10 dark:bg-black/15">
            <div className="grid w-full max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-suno-primary/20 bg-suno-primary/[0.05] p-1.5">
                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsRandomModalOpen(true)}
                    title={opts.randomizeTitle}
                    className="glass-btn flex min-h-[2rem] w-full items-center justify-center gap-1 rounded-lg px-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-suno-primary transition-colors hover:bg-suno-primary/10 disabled:opacity-60"
                  >
                    <i className="fas fa-dice flex-shrink-0 text-[9px]"></i>
                    <span className="truncate">{opts.randomThemes[0]}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCopilotModalOpen(true)}
                    className="glass-btn flex min-h-[2rem] w-full items-center justify-center gap-1 rounded-lg border border-suno-primary/30 px-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-suno-primary transition-colors hover:border-suno-primary hover:bg-suno-primary hover:text-white"
                  >
                    <i className="fas fa-comments flex-shrink-0 text-[9px]"></i>
                    <span className="min-w-0 truncate">{tr.concept.copilotTitle}</span>
                    {copilotDraft && (
                      <span className="inline-flex min-h-[1rem] min-w-[1rem] flex-shrink-0 items-center justify-center rounded-full bg-suno-primary/25 px-1 text-[8px] font-black">
                        1
                      </span>
                    )}
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-suno-secondary/20 bg-suno-secondary/[0.05] p-1.5">
                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsImageModalOpen(true)}
                    className="glass-btn flex min-h-[2rem] w-full items-center justify-center gap-1 rounded-lg border border-suno-secondary/25 px-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-suno-secondary transition-colors hover:border-suno-secondary hover:bg-suno-secondary hover:text-white"
                  >
                    <i className="fas fa-image flex-shrink-0 text-[9px]"></i>
                    <span className="min-w-0 truncate">{tr.concept.imageInspirationButton}</span>
                    {(inspirationImage || concept.imageInspirationText?.trim()) && (
                      <span className="inline-flex min-h-[1rem] min-w-[1rem] flex-shrink-0 items-center justify-center rounded-full bg-suno-secondary/25 px-1 text-[8px] font-black">
                        1
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsLinkModalOpen(true)}
                    className="glass-btn flex min-h-[2rem] w-full items-center justify-center gap-1 rounded-lg border border-suno-primary/25 px-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-suno-primary transition-colors hover:border-suno-primary hover:bg-suno-primary hover:text-white"
                  >
                    <i className="fas fa-link flex-shrink-0 text-[9px]"></i>
                    <span className="min-w-0 truncate">{tr.concept.linkInspirationButton}</span>
                    {musicLinkResult && (
                      <span className="inline-flex min-h-[1rem] min-w-[1rem] flex-shrink-0 items-center justify-center rounded-full bg-suno-primary/25 px-1 text-[8px] font-black">
                        1
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="relative rounded-2xl border border-suno-primary/20 bg-suno-primary/5 dark:bg-suno-primary/10 px-4 py-3">
          <div className="absolute top-2.5 right-2.5 z-10">
            <LabHelpIconButton accent="primary" onClick={() => setInspireHelpOpen(true)} />
          </div>
          <div className="flex flex-col items-center text-center">
            <button
              type="button"
              onClick={handleAnalyzeClick}
              disabled={isAnalyzing || !concept.topic?.trim()}
              className={`w-full max-w-[16rem] flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[10px] sm:text-[11px] font-black uppercase tracking-[0.12em] transition-colors border ${
                isAnalyzing
                  ? 'glass-btn text-suno-primary border-suno-primary/35 animate-pulse cursor-wait'
                  : concept.topic?.trim()
                  ? 'relative text-white border-suno-primary bg-suno-primary shadow-sm animate-inspire-next-cta hover:brightness-105 active:scale-[0.99]'
                  : 'glass-btn text-suno-primary/70 border-suno-primary/20 opacity-70 cursor-not-allowed'
              }`}
            >
              {isAnalyzing ? (
                <>
                  <i className="fas fa-spinner animate-spin text-[11px]"></i>
                  <span>{tr.concept.inspiring}</span>
                </>
              ) : (
                <>
                  <i className="fas fa-wand-magic-sparkles text-[11px]"></i>
                  <span>{tr.concept.inspire}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {isRandomModalOpen && createPortal(
        <div className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsRandomModalOpen(false)}>
          <div
            className="w-full max-w-2xl glass-card rounded-3xl p-6 space-y-4 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in overflow-y-auto max-h-[85vh] custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.15em] text-suno-primary">
                <i className="fas fa-dice mr-2"></i>{tr.concept.randomModalTitle}
              </p>
              <button
                type="button"
                onClick={() => setIsRandomModalOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            <p className="text-[10px] text-zinc-400 leading-relaxed">{tr.concept.randomModalHint}</p>

            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                  {tr.concept.randomDirectionLabel}
                </span>
                <select
                  value={randomThemePreset}
                  onChange={(e) => setRandomThemePreset(e.target.value)}
                  className="glass-input w-full rounded-lg px-2.5 py-2 text-[10px] font-semibold text-zinc-200"
                >
                  {opts.randomThemes.map((preset) => (
                    <option key={preset} value={preset}>{preset}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                  {tr.concept.randomDirectionCustomLabel}
                </span>
                <input
                  type="text"
                  value={randomDirectionCustom}
                  onChange={(e) => setRandomDirectionCustom(e.target.value)}
                  placeholder={tr.concept.randomDirectionCustomPlaceholder}
                  className="glass-input w-full rounded-lg px-2.5 py-2 text-[10px] text-zinc-200 placeholder:text-zinc-500"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleRandomize}
                disabled={isRandomizing}
                className={`px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all ${
                  isRandomizing ? 'glass-btn text-suno-primary opacity-70' : 'btn-create text-white'
                }`}
              >
                <i className={`fas ${isRandomizing ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'} mr-1`}></i>
                {isRandomizing ? tr.concept.randomAnalyzing : tr.concept.randomGenerate}
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                {tr.concept.randomResultLabel}
              </label>
              <textarea
                className="glass-input w-full rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 resize-none h-36 custom-scrollbar"
                placeholder={tr.concept.randomResultPlaceholder}
                value={randomSuggestion}
                onChange={(e) => setRandomSuggestion(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsRandomModalOpen(false)}
                className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] glass-btn text-zinc-400 hover:text-zinc-200"
              >
                {tr.about.close}
              </button>
              <button
                type="button"
                onClick={handleApplyRandomSuggestion}
                disabled={!randomSuggestion.trim()}
                className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] btn-create text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className="fas fa-arrow-turn-up mr-1"></i>
                {tr.concept.randomApply}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isImageModalOpen && createPortal(
        <div className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsImageModalOpen(false)}>
          <div
            className="w-full max-w-2xl glass-card rounded-3xl p-6 space-y-4 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in overflow-y-auto max-h-[85vh] custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.15em] text-suno-secondary">
                <i className="fas fa-image mr-2"></i>{tr.concept.imageInspirationTitle}
              </p>
              <button
                type="button"
                onClick={() => setIsImageModalOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="glass-btn px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-suno-secondary hover:bg-suno-secondary/10"
              >
                <i className="fas fa-upload mr-1"></i>
                {tr.concept.imageUpload}
              </button>
              <p className="text-[10px] text-zinc-400">{tr.concept.imageHint}</p>
            </div>

            <input
              ref={imageInputRef}
              type="file"
              accept={ACCEPTED_IMAGE}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageFile(f);
                e.target.value = '';
              }}
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsImageDragOver(true);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsImageDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsImageDragOver(false);
              }}
              onDrop={handleImageDrop}
              className={`rounded-2xl border border-dashed px-4 py-5 text-center transition-all ${
                isImageDragOver
                  ? 'border-suno-secondary bg-suno-secondary/15'
                  : 'border-zinc-600 bg-white/[0.02]'
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                <i className="fas fa-cloud-arrow-up mr-2 text-suno-secondary"></i>
                Bild hierher ziehen & ablegen
              </p>
              <p className="mt-1 text-[9px] text-zinc-400">
                JPG, PNG, WEBP, HEIC oder HEIF (max. 8 MB)
              </p>
            </div>

            {inspirationImage && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-zinc-700 bg-white/[0.03] p-3">
                <img src={inspirationImage.dataUrl} alt="Inspiration Upload" className="w-full sm:w-24 h-24 object-cover rounded-xl border border-zinc-700" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-zinc-200 truncate">{inspirationImage.name}</p>
                  <p className="text-[9px] text-zinc-400">{inspirationImage.sizeMB} MB</p>
                </div>
                <button
                  type="button"
                  onClick={handleAnalyzeImage}
                  disabled={isAnalyzingImage}
                  className={`px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all ${
                    isAnalyzingImage ? 'glass-btn text-suno-secondary opacity-70' : 'btn-create text-white'
                  }`}
                >
                  <i className={`fas ${isAnalyzingImage ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'} mr-1`}></i>
                  {isAnalyzingImage ? tr.concept.imageAnalyzing : tr.concept.imageAnalyze}
                </button>
              </div>
            )}

            <p className="text-[9px] leading-relaxed text-zinc-400">{tr.concept.imageSafetyHint}</p>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                {tr.concept.imageResultLabel}
              </label>
              <textarea
                className="glass-input w-full rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 resize-none h-28 custom-scrollbar"
                placeholder={tr.concept.imageResultPlaceholder}
                value={concept.imageInspirationText || ''}
                onChange={(e) => setConcept(prev => ({ ...prev, imageInspirationText: e.target.value }))}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsImageModalOpen(false)}
                className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] glass-btn text-zinc-400 hover:text-zinc-200"
              >
                {tr.about.close}
              </button>
              <button
                type="button"
                onClick={handleApplyImageIdea}
                disabled={!concept.imageInspirationText?.trim()}
                className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] btn-create text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className="fas fa-arrow-turn-up mr-1"></i>
                {tr.concept.imageApply}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isLinkModalOpen && createPortal(
        <div className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsLinkModalOpen(false)}>
          <div
            className="w-full max-w-2xl glass-card rounded-3xl p-6 space-y-4 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in overflow-y-auto max-h-[85vh] custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.15em] text-suno-primary">
                <i className="fas fa-link mr-2"></i>{tr.concept.linkInspirationTitle}
              </p>
              <button
                type="button"
                onClick={() => setIsLinkModalOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            <p className="text-[10px] text-zinc-400 leading-relaxed">{tr.concept.linkInspirationHint}</p>

            <div className="flex flex-col sm:flex-row items-stretch gap-2">
              <input
                type="url"
                placeholder={tr.concept.linkInspirationPlaceholder}
                value={musicLinkInput}
                onChange={(e) => {
                  setMusicLinkInput(e.target.value);
                  setMusicLinkResult(null);
                }}
                className="glass-input flex-1 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={handleAnalyzeMusicLink}
                disabled={isAnalyzingMusicLink || !trimmedMusicLinkInput || !isMusicLinkSupported}
                className={`px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all ${
                  isAnalyzingMusicLink ? 'glass-btn text-suno-primary opacity-70' : 'btn-create text-white'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <i className={`fas ${isAnalyzingMusicLink ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'} mr-1`}></i>
                {isAnalyzingMusicLink ? tr.concept.linkInspirationAnalyzing : tr.concept.linkInspirationAnalyze}
              </button>
            </div>
            <p className={`text-[9px] ${isMusicLinkSupported ? 'text-zinc-400' : 'text-red-400 font-semibold'}`}>
              {isMusicLinkSupported ? tr.concept.linkInspirationSupportedHint : tr.concept.linkInspirationUnsupported}
            </p>

            {musicLinkResult && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-suno-primary/25 bg-suno-primary/10 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-wider text-suno-primary mb-1">
                    {tr.concept.linkInspirationDetected}
                  </p>
                  <p className="text-[10px] text-zinc-200">
                    <span className="font-bold">{musicLinkResult.artist}</span>
                    <span className="text-zinc-400"> · </span>
                    <span>{musicLinkResult.title}</span>
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-wider text-zinc-300">
                    {tr.concept.linkInspirationIdeas}
                  </p>
                  {musicLinkResult.suggestions.map((idea, i) => (
                    <div key={`link-idea-${i}`} className="rounded-2xl border border-zinc-700 bg-white/[0.03] p-3 space-y-2">
                      <p className="text-[11px] text-zinc-200 leading-relaxed">{idea}</p>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleApplyMusicLinkIdea(idea)}
                          className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] btn-create text-white"
                        >
                          <i className="fas fa-arrow-turn-up mr-1"></i>
                          {tr.concept.linkInspirationApply}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsLinkModalOpen(false)}
                className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] glass-btn text-zinc-400 hover:text-zinc-200"
              >
                {tr.about.close}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isCopilotModalOpen && createPortal(
        <div className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsCopilotModalOpen(false)}>
          <div
            className="w-full max-w-2xl glass-card rounded-3xl p-6 space-y-4 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in overflow-y-auto max-h-[85vh] custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.15em] text-suno-primary">
                <i className="fas fa-comments mr-2"></i>{tr.concept.copilotModalTitle}
              </p>
              <button
                type="button"
                onClick={() => setIsCopilotModalOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            <p className="text-[10px] text-zinc-400 leading-relaxed">{tr.concept.copilotModalHint}</p>

            <div className="rounded-2xl border border-zinc-700 bg-black/25 p-3 space-y-3">
              <div ref={copilotChatScrollRef} className="h-64 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                {copilotMessages.map((m, idx) => (
                  <div key={`copilot-msg-${idx}`} className={`flex ${m.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed ${
                      m.role === 'assistant'
                        ? 'bg-suno-primary/15 border border-suno-primary/25 text-zinc-100'
                        : 'bg-suno-secondary/15 border border-suno-secondary/25 text-zinc-100'
                    }`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={copilotChatBottomRef} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={copilotInput}
                  onChange={(e) => setCopilotInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCopilotSend();
                    }
                  }}
                  placeholder={tr.concept.copilotChatPlaceholder}
                  className="glass-input flex-1 rounded-xl px-3 py-2 text-[11px] text-zinc-100 placeholder:text-zinc-500"
                  disabled={isCopilotGenerating || !!copilotDraft}
                />
                <button
                  type="button"
                  onClick={handleCopilotSend}
                  disabled={isCopilotGenerating || !copilotInput.trim() || !!copilotDraft}
                  className="btn-create px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className={`fas ${isCopilotGenerating ? 'fa-spinner animate-spin' : 'fa-paper-plane'} mr-1`}></i>
                  {tr.concept.copilotSend}
                </button>
              </div>
            </div>

            {copilotDraft && (
              <div className="space-y-3 rounded-2xl border border-zinc-700 bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">{tr.concept.copilotResultLabel}</p>
                <div className="grid grid-cols-1 gap-2 text-[11px] text-zinc-200">
                  <p><span className="text-zinc-400">{tr.concept.copilotOutTopic}:</span> {copilotDraft.topicShort}</p>
                  <p><span className="text-zinc-400">{tr.concept.copilotOutConflict}:</span> {copilotDraft.coreConflict}</p>
                  <p><span className="text-zinc-400">{tr.concept.copilotOutPerspective}:</span> {copilotDraft.perspective}</p>
                  <p><span className="text-zinc-400">{tr.concept.copilotOutArc}:</span> {copilotDraft.emotionArc}</p>
                  <p><span className="text-zinc-400">{tr.concept.copilotOutSetting}:</span> {copilotDraft.imagerySetting}</p>
                  <p><span className="text-zinc-400">{tr.concept.copilotOutInstruments}:</span> {(copilotDraft.instrumentHints || []).join(' · ') || '—'}</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleResetCopilot}
                className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] glass-btn text-zinc-400 hover:text-zinc-200"
              >
                {tr.concept.copilotRestart}
              </button>
              <button
                type="button"
                onClick={() => setIsCopilotModalOpen(false)}
                className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] glass-btn text-zinc-400 hover:text-zinc-200"
              >
                {tr.about.close}
              </button>
              <button
                type="button"
                onClick={handleApplyCopilotDraft}
                disabled={!copilotDraft?.topicShort?.trim()}
                className="px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] btn-create text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className="fas fa-arrow-turn-up mr-1"></i>
                {tr.concept.copilotApply}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {analyzeAgainModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[218] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setAnalyzeAgainModalOpen(false)}
        >
          <div
            className="w-full max-w-md glass-card rounded-3xl p-6 space-y-4 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-suno-primary pr-2">
                {tr.concept.analyzeAgainTitle}
              </h3>
              <button
                type="button"
                onClick={() => setAnalyzeAgainModalOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all flex-shrink-0"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
            <p className="text-[11px] text-zinc-300 leading-relaxed">{tr.concept.analyzeAgainBody}</p>
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={() => void runSongIdeaAnalysis('replace')}
                disabled={isAnalyzing}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] btn-create text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className="fas fa-sync-alt text-[10px]"></i>
                {tr.concept.analyzeAgainClear}
              </button>
              <button
                type="button"
                onClick={() => void runSongIdeaAnalysis('merge')}
                disabled={isAnalyzing}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] glass-btn border border-suno-secondary/40 text-suno-secondary hover:bg-suno-secondary/15 disabled:opacity-50"
              >
                <i className="fas fa-layer-group text-[10px]"></i>
                {tr.concept.analyzeAgainMerge}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAnalyzeAgainModalOpen(false)}
              className="w-full py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {tr.concept.analyzeAgainCancel}
            </button>
          </div>
        </div>,
        document.body
      )}

      {inspireHelpOpen && createPortal(
        <div
          className="fixed inset-0 z-[212] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setInspireHelpOpen(false)}
        >
          <div
            className="w-full max-w-md glass-card rounded-3xl p-6 space-y-4 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in overflow-y-auto max-h-[85vh] custom-scrollbar"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-suno-primary">
                {tr.concept.inspire}
              </h3>
              <button
                type="button"
                onClick={() => setInspireHelpOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
            <p className="text-[11px] text-zinc-300 leading-relaxed">{tr.concept.inspireHint}</p>
          </div>
        </div>,
        document.body
      )}

      {songIdeaFieldHelpOpen && createPortal(
        <div
          className="fixed inset-0 z-[212] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSongIdeaFieldHelpOpen(false)}
        >
          <div
            className="w-full max-w-md glass-card rounded-3xl p-6 space-y-4 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in overflow-y-auto max-h-[85vh] custom-scrollbar"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-suno-primary">
                {tr.concept.songIdea}
              </h3>
              <button
                type="button"
                onClick={() => setSongIdeaFieldHelpOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
            <div className="space-y-4 text-[11px] text-zinc-300 leading-relaxed">
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-suno-primary mb-1.5">{tr.concept.lyrics}</p>
                <p className="whitespace-pre-line">{tr.concept.songIdeaFieldHelpLyrics}</p>
              </div>
              <div className="border-t border-zinc-700/80 pt-4">
                <p className="text-[9px] font-black uppercase tracking-wider text-suno-primary mb-1.5">{tr.concept.instrumental}</p>
                <p className="whitespace-pre-line">{tr.concept.songIdeaFieldHelpInstrumental}</p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ChordInspirationModal
        isOpen={isChordModalOpen}
        onClose={closeChordModal}
        chordText={chordDraft}
        onChordTextChange={setChordDraft}
        onAppendChord={appendChordSnippet}
        onAnalyze={handleChordAnalyze}
        isAnalyzing={isChordAnalyzing}
      />

      {/* ═══ KREATIV-LAB ═══ */}
      <div className="glass-card rounded-3xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-2xl bg-suno-secondary/15 flex items-center justify-center flex-shrink-0">
              <i className="fas fa-flask text-suno-secondary text-sm"></i>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-suno-secondary truncate">
              {tr.concept.creativeLab}
            </p>
            <LabHelpIconButton accent="secondary" onClick={() => setLabHelpModalOpen(true)} />
          </div>
          <button
            type="button"
            onClick={() => setIsLabOpen(v => !v)}
            className={`flex-shrink-0 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all border ${
              isLabOpen
                ? 'glass-btn text-zinc-500 border-zinc-500/25 hover:bg-zinc-500/10 hover:text-zinc-200'
                : 'glass-btn text-suno-secondary border-suno-secondary/30 hover:bg-suno-secondary hover:text-white hover:border-suno-secondary'
            }`}
          >
            {isLabOpen ? (
              <>
                <i className="fas fa-times text-[9px]"></i>
                {tr.about.close}
              </>
            ) : (
              <>
                <i className="fas fa-sliders-h text-[9px]"></i>
                {tr.concept.chordLabOpenBtn}
              </>
            )}
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
                    <i className="fas fa-guitar text-suno-primary text-xs"></i>
                  </div>
                  <p className="text-[11px] text-zinc-300 leading-relaxed pt-0.5">{tr.concept.creativeLabDescChord}</p>
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
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-xl bg-fuchsia-500/25 flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-atom text-fuchsia-300 text-xs"></i>
                  </div>
                  <p className="text-[11px] text-zinc-300 leading-relaxed pt-0.5">{tr.concept.creativeLabDescChaos}</p>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {creativeToolHelp && createPortal(
          <div
            className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setCreativeToolHelp(null)}
          >
            <div
              className="w-full max-w-md glass-card rounded-3xl p-6 space-y-4 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in overflow-y-auto max-h-[85vh] custom-scrollbar"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-black uppercase tracking-wider text-suno-secondary">
                  {creativeToolHelp === 'refMixer' && tr.concept.refMixer}
                  {creativeToolHelp === 'chords' && tr.concept.chordInspirationBtn}
                  {creativeToolHelp === 'fusion' && tr.concept.fusionLab}
                  {creativeToolHelp === 'boost' && tr.concept.creativeBoost}
                  {creativeToolHelp === 'chaos' && tr.concept.chaosMode}
                </h3>
                <button
                  type="button"
                  onClick={() => setCreativeToolHelp(null)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
                >
                  <i className="fas fa-times text-sm"></i>
                </button>
              </div>
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                {creativeToolHelp === 'refMixer' && tr.concept.creativeLabDescRefMixer}
                {creativeToolHelp === 'chords' && tr.concept.creativeLabDescChord}
                {creativeToolHelp === 'fusion' && tr.concept.creativeLabDescFusion}
                {creativeToolHelp === 'boost' && tr.concept.creativeLabDescBoost}
                {creativeToolHelp === 'chaos' && tr.concept.creativeLabDescChaos}
              </p>
            </div>
          </div>,
          document.body
        )}

        {kreativLabContent}
      </div>

      {/* ═══ FIELDS GRID ═══ (z-20: Dropdowns über dem Weiter-Button) ═══ */}
      <div className="glass-card relative z-20 rounded-3xl p-6 space-y-6">
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
          <div className="relative">
            <SearchableMultiInput label={tr.concept.timbre} icon="fa-wave-square" options={opts.timbre} selected={concept.timbre ?? []}
              onToggle={(v) => toggle('timbre', v)} placeholder={opts.timbre.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing} accent="text-cyan-400" />
          </div>
          <div className="relative">
            <SearchableMultiInput label={tr.concept.exclude} icon="fa-ban" options={opts.exclusions} selected={concept.excludedStyles}
              onToggle={(v) => toggle('excludedStyles', v)} placeholder={opts.exclusions.slice(0, 2).join(', ') + '…'} isLoading={isAnalyzing} accent="text-red-400" />
          </div>
        </div>
      </div>

      {/* ═══ WEITER (zu Lyrics) ═══ */}
      {showPipelineChoice ? (
        <div className="flex flex-col sm:flex-row gap-3 mt-20 md:mt-24">
          <button
            type="button"
            onClick={() => onConceptContinue(concept, 'nav')}
            className="flex-1 glass-btn border border-white/25 dark:border-white/15 py-5 md:py-6 rounded-3xl text-zinc-800 dark:text-zinc-100 shadow-xl px-4 touch-target flex flex-col items-center justify-center gap-1.5 text-center"
          >
            <i className="fas fa-arrow-right text-lg text-suno-primary"></i>
            <span className="font-black text-sm md:text-base uppercase tracking-[0.12em] leading-tight">{tr.workflow.conceptNavOnly}</span>
            <span className="text-[10px] font-semibold normal-case tracking-normal text-zinc-500 dark:text-zinc-400 leading-snug max-w-[260px]">{tr.workflow.conceptNavOnlySub}</span>
          </button>
          <button
            type="button"
            onClick={() => onConceptContinue(concept, 'pipeline')}
            className="flex-1 btn-create relative py-5 md:py-6 rounded-3xl text-white shadow-2xl px-4 touch-target flex flex-col items-center justify-center gap-1.5 text-center"
          >
            <i className="fas fa-rotate text-lg"></i>
            <span className="font-black text-sm md:text-base uppercase tracking-[0.12em] leading-tight">{tr.workflow.conceptPipelineReset}</span>
            <span className="text-[10px] font-semibold normal-case tracking-normal text-white/85 leading-snug max-w-[260px]">{tr.workflow.conceptPipelineResetSub}</span>
          </button>
        </div>
      ) : (
      <div className="relative z-0 mt-20 md:mt-24 group">
        <div className="absolute -inset-0.5 suno-gradient rounded-3xl blur opacity-30 transition-opacity duration-500 group-hover:opacity-60"></div>
        <button type="submit"
          className="btn-create relative w-full py-5 md:py-6 rounded-3xl text-white font-black text-lg md:text-xl uppercase tracking-[0.2em] shadow-2xl flex items-center justify-center gap-3">
          <i className="fas fa-arrow-right text-lg"></i>
          {tr.concept.nextBtn}
          {nextStepSecondaryLabel && (
          <span className="absolute right-6 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium normal-case tracking-normal hidden md:block">
            {nextStepSecondaryLabel}
          </span>
          )}
        </button>
      </div>
      )}

    </form>

    </div>
  );
};

export default ConceptForm;
