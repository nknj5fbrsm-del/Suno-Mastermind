
import React, { useState } from 'react';
import { useLang, useToast } from '../App';

interface ArtworkDisplayProps {
  coverUrl: string;
  songDescription: string;
  lyrics: string;
  stylePrompt: string;
  onUpdateStory: (newStory: string) => void;
  onRegenerateCover: (style: string) => Promise<void>;
}

const ART_STYLES = [
  'Default', 'Photorealistic', 'Oil Painting', 'Digital Art',
  'Anime/Manga', '3D Render', 'Minimalist', 'Vintage/Retro',
  'Cyberpunk', 'Watercolor', 'Dark Fantasy', 'Pop Art', 'Surrealism'
];
const CUSTOM_PROMPT_OPTION = 'custom'; // value für "Eigener Prompt"

// Formspree: Form-ID aus dem Dashboard. Formular muss bestätigt sein (Bestätigungs-Mail von Formspree klicken), sonst kommen keine E-Mails an.
const FORMSPREE_URL = 'https://formspree.io/f/xbdajoly';

const SUNO_CREATE_URL = 'https://suno.com/create';

const ArtworkDisplay: React.FC<ArtworkDisplayProps> = ({ coverUrl, songDescription, lyrics, stylePrompt, onUpdateStory, onRegenerateCover }) => {
  const { tr } = useLang();
  const { showToast } = useToast();
  const [isZoomed,         setIsZoomed]         = useState(false);
  const [feedbackText,     setFeedbackText]     = useState('');
  const [isSending,        setIsSending]        = useState(false);
  const [feedbackSent,     setFeedbackSent]     = useState(false);
  const [feedbackError,    setFeedbackError]    = useState(false);
  const [selectedArtStyle, setSelectedArtStyle] = useState('Default');
  const [customPromptText, setCustomPromptText] = useState('');
  const [customPromptModalOpen, setCustomPromptModalOpen] = useState(false);
  const [customPromptInput, setCustomPromptInput] = useState('');

  const handleDownload = () => {
    if (!coverUrl) return;
    const a = document.createElement('a');
    a.href = coverUrl; a.download = 'suno_cover_art.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleShareApp = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast(tr.artwork.linkCopied, 'success');
    } catch { showToast(tr.artwork.copyFailed, 'error'); }
  };

  const handleCopyLyrics = () => {
    try {
      navigator.clipboard.writeText(lyrics);
      showToast(tr.artwork.copied, 'success');
    } catch { showToast(tr.artwork.copyFailed, 'error'); }
  };

  const handleCopyLyricsClean = () => {
    try {
      const clean = lyrics.replace(/\[.*?\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
      navigator.clipboard.writeText(clean);
      showToast(tr.artwork.copied, 'success');
    } catch { showToast(tr.artwork.copyFailed, 'error'); }
  };

  const handleCopyStory = () => {
    try {
      navigator.clipboard.writeText(songDescription);
      showToast(tr.artwork.copied, 'success');
    } catch { showToast(tr.artwork.copyFailed, 'error'); }
  };

  const handleCopyStyle = () => {
    try {
      navigator.clipboard.writeText(stylePrompt);
      showToast(tr.artwork.copied, 'success');
    } catch { showToast(tr.artwork.copyFailed, 'error'); }
  };

  const handleOpenSuno = () => {
    window.open(SUNO_CREATE_URL, '_blank', 'noopener,noreferrer');
  };

  const handleArtStyleChange = (value: string) => {
    if (value === CUSTOM_PROMPT_OPTION) {
      setSelectedArtStyle(CUSTOM_PROMPT_OPTION);
      setCustomPromptInput(customPromptText);
      setCustomPromptModalOpen(true);
    } else {
      setSelectedArtStyle(value);
    }
  };

  const handleCustomPromptApply = () => {
    setCustomPromptText(customPromptInput.trim());
    setCustomPromptModalOpen(false);
  };

  const handleRegenerateCover = () => {
    if (selectedArtStyle === CUSTOM_PROMPT_OPTION) {
      if (!customPromptText.trim()) {
        setCustomPromptModalOpen(true);
        setCustomPromptInput(customPromptText);
      } else {
        onRegenerateCover(customPromptText);
      }
    } else {
      onRegenerateCover(selectedArtStyle);
    }
  };

  const handleSendFeedback = async () => {
    if (!feedbackText.trim() || isSending) return;
    if (feedbackText.trim().length < 10) {
      showToast(tr.artwork.feedbackMinLength, 'error');
      return;
    }
    setIsSending(true);
    setFeedbackError(false);
    try {
      // Formspree: FormData (wie im offiziellen AJAX-Beispiel) + Accept für JSON-Antwort
      const formData = new FormData();
      formData.append('message', feedbackText.trim());
      formData.append('page', window.location.href);
      formData.append('timestamp', new Date().toISOString());
      formData.append('_subject', 'Suno Mastermind – Feedback');

      const res = await fetch(FORMSPREE_URL, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
      });

      if (res.ok) {
        setFeedbackSent(true);
        setFeedbackText('');
        setTimeout(() => setFeedbackSent(false), 6000);
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Formspree feedback error:', res.status, err);
        setFeedbackError(true);
        setTimeout(() => setFeedbackError(false), 4000);
      }
    } catch (e) {
      console.warn('Formspree feedback network error:', e);
      setFeedbackError(true);
      setTimeout(() => setFeedbackError(false), 4000);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="space-y-5 animate-fade-up">

      {/* ─── Header ─── */}
      <div className="flex items-center gap-3">
        <p className="section-pill">{tr.artwork.pill}</p>
        <div className="gradient-line flex-1"></div>
        <span className="text-[9px] font-black text-zinc-400 uppercase tracking-wider hidden sm:block">1024 × 1024 · Suno</span>
      </div>

      {/* ═══ FÜR SUNO (oben, damit sofort sichtbar: alles kopierbar) ═══ */}
      <div className="glass-card rounded-3xl p-5 space-y-4 border-2 border-suno-primary/20">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-suno-primary flex items-center gap-1.5 mb-1">
            <i className="fas fa-copy text-[9px]"></i> {tr.artwork.sunoHandoffTitle}
          </p>
          <p className="text-[10px] text-zinc-600 dark:text-zinc-300 leading-relaxed">{tr.artwork.sunoHandoffHint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleCopyLyrics} disabled={!lyrics.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider btn-create text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-95 transition-opacity">
            <i className="fas fa-align-left text-[9px]"></i> {tr.artwork.copyLyrics}
          </button>
          <button onClick={handleCopyLyricsClean} disabled={!lyrics.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider glass-btn text-zinc-700 dark:text-zinc-200 hover:bg-suno-primary hover:text-white hover:border-suno-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            <i className="fas fa-align-left text-[9px]"></i> {tr.artwork.copyLyricsClean}
          </button>
          <button onClick={handleCopyStyle} disabled={!stylePrompt.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider glass-btn text-zinc-700 dark:text-zinc-200 hover:bg-suno-primary hover:text-white hover:border-suno-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            <i className="fas fa-bolt text-[9px]"></i> {tr.artwork.copyStyle}
          </button>
          <button onClick={handleCopyStory} disabled={!songDescription.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider glass-btn text-zinc-700 dark:text-zinc-200 hover:bg-suno-secondary hover:text-white hover:border-suno-secondary transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            <i className="fas fa-quote-left text-[9px]"></i> {tr.artwork.copyStory}
          </button>
          {coverUrl && (
            <button onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider glass-btn text-zinc-700 dark:text-zinc-200 hover:bg-suno-secondary hover:text-white hover:border-suno-secondary transition-all">
              <i className="fas fa-download text-[9px]"></i> {tr.artwork.coverDownload}
            </button>
          )}
          <button type="button" onClick={handleOpenSuno}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-zinc-700 dark:bg-zinc-600 text-white hover:bg-zinc-600 dark:hover:bg-zinc-500 transition-colors">
            <i className="fas fa-external-link-alt text-[9px]"></i> {tr.artwork.openSuno}
          </button>
        </div>
      </div>

      {/* ═══ MAIN GRID (Cover + Story) ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* ─── Cover ─── */}
        <div className="glass-card rounded-3xl p-5 space-y-4">
          {/* Controls */}
          <div className="flex items-center gap-2">
            <select
              value={selectedArtStyle}
              onChange={(e) => handleArtStyleChange(e.target.value)}
              className="glass-input flex-1 rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300 appearance-none cursor-pointer"
            >
              {ART_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              <option value={CUSTOM_PROMPT_OPTION}>{tr.artwork.customPromptOption}</option>
            </select>
            <button onClick={handleRegenerateCover} title={tr.artwork.regenerate}
              className="glass-btn w-9 h-9 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:text-suno-primary text-sm flex-shrink-0">
              <i className="fas fa-dice"></i>
            </button>
          </div>

          {/* Image */}
          <div className="relative group cursor-pointer rounded-2xl overflow-hidden" onClick={() => coverUrl && setIsZoomed(true)}>
            {coverUrl ? (
              <>
                <img src={coverUrl} alt="Album Cover"
                  className="w-full aspect-square object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/35 backdrop-blur-[2px]">
                  <div className="w-12 h-12 rounded-full bg-white/15 border border-white/30 flex items-center justify-center text-white shadow-xl">
                    <i className="fas fa-magnifying-glass-plus text-lg"></i>
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full aspect-square rounded-2xl glass-btn flex items-center justify-center">
                <i className="fas fa-compact-disc text-zinc-300 dark:text-zinc-600 text-5xl" style={{animation:'spin 8s linear infinite'}}></i>
              </div>
            )}
          </div>
        </div>

        {/* ─── Song Story ─── */}
        <div className="glass-card rounded-3xl p-5 flex flex-col gap-3">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-suno-secondary flex items-center gap-1.5">
            <i className="fas fa-quote-left text-[8px]"></i> {tr.artwork.storyTitle}
          </p>

          <div className="flex-1 relative">
            <div className="absolute left-2 top-3 bottom-3 w-0.5 bg-suno-secondary/25 rounded-full"></div>
            <textarea
              className="glass-input w-full h-full min-h-[220px] rounded-2xl pl-6 pr-4 py-3 text-sm italic text-zinc-700 dark:text-zinc-300 leading-relaxed resize-none custom-scrollbar bg-transparent"
              value={songDescription}
              onChange={(e) => onUpdateStory(e.target.value)}
              placeholder={tr.artwork.storyPlaceholder}
              spellCheck={false}
            />
          </div>
          <p className="text-[8px] text-zinc-400 font-bold uppercase tracking-wider text-center">
            <i className="fas fa-pen-to-square mr-1 opacity-40"></i>{tr.artwork.editable}
          </p>
        </div>
      </div>

      {/* ═══ BOTTOM ROW: Feedback + Share ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Feedback */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
            <i className={`fas ${feedbackSent ? 'fa-check-circle text-emerald-500' : 'fa-comment-dots text-suno-primary'} text-[9px]`}></i>
            {tr.artwork.feedbackTitle}
          </p>

          {feedbackSent ? (
            <div className="flex flex-col items-center justify-center py-6 text-center animate-scale-in">
              <div className="w-10 h-10 rounded-full bg-emerald-500/12 flex items-center justify-center mb-2 border border-emerald-500/20">
                <i className="fas fa-check text-emerald-500"></i>
              </div>
              <p className="text-[10px] font-black uppercase text-emerald-500">{tr.artwork.feedbackThanks}</p>
              <p className="text-[9px] text-zinc-400 mt-0.5">{tr.artwork.feedbackReceived}</p>
              <p className="text-[8px] text-zinc-500 dark:text-zinc-500 mt-2 max-w-[240px] leading-snug">{tr.artwork.feedbackSpamHint}</p>
            </div>
          ) : (
            <>
              <p className="text-[9px] text-zinc-500 dark:text-zinc-400 leading-relaxed">{tr.artwork.feedbackDesc}</p>
              <textarea
                className="glass-input w-full rounded-xl p-3 text-[10px] resize-none h-16 disabled:opacity-60"
                placeholder={tr.artwork.feedbackPlaceholder}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                disabled={isSending}
              />
              {feedbackError && (
                <p className="text-[9px] text-red-500 font-bold flex items-center gap-1.5 animate-fade-up">
                  <i className="fas fa-triangle-exclamation text-[8px]"></i> {tr.artwork.sendError}
                </p>
              )}
              <button onClick={handleSendFeedback} disabled={!feedbackText.trim() || isSending}
                className="w-full py-2 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all btn-create text-white disabled:opacity-40 disabled:cursor-not-allowed shadow">
                {isSending ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-paper-plane"></i>}
                {isSending ? tr.artwork.sending : tr.artwork.send}
              </button>
            </>
          )}
        </div>

        {/* Share */}
        <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
            <i className="fas fa-heart text-suno-secondary text-[9px]"></i> {tr.artwork.shareTitle}
          </p>
          <p className="text-[9px] text-zinc-500 dark:text-zinc-400 leading-relaxed flex-1">
            {tr.artwork.shareDesc}
          </p>
          <button onClick={handleShareApp}
            className="w-full py-2.5 glass-btn rounded-xl text-[9px] font-black uppercase tracking-wider text-suno-secondary hover:bg-suno-secondary hover:text-white hover:border-suno-secondary flex items-center justify-center gap-2 transition-all shadow">
            <i className="fas fa-copy text-[9px]"></i> {tr.artwork.copyLink}
          </button>
        </div>
      </div>

      {/* ─── Modal: Eigener Bildprompt ─── */}
      {customPromptModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-scale-in" onClick={() => setCustomPromptModalOpen(false)}>
          <div className="glass-card rounded-3xl p-6 w-full max-w-md shadow-2xl animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-suno-primary mb-3 flex items-center gap-1.5">
              <i className="fas fa-palette text-[9px]"></i> {tr.artwork.customPromptTitle}
            </p>
            <textarea
              className="glass-input w-full rounded-xl px-4 py-3 text-sm text-zinc-800 dark:text-zinc-200 min-h-[100px] resize-none custom-scrollbar mb-4"
              placeholder={tr.artwork.customPromptPlaceholder}
              value={customPromptInput}
              onChange={(e) => setCustomPromptInput(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setCustomPromptModalOpen(false)}
                className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider glass-btn text-zinc-600 dark:text-zinc-400 hover:bg-white/40 dark:hover:bg-white/10">
                {tr.artwork.customPromptCancel}
              </button>
              <button type="button" onClick={handleCustomPromptApply}
                className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider btn-create text-white shadow-md">
                {tr.artwork.customPromptApply}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Zoom Modal ─── */}
      {isZoomed && coverUrl && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-xl flex items-center justify-center p-4 animate-scale-in cursor-zoom-out"
          onClick={() => setIsZoomed(false)}>
          <div className="relative max-w-2xl w-full">
            <button className="absolute -top-10 right-0 text-white/70 hover:text-white text-2xl transition-colors"
              onClick={() => setIsZoomed(false)}>
              <i className="fas fa-times"></i>
            </button>
            <img src={coverUrl} alt="Zoom" className="w-full rounded-2xl shadow-2xl border border-white/10" />
          </div>
        </div>
      )}

    </section>
  );
};

export default ArtworkDisplay;
