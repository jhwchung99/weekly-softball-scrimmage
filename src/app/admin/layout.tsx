import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// `metadata` can only be exported from a Server Component, and admin/page.tsx
// is 'use client'. This layout exists to carry it, so the admin route gets its
// own tab title and its own home-screen label instead of inheriting the
// player-facing ones.
export const metadata: Metadata = {
  title: 'Weekly Softball Scrimmage Admin',
  // Overrides the root manifest, whose start_url would send an admin
  // home-screen shortcut to the player homepage.
  manifest: '/admin/manifest.webmanifest',
  appleWebApp: {
    capable: false,
    title: 'NHF Admin',
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
