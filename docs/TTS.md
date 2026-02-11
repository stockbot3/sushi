# Text-to-Speech (TTS) System

High-quality TTS using Piper on Modal with Web Speech API fallback.

## Overview

The TTS system has two tiers:
1. **Primary**: Piper TTS on Modal (high quality, natural voice)
2. **Fallback**: Web Speech API (browser built-in, robotic voice)

## Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────────┐
│  Avatar  │────▶│ Node.js  │────▶│ Modal Piper  │
│   HTML   │◀────│  Server  │◀────│   (Amy)      │
└──────────┘     └──────────┘     └──────────────┘
      │                  │
      └──────────────────┘
         (Web Speech Fallback)
```

## Modal Piper TTS

### Deployment

```bash
cd modal-llm/piper
source /path/to/venv/bin/activate
modal deploy tts.py
```

### Endpoint

```
POST https://yourusername--sushi-piper-tts-tts.modal.run
Content-Type: application/json

{"text": "Hello world"}
```

### Response

```json
{
  "audio": "base64_encoded_wav...",
  "format": "wav",
  "sample_rate": 22050
}
```

### Voice Model

- **Name**: Amy (en_US)
- **Quality**: Medium (good balance of quality/speed)
- **Size**: ~60MB
- **Speed**: ~2s first call, ~200ms warm

### Configuration

```python
@app.function(
    gpu=None,              # CPU only (sufficient for TTS)
    memory=512,            # 512MB RAM
    timeout=30,            # 30s timeout
    scaledown_window=300,  # Keep warm 5 min
)
```

## Web Speech Fallback

When Modal fails (502 error, timeout, etc.), the system falls back to Web Speech API:

```javascript
const synthesis = window.speechSynthesis;
const utterance = new SpeechSynthesisUtterance(text);
synthesis.speak(utterance);
```

### Browser Support

- Chrome/Edge: Full support
- Safari: Limited voices
- Firefox: Good support
- iOS Safari: Requires user gesture to unlock audio; use the Start Stream tap and Mute/Unmute button

## Lip Sync Integration

TTS audio is analyzed in real-time for lip-sync:

```javascript
// 1. Decode audio
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

// 2. Create source + analyser
const source = audioContext.createBufferSource();
const analyser = audioContext.createAnalyser();
source.connect(analyser);
analyser.connect(audioContext.destination);

// 3. Analyze in animation loop
analyser.getByteFrequencyData(dataArray);
const volume = average(dataArray) / 255;

// 4. Map to viseme
if (volume > 0.15) {
    vrm.expressionManager.setValue(viseme, 0.7);
}
```

## Environment Variables

```bash
# Required
MODAL_PIPER_URL=https://yourusername--sushi-piper-tts-tts.modal.run

# Optional (uses hardcoded fallback if not set)
```

## Troubleshooting

### 502 Bad Gateway

Modal cold start taking too long (>30s). Solutions:
1. Increase `timeout` in Modal function
2. Use `keep_warm=True` (always on, costs more)
3. Accept fallback to Web Speech

### No audio playing

Check browser console:
- AudioContext suspended? User must click first (autoplay policy)
- CORS error? Check Modal endpoint URL
- Base64 decode error? Verify response format

### Lip sync not matching

Web Speech doesn't provide phoneme timing. The fallback uses:
- Word boundary events → approximate visemes
- Less accurate than Piper's audio analysis

## Costs

### Modal

- **Cold start**: ~2s, charged for compute time
- **Warm request**: ~200ms, charged for compute time
- **Idle**: Not charged (container scaled down)

Typical: $0.0001-0.001 per request depending on text length.

### Alternative: Self-Hosted

Deploy Piper locally or on Railway:
- No per-request cost
- Higher memory requirement (~150MB)
- More complex deployment

## Future Improvements

1. **Streaming TTS** - Start playing before full generation
2. **Multiple Voices** - Male/female options
3. **Emotion Control** - Happy/sad intonation
4. **Caching** - Cache common phrases
5. **Preloading** - Load voice model on page load

## Resources

- [Piper TTS](https://github.com/rhasspy/piper)
- [Piper Voices](https://huggingface.co/rhasspy/piper-voices)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Modal Docs](https://modal.com/docs)
