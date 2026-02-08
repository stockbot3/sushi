const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3007;

// ─── MODAL LLM ENDPOINT ───
const MODAL_MISTRAL_URL = process.env.MODAL_MISTRAL_URL || 'https://mousears1090--claudeapps-mistral-mistralmodel-chat.modal.run';

// Call Modal LLM endpoint — handles 303 redirect pattern
async function callModalLLM(url, body, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // POST with redirect: manual to catch 303
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: controller.signal,
    });

    // Direct response — return it
    if (res.ok) {
      clearTimeout(timer);
      return await res.json();
    }

    // 303 redirect — poll the result URL
    if (res.status === 303) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Modal 303 without Location header');
      console.log('[Modal] Got 303, polling result URL...');

      // Poll — Modal returns 303 while still processing, 200 when done
      let pollUrl = location;
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const poll = await fetch(pollUrl, { redirect: 'manual', signal: controller.signal });
          // 303 = still processing, update pollUrl in case it changes
          if (poll.status === 303) {
            const newLoc = poll.headers.get('location');
            if (newLoc) pollUrl = newLoc;
            console.log(`[Modal] Still processing (attempt ${i+1})...`);
            continue;
          }
          // 202 = still processing (alternative pattern)
          if (poll.status === 202) {
            console.log(`[Modal] 202 processing (attempt ${i+1})...`);
            continue;
          }
          if (poll.ok) {
            clearTimeout(timer);
            const ct = poll.headers.get('content-type') || '';
            if (ct.includes('json')) return await poll.json();
            const txt = await poll.text();
            try { return JSON.parse(txt); } catch { return { choices: [{ message: { role: 'assistant', content: txt } }] }; }
          }
          console.log(`[Modal] Poll status ${poll.status}, retrying...`);
        } catch (pollErr) {
          if (pollErr.name === 'AbortError') throw pollErr;
          console.log(`[Modal] Poll error: ${pollErr.message}, retrying...`);
        }
      }
      throw new Error('Modal LLM timed out after polling');
    }

    const errBody = await res.text();
    throw new Error(`Modal returned ${res.status}: ${errBody.slice(0, 300)}`);

  } finally {
    clearTimeout(timer);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── ESPN API CONFIG ───
// Super Bowl LX: Seahawks vs Patriots — Event ID 401772988
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=3';
const ESPN_SUMMARY = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`;
const ESPN_ROSTER = (teamId) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;
const ESPN_TEAM = (teamId) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}`;
const ESPN_NEWS = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=15';

// ─── CACHE ───
const cache = {};
const CACHE_TTL = {
  scoreboard: 15 * 1000,   // 15s during live game
  summary: 15 * 1000,      // 15s
  roster: 5 * 60 * 1000,   // 5 min (rarely changes)
  team: 10 * 60 * 1000,    // 10 min
  news: 2 * 60 * 1000,     // 2 min
};

async function fetchCached(key, url, ttl) {
  const now = Date.now();
  if (cache[key] && (now - cache[key].ts) < ttl) {
    return cache[key].data;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN API returned ${res.status}`);
    const data = await res.json();
    cache[key] = { data, ts: now };
    return data;
  } catch (err) {
    console.error(`Fetch error for ${key}:`, err.message);
    if (cache[key]) return cache[key].data; // serve stale on error
    throw err;
  }
}

// ─── FIND SUPER BOWL EVENT ───
let superBowlEventId = null;
let superBowlTeams = null; // { home: { id, abbr, ... }, away: { ... } }

async function findSuperBowl() {
  const data = await fetchCached('scoreboard', ESPN_SCOREBOARD, CACHE_TTL.scoreboard);
  // Look through postseason events for the Super Bowl
  const events = data.events || [];
  // The Super Bowl is typically the last game of the postseason, or we look for "Super Bowl" in the name
  let sbEvent = events.find(e =>
    (e.name || '').toLowerCase().includes('super bowl') ||
    (e.shortName || '').toLowerCase().includes('super bowl') ||
    (e.competitions?.[0]?.notes?.[0]?.headline || '').toLowerCase().includes('super bowl')
  );
  // If not found by name, check all events and pick the championship (week 5 of postseason)
  if (!sbEvent && events.length > 0) {
    // Fallback: just return the latest/most important postseason game
    sbEvent = events[events.length - 1];
  }
  if (sbEvent) {
    superBowlEventId = sbEvent.id;
    const comp = sbEvent.competitions?.[0];
    if (comp) {
      const homeTeam = comp.competitors?.find(c => c.homeAway === 'home');
      const awayTeam = comp.competitors?.find(c => c.homeAway === 'away');
      superBowlTeams = {
        home: { id: homeTeam?.team?.id, abbr: homeTeam?.team?.abbreviation },
        away: { id: awayTeam?.team?.id, abbr: awayTeam?.team?.abbreviation }
      };
    }
  }
  return sbEvent;
}

// Initialize on startup
findSuperBowl().then(sb => {
  if (sb) console.log(`Found Super Bowl: ${sb.name} (Event ID: ${sb.id})`);
  else console.log('No Super Bowl event found in current postseason scoreboard');
}).catch(err => console.error('Init error:', err.message));

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
        state: comp.status?.type?.state,         // pre, in, post
        detail: comp.status?.type?.detail,        // "2/9 - 6:30 PM ET" or "Final" or "Q2 5:30"
        shortDetail: comp.status?.type?.shortDetail,
        clock: comp.status?.displayClock,
        period: comp.status?.period,
        completed: comp.status?.type?.completed,
      },
      venue: {
        name: comp.venue?.fullName,
        city: comp.venue?.address?.city,
        state: comp.venue?.address?.state,
      },
      broadcast,
      home: {
        id: homeComp.team?.id,
        name: homeComp.team?.displayName,
        abbreviation: homeComp.team?.abbreviation,
        shortName: homeComp.team?.shortDisplayName,
        logo: homeComp.team?.logo,
        color: homeComp.team?.color ? `#${homeComp.team.color}` : null,
        altColor: homeComp.team?.alternateColor ? `#${homeComp.team.alternateColor}` : null,
        score: parseInt(homeComp.score) || 0,
        record: homeComp.records?.[0]?.summary || '',
        linescores: (homeComp.linescores || []).map(l => l.value),
      },
      away: {
        id: awayComp.team?.id,
        name: awayComp.team?.displayName,
        abbreviation: awayComp.team?.abbreviation,
        shortName: awayComp.team?.shortDisplayName,
        logo: awayComp.team?.logo,
        color: awayComp.team?.color ? `#${awayComp.team.color}` : null,
        altColor: awayComp.team?.alternateColor ? `#${awayComp.team.alternateColor}` : null,
        score: parseInt(awayComp.score) || 0,
        record: awayComp.records?.[0]?.summary || '',
        linescores: (awayComp.linescores || []).map(l => l.value),
      },
      situation: {
        possession: situation.possession,
        down: situation.down,
        distance: situation.distance,
        yardLine: situation.yardLine,
        downDistanceText: situation.downDistanceText || '',
        possessionText: situation.possessionText || '',
        isRedZone: situation.isRedZone || false,
        lastPlay: situation.lastPlay?.text || '',
      },
      odds: {
        spread: odds.details || '',
        overUnder: odds.overUnder || null,
        provider: odds.provider?.name || '',
      },
    };
  });
  return events;
}

