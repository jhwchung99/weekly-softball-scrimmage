import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Weekly Softball Scrimmage',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-slate-800">
      <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Draft — not legal advice. Written to satisfy Google&apos;s OAuth verification requirements and to honestly
        describe what this app does. Please review before treating it as final.
      </p>

      <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500">
        New Hope Fellowship Weekly Softball Scrimmage signup web app
      </p>

      <section className="mt-6 space-y-2">
        <p className="text-sm">
          This web application is a small, volunteer-run signup tool for New Hope Fellowship&apos;s weekly pickup
          softball game. It exists to manage capacity and waitlists for weekly events.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">Information we collect</h2>
        <p className="text-sm">When you sign in with Google, we receive:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Your Google account email address, used as your identity in the app</li>
          <li>Your name, if made available by Google</li>
        </ul>
        <p className="mt-2 text-sm">When you sign up to play, you (or an admin, on your behalf) provide:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Your full name, gender, and age</li>
          <li>The positions you&apos;re comfortable playing</li>
          <li>Whether you&apos;re a New Hope member or a guest, and if a guest, which member invited you</li>
          <li>Your confirmation that you accept the participation waiver, including the exact wording you agreed to and when</li>
        </ul>
        <p className="mt-2 text-sm">
          We also keep a record of your signup history: which weeks you signed up, whether you were confirmed or
          waitlisted, and timestamps of those events.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">How we use it</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>To identify you and prevent duplicate signups for the same week</li>
          <li>To track capacity: confirming players up to that week&apos;s limit and waitlisting the rest, in signup order</li>
          <li>To automatically promote the next eligible person when a confirmed player cancels with enough notice</li>
          <li>To email you (via the scrimmage&apos;s Gmail account) if you&apos;re promoted off the waitlist</li>
          <li>To alert the organizer, via a push notification (not email), when a cancellation happens too close to game time for automatic promotion</li>
          <li>To let admins view and manage that week&apos;s roster</li>
        </ul>
        <p className="mt-2 text-sm">
          We do not use your information for advertising, and we do not build any kind of profile about you beyond
          what&apos;s needed to run weekly signups.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">Where it&apos;s stored, and who can see it</h2>
        <p className="text-sm">
          Signup data lives in a Google Sheet accessible only to the organizer and designated admins —
          not the general public, and not other players beyond what they can see about their own status in the app.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">Third-party services we use</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Google</strong> — for signing in, storing signup data (Google Sheets), and sending promotion
            emails (Gmail). This app&apos;s use of information received via Google APIs adheres to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="text-blue-600 hover:underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </li>
          <li>
            <strong>ntfy.sh</strong> — only receives a cancelled player&apos;s name and the position they played, for
            the organizer&apos;s late-cancellation alert. It never receives your email address, login credentials, or
            any other personal information.
          </li>
        </ul>
        <p className="mt-2 text-sm">We don&apos;t sell your information or share it with anyone else.</p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">How long we keep it</h2>
        <p className="text-sm">
          Signup records are kept as an ongoing operational history (e.g. for attendance tracking).
          You can ask to have your data corrected or deleted at any time — see Contact below.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">Your choices</h2>
        <p className="text-sm">
          You can cancel a signup at any time from within the app. To review, correct, or delete your data, or to
          ask any question about this policy, contact the organizer using the email below.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">Children&apos;s privacy</h2>
        <p className="text-sm">
          This app is intended for adult recreational play and is not directed at children.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">Changes to this policy</h2>
        <p className="text-sm">
          If this policy changes, the updated version will be posted at this same page.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">Contact</h2>
        <p className="text-sm">Questions about this policy or your data: joshuachung1230@gmail.com</p>
      </section>
    </main>
  );
}
