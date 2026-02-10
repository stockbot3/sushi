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

// Uploads
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
})});

// Firebase
const firebaseSA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (firebaseSA) {
  try {
    const sa = JSON.parse(firebaseSA);
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  } catch (e) { admin.initializeApp({ projectId: 'akan-2ed41' }); }
} else {
  admin.initializeApp({ projectId: 'akan-2ed41' });
}
const db = admin.firestore();

app.use(cors());
app.use(express.json());

// Auth
const adminTokens = new Set();
async function getAdmin() {
  const doc = await db.collection('config').doc('admin').get();
  return doc.exists ? doc.data() : null;
}
function requireAdmin(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!t || !adminTokens.has(t)) return res.status(401).json({ error: 'Auth required' });
  next();
}

app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  let adminData = await getAdmin();
  if (!adminData) {
    const hash = await bcrypt.hash(password, 10);
    await db.collection('config').doc('admin').set({ passwordHash: hash });
    adminData = { passwordHash: hash };
  }
  if (await bcrypt.compare(password, adminData.passwordHash)) {
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.add(token);
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid' });
});

app.get('/api/admin/verify', requireAdmin, (req, res) => res.json({ ok: true }));
app.post('/api/admin/upload', requireAdmin, upload.single('file'), (req, res) => res.json({ url: `/uploads/${req.file.filename}` }));

// Routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/:slug', async (req, res, next) => {
  const slug = req.params.slug.toLowerCase();
  if (['api', 'admin', 'uploads', 'lib', 'voice', 'commentary', 'avatars', 'avatar.html', 'index.html'].includes(slug)) return next();
  const snap = await db.collection('sessions').where('slug', '==', slug).limit(1).get();
  if (!snap.empty) return res.redirect(`/avatar.html?session=${snap.docs[0].id}`);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── TTS ───
const MODAL_PIPER_URL = 'https://mousears1090--sushi-piper-tts-tts.modal.run';
const ttsCache = new Map();

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).send();
    const key = `${voice || 'amy'}:${text.trim().toLowerCase()}`;
    if (ttsCache.has(key)) return res.json(ttsCache.get(key));

    const r = await fetch(MODAL_PIPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voice || 'amy' }),
    });
    const data = await r.json();
    if (!data.audio) throw new Error(data.error || 'Modal Error');
    const result = { audio: data.audio, format: 'wav' };
    if (ttsCache.size > 1000) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(key, result);
    res.json(result);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── DATA FETCHING ───
const cache = {};
async function fetchCached(key, url, ttl = 8000) {
  if (cache[key] && (Date.now() - cache[key].ts) < ttl) return cache[key].data;
  const res = await fetch(url); const data = await res.json();
  cache[key] = { data, ts: Date.now() };
  return data;
}

