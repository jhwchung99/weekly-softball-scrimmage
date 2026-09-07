import type { Metadata } from 'next';
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
