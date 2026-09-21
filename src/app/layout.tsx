import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import { FeedbackButton } from '../components/FeedbackButton';
import './globals.css';

export const metadata: Metadata = {
  title: 'Weekly Softball Scrimmage',
  description: 'Signup app for the weekly New Hope softball scrimmage.',
  // Set GOOGLE_SITE_VERIFICATION to the code Search Console gives you when
  // verifying this URL via its "HTML tag" method — renders as
  // <meta name="google-site-verification" content="...">, no other code
  // change needed. Undefined renders nothing.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
  // The label iOS puts under the home-screen icon, which otherwise falls back
  // to the full title and gets truncated. `capable: false` keeps Safari's
  // chrome: see the note in manifest.ts on standalone and Google sign-in.
  appleWebApp: {
    capable: false,
    title: 'NHF Softball',
  },
};

// Tints the browser UI around the page on Android Chrome. Matches the icon
// background so the chrome and the logo read as one thing.
export const viewport: Viewport = {
  themeColor: '#033597',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Inside Providers because the form reads the session to tell a
            signed-in reporter from one who needs to sign in first. */}
        <Providers>
          {children}
          <FeedbackButton />
        </Providers>
      </body>
    </html>
  );
}
