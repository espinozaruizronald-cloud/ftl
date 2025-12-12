const express = require('express');
const mysql = require('mysql2/promise');
const app = express();

// Parse HTML form data
app.use(express.urlencoded({ extended: true }));

// Serve static files from "public" (for images, css, etc.)
app.use(express.static('public'));

// ---------- MYSQL CONNECTION ----------
// Uses environment variables for cloud, defaults for local.
const pool = mysql.createPool({

  pool.getConnection()
  .then((conn) => {
    console.log('✅ MySQL pool initial connection OK');
    conn.release();
  })
  .catch((err) => {
    console.error('❌ Error connecting MySQL pool on startup:', err);
  });
  
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '@m3r1c4t3L!',
  database: process.env.DB_NAME || 'tennis_ladder',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306, // <--- NUEVO
  waitForConnections: true,
  connectionLimit: 10,
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

    if (!wRaw && !lRaw) {
      continue;
    }
    if (!wRaw || !lRaw) {
      return {
        score: null,
        error: `Score for Set ${i} is incomplete (both Winner and Loser need a value).`,
      };
    }

    const w = Number(wRaw);
    const l = Number(lRaw);
    if (!Number.isInteger(w) || !Number.isInteger(l)) {
      return {
        score: null,
        error: `Score for Set ${i} must be whole numbers.`,
      };
    }

    const maxGames = i === 3 ? 20 : 10;
    if (w < 0 || w > maxGames || l < 0 || l > maxGames) {
      return {
        score: null,
        error: `Score for Set ${i} must be between 0 and ${maxGames}.`,
      };
    }

    if (w === 0 && l === 0) {
      return {
        score: null,
        error: `Score for Set ${i} cannot be 0–0.`,
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
        .site-header {
          background-image: url('/images/bg002.jpg');
          background-size: cover;
          background-position: center;
          padding: 16px 20px;
        }
        .header-inner {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .header-logo {
          width: 70px;
          height: auto;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.25);
        }
        .header-text-main h1 {
          margin: 0;
          font-size: 1.4rem;
          color: var(--hunter-green);
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
      </style>
      <script>
        function validateRegisterForm() {
          var form = document.getElementById('registerForm');
          if (!form.player_name.value.trim()) {
            alert('Player Name is required.');
            form.player_name.focus();
            return false;
          }
          if (!form.level.value) {
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
          <img src="/images/FTL01.png" alt="FTL logo" class="header-logo">
          <div class="header-text-main">
            <h1>Fayetteville Tennis Ladder</h1>
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
              <input type="text" id="phone" name="phone" placeholder="Just Numbers">
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
            <div class="buttons">
              <button type="submit" class="btn-primary">Save</button>
              <a href="/" style="text-decoration:none;">
                <button type="button" class="btn-secondary">Cancel</button>
              </a>
            </div>
          </form>

          <div class="signature">Created by RER</div>
        </div>
      </main>
    </body>
    </html>
  `;
  res.send(html);
});

app.post('/register', async (req, res) => {
  try {
    let { player_name, phone, level } = req.body;

    const name = sanitizeText(player_name, 100);
    const phoneClean = sanitizeText(phone, 25);
    const lvl = (level || '').trim();

    if (!name) {
      return res
        .status(400)
        .send('Player Name is required. Please go back and complete the form.');
    }

    if (!ALLOWED_LEVELS.includes(lvl)) {
      return res
        .status(400)
        .send('Invalid level. Allowed values: 3.0, 3.5, 4.0, 4.5.');
    }

    if (phoneClean && !isValidPhone(phoneClean)) {
      return res
        .status(400)
        .send('Invalid phone format. Only digits, spaces, +, -, and parentheses are allowed.');
    }

    const [[row]] = await pool.query(
      'SELECT COALESCE(MAX(ladder_rank), 0) + 1 AS next_rank FROM players'
    );
    const nextRank = row.next_rank || 1;

    await pool.query(
      'INSERT INTO players (name, phone, level, ladder_rank) VALUES (?, ?, ?, ?)',
      [name, phoneClean || null, lvl, nextRank]
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
            --row-even: #f9fafb;
            --row-odd: #ffffff;
            --border-soft: #d1d5db;
          }
          body { margin: 0; font-family: Arial, sans-serif; background: #f3f4f6; }
          .site-header {
            background-image: url('/images/bg002.jpg');
            background-size: cover;
            background-position: center;
            padding: 16px 20px;
          }
          .header-inner {
            max-width: 960px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            gap: 16px;
          }
          .header-logo {
            width: 70px;
            height: auto;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.25);
          }
          .header-text-main h1 {
            margin: 0;
            font-size: 1.4rem;
            color: var(--hunter-green);
          }

          .main {
            max-width: 960px;
            margin: 20px auto;
            padding: 0 16px 24px;
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
          .form-field label {
            font-weight: bold;
            margin-bottom: 4px;
          }
          .form-field input,
          .form-field select {
            padding: 6px;
            font-size: 0.95rem;
          }
          .buttons { margin-top: 12px; }
          button {
            padding: 8px 14px;
            font-size: 0.95rem;
            border-radius: 999px;
            border: none;
            background: var(--hunter-green);
            color: #ffffff;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.18s ease;
          }
          button:hover {
            background: var(--hunter-green-dark);
          }

          .table-wrapper {
            width: 100%;
            overflow-x: auto;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            min-width: 400px;
            margin-bottom: 20px;
            background: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 10px rgba(0,0,0,0.05);
          }
          thead {
            background: var(--hunter-green);
            color: #ffffff;
          }
          th, td {
            border: 1px solid var(--border-soft);
            padding: 8px 10px;
            text-align: center;
            font-size: 0.9rem;
          }
          tbody tr:nth-child(odd) {
            background: var(--row-odd);
          }
          tbody tr:nth-child(even) {
            background: var(--row-even);
          }

          .score-grid { margin-top: 4px; }
          .score-row {
            display: flex;
            align-items: center;
            margin-bottom: 4px;
          }
          .score-label {
            width: 115px;
            font-size: 0.9rem;
          }
          .score-input {
            width: 50px;
            margin-right: 6px;
            text-align: center;
          }
          .score-header .score-label {
            visibility: hidden;
          }
          .set-number {
            width: 50px;
            text-align: center;
            font-weight: bold;
          }
          .score-help {
            font-size: 0.8rem;
            color: #555;
            margin-top: 4px;
          }

          @media (max-width: 480px) {
            .form-container { padding: 10px; }
            table { min-width: 360px; }
          }
          .signature {
            margin-top: 8px;
            font-size: 0.7rem;
            color: #6b7280;
            font-weight: bold;
            text-align: center;
          }
        </style>

        <script>
          function validateMatchForm() {
            var form = document.getElementById('matchForm');

            var date = form.match_date.value.trim();
            var location = form.location.value;
            var winner = form.winner_id.value;
            var loser = form.loser_id.value;

            if (!date) {
              alert('Match Date is required.');
              form.match_date.focus();
              return false;
            }

            if (!location) {
              alert('Location is required.');
              form.location.focus();
              return false;
            }

            if (!winner) {
              alert('Winner is required.');
              form.winner_id.focus();
              return false;
            }

            if (!loser) {
              alert('Loser is required.');
              form.loser_id.focus();
              return false;
            }

            if (winner === loser) {
              alert('Winner and Loser must be different players.');
              return false;
            }

            for (var i = 1; i <= 3; i++) {
              var w = form['w_s' + i].value.trim();
              var l = form['l_s' + i].value.trim();

              if (i === 1 || i === 2) {
                if (!w || !l) {
                  alert('You must enter Winner and Loser games for Set ' + i + '.');
                  return false;
                }
              } else {
                if ((w && !l) || (!w && l)) {
                  alert('Score for Set 3 is incomplete (both Winner and Loser need a value).');
                  return false;
                }
              }
            }

            return true;
          }
        </script>
      </head>
      <body>
        <header class="site-header">
          <div class="header-inner">
            <img src="/images/FTL01.png" alt="FTL logo" class="header-logo">
            <div class="header-text-main">
              <h1>Fayetteville Tennis Ladder</h1>
            </div>
          </div>
        </header>

        <main class="main">
          <h1 class="page-title">Tennis Ladder</h1>

          <h2>Report Match</h2>
          <div class="form-container">
            <form id="matchForm" method="POST" action="/matches" onsubmit="return validateMatchForm();">
              <div class="form-field">
                <label for="match_date">Match Date</label>
                <input type="date" id="match_date" name="match_date" required>
              </div>

              <div class="form-field">
                <label for="location">Location</label>
                <select id="location" name="location" required>
                  <option value="">-- select --</option>
                  ${locationOptions}
                </select>
              </div>

              <div class="form-field">
                <label>Score (games per set)</label>
                <div class="score-grid">
                  <div class="score-row score-header">
                    <span class="score-label">Set</span>
                    <span class="set-number">1</span>
                    <span class="set-number">2</span>
                    <span class="set-number">3</span>
                  </div>
                  <div class="score-row">
                    <span class="score-label">Winner games:</span>
                    <input class="score-input" type="number" name="w_s1" min="0" max="10" placeholder="6">
                    <input class="score-input" type="number" name="w_s2" min="0" max="10" placeholder="6">
                    <input class="score-input" type="number" name="w_s3" min="0" max="20" placeholder="10">
                  </div>
                  <div class="score-row">
                    <span class="score-label">Loser games:</span>
                    <input class="score-input" type="number" name="l_s1" min="0" max="10" placeholder="3">
                    <input class="score-input" type="number" name="l_s2" min="0" max="10" placeholder="4">
                    <input class="score-input" type="number" name="l_s3" min="0" max="20" placeholder="8">
                  </div>
                  <div class="score-help">
                    Sets 1 and 2 are required. Use Set 3 only if it was played (for example, a third-set tiebreak).
                  </div>
                </div>
              </div>

              <div class="form-field">
                <label for="winner_id">Winner</label>
                <select id="winner_id" name="winner_id" required>
                  <option value="">-- select --</option>
                  ${players.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
                </select>
              </div>

              <div class="form-field">
                <label for="loser_id">Loser</label>
                <select id="loser_id" name="loser_id" required>
                  <option value="">-- select --</option>
                  ${players.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
                </select>
              </div>

              <div class="buttons">
                <button type="submit">Accept</button>
              </div>
            </form>
          </div>

          <h2>Players (Ladder)</h2>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Player</th>
                  <th>Level</th>
                </tr>
              </thead>
              <tbody>
              ${players.map((p) => `
                <tr>
                  <td>${p.ladder_rank}</td>
                  <td>${p.name}</td>
                  <td>${p.level || ''}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>

          <p>
            <a href="/">Back to Home</a> |
            <a href="/matches">Match Log</a>
          </p>

          <div class="signature">Created by RER</div>
        </main>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading ladder.');
  }
});

// ---------- SAVE MATCH + UPDATE RANKS ----------
app.post('/matches', async (req, res) => {
  try {
    const rawDate = (req.body.match_date || '').trim();
    const rawWinnerId = req.body.winner_id;
    const rawLoserId = req.body.loser_id;
    const rawLocation = (req.body.location || '').trim();

    if (!rawDate) {
      return res.status(400).send('Match Date is required.');
    }

    const matchDate = new Date(rawDate);
    if (Number.isNaN(matchDate.getTime())) {
      return res.status(400).send('Invalid Match Date.');
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
      return res
        .status(400)
        .send('Winner and Loser must be different players.');
    }

    const { score, error: scoreError } = buildScoreFromBodySafe(req.body);
    if (scoreError) {
      return res.status(400).send(scoreError);
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(
        'SELECT id, ladder_rank FROM players WHERE id IN (?, ?) FOR UPDATE',
        [winnerId, loserId]
      );
      if (rows.length !== 2) {
        throw new Error('One or both players not found in database.');
      }

      const winner = rows.find((r) => r.id == winnerId);
      const loser = rows.find((r) => r.id == loserId);

      if (
        !Number.isInteger(winner.ladder_rank) ||
        !Number.isInteger(loser.ladder_rank)
      ) {
        throw new Error('One or both players do not have a valid ladder_rank.');
      }

      let winnerOld = winner.ladder_rank;
      let loserOld = loser.ladder_rank;
      let winnerNew = winnerOld;
      let loserNew = loserOld;

      if (winnerOld > loserOld) {
        winnerNew = loserOld;
        loserNew = winnerOld;

        await conn.query('UPDATE players SET ladder_rank = ? WHERE id = ?', [
          winnerNew,
          winnerId,
        ]);
        await conn.query('UPDATE players SET ladder_rank = ? WHERE id = ?', [
          loserNew,
          loserId,
        ]);
      }

      await conn.query(
        `INSERT INTO matches
          (match_date, location, score,
           winner_id, loser_id,
           winner_old_rank, winner_new_rank,
           loser_old_rank, loser_new_rank)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rawDate,
          rawLocation,
          score,
          winnerId,
          loserId,
          winnerOld,
          winnerNew,
          loserOld,
          loserNew,
        ]
      );

      await conn.commit();
      res.redirect('/ladder');
    } catch (err) {
      await conn.rollback();
      console.error(err);
      res
        .status(500)
        .send(
          'Error saving match. Please verify that players have a valid ladder rank and try again.'
        );
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Unexpected error while saving the match.');
  }
});

// ---------- MATCH LOG ----------
app.get('/matches', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         m.*,
         w.name AS winner_name,
         l.name AS loser_name
       FROM matches m
       JOIN players w ON m.winner_id = w.id
       JOIN players l ON m.loser_id = l.id
       ORDER BY m.match_date ASC, m.id ASC`
    );

    const htmlRows = rows
      .map((m, idx) => {
        let dateStr = '';
        if (m.match_date instanceof Date) {
          dateStr = m.match_date.toISOString().slice(0, 10);
        } else if (typeof m.match_date === 'string') {
          dateStr = m.match_date;
        }
        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${dateStr}</td>
            <td>${m.winner_name}</td>
            <td>${m.loser_name}</td>
            <td>${m.location || ''}</td>
            <td>${m.score || ''}</td>
            <td>${m.winner_old_rank}</td>
            <td>${m.winner_new_rank}</td>
            <td>${m.loser_old_rank}</td>
            <td>${m.loser_new_rank}</td>
          </tr>`;
      })
      .join('');

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
            --row-even: #f9fafb;
            --row-odd: #ffffff;
            --border-soft: #d1d5db;
          }
          body { margin: 0; font-family: Arial, sans-serif; background: #f3f4f6; }
          .site-header {
            background-image: url('/images/bg002.jpg');
            background-size: cover;
            background-position: center;
            padding: 16px 20px;
          }
          .header-inner {
            max-width: 960px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            gap: 16px;
          }
          .header-logo {
            width: 70px;
            height: auto;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.25);
          }
          .header-text-main h1 {
            margin: 0;
            font-size: 1.4rem;
            color: var(--hunter-green);
          }

          .main {
            max-width: 960px;
            margin: 20px auto;
            padding: 0 16px 24px;
          }

          .table-wrapper { width: 100%; overflow-x: auto; }
          table {
            border-collapse: collapse;
            width: 100%;
            min-width: 500px;
            background: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 10px rgba(0,0,0,0.05);
          }
          thead {
            background: var(--hunter-green);
            color: #ffffff;
          }
          th, td {
            border: 1px solid var(--border-soft);
            padding: 8px 10px;
            text-align: center;
            font-size: 0.9rem;
          }
          tbody tr:nth-child(odd) {
            background: var(--row-odd);
          }
          tbody tr:nth-child(even) {
            background: var(--row-even);
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
            <img src="/images/FTL01.png" alt="FTL logo" class="header-logo">
            <div class="header-text-main">
              <h1>Fayetteville Tennis Ladder</h1>
            </div>
          </div>
        </header>

        <main class="main">
          <h1>Match Log</h1>
          <p><a href="/">Back to Home</a> | <a href="/ladder">Ladder</a></p>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Match Date</th>
                  <th>Winner</th>
                  <th>Loser</th>
                  <th>Location</th>
                  <th>Score</th>
                  <th>Winner Old Rank</th>
                  <th>Winner New Rank</th>
                  <th>Loser Old Rank</th>
                  <th>Loser New Rank</th>
                </tr>
              </thead>
              <tbody>
              ${htmlRows}
              </tbody>
            </table>
          </div>

          <div class="signature">Created by RER</div>
        </main>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading match log.');
  }
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tennis ladder app running on http://localhost:${PORT}`);
});
