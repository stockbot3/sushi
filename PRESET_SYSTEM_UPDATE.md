# Preset System Update Guide

## Overview
Transform saved presets from "personality references" to "complete configurations" that work like the 4 built-in presets but are fully customizable.

---

## New Preset Schema

### Complete Preset (v2)
```javascript
{
  id: 'abc123',
  name: 'Angry Al',
  description: 'Irish commentator who yells at refs',
  type: 'custom', // 'custom' | 'builtin'
  
  // Personality (required)
  personality: {
    name: 'Angry Al',
    prompt: 'Yells everything in Irish accent. Blames refs constantly.',
    catchphrase: 'That\'s a TURRIBLE call!'
  },
  
  // Voice config (optional, uses defaults if not set)
  voice: {
    provider: 'webspeech', // 'webspeech' | 'elevenlabs' | 'openai'
    voiceId: 'Google US English',
    settings: {
      rate: 1.1,
      pitch: 1.0,
      // ElevenLabs specific
      stability: 0.5,
      similarity_boost: 0.75
    }
  },
  
  // Avatar config (optional)
  avatar: {
    type: 'live2d', // 'live2d' | '3d' | null
    model: '/avatars/models/live2d/angry_al/model3.json',
    color: '#ff4444', // Accent color
    scale: 1.2
  },
  
  createdAt: '2024-01-15T...',
  updatedAt: '2024-01-15T...'
}
```

---

## Backend Changes

### 1. Update Built-in Presets

Replace lines 237-255 in `server.js`:

```javascript
// ─── PERSONALITY PRESETS (Now Complete Configs) ───
const BUILTIN_PRESETS = {
  barkley: {
    id: 'barkley',
    name: 'Sir Charles',
    description: 'Loud, bold, wrong but confident',
    type: 'builtin',
    personality: {
      name: 'Sir Charles',
      prompt: `Loud, bold, wrong but confident. Uses "TURRIBLE" frequently. Makes absurd analogies comparing plays to eating churros or playing golf. Declares games over in the 2nd quarter. Claims he always knew what would happen. Uses "Let me tell you something" as a catchphrase.`,
      catchphrase: "That's TURRIBLE!"
    },
    voice: {
      provider: 'webspeech',
      voiceId: 'Google US English',
      settings: { rate: 0.95, pitch: 0.9 }
    },
    avatar: {
      type: 'live2d',
      model: '/avatars/models/live2d/barkley/model3.json',
      color: '#ff6b35'
    }
  },
  skip: {
    id: 'skip',
    name: 'Hot Take Skip',
    description: 'Ultimate contrarian with conspiracy theories',
    type: 'builtin',
    personality: {
      name: 'Hot Take Skip',
      prompt: `Ultimate contrarian. Dismissive of obvious greatness. Believes in conspiracy theories about refs. Says "I've said this for YEARS" about things he never said. Compares every QB to his favorites. Uses "UNDISPUTED" and "my dear friend" frequently.`,
      catchphrase: "UNDISPUTED!"
    },
    voice: {
      provider: 'webspeech',
      voiceId: 'Microsoft David',
      settings: { rate: 1.1, pitch: 1.0 }
    },
    avatar: {
      type: 'live2d',
      model: '/avatars/models/live2d/skip/model3.json',
      color: '#4a90d9'
    }
  },
  snoop: {
    id: 'snoop',
    name: 'Uncle Snoop',
    description: 'Laid-back West Coast style',
    type: 'builtin',
    personality: {
      name: 'Uncle Snoop',
      prompt: `Laid-back, uses slang and music/food metaphors. Says "fo shizzle", "izzle" variations, and "cuz". Compares plays to cooking or rap battles. Surprisingly drops deep wisdom between jokes. Calls players "nephew" and "young blood". References the West Coast.`,
      catchphrase: "Fo shizzle!"
    },
    voice: {
      provider: 'webspeech',
      voiceId: 'Google UK English Male',
      settings: { rate: 0.9, pitch: 0.8 }
    },
    avatar: {
      type: 'live2d',
      model: '/avatars/models/live2d/snoop/model3.json',
      color: '#2ecc71'
    }
  },
  romo: {
    id: 'romo',
    name: 'Stats Guru Tony',
    description: 'Analytical play predictor',
    type: 'builtin',
    personality: {
      name: 'Stats Guru Tony',
      prompt: `Analytical and excitable. Predicts plays before they happen with "HERE IT COMES!". Obsessed with formations, pre-snap reads, and coverage schemes. Gets genuinely giddy about good play design. Uses "Oh man!" and "You see that?!" frequently. Speaks fast when excited.`,
      catchphrase: "HERE IT COMES!"
    },
    voice: {
      provider: 'webspeech',
      voiceId: 'Microsoft Mark',
      settings: { rate: 1.3, pitch: 1.1 }
    },
    avatar: {
      type: 'live2d',
      model: '/avatars/models/live2d/romo/model3.json',
      color: '#9b59b6'
    }
  }
};

// Helper to get preset (builtin or from Firestore)
async function getPresetById(id) {
  // Check builtin first
  if (BUILTIN_PRESETS[id]) {
    return BUILTIN_PRESETS[id];
  }
  
  // Check Firestore
  const doc = await db.collection('commentator_presets').doc(id).get();
  if (doc.exists) {
    return { id: doc.id, ...doc.data() };
  }
  
  return null;
}

// Helper to resolve preset for commentary
function resolvePreset(config) {
  // If config has a full preset reference
  if (config.presetId && BUILTIN_PRESETS[config.presetId]) {
    return BUILTIN_PRESETS[config.presetId];
  }
  
  // If config is a complete custom preset
  if (config.personality?.prompt) {
    return config;
  }
  
  // Legacy fallback (just personality key + customPrompt)
  const base = BUILTIN_PRESETS[config.personality] || BUILTIN_PRESETS.barkley;
  return {
    ...base,
    personality: {
      ...base.personality,
      prompt: config.customPrompt || base.personality.prompt
    }
  };
}
```

