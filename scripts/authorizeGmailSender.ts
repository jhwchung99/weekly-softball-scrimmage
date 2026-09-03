// One-time script: grants this app permission to send email as a specific
// Gmail account (the league's dedicated sender), and prints the resulting
// refresh token to save into .env.local. Re-run any time that token needs
// to be rotated or re-issued (e.g. if access was revoked).
//
// Requires the manual Cloud Console steps in the Step 8 setup notes to be
// done first: Gmail API enabled, gmail.send scope added to the OAuth
// consent screen, the sender account added as a Test User, and
// http://localhost:3001/oauth2callback registered as a redirect URI on
// the existing Web OAuth Client.

import http from 'node:http';
import { OAuth2Client } from 'google-auth-library';

const PORT = 3001;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SENDER_EMAIL = 'newhopesoftballscrimmage@gmail.com';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — run this via the npm script');
  console.error('(npm run authorize-gmail-sender), which loads .env.local automatically.');
  process.exit(1);
}

const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token even if this account authorized before
  scope: ['https://www.googleapis.com/auth/gmail.send'],
});

console.log(`1. Make sure you're logged into ${SENDER_EMAIL} in your browser`);
console.log('   (use an incognito window, or "Add account", if you are usually logged in elsewhere).\n');
console.log('2. Open this URL and approve access:\n');
console.log(authUrl);
console.log('\nWaiting for the redirect on http://localhost:3001 ...\n');

const server = http.createServer((req, res) => {
  void (async () => {
    if (!req.url) return;
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404);
      res.end();
      return;
    }

    const error = url.searchParams.get('error');
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Authorization failed: ${error}`);
      console.error(`Authorization failed: ${error}`);
      server.close();
      process.exit(1);
    }

    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('No code in callback.');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Success! You can close this tab and return to the terminal.');
    server.close();

    const { tokens } = await oAuth2Client.getToken(code);
    if (!tokens.refresh_token) {
      console.error(
        '\nNo refresh_token returned. This usually means this account already granted access ' +
          'once before, and Google only issues a fresh refresh_token on first consent (or with ' +
          `prompt=consent, which this script already sets). Go to ` +
          `https://myaccount.google.com/permissions while logged in as ${SENDER_EMAIL}, remove ` +
          'access for this app, and re-run this script.'
      );
      process.exit(1);
    }

    console.log('\nSuccess. Add these to .env.local:\n');
    console.log(`GMAIL_SENDER_EMAIL=${SENDER_EMAIL}`);
    console.log(`GMAIL_SENDER_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n(Treat that refresh token as a secret — it grants send access to that Gmail account indefinitely, same as a password.)');
    process.exit(0);
  })();
});

server.listen(PORT);
