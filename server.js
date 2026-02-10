const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3007;

// Ensure upload dir exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});
const upload = multer({ storage });

// ─── FIREBASE INIT ───
let firebaseConfig = { projectId: 'akan-2ed41' };
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'akan-2ed41' });
  } catch (e) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT, using default:', e.message);
    admin.initializeApp(firebaseConfig);
  }
} else {
  admin.initializeApp(firebaseConfig);
}
const db = admin.firestore();

// ─── MODAL LLM ENDPOINT ───
const MODAL_MISTRAL_URL = process.env.MODAL_MISTRAL_URL || 'https://mousears1090--claudeapps-mistral-mistralmodel-chat.modal.run';

async function callModalLLM(url, body, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: controller.signal,
    });
    if (res.ok) { clearTimeout(timer); return await res.json(); }
    if (res.status === 303) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Modal 303 without Location header');
      let pollUrl = location;
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const poll = await fetch(pollUrl, { redirect: 'manual', signal: controller.signal });
          if (poll.status === 303) { const nl = poll.headers.get('location'); if (nl) pollUrl = nl; continue; }
          if (poll.status === 202) continue;
          if (poll.ok) {
            clearTimeout(timer);
            const ct = poll.headers.get('content-type') || '';
            if (ct.includes('json')) return await poll.json();
            const txt = await poll.text();
            try { return JSON.parse(txt); } catch { return { choices: [{ message: { role: 'assistant', content: txt } }] }; }
          }
        } catch (pollErr) { if (pollErr.name === 'AbortError') throw pollErr; }
      }
      throw new Error('Modal LLM timed out');
    }
    const errBody = await res.text();
    throw new Error(`Modal returned ${res.status}: ${errBody.slice(0, 300)}`);
  } finally { clearTimeout(timer); }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── ADMIN AUTH ───
const adminTokens = new Set();
async function getAdminDoc() {
  const doc = await db.collection('config').doc('admin').get();
  return doc.exists ? doc.data() : null;
}
async function setAdminPassword(password) {
  const hash = await bcrypt.hash(password, 10);
  await db.collection('config').doc('admin').set({ passwordHash: hash, updatedAt: new Date().toISOString() });
  return hash;
}
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || !adminTokens.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    let adminData = await getAdminDoc();
    if (!adminData) {
      await setAdminPassword(process.env.ADMIN_PASSWORD || password);
      adminData = await getAdminDoc();
    }
    const valid = await bcrypt.compare(password, adminData.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.add(token);
    res.json({ token });
  } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/admin/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.get('/api/admin/verify', requireAdmin, (req, res) => res.json({ ok: true }));

// ─── SPORT CONFIG ───
const SPORTS_CONFIG = {
  football: { name: 'Football', leagues: { nfl: { name: 'NFL', espnSlug: 'football/nfl' }, 'college-football': { name: 'College Football', espnSlug: 'football/college-football' } } },
  basketball: { name: 'Basketball', leagues: { nba: { name: 'NBA', espnSlug: 'basketball/nba' }, ncaam: { name: 'NCAAM', espnSlug: 'basketball/mens-college-basketball' } } },
  baseball: { name: 'Baseball', leagues: { mlb: { name: 'MLB', espnSlug: 'baseball/mlb' } } },
  hockey: { name: 'Hockey', leagues: { nhl: { name: 'NHL', espnSlug: 'hockey/nhl' } } },
  soccer: { name: 'Soccer', leagues: { epl: { name: 'Premier League', espnSlug: 'soccer/eng.1' }, mls: { name: 'MLS', espnSlug: 'soccer/usa.1' } } },
};