### 2. Update Preset Routes (lines 568-608)

Replace the preset routes with these:

```javascript
// ─── ADMIN ROUTES: COMMENTATOR PRESETS ───

// List all presets (built-in + saved)
app.get('/api/admin/presets', requireAdmin, async (req, res) => {
  try {
    // Get custom presets from Firestore
    const snap = await db.collection('commentator_presets').orderBy('createdAt', 'desc').get();
    const customPresets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Get built-in presets
    const builtinPresets = Object.values(BUILTIN_PRESETS).map(p => ({
      ...p,
      isBuiltin: true
    }));
    
    res.json({
      builtin: builtinPresets,
      custom: customPresets
    });
  } catch (err) {
    console.error('List presets error:', err);
    res.status(500).json({ error: 'Failed to list presets' });
  }
});

// Get single preset
app.get('/api/admin/presets/:id', requireAdmin, async (req, res) => {
  try {
    const preset = await getPresetById(req.params.id);
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    res.json(preset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get preset' });
  }
});

// Create new custom preset
app.post('/api/admin/presets', requireAdmin, async (req, res) => {
  try {
    const { name, description, personality, voice, avatar } = req.body;
    
    if (!name || !personality?.prompt) {
      return res.status(400).json({ error: 'name and personality.prompt are required' });
    }
    
    const id = crypto.randomBytes(8).toString('hex');
    const preset = {
      id,
      name,
      description: description || '',
      type: 'custom',
      personality: {
        name: personality.name || name,
        prompt: personality.prompt,
        catchphrase: personality.catchphrase || ''
      },
      voice: voice || {
        provider: 'webspeech',
        voiceId: 'Google US English',
        settings: { rate: 1.0, pitch: 1.0 }
      },
      avatar: avatar || {
        type: 'live2d',
        model: '/avatars/models/live2d/default/model3.json',
        color: '#FFB81C'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await db.collection('commentator_presets').doc(id).set(preset);
    res.json(preset);
  } catch (err) {
    console.error('Create preset error:', err);
    res.status(500).json({ error: 'Failed to create preset' });
  }
});

// Update preset
app.patch('/api/admin/presets/:id', requireAdmin, async (req, res) => {
  try {
    // Can't update built-ins
    if (BUILTIN_PRESETS[req.params.id]) {
      return res.status(403).json({ error: 'Cannot modify built-in presets' });
    }
    
    const updates = {
      ...req.body,
      updatedAt: new Date().toISOString()
    };
    delete updates.id;
    delete updates.createdAt;
    delete updates.type; // Can't change type
    
    await db.collection('commentator_presets').doc(req.params.id).update(updates);
    
    const doc = await db.collection('commentator_presets').doc(req.params.id).get();
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update preset' });
  }
});

// Delete preset
app.delete('/api/admin/presets/:id', requireAdmin, async (req, res) => {
  try {
    // Can't delete built-ins
    if (BUILTIN_PRESETS[req.params.id]) {
      return res.status(403).json({ error: 'Cannot delete built-in presets' });
    }
    
    await db.collection('commentator_presets').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete preset' });
  }
});

// Duplicate preset (useful for customizing built-ins)
app.post('/api/admin/presets/:id/duplicate', requireAdmin, async (req, res) => {
  try {
    const original = await getPresetById(req.params.id);
    if (!original) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    
    const newId = crypto.randomBytes(8).toString('hex');
    const copy = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`,
      type: 'custom',
      isBuiltin: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await db.collection('commentator_presets').doc(newId).set(copy);
    res.json(copy);
  } catch (err) {
    res.status(500).json({ error: 'Failed to duplicate preset' });
  }
});
```

### 3. Update Session Creation (lines 612-662)

Change the session schema to use full preset references:

```javascript
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
    
    // Resolve commentators - can be preset IDs or complete configs
    const resolvedCommentators = await Promise.all((commentators || []).map(async (c, idx) => {
      // If it's just a preset ID
      if (typeof c === 'string') {
        const preset = await getPresetById(c);
        if (!preset) throw new Error(`Preset not found: ${c}`);
        return {
          id: String.fromCharCode(65 + idx), // A, B, C...
          presetId: preset.id,
          team: idx === 0 ? 'away' : 'home',
          name: preset.personality.name,
          personality: preset.personality,
          voice: preset.voice,
          avatar: preset.avatar
        };
      }
      
      // If it's a complete config
      return {
        id: c.id || String.fromCharCode(65 + idx),
        presetId: c.presetId || null,
        team: c.team || (idx === 0 ? 'away' : 'home'),
        name: c.name || c.personality?.name || `Commentator ${idx + 1}`,
        personality: c.personality,
        voice: c.voice,
        avatar: c.avatar
      };
    }));
    
    // Ensure at least 2 commentators
    while (resolvedCommentators.length < 2) {
      const defaultPreset = BUILTIN_PRESETS[['barkley', 'skip'][resolvedCommentators.length]];
      resolvedCommentators.push({
        id: String.fromCharCode(65 + resolvedCommentators.length),
        presetId: defaultPreset.id,
        team: resolvedCommentators.length === 0 ? 'away' : 'home',
        name: defaultPreset.personality.name,
        personality: defaultPreset.personality,
        voice: defaultPreset.voice,
        avatar: defaultPreset.avatar
      });
    }

    const session = {
      id,
      sport,
      league,
      espnSlug: leagueConfig.espnSlug,
      espnEventId,
      gameName: gameName || '',
      gameDate: gameDate || new Date().toISOString(),
      status: 'active',
      homeTeam: homeTeam || {},
      awayTeam: awayTeam || {},
      commentators: resolvedCommentators,
      settings: {
        mode: 'text', // 'text' | 'voice'
        autoPlay: true,
        showSubtitles: true
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
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
    res.status(500).json({ error: err.message || 'Failed to create session' });
  }
});
```

### 4. Update Commentary Prompt Builder

Update `buildCommentaryPrompt` to use the new structure:

```javascript
function buildCommentaryPrompt(payload, session, runtime) {
  const awayName = payload.awayTeam.name;
  const homeName = payload.homeTeam.name;
  const awayAbbr = payload.awayTeam.abbreviation;
  const homeAbbr = payload.homeTeam.abbreviation;

  const sport = session?.sport || 'football';
  const sportCtx = getSportContext(sport);

  // Get commentators from session
  const commentators = session?.commentators || [];
  const commentatorA = commentators[0] || BUILTIN_PRESETS.barkley;
  const commentatorB = commentators[1] || BUILTIN_PRESETS.skip;

  const teamA = commentatorA.team === 'home' ? homeName : awayName;
  const teamAbbrA = commentatorA.team === 'home' ? homeAbbr : awayAbbr;
  const teamB = commentatorB.team === 'home' ? homeName : awayName;
  const teamAbbrB = commentatorB.team === 'home' ? homeAbbr : awayAbbr;

  // Use personality from the complete config
  const personalityA = commentatorA.personality?.prompt || BUILTIN_PRESETS.barkley.personality.prompt;
  const personalityB = commentatorB.personality?.prompt || BUILTIN_PRESETS.skip.personality.prompt;
  
  const nameA = commentatorA.personality?.name || commentatorA.name || 'Big Mike';
  const nameB = commentatorB.personality?.name || commentatorB.name || 'Salty Steve';

  // ... rest of prompt building
}
```

---

## Frontend Changes

### Update Admin Panel Preset Selection

Replace the preset selection in `admin.html`:

```javascript
// OLD: Just personality keys
const PRESETS = { barkley: {...}, skip: {...} };

