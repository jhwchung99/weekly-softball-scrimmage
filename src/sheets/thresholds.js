// Turnout thresholds shared by generateScrimmage.js and
// generateAttendanceHistory.js — keep these in one place so the two scripts
// can't drift out of sync.

// Below this, cancel outright — not enough for even a practice.
export const MIN_FOR_ANYTHING = 7;

// Below this (but >= MIN_FOR_ANYTHING), practice only — not enough for a
// real 8v8 scrim.
export const MIN_FOR_SCRIMMAGE = 16;

// At/above this, a full scrimmage with a Rover (10-a-side); below it (but
// >= MIN_FOR_SCRIMMAGE), offer Practice OR a no-Rover scrim as options.
export const MIN_FOR_FULL_SCRIMMAGE = 18;