// ─── PARAMETERIZED ESPN URLS ───
function espnScoreboard(slug, date) { let url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/scoreboard`; if (date) url += `?dates=${date}`; return url; }
function espnSummary(slug, eventId) { return `https://site.api.espn.com/apis/site/v2/sports/${slug}/summary?event=${eventId}`; }
function espnRoster(slug, teamId) { return `https://site.api.espn.com/apis/site/v2/sports/${slug}/teams/${teamId}/roster`; }
function espnNews(slug) { return `https://site.api.espn.com/apis/site/v2/sports/${slug}/news?limit=15`; }

// ─── CACHE ───
const cache = {};
const ttsCache = new Map();
const CACHE_TTL = { scoreboard: 8000, summary: 8000, roster: 300000, news: 120000 };

async function fetchCached(key, url, ttl) {
  const now = Date.now();
  if (cache[key] && (now - cache[key].ts) < ttl) return cache[key].data;
  const res = await fetch(url);
  const data = await res.json();
  cache[key] = { data, ts: now };
  return data;
}

// ─── PIPER TTS ───
const MODAL_PIPER_URL = 'https://mousears1090--sushi-piper-tts-tts.modal.run';
app.post('/api/tts', async (req, res) => {
  try {
    const text = req.body.text || req.query.text;
    if (!text) return res.status(400).json({ error: 'text required' });
    const cacheKey = text.trim().toLowerCase();
    if (ttsCache.has(cacheKey)) return res.json(ttsCache.get(cacheKey));

    const response = await fetch(MODAL_PIPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`Modal Error: ${response.status}`);
    const data = await response.json();
    const result = { audio: data.audio, format: 'wav' };
    if (ttsCache.size > 200) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(cacheKey, result);
    res.json(result);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── PERSONALITY PRESETS ───
const PERSONALITY_PRESETS = {
  barkley: { name: 'Sir Charles', prompt: 'Loud, bold, analogical, confident.' },
  skip: { name: 'Hot Take Skip', prompt: 'Ultimate contrarian, conspiracy theories.' },
  snoop: { name: 'Uncle Snoop', prompt: 'Laid-back West Coast style, music metaphors.' },
  romo: { name: 'Stats Guru Tony', prompt: 'Analytical play predictor, excitable.' },
};

// ─── PARSE HELPERS ───
function parseScoreboard(data) {
  return (data.events || []).map(event => {
    const comp = event.competitions?.[0] || {};
    const homeComp = comp.competitors?.find(c => c.homeAway === 'home') || {};
    const awayComp = comp.competitors?.find(c => c.homeAway === 'away') || {};
    return {
      id: event.id, name: event.name, date: event.date,
      status: { state: comp.status?.type?.state, detail: comp.status?.type?.detail, clock: comp.status?.displayClock, period: comp.status?.period },
      home: { id: homeComp.team?.id, abbreviation: homeComp.team?.abbreviation, score: parseInt(homeComp.score) || 0, color: homeComp.team?.color ? `#${homeComp.team.color}` : null },
      away: { id: awayComp.team?.id, abbreviation: awayComp.team?.abbreviation, score: parseInt(awayComp.score) || 0, color: awayComp.team?.color ? `#${awayComp.team.color}` : null },
    };
  });
}

function parseSummary(data) {
  const drives = data.drives || {};
  const boxscore = data.boxscore || {};
  const allDrives = (drives.previous || []).map(d => ({
    team: d.team?.abbreviation, yards: d.yards,
    playList: (d.plays || []).map(p => ({ text: p.text, type: p.type?.text }))
  }));
  let plays = (data.plays || data.keyEvents || []).map(p => ({ text: p.text, type: p.type?.text || p.type, team: p.team?.abbreviation }));
  return { teamStats: boxscore.teams, drives: allDrives, plays };
}

function parseRoster(data) {
  const roster = [];
  (data.athletes || []).forEach(group => { (group.items || []).forEach(p => { roster.push({ name: p.displayName, jersey: p.jersey, position: p.position?.abbreviation }); }); });
  return { roster };
}

// ─── SESSION RUNTIME ───
const sessionRuntimes = new Map();
function getRuntime(sessionId) {
  if (!sessionRuntimes.has(sessionId)) sessionRuntimes.set(sessionId, { lastCommentarySeq: -1, commentaryCache: { data: null, ts: 0 }, commentaryHistory: [], rosterCache: { home: null, away: null, fetchedAt: 0 } });
  return sessionRuntimes.get(sessionId);
}

// ─── ADMIN SESSION ROUTES ───
app.get('/api/admin/sports', requireAdmin, (req, res) => {
  const result = {};
  for (const [k, v] of Object.entries(SPORTS_CONFIG)) result[k] = { name: v.name, leagues: Object.entries(v.leagues).map(([lk, lv]) => ({ id: lk, name: lv.name })) };
  res.json(result);
});

app.get('/api/admin/browse/:sport/:league', requireAdmin, async (req, res) => {
  try {
    const slug = SPORTS_CONFIG[req.params.sport].leagues[req.params.league].espnSlug;
    const data = await fetchCached(`br_${req.params.league}`, espnScoreboard(slug, req.query.date), 30000);
    res.json({ events: parseScoreboard(data) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/presets', requireAdmin, async (req, res) => {
  const snap = await db.collection('commentator_presets').get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.post('/api/admin/presets', requireAdmin, async (req, res) => {
  const id = crypto.randomBytes(6).toString('hex');
  const preset = { ...req.body, createdAt: new Date().toISOString() };
  await db.collection('commentator_presets').doc(id).set(preset);
  res.json({ id, ...preset });
});

app.delete('/api/admin/presets/:id', requireAdmin, async (req, res) => {
  await db.collection('commentator_presets').doc(req.params.id).delete();
  res.json({ ok: true });
});

app.post('/api/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const { sport, league, espnEventId, gameName, commentators, settings } = req.body;
    const slug = SPORTS_CONFIG[sport].leagues[league].espnSlug;
    const id = crypto.randomBytes(8).toString('hex');
    const session = {
      id, sport, league, espnSlug: slug, espnEventId, gameName, status: 'active',
      commentators: commentators || [{ id: 'A', name: 'Big Mike', team: 'away', personality: 'barkley' }, { id: 'B', name: 'Salty Steve', team: 'home', personality: 'skip' }],
      settings: { preGameInterval: settings?.preGameInterval || 45 },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await db.collection('sessions').doc(id).set(session);
    res.json(session);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  const snap = await db.collection('sessions').get();
  res.json(snap.docs.map(d => d.data()));
});

app.patch('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  await db.collection('sessions').doc(req.params.id).update({ ...req.body, updatedAt: new Date().toISOString() });
  const doc = await db.collection('sessions').doc(req.params.id).get();
  res.json(doc.data());
});

app.delete('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  await db.collection('sessions').doc(req.params.id).delete();
  sessionRuntimes.delete(req.params.id); res.json({ ok: true });
});

app.post('/api/admin/sessions/:id/start', requireAdmin, async (req, res) => {
  await db.collection('sessions').doc(req.params.id).update({ status: 'active' });
  res.json({ ok: true });
});

app.post('/api/admin/sessions/:id/stop', requireAdmin, async (req, res) => {
  await db.collection('sessions').doc(req.params.id).update({ status: 'paused' });
  res.json({ ok: true });
});

// ─── PUBLIC SESSION ROUTES ───
app.get('/api/sessions', async (req, res) => {
  const snap = await db.collection('sessions').where('status', 'in', ['active', 'paused']).get();
  res.json(snap.docs.map(d => d.data()));
});

app.get('/api/sessions/:id/game', async (req, res) => {
  const doc = await db.collection('sessions').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).send();
  const s = doc.data();
  const data = await fetchCached(`sb_${s.espnSlug}`, espnScoreboard(s.espnSlug), 8000);
  const game = parseScoreboard(data).find(e => e.id === s.espnEventId);
  res.json(game || { error: 'not found' });
});

// ─── COMMENTARY ENGINE ───
const COMMENTARY_COOLDOWN = 5000;
const STALE_COMMENTARY_MAX = 45000;
const MAX_HISTORY = 20;

function buildCommentaryPayload(game, summary, session) {
  if (!game || !summary) return null;
  const awayAbbr = game.away.abbreviation, homeAbbr = game.home.abbreviation;
  const sport = session.sport;
  let latestPlays = [], latestPlay = null, offenseTeam = awayAbbr;
  if (sport === 'football') {
    const latestDrive = (summary.drives || []).slice(-1)[0];
    latestPlays = latestDrive?.playList || [];
    latestPlay = latestPlays.slice(-1)[0];
    offenseTeam = latestDrive?.team || awayAbbr;
  } else {
    latestPlays = (summary.plays || []).slice(-10);
    latestPlay = latestPlays.slice(-1)[0];
    offenseTeam = latestPlay?.team || awayAbbr;
  }
  if (!latestPlay) return null;
  return {
    event: { seq: latestPlays.length + (sport === 'football' ? (summary.drives?.length || 0) * 100 : 0), quarter: latestPlay.period || 1, clock: latestPlay.clock || '', description: latestPlay.text || '', result: latestPlay.type || 'Play' },
    state: { score: { [awayAbbr]: game.away.score, [homeAbbr]: game.home.score } },
    awayTeam: game.away, homeTeam: game.home, offenseTeam
  };
}

function buildCommentaryPrompt(payload, session) {
  const cA = session.commentators[0], cB = session.commentators[1];
  return `Live ${session.sport} commentary.
[A] ${cA.name}: ${PERSONALITY_PRESETS[cA.personality]?.prompt || ''}
[B] ${cB.name}: ${PERSONALITY_PRESETS[cB.personality]?.prompt || ''}
Play: ${payload.event.description}
Score: ${JSON.stringify(payload.state.score)}
Produce 3 turns: [A], [B], [A]. Argue unhinged. No names in lines.`;
}

function buildPreGamePrompt(payload, game, session) {
  return `Pre-game hype for ${payload.awayTeam.abbreviation} vs ${payload.homeTeam.abbreviation}. 3 turns: [A], [B], [A]. unhinged banter.`;
}

function parseCommentary(raw, cA, cB) {
  const lines = raw.trim().split('\n').filter(l => l.trim());
  const turns = [];
  let current = null;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('[A]') || t.startsWith('[B]')) {
      if (current) turns.push(current);
      const isA = t.startsWith('[A]');
      const c = isA ? cA : cB;
      let text = t.replace(/^\[[AB]\]\s*/, '').trim();
      text = text.replace(new RegExp(`^${c.name}[:\\s—]+`, 'i'), '').replace(/^["']|["']$/g, '').trim();
      current = { speaker: isA ? 'A' : 'B', name: c.name, text };
    } else if (current) {
      current.text += ' ' + t.replace(/^["']|["']$/g, '').trim();
    }
  }
  if (current) turns.push(current);
  return turns;
}

app.get('/api/sessions/:id/commentary/latest', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const doc = await db.collection('sessions').doc(sessionId).get();
    if (!doc.exists) return res.status(404).send();
    const session = doc.data();
    if (session.status === 'paused') return res.json({ turns: [] });

    const runtime = getRuntime(sessionId);
    const now = Date.now();

    if (runtime.commentaryCache.data && (now - runtime.commentaryCache.ts) < COMMENTARY_COOLDOWN) return res.json(runtime.commentaryCache.data);

    const scoreData = await fetchCached(`sb_${session.espnSlug}`, espnScoreboard(session.espnSlug), 8000);
    const game = parseScoreboard(scoreData).find(e => e.id === session.espnEventId);

    if (!game || game.status?.state !== 'in') {
      const interval = (session.settings?.preGameInterval || 45) * 1000;
      if (runtime.commentaryCache.data && (now - runtime.commentaryCache.ts) < interval) return res.json(runtime.commentaryCache.data);
      const prePayload = { awayTeam: game?.away || { abbreviation: 'AWY' }, homeTeam: game?.home || { abbreviation: 'HME' } };
      const llmData = await callModalLLM(MODAL_MISTRAL_URL, { messages: [{ role: 'user', content: buildPreGamePrompt(prePayload, game, session) }], max_tokens: 300 });
      const turns = parseCommentary(llmData.choices[0].message.content, session.commentators[0], session.commentators[1]);
      const result = { turns, status: 'pre', play: { description: 'Pre-game Discussion', seq: now }, timestamp: now, commentators: { a: session.commentators[0], b: session.commentators[1] } };
      runtime.commentaryCache = { data: result, ts: now }; return res.json(result);
    }

    const summaryData = await fetchCached(`sum_${session.espnEventId}`, espnSummary(session.espnSlug, session.espnEventId), 8000);
    const summary = parseSummary(summaryData);
    const payload = buildCommentaryPayload(game, summary, session);
    if (!payload) return res.json({ turns: [] });

    if (payload.event.seq === runtime.lastCommentarySeq && (now - runtime.commentaryCache.ts) < STALE_COMMENTARY_MAX) return res.json(runtime.commentaryCache.data);

    const llmData = await callModalLLM(MODAL_MISTRAL_URL, { messages: [{ role: 'user', content: buildCommentaryPrompt(payload, session) }], max_tokens: 250 });
    const turns = parseCommentary(llmData.choices[0].message.content, session.commentators[0], session.commentators[1]);
    runtime.lastCommentarySeq = payload.event.seq;
    const result = { turns, status: 'live', play: payload.event, score: payload.state.score, timestamp: now, commentators: { a: session.commentators[0], b: session.commentators[1] } };
    runtime.commentaryCache = { data: result, ts: now };
    runtime.commentaryHistory.unshift(result); if (runtime.commentaryHistory.length > MAX_HISTORY) runtime.commentaryHistory.pop();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Sushi on ${PORT}`));
