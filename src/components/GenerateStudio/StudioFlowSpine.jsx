import React from 'react';
import { Check } from 'lucide-react';

const STAGES = [
  { id: 'brief',      label: 'Brief',    num: 1 },
  { id: 'generating', label: 'Generate', num: 2 },
  { id: 'results',    label: 'Direct',   num: 3 },
  { id: 'publish',    label: 'Publish',  num: 4 },
];

const ORDER = { brief: 0, generating: 1, results: 2, publish: 3, published: 4 };

export default function StudioFlowSpine({ currentStage, onStageClick }) {
  // 'published' sits beyond the last visible step — render all 4 as done
  const currentIdx = currentStage === 'published' ? STAGES.length : (ORDER[currentStage] ?? 0);

  return (
    <div className="studio-spine-row">
      <nav className="sfs" aria-label="Studio flow stages">
        {STAGES.map((s, i) => {
          const isDone   = i < currentIdx;
          const isActive = i === currentIdx;
          const canClick = isDone; // can only go backward
          return (
            <React.Fragment key={s.id}>
              <button
                type="button"
                className={[
                  'sfs-node',
                  isDone   ? 'sfs-node--done'   : '',
                  isActive ? 'sfs-node--active'  : '',
                  !isDone && !isActive ? 'sfs-node--locked' : '',
                ].join(' ')}
                onClick={() => canClick && onStageClick?.(s.id)}
                disabled={!isDone && !isActive}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="sfs-dot">
                  {isDone
                    ? <Check size={11} strokeWidth={3} />
                    : <span>{s.num}</span>}
                </span>
                <span className="sfs-label">{s.label}</span>
              </button>
              {i < STAGES.length - 1 && (
                <span className="sfs-connector" aria-hidden="true">
                  <span className={`sfs-connector__fill${isDone ? ' sfs-connector__fill--done' : ''}`} />
                </span>
              )}
            </React.Fragment>
          );
        })}
      </nav>
    </div>
  );
}