function parseSummary(data) {
  const header = data.header || {};
  const comp = header.competitions?.[0] || {};
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

  // Parse box score team stats
  const teamStats = (boxscore.teams || []).map(t => ({
    team: t.team?.displayName,
    abbreviation: t.team?.abbreviation,
    logo: t.team?.logo,
    stats: (t.statistics || []).map(s => ({
      name: s.name,
      displayValue: s.displayValue,
      label: s.label,
    })),
  }));

  // Parse player stats from box score
  const playerStats = (boxscore.players || []).map(teamPlayers => ({
    team: teamPlayers.team?.displayName,
    abbreviation: teamPlayers.team?.abbreviation,
    categories: (teamPlayers.statistics || []).map(cat => ({
      name: cat.name,
      labels: cat.labels || [],
      athletes: (cat.athletes || []).map(a => ({
        name: a.athlete?.displayName,
        jersey: a.athlete?.jersey,
        position: a.athlete?.position?.abbreviation,
        headshot: a.athlete?.headshot?.href,
        stats: a.stats || [],
      })),
    })),
  }));

  // Parse scoring plays
  const scoring = scoringPlays.map(sp => ({
    text: sp.text,
    period: sp.period?.number,
    clock: sp.clock?.displayValue,
    team: sp.team?.displayName,
    abbreviation: sp.team?.abbreviation,
    homeScore: sp.homeScore,
    awayScore: sp.awayScore,
    type: sp.type?.text,
  }));

  // Parse drives/play-by-play
  const allDrives = (drives.previous || []).map(d => ({
    description: d.description,
    result: d.displayResult,
    team: d.team?.displayName,
    abbreviation: d.team?.abbreviation,
    yards: d.yards,
    plays: d.offensivePlays,
    timeOfPossession: d.timeOfPossession?.displayValue,
    start: { quarter: d.start?.period?.number, clock: d.start?.clock?.displayValue, yardLine: d.start?.yardLine },
    end: { quarter: d.end?.period?.number, clock: d.end?.clock?.displayValue },
    playList: (d.plays || []).map(p => ({
      text: p.text,
      type: p.type?.text,
      clock: p.clock?.displayValue,
      period: p.period?.number,
      down: p.start?.down,
      distance: p.start?.distance,
      yardLine: p.start?.yardLine,
      yardsGained: p.statYardage,
      scoringPlay: p.scoringPlay || false,
    })),
  }));

  // Parse odds/pickcenter
  const odds = pickcenter.map(p => ({
    provider: p.provider?.name,
    spread: p.details,
    overUnder: p.overUnder,
    homeMoneyline: p.homeTeamOdds?.moneyLine,
    awayMoneyline: p.awayTeamOdds?.moneyLine,
    homeSpreadOdds: p.homeTeamOdds?.spreadOdds,
    awaySpreadOdds: p.awayTeamOdds?.spreadOdds,
    overOdds: p.overOdds,
    underOdds: p.underOdds,
    homeFavorite: p.homeTeamOdds?.favorite || false,
    awayFavorite: p.awayTeamOdds?.favorite || false,
    // Opening vs current lines
    homeOpenSpread: p.homeTeamOdds?.open?.pointSpread?.american,
    awayOpenSpread: p.awayTeamOdds?.open?.pointSpread?.american,
    homeOpenML: p.homeTeamOdds?.open?.moneyLine?.american,
    awayOpenML: p.awayTeamOdds?.open?.moneyLine?.american,
  }));

  // Parse leaders
  const teamLeaders = leaders.map(tl => ({
    team: tl.team?.displayName,
    abbreviation: tl.team?.abbreviation,
    leaders: (tl.leaders || []).map(l => ({
      category: l.name,
      displayName: l.displayName,
      athletes: (l.leaders || []).map(a => ({
        name: a.athlete?.displayName,
        headshot: a.athlete?.headshot?.href,
        jersey: a.athlete?.jersey,
        position: a.athlete?.position?.abbreviation,
        stat: a.displayValue,
      })),
    })),
  }));

  // Parse injuries
  const injuryReport = injuries.map(ti => ({
    team: ti.team?.displayName,
    abbreviation: ti.team?.abbreviation,
    injuries: (ti.injuries || []).map(inj => ({
      name: inj.athlete?.displayName,
      position: inj.athlete?.position?.abbreviation,
      status: inj.status,
      type: inj.type,
    })),
  }));

  // Parse win probability
  const winProbability = winprob.map(wp => ({
    playId: wp.playId,
    homeWinPct: wp.homeWinPercentage,
    secondsLeft: wp.secondsLeft,
    tiePercentage: wp.tiePercentage,
  }));

  // ESPN predictor
  const prediction = {
    home: { name: predictor.homeTeam?.team?.displayName, winPct: predictor.homeTeam?.gameProjection },
    away: { name: predictor.awayTeam?.team?.displayName, winPct: predictor.awayTeam?.gameProjection },
  };

  return {
    teamStats,
    playerStats,
    scoring,
    drives: allDrives,
    odds,
    leaders: teamLeaders,
    injuries: injuryReport,
    winProbability,
    prediction,
    news: news.slice(0, 10).map(n => ({
      headline: n.headline,
      description: n.description,
      published: n.published,
      image: n.images?.[0]?.url,
      link: n.links?.web?.href,
    })),
    gameInfo: {
      venue: gameInfo.venue?.fullName,
      city: gameInfo.venue?.address?.city,
      state: gameInfo.venue?.address?.state,
      attendance: gameInfo.attendance,
      weather: gameInfo.weather ? {
        temperature: gameInfo.weather.temperature,
        condition: gameInfo.weather.displayValue,
        wind: gameInfo.weather.wind?.displayValue,
      } : null,
    },
  };
}

