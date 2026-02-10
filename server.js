const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3007;

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
  const header = data.header || {};
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
  
  // Extract plays for basketball and other sports
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

// Extract key players per position for prompt injection
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
    if (top3.length > 0) {
      lines.push(`  ${pos}: ${top3.map(p => `#${p.jersey} ${p.name}`).join(', ')}`);
    }
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

// ─── ADMIN ROUTES: SPORTS BROWSING ───
app.get('/api/admin/sports', requireAdmin, (req, res) => {
  const result = {};
  for (const [sportKey, sportVal] of Object.entries(SPORTS_CONFIG)) {
    result[sportKey] = {
      name: sportVal.name,
      leagues: Object.entries(sportVal.leagues).map(([lKey, lVal]) => ({
        id: lKey,
        name: lVal.name,
      })),
    };
  }
  res.json(result);
});

app.get('/api/admin/browse/:sport/:league', requireAdmin, async (req, res) => {
  try {
    const { sport, league } = req.params;
    const date = req.query.date; // YYYYMMDD
    const sportConfig = SPORTS_CONFIG[sport];
    if (!sportConfig) return res.status(400).json({ error: `Unknown sport: ${sport}` });
    const leagueConfig = sportConfig.leagues[league];
    if (!leagueConfig) return res.status(400).json({ error: `Unknown league: ${league}` });

    const url = espnScoreboard(leagueConfig.espnSlug, date);
    const data = await fetchCached(`browse_${sport}_${league}_${date || 'today'}`, url, 30000);
    const events = parseScoreboard(data);
    res.json({ sport, league, events });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch scoreboard', message: err.message });
  }
});

// ─── ADMIN ROUTES: COMMENTATOR PRESETS ───

// List saved presets
app.get('/api/admin/presets', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('commentator_presets').orderBy('createdAt', 'desc').get();
    const presets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(presets);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list presets' });
  }
});

// Save a preset
app.post('/api/admin/presets', requireAdmin, async (req, res) => {
  try {
    const { name, personality, customPrompt } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomBytes(6).toString('hex');
    const preset = {
      name,
      personality: personality || 'barkley',
      customPrompt: customPrompt || null,
      createdAt: new Date().toISOString(),
    };
    await db.collection('commentator_presets').doc(id).set(preset);
    res.json({ id, ...preset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save preset' });
  }
});

// Delete a preset
app.delete('/api/admin/presets/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('commentator_presets').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete preset' });
  }
});

// ─── ADMIN ROUTES: SESSION CRUD ───

