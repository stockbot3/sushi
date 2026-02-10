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
      console.log('[Modal] Got 303, polling result URL...');
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
      throw new Error('Modal LLM timed out after polling');
    }
    const errBody = await res.text();
    throw new Error(`Modal returned ${res.status}: ${errBody.slice(0, 300)}`);
  } finally { clearTimeout(timer); }
}

app.use(cors());
app.use(express.json());

// Serve admin panel before static middleware so it doesn't get caught by index.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

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
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    let adminData = await getAdminDoc();

    // Bootstrap: if no admin doc, first login sets the password
    if (!adminData) {
      const envPw = process.env.ADMIN_PASSWORD;
      if (envPw) {
        await setAdminPassword(envPw);
        adminData = await getAdminDoc();
      } else {
        // First login sets the password
        await setAdminPassword(password);
        adminData = await getAdminDoc();
      }
    }

    const valid = await bcrypt.compare(password, adminData.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.add(token);
    res.json({ token });
  } catch (err) {
    console.error('Admin login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Change password
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  try {
    const { current, newPassword } = req.body;
    if (!current || !newPassword) return res.status(400).json({ error: 'Both current and newPassword required' });

    const adminData = await getAdminDoc();
    if (!adminData) return res.status(500).json({ error: 'No admin configured' });

    const valid = await bcrypt.compare(current, adminData.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

    await setAdminPassword(newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Upload endpoint
app.post('/api/admin/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// Verify token
app.get('/api/admin/verify', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

// ─── SPORT CONFIG ───
const SPORTS_CONFIG = {
  football: {
    name: 'Football',
    leagues: {
      nfl: { name: 'NFL', espnSlug: 'football/nfl' },
      'college-football': { name: 'College Football', espnSlug: 'football/college-football' },
    }
  },
  basketball: {
    name: 'Basketball',
    leagues: {
      nba: { name: 'NBA', espnSlug: 'basketball/nba' },
      ncaam: { name: 'NCAAM', espnSlug: 'basketball/mens-college-basketball' },
    }
  },
  baseball: {
    name: 'Baseball',
    leagues: {
      mlb: { name: 'MLB', espnSlug: 'baseball/mlb' },
    }
  },
  hockey: {
    name: 'Hockey',
    leagues: {
      nhl: { name: 'NHL', espnSlug: 'hockey/nhl' },
    }
  },
  soccer: {
    name: 'Soccer',
    leagues: {
      epl: { name: 'Premier League', espnSlug: 'soccer/eng.1' },
      mls: { name: 'MLS', espnSlug: 'soccer/usa.1' },
    }
  },
};

// ─── PARAMETERIZED ESPN URLS ───
function espnScoreboard(espnSlug, date) {
  let url = `https://site.api.espn.com/apis/site/v2/sports/${espnSlug}/scoreboard`;
  if (date) url += `?dates=${date}`;
  return url;
}
function espnSummary(espnSlug, eventId) {
  return `https://site.api.espn.com/apis/site/v2/sports/${espnSlug}/summary?event=${eventId}`;
}
function espnRoster(espnSlug, teamId) {
  return `https://site.api.espn.com/apis/site/v2/sports/${espnSlug}/teams/${teamId}/roster`;
}
function espnNews(espnSlug) {
  return `https://site.api.espn.com/apis/site/v2/sports/${espnSlug}/news?limit=15`;
}

// ─── CACHE ───
const cache = {};
const ttsCache = new Map(); // GLOBAL TTS CACHE
const CACHE_TTL = {
  scoreboard: 8 * 1000,
  summary: 8 * 1000,
  roster: 5 * 60 * 1000,
  team: 10 * 60 * 1000,
  news: 2 * 60 * 1000,
};

async function fetchCached(key, url, ttl) {
  const now = Date.now();
  if (cache[key] && (now - cache[key].ts) < ttl) return cache[key].data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN API returned ${res.status}`);
    const data = await res.json();
    cache[key] = { data, ts: now };
    return data;
  } catch (err) {
    console.error(`Fetch error for ${key}:`, err.message);
    if (cache[key]) return cache[key].data;
    throw err;
  }
}

// ─── PIPER TTS via MODAL ───
const MODAL_PIPER_URL = process.env.MODAL_PIPER_URL || 'https://mousears1090--sushi-piper-tts-tts.modal.run';

app.post('/api/tts', async (req, res) => {
  try {
    const text = req.body.text || req.query.text;
    if (!text) return res.status(400).json({ error: 'text required' });
    
    // Check TTS Cache
    const cacheKey = text.trim().toLowerCase();
    if (ttsCache.has(cacheKey)) {
      return res.json(ttsCache.get(cacheKey));
    }

    // Call Modal Piper TTS
    const response = await fetch(MODAL_PIPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Modal Piper returned ${response.status}: ${errText}`);
    }
    
    const data = await response.json();
    const result = {
      audio: data.audio,
      format: data.format || 'wav',
      sample_rate: data.sample_rate || 22050
    };

    // Cache result
    if (ttsCache.size > 200) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(cacheKey, result);

    res.json(result);
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(502).json({ error: 'TTS service unavailable', message: err.message });
  }
});

// ─── PERSONALITY PRESETS ───
const PERSONALITY_PRESETS = {
  barkley: {
    name: 'Sir Charles',
    prompt: `Loud, bold, wrong but confident. Uses "TURRIBLE" frequently. Makes absurd analogies comparing plays to eating churros or playing golf. Declares games over in the 2nd quarter. Claims he always knew what would happen. Uses "Let me tell you something" as a catchphrase.`
  },
  skip: {
    name: 'Hot Take Skip',
    prompt: `Ultimate contrarian. Dismissive of obvious greatness. Believes in conspiracy theories about refs. Says "I've said this for YEARS" about things he never said. Compares every QB to his favorites. Uses "UNDISPUTED" and "my dear friend" frequently.`
  },
  snoop: {
    name: 'Uncle Snoop',
    prompt: `Laid-back, uses slang and music/food metaphors. Says "fo shizzle", "izzle" variations, and "cuz". Compares plays to cooking or rap battles. Surprisingly drops deep wisdom between jokes. Calls players "nephew" and "young blood". References the West Coast.`
  },
  romo: {
    name: 'Stats Guru Tony',
    prompt: `Analytical and excitable. Predicts plays before they happen with "HERE IT COMES!". Obsessed with formations, pre-snap reads, and coverage schemes. Gets genuinely giddy about good play design. Uses "Oh man!" and "You see that?!" frequently. Speaks fast when excited.`
  },
};

// ─── SPORT-SPECIFIC PROMPT CONTEXT ───
function getSportContext(sport) {
  switch (sport) {
    case 'football':
      return {
        periodName: 'Quarter',
        possessionTerm: 'has the ball',
        scoringTerms: 'touchdown, field goal, safety, two-point conversion',
        playTerms: 'downs, yards, passing, rushing, sacks, turnovers',
        promptFrame: `This is a football game with downs and yards. Yards gained = GOOD for offense, BAD for defense. Turnovers (interception/fumble) = BAD for offense. Touchdowns = 6pts + extra point, Field Goals = 3pts.`,
      };
    case 'basketball':
      return {
        periodName: 'Quarter',
        possessionTerm: 'has possession',
        scoringTerms: 'three-pointer, dunk, layup, free throw',
        playTerms: 'shooting, rebounds, assists, steals, blocks, turnovers',
        promptFrame: `This is a basketball game. Points come from 2-point shots, 3-pointers, and free throws. Momentum swings are crucial. Runs (scoring streaks) shift games.`,
      };
    case 'baseball':
      return {
        periodName: 'Inning',
        possessionTerm: 'is at bat',
        scoringTerms: 'home run, RBI, run scored',
        playTerms: 'at-bats, hits, strikeouts, walks, errors, pitching',
        promptFrame: `This is a baseball game. Runs score when batters reach home. Outs accumulate to 3 per half-inning. Hits, walks, and errors put runners on base.`,
      };
    case 'hockey':
      return {
        periodName: 'Period',
        possessionTerm: 'has the puck',
        scoringTerms: 'goal, power play goal, shorthanded goal',
        playTerms: 'shots on goal, saves, power plays, penalties, faceoffs',
        promptFrame: `This is a hockey game. Goals are rare and exciting. Power plays (opponent penalized) create scoring opportunities. Saves by goalies are crucial.`,
      };
    case 'soccer':
      return {
        periodName: 'Half',
        possessionTerm: 'has possession',
        scoringTerms: 'goal, penalty kick, free kick goal',
        playTerms: 'possession, shots, shots on target, corners, fouls, cards',
        promptFrame: `This is a soccer/football match. Goals are precious and rare. Possession percentage indicates control. Yellow/red cards affect team strength.`,
      };
    default:
      return {
        periodName: 'Period',
        possessionTerm: 'has the ball',
        scoringTerms: 'score',
        playTerms: 'plays',
        promptFrame: 'This is a live sporting event.',
      };
  }
}

// ─── PARSE HELPERS ───

function parseScoreboard(data) {
  const events = (data.events || []).map(event => {
    const comp = event.competitions?.[0] || {};
    const homeComp = comp.competitors?.find(c => c.homeAway === 'home') || {};
    const awayComp = comp.competitors?.find(c => c.homeAway === 'away') || {};
    const situation = comp.situation || {};
    const odds = comp.odds?.[0] || {};
    const broadcast = comp.broadcasts?.[0]?.names?.[0] || '';
    return {
      id: event.id,
      name: event.name,
      shortName: event.shortName,
      date: event.date,
      note: comp.notes?.[0]?.headline || '',
      status: {
        state: comp.status?.type?.state,
        detail: comp.status?.type?.detail,
        shortDetail: comp.status?.type?.shortDetail,
        clock: comp.status?.displayClock,
        period: comp.status?.period,
        completed: comp.status?.type?.completed,
      },
      venue: { name: comp.venue?.fullName, city: comp.venue?.address?.city, state: comp.venue?.address?.state },
      broadcast,
      home: {
        id: homeComp.team?.id, name: homeComp.team?.displayName, abbreviation: homeComp.team?.abbreviation,
        shortName: homeComp.team?.shortDisplayName, logo: homeComp.team?.logo,
        color: homeComp.team?.color ? `#${homeComp.team.color}` : null,
        altColor: homeComp.team?.alternateColor ? `#${homeComp.team.alternateColor}` : null,
        score: parseInt(homeComp.score) || 0, record: homeComp.records?.[0]?.summary || '',
        linescores: (homeComp.linescores || []).map(l => l.value),
      },
      away: {
        id: awayComp.team?.id, name: awayComp.team?.displayName, abbreviation: awayComp.team?.abbreviation,
        shortName: awayComp.team?.shortDisplayName, logo: awayComp.team?.logo,
        color: awayComp.team?.color ? `#${awayComp.team.color}` : null,
        altColor: awayComp.team?.alternateColor ? `#${awayComp.team.alternateColor}` : null,
        score: parseInt(awayComp.score) || 0, record: awayComp.records?.[0]?.summary || '',
        linescores: (awayComp.linescores || []).map(l => l.value),
      },
      situation: {
        possession: situation.possession, down: situation.down, distance: situation.distance,
        yardLine: situation.yardLine, downDistanceText: situation.downDistanceText || '',
        possessionText: situation.possessionText || '', isRedZone: situation.isRedZone || false,
        lastPlay: situation.lastPlay?.text || '',
      },
      odds: { spread: odds.details || '', overUnder: odds.overUnder || null, provider: odds.provider?.name || '' },
    };
  });
  return events;
}

function parseSummary(data) {
  const boxscore = data.boxscore || {};
  const drives = data.drives || {};
  const scoringPlays = data.scoringPlays || [];
  const pickcenter = data.pickcenter || [];
  const leaders = data.leaders || [];
  const predictor = data.predictor || {};
  const winprob = data.winprobability || [];
  const injuries = data.injuries || [];
  const gameInfo = data.gameInfo || {};
  const news = data.news?.articles || [];

  const teamStats = (boxscore.teams || []).map(t => ({
    team: t.team?.displayName, abbreviation: t.team?.abbreviation, logo: t.team?.logo,
    stats: (t.statistics || []).map(s => ({ name: s.name, displayValue: s.displayValue, label: s.label })),
  }));

  const playerStats = (boxscore.players || []).map(teamPlayers => ({
    team: teamPlayers.team?.displayName, abbreviation: teamPlayers.team?.abbreviation,
    categories: (teamPlayers.statistics || []).map(cat => ({
      name: cat.name, labels: cat.labels || [],
      athletes: (cat.athletes || []).map(a => ({
        name: a.athlete?.displayName, jersey: a.athlete?.jersey,
        position: a.athlete?.position?.abbreviation, headshot: a.athlete?.headshot?.href, stats: a.stats || [],
      })),
    })),
  }));

  const scoring = scoringPlays.map(sp => ({
    text: sp.text, period: sp.period?.number, clock: sp.clock?.displayValue,
    team: sp.team?.displayName, abbreviation: sp.team?.abbreviation,
    homeScore: sp.homeScore, awayScore: sp.awayScore, type: sp.type?.text,
  }));

  const allDrives = (drives.previous || []).map(d => ({
    description: d.description, result: d.displayResult,
    team: d.team?.displayName, abbreviation: d.team?.abbreviation,
    yards: d.yards, plays: d.offensivePlays,
    timeOfPossession: d.timeOfPossession?.displayValue,
    start: { quarter: d.start?.period?.number, clock: d.start?.clock?.displayValue, yardLine: d.start?.yardLine },
    end: { quarter: d.end?.period?.number, clock: d.end?.clock?.displayValue },
    playList: (d.plays || []).map(p => ({
      text: p.text, type: p.type?.text, clock: p.clock?.displayValue, period: p.period?.number,
      down: p.start?.down, distance: p.start?.distance, yardLine: p.start?.yardLine,
      yardsGained: p.statYardage, scoringPlay: p.scoringPlay || false,
    })),
  }));
  
  let plays = [];
  if (data.plays) {
    plays = data.plays.map(p => ({
      text: p.text, description: p.text, type: p.type?.text || p.type, 
      clock: p.clock?.displayValue, period: p.period?.number,
      team: p.team?.abbreviation || p.team?.displayName,
      scoreValue: p.scoreValue, scoringPlay: p.scoringPlay || false,
    }));
  } else if (data.keyEvents) {
    plays = data.keyEvents.map(p => ({
      text: p.text, description: p.text, type: p.type?.text || p.type,
      clock: p.clock?.displayValue, period: p.period?.number,
      team: p.team?.abbreviation || p.team?.displayName,
      scoreValue: p.scoreValue, scoringPlay: p.scoringPlay || false,
    }));
  }

  const odds = pickcenter.map(p => ({
    provider: p.provider?.name, spread: p.details, overUnder: p.overUnder,
    homeMoneyline: p.homeTeamOdds?.moneyLine, awayMoneyline: p.awayTeamOdds?.moneyLine,
    homeSpreadOdds: p.homeTeamOdds?.spreadOdds, awaySpreadOdds: p.awayTeamOdds?.spreadOdds,
    overOdds: p.overOdds, underOdds: p.underOdds,
    homeFavorite: p.homeTeamOdds?.favorite || false, awayFavorite: p.awayTeamOdds?.favorite || false,
    homeOpenSpread: p.homeTeamOdds?.open?.pointSpread?.american, awayOpenSpread: p.awayTeamOdds?.open?.pointSpread?.american,
    homeOpenML: p.homeTeamOdds?.open?.moneyLine?.american, awayOpenML: p.awayTeamOdds?.open?.moneyLine?.american,
  }));

  const teamLeaders = leaders.map(tl => ({
    team: tl.team?.displayName, abbreviation: tl.team?.abbreviation,
    leaders: (tl.leaders || []).map(l => ({
      category: l.name, displayName: l.displayName,
      athletes: (l.leaders || []).map(a => ({
        name: a.athlete?.displayName, headshot: a.athlete?.headshot?.href,
        jersey: a.athlete?.jersey, position: a.athlete?.position?.abbreviation, stat: a.displayValue,
      })),
    })),
  }));

  const injuryReport = injuries.map(ti => ({
    team: ti.team?.displayName, abbreviation: ti.team?.abbreviation,
    injuries: (ti.injuries || []).map(inj => ({
      name: inj.athlete?.displayName, position: inj.athlete?.position?.abbreviation,
      status: inj.status, type: inj.type,
    })),
  }));

  const winProbability = winprob.map(wp => ({
    playId: wp.playId, homeWinPct: wp.homeWinPercentage,
    secondsLeft: wp.secondsLeft, tiePercentage: wp.tiePercentage,
  }));

  const prediction = {
    home: { name: predictor.homeTeam?.team?.displayName, winPct: predictor.homeTeam?.gameProjection },
    away: { name: predictor.awayTeam?.team?.displayName, winPct: predictor.awayTeam?.gameProjection },
  };

  return {
    teamStats, playerStats, scoring, drives: allDrives, plays, odds, leaders: teamLeaders,
    injuries: injuryReport, winProbability, prediction,
    news: news.slice(0, 10).map(n => ({
      headline: n.headline, description: n.description, published: n.published,
      image: n.images?.[0]?.url, link: n.links?.web?.href,
    })),
    gameInfo: {
      venue: gameInfo.venue?.fullName, city: gameInfo.venue?.address?.city,
      state: gameInfo.venue?.address?.state, attendance: gameInfo.attendance,
      weather: gameInfo.weather ? {
        temperature: gameInfo.weather.temperature, condition: gameInfo.weather.displayValue,
        wind: gameInfo.weather.wind?.displayValue,
      } : null,
    },
  };
}

function parseRoster(data) {
  const roster = [];
  const athletes = data.athletes || [];
  athletes.forEach(group => {
    const posGroup = group.position || 'other';
    (group.items || []).forEach(p => {
      roster.push({
        name: p.displayName, jersey: p.jersey,
        position: p.position?.abbreviation || posGroup, positionGroup: posGroup,
        age: p.age, height: p.displayHeight, weight: p.displayWeight,
        headshot: p.headshot?.href, experience: p.experience?.years, college: p.college?.name,
      });
    });
  });
  return { coach: data.coach?.[0]?.firstName + ' ' + data.coach?.[0]?.lastName, roster };
}

function extractKeyPlayers(rosterData, sport) {
  const { coach, roster } = rosterData;
  const keyPositions = {
    football: ['QB', 'RB', 'WR', 'TE', 'K'],
    basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
    baseball: ['SP', 'RP', 'C', 'SS', 'CF'],
    hockey: ['C', 'LW', 'RW', 'D', 'G'],
    soccer: ['GK', 'CB', 'CM', 'ST', 'LW'],
  };
  const positions = keyPositions[sport] || keyPositions.football;
  const byPosition = {};
  for (const p of roster) {
    const pos = p.position || 'Unknown';
    if (!byPosition[pos]) byPosition[pos] = [];
    byPosition[pos].push(p);
  }
  const lines = [];
  for (const pos of positions) {
    const players = byPosition[pos] || [];
    const top3 = players.slice(0, 3);
    if (top3.length > 0) lines.push(`  ${pos}: ${top3.map(p => `#${p.jersey} ${p.name}`).join(', ')}`);
  }
  return { coach, lines };
}

// ─── SESSION RUNTIME ───
const sessionRuntimes = new Map();
function getRuntime(sessionId) {
  if (!sessionRuntimes.has(sessionId)) {
    sessionRuntimes.set(sessionId, {
      lastCommentarySeq: -1,
      commentaryCache: { data: null, ts: 0 },
      commentaryHistory: [],
      rosterCache: { home: null, away: null, fetchedAt: 0 },
    });
  }
  return sessionRuntimes.get(sessionId);
}

// ─── ADMIN ROUTES ───
app.get('/api/admin/sports', requireAdmin, (req, res) => {
  const result = {};
  for (const [sportKey, sportVal] of Object.entries(SPORTS_CONFIG)) {
    result[sportKey] = {
      name: sportVal.name,
      leagues: Object.entries(sportVal.leagues).map(([lKey, lVal]) => ({ id: lKey, name: lVal.name })),
    };
  }
  res.json(result);
});

app.get('/api/admin/browse/:sport/:league', requireAdmin, async (req, res) => {
  try {
    const { sport, league } = req.params;
    const date = req.query.date;
    const sportConfig = SPORTS_CONFIG[sport];
    const leagueConfig = sportConfig?.leagues[league];
    if (!leagueConfig) return res.status(400).json({ error: 'Invalid league' });
    const url = espnScoreboard(leagueConfig.espnSlug, date);
    const data = await fetchCached(`browse_${sport}_${league}_${date || 'today'}`, url, 30000);
    res.json({ sport, league, events: parseScoreboard(data) });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.get('/api/admin/presets', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('commentator_presets').orderBy('createdAt', 'desc').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const { sport, league, espnEventId, gameName, commentators, settings } = req.body;
    const sportConfig = SPORTS_CONFIG[sport];
    const leagueConfig = sportConfig?.leagues[league];
    if (!leagueConfig) return res.status(400).json({ error: 'Invalid config' });

    const id = crypto.randomBytes(8).toString('hex');
    const session = {
      id, sport, league, espnSlug: leagueConfig.espnSlug, espnEventId,
      gameName: gameName || '', status: 'active',
      commentators: commentators || [
        { id: 'A', name: 'Big Mike', team: 'away', personality: 'barkley', avatarUrl: null },
        { id: 'B', name: 'Salty Steve', team: 'home', personality: 'skip', avatarUrl: null },
      ],
      settings: { preGameInterval: settings?.preGameInterval || 45, ...settings },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await db.collection('sessions').doc(id).set(session);
    res.json(session);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('sessions').orderBy('createdAt', 'desc').get();
    res.json(snap.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.patch('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  try {
    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    delete updates.id; await db.collection('sessions').doc(req.params.id).update(updates);
    const doc = await db.collection('sessions').doc(req.params.id).get();
    res.json(doc.data());
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('sessions').doc(req.params.id).delete();
    sessionRuntimes.delete(req.params.id); res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── PUBLIC ROUTES ───
app.get('/api/sessions', async (req, res) => {
  try {
    const snap = await db.collection('sessions').where('status', 'in', ['active', 'paused']).get();
    res.json(snap.docs.map(d => {
      const s = d.data();
      return { id: s.id, sport: s.sport, league: s.league, gameName: s.gameName, status: s.status, commentators: s.commentators };
    }));
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/sessions/:id/game', async (req, res) => {
  try {
    const doc = await db.collection('sessions').doc(req.params.id).get();
    const session = doc.data();
    const data = await fetchCached(`scoreboard_${session.espnSlug}`, espnScoreboard(session.espnSlug), CACHE_TTL.scoreboard);
    const game = parseScoreboard(data).find(e => e.id === session.espnEventId);
    res.json(game || { error: 'Not found' });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── COMMENTARY ENGINE ───
const COMMENTARY_COOLDOWN = 5000;
const STALE_COMMENTARY_MAX = 45000;
const MAX_HISTORY = 20;

function buildCommentaryPayload(game, summary, session) {
  if (!game || !summary) return null;
  const awayAbbr = game.away?.abbreviation || 'AWY', homeAbbr = game.home?.abbreviation || 'HME';
  const sport = session?.sport || 'football';
  let latestPlays = [], latestPlay = null, offenseTeam = awayAbbr;
  
  if (sport === 'football') {
    const drives = summary.drives || [];
    const latestDrive = drives[drives.length - 1];
    latestPlays = latestDrive?.playList || [];
    latestPlay = latestPlays[latestPlays.length - 1];
    offenseTeam = latestDrive?.abbreviation || awayAbbr;
  } else {
    let allPlays = summary.plays || summary.keyEvents || [];
    if (allPlays.length === 0 && summary.periods) summary.periods.forEach(p => { if (p.plays) allPlays = allPlays.concat(p.plays); });
    latestPlays = allPlays.slice(-10); latestPlay = allPlays[allPlays.length - 1];
    offenseTeam = latestPlay?.team?.abbreviation || awayAbbr;
  }
  if (!latestPlay) return null;

  return {
    gameId: session?.id, awayTeam: game.away, homeTeam: game.home, offenseTeam,
    event: {
      seq: latestPlays.length + (sport === 'football' ? (summary.drives?.length || 0) * 100 : 0),
      quarter: latestPlay.period || 1, clock: latestPlay.clock || '',
      description: latestPlay.text || latestPlay.description || '', result: latestPlay.type || 'Play',
    },
    state: { score: { [awayAbbr]: game.away?.score || 0, [homeAbbr]: game.home?.score || 0 } }
  };
}

app.get('/api/sessions/:id/commentary/latest', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const doc = await db.collection('sessions').doc(sessionId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    const session = doc.data();
    if (session.status === 'paused') return res.json({ turns: [], status: 'paused' });

    const runtime = getRuntime(sessionId);
    const now = Date.now();

    if (runtime.commentaryCache.data && (now - runtime.commentaryCache.ts) < COMMENTARY_COOLDOWN) return res.json(runtime.commentaryCache.data);

    const scoreData = await fetchCached(`scoreboard_${session.espnSlug}`, espnScoreboard(session.espnSlug), CACHE_TTL.scoreboard);
    const game = parseScoreboard(scoreData).find(e => e.id === session.espnEventId);

    if (!game || game.status?.state !== 'in') {
      const intervalMs = (session.settings?.preGameInterval || 45) * 1000;
      if (runtime.commentaryCache.data && (now - runtime.commentaryCache.ts) < intervalMs) return res.json(runtime.commentaryCache.data);

      const prePayload = buildPreGamePayload(game, session);
      const prompt = buildPreGamePrompt(prePayload, game, session);
      const llmData = await callModalLLM(MODAL_MISTRAL_URL, { messages: [{ role: 'user', content: prompt }], max_tokens: 300 });
      const turns = parseCommentary(llmData.choices[0].message.content, session.commentators[0], session.commentators[1]);
      const result = { turns, status: 'pre', play: { description: 'Pre-Game Talk', seq: now }, timestamp: now, commentators: { a: session.commentators[0], b: session.commentators[1] } };
      runtime.commentaryCache = { data: result, ts: now }; return res.json(result);
    }

    const summaryData = await fetchCached(`summary_${session.espnEventId}`, espnSummary(session.espnSlug, session.espnEventId), CACHE_TTL.summary);
    const summary = parseSummary(summaryData);
    const payload = buildCommentaryPayload(game, summary, session);
    if (!payload) return res.json({ turns: [], status: 'no_plays' });

    if (payload.event.seq === runtime.lastCommentarySeq && (now - runtime.commentaryCache.ts) < STALE_COMMENTARY_MAX) return res.json(runtime.commentaryCache.data);

    const prompt = buildCommentaryPrompt(payload, session, runtime);
    const llmData = await callModalLLM(MODAL_MISTRAL_URL, { messages: [{ role: 'user', content: prompt }], max_tokens: 250 });
    const turns = parseCommentary(llmData.choices[0].message.content, session.commentators[0], session.commentators[1]);

    runtime.lastCommentarySeq = payload.event.seq;
    const result = { turns, status: 'live', play: payload.event, score: payload.state.score, timestamp: now, commentators: { a: session.commentators[0], b: session.commentators[1] } };
    runtime.commentaryCache = { data: result, ts: now };
    runtime.commentaryHistory.unshift(result); if (runtime.commentaryHistory.length > MAX_HISTORY) runtime.commentaryHistory.pop();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function buildPreGamePayload(game, session) {
  return { awayTeam: game?.away || { name: 'Away' }, homeTeam: game?.home || { name: 'Home' }, records: { away: game?.away?.record, home: game?.home?.record } };
}

function buildPreGamePrompt(p, g, s) {
  return `Argue about ${p.awayTeam.name} vs ${p.homeTeam.name}. Be unhinged. 3 turns: [A], [B], [A].`;
}

// ─── START ───
app.listen(PORT, '0.0.0.0', () => console.log(`Sushi on ${PORT}`));