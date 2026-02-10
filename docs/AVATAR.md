# VRM Avatar System

3D anime avatars using VRM format with Three.js and @pixiv/three-vrm.

## Overview

The avatar system renders interactive 3D characters that:
- Speak with lip-sync (viseme-based mouth animation)
- Show facial expressions (happy, sad, angry, surprised, relaxed)
- Have idle animations (breathing, blinking)
- Respond to user interaction

## Technical Stack

- **Three.js** v0.160.0 - 3D rendering engine
- **@pixiv/three-vrm** v3 - VRM model loading and animation
- **Web Audio API** - Audio analysis for lip-sync
- **VRM Models** - From VRoid Hub (anime-style characters)

## File Structure

```
public/
├── avatar.html          # Main avatar viewer
├── vrm-models/          # Local VRM files (optional)
└── lib/                 # Three.js libraries (optional, CDN preferred)
```

## VRM Model Format

VRM is a standard 3D avatar format for VTubers with:
- **Humanoid bones** - For body animation
- **Blendshapes** - For facial expressions and lip-sync
- **Spring bones** - For hair/cloth physics
- **Materials** - Toon shading (MToon)

### Required Blendshapes

For lip-sync (visemes):
- `aa` - Open mouth (A sound)
- `ih` - Smile (I sound)
- `ou` - Puckered lips (U sound)
- `E` - Wide mouth (E sound)
- `oh` - Round mouth (O sound)
- `PP` - Closed lips (B/M/P sounds)
- `FF` - Bite lip (F/V sounds)
- `TH` - Tongue out (TH sound)
- `DD` - Tongue up (D/T sounds)
- `kk` - Throat (K/G sounds)
- `CH` - Wide (CH/J sounds)
- `SS` - Teeth showing (S/Z sounds)
- `nn` - Nose (N/L sounds)
- `RR` - Throat (R sound)

For expressions:
- `happy`, `sad`, `angry`, `surprised`, `relaxed`, `neutral`
- `blink`, `blinkLeft`, `blinkRight`

## Pose System

The avatar starts in T-pose (arms horizontal). We fix this by rotating arms downward:

```javascript
// VRM T-pose has arms at 90 degrees (PI/2)
// We rotate to ~30 degrees for natural standing pose
leftUpperArm.rotation.z = -0.5;   // Left arm down
rightUpperArm.rotation.z = 0.5;   // Right arm down
```

### Bone Naming

Different VRM models use different bone naming:
- `leftUpperArm` / `LeftUpperArm`
- `leftArm` / `LeftArm`
- `leftShoulder` / `LeftShoulder`

The code tries multiple naming conventions and falls back gracefully.

## Lip Sync System

### Audio Analysis

1. TTS generates audio (WAV from Piper or Web Speech)
2. Audio decoded to AudioBuffer
3. AnalyserNode extracts frequency data in real-time
4. Volume mapped to viseme blendshapes

```javascript
analyser.getByteFrequencyData(dataArray);
const volume = average(dataArray) / 255;

if (volume > threshold) {
    // Map to viseme based on current word
    expressionManager.setValue(viseme, 0.7);
}
```

### Viseme Mapping

Simple phoneme-to-viseme mapping:
- Vowels (a, e, i, o, u) → corresponding visemes
- Consonants (b, m, p) → PP (closed)
- Consonants (f, v) → FF (bite)
- Consonants (s, z) → SS (teeth)

## Idle Animations

### Breathing

```javascript
const breath = Math.sin(time * 2) * 0.02;
chest.position.y = breath * 0.5;
spine.position.y = breath;
```

### Blinking

```javascript
// Random blink every 2-5 seconds
if (blinkTime > nextBlink) {
    expressionManager.setValue('blink', 1);
    setTimeout(() => expressionManager.setValue('blink', 0), 150);
}
```

## Mobile Support

The avatar viewer is responsive:
- **Desktop/Landscape**: Side-by-side dual avatars
- **Mobile Portrait**: Stacked single avatar
- Touch events for expression buttons

## Adding New VRM Models

1. Download VRM from VRoid Hub or create in VRoid Studio
2. Upload to CDN or place in `public/vrm-models/`
3. Update `VRM_URL` in `avatar.html`

### Recommended Free Models

- **Alicia Solid** - Classic anime girl (CC0)
- **VRoid Hub** - https://hub.vroid.com (thousands of free models)
- **Booth.pm** - https://booth.pm (paid and free)

## Troubleshooting

### Avatar not loading
- Check VRM URL is accessible (no 404)
- Check browser console for CORS errors
- Verify VRM format (VRM 0.x or 1.0)

### T-pose not fixed
- Check console for "Pose applied" log
- Verify bone names in VRM match expected patterns
- Try `vrm.humanoid.resetPose()` then re-apply

### Lip sync not working
- Check audio is playing (volume > 0)
- Verify blendshape names match VRM
- Check AnalyserNode is connected properly

## Resources

- [Three.js Docs](https://threejs.org/docs/)
- [@pixiv/three-vrm](https://github.com/pixiv/three-vrm)
- [VRM Specification](https://vrm.dev/)
- [VRoid Studio](https://vroid.com/studio)
