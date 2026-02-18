import React from 'react';
import { WorkflowStep } from '../types';
import { useLang } from '../App';

interface WorkflowNavigationProps {
  activeStep: WorkflowStep;
  setActiveStep: (step: WorkflowStep) => void;
  hasLyrics: boolean;
  hasStyle: boolean;
  /** Wenn true (Lyrics-Varianten-Modal), sind Style und Cover ausgegraut. */
  isComparingLyrics?: boolean;
}

const WorkflowNavigation: React.FC<WorkflowNavigationProps> = ({ activeStep, setActiveStep, hasLyrics, hasStyle, isComparingLyrics }) => {
  const { tr } = useLang();
  const steps = [
    { id: WorkflowStep.DASHBOARD, icon: 'fa-house',         label: tr.nav.home,    enabled: true },
    { id: WorkflowStep.CONCEPT,   icon: 'fa-wand-sparkles', label: tr.nav.concept, enabled: true },
    { id: WorkflowStep.LYRICS,    icon: 'fa-align-left',    label: tr.nav.lyrics,  enabled: hasLyrics },
    { id: WorkflowStep.STYLE,     icon: 'fa-sliders',       label: tr.nav.style,   enabled: hasStyle && !isComparingLyrics },
    { id: WorkflowStep.ARTWORK,   icon: 'fa-image',         label: tr.nav.cover,   enabled: hasStyle && !isComparingLyrics },
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
                px-2 py-2 sm:px-3.5 rounded-xl
                text-[9px] sm:text-[10px] font-bold uppercase tracking-wide whitespace-nowrap
                transition-all duration-200 min-h-[44px]
                ${isActive
                  ? 'btn-create text-white shadow-md'
                  : step.enabled
                    ? 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-white/35 dark:hover:bg-white/8'
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
