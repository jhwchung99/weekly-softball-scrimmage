import type { MetadataRoute } from 'next';

// `display: 'browser'` keeps the browser chrome when the icon is opened from a
// home screen. The cost is that Chrome on Android offers "Add to Home screen"
// (a shortcut) rather than "Install app", since it only treats standalone,
// fullscreen, and minimal-ui as installable. The benefit is that Google sign-in
// keeps working: standalone sends the OAuth redirect through a separate browser
// instance and the session can be lost coming back. Moving to 'standalone'
// means testing that round trip on a real phone first.
//
// Two icon sets: 'any' is the full-bleed art, 'maskable' is the same art
// inset so an Android launcher can crop it to a circle without cutting into
// the ball. Without a maskable entry Android shrinks the icon onto a white
// backdrop instead of filling the tile.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Weekly Softball Scrimmage',
    short_name: 'NHF Softball',
    description: 'Signup app for the weekly New Hope softball scrimmage.',
    start_url: '/',
    display: 'browser',
    background_color: '#033597',
    theme_color: '#033597',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
