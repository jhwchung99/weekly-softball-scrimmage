import type { Metadata } from 'next';
import { Card } from '../../components/Card';

export const metadata: Metadata = {
  title: 'Guidelines — Weekly Softball Scrimmage',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mt-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm text-slate-700">{children}</div>
    </Card>
  );
}

export default function GuidelinesPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Guidelines</h1>
      <p className="mt-1 text-sm text-slate-500">Everything about how weekly signups actually work.</p>

      <Section title="Signing up">
        <p>
          Spots are first-come, first-served. Once a week fills up, anyone who signs up after that goes on an
          automatic waitlist, in the order they signed up.
        </p>
        <p>
          The first time you sign up, you&apos;ll fill out a short profile (name, gender, age, positions) — saved for
          every future week. You can update it any time from the homepage.
        </p>
      </Section>

      <Section title="Bringing a guest">
        <p>
          Guests answer two extra questions: which member invited them, and whether they&apos;re willing to share a
          roster slot with that member instead of taking a separate one. Sharing only actually happens if the named
          member has also signed up (or signs up later that same week) and isn&apos;t already sharing with someone
          else — otherwise the guest just gets their own slot as normal.
        </p>
      </Section>

      <Section title="Cancelling">
        <p>You can cancel your spot at any time, right up to game day, from the homepage.</p>
        <p>
          If your cancellation frees up a confirmed spot <strong>more than 2 hours before game time</strong>, the
          next person (or pair) on the waitlist is automatically confirmed and emailed. Within 2 hours of game time,
          there&apos;s no automatic replacement — the organizer gets a push alert instead so they can personally text
          someone if they want to fill it.
        </p>
      </Section>

      <Section title="Requesting a sub">
        <p>
          If you&apos;re on the waitlist and know someone confirmed (or also waitlisted) who might share their spot
          with you, you can send them a request from the homepage. <strong>Please reach out to them outside the app
          first</strong>, out of politeness, before sending one.
        </p>
        <p>
          You can only have one outstanding request at a time — cancel it if you want to try someone else instead of
          waiting it out. If they accept, you both share their spot going forward, the same as a member/guest sharing
          arrangement.
        </p>
      </Section>

      <Section title="Cost">
        <p>
          Once the organizer sets a price for the week (covering the field/permit cost), it&apos;s split evenly
          across every confirmed spot. If you&apos;re sharing a spot with someone, you each pay half of that spot&apos;s
          share. Payment happens outside the app — the organizer tracks who&apos;s paid.
        </p>
      </Section>

      <Section title="A note on risk">
        <p>
          Softball carries a real risk of injury. Every signup includes a plain acknowledgment of that — you&apos;re
          choosing to play. See our{' '}
          <a href="/privacy" className="text-blue-600 hover:underline">
            privacy policy
          </a>{' '}
          for how your information is used.
        </p>
      </Section>
    </main>
  );
}
