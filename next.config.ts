import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // Silences a Turbopack warning caused by an unrelated package-lock.json
  // sitting in the home directory, outside this repo.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },

  /**
   * Baseline security headers. The one that actually matters here is
   * frame-ancestors/X-Frame-Options: the admin dashboard has single-click
   * destructive actions (cancel the session, hard-delete a signup), so
   * without it an attacker could frame /admin and trick an organizer into
   * clicking one. See planner/2026-09-05-code-security-review.md, S2.
   *
   * Deliberately NOT a full CSP: Next injects inline bootstrap scripts, so a
   * script-src policy needs per-request nonces via middleware. frame-ancestors
   * is the high-value subset that needs none of that machinery.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' }, // for older browsers that ignore frame-ancestors
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