function parseRoster(data) {
  const groups = ['offense', 'defense', 'specialTeam'];
  const roster = [];
  for (const group of groups) {
    const items = data.athletes?.filter(a =>
      groups.indexOf(a.position) !== -1 || true // get all
    ) || [];
  }
  // ESPN returns athletes grouped in position arrays
  const athletes = data.athletes || [];
  athletes.forEach(group => {
    const posGroup = group.position || 'other';
    (group.items || []).forEach(p => {
      roster.push({
        name: p.displayName,
        jersey: p.jersey,
        position: p.position?.abbreviation || posGroup,
        positionGroup: posGroup,
        age: p.age,
        height: p.displayHeight,
        weight: p.displayWeight,
        headshot: p.headshot?.href,
        experience: p.experience?.years,
        college: p.college?.name,
      });
    });
  });
  return { coach: data.coach?.[0]?.firstName + ' ' + data.coach?.[0]?.lastName, roster };
}

// ─── API ROUTES ───

// Get scoreboard (all postseason games, find SB)
app.get('/api/scoreboard', async (req, res) => {
  try {
    const data = await fetchCached('scoreboard', ESPN_SCOREBOARD, CACHE_TTL.scoreboard);
    const events = parseScoreboard(data);
    res.json({ events, superBowlEventId });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch scoreboard', message: err.message });
  }
});

