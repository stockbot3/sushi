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

// ─── DIRECTORIES ───
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ─── FIREBASE ───
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: FIREBASE_PROJECT_ID || sa.project_id,
      storageBucket: STORAGE_BUCKET || sa.storageBucket
    });
  } catch (e) { admin.initializeApp({ projectId: 'akan-2ed41' }); }
} else {
  admin.initializeApp({ projectId: FIREBASE_PROJECT_ID || 'akan-2ed41', storageBucket: STORAGE_BUCKET });
}
const db = admin.firestore();

app.use(cors());
app.use(express.json());

// ─── AUTH ───
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
  try {
    const { password } = req.body;
    let data = await getAdmin();
    if (!data) { await setAdminPassword(password); data = { passwordHash: await bcrypt.hash(password, 10) }; }
    if (await bcrypt.compare(password, data.passwordHash)) {
      const t = crypto.randomBytes(32).toString('hex');
      adminTokens.add(t); return res.json({ token: t });
    }
    res.status(401).json({ error: 'Invalid' });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
});

// ─── PRESETS ───
app.get('/api/admin/presets', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('commentator_presets').orderBy('createdAt', 'desc').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error('List presets error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
});

app.post('/api/admin/presets', requireAdmin, async (req, res) => {
  try {
    const payload = { ...req.body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const ref = await db.collection('commentator_presets').add(payload);
    const doc = await ref.get();
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('Create preset error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
});

app.patch('/api/admin/presets/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('commentator_presets').doc(req.params.id).update({ ...req.body, updatedAt: new Date().toISOString() });
    const doc = await db.collection('commentator_presets').doc(req.params.id).get();
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('Update preset error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
});

app.delete('/api/admin/presets/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('commentator_presets').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete preset error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
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

// ─── PARSE HELPERS ───
function parseScoreboard(data) {
  return (data.events || []).map(e => {
    const c = e.competitions[0], h = c.competitors.find(x => x.homeAway === 'home'), a = c.competitors.find(x => x.homeAway === 'away');
    const odds = (c.odds && c.odds[0]) || null;
    return {
      id: e.id, name: e.name, shortName: e.shortName, date: e.date, status: c.status.type,
      home: { id: h.team.id, name: h.team.displayName, abbreviation: h.team.abbreviation, score: h.score, logo: h.team.logo, color: h.team.color ? `#${h.team.color}` : null },
      away: { id: a.team.id, name: a.team.displayName, abbreviation: a.team.abbreviation, score: a.score, logo: a.team.logo, color: a.team.color ? `#${a.team.color}` : null },
      odds: odds ? {
        provider: odds.provider?.name || odds.provider?.id || null,
        spread: odds.details || odds.spread || null,
        overUnder: odds.overUnder || null
      } : null
    };
  });
}

function parseSummary(data) {
  const drives = data.drives || {};
  const boxscore = data.boxscore || {};
  const allDrives = (drives.previous || []).map(d => ({
    team: d.team?.abbreviation, yards: d.yards, result: d.displayResult,
    playList: (d.plays || []).map(p => ({ text: p.text, type: p.type?.text }))
  }));
  const plays = (data.plays || data.keyEvents || []).map(p => ({ text: p.text, type: p.type?.text || p.type, team: p.team?.abbreviation }));
  const odds = data.odds || data.game?.odds || [];
  return { teamStats: boxscore.teams || [], playerStats: boxscore.players || [], drives: allDrives, plays, odds, news: (data.news?.articles || []).slice(0, 5) };
}

// ─── ADMIN ROUTES ───
app.get('/api/admin/verify', requireAdmin, (req, res) => res.json({ ok: true }));
app.post('/api/admin/upload', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const bucket = admin.storage().bucket();
    if (!bucket?.name) return res.status(500).json({ error: 'Storage bucket not configured' });

    const safeName = `${Date.now()}-${req.file.originalname}`;
    const filePath = `uploads/${safeName}`;
    const file = bucket.file(filePath);
    await file.save(req.file.buffer, {
      contentType: req.file.mimetype,
      resumable: false,
      metadata: { cacheControl: 'public, max-age=31536000' }
    });

    // Serve via same-origin proxy to avoid CORS issues
    res.json({ url: `/api/uploads/${safeName}` });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/uploads/:name', async (req, res) => {
  try {
    const bucket = admin.storage().bucket();
    if (!bucket?.name) return res.status(500).json({ error: 'Storage bucket not configured' });
    const filePath = `uploads/${req.params.name}`;
    const file = bucket.file(filePath);
    const [meta] = await file.getMetadata();
    res.setHeader('Content-Type', meta?.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    file.createReadStream()
      .on('error', (err) => {
        console.error('Proxy download error:', err);
        res.status(404).end();
      })
      .pipe(res);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy failed' });
  }
});
app.get('/api/admin/sports', requireAdmin, (req, res) => res.json(SPORTS_CONFIG));

app.get('/api/admin/browse/:sport/:league', requireAdmin, async (req, res) => {
  try {
    const slug = SPORTS_CONFIG[req.params.sport].leagues[req.params.league].espnSlug;
    const date = req.query.date || '';
    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/scoreboard${date ? `?dates=${date}` : ''}`;
    const data = await fetchCached(`br_${slug}_${date}`, url, 30000);
    res.json({ events: parseScoreboard(data) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const s = await db.collection('sessions').get();
    res.json(s.docs.map(d => d.data()));
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
});

app.post('/api/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const id = crypto.randomBytes(8).toString('hex');
    const session = {
      ...req.body, id, status: 'active',
      commentators: req.body.commentators || [
        { id: 'A', name: 'Sakura', voice: 'rachel', avatarUrl: null },
        { id: 'B', name: 'Steve', voice: 'adam', avatarUrl: null }
      ],
      createdAt: new Date().toISOString()
    };
    await db.collection('sessions').doc(id).set(session);
    res.json(session);
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
});

app.patch('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('sessions').doc(req.params.id).update({ ...req.body, updatedAt: new Date().toISOString() });
    const doc = await db.collection('sessions').doc(req.params.id).get();
    res.json(doc.data());
  } catch (err) {
    console.error('Update session error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
});

app.delete('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('sessions').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete session error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
});

// ─── PUBLIC API ───
app.get('/api/sessions', async (req, res) => {
  try {
    const s = await db.collection('sessions').where('status', '==', 'active').get();
    const sessions = s.docs.map(d => d.data());
    const enriched = await Promise.all(sessions.map(async (sess) => {
      if (sess.homeTeam?.logo && sess.awayTeam?.logo) return sess;
      if (!sess.espnSlug || !sess.espnEventId) return sess;
      try {
        const raw = await fetchCached(`sb_${sess.espnSlug}`, `https://site.api.espn.com/apis/site/v2/sports/${sess.espnSlug}/scoreboard`);
        const game = parseScoreboard(raw).find(x => x.id === sess.espnEventId);
        if (!game) return sess;
        return { ...sess, homeTeam: game.home, awayTeam: game.away };
      } catch (e) { return sess; }
    }));
    res.json(enriched);
  } catch (err) {
    console.error('List public sessions error:', err);
    res.status(500).json({ error: 'Firestore not ready' });
  }
});

