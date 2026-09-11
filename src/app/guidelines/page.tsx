import type { Metadata } from 'next';
import { GAME_DAY_NOTES } from '../../lib/gameDayNotes';
import { Card } from '../../components/Card';

export const metadata: Metadata = {
  title: 'Guidelines | Weekly Softball Scrimmage',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mt-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{children}</ul>
    </Card>
  );
}

export default function GuidelinesPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Guidelines</h1>
      <p className="mt-1 text-sm text-slate-500">How signups work.</p>

      <Section title="When to sign up">
        <li><strong>Signups open Monday at 9am ET</strong></li>
        <li><strong>Signups close at midnight on Monday night</strong>, ET</li>
        <li>Nobody is added after that</li>
        <li>Games are Friday, Saturday, or Sunday. The homepage says which</li>
      </Section>

      <Section title="Signing up">
        <li>First-come, first-served</li>
        <li>Once capacity fills, new signups go on an automatic waitlist, in order</li>
        <li>
          First time signing up: fill out a short profile (name, gender, positions) which is saved for future weeks.
          Update it any time from the homepage
        </li>
        <li>If you are waitlisted, the homepage shows where you are in line</li>
        <li>You can see who else is playing once you&apos;re signed up for that week</li>
        <li>Confirmed players get a reminder email on game-day morning, and can add the game to their calendar</li>
      </Section>

      <Section title="Bringing a guest">
        <li>Guests answer two extra questions: who invited them, and whether they&apos;re willing to share a spot with that member</li>
        <li>
          Sharing is a <strong>request, not automatic</strong>. If the guest is waitlisted, the member they named gets
          asked, and nothing is shared unless that member accepts. Naming someone never takes their spot or changes
          what they owe
        </li>
        <li>Sharing only happens if the named member also signs up that week and isn&apos;t already sharing with someone else</li>
        <li>Otherwise the guest just gets their own separate spot, in signup order like anyone else</li>
      </Section>

      <Section title="Cancelling">
        <li>Cancel any time, right up to game day, from the homepage</li>
        <li>
          <strong>More than 5 hours before game time:</strong> the next person (or pair) on the waitlist is
          automatically confirmed and emailed. Nothing is owed yet at this point, so there&apos;s no money to sort out
        </li>
        <li>
          <strong>Within 5 hours of game time:</strong> no automatic replacement. Cancelling this late{' '}
          <strong>doesn&apos;t clear what you owe</strong>, so send it anyway
        </li>
      </Section>

      <Section title="Requesting a sub">
        <li>
          If you are waitlisted, ask someone confirmed (or also waitlisted) to share their spot with you, from the
          homepage
        </li>
        <li>
          <strong>Please reach out to them outside the app first</strong>, as a courtesy
        </li>
        <li>Only one outstanding request at a time. Cancel it to try someone else instead</li>
        <li>If they accept, you both share their spot going forward (same as a member/guest pairing)</li>
      </Section>

      <Section title="Where we play">
        <li>The general area is set when the week opens, e.g. &quot;Mississauga&quot;</li>
        <li>The exact field is booked after signups close, once the headcount is known</li>
        <li>Once it&apos;s booked, the field and a map link show up on the homepage</li>
      </Section>

      <Section title="Cost">
        <li>A fixed price per spot, shown before you sign up. It doesn&apos;t change with headcount</li>
        <li>If you are sharing a spot with someone, you each pay half</li>
        <li>
          <strong>Payment opens 5 hours before game time</strong>, when the roster locks. Pay any time between then
          and the start of the game. Please be prompt with your e-transfer
        </li>
        <li>
          Nothing to pay before that. Cancel earlier and someone from the waitlist simply takes your spot, with no
          money involved either way
        </li>
        <li>
          Once the roster locks, cancelling doesn&apos;t remove what you owe. Please e-transfer the organizer for your
          locked spot
        </li>
        <li>Payment happens outside the app. The organizer tracks who&apos;s paid</li>
      </Section>

      <Section title="Teams">
        <li>Teams are drawn up after the roster locks, 5 hours before game time</li>
        <li>They show up on the homepage once the organizer posts them</li>
        <li>Teams are balanced on positions first, then size, then the mix of players</li>
        <li>Two people sharing a spot are always on the same team</li>
        {/* The rest of this section is the same list shown under the posted
            teams on game day. It was retyped here and had already drifted —
            "after teams go up" against "after teams are posted" — so the two
            answers to "what happens if someone cancels" no longer matched. */}
        {GAME_DAY_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </Section>

      <Section title="Something not working?">
        <li>Use the <strong>Report a bug or send feedback</strong> link at the bottom of any page</li>
        <li>It&apos;s logged for the organizer, along with your email and the page you were on, and they get a
          notification that it arrived</li>
        <li>Suggestions are just as welcome as bug reports</li>
      </Section>

      <Section title="A note on risk">
        <li>Softball carries a real risk of injury</li>
        <li>Every signup includes a plain acknowledgment of that: you&apos;re choosing to play</li>
        <li>
          See our{' '}
          <a href="/privacy" className="text-blue-600 hover:underline">
            privacy policy
          </a>{' '}
          for how your information is used
        </li>
      </Section>
    </main>
  );
}
