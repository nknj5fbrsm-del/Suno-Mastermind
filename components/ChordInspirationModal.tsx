import React from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '../App';
import ChordProgressionDictionary from './ChordProgressionDictionary';

interface ChordInspirationModalProps {
  isOpen: boolean;
  onClose: () => void;
  chordText: string;
  onChordTextChange: (value: string) => void;
  onAppendChord: (snippet: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

const ChordInspirationModal: React.FC<ChordInspirationModalProps> = ({
  isOpen,
  onClose,
  chordText,
  onChordTextChange,
  onAppendChord,
  onAnalyze,
  isAnalyzing,
}) => {
  const { tr } = useLang();

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl glass-card rounded-3xl p-6 space-y-4 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl animate-scale-in overflow-y-auto max-h-[90vh] custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-suno-secondary">
            <i className="fas fa-guitar mr-2"></i>
            {tr.concept.chordModalTitle}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <p className="text-[10px] text-zinc-400 leading-relaxed">{tr.concept.chordModalHint}</p>

        <div className="space-y-2">
          <label className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500">
            {tr.concept.chordFieldLabel}
          </label>
          <textarea
            className="glass-input w-full rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 resize-none min-h-[88px] custom-scrollbar font-mono"
            placeholder={tr.concept.chordPlaceholder}
            value={chordText}
            onChange={(e) => onChordTextChange(e.target.value)}
            spellCheck={false}
          />
        </div>

        <ChordProgressionDictionary
          onInsert={(snippet) => {
            onAppendChord(snippet);
          }}
        />

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            type="button"
            onClick={onAnalyze}
            disabled={isAnalyzing || !chordText.trim()}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.12em] transition-all ${
              isAnalyzing || !chordText.trim()
                ? 'glass-btn opacity-50 cursor-not-allowed'
                : 'btn-create text-white shadow-md'
            }`}
          >
            {isAnalyzing ? (
              <>
                <i className="fas fa-spinner animate-spin"></i> {tr.concept.chordAnalyzing}
              </>
            ) : (
              <>
                <i className="fas fa-wand-magic-sparkles"></i> {tr.concept.chordAnalyzeBtn}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-wider glass-btn text-zinc-400 hover:text-zinc-200"
          >
            {tr.concept.chordModalClose}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ChordInspirationModal;
