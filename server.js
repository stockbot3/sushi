const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Uploads
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
})});

// Firebase
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  } catch (e) { admin.initializeApp({ projectId: 'akan-2ed41' }); }
} else {
  admin.initializeApp({ projectId: 'akan-2ed41' });
}
const db = admin.firestore();

app.use(cors());
app.use(express.json());

// ─── ADMIN AUTH ───
const adminTokens = new Set();
async function getAdmin() {
  const doc = await db.collection('config').doc('admin').get();
  return doc.exists ? doc.data() : null;
}
async function setAdminPassword(pw) {
  const hash = await bcrypt.hash(pw, 10);
  await db.collection('config').doc('admin').set({ passwordHash: hash });
}
function requireAdmin(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!t || !adminTokens.has(t)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  let data = await getAdmin();
  if (!data) { await setAdminPassword(password); data = { passwordHash: await bcrypt.hash(password, 10) }; }
  if (await bcrypt.compare(password, data.passwordHash)) {
    const t = crypto.randomBytes(32).toString('hex');
    adminTokens.add(t); return res.json({ token: t });
  }
  res.status(401).json({ error: 'Invalid' });
});

// ─── SPORTS CONFIG ───
const SPORTS_CONFIG = {
  football: { name: 'Football', leagues: { nfl: { name: 'NFL', espnSlug: 'football/nfl' }, 'college-football': { name: 'College Football', espnSlug: 'football/college-football' } } },
  basketball: { name: 'Basketball', leagues: { nba: { name: 'NBA', espnSlug: 'basketball/nba' }, ncaam: { name: 'NCAAM', espnSlug: 'basketball/mens-college-basketball' } } },
  baseball: { name: 'Baseball', leagues: { mlb: { name: 'MLB', espnSlug: 'baseball/mlb' } } },
  hockey: { name: 'Hockey', leagues: { nhl: { name: 'NHL', espnSlug: 'hockey/nhl' } } },
  soccer: { name: 'Soccer', leagues: { epl: { name: 'Premier League', espnSlug: 'soccer/eng.1' }, mls: { name: 'MLS', espnSlug: 'soccer/usa.1' } } },
};

// ─── CACHE ───
const fetchCache = {};
async function fetchCached(key, url, ttl = 8000) {
  if (fetchCache[key] && (Date.now() - fetchCache[key].ts) < ttl) return fetchCache[key].data;
  const res = await fetch(url);
  const data = await res.json();
  fetchCache[key] = { data, ts: Date.now() };
  return data;
}

// ─── API ROUTES ───
app.get('/api/admin/verify', requireAdmin, (req, res) => res.json({ ok: true }));
app.post('/api/admin/upload', requireAdmin, upload.single('file'), (req, res) => res.json({ url: `/uploads/${req.file.filename}` }));

app.get('/api/admin/sports', requireAdmin, (req, res) => {
  const out = {};
  for (const [k, v] of Object.entries(SPORTS_CONFIG)) {
    out[k] = { name: v.name, leagues: Object.entries(v.leagues).map(([lk, lv]) => ({ id: lk, name: lv.name })) };
  }
  res.json(out);
});

function parseScoreboard(data) {
  return (data.events || []).map(e => {
    const c = e.competitions[0], h = c.competitors.find(x => x.homeAway === 'home'), a = c.competitors.find(x => x.homeAway === 'away');
    return {
      id: e.id, name: e.name, shortName: e.shortName, date: e.date, status: c.status.type,
      home: { id: h.team.id, abbreviation: h.team.abbreviation, score: h.score, logo: h.team.logo, color: h.team.color ? `#${h.team.color}` : null },
      away: { id: a.team.id, abbreviation: a.team.abbreviation, score: a.score, logo: a.team.logo, color: a.team.color ? `#${a.team.color}` : null }
    };
  });
}

