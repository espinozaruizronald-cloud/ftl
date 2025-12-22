const express = require('express');
const mysql = require('mysql2/promise');
const app = express();
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Parse HTML form data
app.use(express.urlencoded({ extended: true }));

app.set('trust proxy', 1);

app.use(
  session({
    name: 'ftl_sid',
    secret: process.env.SESSION_SECRET || 'dev-unsafe-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 días
    },
  })
);


// Serve static files from "public" (for images, css, etc.)
app.use(express.static('public'));

// ---------- MYSQL CONNECTION ----------
// Uses environment variables for cloud, defaults for local.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '@m3r1c4t3L!',
  database: process.env.DB_NAME || 'tennis_ladder',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
});


// ---------- TEMPORAL ----------
console.log('ENV DB_HOST:', process.env.DB_HOST);
console.log('ENV DB_NAME:', process.env.DB_NAME);

pool.query("SELECT @@hostname AS host, @@port AS port, USER() AS user, DATABASE() AS db")
  .then(([rows]) => console.log('✅ DB server:', rows[0]))
  .catch((err) => console.error('❌ DB server check failed:', err));

// ------------------------------


pool.query('SELECT DATABASE() AS db')
  .then(([rows]) => console.log('✅ Connected DB:', rows[0].db))
  .catch((err) => console.error('❌ DB check failed:', err));

pool.query("SHOW COLUMNS FROM players LIKE 'phone_consent'")
  .then(([rows]) => console.log('✅ phone_consent column:', rows))
  .catch((err) => console.error('❌ SHOW COLUMNS failed:', err));