// Create session
app.post('/api/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const { sport, league, espnEventId, gameName, gameDate, homeTeam, awayTeam, commentators } = req.body;
    if (!sport || !league || !espnEventId) {
      return res.status(400).json({ error: 'sport, league, and espnEventId are required' });
    }

    const sportConfig = SPORTS_CONFIG[sport];
    if (!sportConfig) return res.status(400).json({ error: `Unknown sport: ${sport}` });
    const leagueConfig = sportConfig.leagues[league];
    if (!leagueConfig) return res.status(400).json({ error: `Unknown league: ${league}` });

    const id = crypto.randomBytes(8).toString('hex');
    const session = {
      id, sport, league, espnSlug: leagueConfig.espnSlug,
      espnEventId, gameName: gameName || '', gameDate: gameDate || new Date().toISOString(),
      status: 'active',
      homeTeam: homeTeam || {},
      awayTeam: awayTeam || {},
      commentators: commentators || [
        { id: 'A', name: 'Big Mike', team: 'away', personality: 'barkley', customPrompt: null },
        { id: 'B', name: 'Salty Steve', team: 'home', personality: 'skip', customPrompt: null },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Fetch rosters for both teams
    const runtime = getRuntime(id);
    if (homeTeam?.id) {
      try {
        const homeRosterData = await fetchCached(`roster_${homeTeam.id}`, espnRoster(leagueConfig.espnSlug, homeTeam.id), CACHE_TTL.roster);
        runtime.rosterCache.home = parseRoster(homeRosterData);
      } catch (e) { console.error('Failed to fetch home roster:', e.message); }
    }
    if (awayTeam?.id) {
      try {
        const awayRosterData = await fetchCached(`roster_${awayTeam.id}`, espnRoster(leagueConfig.espnSlug, awayTeam.id), CACHE_TTL.roster);
        runtime.rosterCache.away = parseRoster(awayRosterData);
      } catch (e) { console.error('Failed to fetch away roster:', e.message); }
    }
    runtime.rosterCache.fetchedAt = Date.now();

    await db.collection('sessions').doc(id).set(session);
    res.json(session);
  } catch (err) {
    console.error('Create session error:', err.message);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// List sessions
app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('sessions').orderBy('createdAt', 'desc').get();
    const sessions = snap.docs.map(d => d.data());
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Update session
app.patch('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    delete updates.id;
    delete updates.createdAt;
    await db.collection('sessions').doc(id).update(updates);
    const doc = await db.collection('sessions').doc(id).get();
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// Delete session
app.delete('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('sessions').doc(id).delete();
    sessionRuntimes.delete(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Start session
app.post('/api/admin/sessions/:id/start', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('sessions').doc(id).update({ status: 'active', updatedAt: new Date().toISOString() });
    getRuntime(id); // ensure runtime exists
    const doc = await db.collection('sessions').doc(id).get();
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// Stop session
app.post('/api/admin/sessions/:id/stop', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('sessions').doc(id).update({ status: 'paused', updatedAt: new Date().toISOString() });
    const doc = await db.collection('sessions').doc(id).get();
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop session' });
  }
});

// ─── PUBLIC SESSION ROUTES ───

// List active sessions (public)
app.get('/api/sessions', async (req, res) => {
  try {
    const snap = await db.collection('sessions').where('status', 'in', ['active', 'paused']).get();
    const sessions = snap.docs.map(d => {
      const s = d.data();
      return {
        id: s.id, sport: s.sport, league: s.league, gameName: s.gameName, gameDate: s.gameDate,
        status: s.status, homeTeam: s.homeTeam, awayTeam: s.awayTeam,
        commentators: (s.commentators || []).map(c => ({ id: c.id, name: c.name, team: c.team })),
      };
    });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Session game data
app.get('/api/sessions/:id/game', async (req, res) => {
  try {
    const doc = await db.collection('sessions').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Session not found' });
    const session = doc.data();
    const url = espnScoreboard(session.espnSlug);
    const data = await fetchCached(`scoreboard_${session.espnSlug}`, url, CACHE_TTL.scoreboard);
    const events = parseScoreboard(data);
    const game = events.find(e => e.id === session.espnEventId) || null;
    if (!game) return res.json({ error: 'Game not found in current scoreboard', session: { id: session.id, gameName: session.gameName } });
    res.json(game);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch game', message: err.message });
  }
});

// Session summary
app.get('/api/sessions/:id/summary', async (req, res) => {
  try {
    const doc = await db.collection('sessions').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Session not found' });
    const session = doc.data();
    const url = espnSummary(session.espnSlug, session.espnEventId);
    const data = await fetchCached(`summary_${session.espnEventId}`, url, CACHE_TTL.summary);
    const summary = parseSummary(data);
    res.json(summary);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch summary', message: err.message });
  }
});

// Session news
app.get('/api/sessions/:id/news', async (req, res) => {
  try {
    const doc = await db.collection('sessions').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Session not found' });
    const session = doc.data();
    const url = espnNews(session.espnSlug);
    const data = await fetchCached(`news_${session.espnSlug}`, url, CACHE_TTL.news);
    const articles = (data.articles || []).slice(0, 15).map(a => ({
      headline: a.headline, description: a.description, published: a.published,
      image: a.images?.[0]?.url, link: a.links?.web?.href,
    }));
    res.json(articles);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch news', message: err.message });
  }
});

// ─── AI COMMENTARY ENGINE (session-scoped) ───

const COMMENTARY_COOLDOWN = 5000;
const STALE_COMMENTARY_MAX = 45000;
const MAX_HISTORY = 20;

function buildCommentaryPayload(game, summary, session) {
  if (!game || !summary) return null;

  const awayName = game.away?.name || game.away?.abbreviation || 'Away';
  const homeName = game.home?.name || game.home?.abbreviation || 'Home';
  const awayAbbr = game.away?.abbreviation || 'AWY';
  const homeAbbr = game.home?.abbreviation || 'HME';

  // Get sport type
  const sport = session?.sport || 'football';
  
  // Extract plays based on sport type
  let latestPlays = [];
  let latestPlay = null;
  let offenseTeam = awayAbbr;
  let isAwayOffense = true;
  
  if (sport === 'football') {
    // Football uses drives
    const drives = summary.drives || [];
    const latestDrive = drives[drives.length - 1];
    latestPlays = latestDrive?.playList || [];
    latestPlay = latestPlays[latestPlays.length - 1];
    offenseTeam = latestDrive?.abbreviation || awayAbbr;
    isAwayOffense = offenseTeam === awayAbbr;
  } else {
    // Basketball (and other sports) use plays array or keyEvents
    // Basketball plays can be in various locations in the ESPN API response
    let allPlays = [];
    if (sport === 'basketball') {
      // Basketball plays might be in different places depending on API response
      allPlays = summary.plays || summary.keyEvents || summary.teamStats?.plays || [];
      // Also check for plays nested in periods
      if (allPlays.length === 0 && summary.periods) {
        summary.periods.forEach(period => {
          if (period.plays) allPlays = allPlays.concat(period.plays);
        });
      }
    } else {
      allPlays = summary.plays || summary.keyEvents || [];
    }
    if (allPlays.length > 0) {
      latestPlays = allPlays.slice(-10); // Last 10 plays
      latestPlay = allPlays[allPlays.length - 1];
    }
    // For basketball, determine offense from play data
    offenseTeam = latestPlay?.team?.abbreviation || awayAbbr;
    isAwayOffense = offenseTeam === awayAbbr;
  }
  
  if (!latestPlay) return null;

  const last3 = latestPlays.slice(-4, -1).map(p => p.text || p.description || '').filter(Boolean);
  const playTypes = latestPlays.slice(-6).map(p => p.type || '');
  
  // Sport-specific play type detection
  let playType = 'Unknown';
  let result = 'Play';
  let yards = 0;
  
  if (sport === 'football') {
    const passCount = playTypes.filter(t => t.toLowerCase().includes('pass')).length;
    const runCount = playTypes.filter(t => t.toLowerCase().includes('rush') || t.toLowerCase().includes('run')).length;
    const tendency = passCount > runCount ? 'pass-heavy' : runCount > passCount ? 'run-heavy' : 'balanced';

    const playTypeStr = (latestPlay.type || '').toLowerCase();
    if (playTypeStr.includes('pass')) playType = 'Pass';
    else if (playTypeStr.includes('rush') || playTypeStr.includes('run')) playType = 'Run';
    else if (playTypeStr.includes('punt')) playType = 'Punt';
    else if (playTypeStr.includes('kickoff')) playType = 'Kickoff';
    else if (playTypeStr.includes('field goal')) playType = 'Field Goal';
    else if (playTypeStr.includes('sack')) playType = 'Sack';
    else if (playTypeStr.includes('penalty')) playType = 'Penalty';
    
    yards = latestPlay.yardsGained || latestPlay.statYardage || 0;
    if (latestPlay.scoringPlay) result = 'Scoring Play';
    else if (latestPlay.text?.toLowerCase().includes('first down') || (latestPlay.down === 1 && yards >= (latestPlay.distance || 10))) result = 'First Down';
    else if (latestPlay.text?.toLowerCase().includes('incomplete')) result = 'Incomplete';
    else if (latestPlay.text?.toLowerCase().includes('interception') || latestPlay.text?.toLowerCase().includes('intercepted')) result = 'Turnover - Interception';
    else if (latestPlay.text?.toLowerCase().includes('fumble')) result = 'Turnover - Fumble';
    else result = `Gain of ${yards}`;
  } else if (sport === 'basketball') {
    // Basketball play types
    const playText = (latestPlay.text || latestPlay.description || '').toLowerCase();
    if (playText.includes('three-pointer') || playText.includes('3-point')) playType = 'Three Pointer';
    else if (playText.includes('dunk')) playType = 'Dunk';
    else if (playText.includes('layup')) playType = 'Layup';
    else if (playText.includes('free throw')) playType = 'Free Throw';
    else if (playText.includes('jump shot')) playType = 'Jump Shot';
    else if (playText.includes('steal')) playType = 'Steal';
    else if (playText.includes('block')) playType = 'Block';
    else if (playText.includes('rebound')) playType = 'Rebound';
    else if (playText.includes('turnover')) playType = 'Turnover';
    else playType = 'Field Goal';
    
    yards = latestPlay.scoreValue || 0;
    if (latestPlay.scoringPlay || playText.includes('makes')) result = `${yards} Points`;
    else if (playText.includes('miss')) result = 'Missed Shot';
    else if (playText.includes('rebound')) result = 'Rebound';
    else if (playText.includes('turnover')) result = 'Turnover';
    else if (playText.includes('foul')) result = 'Foul';
    else result = playType;
  } else {
    // Generic for other sports
    playType = latestPlay.type || 'Play';
    yards = latestPlay.yardsGained || latestPlay.statYardage || 0;
    result = latestPlay.result || 'Play';
  }

  let mood = 'routine';
  if (latestPlay.scoringPlay) mood = 'electric';
  else if ((latestPlay.text || latestPlay.description || '').toLowerCase().includes('turnover')) mood = 'disaster';
  else if (yards >= 20 || (sport === 'basketball' && latestPlay.scoreValue >= 3)) mood = 'momentum_shift';
  else if (yards >= 10 || (sport === 'basketball' && latestPlay.scoreValue === 2)) mood = 'big_play';
  else if ((latestPlay.text || '').toLowerCase().includes('sack')) mood = 'defensive_dominance';
  else if ((latestPlay.text || '').toLowerCase().includes('foul') || (latestPlay.text || '').toLowerCase().includes('penalty')) mood = 'controversial';
  else if (yards <= 0) mood = 'stuffed';

  return {
    gameId: session ? session.id : `game-${new Date().getFullYear()}`,
    awayTeam: { name: awayName, abbreviation: awayAbbr },
    homeTeam: { name: homeName, abbreviation: homeAbbr },
    offenseTeam: isAwayOffense ? awayAbbr : homeAbbr,
    defenseTeam: isAwayOffense ? homeAbbr : awayAbbr,
    event: {
      seq: latestPlays.length + ((sport === 'football' && summary.drives?.previous) ? summary.drives.previous.length * 100 : 0),
      quarter: latestPlay.period || game.status?.period || 1,
      clock: latestPlay.clock || game.status?.clock || '',
      down: latestPlay.down || null,
      distance: latestPlay.distance || null,
      yardLine: latestPlay.yardLine ? `${offenseTeam} ${latestPlay.yardLine}` : '',
      offense: isAwayOffense ? awayAbbr : homeAbbr,
      defense: isAwayOffense ? homeAbbr : awayAbbr,
      playType, description: latestPlay.text || latestPlay.description || '', yardsGained: yards, result, mood,
    },
    state: {
      score: { [awayAbbr]: game.away?.score || 0, [homeAbbr]: game.home?.score || 0 },
      possession: offenseTeam,
      last3Plays: last3.length > 0 ? last3 : ['Game in progress'],
      rollingSummaryShort: sport === 'football' ? `${isAwayOffense ? awayName : homeName} on offense` : `${offenseTeam} with the ball`,
    },
  };
}

function buildCommentaryPrompt(payload, session, runtime) {
  const awayName = payload.awayTeam.name;
  const homeName = payload.homeTeam.name;
  const awayAbbr = payload.awayTeam.abbreviation;
  const homeAbbr = payload.homeTeam.abbreviation;

  const sport = session?.sport || 'football';
  const sportCtx = getSportContext(sport);

  // Build commentator descriptions from session config
  const commentators = session?.commentators || [
    { id: 'A', name: 'Big Mike', team: 'away', personality: 'barkley', customPrompt: null },
    { id: 'B', name: 'Salty Steve', team: 'home', personality: 'skip', customPrompt: null },
  ];

  const commentatorA = commentators.find(c => c.id === 'A') || commentators[0];
  const commentatorB = commentators.find(c => c.id === 'B') || commentators[1];

  const teamA = commentatorA.team === 'home' ? homeName : awayName;
  const teamAbbrA = commentatorA.team === 'home' ? homeAbbr : awayAbbr;
  const teamB = commentatorB.team === 'home' ? homeName : awayName;
  const teamAbbrB = commentatorB.team === 'home' ? homeAbbr : awayAbbr;

  const personalityA = commentatorA.customPrompt || PERSONALITY_PRESETS[commentatorA.personality]?.prompt || 'Loud, dramatic, biased';
  const personalityB = commentatorB.customPrompt || PERSONALITY_PRESETS[commentatorB.personality]?.prompt || 'Sarcastic, mocking, dismissive';

  // Possession context
  const offenseTeamName = payload.offenseTeam === awayAbbr ? awayName : homeName;
  const defenseTeamName = payload.offenseTeam === awayAbbr ? homeName : awayName;

  let possessionBlock = '';
  if (sport === 'football') {
    possessionBlock = `
CURRENT POSSESSION: ${offenseTeamName} (${payload.offenseTeam}) has the ball.
This is an OFFENSIVE play by ${offenseTeamName} against ${defenseTeamName}.
Yards gained = GOOD for ${offenseTeamName}, BAD for ${defenseTeamName}.
Turnovers = BAD for ${offenseTeamName}, GOOD for ${defenseTeamName}.`;
  } else if (sport === 'basketball') {
    possessionBlock = `
CURRENT POSSESSION: ${offenseTeamName} (${payload.offenseTeam}) has the ball.
This is a BASKETBALL game. Points are scored via 2-pointers, 3-pointers, and free throws.
Momentum shifts quickly with scoring runs.`;
  }

  // Roster block
  let rosterBlock = '';
  if (runtime?.rosterCache) {
    const rc = runtime.rosterCache;
    if (rc.home) {
      const hp = extractKeyPlayers(rc.home, sport);
      rosterBlock += `\nKEY PLAYERS FOR ${homeName} (Coach: ${hp.coach}):\n${hp.lines.join('\n')}`;
    }
    if (rc.away) {
      const ap = extractKeyPlayers(rc.away, sport);
      rosterBlock += `\nKEY PLAYERS FOR ${awayName} (Coach: ${ap.coach}):\n${ap.lines.join('\n')}`;
    }
    if (rosterBlock) {
      rosterBlock += `\nIMPORTANT: Only reference players on these rosters. Do NOT mention retired or traded players.`;
    }
  }

  return `You are an AI commentary engine for a live ${sportCtx.periodName ? sport : ''} broadcast.

${sportCtx.promptFrame}

You produce short, entertaining, argumentative commentary between two unhinged commentators.

COMMENTATOR A — "${commentatorA.name}"
- Rooting for: ${teamA} (${teamAbbrA})
- Personality: ${personalityA}
- Treats every positive ${teamAbbrA} play as genius, every negative play as a conspiracy

COMMENTATOR B — "${commentatorB.name}"
- Rooting for: ${teamB} (${teamAbbrB})
- Personality: ${personalityB}
- Downplays ${teamAbbrA} success, hypes ${teamAbbrB}
${possessionBlock}
${rosterBlock}

Rules:
- Both speak like they are watching live
- They argue DIRECTLY with each other, never agree politely
- If info is not in the data, do NOT invent it
- Keep responses punchy and short
- The "mood" field hints at emotional tone: use it

OUTPUT FORMAT — Produce EXACTLY 3 turns:

[A] ${commentatorA.name} reacts to the play. 1-2 sentences. Maximum hype. Reference a real field.
[B] ${commentatorB.name} argues back. 2-3 sentences. Downplay or blame. Reference a different field.
[A] ${commentatorA.name} fires back. 1-2 sentences. Predict next play type (run/pass/special). Include confidence: X.X

Here is the play data:
${JSON.stringify(payload, null, 2)}

Respond with ONLY the 3 turns. No preamble, no explanation.`;
}

function parseCommentary(raw, commentatorA, commentatorB) {
  const nameA = commentatorA?.name || 'Big Mike';
  const nameB = commentatorB?.name || 'Salty Steve';
  const teamA = commentatorA?.team || 'away';
  const teamB = commentatorB?.team || 'home';

  const lines = raw.trim().split('\n').filter(l => l.trim());
  const turns = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[A]')) {
      if (current) turns.push(current);
      current = { speaker: 'A', name: nameA, team: teamA, text: trimmed.replace(/^\[A\]\s*/, '').trim() };
    } else if (trimmed.startsWith('[B]')) {
      if (current) turns.push(current);
      current = { speaker: 'B', name: nameB, team: teamB, text: trimmed.replace(/^\[B\]\s*/, '').trim() };
    } else if (current) {
      current.text += ' ' + trimmed;
    }
  }
  if (current) turns.push(current);

  const lastA = [...turns].reverse().find(t => t.speaker === 'A');
  if (lastA) {
    const confMatch = lastA.text.match(/confidence[:\s]*([01]\.\d+)/i) || lastA.text.match(/(\d\.\d+)\s*confidence/i) || lastA.text.match(/([01]\.\d+)/);
    if (confMatch) lastA.confidence = parseFloat(confMatch[1]);
    const predMatch = lastA.text.match(/next play[^.]*?(run|pass|special|kick|punt|field goal)/i);
    if (predMatch) lastA.prediction = predMatch[1].toLowerCase();
  }

  return turns;
}

// Session commentary endpoint
app.get('/api/sessions/:id/commentary/latest', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const doc = await db.collection('sessions').doc(sessionId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Session not found' });
    const session = doc.data();

    if (session.status === 'paused') {
      return res.json({ turns: [], status: 'paused', message: 'Session is paused' });
    }

    const runtime = getRuntime(sessionId);
    const now = Date.now();

    if (runtime.commentaryCache.data && (now - runtime.commentaryCache.ts) < COMMENTARY_COOLDOWN) {
      return res.json(runtime.commentaryCache.data);
    }

    // Get game data
    const scoreUrl = espnScoreboard(session.espnSlug);
    const scoreData = await fetchCached(`scoreboard_${session.espnSlug}`, scoreUrl, CACHE_TTL.scoreboard);
    const events = parseScoreboard(scoreData);
    const game = events.find(e => e.id === session.espnEventId);

    if (!game || game.status?.state !== 'in') {
      const prePayload = buildPreGamePayload(game, session);
      if (!prePayload) {
        return res.json({ turns: [], status: 'waiting', message: 'Waiting for game to start' });
      }
      const prompt = buildPreGamePrompt(prePayload, game, session);
      const llmData = await callModalLLM(MODAL_MISTRAL_URL, {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300, temperature: 0.9,
      });
      const rawText = llmData.choices?.[0]?.message?.content || '';
      const commentators = session.commentators || [];
      const commentatorA = commentators.find(c => c.id === 'A') || commentators[0];
      const commentatorB = commentators.find(c => c.id === 'B') || commentators[1];
      const turns = parseCommentary(rawText, commentatorA, commentatorB);

      const result = {
        turns, status: game?.status?.state === 'post' ? 'post' : 'pre',
        raw: rawText, timestamp: now,
        commentators: { a: commentatorA, b: commentatorB },
      };
      runtime.commentaryCache = { data: result, ts: now };
      return res.json(result);
    }

    // Live game — get summary
    const summaryUrl = espnSummary(session.espnSlug, session.espnEventId);
    const summaryData = await fetchCached(`summary_${session.espnEventId}`, summaryUrl, CACHE_TTL.summary);
    const summary = parseSummary(summaryData);

    const payload = buildCommentaryPayload(game, summary, session);
    if (!payload) {
      return res.json({ turns: [], status: 'no_plays', message: 'No plays available yet' });
    }

    const currentSeq = payload.event.seq;
    const isNewPlay = currentSeq !== runtime.lastCommentarySeq;
    const commentaryAge = now - runtime.commentaryCache.ts;
    const isStale = commentaryAge > STALE_COMMENTARY_MAX;

    if (!isNewPlay && !isStale && runtime.commentaryCache.data?.turns?.length > 0) {
      return res.json(runtime.commentaryCache.data);
    }

    // Refresh roster cache if needed (every 5 minutes)
    if (now - runtime.rosterCache.fetchedAt > CACHE_TTL.roster) {
      if (session.homeTeam?.id) {
        try {
          const hrd = await fetchCached(`roster_${session.homeTeam.id}`, espnRoster(session.espnSlug, session.homeTeam.id), CACHE_TTL.roster);
          runtime.rosterCache.home = parseRoster(hrd);
        } catch (e) {}
      }
      if (session.awayTeam?.id) {
        try {
          const ard = await fetchCached(`roster_${session.awayTeam.id}`, espnRoster(session.espnSlug, session.awayTeam.id), CACHE_TTL.roster);
          runtime.rosterCache.away = parseRoster(ard);
        } catch (e) {}
      }
      runtime.rosterCache.fetchedAt = now;
    }

    const prompt = buildCommentaryPrompt(payload, session, runtime);
    const commentators = session.commentators || [];
    const commentatorA = commentators.find(c => c.id === 'A') || commentators[0];
    const commentatorB = commentators.find(c => c.id === 'B') || commentators[1];

    const llmData = await callModalLLM(MODAL_MISTRAL_URL, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250, temperature: 0.9,
    });
    const rawText = llmData.choices?.[0]?.message?.content || '';
    const turns = parseCommentary(rawText, commentatorA, commentatorB);

    runtime.lastCommentarySeq = currentSeq;
    const result = {
      turns, status: 'live',
      play: {
        description: payload.event.description, quarter: payload.event.quarter,
        clock: payload.event.clock, yardsGained: payload.event.yardsGained,
        playType: payload.event.playType, result: payload.event.result, mood: payload.event.mood,
      },
      score: payload.state.score,
      timestamp: now,
      commentators: { a: commentatorA, b: commentatorB },
    };

    runtime.commentaryCache = { data: result, ts: now };

    // Store in history
    runtime.commentaryHistory.unshift(result);
    if (runtime.commentaryHistory.length > MAX_HISTORY) runtime.commentaryHistory.pop();

    res.json(result);
  } catch (err) {
    console.error('Session commentary error:', err.message);
    const runtime = sessionRuntimes.get(req.params.id);
    if (runtime?.commentaryCache?.data) {
      return res.json({ ...runtime.commentaryCache.data, status: 'error_cached', error: err.message });
    }
    res.status(500).json({ turns: [], status: 'error', message: err.message });
  }
});

// Session commentary history
app.get('/api/sessions/:id/commentary/history', (req, res) => {
  const runtime = sessionRuntimes.get(req.params.id);
  res.json(runtime?.commentaryHistory || []);
});

// Pre-game payload builder
function buildPreGamePayload(game, session) {
  if (!game) return null;
  return {
    awayTeam: { name: game.away?.name || 'Away', abbreviation: game.away?.abbreviation || 'AWY' },
    homeTeam: { name: game.home?.name || 'Home', abbreviation: game.home?.abbreviation || 'HME' },
    score: { away: game.away?.score || 0, home: game.home?.score || 0 },
    odds: game.odds || {},
    records: { away: game.away?.record || '', home: game.home?.record || '' },
  };
}

function buildPreGamePrompt(payload, game, session) {
  const awayName = payload.awayTeam.name;
  const homeName = payload.homeTeam.name;
  const isPre = game?.status?.state === 'pre';

  const commentators = session?.commentators || [
    { id: 'A', name: 'Big Mike', team: 'away', personality: 'barkley', customPrompt: null },
    { id: 'B', name: 'Salty Steve', team: 'home', personality: 'skip', customPrompt: null },
  ];
  const commentatorA = commentators.find(c => c.id === 'A') || commentators[0];
  const commentatorB = commentators.find(c => c.id === 'B') || commentators[1];
  const teamA = commentatorA.team === 'home' ? homeName : awayName;
  const teamB = commentatorB.team === 'home' ? homeName : awayName;

  const personalityA = commentatorA.customPrompt || PERSONALITY_PRESETS[commentatorA.personality]?.prompt || 'Loud, dramatic, biased';
  const personalityB = commentatorB.customPrompt || PERSONALITY_PRESETS[commentatorB.personality]?.prompt || 'Sarcastic, mocking, dismissive';

  const sport = session?.sport || 'football';
  const sportCtx = getSportContext(sport);
  const gameName = session?.gameName || `${awayName} vs ${homeName}`;

  const scenario = isPre
    ? `${gameName} is about to start! ${awayName} (${payload.records.away}) vs ${homeName} (${payload.records.home}). Spread: ${payload.odds?.spread || 'unknown'}. Over/Under: ${payload.odds?.overUnder || 'unknown'}.`
    : `${gameName} is OVER! Final: ${awayName} ${payload.score.away} - ${homeName} ${payload.score.home}.`;

  return `You are an AI commentary engine for a live ${sport} broadcast.

${sportCtx.promptFrame}

You produce short, entertaining, argumentative commentary between two unhinged commentators.

COMMENTATOR A — "${commentatorA.name}"
- Rooting for: ${teamA}
- Personality: ${personalityA}

COMMENTATOR B — "${commentatorB.name}"
- Rooting for: ${teamB}
- Personality: ${personalityB}

They argue DIRECTLY. Never agree. Keep it punchy and short.

Scenario: ${scenario}

${isPre ? 'Generate pre-game hype trash talk. Each commentator should make a bold prediction.' : 'Generate post-game reaction. Winner\'s commentator gloats, loser\'s makes excuses.'}

OUTPUT FORMAT — Produce EXACTLY 3 turns:
[A] ${commentatorA.name}. 1-2 sentences.
[B] ${commentatorB.name}. 2-3 sentences.
[A] ${commentatorA.name} fires back. 1-2 sentences.${isPre ? ' Include a score prediction.' : ''}

Respond with ONLY the 3 turns. No preamble.`;
}

// ─── BACKWARD COMPATIBLE OLD ROUTES ───
// These proxy to the first active session

async function getFirstActiveSession() {
  const snap = await db.collection('sessions').where('status', '==', 'active').limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

// Old scoreboard route (still works directly with NFL)
const ESPN_SCOREBOARD_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=3';
const ESPN_SUMMARY_NFL = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`;
const ESPN_ROSTER_NFL = (teamId) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;
const ESPN_NEWS_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=15';

let superBowlEventId = null;
let superBowlTeams = null;

async function findSuperBowl() {
  const data = await fetchCached('scoreboard', ESPN_SCOREBOARD_NFL, CACHE_TTL.scoreboard);
  const events = data.events || [];
  let sbEvent = events.find(e =>
    (e.name || '').toLowerCase().includes('super bowl') ||
    (e.shortName || '').toLowerCase().includes('super bowl') ||
    (e.competitions?.[0]?.notes?.[0]?.headline || '').toLowerCase().includes('super bowl')
  );
  if (!sbEvent && events.length > 0) sbEvent = events[events.length - 1];
  if (sbEvent) {
    superBowlEventId = sbEvent.id;
    const comp = sbEvent.competitions?.[0];
    if (comp) {
      const homeTeam = comp.competitors?.find(c => c.homeAway === 'home');
      const awayTeam = comp.competitors?.find(c => c.homeAway === 'away');
      superBowlTeams = {
        home: { id: homeTeam?.team?.id, abbr: homeTeam?.team?.abbreviation },
        away: { id: awayTeam?.team?.id, abbr: awayTeam?.team?.abbreviation },
      };
    }
  }
  return sbEvent;
}

findSuperBowl().then(sb => {
  if (sb) console.log(`Found Super Bowl: ${sb.name} (Event ID: ${sb.id})`);
  else console.log('No Super Bowl event found in current postseason scoreboard');
}).catch(err => console.error('Init error:', err.message));

app.get('/api/scoreboard', async (req, res) => {
  try {
    const data = await fetchCached('scoreboard', ESPN_SCOREBOARD_NFL, CACHE_TTL.scoreboard);
    const events = parseScoreboard(data);
    res.json({ events, superBowlEventId });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch scoreboard', message: err.message });
  }
});

app.get('/api/game', async (req, res) => {
  try {
    // Try session-based first
    const session = await getFirstActiveSession();
    if (session) {
      const url = espnScoreboard(session.espnSlug);
      const data = await fetchCached(`scoreboard_${session.espnSlug}`, url, CACHE_TTL.scoreboard);
      const events = parseScoreboard(data);
      const game = events.find(e => e.id === session.espnEventId);
      if (game) return res.json(game);
    }
    // Fallback to old Super Bowl logic
    await findSuperBowl();
    const data = await fetchCached('scoreboard', ESPN_SCOREBOARD_NFL, CACHE_TTL.scoreboard);
    const events = parseScoreboard(data);
    const sb = events.find(e => e.id === superBowlEventId) || events[events.length - 1];
    if (!sb) return res.json({ error: 'No game found', events: [] });
    res.json(sb);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch game', message: err.message });
  }
});

app.get('/api/summary', async (req, res) => {
  try {
    const session = await getFirstActiveSession();
    if (session) {
      const url = espnSummary(session.espnSlug, session.espnEventId);
      const data = await fetchCached(`summary_${session.espnEventId}`, url, CACHE_TTL.summary);
      return res.json(parseSummary(data));
    }
    if (!superBowlEventId) await findSuperBowl();
    const eventId = req.query.event || superBowlEventId;
    if (!eventId) return res.status(404).json({ error: 'No event ID available' });
    const data = await fetchCached(`summary_${eventId}`, ESPN_SUMMARY_NFL(eventId), CACHE_TTL.summary);
    res.json(parseSummary(data));
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch summary', message: err.message });
  }
});

app.get('/api/roster/:teamId', async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const data = await fetchCached(`roster_${teamId}`, ESPN_ROSTER_NFL(teamId), CACHE_TTL.roster);
    res.json(parseRoster(data));
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch roster', message: err.message });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    const session = await getFirstActiveSession();
    if (session) {
      const url = espnNews(session.espnSlug);
      const data = await fetchCached(`news_${session.espnSlug}`, url, CACHE_TTL.news);
      const articles = (data.articles || []).slice(0, 15).map(a => ({
        headline: a.headline, description: a.description, published: a.published,
        image: a.images?.[0]?.url, link: a.links?.web?.href,
      }));
      return res.json(articles);
    }
    const data = await fetchCached('news', ESPN_NEWS_NFL, CACHE_TTL.news);
    const articles = (data.articles || []).slice(0, 15).map(a => ({
      headline: a.headline, description: a.description, published: a.published,
      image: a.images?.[0]?.url, link: a.links?.web?.href,
    }));
    res.json(articles);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch news', message: err.message });
  }
});

// Old commentary routes — proxy to first active session
app.get('/api/commentary', async (req, res) => {
  try {
    const session = await getFirstActiveSession();
    if (session) {
      // Redirect internally to session commentary
      const response = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${session.id}/commentary/latest`);
      const data = await response.json();
      return res.json(data);
    }
    res.json({ turns: [], status: 'no_session', message: 'No active session' });
  } catch (err) {
    res.status(500).json({ turns: [], status: 'error', message: err.message });
  }
});

