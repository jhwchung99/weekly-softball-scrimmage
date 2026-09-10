# Session phase is computed on the server and sent to the client

The server decides what phase a session is in and sends the answer; the client
renders it rather than working it out again.

The milestone arithmetic — Eastern time, daylight saving, the Monday/Tuesday
schedule — was already in one place. The comparison against *now* was not: it
was written out in eight places, three of them in the browser. So whether the
roster was locked, whether payment had opened, and whether cancelling still
freed a spot automatically all depended on the viewer's own device clock being
right, and two players could be told different things about the same session.

Phase is derived from the game date and time rather than from the session's
stored status field. The two are checked together at the signup gate: status
alone was once the whole gate, which made it a single point of failure, because
anything that flipped a session open accepted signups immediately whatever the
calendar said.

## Consequences

The phase a browser holds is as fresh as its last fetch. A tab left open for
hours can show a stale phase until something reloads it. That is the accepted
cost of not trusting the viewer's clock, and it is the safer failure: a stale
phase is wrong for everyone the same way, where a wrong clock is wrong for one
person invisibly.

What stays in the browser is display only — the printed milestone dates are
pure arithmetic on the game date, and relative labels like "in 2 days" are soft
enough that a skewed clock does no harm.
