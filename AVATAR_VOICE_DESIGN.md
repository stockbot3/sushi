# Sushi: Voice Mode & Avatar System Design

## Overview
Adding voice commentary with animated avatars (2D Live2D or 3D Ready Player Me) that lip-sync to TTS audio streams.

---

## Part 1: Fixed Presets System

### Current Problem
- Built-in presets: `{ barkley: { name, prompt } }` - complete
- Saved presets: `{ name, personality, customPrompt }` - references built-in

### Solution: Full Presets
Saved presets become complete replacements:

```javascript
// NEW preset schema
{
  id: 'abc123',
  name: 'Angry Al',
  type: 'custom', // 'custom' | 'builtin'
  // Complete personality definition
  personality: {
    name: 'Angry Al',
    prompt: 'Yells everything. Blames refs. Irish accent.',
    voice: {
      type: 'elevenlabs', // or 'webspeech'
      voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam
      settings: { stability: 0.5, similarity_boost: 0.75 }
    },
    avatar: {
      type: 'live2d', // or '3d'
      model: '/avatars/angry_al.model3.json',
      color: '#ff4444'
    }
  },
  createdAt: '...'
}
```

### Migration
Built-in presets become hardcoded full presets:
```javascript
const BUILTIN_PRESETS = {
  barkley: {
    name: 'Sir Charles',
    type: 'builtin',
    personality: { name, prompt, voice: {...}, avatar: {...} }
  },
  // ...
};
```

---

## Part 2: Voice/TTS Architecture

### Option 1: Web Speech API (Free, Built-in)
```javascript
const synth = window.speechSynthesis;
const utterance = new SpeechSynthesisUtterance(text);
utterance.voice = synth.getVoices().find(v => v.name.includes('Male'));
utterance.rate = 1.1;
utterance.pitch = 1.0;
synth.speak(utterance);

// For lip-sync: get audio levels
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
// Connect utterance to analyser via MediaStream
```

**Pros**: Free, no API key, instant
**Cons**: Limited voices, quality varies by browser, no viseme data

### Option 2: ElevenLabs (Premium Quality)
```javascript
const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
  method: 'POST',
  headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text,
    model_id: 'eleven_turbo_v2',
    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
  })
});
const audioBlob = await response.blob();
const audioUrl = URL.createObjectURL(audioBlob);
```

**Pros**: High quality, consistent, many voices
**Cons**: Requires API key, costs money, network latency

### Option 3: OpenAI TTS (Middle Ground)
```javascript
const response = await fetch('https://api.openai.com/v1/audio/speech', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + API_KEY },
  body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: text })
});
```

**Pros**: Good quality, cheaper than ElevenLabs
**Cons**: Requires API key, fewer voice options

### Recommended Approach
**Hybrid**: Web Speech API as default (free), ElevenLabs for premium presets

---

## Part 3: Avatar System

### 2D Live2D Option (Default - Simpler)

**Libraries Needed**:
- `Live2D Cubism SDK for Web` (free from GitHub)
- `pixi.js` (rendering)

**Architecture**:
```
CommentaryTurn
    └── Live2DAvatar
        ├── Model (model3.json + textures)
        ├── Animator (manages motion)
        ├── LipSync (audio → mouth open/close)
        └── Expressions (happy, sad, neutral, excited)
```

**Lip-Sync Strategy**:
Since Live2D models have parameterized mouths (ParamMouthOpenY), we can:
1. **Simple**: Use audio volume levels (0-1) → mouth open amount
2. **Better**: Use Wawa-Lipsync for viseme detection (A, E, I, O, U, etc.)
3. **Best**: Use Oculus Lip Sync (if available in JS)

**Model Structure**:
```
/public/avatars/
  ├── live2d/
  │   ├── commentator_a/
  │   │   ├── model3.json
  │   │   ├── textures/
  │   │   ├── motions/
  │   │   └── expressions/
  │   └── commentator_b/
  └── rpm/ (3D models)
```

### 3D Ready Player Me Option (Advanced)

**Libraries Needed**:
- `three.js` (3D rendering)
- `@readyplayerme/visage` (avatar loading)
- `three-mesh-bvh` (optional, for performance)

**Architecture**:
```
CommentaryTurn
    └── ThreeDAvatar
        ├── GLB Model (from RPM)
        ├── AnimationMixer (idle, talk, react)
        ├── BlendShapes (visemes for lip-sync)
        └── Materials (team colors)
```

**Lip-Sync for 3D**:
RPM avatars have blendshapes (visemes):
- `viseme_PP` (closed mouth)
- `viseme_FF` (F, V)
- `viseme_TH` (TH)
- `viseme_DD` (T, D, N)
- `viseme_kk` (K, G)
- `viseme_CH` (CH, SH)
- `viseme_SS` (S, Z)
- `viseme_nn` (L, N)
- `viseme_RR` (R)
- `viseme_aa` (A)
- `viseme_E` (E)
- `viseme_I` (I)
- `viseme_O` (O)
- `viseme_U` (U)

Use Wawa-Lipsync to detect phonemes → map to blendshapes

---

## Part 4: Lip-Sync Implementation

### Wawa-Lipsync Integration