// Get the Super Bowl game specifically
app.get('/api/game', async (req, res) => {
  try {
    // Refresh SB info
    await findSuperBowl();
    const data = await fetchCached('scoreboard', ESPN_SCOREBOARD, CACHE_TTL.scoreboard);
    const events = parseScoreboard(data);
    const sb = events.find(e => e.id === superBowlEventId) || events[events.length - 1];
    if (!sb) return res.json({ error: 'No Super Bowl event found', events: [] });
    res.json(sb);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch game', message: err.message });
  }
});

// Get full game summary (box score, play-by-play, odds, leaders, etc.)
app.get('/api/summary', async (req, res) => {
  try {
    if (!superBowlEventId) await findSuperBowl();
    const eventId = req.query.event || superBowlEventId;
    if (!eventId) return res.status(404).json({ error: 'No event ID available' });
    const data = await fetchCached(`summary_${eventId}`, ESPN_SUMMARY(eventId), CACHE_TTL.summary);
    const summary = parseSummary(data);
    res.json(summary);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch summary', message: err.message });
  }
});

// Get team roster
app.get('/api/roster/:teamId', async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const data = await fetchCached(`roster_${teamId}`, ESPN_ROSTER(teamId), CACHE_TTL.roster);
    const roster = parseRoster(data);
    res.json(roster);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch roster', message: err.message });
  }
});

// Get team info
app.get('/api/team/:teamId', async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const data = await fetchCached(`team_${teamId}`, ESPN_TEAM(teamId), CACHE_TTL.team);
    const team = data.team || {};
    res.json({
      id: team.id,
      name: team.displayName,
      abbreviation: team.abbreviation,
      shortName: team.shortDisplayName,
      color: team.color ? `#${team.color}` : null,
      altColor: team.alternateColor ? `#${team.alternateColor}` : null,
      logo: team.logos?.[0]?.href,
      record: team.record?.items?.[0]?.summary,
      standingSummary: team.standingSummary,
      location: team.location,
      nickname: team.name,
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch team', message: err.message });
  }
});

