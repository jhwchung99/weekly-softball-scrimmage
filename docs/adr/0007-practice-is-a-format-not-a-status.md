# Practice is a format, not a fourth session status

A week that turns out to be batting practice is recorded in its own
`Session.format` column, `'game' | 'practice'`, and not as a fourth value of
`Session.status`.

> Since ADR-0009 no cron reads `status`, so the failure argued from below can
> no longer happen. The decision stands: format and cancellation are still
> independent.

The request was for "a fourth session state", and the capability is exactly
that. The column differs for one concrete reason.

`status` already carries two unrelated things:

- the registration lifecycle, `'open'` then `'closed'`, written by the Monday
  and Tuesday crons and by the dashboard's Registration buttons
- whether the week is off at all, `'cancelled'`

A fourth value has to displace one of them. `closeRegistration` in
`scheduling.ts` guards itself with `if (existing.status !== 'open')`, which is
its idempotency check and what discards the DST duplicate firing. A week
marked as practice on Monday evening, while registration was still open,
would therefore make Tuesday's cron refuse to close it: the session would
never record `registrationClosesAt`, `sendHeadcountAlert` would never fire,
and `phaseOf` would keep reporting a window that had in fact passed.

That is a failure on precisely the weeks this feature exists for. A light
week is the one the organizer is most likely to mark early.

A separate column costs one more field and keeps both axes independent. A
practice week still opens, closes on schedule, and can be rained out like any
other. Nothing that reads `status` had to learn a new case; the surfaces that
care about a game — the game-day email, the teams card, the calendar summary,
the player homepage — read `format` instead.

## Consequence

Two fields have to be read to describe a week completely, and a reader who
checks only `status` will describe a practice week as an ordinary game. That
is the trade, and it is the safer direction: the failure mode is a surface
that says "game" when it should say "BP/Practice", not a cron that silently
stops running.

`practicePollStatus`, `practicePollClosesAt` and `practicePollThreshold` sit
beside `format` for the same reason — they describe the asking, not the
lifecycle.
