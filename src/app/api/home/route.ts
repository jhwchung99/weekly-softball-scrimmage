import { NextResponse } from 'next/server';
import { getSessionEmail } from '../../../lib/auth';
import { listSignupsForSessions } from '../../../sheets/signups';
import { getPlayer } from '../../../sheets/players';
import { upcomingSessions } from '../../../lib/currentWeek';
import { buildMyStatus } from '../../../lib/myStatus';
import { rosterView, teamView, sessionView, mySignupView, playerView } from '../../../lib/views';
import { teamCountFor } from '../../../lib/teamFlow';
import { WAIVER_TEXT } from '../../../lib/waiver';
import { handleApiError } from '../../../lib/apiErrors';
import { phaseOf } from '../../../lib/sessionPhase';

/**
 * Everything the homepage renders, in one request.
 *
 * This exists for a specific, measured reason. The page used to make four
 * calls (`/sessions/current`, `/sessions/[id]/signup`, `/players/me`,
 * `/roster`) costing **5 Sheets reads**, because Sessions and Signups were
 * each read twice. All Sheets traffic is attributed to one service account, so
 * the binding quota is 60 reads/minute for the entire app — and registration
 * opening at a fixed weekly time means everyone arrives at once. Reading each
 * tab exactly once takes a page load to **3 reads**, raising the ceiling from
 * roughly 6 to 10 simultaneous signups.
 *
 * **Still 3 reads now that it returns every upcoming session, not one.** That
 * is the property most easily lost here: `listSignupsForSessions` groups one
 * whole-tab read by session id rather than reading the tab once per session,
 * which would make a page load cost 1 + 2N. A future edit that reaches for
 * `listSignupsForSession` in a loop undoes the whole optimization.
 *
 * Deliberately a view-model endpoint shaped for one screen rather than a
 * resource: the granular routes still exist and still work, and both paths
 * compute their results from the same shared builders, so there is no second
 * copy of any rule to drift.
 *
 * Public: an unauthenticated caller gets the sessions and nothing else, which
 * is what the logged-out homepage shows (1 read, since it never touches
 * Signups or Players).
 */
export async function GET() {
  try {
    const email = await getSessionEmail();

    // Read 1 — Sessions. Cached, and shared with /api/sessions/current: both
    // are reachable without signing in, so between them they are the cheapest
    // way to exhaust the app's 60-reads-a-minute quota. See lib/currentWeek.
    const sessions = await upcomingSessions();

    if (!email || sessions.length === 0) {
      return NextResponse.json({
        sessions: sessions.map((session) => ({
          session: sessionView(session),
          phase: phaseOf(session),
          signup: null,
          incomingSubRequests: [],
          costOwed: null,
          waitlistPosition: null,
          roster: null,
          teams: null,
        })),
        signedIn: Boolean(email),
        player: null,
        waiverText: WAIVER_TEXT,
        // Deliberately omitted when signed out — see the note below.
        paymentInstructions: '',
      });
    }

    // Reads 2 and 3 — Signups and Players, once each, in parallel. The Signups
    // read covers every session at once; see the note above.
    const [signupsBySession, player] = await Promise.all([
      listSignupsForSessions(sessions.map((s) => s.sessionId)),
      getPlayer(email),
    ]);

    return NextResponse.json({
      /**
       * One entry per upcoming session, soonest first.
       *
       * Everything in an entry is already per-session in the data model — a
       * player can be confirmed for Friday, waitlisted for Sunday, and hold a
       * pending sub-request on one of them. This shape is what lets the page
       * say all three at once instead of making them fight for one slot.
       */
      sessions: sessions.map((session) => {
        const allSignups = signupsBySession.get(session.sessionId) ?? [];
        const { signup, incomingSubRequests, costOwed, waitlistPosition } = buildMyStatus(session, allSignups, email);

        return {
          session: sessionView(session),
          /**
           * Where this session stands, decided by the server's clock.
           *
           * The homepage used to work this out itself, comparing the
           * milestones to `new Date()` in the browser — so whether the roster
           * was locked, and whether payment had opened, depended on the
           * viewer's own device being right. Two people looking at the same
           * session could be told different things. See lib/sessionPhase.ts.
           */
          phase: phaseOf(session),
          signup: signup ? mySignupView(signup) : null,
          incomingSubRequests,
          costOwed,
          waitlistPosition,
          roster: rosterView(allSignups, email),
          /**
           * Only once the organizer posts them. A 'draft' is theirs to edit, so
           * players see nothing until they publish. Gated on being signed up for
           * that session, the same boundary rosterView draws for names: someone
           * who isn't playing has no business reading the lineup.
           */
          teams: session.teamsStatus === 'posted' && signup ? teamView(allSignups, teamCountFor(session)) : null,
        };
      }),
      signedIn: true,
      player: player ? playerView(player) : null,
      waiverText: WAIVER_TEXT,
      /**
       * Sent from the server, to signed-in callers only, rather than exposed
       * as a NEXT_PUBLIC_ build-time constant. A NEXT_PUBLIC_ value is inlined
       * into the JavaScript bundle, which is served to everyone — signed-out
       * visitors and crawlers included — so the organizer's e-Transfer address
       * would be publicly scrapable rather than merely visible to players.
       * Nothing here is a credential, but there's no reason to publish a
       * payment address to the open internet.
       */
      paymentInstructions: process.env.PAYMENT_INSTRUCTIONS ?? '',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
