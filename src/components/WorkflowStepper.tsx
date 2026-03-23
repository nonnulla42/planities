import React from 'react';
import { Check } from 'lucide-react';

export type WorkflowStep = 'trace' | 'scale' | '3d';

interface WorkflowStepperProps {
  currentStep: WorkflowStep;
  isScaleCalibrated: boolean;
  hasBackground: boolean;
}

const steps: Array<{
  id: WorkflowStep;
  title: string;
  description: string;
}> = [
  {
    id: 'scale',
    title: 'Scale',
    description: 'Trace one known segment, enter its real length, and lock the project scale',
  },
  {
    id: 'trace',
    title: 'Trace',
    description: 'Draw the full plan in real dimensions over the calibrated reference',
  },
  {
    id: '3d',
    title: '3D',
    description: 'Explore the generated space',
  },
];

export const WorkflowStepper: React.FC<WorkflowStepperProps> = ({ currentStep, isScaleCalibrated, hasBackground }) => {
  const visibleSteps = hasBackground ? steps : steps.filter((step) => step.id !== 'scale');

  const getStepState = (stepId: WorkflowStep) => {
    if (!hasBackground && stepId === 'scale') {
      return 'skipped';
    }

    if (stepId === 'scale') {
      if (!hasBackground) return 'skipped';
      if (isScaleCalibrated) return 'completed';
      if (currentStep === 'scale') return 'active';
      return 'upcoming';
    }

    if (stepId === 'trace') {
      if (currentStep === '3d') return 'completed';
      if (currentStep === 'trace') return 'active';
      return isScaleCalibrated || !hasBackground ? 'upcoming' : 'disabled';
    }

    if (currentStep === '3d') return 'active';
    return isScaleCalibrated || !hasBackground ? 'upcoming' : 'disabled';
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {visibleSteps.map((step, index) => {
          const stepState = getStepState(step.id);
          const isActive = stepState === 'active';
          const isCompleted = stepState === 'completed';
          const isDisabled = stepState === 'disabled';

          return (
            <div
              key={step.id}
              className={`flex min-w-0 items-center gap-2 rounded-full border px-3 py-2 transition-all sm:px-4 ${
                isActive
                  ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                  : isCompleted
                    ? 'bg-white/80 text-[#141414] border-[#141414]/10'
                    : isDisabled
                      ? 'bg-transparent text-[#141414]/30 border-[#141414]/5'
                      : 'bg-white/40 text-[#141414]/60 border-[#141414]/10'
              }`}
            >
              {isCompleted ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Check className="h-3 w-3" />
                </span>
              ) : (
                <span className={`shrink-0 text-[9px] font-mono uppercase tracking-[0.2em] ${isDisabled ? 'opacity-50' : 'opacity-60'}`}>
                  {String(index + 1).padStart(2, '0')}
                </span>
              )}
              <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em] sm:text-[11px]">{step.title}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] leading-relaxed text-[#141414]/45">
        {visibleSteps.find((step) => step.id === currentStep)?.description}
      </p>
    </div>
  );
};
