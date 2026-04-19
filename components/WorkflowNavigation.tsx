import React from 'react';
import { WorkflowStep } from '../types';
import { useLang } from '../App';

interface WorkflowNavigationProps {
  activeStep: WorkflowStep;
  setActiveStep: (step: WorkflowStep) => void;
  /** Konzept „fertig“ (z. B. Thema ausgefüllt). */
  hasConcept: boolean;
  /** Lyrics-Tab erst nach „Weiter“ im Konzept (bzw. freigeschaltete Kette). */
  lyricsTabEnabled: boolean;
  hasLyrics: boolean;
  /** Style-Tab erst nach „Weiter“ im Lyrics-Schritt. */
  styleTabEnabled: boolean;
  hasStyle: boolean;
  /** Wenn true, sind zwei Lyrics-Varianten vorhanden; Style ist dann klickbar (generiert Style aus beiden). */
  hasLyricsVariants?: boolean;
  /** Cover-Tab: erst nach „Weiter“ vom Style (oder schon auf Cover / Archiv). */
  coverTabEnabled: boolean;
}

const WorkflowNavigation: React.FC<WorkflowNavigationProps> = ({
  activeStep,
  setActiveStep,
  hasConcept,
  lyricsTabEnabled,
  hasLyrics,
  styleTabEnabled,
  hasStyle,
  hasLyricsVariants,
  coverTabEnabled,
}) => {
  const { tr } = useLang();
  const steps = [
    { id: WorkflowStep.DASHBOARD, icon: 'fa-house',         label: tr.nav.home,    enabled: true },
    { id: WorkflowStep.CONCEPT,   icon: 'fa-wand-sparkles', label: tr.nav.concept, enabled: true },
    { id: WorkflowStep.LYRICS,    icon: 'fa-align-left',    label: tr.nav.lyrics,  enabled: hasConcept && lyricsTabEnabled },
    { id: WorkflowStep.STYLE,     icon: 'fa-sliders',       label: tr.nav.style,   enabled: styleTabEnabled && (hasStyle || !!hasLyricsVariants) },
    { id: WorkflowStep.ARTWORK,   icon: 'fa-image',         label: tr.nav.cover,   enabled: coverTabEnabled },
  ];

  return (
    <nav className="glass-nav flex w-full p-1 rounded-2xl overflow-x-auto no-scrollbar">
      <div className="flex w-full gap-0.5">
        {steps.map((step, idx) => {
          const isActive = activeStep === step.id;
          return (
            <button
              key={step.id}
              disabled={!step.enabled}
              onClick={() => setActiveStep(step.id)}
              className={`
                relative flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5
                px-2 py-2 sm:px-3.5 rounded-xl border border-transparent
                text-[9px] sm:text-[10px] font-bold uppercase tracking-wide whitespace-nowrap
                transition-all duration-200 min-h-[44px]
                ${isActive
                  ? 'btn-create text-white shadow-md border-suno-primary'
                  : step.enabled
                    ? 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-white/8 hover:border-zinc-300 dark:hover:border-white/20'
                    : 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed opacity-40'
                }
              `}
            >
              <i className={`fas ${step.icon} text-xs`}></i>
              <span className="leading-none">{step.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default WorkflowNavigation;