// NEW: Fetch complete presets
const [presets, setPresets] = useState({ builtin: [], custom: [] });

useEffect(() => {
  api('/api/admin/presets').then(setPresets);
}, []);

// Render preset cards
const allPresets = [...presets.builtin, ...presets.custom];

// Selection
const selectPreset = (preset) => {
  updateCommentator(idx, {
    presetId: preset.id,
    name: preset.personality.name,
    personality: preset.personality,
    voice: preset.voice,
    avatar: preset.avatar
  });
};
```

---

## Migration

Existing saved presets will continue to work via the `resolvePreset` fallback. To migrate:

```javascript
// Run once to migrate old presets
app.post('/api/admin/migrate-presets', requireAdmin, async (req, res) => {
  const snap = await db.collection('commentator_presets').get();
  
  for (const doc of snap.docs) {
    const data = doc.data();
    
    // Skip if already migrated
    if (data.type && data.personality?.prompt) continue;
    
    // Migrate old format
    const base = BUILTIN_PRESETS[data.personality] || BUILTIN_PRESETS.barkley;
    const migrated = {
      ...data,
      type: 'custom',
      personality: {
        name: data.name,
        prompt: data.customPrompt || base.personality.prompt,
        catchphrase: ''
      },
      voice: base.voice,
      avatar: base.avatar,
      updatedAt: new Date().toISOString()
    };
    
    await doc.ref.update(migrated);
  }
  
  res.json({ migrated: snap.size });
});
```

---

## Testing Checklist

- [ ] List presets shows built-in + custom
- [ ] Create new preset with full config
- [ ] Select preset in session creation
- [ ] Session stores complete commentator config
- [ ] Commentary generation uses preset personality
- [ ] Voice mode uses preset voice settings
- [ ] Avatar uses preset avatar settings
- [ ] Duplicate built-in preset works
- [ ] Legacy sessions still work
