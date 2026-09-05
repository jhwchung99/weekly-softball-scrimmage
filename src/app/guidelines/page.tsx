import type { Metadata } from 'next';
import { Card } from '../../components/Card';

export const metadata: Metadata = {
  title: 'Guidelines — Weekly Softball Scrimmage',
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
      <p className="mt-1 text-sm text-slate-500">Everything about how weekly signups actually work.</p>

      <Section title="When to sign up">
        <li><strong>Signups open Monday at 9:00am ET</strong></li>
        <li><strong>Signups close Tuesday at 12:00am ET</strong> (midnight, i.e. the end of Monday)</li>
        <li>
          That window is short on purpose — it lets the organizer book a field sized to the actual headcount for the
          rest of the week
        </li>
        <li>Miss it and you&apos;re out for that week, so it&apos;s worth signing up Monday</li>
        <li>Games are Friday, Saturday, or Sunday — check the homepage for which one this week is</li>
      </Section>

      <Section title="Signing up">
        <li>First-come, first-served</li>
        <li>Once capacity fills, new signups go on an automatic waitlist, in order</li>
        <li>First time signing up: fill out a short profile (name, gender, positions)</li>
        <li>Profile is saved for future weeks — update it any time from the homepage</li>
        <li>Waitlisted? The homepage shows where you are in line</li>
        <li>You can see who else is playing once you&apos;re signed up for that week</li>
        <li>Confirmed players get a reminder email on game-day morning, and can add the game to their calendar</li>
      </Section>

      <Section title="Bringing a guest">
        <li>Guests answer two extra questions: who invited them, and whether they&apos;re willing to share a roster slot with that member</li>
        <li>Sharing only happens if the named member also signs up that week and isn&apos;t already sharing with someone else</li>
        <li>Otherwise the guest just gets their own separate slot</li>
      </Section>

      <Section title="Cancelling">
        <li>Cancel any time, right up to game day, from the homepage</li>
        <li>
          <strong>More than 5 hours before game time:</strong> the next person (or pair) on the waitlist is
          automatically confirmed and emailed
        </li>
        <li>
          <strong>Within 5 hours of game time:</strong> no automatic replacement — the organizer gets a push alert to
          fill it manually
        </li>
      </Section>

      <Section title="Requesting a sub">
        <li>Waitlisted? Ask someone confirmed (or also waitlisted) to share their spot with you, from the homepage</li>
        <li>
          <strong>Please reach out to them outside the app first</strong>, as a courtesy
        </li>
        <li>Only one outstanding request at a time — cancel it to try someone else instead</li>
        <li>If they accept, you both share their spot going forward (same as a member/guest pairing)</li>
      </Section>

      <Section title="Where we play">
        <li>The general area is set when the week opens — e.g. &quot;Mississauga&quot;</li>
        <li>The exact field is booked after signups close, once the headcount is known</li>
        <li>Once it&apos;s booked, the field and a map link show up on the homepage</li>
      </Section>

      <Section title="Cost">
        <li>A fixed price per spot, shown before you sign up — it doesn&apos;t change with headcount</li>
        <li>Sharing a spot with someone? You each pay half</li>
        <li>
          <strong>Payment opens 5 hours before game time</strong>, when the roster locks — pay any time between then
          and the start of the game
        </li>
        <li>
          Nothing to pay before that. Cancel earlier and someone from the waitlist simply takes your spot, with no
          money involved either way
        </li>
        <li>Once the roster locks, cancelling doesn&apos;t remove what you owe — nobody replaces you, and the field is booked regardless</li>
        <li>Payment happens outside the app — the organizer tracks who&apos;s paid</li>
      </Section>

      <Section title="A note on risk">
        <li>Softball carries a real risk of injury</li>
        <li>Every signup includes a plain acknowledgment of that — you&apos;re choosing to play</li>
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
