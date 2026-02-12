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
    const events = parseScoreboard(data);

    // Add isLive flag for UI
    const enrichedEvents = events.map(e => ({
      ...e,
      isLive: e.status?.state === 'in'
    }));

    res.json({ events: enrichedEvents });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generate batch of pre-game commentary (15-30 turns) with team/player context
async function generatePreGameBatch(sessionId, session) {
  // Prevent duplicate batch generation
  if (batchGenerating.has(sessionId)) {
    console.log(`[PreGame Batch] Already generating for session ${sessionId}, skipping duplicate request`);
    return;
  }

  batchGenerating.add(sessionId);

  try {
    console.log(`[PreGame Batch] Generating for session ${sessionId}`);

    // Fetch game data
    const scoreData = await fetchCached(`score_${session.espnEventId}`, `https://site.api.espn.com/apis/site/v2/sports/${session.espnSlug}/scoreboard`);
    const game = parseScoreboard(scoreData).find(e => e.id === session.espnEventId);

    if (!game) {
      console.error(`[PreGame Batch] Game not found: ${session.espnEventId}`);
      batchGenerating.delete(sessionId);
      return;
    }

    // Fetch detailed stats
    const summaryData = await fetchCached(`sum_${session.espnEventId}`, `https://site.api.espn.com/apis/site/v2/sports/${session.espnSlug}/summary?event=${session.espnEventId}`);
    const summary = parseSummary(summaryData);

    // Build context for AI
    const context = `
MATCHUP: ${game.away.name} @ ${game.home.name}
AWAY TEAM: ${game.away.name} (${game.away.abbreviation})
HOME TEAM: ${game.home.name} (${game.home.abbreviation})
${game.odds ? `SPREAD: ${game.odds.spread}, O/U: ${game.odds.overUnder}` : ''}
${summary.teamStats && summary.teamStats.length === 2 ? `
AWAY STATS: ${summary.teamStats[0].stats.map(s => `${s.label}: ${s.displayValue}`).join(', ')}
HOME STATS: ${summary.teamStats[1].stats.map(s => `${s.label}: ${s.displayValue}`).join(', ')}
` : ''}
${summary.playerStats && summary.playerStats[0]?.categories?.[0] ? `
TOP AWAY PLAYERS: ${summary.playerStats[0].categories[0].athletes.slice(0, 3).map(a => a.name).join(', ')}
TOP HOME PLAYERS: ${summary.playerStats[1]?.categories?.[0]?.athletes.slice(0, 3).map(a => a.name).join(', ')}
` : ''}
    `.trim();

    const prompt = `Generate 30 unique pre-game commentary turns as an intense argument between two sports commentators about this matchup.

${context}

[A] ${session.commentators[0].name} is pro-${game.away.abbreviation} and very critical of ${game.home.abbreviation}.
[B] ${session.commentators[1].name} is pro-${game.home.abbreviation} and very critical of ${game.away.abbreviation}.

Requirements:
- 30 numbered lines (1-30)
- Alternate speakers: odd numbers = [A], even numbers = [B]
- Reference actual team stats, players, matchup details
- HEATED debate - they strongly disagree
- Be specific: mention player names, stats, team strengths/weaknesses
- SNAPPY and SHORT (1-2 sentences each)
- NO speaker names/labels in the text itself
- NO stage directions

Format: Just numbered lines like:
1. "text"
2. "text"
3. "text"
...`;

    console.log(`[PreGame Batch] Calling Modal with context...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch(MODAL_MISTRAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Modal returned ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    const raw = json?.choices?.[0]?.message?.content || '';

    console.log(`[PreGame Batch] Modal returned ${raw.length} chars, parsed ${json?.choices?.length || 0} choices`);

    // Parse numbered commentary
    const turns = [];
    const numberedRegex = /(\d+)\.\s*["']?(.*?)["']?(?=\s*\d+\.|$)/gs;
    let m;
    while ((m = numberedRegex.exec(raw)) !== null) {
      const num = parseInt(m[1]);
      let txt = m[2].trim().replace(/^["']+|["']+$/g, '').replace(/["']+\s*$/g, '');
      if (txt && txt.length > 5) {
        const side = num % 2 === 1 ? 'A' : 'B';
        const c = side === 'A' ? session.commentators[0] : session.commentators[1];
        const other = side === 'A' ? session.commentators[1]?.name : session.commentators[0]?.name;
        turns.push({ speaker: side, name: c.name, text: strip(txt, c.name, other) });
      }
    }

    console.log(`[PreGame Batch] Generated ${turns.length} turns`);

    if (turns.length === 0) {
      console.error(`[PreGame Batch] No turns parsed from Modal response. Raw response: ${raw.substring(0, 500)}`);
      throw new Error('Failed to parse any turns from Modal response');
    }

    // Store in Firebase
    await db.collection('sessions').doc(sessionId).update({ preGameCommentary: turns, preGameIndex: 0 });
    console.log(`[PreGame Batch] Saved ${turns.length} turns to Firebase`);

  } catch (err) {
    console.error(`[PreGame Batch] Error for session ${sessionId}:`, err);
  } finally {
    batchGenerating.delete(sessionId);
  }
}

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
      createdAt: new Date().toISOString(),
      preGameCommentary: [], // Will be populated
      preGameIndex: 0 // Track which commentary to show next
    };
    await db.collection('sessions').doc(id).set(session);

    // Generate batch pre-game commentary in background
    generatePreGameBatch(id, session).catch(e => console.error('[PreGame] Batch generation error:', e));

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
  // MALE VOICES - ENGLISH
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

  // MALE VOICES - ACCENTED
  matias: { id: 'XB0fDUnXU5powFXDhCwa', name: 'Matias (Spanish Accent, Warm)' },
  diego: { id: 'GJfmRNURTTecIrxz2YQY', name: 'Diego (Spanish Accent, Deep)' },
  omar: { id: 'pqHfZKP75CvOlQylNhV4', name: 'Omar (Arabic Accent, Deep)' },

  // FEMALE VOICES - ENGLISH
  rachel: { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Calm, Young)' },
  domi: { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (Strong, Confident)' },
  bella: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Soft, American)' },
  elli: { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (Emotional, Expressive)' },
  emily: { id: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily (Calm, American)' },
  freya: { id: 'jsCqWAovK2LkecY7zXl4', name: 'Freya (Young, American)' },
  grace: { id: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace (Southern, Smooth)' },
  nicole: { id: 'piTKgcLEGmPE4e6mEKli', name: 'Nicole (Whisper, Expressive)' },
  sarah: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Soft, News Anchor)' },

  // FEMALE VOICES - ACCENTED
  valentina: { id: 'Szoijfe6rqv9vDH0mYqU', name: 'Valentina (Spanish Accent)' },
  serena: { id: 'z9fAnlkpzviPz146aGWa', name: 'Serena (Italian Accent)' },
  layla: { id: 'gvKjg3wqXNEOPBQlPgRU', name: 'Layla (Arabic Accent)' },

  // PIPER FALLBACK
  amy: { id: 'piper-amy', name: 'Amy (Piper - Female)' },
  bryce: { id: 'piper-bryce', name: 'Bryce (Piper - Male)' }
};

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) {
      console.error('[TTS] 400 Error - Empty text received:', { text, voice, body: req.body });
      return res.status(400).send();
    }

    let voiceKey = voice || 'adam';

    // Handle raw ElevenLabs IDs (legacy/direct IDs from admin panel)
    const voiceIdMap = Object.entries(ELEVENLABS_VOICES).reduce((acc, [key, val]) => {
      acc[val.id] = key;
      return acc;
    }, {});

    // If voice is a raw ID, convert to key
    if (voiceIdMap[voiceKey]) {
      console.log(`[TTS] Converting voice ID ${voiceKey} -> ${voiceIdMap[voiceKey]}`);
      voiceKey = voiceIdMap[voiceKey];
    }

    const key = `${voiceKey}:${text.trim().toLowerCase().substring(0, 100)}`;

    if (ttsCache.has(key)) return res.json(ttsCache.get(key));

    // Check if using ElevenLabs voice
    const voiceConfig = ELEVENLABS_VOICES[voiceKey];
    const isElevenLabs = voiceConfig && !voiceConfig.id.startsWith('piper-');

    if (isElevenLabs && ELEVENLABS_API_KEY) {
      console.log(`[TTS] Using ElevenLabs for voice: ${voiceKey}`);
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
    if (!ELEVENLABS_API_KEY) {
      console.log(`[TTS] ELEVENLABS_API_KEY not set, using Piper fallback`);
    }
    console.log(`[TTS] Using Piper fallback for voice: ${voiceKey}`);
    // Map ElevenLabs voices to Piper equivalents
    const piperVoiceMap = {
      // Female voices -> amy
      rachel: 'amy', domi: 'amy', bella: 'amy', elli: 'amy', emily: 'amy',
      freya: 'amy', grace: 'amy', nicole: 'amy', sarah: 'amy', valentina: 'amy',
      serena: 'amy', layla: 'amy', amy: 'amy',
      // Male voices -> bryce
      adam: 'bryce', antoni: 'bryce', arnold: 'bryce', callum: 'bryce',
      charlie: 'bryce', clyde: 'bryce', daniel: 'bryce', george: 'bryce',
      joseph: 'bryce', josh: 'bryce', michael: 'bryce', thomas: 'bryce',
      matias: 'bryce', diego: 'bryce', omar: 'bryce', bryce: 'bryce'
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
      .filter(([k]) => ['adam', 'antoni', 'arnold', 'callum', 'charlie', 'clyde', 'daniel', 'george', 'joseph', 'josh', 'michael', 'thomas', 'matias', 'diego', 'omar', 'bryce'].includes(k))
      .map(([k, v]) => ({ id: k, ...v })),
    female: Object.entries(ELEVENLABS_VOICES)
      .filter(([k]) => ['rachel', 'domi', 'bella', 'elli', 'emily', 'freya', 'grace', 'nicole', 'sarah', 'valentina', 'serena', 'layla', 'amy'].includes(k))
      .map(([k, v]) => ({ id: k, ...v }))
  });
});

// ─── COMMENTARY ENGINE ───
const MODAL_MISTRAL_URL = 'https://mousears1090--claudeapps-mistral-mistralmodel-chat.modal.run';
const sessionRuntimes = new Map();
const sessionViewers = new Map(); // Track active viewers
const commentaryHistory = new Map(); // Store commentary history per session
const batchGenerating = new Set(); // Track which sessions are currently generating batches

function getRuntime(id) {
  if (!sessionRuntimes.has(id)) sessionRuntimes.set(id, { lastSeq: -1, lastPlayKey: null, lastScoreKey: null, cache: null, ts: 0 });
  return sessionRuntimes.get(id);
}

// Check if session has active viewers (pinged within last 5 min)
function hasActiveViewers(sessionId) {
  const viewer = sessionViewers.get(sessionId);
  if (!viewer) return false;
  const VIEWER_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  return (Date.now() - viewer.lastPing) < VIEWER_TIMEOUT;
}

// Viewer heartbeat endpoint
app.post('/api/sessions/:id/ping', async (req, res) => {
  const sessionId = req.params.id;
  sessionViewers.set(sessionId, { lastPing: Date.now(), userAgent: req.headers['user-agent'] });
  console.log(`[Viewer] Heartbeat for session ${sessionId}`);
  res.json({ ok: true, activeViewers: sessionViewers.get(sessionId) });
});

// Get viewer stats
app.get('/api/admin/viewers', requireAdmin, (req, res) => {
  const VIEWER_TIMEOUT = 5 * 60 * 1000;
  const now = Date.now();
  const activeViewers = [];

  sessionViewers.forEach((viewer, sessionId) => {
    if ((now - viewer.lastPing) < VIEWER_TIMEOUT) {
      activeViewers.push({
        sessionId,
        lastPing: viewer.lastPing,
        idleTime: Math.floor((now - viewer.lastPing) / 1000),
        userAgent: viewer.userAgent
      });
    }
  });

  res.json({ activeViewers, totalActive: activeViewers.length });
});

function escapeRegExp(input) {
  return input ? input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
}

function strip(text, name, otherName) {
  if (!text) return "";
  const original = text;
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
       if (prefix.length < 20) {
         console.log(`[Strip] Removing label: "${match}" from start`);
         return "";
       }
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

  if (cleaned !== original && original.length - cleaned.length > 20) {
    console.log(`[Strip] WARNING: Removed ${original.length - cleaned.length} chars`);
    console.log(`  Before: "${original.substring(0, 100)}..."`);
    console.log(`  After:  "${cleaned.substring(0, 100)}..."`);
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

    // Check if anyone is watching before generating commentary
    const hasViewers = hasActiveViewers(s.id);
    console.log(`[Commentary] Active viewers: ${hasViewers ? 'YES' : 'NO'}`);

    // If no viewers and cache exists, return cache (don't waste Modal tokens)
    if (!hasViewers && rt.cache) {
      console.log('[Commentary] No active viewers, returning cached response (saving tokens)');
      return res.json(rt.cache);
    }

    console.log(`[Commentary] Fetching ESPN data: ${s.espnSlug}`);
    const scoreData = await fetchCached(`sb_${s.espnSlug}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/scoreboard`);
    const game = parseScoreboard(scoreData).find(e => e.id === s.espnEventId);
    console.log(`[Commentary] Game found:`, game ? { name: game.name, status: game.status?.state, score: `${game.away?.score}-${game.home?.score}` } : 'NOT FOUND');

    const interval = (s.settings?.preGameInterval || 45) * 1000;

    // Pre-game: cycle through batch commentary
    if (!game || game.status?.state !== 'in') {
      console.log('[Commentary] PRE-GAME MODE - Game not started or not found');

      // Check if we have batch commentary
      if (!s.preGameCommentary || s.preGameCommentary.length === 0) {
        console.log('[Commentary] No pre-game batch yet, generating fallback...');
        // Trigger batch generation if not done yet
        generatePreGameBatch(s.id, s).catch(e => console.error(e));
      }

      // Get next 3 turns from batch (cycle through without caching to avoid repetition)
      if (s.preGameCommentary && s.preGameCommentary.length >= 3) {
        const currentIndex = s.preGameIndex || 0;
        const nextIndex = (currentIndex + 3) % s.preGameCommentary.length;

        // Get 3 turns
        let selectedTurns = [];
        if (currentIndex + 3 <= s.preGameCommentary.length) {
          selectedTurns = s.preGameCommentary.slice(currentIndex, currentIndex + 3);
        } else {
          // Wrap around
          selectedTurns = [
            ...s.preGameCommentary.slice(currentIndex),
            ...s.preGameCommentary.slice(0, 3 - (s.preGameCommentary.length - currentIndex))
          ];
        }

        console.log(`[Commentary] Cycling batch turns ${currentIndex}-${currentIndex + 2} (${s.preGameCommentary.length} total)`);
        selectedTurns.forEach((t, i) => console.log(`  [${i + 1}] ${t.name}: ${t.text.substring(0, 60)}...`));

        // Update index for NEXT request (cycle immediately, no caching)
        await db.collection('sessions').doc(s.id).update({ preGameIndex: nextIndex });

        // Return fresh turns each time, timestamp changes to trigger frontend update
        return res.json({ turns: selectedTurns, status: 'pre', timestamp: now });
      }

      // Ultimate fallback if batch still not ready
      console.log('[Commentary] Using basic fallback (batch not ready yet)');
      const aName = s.commentators[0].name, bName = s.commentators[1].name;
      const away = game?.away?.abbreviation || 'Away';
      const home = game?.home?.abbreviation || 'Home';
      rt.cache = {
        turns: [
          { speaker: 'A', name: aName, text: `${away} looking strong for this matchup.` },
          { speaker: 'B', name: bName, text: `${home} has what it takes to win this.` },
          { speaker: 'A', name: aName, text: `We'll see about that.` }
        ],
        status: 'pre',
        timestamp: now
      };
      rt.ts = now;
      return res.json(rt.cache);
    }

    console.log('[Commentary] LIVE GAME - Fetching play-by-play data');
    const summaryRaw = await fetchCached(`sum_${s.espnEventId}`, `https://site.api.espn.com/apis/site/v2/sports/${s.espnSlug}/summary?event=${s.espnEventId}`);
    const summary = parseSummary(summaryRaw);
    const latestPlay = (summary.plays || []).slice(-1)[0];
    console.log('[Commentary] Latest play:', latestPlay ? latestPlay.text : 'NO PLAYS FOUND');

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
    const cacheAge = rt.cache ? (now - rt.ts) : 999999;

    console.log('[Commentary] Play check:', {
      noNewPlay,
      noScoreChange,
      cacheAge: `${Math.floor(cacheAge/1000)}s`,
      hasCache: !!rt.cache
    });

    // ONLY generate commentary when there's an ACTUAL NEW PLAY
    // Don't regenerate every 45s if play hasn't changed
    if (noNewPlay && noScoreChange) {
      if (rt.cache) {
        console.log('[Commentary] No new plays, returning cached commentary');
        return res.json(rt.cache);
      } else {
        // No cache and no new play - return empty/silent
        console.log('[Commentary] No new plays and no cache - staying silent');
        return res.json({ turns: [], status: 'live', timestamp: now });
      }
    }

    console.log('[Commentary] NEW PLAY DETECTED! Generating fresh commentary via Modal...');

    const aPrompt = s.commentators?.[0]?.prompt ? `A style: ${s.commentators[0].prompt}` : '';
    const bPrompt = s.commentators?.[1]?.prompt ? `B style: ${s.commentators[1].prompt}` : '';
    const prompt = `Generate 3 commentary turns as JSON array. [A] ${s.commentators[0].name} is pro-${game.away.name} and critical of ${game.home.name}. [B] ${s.commentators[1].name} is pro-${game.home.name} and critical of ${game.away.name}.

Play: ${latestPlay?.text || 'Game update'}
Score: ${game.away.name} ${game.away.score}, ${game.home.name} ${game.home.score}

${aPrompt} ${bPrompt}

Return ONLY valid JSON array with exactly 3 objects in this format:
[
  {"speaker": "A", "text": "first comment here"},
  {"speaker": "B", "text": "response here"},
  {"speaker": "A", "text": "rebuttal here"}
]

Requirements:
- Snappy, short comments (1-2 sentences)
- They must disagree
- Reference the play and score
- Use full team names (${game.away.name}, ${game.home.name})
- NO speaker names, labels, or stage directions in the text
- ONLY return the JSON array, nothing else`;
    let raw = '';
    try {
      console.log('[Commentary] Calling Modal LLM...');
      const r = await fetch(MODAL_MISTRAL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) });
      const json = await r.json();
      raw = json?.choices?.[0]?.message?.content || '';
      console.log('[Commentary] Modal response received:', raw ? `${raw.length} chars` : 'EMPTY');
      if (raw) console.log('[Commentary] Raw Modal response:', raw);
    } catch (e) {
      console.error('[Commentary] Modal live error:', e);
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
    // Parse JSON response from Modal
    let turns = [];
    try {
      // Try to extract JSON array from response (Modal might wrap it in markdown code blocks)
      let jsonStr = raw.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
      }

      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        turns = parsed.slice(0, 3).map(t => ({
          speaker: t.speaker,
          name: t.speaker === 'A' ? s.commentators[0].name : s.commentators[1].name,
          text: t.text.trim()
        }));
      }
    } catch (parseErr) {
      console.error('[Commentary] JSON parse failed, trying fallback regex:', parseErr.message);
      // Fallback to old regex parsing if JSON fails
      const numberedRegex = /(\d+)[:\.]?\s*["']?(.*?)["']?(?=\s*\d+[:\.]|$)/gs;
      let m;
      while ((m = numberedRegex.exec(raw)) !== null && turns.length < 3) {
        const num = parseInt(m[1]);
        const txt = m[2].trim().replace(/^["']+|["']+$/g, '');
        if (txt && txt.length > 5) {
          const side = num % 2 === 1 ? 'A' : 'B';
          const c = side === 'A' ? s.commentators[0] : s.commentators[1];
          turns.push({ speaker: side, name: c.name, text: txt });
        }
      }
    }

    console.log(`[Commentary] Generated ${turns.length} turns for live game`);
    turns.forEach((t, i) => console.log(`  [${i+1}] ${t.name}: ${t.text.substring(0, 50)}...`));

    rt.lastSeq = seq;
    rt.lastPlayKey = playKey || rt.lastPlayKey;
    rt.lastScoreKey = scoreKey;
    rt.cache = { turns, status: 'live', play: { description: latestPlay?.text || 'Game Update', seq }, timestamp: now }; rt.ts = now;

    // Store in history
    if (!commentaryHistory.has(s.id)) commentaryHistory.set(s.id, []);
    const history = commentaryHistory.get(s.id);
    history.push(rt.cache);
    if (history.length > 50) history.shift(); // Keep last 50

    console.log('[Commentary] Returning fresh live commentary to client');
    res.json(rt.cache);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get commentary history
app.get('/api/sessions/:id/commentary/history', async (req, res) => {
  try {
    const history = commentaryHistory.get(req.params.id) || [];
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