app.get('/api/sessions/:id/game', async (req, res) => {
  try {
    const d = await db.collection('sessions').doc(req.params.id).get();
    if (!d.exists) return res.status(404).send();
    const s = d.data();
    const raw = await fetchCached(`sb_${s.espnSlug}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/scoreboard`);
    const game = parseScoreboard(raw).find(x => x.id === s.espnEventId);
    res.json(game || { error: 'not found' });
  } catch (e) { res.status(500).send(); }
});

app.get('/api/sessions/:id/summary', async (req, res) => {
  try {
    const d = await db.collection('sessions').doc(req.params.id).get();
    if (!d.exists) return res.status(404).send();
    const s = d.data();
    const raw = await fetchCached(`sum_${s.id}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/summary?event=${s.espnEventId}`);
    res.json(parseSummary(raw));
  } catch (e) { res.status(500).send(); }
});

app.get('/api/sessions/:id/news', async (req, res) => {
  try {
    const d = await db.collection('sessions').doc(req.params.id).get();
    if (!d.exists) return res.status(404).send();
    const s = d.data();
    const raw = await fetchCached(`news_${s.espnSlug}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/news`);
    res.json(raw.articles || []);
  } catch (e) { res.status(500).send(); }
});

// ─── TTS ───
const MODAL_PIPER_URL = 'https://mousears1090--sushi-piper-tts-tts.modal.run';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ttsCache = new Map();

