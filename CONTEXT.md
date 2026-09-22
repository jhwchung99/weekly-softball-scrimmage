# Weekly Softball Scrimmage

The signup app for a church's pickup softball games: a fixed number of spots,
first-come first-served with an automatic waitlist, and one person running it.
Usually one game a week, but a week may hold several — a Friday game and a
Sunday one, each with its own roster, schedule and price.

This is the glossary. Where two words are in use for one thing, the preferred
one is here and the others are listed under _Avoid_.

It governs the **code**, not what players read. Copy addressed to a player
says "the game" where this file says **Session**. The precision here exists to
stop *us* conflating a Session with a Signup; imposing it on a player is
precision with no reader. See `docs/voice.md` for how player-facing copy is
written, and ADR-0005 for why the two diverge.

That divergence narrowed on 2026-09-22. ADR-0005 rested on a player having one
game a week and no risk of confusing it with anything; where a week holds two,
copy has to name the day it means — "You're already signed up for Friday",
not "for this week". "The game" is still right wherever only one is in view.

## The week

**Session**:
One scheduled game — the date, the time, the field, and how many spots it has.
Its own roster, schedule, price and format; two sessions in one week share
nothing but the people who sign up for both. The id **is** the game date, so
there is at most one session per date.
_Avoid_: scrimmage, week, game (as a name for the record itself)

**Game day**:
The day a session is played. Any day of the week. It was Friday, Saturday or
Sunday until 2026-09-22, enforced by `validateGameDate` — a restriction that
was standing in for a rule it could not express (see **Registration window**).

**Registration window**:
The stretch when signups are accepted. Monday 9am until Tuesday midnight,
Eastern, **by default**; a session may set either end itself, the way it may
set its own roster lock (ADR-0008). Deliberately short, so the organizer can
book a permit sized to the actual headcount.

The default is derived from the game date, so it is coherent for every game
day except Monday, where it would close after the game had been played. A
Monday game therefore has to carry its own window, and the app refuses to save
one that does not. That check — the milestones coming in order — is what
replaced the old Friday/Saturday/Sunday restriction on **Game day**.
_Avoid_: registration period, signup window

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

**Format**:
Whether a session is a game or batting practice. Independent of Phase and of
whether registration is open: a practice week still opens, closes and can be
rained out. Set by the organizer, usually after reading a practice poll. Its
own field rather than a fourth Status, because Status already carries both
the registration lifecycle and cancellation (ADR-0007).
_Avoid_: type, kind, mode

**Practice**:
A session run as batting practice rather than a game, because too few people
signed up. No teams, and the game-day notes about rovers and equal playing
time do not apply. Player copy calls it **BP/Practice**, which is what the
league calls it. That divergence is ADR-0005's whole point.
_Avoid_: BP, BP/Practice, practice session, training

**Practice poll**:
One question put to a session's confirmed players when turnout is light:
would they come out for batting practice instead of a game. Open or closed,
at most one per session, and it decides nothing on its own. The organizer
reads the answers and sets the Format.
_Avoid_: survey, vote, BP poll

**Poll answer**:
One player's yes or no to the practice poll. Absent until they answer,
changeable while the poll is open, and read-only once it closes.
_Avoid_: response, reply, RSVP

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