// Get NFL news
app.get('/api/news', async (req, res) => {
  try {
    const data = await fetchCached('news', ESPN_NEWS, CACHE_TTL.news);
    const articles = (data.articles || []).slice(0, 15).map(a => ({
      headline: a.headline,
      description: a.description,
      published: a.published,
      image: a.images?.[0]?.url,
      link: a.links?.web?.href,
    }));
    res.json(articles);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch news', message: err.message });
  }
});

// ─── AI COMMENTARY ENGINE ───
// Tracks the last play sequence we generated commentary for
let lastCommentarySeq = -1;
let commentaryCache = { data: null, ts: 0 };
const COMMENTARY_COOLDOWN = 8000; // minimum ms between LLM calls

// Determine if a play is "interesting" enough for commentary
function isInterestingPlay(play) {
  if (!play) return false;
  const desc = (play.text || play.description || '').toLowerCase();
  const yards = Math.abs(play.yardsGained || play.statYardage || 0);
  // Always interesting
  if (play.scoringPlay) return true;
  if (desc.includes('touchdown')) return true;
  if (desc.includes('interception') || desc.includes('intercepted')) return true;
  if (desc.includes('fumble')) return true;
  if (desc.includes('sack')) return true;
  if (desc.includes('penalty')) return true;
  if (yards >= 15) return true;
  if (desc.includes('field goal')) return true;
  if (desc.includes('safety')) return true;
  if (desc.includes('two-point') || desc.includes('2-point')) return true;
  if (desc.includes('challenge') || desc.includes('review')) return true;
  // Moderately interesting — first downs with decent gains
  if (yards >= 8) return true;
  return false;
}

// Build the prompt payload from ESPN data
function buildCommentaryPayload(game, summary) {
  if (!game || !summary) return null;

  const drives = summary.drives || [];
  const latestDrive = drives[drives.length - 1];
  const latestPlays = latestDrive?.playList || [];
  const latestPlay = latestPlays[latestPlays.length - 1];

  if (!latestPlay) return null;

  const awayName = game.away?.name || game.away?.abbreviation || 'Away';
  const homeName = game.home?.name || game.home?.abbreviation || 'Home';
  const awayAbbr = game.away?.abbreviation || 'AWY';
  const homeAbbr = game.home?.abbreviation || 'HME';

  // Determine offense from drive
  const offenseTeam = latestDrive.abbreviation || awayAbbr;
  const isAwayOffense = offenseTeam === awayAbbr;

  // Build last3Plays
  const last3 = latestPlays.slice(-4, -1).map(p => p.text || '').filter(Boolean);

  // Build rolling summary
  const playTypes = latestPlays.slice(-6).map(p => p.type || '');
  const passCount = playTypes.filter(t => t.toLowerCase().includes('pass')).length;
  const runCount = playTypes.filter(t => t.toLowerCase().includes('rush') || t.toLowerCase().includes('run')).length;
  const tendency = passCount > runCount ? 'pass-heavy' : runCount > passCount ? 'run-heavy' : 'balanced';

  const rollingSummary = `${isAwayOffense ? awayName : homeName} has been ${tendency} on this drive${latestDrive.yards ? ` and has gained ${latestDrive.yards} yards` : ''}.`;

  // Determine play type
  const playTypeStr = (latestPlay.type || '').toLowerCase();
  let playType = 'Unknown';
  if (playTypeStr.includes('pass')) playType = 'Pass';
  else if (playTypeStr.includes('rush') || playTypeStr.includes('run')) playType = 'Run';
  else if (playTypeStr.includes('punt')) playType = 'Punt';
  else if (playTypeStr.includes('kickoff')) playType = 'Kickoff';
  else if (playTypeStr.includes('field goal')) playType = 'Field Goal';
  else if (playTypeStr.includes('sack')) playType = 'Sack';
  else if (playTypeStr.includes('penalty')) playType = 'Penalty';

  // Determine result
  let result = 'Play';
  const yards = latestPlay.yardsGained || latestPlay.statYardage || 0;
  if (latestPlay.scoringPlay) result = 'Scoring Play';
  else if (latestPlay.text?.toLowerCase().includes('first down') || (latestPlay.down === 1 && yards >= (latestPlay.distance || 10))) result = 'First Down';
  else if (latestPlay.text?.toLowerCase().includes('incomplete')) result = 'Incomplete';
  else if (latestPlay.text?.toLowerCase().includes('interception') || latestPlay.text?.toLowerCase().includes('intercepted')) result = 'Turnover - Interception';
  else if (latestPlay.text?.toLowerCase().includes('fumble')) result = 'Turnover - Fumble';
  else result = `Gain of ${yards}`;

  // Mood hint for the LLM
  let mood = 'routine';
  if (latestPlay.scoringPlay) mood = 'electric';
  else if (latestPlay.text?.toLowerCase().includes('interception') || latestPlay.text?.toLowerCase().includes('fumble')) mood = 'disaster';
  else if (yards >= 20) mood = 'momentum_shift';
  else if (yards >= 10) mood = 'big_play';
  else if (latestPlay.text?.toLowerCase().includes('sack')) mood = 'defensive_dominance';
  else if (latestPlay.text?.toLowerCase().includes('penalty')) mood = 'controversial';
  else if (yards <= 0) mood = 'stuffed';

  return {
    gameId: `sb-${new Date().getFullYear()}`,
    awayTeam: { name: awayName, abbreviation: awayAbbr },
    homeTeam: { name: homeName, abbreviation: homeAbbr },
    event: {
      seq: latestPlays.length + (drives.length * 100),
      quarter: latestPlay.period || game.status?.period || 1,
      clock: latestPlay.clock || game.status?.clock || '',
      down: latestPlay.down || null,
      distance: latestPlay.distance || null,
      yardLine: latestPlay.yardLine ? `${offenseTeam} ${latestPlay.yardLine}` : '',
      offense: isAwayOffense ? awayAbbr : homeAbbr,
      defense: isAwayOffense ? homeAbbr : awayAbbr,
      playType,
      description: latestPlay.text || '',
      yardsGained: yards,
      result,
      mood,
    },
    state: {
      score: {
        [awayAbbr]: game.away?.score || 0,
        [homeAbbr]: game.home?.score || 0,
      },
      possession: offenseTeam,
      last3Plays: last3.length > 0 ? last3 : ['Drive just started'],
      rollingSummaryShort: rollingSummary,
    },
  };
}