// ElevenLabs voice options
const ELEVENLABS_VOICES = {
  // MALE VOICES
  adam: { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Deep, Middle-aged)' },
  antoni: { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Young, Energetic)' },
  arnold: { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold (Strong, Crisp)' },
  callum: { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum (Hoarse, Masculine)' },
  charlie: { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie (Casual, Australian)' },
  clyde: { id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde (War Veteran, Raspy)' },
  daniel: { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel (Deep, Authoritative)' },
  george: { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George (British, Warm)' },
  joseph: { id: 'Zlb1dXrM653N07WRdFW3', name: 'Joseph (Mature, Articulate)' },
  josh: { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh (Young, Expressive)' },
  michael: { id: 'flq6f7yk4E4fJM5XTYuZ', name: 'Michael (Smooth, Professional)' },
  thomas: { id: 'GBv7mTt0atIp3Br8iCZE', name: 'Thomas (Calm, British)' },

  // FEMALE VOICES
  rachel: { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Calm, Young)' },
  domi: { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (Strong, Confident)' },
  bella: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Soft, American)' },
  elli: { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (Emotional, Expressive)' },
  emily: { id: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily (Calm, American)' },
  freya: { id: 'jsCqWAovK2LkecY7zXl4', name: 'Freya (Young, American)' },
  grace: { id: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace (Southern, Smooth)' },
  nicole: { id: 'piTKgcLEGmPE4e6mEKli', name: 'Nicole (Whisper, Expressive)' },
  sarah: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Soft, News Anchor)' },

  // PIPER FALLBACK
  amy: { id: 'piper-amy', name: 'Amy (Piper - Female)' },
  bryce: { id: 'piper-bryce', name: 'Bryce (Piper - Male)' }
};

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).send();

    const voiceKey = voice || 'adam';
    const key = `${voiceKey}:${text.trim().toLowerCase().substring(0, 100)}`;

    if (ttsCache.has(key)) return res.json(ttsCache.get(key));

    // Check if using ElevenLabs voice
    const voiceConfig = ELEVENLABS_VOICES[voiceKey];
    const isElevenLabs = voiceConfig && !voiceConfig.id.startsWith('piper-');

    if (isElevenLabs && ELEVENLABS_API_KEY) {
      // Use ElevenLabs
      try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceConfig.id}`, {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true
            }
          })
        });

        if (!response.ok) {
          console.error('ElevenLabs error:', response.status);
          throw new Error('ElevenLabs API error');
        }

        const audioBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        const result = { audio: base64Audio, format: 'mp3', provider: 'elevenlabs' };
        if (ttsCache.size > 1000) ttsCache.delete(ttsCache.keys().next().value);
        ttsCache.set(key, result);
        return res.json(result);
      } catch (elevenErr) {
        console.error('ElevenLabs failed, falling back to Piper:', elevenErr.message);
      }
    }

    // Fallback to Piper - Piper only supports 'amy' and 'bryce'
    // Map ElevenLabs voices to Piper equivalents
    const piperVoiceMap = {
      // Female voices -> amy
      rachel: 'amy', domi: 'amy', bella: 'amy', elli: 'amy', emily: 'amy',
      freya: 'amy', grace: 'amy', nicole: 'amy', sarah: 'amy', amy: 'amy',
      // Male voices -> bryce
      adam: 'bryce', antoni: 'bryce', arnold: 'bryce', callum: 'bryce',
      charlie: 'bryce', clyde: 'bryce', daniel: 'bryce', george: 'bryce',
      joseph: 'bryce', josh: 'bryce', michael: 'bryce', thomas: 'bryce', bryce: 'bryce'
    };
    const piperVoice = piperVoiceMap[voiceKey] || 'bryce';

    console.log(`[TTS] Using Piper fallback: ${voiceKey} -> ${piperVoice}`);

    const r = await fetch(MODAL_PIPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: piperVoice })
    });
    const data = await r.json();
    if (!data.audio) throw new Error('Modal Error');

    const result = { audio: data.audio, format: 'wav', provider: 'piper' };
    if (ttsCache.size > 1000) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(key, result);
    res.json(result);
  } catch (err) {
    console.error('TTS error:', err);
    res.status(502).json({ error: err.message });
  }
});

// Get available voices
app.get('/api/voices', (req, res) => {
  res.json({
    male: Object.entries(ELEVENLABS_VOICES)
      .filter(([k]) => ['adam', 'antoni', 'arnold', 'callum', 'charlie', 'clyde', 'daniel', 'george', 'joseph', 'josh', 'michael', 'thomas', 'bryce'].includes(k))
      .map(([k, v]) => ({ id: k, ...v })),
    female: Object.entries(ELEVENLABS_VOICES)
      .filter(([k]) => ['rachel', 'domi', 'bella', 'elli', 'emily', 'freya', 'grace', 'nicole', 'sarah', 'amy'].includes(k))
      .map(([k, v]) => ({ id: k, ...v }))
  });
});

// ─── COMMENTARY ENGINE ───
const MODAL_MISTRAL_URL = 'https://mousears1090--claudeapps-mistral-mistralmodel-chat.modal.run';
const sessionRuntimes = new Map();
function getRuntime(id) {
  if (!sessionRuntimes.has(id)) sessionRuntimes.set(id, { lastSeq: -1, lastPlayKey: null, lastScoreKey: null, cache: null, ts: 0 });
  return sessionRuntimes.get(id);
}

function escapeRegExp(input) {
  return input ? input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
}

function strip(text, name, otherName) {
  if (!text) return "";
  const nameRe = name ? new RegExp(`^\\s*${escapeRegExp(name)}\\s*(\\([^)]*\\))?\\s*[:\\-—–]*\\s*`, 'i') : null;
  const otherRe = otherName ? new RegExp(`^\\s*${escapeRegExp(otherName)}\\s*(\\([^)]*\\))?\\s*[:\\-—–]*\\s*`, 'i') : null;
  let cleaned = text
    // Remove numbered / bullet list prefixes like "1. ", "2) ", "- "
    .replace(/^\s*(?:\d+[\).\]]|[-•])\s*/i, '')
    .replace(/(^|\n)\s*(?:\d+[\).\]]|[-•])\s*/g, '$1')
    // Remove lone speaker letters or labels on their own lines
    .replace(/(^|\n)\s*[AB]\s*(?=\n|$)/gi, '$1')
    // Remove stage directions like "(Doubting):", "[Smiling]" and short labels like "Doubting:"
    .replace(/^\s*[\(\[][^)\]]+[\)\]]\s*:?\s*/g, '')
    .replace(/^\s*[A-Za-z][\w\s-]{0,20}\s*:\s*/g, (m) => {
      const w = m.replace(':', '').trim();
      if (w.length <= 20) return '';
      return m;
    })
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/^\[[AB]\][:\s—-]*/i, '')
    .replace(/^[AB][:\s—-]+/i, '')
    .replace(nameRe || /$^/, '')
    .replace(otherRe || /$^/, '')
    .replace(/^[a-z\s]+[:\\s—-]+/i, (match) => {
       const prefix = match.split(':')[0].trim().toLowerCase();
       if (prefix.length < 20) return ""; 
       return match;
    })
    .replace(/^["']|["']$/g, '')
    .replace(/\bSpeaking\b/gi, '')
    .replace(/\s*\b\d+\.\s*$/g, '')
    .trim();
  if (name && cleaned.toLowerCase().startsWith(name.toLowerCase())) cleaned = cleaned.substring(name.length).replace(/^[:\s—-]+/, '').trim();
  if (otherName && cleaned.toLowerCase().startsWith(otherName.toLowerCase())) cleaned = cleaned.substring(otherName.length).replace(/^[:\s—-]+/, '').trim();
  if (otherName) {
    const otherInline = new RegExp(`\\b${escapeRegExp(otherName)}\\b`, 'gi');
    cleaned = cleaned.replace(otherInline, 'you');
  }
  return cleaned;
}

app.get('/api/sessions/:id/commentary/latest', async (req, res) => {
  try {
    console.log(`[Commentary] Request for session: ${req.params.id}`);
    const doc = await db.collection('sessions').doc(req.params.id).get();
    if (!doc.exists) {
      console.error(`[Commentary] Session not found: ${req.params.id}`);
      return res.status(404).send();
    }
    const s = doc.data();
    console.log(`[Commentary] Session:`, { gameName: s.gameName, sport: s.sport, league: s.league, commentators: s.commentators?.map(c => ({ name: c.name, voice: c.voice })) });
    const rt = getRuntime(s.id);
    const now = Date.now();

    if (rt.cache && (now - rt.ts) < 5000) {
      console.log('[Commentary] Returning cached response');
      return res.json(rt.cache);
    }

    console.log(`[Commentary] Fetching ESPN data: ${s.espnSlug}`);
    const scoreData = await fetchCached(`sb_${s.espnSlug}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/scoreboard`);
    const game = parseScoreboard(scoreData).find(e => e.id === s.espnEventId);
    console.log(`[Commentary] Game found:`, game ? { name: game.name, status: game.status?.state, score: `${game.away?.score}-${game.home?.score}` } : 'NOT FOUND');

    const interval = (s.settings?.preGameInterval || 45) * 1000;
    
    if (!game || game.status?.state !== 'in') {
      if (rt.cache && (now - rt.ts) < interval) return res.json(rt.cache);
      const aPrompt = s.commentators?.[0]?.prompt ? `A style: ${s.commentators[0].prompt}` : '';
      const bPrompt = s.commentators?.[1]?.prompt ? `B style: ${s.commentators[1].prompt}` : '';
      const prompt = `Short unhinged pre-game argument. [A] ${s.commentators[0].name} is pro-${game?.away?.abbreviation || 'away'} and critical of ${game?.home?.abbreviation || 'home'}. [B] ${s.commentators[1].name} is pro-${game?.home?.abbreviation || 'home'} and critical of ${game?.away?.abbreviation || 'away'}. Matchup: ${game?.name || s.gameName}. ${aPrompt} ${bPrompt} 3 turns exactly: [A], [B], [A]. SNAPPY. They must disagree. A never concedes; B never concedes. Do not include speaker names, letters, or labels in the text. Never address the other by name. No stage directions or emotion labels.`;
      let raw = '';
      try {
        const r = await fetch(MODAL_MISTRAL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) });
        const json = await r.json();
        raw = json?.choices?.[0]?.message?.content || '';
      } catch (e) {
        console.error('Modal pregame error:', e);
      }
      if (!raw) {
        const aName = s.commentators[0].name, bName = s.commentators[1].name;
        const away = game?.away?.abbreviation || 'Away';
        const home = game?.home?.abbreviation || 'Home';
        rt.cache = {
          turns: [
            { speaker: 'A', name: aName, text: `${away} is getting the job done so far. That home crowd is quiet.` },
            { speaker: 'B', name: bName, text: `${home} is right there. This flips fast once we tighten up.` },
            { speaker: 'A', name: aName, text: `You’ve been saying that all night. ${away} is controlling it.` }
          ],
          status: 'pre',
          timestamp: now
        };
        rt.ts = now;
        return res.json(rt.cache);
      }
      const turns = [];
      const turnRegex = /\[([AB])\][:\s—-]*(.*?)(?=\[[AB]\]|$)/gs;
      let m; while ((m = turnRegex.exec(raw)) !== null) {
        const side = m[1]; const txt = m[2].trim();
        const c = side === 'A' ? s.commentators[0] : s.commentators[1];
        const other = side === 'A' ? s.commentators[1]?.name : s.commentators[0]?.name;
        if (txt) turns.push({ speaker: side, name: c.name, text: strip(txt, c.name, other) });
      }
      rt.cache = { turns, status: 'pre', timestamp: now }; rt.ts = now;
      return res.json(rt.cache);
    }

    const summaryRaw = await fetchCached(`sum_${s.espnEventId}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/summary?event=${s.espnEventId}`);
    const summary = parseSummary(summaryRaw);
    const latestPlay = (summary.plays || []).slice(-1)[0];
    const seq = (summary.drives?.length || 0) * 100 + (summary.plays?.length || 0);
    const playKey = [
      latestPlay?.id,
      latestPlay?.sequenceNumber,
      latestPlay?.text,
      latestPlay?.clock,
      latestPlay?.period
    ].filter(Boolean).join('|');
    const scoreKey = `${game.away.score}-${game.home.score}`;

    const noNewPlay = (playKey && rt.lastPlayKey === playKey) || (!playKey && rt.lastSeq === seq);
    const noScoreChange = rt.lastScoreKey === scoreKey;
    if (noNewPlay && noScoreChange && (now - rt.ts) < 45000) return res.json(rt.cache);

    const aPrompt = s.commentators?.[0]?.prompt ? `A style: ${s.commentators[0].prompt}` : '';
    const bPrompt = s.commentators?.[1]?.prompt ? `B style: ${s.commentators[1].prompt}` : '';
    const prompt = `Live banter. [A] ${s.commentators[0].name} is pro-${game.away.abbreviation} and critical of ${game.home.abbreviation}. [B] ${s.commentators[1].name} is pro-${game.home.abbreviation} and critical of ${game.away.abbreviation}. Play: ${latestPlay?.text || 'Game update'}. Score: ${game.away.abbreviation} ${game.away.score}, ${game.home.abbreviation} ${game.home.score}. ${aPrompt} ${bPrompt} 3 turns: [A], [B], [A]. Snappy. They must disagree. A never concedes; B never concedes. Do not include speaker names, letters, or labels in the text. Never address the other by name. No stage directions or emotion labels.`;
    let raw = '';
    try {
      const r = await fetch(MODAL_MISTRAL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) });
      const json = await r.json();
      raw = json?.choices?.[0]?.message?.content || '';
    } catch (e) {
      console.error('Modal live error:', e);
    }
    if (!raw) {
      const aName = s.commentators[0].name, bName = s.commentators[1].name;
      const away = game?.away?.abbreviation || 'Away';
      const home = game?.home?.abbreviation || 'Home';
      const playText = latestPlay?.text || 'Game update';
      rt.cache = {
        turns: [
          { speaker: 'A', name: aName, text: `${away} is in control. That last play says it all.` },
          { speaker: 'B', name: bName, text: `${home} can still flip this. One stop and we’re right back.` },
          { speaker: 'A', name: aName, text: `Not with ${playText.toLowerCase()}. Momentum is real.` }
        ],
        status: 'live',
        play: { description: latestPlay?.text || 'Game Update', seq },
        timestamp: now
      };
      rt.ts = now;
      return res.json(rt.cache);
    }
    const turns = [];
    const turnRegex = /\[([AB])\][:\s—-]*(.*?)(?=\[[AB]\]|$)/gs;
    let m; while ((m = turnRegex.exec(raw)) !== null) {
      const side = m[1]; const txt = m[2].trim();
      const c = side === 'A' ? s.commentators[0] : s.commentators[1];
      const other = side === 'A' ? s.commentators[1]?.name : s.commentators[0]?.name;
      if (txt) turns.push({ speaker: side, name: c.name, text: strip(txt, c.name, other) });
    }

    rt.lastSeq = seq;
    rt.lastPlayKey = playKey || rt.lastPlayKey;
    rt.lastScoreKey = scoreKey;
    rt.cache = { turns, status: 'live', play: { description: latestPlay?.text || 'Game Update', seq }, timestamp: now }; rt.ts = now;
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
