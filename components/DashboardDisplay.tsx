
import React, { useState, useRef } from 'react';
import { SongHistoryItem } from '../types';
import { exportArchive, importArchive } from '../services/storageService';
import { useLang, useToast } from '../App';

interface DashboardDisplayProps {
  history: SongHistoryItem[];
  onRecall: (item: SongHistoryItem) => void;
  onDelete: (id: string) => void;
  onStartNew: () => void;
}

const TUTORIAL_ACCENTS = ['text-emerald-500', 'text-suno-secondary', 'text-blue-400', 'text-yellow-500', 'text-suno-primary'];
const TUTORIAL_BORDERS = ['border-emerald-500/25', 'border-pink-500/25', 'border-blue-400/25', 'border-yellow-500/25', 'border-purple-500/25'];
const TUTORIAL_BG = ['from-emerald-500/10 to-emerald-500/3', 'from-pink-500/10 to-pink-500/3', 'from-blue-400/10 to-blue-400/3', 'from-yellow-500/10 to-yellow-500/3', 'from-purple-500/10 to-purple-500/3'];

// Farben passen sich dem gewählten Theme an (mastermind / sunset / forest) über suno-primary / suno-secondary
const WHATSNEW_ACCENTS = ['text-suno-primary', 'text-suno-secondary', 'text-suno-primary', 'text-suno-secondary', 'text-suno-primary', 'text-suno-secondary', 'text-suno-primary'];
const WHATSNEW_BG     = ['bg-gradient-to-br from-suno-primary/10 to-suno-primary/3', 'bg-gradient-to-br from-suno-secondary/10 to-suno-secondary/3', 'bg-gradient-to-br from-suno-primary/10 to-suno-primary/3', 'bg-gradient-to-br from-suno-secondary/10 to-suno-secondary/3', 'bg-gradient-to-br from-suno-primary/10 to-suno-primary/3', 'bg-gradient-to-br from-suno-secondary/10 to-suno-secondary/3', 'bg-gradient-to-br from-suno-primary/10 to-suno-primary/3'];
const WHATSNEW_BORDER = ['border-suno-primary/20', 'border-suno-secondary/20', 'border-suno-primary/20', 'border-suno-secondary/20', 'border-suno-primary/20', 'border-suno-secondary/20', 'border-suno-primary/20'];

