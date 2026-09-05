import type { ReactNode } from 'react';

export type BadgeStatus =
  | 'confirmed'
  | 'waitlisted'
  | 'pending'
  | 'declined'
  | 'cancelled'
  | 'paid'
  | 'unpaid'
  | 'open'
  | 'closed';

const STATUS_STYLES: Record<BadgeStatus, string> = {
  confirmed: 'bg-green-100 text-green-800',
  paid: 'bg-green-100 text-green-800',
  open: 'bg-green-100 text-green-800',
  waitlisted: 'bg-amber-100 text-amber-800',
  pending: 'bg-blue-100 text-blue-800',
  declined: 'bg-slate-100 text-slate-600',
  unpaid: 'bg-slate-100 text-slate-600',
  closed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
};

/** A colored status pill — replaces plain colored text that was
 * previously decided ad hoc at each call site. */
export function Badge({ status, children }: { status: BadgeStatus; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {children}
    </span>
  );
}
