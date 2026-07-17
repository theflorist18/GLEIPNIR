// Horizontal numbered progress strip for multi-step flows (M21/M22).
// `current` is a 0-based index into `steps`.
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper">
      {steps.map((label, i) => (
        <li key={label} className={`step ${i === current ? 'active' : ''} ${i < current ? 'done' : ''}`}>
          <span className="step-dot">{i < current ? '✓' : i + 1}</span>
          <span className="step-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}
