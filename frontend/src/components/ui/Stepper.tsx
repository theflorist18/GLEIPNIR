import { Icon, type IconName } from './Icon';

// Horizontal progress strip for multi-step flows (M21/M22; Claude Design
// screen 04). `current` is a 0-based index into `steps`. Done = success check,
// active = terracotta ring with the step's icon (or number), upcoming = the
// number; `error` turns the active dot to its error state.
export function Stepper({ steps, current, icons, error = false }: {
  steps: string[];
  current: number;
  icons?: IconName[];
  error?: boolean;
}) {
  return (
    <ol className="stepper">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className={`step ${active ? 'active' : ''} ${done ? 'done' : ''} ${active && error ? 'error' : ''}`}
            aria-current={active ? 'step' : undefined}
          >
            <span className="step-dot">
              {done ? <><Icon name="check-circle" size={30} /><span className="sr-only">completed</span></>
                : active && error ? <Icon name="x-circle" size={16} />
                : active && icons?.[i] ? <Icon name={icons[i]} size={16} />
                : i + 1}
            </span>
            <span className="step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
