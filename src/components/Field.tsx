import type { ReactNode } from 'react';

/** The input styling repeated across the admin forms. Carries no width: two
 * width utilities on one element resolve by stylesheet order rather than the
 * order they are written in, so `w-24` layered on a `w-full` base silently
 * lost and stretched every numeric box across its column. Callers add the
 * width they want. */
export const controlClass = 'min-w-0 rounded border border-slate-300 px-2 py-1 text-sm';

/**
 * A label stacked above the control it names, with its buttons on the same
 * line and an optional hint below.
 *
 * The session editor used to lay every setting out in one long flex-wrap row,
 * which let a label wrap onto a different line from its own input: "Fields"
 * sat at the end of one row with its select stranded on the next, and the
 * ml-3 spacers meant to separate settings did nothing once a row broke.
 * Keeping each pair in one block makes that impossible at any width.
 */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className = '',
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {/* flex-wrap so a control and its buttons break among themselves rather
          than dragging the label away from them. */}
      <div className="mt-1 flex flex-wrap items-center gap-2">{children}</div>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
