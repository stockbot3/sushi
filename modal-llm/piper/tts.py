"""
Piper TTS on Modal
High-quality text-to-speech with Amy voice
"""

import modal
import io
import base64

# Create image with Piper installed
image = (
    modal.Image.debian_slim()
    .apt_install("git", "build-essential", "cmake", "libespeak-ng-dev")
    .pip_install("piper-tts", "onnxruntime")
)

# Download voice model at build time
def download_voice():
    import urllib.request
    import os
    
    voice_dir = "/root/voices"
    os.makedirs(voice_dir, exist_ok=True)
    
    # Amy voice (medium quality, ~60MB)
    base_url = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/"
    files = ["en_US-amy-medium.onnx", "en_US-amy-medium.onnx.json"]
    
    for f in files:
        path = os.path.join(voice_dir, f)
        if not os.path.exists(path):
            print(f"Downloading {f}...")
            urllib.request.urlretrieve(base_url + f, path)
    
    return voice_dir

# Create Modal app
app = modal.App("sushi-piper-tts", image=image)

@app.function(
    gpu=None,  # CPU is fine for TTS
    memory=512,  # 512MB is plenty
    timeout=30,
    container_idle_timeout=300,  # Keep warm for 5 min
)
@modal.web_endpoint(method="POST")
def tts(request: dict):
    """
    Convert text to speech using Piper TTS
    
    Request: {"text": "Hello world"}
    Response: {"audio": "base64_encoded_wav", "format": "wav"}
    """
    import piper
    import wave
    import numpy as np
    
    text = request.get("text", "")
    if not text:
        return {"error": "text required"}, 400
    
    # Download voice if needed
    voice_dir = download_voice()
    model_path = f"{voice_dir}/en_US-amy-medium.onnx"
    
    # Initialize Piper voice
    voice = piper.Voice(model_path)
    
    # Generate audio
    audio_data = voice.synthesize(text)
    
    # Convert to WAV bytes
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(22050)  # Sample rate
        wav_file.writeframes(audio_data.tobytes())
    
    # Encode as base64
    wav_buffer.seek(0)
    audio_base64 = base64.b64encode(wav_buffer.read()).decode('utf-8')
    
    return {
        "audio": audio_base64,
        "format": "wav",
        "sample_rate": 22050
    }


@app.function(image=image)
@modal.web_endpoint(method="GET")
def health():
    """Health check endpoint"""
    return {"status": "ok", "service": "piper-tts"}


if __name__ == "__main__":
    # Test locally
    print("Testing Piper TTS...")
    download_voice()
    result = tts.local({"text": "Hello from Piper TTS on Modal!"})
    print(f"Generated {len(result['audio'])} bytes of audio")
