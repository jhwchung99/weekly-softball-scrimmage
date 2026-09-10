# A single global mutation lock, acquired by the flows

Every roster-changing operation runs under one process-wide lock in Redis,
because two simultaneous changes can otherwise each read "there is room" and
both confirm, oversubscribing the week. The lock is global rather than
per-session because there is one game a week: contention is a handful of
requests at registration open, and a global lock is far easier to reason about
than a keyed one for no practical loss.

An async queue (Upstash QStash) was the original plan and was rejected. Its
model is enqueue-and-process-later via a webhook, which would mean today's
synchronous validation errors — "you're already signed up", "profile required"
— could only surface later through polling, with nowhere in the schema to carry
a specific message back. A lock gets the same serialization with no change to
request/response behaviour at all.

**The acquisition belongs to the flow, not the route.** It used to be every
caller's job to remember, and two callers forgot: the admin signup override
took no lock at all, and a session's capacity was written between two separate
acquisitions, leaving a window for a signup to slip through. Fixing those one
at a time would have left the next author with the same thing to remember, so
each mutating flow now guards itself and no route module mentions the lock.

That requires the lock to be **reentrant**, which is the surprising part.
Flows call each other — the teams cron calls `generateTeamsIfDue` which calls
`generateTeams`; revising a session reschedules and then runs the promotion
cascade — so an outer hold routinely contains an inner one. Without reentrancy
that is not a race but a guaranteed deadlock: the inner acquire spins against
the key its own caller holds until the acquire timeout, then returns 503.
Reentrancy is an `AsyncLocalStorage` flag scoped to one request's async path,
so two independent operations still serialize against each other.

## Consequences

The lock fails open when Redis is not configured, so the app keeps working in
environments without it — the race simply stays open, as it was before the lock
existed.

The TTL has to exceed the worst case of the work it protects, or the lock
expires mid-flight and a second request starts mutating alongside the first.
Revising a session is the longest critical section — a rekey, a field write and
the promotion cascade under one hold.

That ceiling was reached. Measuring the flow rather than estimating it showed
~9 sequential Sheets calls, and `withRateLimitRetry` can sleep 7s on each, so
its worst case is ~63s against what was then a 60s TTL. The TTL is now 120s,
and `lib/__tests__/lockBudget.test.ts` measures the call count and fails if the
flow outgrows it again — so the number is checked rather than remembered. It is
the second time this TTL has needed raising; the first was from 15s.
