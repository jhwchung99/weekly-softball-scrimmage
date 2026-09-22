# 8. The registration window is per session

Date: 2026-09-22

## Status

Accepted

## Context

ADR-0006 made the roster lock a per-session field because a fixed five-hour
offset was wrong for an early game. The registration window had the same shape
of problem and had not been looked at: it was derived from the game date —
9am Monday to 12am Tuesday of the game's own calendar week — and could not be
moved at all.

That was tolerable while every game was on a Friday, Saturday or Sunday. It
stopped being tolerable as soon as the organizer wanted a second game in the
same week on its own schedule, or a game on a weekday.

The `Session` row already carried columns named `registrationOpensAt` and
`registrationClosesAt`. They were not settings. The crons wrote the time of
their own firing into them, nothing ever read them back, and
`getWeeklyMilestones` deliberately ignored them. Two columns named for a thing
the app did not have.

There was also a restriction standing in the way: `validateGameDate` accepted
only Friday, Saturday and Sunday. It read as a league rule. It was really a
load-bearing safety check, and nothing said so.

Measuring the derived window across all seven weekdays showed why. For Tuesday
through Sunday it is coherent. For **Monday** it closes at 12am Tuesday, six
hours *after* a 6pm Monday game has been played. `phaseOf` walks its milestones
in order, so such a session returns `open` straight through game time and never
reaches `locked`: the roster keeps accepting signups during the game, the
waitlist never stops promoting, payment never opens, and the game-day email
refuses to send all day with nothing on the dashboard explaining why.

## Decision

A session may carry its own `registrationOpensAt` and `registrationClosesAt`.
Blank means the derived default, which is what almost every session uses.

Both are read in exactly one place — `getWeeklyMilestones`, which already
computed the window — so every consumer follows them without knowing they
exist: the signup gate, the phase, the player timeline, the watchdog and the
close-registration job. An unparseable value falls back to the default rather
than throwing, matching how `rosterLockAt` has always behaved, because a
hand-edited cell should not be able to take a session's whole schedule out.

The two columns are repurposed rather than added beside. They now hold what
their names always claimed. The stamps they used to hold move to
`registrationOpenedAt` and `registrationClosedAt` — past tense for what
happened, present tense for what is intended.

**The weekday restriction is replaced, not removed.** What now holds is that a
session's milestones come in order:

    registrationOpensAt < registrationClosesAt <= rosterLock < gameStart

`assertScheduleOrdering` enforces it, on the *effective* milestones — each
field's own value where it has one, the derived default where it does not.
Checking effective values is what lets one rule cover two failures that look
unrelated: a hand-typed window in the wrong order, and a Monday game with no
window of its own. The second is reported as "this game needs its own
registration times" rather than as an ordering violation, because the cause is
not visible in the numbers.

It lives in `adminFlow`, beside the lock check it generalizes, because it needs
the whole session. The per-field validators are handed one timestamp at a time
and cannot see the combination. It runs on create and on revise; it
deliberately does *not* run inside `adminRescheduleSession`, which sees only the
new date and time — moving a game to a Monday is legitimate in the same request
that supplies the window to go with it, and `reviseSession` is the layer holding
both.

## Consequences

Any day can be a game day, which is what the organizer asked for. The cost is
that a Monday game is the one case the app cannot schedule for you: it has to
be told when registration opens and closes, and it refuses to be created
otherwise. That refusal is the point — the alternative considered was
redefining the derived default as an offset from the game date, which would
have been coherent for all seven days but would have silently moved every
Saturday and Sunday session off the Monday open they use today. A rule that
changes a session's behaviour behind the organizer's back is the failure this
ADR exists to prevent.

The existing rows needed migrating, because their old stamps would otherwise be
read as overrides — and a cron that fired an hour late wrote an hour-late
timestamp, which as a setting would move that session's schedule permanently.
`scripts/migrateScheduleColumns.ts` moves each stamp to its new column and
blanks the setting, restoring the derived default those rows were already
using. It is idempotent.

`validateRosterLockAt`'s documented gap — "a lock after the game starts means
payment never opens; if it is worth closing, the check belongs in
`adminFlow.reviseSession`" — is now closed, by the check this ADR adds in
exactly the place that comment named.

CONTEXT.md's **Game day** and **Registration window** changed with this.
