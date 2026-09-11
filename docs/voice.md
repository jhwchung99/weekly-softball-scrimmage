# How player-facing copy is written

Every word this app shows a player or emails them. Read this before changing
any of it.

`CONTEXT.md` is the glossary for the **code**. This is the glossary for the
**reader**, and they are deliberately different — see ADR-0005.

## The rules

1. **Say "the game".** Not "scrimmage", not "session". A player has one game a
   week and no risk of confusing it with anything, so the precision the code
   needs is precision with no reader.

2. **Human dates.** `formatGameDay` gives "Friday, July 10 at 6pm". Never
   `2026-07-10 at 18:00` in a sentence a player reads. The admin console keeps
   ISO, because there the date **is** the session's id and the organizer
   matches it against the spreadsheet.

3. **No em-dashes.** A full stop, a colon, or a comma. They are the most
   reliable tell that something was not written by a person.

4. **No exclamation marks.**

5. **Greeting yes, sign-off no.** `Hi Kevin Kim,` opens an email. Nothing
   closes it. No "See you on the field!", no "Thanks!".

6. **State the fact first.** No "Just a quick reminder that", no "Here are the
   details for". The first sentence is the thing that happened.

7. **Cut the justification.** If a sentence explains *why* a rule exists
   rather than what the reader should do about it, delete it. Keep anything
   that changes what someone does — including the reassurance that declining
   is safe, which changes whether they feel able to.

8. **Pushes front-load the number.** Organizer alerts are read at a glance on
   a lock screen. "3 of 20 spots unfilled", not "Registration closed with 3 of
   20 spots still open".

9. **"ET" means Eastern Time and nothing else.** It was also being used as a
   verb for an Interac e-Transfer — "Please ET the organizer" — on the same
   page that used it for the time zone two bullets earlier. Write
   **e-transfer** in full. And pick one of ET or "Eastern": it is ET.

10. **Bullets take no full stop.** They are fragments, and a list mixing
    "First-come, first-served" with "Play without a rover." reads as careless.
    A bullet needing two sentences wants a comma or a "so" instead.

11. **Times match `formatGameTime`.** It renders "9am", not "9:00am", so prose
    quoting the same moment says "9am" too.

12. **Oxford comma.** "Friday, Saturday, or Sunday" — five places already did,
    one did not.

## What this is not

Neutral means no manufactured cheer. It does not mean cold. "Please cancel so
someone else can take your spot" is exactly right and stays.

Nor is it a licence to cut. Accuracy outranks brevity every time: the
guest-sharing email is four paragraphs because every one of them changes what
the reader decides.

## Enforcement

`src/lib/__tests__/copyVoice.test.ts` fails on em-dashes and a short list of
banned phrases across the copy modules. Deliberately narrow — a style test
that cries wolf gets deleted, and then nothing is enforced at all.

## The waiver is exempt

`src/lib/waiver.ts` is consent language. Stiff formal English is correct
there, and softening it is a bad trade.
