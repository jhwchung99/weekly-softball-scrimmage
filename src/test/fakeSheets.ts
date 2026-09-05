import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Session, Signup, Player, SessionStatus } from '../sheets/schema';
import { normalizeEmail } from '../lib/email';

/**
 * A minimal in-memory stand-in for the Sheets-backed repository modules
 * (sessions.ts, signups.ts, players.ts), used via vi.mock() rather than
 * dependency injection — zero production code changes needed to make
 * signupFlow.ts/subRequestFlow.ts/adminFlow.ts testable. Matches each
 * real repository function's observable behavior (including the
 * specific duplicate-signup rejection and "no such X" error messages
 * business-logic code relies on catching), not the Sheets API itself.
 * See planner/2026-09-04-profile-edit-rate-limiting-testing-plan.md,
 * Step 3.
 */
export function createFakeStore() {
  return {
    sessions: new Map<string, Session>(),
    signups: new Map<string, Signup>(),
    players: new Map<string, Player>(),
  };
}

export type FakeStore = ReturnType<typeof createFakeStore>;

export function resetFakeStore(store: FakeStore): void {
  store.sessions.clear();
  store.signups.clear();
  store.players.clear();
}

export function fakeSessionsModule(store: FakeStore) {
  return {
    listSessions: vi.fn(async () => [...store.sessions.values()]),
    getSession: vi.fn(async (sessionId: string) => store.sessions.get(sessionId) ?? null),
    getSessionByAnyId: vi.fn(async (sessionIds: string[]) => {
      for (const id of sessionIds) {
        const match = store.sessions.get(id);
        if (match) return match;
      }
      return null;
    }),
    createSession: vi.fn(async (session: Session) => {
      if (store.sessions.has(session.sessionId)) {
        throw new Error(`A session with id "${session.sessionId}" already exists.`);
      }
      store.sessions.set(session.sessionId, session);
      return session;
    }),
    updateSession: vi.fn(async (sessionId: string, updates: Partial<Session>) => {
      const existing = store.sessions.get(sessionId);
      if (!existing) throw new Error(`No session with id "${sessionId}".`);
      const updated = { ...existing, ...updates };
      // Mirrors the real repository: this is a rename of the same row, not
      // a separate insert, so the old key stops resolving once the id
      // itself changes (see adminRescheduleSession).
      if (updated.sessionId !== sessionId) {
        store.sessions.delete(sessionId);
      }
      store.sessions.set(updated.sessionId, updated);
      return updated;
    }),
    updateSessionStatus: vi.fn(async (sessionId: string, status: SessionStatus) => {
      const existing = store.sessions.get(sessionId);
      if (!existing) throw new Error(`No session with id "${sessionId}".`);
      store.sessions.set(sessionId, { ...existing, status });
    }),
  };
}