async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY users_email_unique (email)
    )
  `);
}

ensureUsersTable().catch((err) => {
  console.error('ensureUsersTable failed:', err);
});


// ---------- CONSTANTS ----------
const ALLOWED_LEVELS = ['3.0', '3.5', '4.0', '4.5'];

const ALLOWED_LOCATIONS = [
  'Lake Rim Park',
  'Hope Mills Municipal Park',
  'Mazarick Park',
  'Gates Four',
  'Terry Sanford',
];

// ---------- HELPERS ----------
function sanitizeText(value, maxLen) {
  const v = (value || '').trim();
  if (!v) return '';
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function isValidPhone(phone) {
  if (!phone) return true;
  const re = /^[0-9+\-\s()]+$/;
  return re.test(phone);
}

function normalizePhoneToUS(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) {
    return null;
  }
  const core = digits.slice(-10); // use last 10 digits
  const part1 = core.slice(0, 3);
  const part2 = core.slice(3, 6);
  const part3 = core.slice(6);
  return `${part1}-${part2}-${part3}`;
}

// Score: Sets 1 & 2 required; Set 3 optional but must be complete if used
function buildScoreFromBodySafe(body) {
  const sets = [];

  for (let i = 1; i <= 3; i++) {
    const wRaw = (body[`w_s${i}`] || '').trim();
    const lRaw = (body[`l_s${i}`] || '').trim();

    if (i === 1 || i === 2) {
      if (!wRaw || !lRaw) {
        return {
          score: null,
          error: `You must enter Winner and Loser games for Set ${i}.`,
        };
      }
    } else {
      if ((wRaw && !lRaw) || (!wRaw && lRaw)) {
        return {
          score: null,
          error: 'Score for Set 3 is incomplete (both Winner and Loser need a value).',
        };
      }
      if (!wRaw && !lRaw) {
        continue;
      }
    }

    if (!wRaw && !lRaw) continue;

    const w = parseInt(wRaw, 10);
    const l = parseInt(lRaw, 10);

    if (!Number.isInteger(w) || w < 0 || !Number.isInteger(l) || l < 0) {
      return {
        score: null,
        error: `Score for Set ${i} must be numeric and non-negative.`,
      };
    }

    sets.push(`${w}-${l}`);
  }

  if (sets.length < 2) {
    return {
      score: null,
      error: 'You must enter complete scores for Set 1 and Set 2.',
    };
  }

  return { score: sets.join(' '), error: null };
}


function isLoggedIn(req) {
  return Boolean(req.session && req.session.userId);
}

function safeNext(next) {
  if (!next || typeof next !== 'string') return '/ladder';
  if (!next.startsWith('/')) return '/ladder';
  if (next.startsWith('//')) return '/ladder';
  return next;
}

// ---------- SIGNUP ----------
app.get('/signup', (req, res) => {
  const next = safeNext(req.query.next);
  res.send(`
    <!doctype html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Create Account</title></head>
    <body style="font-family:Arial;margin:24px;">
      <h2>Create Account</h2>
      <form method="POST" action="/signup?next=${encodeURIComponent(next)}">
        <div style="margin-bottom:10px;">
          <label>Email</label><br>
          <input name="email" type="email" required style="padding:8px;width:320px;max-width:100%;">
        </div>
        <div style="margin-bottom:10px;">
          <label>Password</label><br>
          <input name="password" type="password" required minlength="8" style="padding:8px;width:320px;max-width:100%;">
        </div>
        <button type="submit" style="padding:10px 14px;">Create</button>
        <a href="/login?next=${encodeURIComponent(next)}" style="margin-left:10px;">I already have an account</a>
      </form>
    </body></html>
  `);
});

app.post('/signup', async (req, res) => {
  try {
    const next = safeNext(req.query.next);
    const email = (req.body.email || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();

    if (!email) return res.status(400).send('Email is required.');
    if (password.length < 8) return res.status(400).send('Password must be at least 8 characters.');

    const [[existing]] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing) return res.status(409).send('Email already registered.');

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
      [id, email, passwordHash]
    );

    req.session.userId = id;
    req.session.email = email;

    res.redirect(next);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating account.');
  }
});

// ---------- LOGIN ----------
app.get('/login', (req, res) => {
  const next = safeNext(req.query.next);
  const err = String(req.query.err || '') === '1';

  const html = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Login - FTL</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        :root {
          --hunter-green: #215e21;
          --hunter-green-dark: #174816;
          --hunter-green-light: #e5f5e5;
        }
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #f3f4f6;
        }
        /* HEADER (igual a /register) */
        .site-header {
          background-image: url('/images/bg002.jpg');
          background-size: cover;
          background-position: center;
          padding: 12px 20px;
        }
        .header-inner {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .header-logo-wrapper {
          background: #ffffff;
          border-radius: 14px;
          padding: 4px 6px;
          box-shadow: 0 3px 8px rgba(0,0,0,0.25);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .header-logo {
          width: 64px;
          height: auto;
        }
        .header-text-main h1 {
          margin: 0;
          font-size: 1.6rem;
          color: var(--hunter-green);
        }
        .header-subtitle {
          font-size: 0.85rem;
          color: var(--hunter-green);
          margin-top: 2px;
        }

        .main {
          max-width: 960px;
          margin: 20px auto;
          padding: 0 16px 24px;
        }
        .container {
          max-width: 420px;
          width: 100%;
          background: #ffffff;
          border-radius: 10px;
          padding: 20px 18px 24px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          margin: 0 auto;
        }
        h2 {
          margin-top: 0;
          margin-bottom: 10px;
          font-size: 1.3rem;
          text-align: center;
        }
        p {
          font-size: 0.85rem;
          color: #4b5563;
          text-align: center;
          margin-bottom: 16px;
        }
        .form-field {
          display: flex;
          flex-direction: column;
          margin-bottom: 10px;
        }
        .form-field label {
          font-weight: bold;
          margin-bottom: 4px;
          font-size: 0.9rem;
        }
        .form-field input {
          padding: 6px;
          font-size: 0.9rem;
        }

        .alert {
          margin: 0 auto 12px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #fca5a5;
          background: #fef2f2;
          color: #991b1b;
          font-size: 0.85rem;
          text-align: center;
        }

        .buttons {
          margin-top: 14px;
          display: flex;
          gap: 8px;
        }
        .buttons button,
        .buttons a {
          flex: 1;
        }
        button {
          width: 100%;
          padding: 8px 0;
          border-radius: 999px;
          border: none;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
        }
        .btn-primary {
          background: var(--hunter-green);
          color: #ffffff;
        }
        .btn-primary:hover {
          background: var(--hunter-green-dark);
        }
        .btn-secondary {
          background: #e5e7eb;
          color: #111827;
        }
        .btn-secondary:hover {
          background: #d1d5db;
        }

        .footer-link {
          margin-top: 14px;
          font-size: 0.85rem;
          text-align: center;
          color: #4b5563;
        }
        .footer-link a {
          color: #2563eb;
          text-decoration: none;
        }
        .footer-link a:hover {
          text-decoration: underline;
        }

        .signature {
          margin-top: 8px;
          font-size: 0.7rem;
          color: #6b7280;
          font-weight: bold;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <header class="site-header">
        <div class="header-inner">
          <div class="header-logo-wrapper">
            <img src="/images/FTL01.png" alt="Fayetteville Tennis Ladder logo" class="header-logo">
          </div>
          <div class="header-text-main">
            <h1>Fayetteville Tennis Ladder</h1>
            <div class="header-subtitle">
              Players from Fayetteville and surrounding areas
            </div>
          </div>
        </div>
      </header>

      <main class="main">
        <div class="container">
          <h2>Login</h2>
          <p>Log in to report matches and view phone numbers.</p>

          ${err ? `<div class="alert">Invalid email or password.</div>` : ``}

          <form method="POST" action="/login?next=${encodeURIComponent(next)}">
            <div class="form-field">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" required autocomplete="email" placeholder="your@email.com">
            </div>

            <div class="form-field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" required autocomplete="current-password" placeholder="********">
            </div>

            <div class="buttons">
              <button type="submit" class="btn-primary">Login</button>
              <a href="${next}" style="text-decoration:none;">
                <button type="button" class="btn-secondary">Cancel</button>
              </a>
            </div>
          </form>

          <div class="footer-link">
            Don’t have an account?
            <a href="/signup?next=${encodeURIComponent(next)}">Create account</a>
          </div>

          <div class="signature">Created by RER</div>
        </div>
      </main>
    </body>
    </html>
  `;

  res.send(html);
});

app.post('/login', async (req, res) => {
  try {
    const next = safeNext(req.query.next);
    const email = (req.body.email || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();

    if (!email || !email.includes('@')) {
      return res.redirect(`/login?next=${encodeURIComponent(next)}&err=1`);
    }

    if (!password || password.length < 8) {
      return res.redirect(`/login?next=${encodeURIComponent(next)}&err=1`);
    }

    const [rows] = await pool.query(
      'SELECT id, password_hash FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (!rows.length) {
      return res.redirect(`/login?next=${encodeURIComponent(next)}&err=1`);
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.redirect(`/login?next=${encodeURIComponent(next)}&err=1`);
    }

    req.session.userId = user.id;
    req.session.email = email;

    res.redirect(next);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error logging in.');
  }
});


// ---------- LOGOUT ----------
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});


