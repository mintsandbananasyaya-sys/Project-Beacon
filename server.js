require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  GUILD_ID,
  SESSION_SECRET,
  DISCORD_INVITE_URL,
  PORT
} = process.env;

const REQUIRED_VARS = { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, GUILD_ID, SESSION_SECRET };
const missing = Object.entries(REQUIRED_VARS).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`[Beacon] Missing required .env values: ${missing.join(', ')}`);
  console.error('[Beacon] Copy .env.example to .env and fill these in before starting the server.');
  process.exit(1);
}

const app = express();
app.use(cookieParser(SESSION_SECRET));

const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'beacon_session';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

// ---------- session helpers ----------

function getSession(req) {
  const raw = req.signedCookies[SESSION_COOKIE];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setSession(res, user) {
  const payload = JSON.stringify({ id: user.id, username: user.username, avatar: user.avatar });
  res.cookie(SESSION_COOKIE, payload, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === 'production'
  });
}

// ---------- page rendering ----------
// Pages contain a "<!--BEACON_AUTH_STATE-->" comment. We replace it with an
// inline script that tells the client-side JS whether this visitor is signed in.

function renderPage(filename, session) {
  const filePath = path.join(PUBLIC_DIR, filename);
  let html = fs.readFileSync(filePath, 'utf8');
  const authed = !!session;
  const stateScript =
    `<script>` +
    `window.BEACON_AUTHED = ${authed};` +
    `window.BEACON_USER = ${authed ? JSON.stringify({ username: session.username }) : 'null'};` +
    `window.BEACON_INVITE = ${JSON.stringify(DISCORD_INVITE_URL || '')};` +
    `</script>`;
  html = html.replace('<!--BEACON_AUTH_STATE-->', stateScript);
  return html;
}

// ---------- routes ----------

// Home always renders — if not signed in, index.html itself shows the
// post-animation "sign in" gate rather than the real page content.
app.get('/', (req, res) => {
  res.send(renderPage('index.html', getSession(req)));
});

// Safety net: if anything ever links or is typed as /index.html directly,
// send it through the real "/" route instead of falling through to
// express.static below — otherwise the auth-state script never gets
// injected and the page looks logged-out even with a valid session cookie.
app.get('/index.html', (req, res) => {
  res.redirect(302, '/');
});

// Other pages require a session; bounce unauthenticated visitors back to '/'
// so they see the intro + gate flow instead of a bare page.
const PROTECTED_PAGES = ['applications.html', 'credits.html'];
PROTECTED_PAGES.forEach((page) => {
  app.get(`/${page}`, (req, res) => {
    const session = getSession(req);
    if (!session) return res.redirect('/');
    res.send(renderPage(page, session));
  });
});

app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=missing_code');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[Beacon] Token exchange failed:', tokenData);
      return res.redirect('/?error=auth_failed');
    }

    const [userRes, guildsRes] = await Promise.all([
      fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      }),
      fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      })
    ]);
    const user = await userRes.json();
    const guilds = await guildsRes.json();

    const isMember = Array.isArray(guilds) && guilds.some((g) => g.id === GUILD_ID);
    if (!isMember) {
      return res.redirect('/?error=not_in_server');
    }

    setSession(res, user);
    res.redirect('/');
  } catch (err) {
    console.error('[Beacon] OAuth error:', err);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.redirect('/');
});

// Anything else (none right now, but future assets) is served statically.
app.use(express.static(PUBLIC_DIR));

const port = PORT || 3000;
app.listen(port, () => {
  console.log(`[Beacon] Web server running on http://localhost:${port}`);
});