export function fakeSignupsModule(store: FakeStore) {
  function listForSession(sessionId: string): Signup[] {
    return [...store.signups.values()].filter((s) => s.sessionId === sessionId);
  }

  return {
    listSignupsForSession: vi.fn(async (sessionId: string) => listForSession(sessionId)),
    getSignup: vi.fn(async (signupId: string) => store.signups.get(signupId) ?? null),
    getSignupWithSessionSignups: vi.fn(async (signupId: string) => {
      const signup = store.signups.get(signupId) ?? null;
      if (!signup) return { signup: null, sessionSignups: [] };
      return { signup, sessionSignups: listForSession(signup.sessionId) };
    }),
    getSignupsByIds: vi.fn(async (ids: string[]) => {
      const idSet = new Set(ids);
      return [...store.signups.values()].filter((s) => idSet.has(s.signupId));
    }),
    findActiveSignup: vi.fn(async (sessionId: string, email: string) => {
      const target = normalizeEmail(email);
      return listForSession(sessionId).find((s) => normalizeEmail(s.email) === target && s.status !== 'cancelled') ?? null;
    }),
    findPendingGuestInvite: vi.fn(async (sessionId: string, memberFullName: string) => {
      const candidates = listForSession(sessionId)
        .filter(
          (s) =>
            s.memberStatus === 'guest' &&
            s.willingToShare &&
            !s.pairId &&
            s.status !== 'cancelled' &&
            s.invitedByName.trim().toLowerCase() === memberFullName.trim().toLowerCase()
        )
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return candidates[0] ?? null;
    }),
    findMemberSignupByName: vi.fn(async (sessionId: string, memberFullName: string) => {
      return (
        listForSession(sessionId).find(
          (s) =>
            s.memberStatus === 'member' &&
            s.status !== 'cancelled' &&
            s.fullName.trim().toLowerCase() === memberFullName.trim().toLowerCase()
        ) ?? null
      );
    }),
    createSignup: vi.fn(async (signup: Omit<Signup, 'signupId'>) => {
      const target = normalizeEmail(signup.email);
      const existing = listForSession(signup.sessionId).find(
        (s) => normalizeEmail(s.email) === target && s.status !== 'cancelled'
      );
      if (existing) {
        throw new Error(`"${signup.email}" is already signed up for session "${signup.sessionId}".`);
      }
      // Normalized on write, same as the real repository.
      const full: Signup = {
        ...signup,
        email: target,
        subRequestTargetEmail: signup.subRequestTargetEmail ? normalizeEmail(signup.subRequestTargetEmail) : '',
        signupId: randomUUID(),
      };
      store.signups.set(full.signupId, full);
      return full;
    }),
    updateSignup: vi.fn(async (signupId: string, updates: Partial<Signup>) => {
      const existing = store.signups.get(signupId);
      if (!existing) throw new Error(`No signup with id "${signupId}".`);
      const updated = { ...existing, ...updates };
      store.signups.set(signupId, updated);
      return updated;
    }),
    updateSignupStatus: vi.fn(async (signupId: string, status: Signup['status']) => {
      const existing = store.signups.get(signupId);
      if (!existing) throw new Error(`No signup with id "${signupId}".`);
      store.signups.set(signupId, { ...existing, status });
    }),
    batchUpdateSignups: vi.fn(async (updates: { signupId: string; updates: Partial<Signup> }[]) => {
      const results: Signup[] = [];
      for (const { signupId, updates: partial } of updates) {
        const existing = store.signups.get(signupId);
        if (!existing) throw new Error(`No signup with id "${signupId}".`);
        const updated = { ...existing, ...partial };
        store.signups.set(signupId, updated);
        results.push(updated);
      }
      return results;
    }),
    deleteSignup: vi.fn(async (signupId: string) => {
      if (!store.signups.has(signupId)) throw new Error(`No signup with id "${signupId}".`);
      store.signups.delete(signupId);
    }),
    generateSignupId: vi.fn(() => randomUUID()),
  };
}

export function fakePlayersModule(store: FakeStore) {
  return {
    // Mirrors the real repository's case-insensitive matching (lib/email.ts):
    // the Map key is incidental, the row's own email field is the identity.
    getPlayer: vi.fn(async (email: string) => {
      const target = normalizeEmail(email);
      return [...store.players.values()].find((p) => normalizeEmail(p.email) === target) ?? null;
    }),
    upsertPlayer: vi.fn(async (player: Player) => {
      const normalized: Player = { ...player, email: normalizeEmail(player.email) };
      for (const [key, existing] of store.players) {
        if (normalizeEmail(existing.email) === normalized.email) {
          store.players.set(key, normalized);
          return;
        }
      }
      store.players.set(normalized.email, normalized);
    }),
  };
}

/** Helpers for building valid fixtures with sensible defaults, so each
 * test only has to specify the fields it actually cares about. */
export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: '2099-01-01',
    gameDate: '2099-01-01',
    gameTime: '18:00',
    registrationOpensAt: '',
    registrationClosesAt: '',
    capacity: 1,
    status: 'open',
    cost: 0,
    ...overrides,
  };
}

export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    email: 'player@dummy.test',
    fullName: 'Test Player',
    gender: 'Other',
    savedPositions: '',
    ...overrides,
  };
}