// ---------- HOME / INDEX PAGE ----------
app.get('/', (req, res) => {
  const html = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Fayetteville Tennis Ladder</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
        :root {
          --hunter-green: #215e21;
          --hunter-green-dark: #174816;
          --hunter-green-light: #e5f5e5;
        }
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #f3f4f6; /* light gray */
        }

        /* HEADER */
        .site-header {
          background-image: url('/images/bg002.jpg');
          background-size: cover;
          background-position: center;
          padding: 12px 20px;
        }
        .header-inner {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .header-logo-wrapper {
          background: #ffffff;
          border-radius: 14px;
          padding: 4px 6px;
          box-shadow: 0 3px 8px rgba(0,0,0,0.25);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .header-logo {
          width: 64px;
          height: auto;
        }
        .header-text-main h1 {
          margin: 0;
          font-size: 1.6rem;
          color: var(--hunter-green);   /* HUNTER GREEN */
        }
        .header-subtitle {
          font-size: 0.85rem;
          color: var(--hunter-green);   /* HUNTER GREEN */
          margin-top: 2px;
        }

        /* MAIN & CARD */
        .main {
          max-width: 960px;
          margin: 24px auto 32px;
          padding: 0 16px;
        }
        .card {
          max-width: 520px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 14px;
          padding: 24px 26px 28px;
          box-shadow: 0 4px 18px rgba(0,0,0,0.08);
          text-align: center;
        }
        .card-title {
          font-size: 1.05rem;
          font-weight: 700;
          margin-bottom: 8px;
          color: #111827;
        }
        .subtitle {
          font-size: 0.9rem;
          color: #4b5563;
          margin-bottom: 16px;
        }
        .section-title {
          font-weight: 700;
          margin-top: 10px;
          margin-bottom: 4px;
          font-size: 0.95rem;
          color: #111827;
        }
        .text {
          font-size: 0.85rem;
          color: #4b5563;
          margin-bottom: 6px;
        }

        /* BOTONES */
        .buttons {
          margin-top: 18px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .buttons a { text-decoration: none; }
        .btn {
          display: block;
          width: 100%;
          padding: 10px 0;
          border-radius: 999px;
          border: none;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
        }
        .btn-primary {
          background: var(--hunter-green);
          color: #ffffff;
        }
        .btn-primary:hover {
          background: var(--hunter-green-dark);
        }
        .btn-secondary {
          background: #ffffff;
          color: var(--hunter-green);
          border: 2px solid var(--hunter-green);
        }
        .btn-secondary:hover {
          background: var(--hunter-green-light);
        }
        .btn-tertiary {
          background: var(--hunter-green);
          color: #ffffff;
        }
        .btn-tertiary:hover {
          background: var(--hunter-green-dark);
        }

        .footer-link {
          margin-top: 16px;
          font-size: 0.8rem;
          color: #6b7280;
        }
        .footer-link a {
          color: #2563eb;
          text-decoration: none;
        }
        .footer-link a:hover {
          text-decoration: underline;
        }

        /* LOGO INFERIOR + FIRMA */
        .bottom-logo-wrapper {
          margin-top: 28px;
          text-align: center;
        }
        .bottom-logo {
          display: block;            /* para que quede en su propia línea */
          margin: 0 auto;
          width: 220px;
          max-width: 70%;
          height: auto;
          border-radius: 12px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.25);
          background: #000;
        }
        .signature-pill {
          display: inline-block;     /* debajo del logo, centrado */
          margin-top: 8px;
          padding: 4px 14px;
          background: #ffffff;
          border-radius: 999px;
          font-size: 0.7rem;
          font-weight: bold;
          color: #6b7280;
          box-shadow: 0 2px 6px rgba(0,0,0,0.10);
        }

        @media (max-width: 480px) {
          .card {
            padding: 18px 14px 22px;
          }
        }
      </style>
    </head>
    <body>
      <header class="site-header">
        <div class="header-inner">
          <div class="header-logo-wrapper">
            <img src="/images/FTL01.png" alt="Fayetteville Tennis Ladder logo" class="header-logo">
          </div>
          <div class="header-text-main">
            <h1>Fayetteville Tennis Ladder</h1>
            <div class="header-subtitle">
              Players from Fayetteville and surrounding areas
            </div>
          </div>
        </div>
      </header>

      <main class="main">
        <div class="card">
          <div class="card-title">Welcome to the Fayetteville Ladder</div>
          <div class="subtitle">
            Friendly ladder for local amateur players to organize matches and track results.
          </div>

          <div class="section-title">Mission</div>
          <div class="text">
            Fayetteville Tennis Ladder exists to bring local players together for fun, friendly amateur tennis, where everyone can enjoy the game, improve their skills, and make new friends.
          </div>

          <div class="section-title">Vision</div>
          <div class="text">
            Our vision is to be the most welcoming amateur tennis community in Fayetteville, where anyone who loves tennis can easily find matches, friends, and motivation all year round.
          </div>

          <div class="buttons">
            <a href="/register">
              <button class="btn btn-primary">Register</button>
            </a>
            <a href="/ladder">
              <button class="btn btn-secondary">Enter Match Result</button>
            </a>
            <a href="/matches">
              <button class="btn btn-tertiary">Match Log</button>
            </a>
          </div>

          </div>

        <div class="bottom-logo-wrapper">
          <img src="/images/FTL01.png" alt="Fayetteville Tennis Ladder logo" class="bottom-logo">
          <div class="signature-pill">Created by RER</div>
        </div>
      </main>
    </body>
    </html>
  `;
  res.send(html);
});

// ---------- REGISTER PAGE ----------
app.get('/register', (req, res) => {
  const html = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Register Player - FTL</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        :root {
          --hunter-green: #215e21;
          --hunter-green-dark: #174816;
          --hunter-green-light: #e5f5e5;
        }
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #f3f4f6;
        }
        /* HEADER */
        .site-header {
          background-image: url('/images/bg002.jpg');
          background-size: cover;
          background-position: center;
          padding: 12px 20px;
        }
        .header-inner {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .header-logo-wrapper {
          background: #ffffff;
          border-radius: 14px;
          padding: 4px 6px;
          box-shadow: 0 3px 8px rgba(0,0,0,0.25);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .header-logo {
          width: 64px;
          height: auto;
        }
        .header-text-main h1 {
          margin: 0;
          font-size: 1.6rem;
          color: var(--hunter-green);   /* HUNTER GREEN */
        }
        .header-subtitle {
          font-size: 0.85rem;
          color: var(--hunter-green);   /* HUNTER GREEN */
          margin-top: 2px;
        }
        .main {
          max-width: 960px;
          margin: 20px auto;
          padding: 0 16px 24px;
        }
        .container {
          max-width: 420px;
          width: 100%;
          background: #ffffff;
          border-radius: 10px;
          padding: 20px 18px 24px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          margin: 0 auto;
        }
        h2 {
          margin-top: 0;
          margin-bottom: 10px;
          font-size: 1.3rem;
          text-align: center;
        }
        p {
          font-size: 0.85rem;
          color: #4b5563;
          text-align: center;
          margin-bottom: 16px;
        }
        .form-field {
          display: flex;
          flex-direction: column;
          margin-bottom: 10px;
        }
        .form-field label {
          font-weight: bold;
          margin-bottom: 4px;
          font-size: 0.9rem;
        }
        .form-field input,
        .form-field select {
          padding: 6px;
          font-size: 0.9rem;
        }
        .buttons {
          margin-top: 14px;
          display: flex;
          gap: 8px;
        }
        .buttons button,
        .buttons a {
          flex: 1;
        }
        button {
          width: 100%;
          padding: 8px 0;
          border-radius: 999px;
          border: none;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
        }
        .btn-primary {
          background: var(--hunter-green);
          color: #ffffff;
        }
        .btn-primary:hover {
          background: var(--hunter-green-dark);
        }
        .btn-secondary {
          background: #e5e7eb;
          color: #111827;
        }
        .btn-secondary:hover {
          background: #d1d5db;
        }
        .signature {
          margin-top: 8px;
          font-size: 0.7rem;
          color: #6b7280;
          font-weight: bold;
          text-align: center;
        }
                  .consent-modal-backdrop{
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.35);
         display: none;                /* oculto por defecto */
          align-items: center;
          justify-content: center;
         padding: 16px;
         z-index: 9999;
        }
        .consent-modal{
          width: 100%;
          max-width: 420px;
          background: #ffffff;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          box-shadow: 0 12px 35px rgba(0,0,0,0.18);
          padding: 16px 16px 14px;
        }
        .consent-title{
          font-weight: 800;
          text-align: center;
          margin: 0 0 8px 0;
        }
        .consent-text{
           margin: 0;
          text-align: center;
          font-size: 0.9rem;
          color: #374151;
          line-height: 1.35;
        }
        .consent-actions{
          display: flex;
          gap: 10px;
          margin-top: 14px;
        }
        .consent-actions button{
          flex: 1;
          padding: 9px 12px;
          border-radius: 999px;
          border: none;
          font-size: 0.9rem;
          font-weight: 700;
          cursor: pointer;
        }
        .consent-yes{
          background: var(--hunter-green);
          color: #ffffff;
        }
        .consent-no{
          background: #e5e7eb;
          color: #111827;
        }
      </style>
      


      <script>
        function validateRegisterForm() {
          var form = document.getElementById('registerForm');
          var name = form.player_name.value.trim();
          var phone = form.phone.value.trim();
          var level = form.level.value;

          if (!name) {
            alert('Player Name is required.');
            form.player_name.focus();
            return false;
          }

          if (!phone) {
            alert('Cell Phone is required.');
            form.phone.focus();
            return false;
          }

          var digits = phone.replace(/\\D/g, '');
          if (digits.length < 10) {
            alert('Please enter a valid 10-digit phone number.');
            form.phone.focus();
            return false;
          }

          if (!level) {
            alert('Level is required.');
            form.level.focus();
            return false;
          }



          return true;
        }
      </script>
    </head>
    <body>
      <header class="site-header">
        <div class="header-inner">
          <div class="header-logo-wrapper">
            <img src="/images/FTL01.png" alt="Fayetteville Tennis Ladder logo" class="header-logo">
          </div>
          <div class="header-text-main">
            <h1>Fayetteville Tennis Ladder</h1>
            <div class="header-subtitle">
              Players from Fayetteville and surrounding areas
            </div>
          </div>
        </div>
      </header>

      <main class="main">
        <div class="container">
          <h2>Register Player</h2>
          <p>Fill in your information to join the local tennis ladder.</p>
          <form id="registerForm" method="POST" action="/register" onsubmit="return validateRegisterForm();">
            <div class="form-field">
              <label for="player_name">Player Name</label>
              <input type="text" id="player_name" name="player_name" placeholder="First and last name" required>
            </div>
            <div class="form-field">
              <label for="phone">Cell Phone</label>
              <input type="text" id="phone" name="phone" placeholder="Just Numbers" required>
            </div>
            <div class="form-field">
              <label for="level">Level</label>
              <select id="level" name="level" required>
                <option value="">-- select --</option>
                <option value="3.0">3.0</option>
                <option value="3.5">3.5</option>
                <option value="4.0">4.0</option>
                <option value="4.5">4.5</option>
              </select>
            </div>
            <input type="hidden" id="phone_consent" name="phone_consent" value="">
            <div class="buttons">
              <button type="submit" class="btn-primary">Save</button>
              <a href="/" style="text-decoration:none;">
                <button type="button" class="btn-secondary">Cancel</button>
              </a>
            </div>
          </form>

          <div id="consentModal" class="consent-modal-backdrop" aria-hidden="true">
            <div class="consent-modal" role="dialog" aria-modal="true">
              <div class="consent-title">Consent</div>
              <p class="consent-text">By clicking ‘Accept’, you consent to your phone number being shared on ftladder.com</p>

              <div class="consent-actions">
                <button type="button" id="consentYesBtn" class="consent-yes">Yes</button>
                <button type="button" id="consentNoBtn" class="consent-no">No</button>
              </div>
            </div>
          </div>


          <div class="signature">Created by RER</div>
        </div>
      </main>

      <script>
  (function () {
    const form = document.getElementById('registerForm');
    const modal = document.getElementById('consentModal');
    const yesBtn = document.getElementById('consentYesBtn');
    const noBtn  = document.getElementById('consentNoBtn');
    const phoneInput = document.getElementById('phone');

    // Campo oculto para enviar el consentimiento al POST /register
    let consentInput = document.getElementById('phone_consent');
    if (!consentInput) {
      consentInput = document.createElement('input');
      consentInput.type = 'hidden';
      consentInput.name = 'phone_consent';
consentInput.id = 'phone_consent';
      consentInput.value = '';
      form.appendChild(consentInput);
    }

    form.addEventListener('submit', function (e) {
      // si ya eligió yes/no, dejamos que el form se envíe normal
      if (consentInput.value === 'yes' || consentInput.value === 'no') return;

      // si todavía no eligió, abrimos el modal
      e.preventDefault();
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    });

    yesBtn.addEventListener('click', function () {
      consentInput.value = 'yes';
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      form.submit();
    });

    noBtn.addEventListener('click', function () {
      consentInput.value = 'no';
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      form.requestSubmit();
    });
  })();
</script>


    </body>
    </html>
  `;
  res.send(html);
});

app.post('/register', async (req, res) => {
  try {
    let { player_name, phone, level, phone_consent } = req.body;

    const name = sanitizeText(player_name, 100);
    const rawPhone = sanitizeText(phone, 25);
    const lvl = (level || '').trim();
    const consent = (phone_consent || '').toLowerCase();

    if (!name) {
      return res
        .status(400)
        .send('Player Name is required. Please go back and complete the form.');
    }

    if (!rawPhone) {
      return res
        .status(400)
        .send('Cell Phone is required. Please go back and complete the form.');
    }

    if (!ALLOWED_LEVELS.includes(lvl)) {
      return res
        .status(400)
        .send('Invalid level. Allowed values: 3.0, 3.5, 4.0, 4.5.');
    }

    if (!isValidPhone(rawPhone)) {
      return res
        .status(400)
        .send('Invalid phone format. Only digits, spaces, +, -, and parentheses are allowed.');
    }

    const normalized = normalizePhoneToUS(rawPhone);
    if (!normalized) {
      return res
        .status(400)
        .send('Invalid phone number. Please enter a valid 10-digit phone number.');
    }

    // Siempre guardamos el teléfono real (normalizado)
    const phoneToStore = normalized;

    // Consentimiento: solo 1 si explícitamente llegó "yes"; cualquier otro caso = 0
    

    const [[row]] = await pool.query(
      'SELECT COALESCE(MAX(ladder_rank), 0) + 1 AS next_rank FROM players'
    );
    const nextRank = row.next_rank || 1;

    const phoneConsentFlag = consent === 'yes' ? 1 : 0;

    await pool.query(
      'INSERT INTO players (name, phone, level, ladder_rank, phone_consent) VALUES (?, ?, ?, ?, ?)',
      [name, phoneToStore, lvl, nextRank, phoneConsentFlag]
    );


    res.redirect('/ladder');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error saving player. Please try again or contact the administrator.');
  }
});

// ---------- LADDER PAGE ----------
app.get('/ladder', async (req, res) => {
  try {
    const [players] = await pool.query(
      'SELECT * FROM players ORDER BY ladder_rank ASC'
    );


    const loggedIn = isLoggedIn(req);

    const locationOptions = ALLOWED_LOCATIONS
      .map((loc) => `<option value="${loc}">${loc}</option>`)
      .join('');

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Tennis Ladder - FTL</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          :root {
            --hunter-green: #215e21;
            --hunter-green-dark: #174816;
            --hunter-green-light: #e5f5e5;
            --border-soft: #e5e7eb;
          }
          body {
            margin: 0;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            background: #f3f4f6;
            color: #111827;
          }
          /* HEADER */
        .site-header {
          background-image: url('/images/bg002.jpg');
          background-size: cover;
          background-position: center;
          padding: 12px 20px;
        }
        .header-inner {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .header-logo-wrapper {
          background: #ffffff;
          border-radius: 14px;
          padding: 4px 6px;
          box-shadow: 0 3px 8px rgba(0,0,0,0.25);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .header-logo {
          width: 64px;
          height: auto;
        }
        .header-text-main h1 {
          margin: 0;
          font-size: 1.6rem;
          color: var(--hunter-green);   /* HUNTER GREEN */
        }
        .header-subtitle {
          font-size: 0.85rem;
          color: var(--hunter-green);   /* HUNTER GREEN */
          margin-top: 2px;
        }
          .main {
            max-width: 960px;
            margin: 0 auto;
            padding: 16px;
          }
          .page-layout {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          @media (min-width: 900px) {
            .page-layout {
              flex-direction: row;
              align-items: flex-start;
            }
          }
          .left-column {
            flex: 1;
            min-width: 260px;
          }
          .right-column {
            flex: 1;
            min-width: 260px;
          }
          .card {
            background: #ffffff;
            border-radius: 12px;
            padding: 16px 14px;
            box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
            border: 1px solid var(--border-soft);
            margin-bottom: 16px;
          }
          h1.page-title {
            margin: 0 0 10px;
            font-size: 1.4rem;
          }
          h2 { margin-top: 20px; }

          .form-container {
            width: 100%;
            max-width: 420px;
            padding: 12px;
            border-radius: 10px;
            background: #ffffff;
            box-shadow: 0 4px 12px rgba(0,0,0,0.06);
            margin-bottom: 24px;
            border: 1px solid var(--border-soft);
          }
          .form-field {
            display: flex;
            flex-direction: column;
            margin-bottom: 10px;
          }
          label {
            font-size: 0.85rem;
            margin-bottom: 3px;
            color: #374151;
            font-weight: 600;
          }
          select, input[type="number"], input[type="text"], input[type="date"] {
            padding: 7px 9px;
            border-radius: 8px;
            border: 1px solid #d1d5db;
            font-size: 0.9rem;
            outline: none;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
          }
          select:focus,
          input[type="number"]:focus,
          input[type="text"]:focus,
          input[type="date"]:focus {
            border-color: var(--hunter-green);
            box-shadow: 0 0 0 1px rgba(33, 94, 33, 0.15);
          }
          .sets-grid {
            display: grid;
            grid-template-columns: auto 64px 64px;
            gap: 4px 6px;
            align-items: center;
            font-size: 0.85rem;
          }
          .sets-grid-header {
            font-weight: 600;
            text-align: center;
          }
          .sets-grid-label {
            font-weight: 500;
          }
          .sets-grid input[type="number"]{
            width: 64px;
            text-align: center;
            padding: 6px 8px;   /* más compacto solo aquí */
          }
          .note {
            font-size: 0.8rem;
            color: #6b7280;
            margin-top: 4px;
          }
          .buttons-row {
            margin-top: 12px;
          }
          .btn-primary {
            padding: 8px 14px;
            border-radius: 999px;
            border: none;
            background: var(--hunter-green);
            color: #ffffff;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.18s ease, transform 0.05s ease;
          }
          .btn-primary:hover {
            background: var(--hunter-green-dark);
            transform: translateY(-1px);
          }

                    /* Disabled state for Accept (when user is NOT logged in) */
          form[action="/report-match"] button.btn-primary:disabled,
          form[action="/report-match"] button.btn-primary[disabled]{
            background: #9ca3af !important;
            background-color: #9ca3af !important;
            border-color: #9ca3af !important;
            color: #ffffff !important;
            cursor: not-allowed !important;
            opacity: 0.60 !important;
            box-shadow: none !important;
            transform: none !important;
            filter: grayscale(20%) !important;
            pointer-events: none !important;
          }

          form[action="/report-match"] button.btn-primary:disabled:hover,
          form[action="/report-match"] button.btn-primary[disabled]:hover,
          form[action="/report-match"] button.btn-primary:disabled:active,
          form[action="/report-match"] button.btn-primary[disabled]:active{
            background: #9ca3af !important;
            background-color: #9ca3af !important;
            transform: none !important;
            filter: none !important;
          }
.table-wrapper {
            margin-top: 8px;
            border-radius: 12px;
            border: 1px solid var(--border-soft);
            overflow: hidden;
            background: #ffffff;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
          }
          thead {
            background: var(--hunter-green);
            color: #ffffff;
          }
          thead th {
            padding: 8px;
            text-align: left;
            font-weight: 600;
            border-bottom: 1px solid #d1d5db;
          }
          tbody tr:nth-child(even) {
            background: #f9fafb;
          }
          tbody td {
            padding: 7px 8px;
            border-bottom: 1px solid #e5e7eb;
          }
          .signature {
            margin-top: 12px;
            text-align: center;
            font-size: 0.7rem;
            color: #6b7280;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <header class="site-header">
        <div class="header-inner">
          <div class="header-logo-wrapper">
            <img src="/images/FTL01.png" alt="Fayetteville Tennis Ladder logo" class="header-logo">
          </div>
          <div class="header-text-main">
            <h1>Fayetteville Tennis Ladder</h1>
            <div class="header-subtitle">
              Players from Fayetteville and surrounding areas
            </div>
          </div>
        </div>
      </header>

        <main class="main">
          <div class="page-layout">
            <div class="left-column">
              <div class="card">
                <h1 class="page-title">Report Match</h1>
                ${loggedIn ? '' : `
                  <div class="note" style="margin-bottom:10px; padding:10px; border:1px solid #e5e7eb; border-radius:10px;">
                    <b>Login required</b> to report a match.
                    <div style="margin-top:6px;"><a href="/login?next=/ladder"><b>"Go to Login"</b></a></div>
                  </div>
                `}
                <form id="reportMatchForm" method="POST" action="/report-match">

                  <div class="form-field">
                    <label for="match_date">Match Date</label>
                    <input type="date" id="match_date" name="match_date" required>
                  </div>

                  <div class="form-field">
                    <label for="location">Location</label>
                    <select id="location" name="location" required>
                      <option value="">-- select location --</option>
                      ${locationOptions}
                    </select>
                    <div class="note">
                      (Location is required. If your court is not listed, please choose the closest available.)
                    </div>
                  </div>

                  <div class="form-field">
                    <label for="winner_id">Winner</label>
                    <select id="winner_id" name="winner_id" required>
                      <option value="">-- select winner --</option>
                      ${players
                        .map(
                          (p) =>
                            `<option value="${p.id}">${p.name} (Rank ${p.ladder_rank}, Level ${
                              p.level || ''
                            })</option>`
                        )
                        .join('')}
                    </select>
                  </div>

                  <div class="form-field">
                    <label for="loser_id">Loser</label>
                    <select id="loser_id" name="loser_id" required>
                      <option value="">-- select loser --</option>
                      ${players
                        .map(
                          (p) =>
                            `<option value="${p.id}">${p.name} (Rank ${p.ladder_rank}, Level ${
                              p.level || ''
                            })</option>`
                        )
                        .join('')}
                    </select>
                  </div>

                  <div class="form-field">
                    <label>Score (games per set)</label>
                    <div class="sets-grid">
                      <div></div>
                      <div class="sets-grid-header">Winner</div>
                      <div class="sets-grid-header">Loser</div>

                      <div class="sets-grid-label">Set 1</div>
                      <input type="number" name="w_s1" min="0" placeholder="6" required>
                      <input type="number" name="l_s1" min="0" placeholder="4" required>

                      <div class="sets-grid-label">Set 2</div>
                      <input type="number" name="w_s2" min="0" placeholder="6" required>
                      <input type="number" name="l_s2" min="0" placeholder="4" required>

                      <div class="sets-grid-label">Set 3 (if played)</div>
                      <input type="number" name="w_s3" min="0" placeholder="0">
                      <input type="number" name="l_s3" min="0" placeholder="0">
                    </div>
                    <div class="note">
                      Sets 1 and 2 are required. Set 3 is optional but must have both Winner and Loser games if used.
                    </div>
                  </div>

                  <div class="buttons-row">
                    <button type="submit" class="btn-primary" ${loggedIn ? '' : 'disabled style="background:#9ca3af !important; border-color:#9ca3af !important; color:#fff !important; cursor:not-allowed !important; opacity:0.6 !important; box-shadow:none !important;"'}>Accept</button>
                  </div>
                </form>
              </div>
            </div>

            <div class="right-column">
              <div class="card">
                <h2>Players (Ladder)</h2>
                <div class="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Player</th>
                        <th>Level</th>
                        <th>Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                    ${players
                      .map((p) => {
                        const phoneCell = !loggedIn
                          ? `<a href="/login?next=/ladder">Login to view</a>`
                          : (Number(p.phone_consent) === 1 ? (p.phone || '') : '(private)');


                        return `
                        <tr>
                            <td>${p.ladder_rank}</td>
                            <td>${p.name}</td>
                            <td>${p.level || ''}</td>
                            <td>${phoneCell}</td>
                          </tr>
                        `;
                      })
                      .join('')}

                    </tbody>
                  </table>
                </div>

                <p>
                  <a href="/">Back to Home</a> |
                  <a href="/matches">Match Log</a>
                </p>

                <div class="signature">Created by RER</div>
              </div>
            </div>
          </div>
        </main>
      </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading ladder. Please try again later.');
  }
});

function requireLogin(req, res, next) {
  const loggedIn = Boolean(req.session && req.session.userId);
  if (loggedIn) return next();

  // Si alguien intenta hacer POST sin sesión, lo mandamos a login.
  // (puedes quitar el ?next si tu login no lo usa)
  return res.redirect('/login?next=/ladder');
}


// ---------- REPORT MATCH ----------
app.post('/report-match', requireLogin, async (req, res) => {
  try {
    const {
      match_date,
      location,
      winner_id: rawWinnerId,
      loser_id: rawLoserId,
    } = req.body;

    const matchDateStr = (match_date || '').trim();
    const rawLocation = (location || '').trim();

    if (!matchDateStr) {
      return res.status(400).send('Match date is required.');
    }
    const matchDate = new Date(matchDateStr);
    if (Number.isNaN(matchDate.getTime())) {
      return res.status(400).send('Invalid match date.');
    }

    if (!rawLocation) {
      return res.status(400).send('Location is required.');
    }

    if (!ALLOWED_LOCATIONS.includes(rawLocation)) {
      return res.status(400).send('Invalid location.');
    }

    const winnerId = parseInt(rawWinnerId, 10);
    const loserId = parseInt(rawLoserId, 10);

    if (!Number.isInteger(winnerId) || winnerId <= 0) {
      return res.status(400).send('Invalid Winner player.');
    }
    if (!Number.isInteger(loserId) || loserId <= 0) {
      return res.status(400).send('Invalid Loser player.');
    }
    if (winnerId === loserId) {
      return res.status(400).send('Winner and Loser must be different players.');
    }

    const { score, error } = buildScoreFromBodySafe(req.body);
    if (error || !score) {
      return res.status(400).send(error || 'Invalid score data.');
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [playerRows] = await conn.query(
        'SELECT id, ladder_rank FROM players WHERE id IN (?, ?)',
        [winnerId, loserId]
      );
      if (playerRows.length !== 2) {
        throw new Error('Winner or Loser not found in the ladder.');
      }

      const winnerRow = playerRows.find((p) => p.id === winnerId);
      const loserRow = playerRows.find((p) => p.id === loserId);
      const winnerCurrentRank = parseInt(winnerRow.ladder_rank, 10);
      const loserCurrentRank = parseInt(loserRow.ladder_rank, 10);

      if (!Number.isInteger(winnerCurrentRank) || !Number.isInteger(loserCurrentRank)) {
        throw new Error('Invalid ladder ranks in database.');
      }


      

      if (winnerCurrentRank === loserCurrentRank) {
        throw new Error(
          'Invalid ladder result: Winner and loser cannot have the same rank.'
        );
      }
      
      const winnerOldRank = winnerCurrentRank;
const loserOldRank  = loserCurrentRank;

let winnerNewRank = winnerOldRank;
let loserNewRank  = loserOldRank;

/*
  Regla:
  - Si el winner ya estaba arriba (rank menor), NO cambia la ladder.
  - Si el winner estaba abajo (rank mayor), el winner sube al rank del loser
    y todos entre medio bajan 1.
*/
if (winnerCurrentRank > loserCurrentRank) {
  // Baja 1 posición a todos los que estaban entre loserRank y winnerRank-1
  await conn.query(
    `
    UPDATE players
    SET ladder_rank = ladder_rank + 1
    WHERE ladder_rank >= ? AND ladder_rank < ?
    `,
    [loserCurrentRank, winnerCurrentRank]
  );

  // Winner toma el lugar del loser
  await conn.query(
    'UPDATE players SET ladder_rank = ? WHERE id = ?',
    [loserCurrentRank, winnerId]
  );

  winnerNewRank = loserCurrentRank;
  loserNewRank  = loserCurrentRank + 1;
}

      

      await conn.query(
        `
        INSERT INTO matches
          (match_date, location, score, winner_id, loser_id,
           winner_old_rank, winner_new_rank, loser_old_rank, loser_new_rank)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          matchDateStr,
          rawLocation,
          score,
          winnerId,
          loserId,
          winnerOldRank,
          winnerNewRank,
          loserOldRank,
          loserNewRank,
        ]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.redirect('/matches');
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .send('Error reporting match. Please check the data or contact the administrator.');
  }
});

// ---------- MATCH LOG PAGE ----------
app.get('/matches', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        m.id,
        DATE_FORMAT(m.match_date, '%Y-%m-%d') AS match_date,
        m.location,
        m.score,
        w.name AS winner_name,
        l.name AS loser_name,
        m.winner_old_rank,
        m.winner_new_rank,
        m.loser_old_rank,
        m.loser_new_rank
      FROM matches m
      JOIN players w ON m.winner_id = w.id
      JOIN players l ON m.loser_id = l.id
      ORDER BY m.match_date DESC, m.id DESC
    `
    );

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Match Log - FTL</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          :root {
            --hunter-green: #215e21;
            --hunter-green-dark: #174816;
            --hunter-green-light: #e5f5e5;
            --border-soft: #e5e7eb;
          }
          body {
            margin: 0;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            background: #f3f4f6;
            color: #111827;
          }
          /* HEADER */
        .site-header {
          background-image: url('/images/bg002.jpg');
          background-size: cover;
          background-position: center;
          padding: 12px 20px;
        }
        .header-inner {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .header-logo-wrapper {
          background: #ffffff;
          border-radius: 14px;
          padding: 4px 6px;
          box-shadow: 0 3px 8px rgba(0,0,0,0.25);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .header-logo {
          width: 64px;
          height: auto;
        }
        .header-text-main h1 {
          margin: 0;
          font-size: 1.6rem;
          color: var(--hunter-green);   /* HUNTER GREEN */
        }
        .header-subtitle {
          font-size: 0.85rem;
          color: var(--hunter-green);   /* HUNTER GREEN */
          margin-top: 2px;
        }
          .main {
            max-width: 960px;
            margin: 0 auto;
            padding: 16px;
          }
          .card {
            background: #ffffff;
            border-radius: 12px;
            padding: 16px 14px;
            box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
            border: 1px solid var(--border-soft);
          }
          h1 {
            margin-top: 0;
            font-size: 1.4rem;
          }
          .table-wrapper {
            margin-top: 8px;
            border-radius: 12px;
            border: 1px solid var(--border-soft);
            overflow: hidden;
            background: #ffffff;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
          }
          thead {
            background: var(--hunter-green);
            color: #ffffff;
          }
          thead th {
            padding: 8px;
            text-align: left;
            font-weight: 600;
            border-bottom: 1px solid #d1d5db;
          }
          tbody tr:nth-child(even) {
            background: #f9fafb;
          }
          tbody td {
            padding: 7px 8px;
            border-bottom: 1px solid #e5e7eb;
          }
          .signature {
            margin-top: 12px;
            text-align: center;
            font-size: 0.7rem;
            color: #6b7280;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <header class="site-header">
        <div class="header-inner">
          <div class="header-logo-wrapper">
            <img src="/images/FTL01.png" alt="Fayetteville Tennis Ladder logo" class="header-logo">
          </div>
          <div class="header-text-main">
            <h1>Fayetteville Tennis Ladder</h1>
            <div class="header-subtitle">
              Players from Fayetteville and surrounding areas
            </div>
          </div>
        </div>
      </header>

        <main class="main">
          <div class="card">
            <h1>Match Log</h1>
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Location</th>
                    <th>Winner</th>
                    <th>Loser</th>
                    <th>Score</th>
                    <th>Winner Rank (Old → New)</th>
                    <th>Loser Rank (Old → New)</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows
                    .map(
                      (m) => `
                    <tr>
                      <td>${m.match_date}</td>
                      <td>${m.location}</td>
                      <td>${m.winner_name}</td>
                      <td>${m.loser_name}</td>
                      <td>${m.score}</td>
                      <td>${m.winner_old_rank} → ${m.winner_new_rank}</td>
                      <td>${m.loser_old_rank} → ${m.loser_new_rank}</td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>

            <p>
              <a href="/">Back to Home</a> |
              <a href="/ladder">Schedule Your Match / Enter Result</a>
            </p>

            <div class="signature">Created by RER</div>
          </div>
        </main>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading match log. Please try again later.');
  }
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tennis ladder app running on http://localhost:${PORT}`);
});
