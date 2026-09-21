import rootManifest from '../../manifest';

// The root manifest is linked from every page, and iOS reads its `start_url`
// rather than the page the shortcut was added from. That sent an /admin
// shortcut to the player homepage. Next's manifest file convention is
// root-only, so the admin route serves its own from a route handler and points
// at it via `metadata.manifest` in admin/layout.tsx.
//
// Everything but the identity and the entry point is inherited, so the two
// cannot drift on theme colour or display mode. The icons are the admin art,
// and none is offered as `maskable`: Android crops a maskable icon to a circle
// and the banner does not survive it.
// Constant, so prerender it rather than rendering per request.
export const dynamic = 'force-static';

export function GET() {
  return Response.json(
    {
      ...rootManifest(),
      name: 'Weekly Softball Scrimmage Admin',
      short_name: 'NHF Admin',
      start_url: '/admin',
      icons: [
        { src: '/admin-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/admin-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
