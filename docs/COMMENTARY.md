# AI Commentary Engine

Real-time sports commentary generation using LLM with personality-driven commentators.

## Overview

The commentary engine fetches live game data from ESPN and generates AI commentary that:
- Analyzes each play in real-time
- Provides play-by-play reactions
- Includes personality-driven banter
- Supports multiple sports (football, basketball, etc.)
- Uses saved commentator presets (optional) with custom prompts

## Architecture

```
┌────────────┐     ┌──────────┐     ┌──────────┐
│   ESPN     │────▶│  Node.js │────▶│  Modal   │
│    API     │     │  Server  │     │   LLM    │
└────────────┘     └──────────┘     └──────────┘
                          │
                          ▼
                   ┌────────────┐
                   │  Firebase  │
                   │   Store    │
                   └────────────┘
```

## Data Flow

1. **Client** requests commentary every 5-10 seconds
2. **Server** fetches ESPN game data (cached for 5-45s)
3. **Server** builds prompt with play context
4. **Modal LLM** generates commentary
5. **Server** caches and returns result

## ESPN API Integration

### Football

Uses `drives.previous[].playList[]` for play-by-play:

```javascript
const drives = summary.drives.previous;
const latestDrive = drives[drives.length - 1];
const latestPlay = latestDrive.playList[latestDrive.playList.length - 1];
```

Play types: Pass, Run, Rush, Punt, Kickoff, Field Goal, Sack, Penalty

### Basketball

Uses `plays[]` or `keyEvents[]`:

```javascript
const plays = summary.plays || summary.keyEvents;
const latestPlay = plays[plays.length - 1];
```

Play types: Three Pointer, Dunk, Layup, Free Throw, Jump Shot, Steal, Block, Rebound

### Other Sports

Generic play extraction:
- Baseball: At-bats, pitches
- Hockey: Shots, saves, penalties
- Soccer: Shots, fouls, cards

## Prompt Engineering

### Structure

```
[CONTEXT]
- Sport type and rules
- Current score and possession
- Recent plays (last 3)

[COMMENTATORS]
- Commentator A: Name, team, personality
- Commentator B: Name, team, personality

[PLAY DATA]
- Current play description
- Type, result, yards/points
- Mood indicator

[OUTPUT FORMAT]
[A] Commentator A reacts (1-2 sentences)
[B] Commentator B argues back (2-3 sentences)
[A] Commentator A fires back (1-2 sentences) + prediction
```

### Personality Presets

```javascript
const PERSONALITY_PRESETS = {
  barkley: {
    name: 'Sir Charles',
    prompt: `Loud, bold, wrong but confident. Uses "TURRIBLE" frequently.`
  },
  skip: {
    name: 'Hot Take Skip',
    prompt: `Ultimate contrarian. Believes in conspiracy theories about refs.`
  },
  snoop: {
    name: 'Uncle Snoop',
    prompt: `Laid-back, uses slang and music/food metaphors.`
  },
  romo: {
    name: 'Stats Guru Tony',
    prompt: `Analytical and excitable. Predicts plays before they happen.`
  }
};
```

### Sport-Specific Context

Each sport adds relevant context:

**Football**:
```
Yards gained = GOOD for offense, BAD for defense
Turnovers = BAD for offense
Touchdowns = 6pts + extra point
```

**Basketball**:
```
Points come from 2-pointers, 3-pointers, and free throws
Momentum swings are crucial
Runs (scoring streaks) shift games
```

## Caching Strategy

### Commentary Cache

```javascript
const COMMENTARY_COOLDOWN = 5000;     // 5s between calls
const STALE_COMMENTARY_MAX = 45000;   // 45s max age
```

- New play detected → Generate new commentary
- Same play, <45s old → Return cached
- Same play, >45s old → Refresh

### Play Change Detection

The system detects changes using multiple signals:
- Latest play text
- Play ID/sequence number
- Clock/period
- Score changes

### Data Cache

```javascript
const CACHE_TTL = {
  scoreboard: 8 * 1000,    // 8s
  summary: 8 * 1000,       // 8s
  roster: 5 * 60 * 1000,   // 5min
  news: 2 * 60 * 1000,     // 2min
};
```

## API Endpoints

### Get Commentary

```
GET /api/sessions/:id/commentary/latest

Response:
{
  turns: [
    { speaker: 'A', name: 'Big Mike', text: '...' },
    { speaker: 'B', name: 'Salty Steve', text: '...' },
    { speaker: 'A', name: 'Big Mike', text: '...' }
  ],
  play: { description, quarter, clock, playType, result },
  score: { HOME: 21, AWAY: 14 },
  status: 'live'
}
```

### Get History

```
GET /api/sessions/:id/commentary/history

Returns array of past commentary entries
```

## Admin Dashboard

Create/manage sessions at `/admin`:

1. **Browse Games** - Select sport/league/game
2. **Configure Commentators** - Choose personalities
3. **Start Session** - Activate live commentary
4. **Monitor** - View real-time updates

### Presets

Presets allow reusable commentator configurations:
- `name`
- `prompt`
- `voice`
- `avatarUrl`

In the Admin panel, you can assign presets to each commentator. Preset data is copied into the session at save time.

## Multi-Sport Support

### Adding a New Sport

1. Update `SPORTS_CONFIG`:
```javascript
const SPORTS_CONFIG = {
  newsport: {
    name: 'New Sport',
    leagues: {
      league1: { name: 'League One', espnSlug: 'sport/league' }
    }
  }
};
```

2. Add sport context:
```javascript
function getSportContext(sport) {
  case 'newsport':
    return {
      periodName: 'Period',
      scoringTerms: 'goal, point',
      promptFrame: 'This is a new sport...'
    };
}
```

3. Update `buildCommentaryPayload` to extract plays

## Troubleshooting

### No plays showing

Check ESPN API response structure:
```javascript
console.log('Summary:', summary);
// Look for: plays, keyEvents, drives.previous
```

### Commentary not updating

Check if new play detected:
```javascript
const isNewPlay = currentSeq !== runtime.lastCommentarySeq;
console.log('New play:', isNewPlay, 'Seq:', currentSeq);
```

### LLM not responding

Check Modal endpoint:
```bash
curl -X POST $MODAL_MISTRAL_URL \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}]}'
```

## Performance

### Typical Latency

- ESPN fetch: ~200ms
- Cache hit: ~5ms
- LLM generation: ~2-5s
- Total: ~3-6s for fresh commentary

### Optimization

- Cache ESPN data (8s TTL)
- Cache commentary (5s cooldown)
- Parallel roster fetching
- LLM streaming (future)

## Future Features

1. **Custom Personalities** - User-defined prompts
2. **Voice Matching** - Different voices per commentator
3. **Historical Stats** - "This is his 3rd touchdown today"
4. **Social Integration** - Tweet highlights
5. **Betting Odds** - Live line movement

## Resources

- [ESPN API Docs](http://espn.go.com/static/apis/devcenter/docs/)
- [Modal LLM Guide](https://modal.com/docs/guide/ex/falcon_gptq)
- [OpenRouter](https://openrouter.ai/) (alternative LLM provider)
