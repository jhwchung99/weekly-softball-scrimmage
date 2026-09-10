# A shared spot is one spot, and its rows move together

Two players sharing a spot are modelled as two signup rows carrying the same
pair id, and every question about capacity, money, promotion and team
assignment treats them as one. `src/lib/pair.ts` owns that: callers ask it
rather than reading the field.

The alternative — one row with two occupants — was not taken because each
player needs their own waiver acceptance, their own first-come timestamp and
their own payment record. Those are per-person facts, and collapsing them into
one row would destroy evidence the league actually relies on. So the pairing
lives in a shared id, and the "one spot" rule lives in code.

Leaving that rule to each caller did not work. Five modules had each written
their own version of collapsing rows into spots — for capacity counting, cost
splitting, waitlist promotion, team sizing and attendance scenarios — and one
flow guarded against double-pairing four times in three different wordings.

Consolidating them surfaced a fault none of the copies had individually: keying
a spot as `pairId || signupId` lets a row whose signup id happens to equal
another row's pair id land in the wrong spot. Both are UUIDs, so it is
vanishingly unlikely, and it would be a miscounted roster spot rather than an
error — which is exactly the kind of thing worth making impossible rather than
improbable. Spot keys are namespaced.

## Consequences

Either partner can cancel without freeing the spot: while one row remains, the
spot still counts. That falls out of counting spots rather than rows, and is
not implemented anywhere as a rule of its own.

A pair with only one row present is still a spot, not a dropped one. A partner
who cancelled, or who sits outside the filter a caller applied, does not make
the remaining player stop occupying their place.