```javascript
// From: https://github.com/ChrisCates/wawa-lipsync
class LipSync {
  constructor(audioContext) {
    this.context = audioContext;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
  }

  // Returns viseme data in real-time
  getVisemes() {
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    
    // Analyze frequency bands for vowel detection
    const bands = {
      low: dataArray.slice(0, 10).reduce((a, b) => a + b) / 10,    // A, O
      mid: dataArray.slice(10, 40).reduce((a, b) => a + b) / 30,   // E, I
      high: dataArray.slice(40, 100).reduce((a, b) => a + b) / 60  // U, consonants
    };
    
    // Simple mapping to visemes
    if (bands.low > bands.mid && bands.low > bands.high) return 'aa';
    if (bands.mid > bands.low && bands.mid > bands.high) return 'E';
    if (bands.high > bands.low && bands.high > bands.mid) return 'U';
    return 'PP'; // closed
  }
  
  // Simple volume-based (fallback)
  getVolume() {
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    return average / 255; // 0-1
  }
}
```

### Audio Routing

```javascript
class CommentaryAudioManager {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.lipSync = new LipSync(this.ctx);
    this.currentSource = null;
  }

  async playTTS(text, voiceConfig, onViseme) {
    // Get audio from TTS service
    const audioBuffer = await this.fetchTTS(text, voiceConfig);
    
    // Create source
    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    
    // Connect to analyser for lip-sync
    source.connect(this.lipSync.analyser);
    this.lipSync.analyser.connect(this.ctx.destination);
    
    // Start playback
    source.start(0);
    this.currentSource = source;
    
    // Start lip-sync loop
    this.startLipSyncLoop(onViseme);
  }
  
  startLipSyncLoop(callback) {
    const loop = () => {
      if (!this.currentSource) return;
      const viseme = this.lipSync.getVisemes();
      const volume = this.lipSync.getVolume();
      callback({ viseme, volume });
      requestAnimationFrame(loop);
    };
    loop();
  }
}
```

---

## Part 5: Complete Data Flow

```
1. Commentary Generated (3 turns: A, B, A)
        ↓
2. For each turn:
   a. Get commentator config (preset)
   b. Get voice settings (Web Speech or ElevenLabs)
   c. Get avatar settings (Live2D or 3D)
        ↓
3. TTS Service converts text → Audio
   - If Web Speech: use SpeechSynthesis
   - If ElevenLabs: fetch audio blob
        ↓
4. AudioManager plays audio + analyzes
   - Routes audio to speakers
   - Runs lip-sync analysis
        ↓
5. Avatar receives viseme/volume data
   - Live2D: update ParamMouthOpenY + expression
   - 3D: update blendshapes + emote animation
        ↓
6. Visual updates at 60fps
   - Mouth moves with speech
   - Expression changes based on mood (happy/sad)
```

---

## Part 6: UI Components

### Viewer Toggle
```
┌─────────────────────────────────────┐
│  Scores | AI Talk | Stats | ...     │
│                                     │
│  [Text Mode] [Voice Mode 🔊]        │ ← Toggle
│                                     │
│  ┌──────────┐    ┌──────────┐      │
│  │ [AVATAR] │    │ [AVATAR] │      │ ← Side-by-side
│  │    A     │◄──►│    B     │      │
│  └──────────┘    └──────────┘      │
│                                     │
│  "That play was TURRIBLE!"          │ ← Subtitle
│                                     │
└─────────────────────────────────────┘
```

### Avatar States
- **Idle**: Breathing animation, neutral expression
- **Talking**: Lip-sync active, occasional gestures
- **Reacting**: Expression changes (happy/sad/angry) + emote
- **Listening**: Head turns toward other commentator

---

## Part 7: Implementation Plan

### Phase 1: Backend Updates
1. Update preset schema in Firestore
2. Add voice/avatar config to session model
3. Add TTS API endpoints (if proxying ElevenLabs)

### Phase 2: Avatar System
1. Create Live2D avatar component
2. Create 3D avatar component (optional)
3. Implement lip-sync manager
4. Create avatar selector UI

### Phase 3: Voice Integration
1. Web Speech API implementation
2. ElevenLabs integration (optional upgrade)
3. Audio-lip-sync bridge

### Phase 4: UI Updates
1. Update admin panel for full preset management
2. Add voice/avatar config to session creation
3. Update main viewer with toggle modes

---

## Part 8: File Structure

```
/public/
  ├── index.html (existing)
  ├── admin.html (existing)
  ├── avatars/
  │   ├── AvatarSystem.js       # Main controller
  │   ├── Live2DAvatar.js       # 2D implementation
  │   ├── ThreeDAvatar.js       # 3D implementation
  │   ├── LipSyncManager.js     # Audio analysis
  │   └── models/
  │       ├── live2d/
  │       │   ├── default_a/    # Default commentator A
  │       │   └── default_b/    # Default commentator B
  │       └── rpm/
  ├── voice/
  │   ├── TTSManager.js         # Web Speech + ElevenLabs
  │   └── VoiceSelector.js      # UI component
  └── commentary/
      ├── CommentaryViewer.js   # Main viewer
      ├── TextMode.js           # Existing bubble UI
      └── VoiceMode.js          # New avatar UI
```

---

## Next Steps

1. **Choose 2D vs 3D**: I recommend starting with 2D (Live2D) - simpler, lighter, more cartoonish/fun
2. **Get Live2D models**: Either use free samples or generate simple ones
3. **Implement in stages**: Presets fix → Voice → Avatar → Lip-sync
4. **Test audio pipeline**: Ensure Web Audio API works with your TTS choice

Ready to implement? I can provide the complete code for any phase.