const DashboardDisplay: React.FC<DashboardDisplayProps> = ({ history, onRecall, onDelete, onStartNew }) => {
  const { tr, lang } = useLang();
  const { showToast } = useToast();
  const [tutorialOpen,  setTutorialOpen]  = useState(false);
  const [archiveOpen,   setArchiveOpen]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      const data = await exportArchive();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `suno-mastermind-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { showToast(tr.dashboard.exportFailed, 'error'); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const count = await importArchive(event.target?.result as string);
        showToast(`${count} ${tr.dashboard.importSuccess}`, 'success');
        window.location.reload();
      } catch { showToast(tr.dashboard.importFailed, 'error'); }
    };
    reader.readAsText(file);
  };

  /* ─── MODALS ─────────────────────────────────────────────────────────────── */
  const modalStyle: React.CSSProperties = {
    background: 'rgba(18,10,35,0.97)',
    border: '1px solid rgba(168,85,247,0.25)',
    boxShadow: '0 24px 80px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.06) inset',
  };

  return (
    <section className="space-y-6 animate-fade-up">

      {/* ═══ TUTORIAL MODAL ═══ */}
      {tutorialOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-5" onClick={() => setTutorialOpen(false)}>
          <div className="w-full max-w-lg rounded-3xl p-6 space-y-4 animate-scale-in overflow-y-auto custom-scrollbar" style={{ ...modalStyle, maxHeight: 'calc(100vh - 140px)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="section-pill">{tr.tutorial.title}</p>
              <button onClick={() => setTutorialOpen(false)} className="glass-btn touch-target rounded-xl text-zinc-400 hover:text-red-400">
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
            <div className="gradient-line"></div>
            <div className="space-y-2.5">
              {tr.tutorial.steps.map((step, i) => (
                <div key={i} className={`flex items-start gap-4 p-4 rounded-2xl bg-gradient-to-br ${TUTORIAL_BG[i]} border ${TUTORIAL_BORDERS[i]}`}>
                  <div className={`w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center ${TUTORIAL_ACCENTS[i]} flex-shrink-0`}>
                    <i className={`fas ${step.icon} text-sm`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[8px] font-black uppercase tracking-wider ${TUTORIAL_ACCENTS[i]} opacity-50`}>{step.step}</span>
                      <p className={`text-xs font-black uppercase tracking-wider ${TUTORIAL_ACCENTS[i]}`}>{step.title}</p>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setTutorialOpen(false)}
              className="btn-create w-full py-3 rounded-2xl text-white font-black text-xs uppercase tracking-[0.18em] flex items-center justify-center gap-2">
              <i className="fas fa-check"></i> {tr.tutorial.close}
            </button>
          </div>
        </div>
      )}

      {/* ═══ ARCHIV MODAL ═══ */}
      {archiveOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-5" onClick={() => setArchiveOpen(false)}>
          <div className="w-full max-w-2xl rounded-3xl p-6 space-y-4 animate-scale-in overflow-y-auto custom-scrollbar" style={{ ...modalStyle, maxHeight: 'calc(100vh - 140px)' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <p className="section-pill">{tr.dashboard.archive}</p>
                {history.length > 0 && (
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    {history.length} {tr.dashboard.tracks}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json" />
                <button onClick={handleExport} className="glass-btn px-3 py-1.5 rounded-xl text-zinc-400 text-[9px] font-bold uppercase tracking-wider hover:text-suno-primary flex items-center gap-1.5">
                  <i className="fas fa-arrow-up-from-bracket text-[9px]"></i> {tr.dashboard.export}
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="glass-btn px-3 py-1.5 rounded-xl text-zinc-400 text-[9px] font-bold uppercase tracking-wider hover:text-suno-primary flex items-center gap-1.5">
                  <i className="fas fa-arrow-down-to-bracket text-[9px]"></i> {tr.dashboard.import}
                </button>
                <button onClick={() => setArchiveOpen(false)} className="glass-btn touch-target rounded-xl text-zinc-400 hover:text-red-400 ml-1">
                  <i className="fas fa-times text-sm"></i>
                </button>
              </div>
            </div>
            <div className="gradient-line"></div>

            {/* Content */}
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-14 h-14 rounded-2xl glass-btn flex items-center justify-center mb-4">
                  <i className="fas fa-compact-disc text-2xl text-zinc-600 animate-spin" style={{animationDuration:'8s'}}></i>
                </div>
                <p className="text-sm font-bold text-zinc-400 mb-1">{tr.dashboard.noHistory}</p>
                <p className="text-xs text-zinc-600 mb-5">{tr.dashboard.noHistorySub}</p>
                <button onClick={() => { setArchiveOpen(false); onStartNew(); }}
                  className="btn-create px-6 py-2.5 rounded-xl text-white font-black text-xs uppercase tracking-widest flex items-center gap-2">
                  <i className="fas fa-plus"></i> {tr.dashboard.newProject}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {history.map((item, idx) => (
                  <div key={item.id}
                    className="flex items-center p-3.5 gap-3 group cursor-pointer rounded-2xl transition-all duration-200 hover:bg-white/10 dark:hover:bg-white/5 border border-transparent hover:border-white/15"
                    onClick={() => { onRecall(item); setArchiveOpen(false); }}
                    style={{ animationDelay: `${idx * 0.03}s` }}>
                    <div className="relative w-12 h-12 flex-shrink-0">
                      {item.coverUrl
                        ? <img src={item.coverUrl} className="w-full h-full rounded-xl object-cover shadow-md group-hover:scale-105 transition-transform duration-500" alt={item.concept.topic} />
                        : <div className="w-full h-full rounded-xl suno-gradient flex items-center justify-center text-white"><i className="fas fa-music"></i></div>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-zinc-200 truncate group-hover:text-suno-primary transition-colors">
                        {item.concept.topic || tr.dashboard.untitled}
                      </p>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {item.concept.genre?.slice(0, 2).map(g => (
                          <span key={g} className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-suno-primary/10 text-suno-primary">{g}</span>
                        ))}
                      </div>
                      <p className="text-[9px] text-zinc-500 font-medium mt-0.5">
                        {new Date(item.timestamp).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); onRecall(item); setArchiveOpen(false); }}
                        className="w-8 h-8 glass-btn rounded-lg flex items-center justify-center text-suno-primary text-[11px]" title={tr.dashboard.recall}>
                        <i className="fas fa-folder-open"></i>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                        className="w-8 h-8 glass-btn rounded-lg flex items-center justify-center text-zinc-400 hover:bg-red-500 hover:text-white hover:border-red-500 text-[11px] transition-all" title={tr.dashboard.delete}>
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Close button */}
            <button onClick={() => setArchiveOpen(false)}
              className="btn-create w-full py-3 rounded-2xl text-white font-black text-xs uppercase tracking-[0.18em] flex items-center justify-center gap-2">
              <i className="fas fa-times"></i> {tr.tutorial.close}
            </button>
          </div>
        </div>
      )}

      {/* ═══ HERO ═══ */}
      <div className="glass-card rounded-3xl p-7 md:p-10 relative overflow-hidden">
        <div className="absolute inset-0 suno-gradient-soft rounded-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight text-zinc-900 dark:text-white">
              {tr.dashboard.headline}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 font-medium max-w-sm leading-relaxed">
              {tr.dashboard.sub}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            <button onClick={() => setTutorialOpen(true)}
              className="glass-btn flex items-center gap-2 px-4 py-2.5 rounded-2xl text-zinc-600 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider hover:text-suno-primary touch-target">
              <i className="fas fa-circle-info text-suno-primary"></i>
              {tr.dashboard.tutorial}
            </button>
            {history.length > 0 && (
              <button onClick={() => setArchiveOpen(true)}
                className="glass-btn flex items-center gap-2 px-4 py-2.5 rounded-2xl text-zinc-600 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider hover:text-suno-secondary touch-target">
                <i className="fas fa-folder-open text-suno-secondary"></i>
                {tr.dashboard.archive}
                <span className="ml-0.5 px-1.5 py-0.5 rounded-md bg-suno-secondary/15 text-suno-secondary text-[9px] font-black">{history.length}</span>
              </button>
            )}
            <button onClick={onStartNew}
              className="btn-create flex items-center gap-2 px-5 py-2.5 rounded-2xl text-white font-black text-xs uppercase tracking-[0.18em] shadow-xl touch-target">
              <i className="fas fa-plus"></i>
              {tr.dashboard.newProject}
            </button>
          </div>
        </div>
      </div>

      {/* ═══ WHAT'S NEW ═══ */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <p className="section-pill">{tr.dashboard.whatsNew}</p>
          <div className="gradient-line flex-1"></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {tr.dashboard.whatsNewItems.map((item, i) => (
            <div key={i} className={`glass-card rounded-2xl p-5 flex items-start gap-4 ${WHATSNEW_BG[i]} border ${WHATSNEW_BORDER[i]}`}>
              <div className={`w-9 h-9 rounded-xl bg-white/8 dark:bg-black/15 flex items-center justify-center flex-shrink-0 ${WHATSNEW_ACCENTS[i]}`}>
                <i className={`fas ${item.icon} text-sm`}></i>
              </div>
              <div>
                <p className={`text-[10px] font-black uppercase tracking-[0.15em] mb-1 ${WHATSNEW_ACCENTS[i]}`}>{item.title}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

    </section>
  );
};

export default DashboardDisplay;
