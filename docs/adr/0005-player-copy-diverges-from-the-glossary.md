# 5. Player-facing copy diverges from the glossary

Date: 2026-09-10

## Status

Accepted

## Context

`CONTEXT.md` settles the app's vocabulary so that we stop conflating things
that are genuinely different: a **Session** is one week's game, a **Signup** is
one person's claim on it, a **Spot** is a place on the roster, and a **lineup
slot** is one of nine fielding positions. That precision has already paid for
itself — "slot" and "spot" meaning the same thing in five modules was a real
source of confusion.

It lists *scrimmage*, *week* and *game* under **Avoid**, as names for the
record itself.

Meanwhile every email said "the 2026-07-10 scrimmage", and the obvious
correction was to make the copy obey the glossary: "the 2026-07-10 session".

## Decision

The glossary governs the code. It does not govern what players read.

Player-facing copy says **"the game"**, and formats dates as
"Friday, July 10 at 6pm" rather than as the session's id.

## Consequences

A reader will see `Session` throughout `src/` and "the game" throughout the
emails, and the two never line up. That is the point, and this record exists so
it reads as a decision rather than as drift.

The reason is that the ambiguity the glossary protects against does not exist
for a player. They have one game a week. They cannot confuse it with a Signup,
because they have never heard of a Signup. Calling it a "session" to them buys
no clarity and costs the sentence its plainness — nobody at a church softball
game says "I signed up for Tuesday's session".

The same argument does not extend to **Spot**, which players do read and which
*is* worth being precise about: sharing a spot is a real rule with money
attached to it. The divergence is about the record's name, not a licence to
loosen the whole vocabulary.

`docs/voice.md` holds the rules this implies. The risk it carries is drift in
the other direction — copy inventing its own words for things that already have
names — which is why the voice rules are pointed at from `AGENTS.md` and why a
narrow test enforces the parts that can be checked mechanically.