// Build the full system prompt for the LLM
function buildCommentaryPrompt(payload) {
  const awayName = payload.awayTeam.name;
  const homeName = payload.homeTeam.name;
  const awayAbbr = payload.awayTeam.abbreviation;
  const homeAbbr = payload.homeTeam.abbreviation;

  return `You are an AI commentary engine for a live Super Bowl broadcast.

You produce short, entertaining, argumentative commentary between two unhinged commentators.

COMMENTATOR A — "Big Mike"
- Unhinged, emotional, biased HARD toward the ${awayName} (${awayAbbr})
- Loud, dramatic, overconfident
- Treats every positive ${awayAbbr} play as genius, every negative play as a conspiracy

COMMENTATOR B — "Salty Steve"
- Equally unhinged, biased HARD toward the ${homeName} (${homeAbbr})
- Sarcastic, mocking, dismissive
- Downplays ${awayAbbr} success, hypes ${homeAbbr}

Rules:
- Both speak like they are watching live
- They argue DIRECTLY with each other, never agree politely
- If info is not in the data, do NOT invent it
- Keep responses punchy and short
- The "mood" field hints at emotional tone: use it

OUTPUT FORMAT — Produce EXACTLY 3 turns:

[A] Big Mike reacts to the play. 1-2 sentences. Maximum hype. Reference a real field.
[B] Salty Steve argues back. 2-3 sentences. Downplay or blame. Reference a different field.
[A] Big Mike fires back. 1-2 sentences. Predict next play type (run/pass/special). Include confidence: X.X

Here is the play data:
${JSON.stringify(payload, null, 2)}

Respond with ONLY the 3 turns. No preamble, no explanation.`;
}

