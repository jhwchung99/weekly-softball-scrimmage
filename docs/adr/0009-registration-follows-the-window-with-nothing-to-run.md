# 9. Registration follows the window, with nothing to run

Date: 2026-09-23

## Status

Accepted. Supersedes the part of ADR-0003 that has the signup gate check the
stored `status` together with the phase. ADR-0007's decision stands, but the
cron behaviour it was argued from is gone.

## Context

The signup gate required two things: the session's stored `status` was `open`,
and the clock was inside its registration window. Sessions were created
`closed`, so something had to flip them open, and something had to flip them
closed again. Those were two GitHub Actions crons, at Monday 9am and Tuesday
midnight Eastern.

The crons did not work as a way to run anything on time. GitHub fired them
hours late, week after week, and disables `schedule` triggers entirely on a
repository with no commits for 60 days. The game-day email and team generation
had already moved off crons onto dashboard buttons for that reason. Opening and
closing registration were the two jobs left.

They had also stopped fitting the schedule. They looked up only the Friday,
Saturday and Sunday of the week, so a game on any other weekday was never
opened. And with ADR-0008 each session can set its own window, but the jobs
still fired only at Monday 9am and Tuesday midnight: a window that opened on
Tuesday was skipped as "not yet" and nothing ever tried again.

The window already answered the question the stored status was asking. Both
were checked because `status` alone was once the whole gate, and anything that
flipped it open accepted signups whatever the calendar said. With the window
checked, the stored status added nothing but a job that had to run.

## Decision

The session's own window is the whole signup gate. A signup is accepted when
`phaseOf` says `open` and the session is not cancelled. The stored `open` and
`closed` values are no longer read.

Nothing runs on a schedule. The open- and close-registration workflows, their
routes and the job functions behind them are removed.

The dashboard's Open and Close buttons send the same `status` they always did,
and `reviseSession` turns it into the window's edge: Open sets
`registrationOpensAt` to now, Close sets `registrationClosesAt` to now, on the
server's clock. So opening or closing by hand is just editing the window, and
it is checked by the same ordering rule as any other edit. Restoring a
cancelled game goes through the same status and leaves its window alone.

The headcount and open-spots pushes, which the close job sent, are dropped. The
dashboard already shows the count, and the light-turnout nudge towards a
practice poll is on the dashboard's agenda.

## Consequences

Registration opens and closes on any weekday, at whatever times the organizer
sets, with nothing that can fail to run. There is no longer a way for a week to
be stuck closed because a job did not fire, so the watchdog's
`open-registration` and `close-registration` checks and the matching agenda
items are gone with it.

`status` keeps its three values because the column is mapped by position and
old rows hold them. Only `cancelled` means anything; `open` and `closed` record
the last press of the buttons. `registrationOpenedAt` and
`registrationClosedAt`, which the crons stamped, are no longer written.

Nothing is sent when registration closes. If the organizer wants the headcount
pushed again, the watchdog's pattern is the way to do it: off ordinary page
traffic after the close time, deduplicated through Redis, with no schedule.
