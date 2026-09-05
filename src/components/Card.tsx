import type { ReactNode } from 'react';

/** The bordered/padded container pattern used throughout the app —
 * previously a hand-copied className string at every call site. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}
