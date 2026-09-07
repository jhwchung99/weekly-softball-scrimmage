/**
 * Shared by the client form and the server validator, kept in its own
 * module (like positions.ts) so the browser bundle doesn't have to pull
 * in feedback.ts and the push machinery behind it.
 */
export const FEEDBACK_KINDS = ['bug', 'feedback'] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: 'Something is broken',
  feedback: 'Suggestion or comment',
};

export const MAX_FEEDBACK_LENGTH = 1000;
