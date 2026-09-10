# One module decides what crosses to the client

Every path from a sheet row to a browser goes through a projection in
`src/lib/views.ts`, and route modules may return nothing else. The projections
construct their results field by field rather than spreading or forwarding a
row.

This exists because the obvious alternative failed silently in production. The
team view declared its members as a narrow five-field type and then forwarded
whole signup rows, which TypeScript accepts — a row is a structural supertype
of the narrow type, so it satisfies it. Serialization then shipped every field,
and any signed-in player with a signup for the week received every teammate's
email address, payment record, attendance history and waiver text. Nothing was
drawn on screen; it simply sat in the response. The sibling handler thirty lines
away stated that emails are never returned, and honoured it.

So the defence cannot be a narrow type, because a structural subset does not
exclude anything. It has to be construction: a projection built by naming the
fields it wants cannot leak one it did not name, whatever shape arrives.

The exported types are the wire contract and the client imports them, which
retired eleven hand-copied status unions and a duplicated view type that had
already drifted — the client's copy had dropped a field, which is why the team
editor could not call the shared coverage analyzer and silently reported every
edited team as fully covered.

## Consequences

Adding a column to the Signups tab cannot quietly join a payload, because
every projection constructs its result field by field: a function that lists
what it wants cannot return something it did not list, whatever shape arrives.

The mechanism this section first named — "adding a column fails the projection
tests" — was checked and is not true. Adding one fails nothing in `views.test.ts`;
what fails is `tsc`, because the fixtures stop satisfying `Signup`. The
guarantee is real and the enforcement is real, but it is the compiler and the
constructor, not the projection tests. Recorded rather than quietly corrected,
because a safety net you believe in and do not have is worse than one you know
you lack.

Admin payloads are projected too. Being admin-only is why the extra fields
would not be a disclosure; it is not a reason to send a console a waiver text
it never reads.