// Parse the [A] / [B] output from the LLM
function parseCommentary(raw, awayName, homeName) {
  const lines = raw.trim().split('\n').filter(l => l.trim());
  const turns = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[A]')) {
      if (current) turns.push(current);
      current = { speaker: 'A', name: 'Big Mike', team: awayName, text: trimmed.replace(/^\[A\]\s*/, '').trim() };
    } else if (trimmed.startsWith('[B]')) {
      if (current) turns.push(current);
      current = { speaker: 'B', name: 'Salty Steve', team: homeName, text: trimmed.replace(/^\[B\]\s*/, '').trim() };
    } else if (current) {
      current.text += ' ' + trimmed;
    }
  }
  if (current) turns.push(current);

  // Extract confidence from the last A turn
  const lastA = [...turns].reverse().find(t => t.speaker === 'A');
  if (lastA) {
    const confMatch = lastA.text.match(/confidence[:\s]*([01]\.\d+)/i) || lastA.text.match(/(\d\.\d+)\s*confidence/i) || lastA.text.match(/([01]\.\d+)/);
    if (confMatch) {
      lastA.confidence = parseFloat(confMatch[1]);
    }
    // Extract prediction
    const predMatch = lastA.text.match(/next play[^.]*?(run|pass|special|kick|punt|field goal)/i);
    if (predMatch) {
      lastA.prediction = predMatch[1].toLowerCase();
    }
  }

  return turns;
}

// Commentary endpoint
app.get('/api/commentary', async (req, res) => {
  try {
    const now = Date.now();

    // Return cached commentary if fresh enough
    if (commentaryCache.data && (now - commentaryCache.ts) < COMMENTARY_COOLDOWN) {
      return res.json(commentaryCache.data);
    }

    // Get current game + summary
    if (!superBowlEventId) await findSuperBowl();
    const scoreData = await fetchCached('scoreboard', ESPN_SCOREBOARD, CACHE_TTL.scoreboard);
    const events = parseScoreboard(scoreData);
    const game = events.find(e => e.id === superBowlEventId) || events[events.length - 1];

    if (!game || game.status?.state !== 'in') {
      // Pre-game or post-game — generate hype/recap commentary
      const prePayload = buildPreGamePayload(game);
      if (!prePayload) {
        return res.json({ turns: [], status: 'waiting', message: 'Waiting for game to start' });
      }
      // Use pre-game prompt
      const prompt = buildPreGamePrompt(prePayload, game);
      const llmData = await callModalLLM(MODAL_MISTRAL_URL, {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.9,
      });
      const rawText = llmData.choices?.[0]?.message?.content || '';
      const awayName = game?.away?.name || 'Away';
      const homeName = game?.home?.name || 'Home';
      const turns = parseCommentary(rawText, awayName, homeName);

      const result = { turns, status: game?.status?.state === 'post' ? 'post' : 'pre', raw: rawText, timestamp: now };
      commentaryCache = { data: result, ts: now };
      return res.json(result);
    }

    // Live game — get summary for play data
    const summaryData = await fetchCached(`summary_${superBowlEventId}`, ESPN_SUMMARY(superBowlEventId), CACHE_TTL.summary);
    const summary = parseSummary(summaryData);

    const payload = buildCommentaryPayload(game, summary);
    if (!payload) {
      return res.json({ turns: [], status: 'no_plays', message: 'No plays available yet' });
    }

    // Check if this is a new play
    const currentSeq = payload.event.seq;
    const isNewPlay = currentSeq !== lastCommentarySeq;

    // If same play and we have cached commentary, return it
    if (!isNewPlay && commentaryCache.data?.turns?.length > 0) {
      return res.json(commentaryCache.data);
    }

    // Check if play is interesting enough
    const drives = summary.drives || [];
    const latestDrive = drives[drives.length - 1];
    const latestPlays = latestDrive?.playList || [];
    const latestPlay = latestPlays[latestPlays.length - 1];

    if (!isInterestingPlay(latestPlay) && commentaryCache.data?.turns?.length > 0) {
      // Return stale commentary with a note
      return res.json({ ...commentaryCache.data, status: 'stale', message: 'Routine play — waiting for action' });
    }

    // Call Modal LLM
    const prompt = buildCommentaryPrompt(payload);
    const llmData = await callModalLLM(MODAL_MISTRAL_URL, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250,
      temperature: 0.9,
    });
    const rawText = llmData.choices?.[0]?.message?.content || '';
    const turns = parseCommentary(rawText, game.away?.name || 'Away', game.home?.name || 'Home');

    lastCommentarySeq = currentSeq;
    const result = {
      turns,
      status: 'live',
      play: {
        description: payload.event.description,
        quarter: payload.event.quarter,
        clock: payload.event.clock,
        yardsGained: payload.event.yardsGained,
        playType: payload.event.playType,
        result: payload.event.result,
        mood: payload.event.mood,
      },
      score: payload.state.score,
      timestamp: now,
    };

    commentaryCache = { data: result, ts: now };
    res.json(result);

  } catch (err) {
    console.error('Commentary error:', err.message);
    // Return cached on error
    if (commentaryCache.data) {
      return res.json({ ...commentaryCache.data, status: 'error_cached', error: err.message });
    }
    res.status(500).json({ turns: [], status: 'error', message: err.message });
  }
});

