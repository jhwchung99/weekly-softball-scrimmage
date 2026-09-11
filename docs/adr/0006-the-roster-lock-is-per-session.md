# 6. The roster lock is per session

Date: 2026-09-11

## Status

Accepted

## Context

The roster lock is the moment the waitlist stops promoting and payment opens.
It was a constant: `PROMOTION_CUTOFF_HOURS = 5`, subtracted from game time in
`getWeeklyMilestones`. Five hours before a 7pm game is 2pm, which is a
reasonable hour to do the week's last piece of admin.

Five hours before a 10am game is 5am, which is not.

That matters more than it used to, because the game-day email is now sent by
the organizer rather than by a cron, and it cannot go out before the lock: it
states what each player owes, and until the lock a cancellation can still move
that figure. A fixed five-hour offset therefore forced the organizer of an
early game to either send at dawn or send a hedged email that told players to
pay later, immediately above the e-transfer details.

The hour is the accident here. What the rule is really about is the figure
being final, and the organizer is in a better position than a constant to
decide when that should be for a given week.

## Decision

A session may carry its own `rosterLockAt`. Blank means the default of five
hours before game time, which is what almost every week uses.

The override is read in exactly one place — `getWeeklyMilestones`, which
already computed the lock — so every consumer follows it without knowing it
exists: payment opening, the waitlist, the player timeline, the watchdog, the
teams, and the game-day email.

An unparseable value falls back to the default rather than throwing. A
hand-edited cell should not be able to take a week's whole schedule out.

## Consequences

Locking earlier is not free, and the trade is real: auto-promotion stops
sooner, so an overnight cancellation before an early game is the organizer's to
fill by hand, and the cost share is fixed further ahead of the game. Both are
the existing behaviour of a lock with a longer exposure, not new machinery.

The lock is no longer derivable from the game time alone. Anything that wants
to know when a session locks has to ask `getWeeklyMilestones` with the session,
rather than subtracting five hours itself — which was already the rule
(ADR-0003 put the comparison in one place), and is now enforced by there being
a real answer that arithmetic cannot reach.

`CONTEXT.md`'s definition of **Roster lock** changed with this: it is the
moment promotion stops and payment opens, five hours before the game *by
default*, rather than five hours before the game full stop.
