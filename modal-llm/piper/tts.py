"""
Piper TTS on Modal
High-quality text-to-speech with Amy (Female) and Bryce (Male) voices
"""

import modal
import io
import base64

# Download voice models helper for image build
def download_voices():
    import urllib.request
    import os
    
    voice_dir = "/root/voices"
    os.makedirs(voice_dir, exist_ok=True)
    
    # Amy voice (Female, medium quality)
    amy_base = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/"
    # Bryce voice (Male, medium quality)
    bryce_base = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/bryce/medium/"
    
    files = {
        "amy": [amy_base + "en_US-amy-medium.onnx", amy_base + "en_US-amy-medium.onnx.json"],
        "bryce": [bryce_base + "en_US-bryce-medium.onnx", bryce_base + "en_US-bryce-medium.onnx.json"]
    }
    
    for v_name, urls in files.items():
        for url in urls:
            f_name = url.split("/")[-1]
            path = os.path.join(voice_dir, f_name)
            if not os.path.exists(path):
                print(f"Downloading {f_name}...")
                urllib.request.urlretrieve(url, path)
    
    return voice_dir

# Create image with Piper and pre-downloaded voices
image = (
    modal.Image.debian_slim()
    .apt_install("git", "build-essential", "cmake", "libespeak-ng-dev")
    .pip_install("piper-tts", "onnxruntime", "fastapi[standard]", "pathvalidate")
    .run_function(download_voices)
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
    Request: {"text": "...", "voice": "amy" | "bryce"}
    """
    import subprocess
    import tempfile
    import time
    import os
    
    start_time = time.time()
    text = request.get("text", "")
    voice_key = request.get("voice", "amy").lower()
    
    if not text:
        return {"error": "text required"}, 400
    
    # Map voice key to file
    model_map = {
        "amy": "/root/voices/en_US-amy-medium.onnx",
        "bryce": "/root/voices/en_US-bryce-medium.onnx"
    }
    model_path = model_map.get(voice_key, model_map["amy"])
    
    print(f"Synthesizing ({voice_key}): {text[:50]}...")
    
    try:
        # Use temp file to ensure WAV header is written correctly
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            output_path = f.name
            
        # Run piper via CLI
        cmd = [
            "piper",
            "--model", model_path,
            "--output_file", output_path
        ]
        
        process = subprocess.run(
            cmd,
            input=text.encode('utf-8'),
            capture_output=True,
            check=True
        )
        
        with open(output_path, "rb") as f:
            audio_data = f.read()
            
        os.unlink(output_path)
        
        if not audio_data or len(audio_data) < 100:
            raise Exception(f"Generated audio too small. Stderr: {process.stderr.decode()}")
            
        audio_base64 = base64.b64encode(audio_data).decode('utf-8')
        elapsed = time.time() - start_time
        print(f"Synthesized {len(audio_data)} bytes in {elapsed:.2f}s")
        
        return {
            "audio": audio_base64,
            "format": "wav",
            "sample_rate": 22050,
            "size": len(audio_data),
            "voice": voice_key,
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
    return {"status": "ok", "service": "piper-tts", "voices": ["amy", "bryce"]}