"""
Piper TTS on Modal
High-quality text-to-speech with Amy voice
"""

import modal
import io
import base64

# Download voice model helper for image build
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

# Create image with Piper and pre-downloaded voice
image = (
    modal.Image.debian_slim()
    .apt_install("git", "build-essential", "cmake", "libespeak-ng-dev")
    .pip_install("piper-tts", "onnxruntime", "fastapi[standard]")
    .run_function(download_voice)
)

# Create Modal app
app = modal.App("sushi-piper-tts", image=image)

@app.function(
    gpu=None,
    memory=1024, # Increased memory for stability
    timeout=60, # Increased timeout
    scaledown_window=300,
)
@modal.fastapi_endpoint(method="POST")
def tts(request: dict):
    """
    Convert text to speech using Piper TTS
    """
    import piper
    import wave
    import numpy as np
    import time
    
    start_time = time.time()
    text = request.get("text", "")
    if not text:
        return {"error": "text required"}, 400
    
    print(f"Synthesizing: {text[:50]}...")
    
    try:
        from piper.voice import PiperVoice
        model_path = "/root/voices/en_US-amy-medium.onnx"
        config_path = "/root/voices/en_US-amy-medium.onnx.json"
        
        # Initialize Piper voice
        voice = PiperVoice.load(model_path, config_path=config_path)
        
        # Generate audio frames
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(voice.config.sample_rate)
            
            # Synthesize and write frames
            for audio_bytes in voice.synthesize_stream(text):
                wav_file.writeframes(audio_bytes)
        
        # Encode as base64
        wav_buffer.seek(0)
        audio_data = wav_buffer.read()
        audio_base64 = base64.b64encode(audio_data).decode('utf-8')
        
        elapsed = time.time() - start_time
        print(f"Synthesized {len(audio_data)} bytes in {elapsed:.2f}s")
        
        return {
            "audio": audio_base64,
            "format": "wav",
            "sample_rate": voice.config.sample_rate,
            "size": len(audio_data),
            "elapsed": elapsed
        }
    except Exception as e:
        print(f"Piper error: {str(e)}")
        return {"error": str(e)}, 500


@app.function(image=image)
@modal.fastapi_endpoint(method="GET")
def health():
    """Health check endpoint"""
    return {"status": "ok", "service": "piper-tts"}


if __name__ == "__main__":
    # Test locally
    print("Testing Piper TTS...")
    download_voice()
    result = tts.local({"text": "Hello from Piper TTS on Modal!"})
    print(f"Generated {len(result['audio'])} bytes of audio")
