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
    .pip_install("piper-tts", "onnxruntime", "fastapi[standard]", "pathvalidate")
    .run_function(download_voice)
)

# Create Modal app
app = modal.App("sushi-piper-tts", image=image)

@app.function(
    gpu=None,
    memory=1024,
    timeout=60,
    scaledown_window=300,
)
@modal.fastapi_endpoint(method="POST")
def tts(request: dict):
    """
    Convert text to speech using Piper TTS CLI
    """
    import subprocess
    import tempfile
    import time
    import os
    
    start_time = time.time()
    text = request.get("text", "")
    if not text:
        return {"error": "text required"}, 400
    
    print(f"Synthesizing: {text[:50]}...")
    
    try:
        model_path = "/root/voices/en_US-amy-medium.onnx"
        
        # Use temp file to ensure WAV header is written correctly
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            output_path = f.name
            
        # Run piper via CLI - most robust method
        cmd = [
            "piper",
            "--model", model_path,
            "--output_file", output_path
        ]
        
        # Pipe text to stdin
        process = subprocess.run(
            cmd,
            input=text.encode('utf-8'),
            capture_output=True,
            check=True
        )
        
        # Read the generated WAV file
        with open(output_path, "rb") as f:
            audio_data = f.read()
            
        # Cleanup
        os.unlink(output_path)
        
        if not audio_data or len(audio_data) < 100:
            raise Exception(f"Generated audio too small. Stderr: {process.stderr.decode()}")
            
        print(f"Generated {len(audio_data)} bytes of WAV audio")
        audio_base64 = base64.b64encode(audio_data).decode('utf-8')
        
        elapsed = time.time() - start_time
        
        return {
            "audio": audio_base64,
            "format": "wav",
            "sample_rate": 22050,
            "size": len(audio_data),
            "elapsed": elapsed
        }
    except subprocess.CalledProcessError as e:
        print(f"Piper process error: {e.stderr.decode()}")
        return {"error": f"TTS process failed: {e.stderr.decode()}"}, 500
    except Exception as e:
        import traceback
        traceback.print_exc()
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