// Pre-game payload builder
function buildPreGamePayload(game) {
  if (!game) return null;
  return {
    awayTeam: { name: game.away?.name || 'Away', abbreviation: game.away?.abbreviation || 'AWY' },
    homeTeam: { name: game.home?.name || 'Home', abbreviation: game.home?.abbreviation || 'HME' },
    score: { away: game.away?.score || 0, home: game.home?.score || 0 },
    odds: game.odds || {},
    records: { away: game.away?.record || '', home: game.home?.record || '' },
  };
}

function buildPreGamePrompt(payload, game) {
  const awayName = payload.awayTeam.name;
  const homeName = payload.homeTeam.name;
  const isPre = game?.status?.state === 'pre';

  const scenario = isPre
    ? `The Super Bowl is about to start! ${awayName} (${payload.records.away}) vs ${homeName} (${payload.records.home}). Spread: ${payload.odds?.spread || 'unknown'}. Over/Under: ${payload.odds?.overUnder || 'unknown'}.`
    : `The Super Bowl is OVER! Final: ${awayName} ${payload.score.away} - ${homeName} ${payload.score.home}.`;

  return `You are an AI commentary engine for a Super Bowl broadcast.

You produce short, entertaining, argumentative commentary between two unhinged commentators.

COMMENTATOR A — "Big Mike"
- Biased HARD toward ${awayName}. Loud, dramatic, overconfident.

COMMENTATOR B — "Salty Steve"
- Biased HARD toward ${homeName}. Sarcastic, mocking, dismissive.

They argue DIRECTLY. Never agree. Keep it punchy and short.

Scenario: ${scenario}

${isPre ? 'Generate pre-game hype trash talk. Each commentator should make a bold prediction.' : 'Generate post-game reaction. Winner\'s commentator gloats, loser\'s makes excuses.'}

OUTPUT FORMAT — Produce EXACTLY 3 turns:
[A] Big Mike. 1-2 sentences.
[B] Salty Steve. 2-3 sentences.
[A] Big Mike fires back. 1-2 sentences.${isPre ? ' Include a score prediction.' : ''}

Respond with ONLY the 3 turns. No preamble.`;
}

// Commentary history — store the last 20 commentaries for scrollback
const commentaryHistory = [];
const MAX_HISTORY = 20;

app.get('/api/commentary/history', (req, res) => {
  res.json(commentaryHistory);
});

// Wrap the commentary endpoint to also store history
const origCommentaryCache = { lastStored: 0 };
app.get('/api/commentary/latest', async (req, res) => {
  try {
    // Proxy to /api/commentary and store in history
    const response = await fetch(`http://127.0.0.1:${PORT}/api/commentary`);
    const data = await response.json();

    // Store in history if it's new
    if (data.turns?.length > 0 && data.timestamp !== origCommentaryCache.lastStored) {
      commentaryHistory.unshift(data);
      if (commentaryHistory.length > MAX_HISTORY) commentaryHistory.pop();
      origCommentaryCache.lastStored = data.timestamp;
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ turns: [], error: err.message });
  }
});

// Health/status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    superBowlEventId,
    superBowlTeams,
    cacheKeys: Object.keys(cache),
    uptime: process.uptime(),
  });
});

// Serve the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏈 Sushi Super Bowl Tracker running on http://localhost:${PORT}`);
  console.log(`Fetching live data from ESPN API...`);
});