app.get('/api/admin/browse/:sport/:league', requireAdmin, async (req, res) => {
  try {
    const slug = SPORTS_CONFIG[req.params.sport].leagues[req.params.league].espnSlug;
    const date = req.query.date || '';
    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/scoreboard${date ? `?dates=${date}` : ''}`;
    const data = await fetchCached(`br_${slug}_${date}`, url, 30000);
    res.json({ events: parseScoreboard(data) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
    if (!data.audio) throw new Error('Modal Error');
    const result = { audio: data.audio, format: 'wav' };
    if (ttsCache.size > 1000) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(key, result);
    res.json(result);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── SESSION ADMIN ───
app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  const s = await db.collection('sessions').get();
  res.json(s.docs.map(d => d.data()));
});

app.post('/api/admin/sessions', requireAdmin, async (req, res) => {
  const id = crypto.randomBytes(8).toString('hex');
  const session = { 
    ...req.body, 
    id, 
    status: 'active',
    commentators: req.body.commentators || [
      { id: 'A', name: 'Sakura', voice: 'amy', avatarUrl: null }, 
      { id: 'B', name: 'Steve', voice: 'bryce', avatarUrl: null }
    ],
    createdAt: new Date().toISOString() 
  };
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
  res.json({ ok: true });
});

// ─── PUBLIC API ───
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

// ─── COMMENTARY ENGINE ───
const MODAL_MISTRAL_URL = 'https://mousears1090--claudeapps-mistral-mistralmodel-chat.modal.run';
const sessionRuntimes = new Map();
function getRuntime(id) {
  if (!sessionRuntimes.has(id)) sessionRuntimes.set(id, { lastSeq: -1, cache: null, ts: 0 });
  return sessionRuntimes.get(id);
}

function strip(text, name) {
  if (!text) return "";
  let cleaned = text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // Emojis
    .replace(/^\[[AB]\][:\s—-]*/i, '') // [A] or [B] prefix
    .replace(new RegExp(`^${name}[:\\s—-]+`, 'i'), '') // Specific commentator name prefix
    .replace(/^[a-z\s]+[:\\s—-]+/i, (match) => {
       const prefix = match.split(':')[0].trim().toLowerCase();
       if (prefix.length < 20) return ""; 
       return match;
    })
    .replace(/^["']|["']$/g, '') // Surrounding quotes
    .replace(/\bSpeaking\b/gi, '') // The word "Speaking"
    .trim();
  
  if (name && cleaned.toLowerCase().startsWith(name.toLowerCase())) {
    cleaned = cleaned.substring(name.length).replace(/^[:\s—-]+/, '').trim();
  }
  return cleaned;
}

app.get('/api/sessions/:id/commentary/latest', async (req, res) => {
  try {
    const doc = await db.collection('sessions').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send();
    const s = doc.data();
    const rt = getRuntime(s.id);
    const now = Date.now();

    if (rt.cache && (now - rt.ts) < 5000) return res.json(rt.cache);

    const interval = (s.settings?.preGameInterval || 45) * 1000;
    if (rt.cache && (now - rt.ts) < interval) return res.json(rt.cache);

    const prompt = `Argue unhinged about ${s.gameName}. [A] ${s.commentators[0].name}, [B] ${s.commentators[1].name}. 3 turns: [A], [B], [A]. NO NAMES. NO EMOJIS. ONLY THE LINES.`;
    const r = await fetch(MODAL_MISTRAL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) });
    const json = await r.json();
    const raw = json.choices[0].message.content;
    
    const turns = raw.split('\n').filter(l => l.includes('[A]') || l.includes('[B]')).map(l => {
      const isA = l.includes('[A]');
      const c = isA ? s.commentators[0] : s.commentators[1];
      return { speaker: isA ? 'A' : 'B', name: c.name, text: strip(l, c.name) };
    });

    rt.cache = { turns, status: 'live', timestamp: now };
    rt.ts = now;
    res.json(rt.cache);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── STATIC & SLUGS ───

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/:slug', async (req, res, next) => {
  const slug = req.params.slug.toLowerCase();
  if (['api', 'admin', 'uploads', 'lib', 'voice', 'commentary', 'avatars', 'avatar.html', 'index.html'].includes(slug)) return next();
  const snap = await db.collection('sessions').where('slug', '==', slug).limit(1).get();
  if (!snap.empty) return res.redirect(`/avatar.html?session=${snap.docs[0].id}`);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Sushi on ${PORT}`));
