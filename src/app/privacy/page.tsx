import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Weekly Softball Scrimmage',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-slate-800">
      <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500">
        New Hope Fellowship Weekly Softball Scrimmage signup web app
      </p>
      <p className="mt-1 text-sm text-slate-500">Last updated: September 5, 2026</p>

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
          <li>Your full name and gender</li>
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
        <p className="text-sm">
          Within the app, other players can see the roster of who is playing in a given week — first and last name
          and the positions someone plays — and only if they are themselves signed up for that week. Your email
          address is never shown to other players.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">How we protect your information</h2>
        <p className="text-sm">
          We take reasonable and appropriate steps to protect your information against unauthorized access, use,
          alteration, loss, or disclosure. Specifically:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Encryption in transit.</strong> The app is served exclusively over HTTPS, and all communication
            with Google&apos;s APIs uses encrypted connections.
          </li>
          <li>
            <strong>Encryption at rest.</strong> Your information is stored in Google Sheets and is encrypted at rest
            by Google.
          </li>
          <li>
            <strong>We never see your password.</strong> Sign-in is handled entirely by Google. This app never
            receives, stores, or has access to your Google account password.
          </li>
          <li>
            <strong>We request the minimum access needed.</strong> Signing in shares only your name and email
            address. The app never requests access to your Gmail, Drive, Calendar, Contacts, or any other data in
            your Google account.
          </li>
          <li>
            <strong>Outgoing email only, from a separate account.</strong> Notification emails are sent from a
            dedicated account belonging to the scrimmage organizer, using send-only permission on that account. The
            app cannot read anyone&apos;s email — not yours, and not the sender account&apos;s.
          </li>
          <li>
            <strong>Restricted access to stored data.</strong> The spreadsheet is private. It is reachable by the
            organizer, a small explicit list of designated admins, and a dedicated service account whose access is
            limited to that single spreadsheet.
          </li>
          <li>
            <strong>Access controls within the app.</strong> You can only view and change your own signup.
            Administrative functions are limited to an explicit allowlist of organizer accounts.
          </li>
          <li>
            <strong>Credentials are kept out of the codebase.</strong> API keys and access tokens are stored as
            encrypted environment variables in our hosting provider, never in source code.
          </li>
          <li>
            <strong>We collect as little as possible.</strong> We ask only for what is needed to run weekly signups,
            and we remove fields we no longer need — for example, we previously collected each player&apos;s age and
            have since stopped, deleting it from our records.
          </li>
        </ul>
        <p className="text-sm">
          No service can promise perfect security, but this is a small, single-purpose app that deliberately holds
          very little: a name, an email address, and who is playing softball this week.
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="font-semibold text-slate-900">Artificial intelligence and machine learning</h2>
        <p className="text-sm">
          We do not use your information, including any data obtained through Google APIs, to develop, improve, or
          train generalized artificial intelligence or machine learning models. We do not sell your information, and
          we do not share it with third parties for their own purposes.
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
