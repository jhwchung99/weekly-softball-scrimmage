import { ApiRequest, asJson } from './apiRequest';

/**
 * What the homepage does when a player presses something.
 *
 * The page had four handlers of the same shape — mark busy, clear the error,
 * send a request, throw the server's message or a fallback, reload, report
 * anything that went wrong, stop being busy. Four copies of a request policy
 * means four places for one of them to drift, and none of it was reachable by
 * a test, because it was all closed over React state inside the component.
 *
 * The actions are data here, and the policy around them is one function in the
 * page. Nothing in this file touches React, the network or the DOM.
 *
 * The admin console got the same treatment first (lib/adminConsole.ts); this
 * is the player-facing half of the same shape.
 */

/** Something a player can do to their own signup. */
export type PlayerAction =
  | { kind: 'cancel'; signupId: string }
  | { kind: 'requestSub'; signupId: string; targetEmail: string }
  | { kind: 'cancelSubRequest'; signupId: string }
  | { kind: 'respondToSubRequest'; fromSignupId: string; accept: boolean };

/**
 * The request one action makes.
 *
 * Ids are encoded, because a signup id ends up in the path. They are UUIDs
 * today, so nothing needs escaping in practice — which is exactly why it would
 * go unnoticed if it stopped being done.
 */
export function requestFor(action: PlayerAction): ApiRequest {
  switch (action.kind) {
    case 'cancel':
      return {
        url: `/api/signups/${encodeURIComponent(action.signupId)}/cancel`,
        init: { method: 'POST' },
        fallbackError: 'Cancel failed',
      };
    case 'requestSub':
      return {
        url: `/api/signups/${encodeURIComponent(action.signupId)}/sub-request`,
        init: asJson({ targetEmail: action.targetEmail }),
        fallbackError: 'Request failed',
      };
    case 'cancelSubRequest':
      return {
        url: `/api/signups/${encodeURIComponent(action.signupId)}/sub-request`,
        init: { method: 'DELETE' },
        fallbackError: 'Cancel failed',
      };
    case 'respondToSubRequest':
      return {
        url: `/api/signups/${encodeURIComponent(action.fromSignupId)}/sub-request/respond`,
        init: asJson({ accept: action.accept }),
        fallbackError: 'Response failed',
      };
  }
}

