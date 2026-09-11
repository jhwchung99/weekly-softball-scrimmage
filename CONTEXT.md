# Weekly Softball Scrimmage

The signup app for a church's weekly pickup softball game: one game a week,
a fixed number of spots, first-come first-served with an automatic waitlist,
and one person running it.

This is the glossary. Where two words are in use for one thing, the preferred
one is here and the others are listed under _Avoid_.

It governs the **code**, not what players read. A player has one game a week
and no risk of confusing it with anything, so copy addressed to them says
"the game" where this file says **Session**. The precision here exists to stop
*us* conflating a Session with a Signup; imposing it on a player is precision
with no reader. See `docs/voice.md` for how player-facing copy is written, and
ADR-0005 for why the two diverge.

## The week

**Session**:
One week's game — the date, the time, the field, and how many spots it has.
_Avoid_: scrimmage, week, game (as a name for the record itself)

**Game day**:
The day a session is played. Friday, Saturday or Sunday.

**Registration window**:
The stretch when signups are accepted: Monday 9am until Tuesday midnight,
Eastern. Deliberately short, so the organizer can book a permit sized to the
actual headcount.

**Phase**:
Where a session stands right now: before, open, closed, locked, or played.
Derived from the game date and time, never from the viewer's clock.
_Avoid_: state, stage

**Roster lock**:
The moment the waitlist stops promoting automatically and payment opens. Five
hours before game time by default; a session may set its own, which is how an
early game locks the evening before rather than at dawn (ADR-0006). After the
lock, a freed spot is the organizer's to fill by hand.
_Avoid_: cutoff, deadline

## The roster

**Signup**:
One person's claim on one session, and the record of it — their standing, when
they asked, and the waiver they accepted.
_Avoid_: registration, entry, booking

**Spot**:
A place on the roster. Capacity is counted in spots, and a spot is what a
player pays for.
_Avoid_: slot, seat, place — "slot" means a lineup slot, below

**Capacity**:
How many spots a session has. Set by the organizer, and what the roster is
measured against.

**Confirmed / Waitlisted / Cancelled**:
A signup's standing. Confirmed holds a spot, waitlisted is queued for one,
cancelled has given theirs up. A cancelled signup is kept, not deleted — it is
the record of a spot someone held and gave back.

**Shared spot**:
One spot occupied by two players. They are billed, promoted, moved between
teams and counted as one.

**Pair**:
The two players sharing a spot.

**Sub request**:
One player asking another to share their spot. Pending until answered, and
answering is the only thing that forms a pair — a name typed into a form never
is.

**Promotion**:
Moving a waitlisted spot to confirmed because one came free. Automatic until
the roster lock.

## The people

**Organizer**:
The person running the league: books the permit, sets capacity, posts teams,
collects payment.
_Avoid_: admin (that is the access role, not the person), owner

**Player**:
Anyone signed up for a session, or who could be.

**Member / Guest**:
A player's standing in the league. A guest names the member who invited them,
and may be offered a share of that member's spot rather than taking their own.

**Inviter**:
The member a guest names when they sign up.

## The teams

**Team**:
Half a diamond's worth of players for one session. Two teams per booked field.

**Lineup slot**:
One of the nine fielding positions a team has to cover. This is the only thing
"slot" means.

**Deficiency**:
How many lineup slots a team cannot cover at once, counting the worst case of
who turns up from each shared spot.

**Draft / Posted**:
Whether teams are still the organizer's to edit, or visible to players.

## The money

**Price per spot**:
What one spot costs a player. Fixed when the session is created, so it can be
quoted at signup and is still true on game day.
_Avoid_: cost

**Permit cost**:
What the field permit cost the organizer. Bookkeeping — it is not divided
among players and they never see it.
_Avoid_: cost

**Cost share**:
What one player owes: the price per spot, halved when the spot is shared.

**Float**:
The gap between what the permit cost and what the spots collected. The
organizer's to absorb either way.