function parseScoreboard(data) {
  return (data.events || []).map(e => {
    const c = e.competitions[0], h = c.competitors.find(x => x.homeAway === 'home'), a = c.competitors.find(x => x.homeAway === 'away');
    return {
      id: e.id, name: e.name, status: c.status.type,
      home: { abbreviation: h.team.abbreviation, score: h.score, color: h.team.color ? `#${h.team.color}` : null },
      away: { abbreviation: a.team.abbreviation, score: a.score, color: a.team.color ? `#${a.team.color}` : null }
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

// ─── SESSION MANAGEMENT ───
const sessionRuntimes = new Map();
function getRuntime(id) {
  if (!sessionRuntimes.has(id)) sessionRuntimes.set(id, { lastSeq: -1, cache: null, ts: 0 });
  return sessionRuntimes.get(id);
}

app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  const s = await db.collection('sessions').get();
  res.json(s.docs.map(d => d.data()));
});

app.post('/api/admin/sessions', requireAdmin, async (req, res) => {
  const id = crypto.randomBytes(8).toString('hex');
  const session = { ...req.body, id, createdAt: new Date().toISOString() };
  await db.collection('sessions').doc(id).set(session);
  res.json(session);
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

app.get('/api/sessions', async (req, res) => {
  const s = await db.collection('sessions').where('status', '==', 'active').get();
  res.json(s.docs.map(d => d.data()));
});

app.get('/api/sessions/:id/game', async (req, res) => {
  const d = await db.collection('sessions').doc(req.params.id).get();
  if (!d.exists) return res.status(404).send();
  const s = d.data();
  const raw = await fetchCached(`sb_${s.espnSlug}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/scoreboard`);
  res.json(parseScoreboard(raw).find(x => x.id === s.espnEventId));
});

// ─── COMMENTARY ───
const MODAL_MISTRAL_URL = 'https://mousears1090--claudeapps-mistral-mistralmodel-chat.modal.run';

function strip(text, name) {
  return text.replace(/🗣️|🎙️|🔊/g, '')
             .replace(new RegExp(`^${name}[:\\s—-]+`, 'i'), '')
             .replace(/^["']|["']$/g, '')
             .replace(/\bSpeaking\b/gi, '')
             .trim();
}

app.get('/api/sessions/:id/commentary/latest', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const doc = await db.collection('sessions').doc(sessionId).get();
    if (!doc.exists) return res.status(404).send();
    const s = doc.data();
    const rt = getRuntime(sessionId);
    const now = Date.now();

    if (rt.cache && (now - rt.ts) < 5000) return res.json(rt.cache);

    const scoreData = await fetchCached(`sb_${s.espnSlug}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/scoreboard`);
    const game = parseScoreboard(scoreData).find(e => e.id === s.espnEventId);

    if (!game || game.status?.state !== 'in') {
      const interval = (s.settings?.preGameInterval || 45) * 1000;
      if (rt.cache && (now - rt.ts) < interval) return res.json(rt.cache);
      const prompt = `Argue about ${game?.name || 'the game'}. [A] ${s.commentators[0].name}, [B] ${s.commentators[1].name}. 3 turns: [A], [B], [A]. No names in lines.`;
      const r = await fetch(MODAL_MISTRAL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) });
      const json = await r.json();
      const turns = json.choices[0].message.content.split('\n').filter(l => l.includes('[A]') || l.includes('[B]')).map(l => {
        const isA = l.includes('[A]');
        const c = isA ? s.commentators[0] : s.commentators[1];
        return { speaker: isA ? 'A' : 'B', name: c.name, text: strip(l.replace(/^\[[AB]\]/, ''), c.name) };
      });
      rt.cache = { turns, status: 'pre', play: { description: 'Pre-game Banter', seq: now }, timestamp: now }; rt.ts = now;
      return res.json(rt.cache);
    }

    const summaryData = await fetchCached(`sum_${s.espnEventId}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/summary?event=${s.espnEventId}`);
    const summary = parseSummary(summaryData);
    const latestDrive = (summary.drives || []).slice(-1)[0];
    const latestPlay = (latestDrive?.playList || []).slice(-1)[0] || (summary.plays || []).slice(-1)[0];
    if (!latestPlay) return res.json({ turns: [] });

    const seq = (summary.drives?.length || 0) * 100 + (latestDrive?.playList?.length || summary.plays?.length || 0);
    if (seq === rt.lastSeq && (now - rt.ts) < 45000) return res.json(rt.cache);

    const prompt = `Live commentary for ${game.name}. Play: ${latestPlay.text}. [A] ${s.commentators[0].name}, [B] ${s.commentators[1].name}. 3 turns: [A], [B], [A]. No names.`;
    const r = await fetch(MODAL_MISTRAL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) });
    const json = await r.json();
    const turns = json.choices[0].message.content.split('\n').filter(l => l.includes('[A]') || l.includes('[B]')).map(l => {
      const isA = l.includes('[A]');
      const c = isA ? s.commentators[0] : s.commentators[1];
      return { speaker: isA ? 'A' : 'B', name: c.name, text: strip(l.replace(/^\[[AB]\]/, ''), c.name) };
    });

    rt.lastSeq = seq;
    rt.cache = { turns, status: 'live', play: { description: latestPlay.text, seq }, timestamp: now }; rt.ts = now;
    res.json(rt.cache);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Sushi on ${PORT}`));