app.get('/api/commentary/latest', async (req, res) => {
  try {
    const session = await getFirstActiveSession();
    if (session) {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${session.id}/commentary/latest`);
      const data = await response.json();
      return res.json(data);
    }
    res.json({ turns: [], status: 'no_session', message: 'No active session' });
  } catch (err) {
    res.status(500).json({ turns: [], status: 'error', message: err.message });
  }
});

app.get('/api/commentary/history', async (req, res) => {
  try {
    const session = await getFirstActiveSession();
    if (session) {
      const runtime = sessionRuntimes.get(session.id);
      return res.json(runtime?.commentaryHistory || []);
    }
    res.json([]);
  } catch (err) {
    res.json([]);
  }
});

// Health/status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    superBowlEventId,
    superBowlTeams,
    activeSessions: sessionRuntimes.size,
    cacheKeys: Object.keys(cache),
    uptime: process.uptime(),
  });
});

// ─── PIPER TTS via MODAL ───
const MODAL_PIPER_URL = process.env.MODAL_PIPER_URL || 'https://mousears1090--sushi-piper-tts-tts.modal.run';

app.post('/api/tts', async (req, res) => {
  try {
    const text = req.body.text || req.query.text;
    if (!text) return res.status(400).json({ error: 'text required' });
    
    // Call Modal Piper TTS
    const response = await fetch(MODAL_PIPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    
    if (!response.ok) {
      throw new Error(`Modal Piper returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Return base64 audio
    res.json({
      audio: data.audio,
      format: data.format || 'wav',
      sample_rate: data.sample_rate || 22050
    });
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(502).json({ error: 'TTS service unavailable', message: err.message });
  }
});

// Serve the SPA (must be last)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sushi Live Sports Commentary running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log(`Fetching live data from ESPN API...`);
});
