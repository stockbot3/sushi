#!/usr/bin/env python3
"""
Simple HTTP server for Piper TTS
Runs on port 5000 and converts text to speech
"""

import http.server
import socketserver
import subprocess
import json
import os
import tempfile
import base64
from urllib.parse import parse_qs, urlparse

PORT = 5000
PIPER_DIR = os.path.dirname(os.path.abspath(__file__))
PIPER_BINARY = os.path.join(PIPER_DIR, "piper")
VOICE_MODEL = os.path.join(PIPER_DIR, "voice.onnx")


class TTSHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        
        if parsed.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
            return
        
        if parsed.path == "/tts":
            params = parse_qs(parsed.query)
            text = params.get("text", [""])[0]
            
            if not text:
                self.send_error(400, "Missing text parameter")
                return
            
            self.generate_speech(text)
            return
        
        self.send_error(404, "Not found")

    def do_POST(self):
        if self.path != "/tts":
            self.send_error(404, "Not found")
            return
        
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data.decode())
            text = data.get("text", "")
        except:
            data = parse_qs(post_data.decode())
            text = data.get("text", [""])[0]
        
        if not text:
            self.send_error(400, "Missing text")
            return
        
        self.generate_speech(text)

    def generate_speech(self, text):
        try:
            # Check if piper is available
            if not os.path.exists(PIPER_BINARY):
                self.send_error(500, "Piper not installed")
                return
            
            if not os.path.exists(VOICE_MODEL):
                self.send_error(500, "Voice model not found")
                return
            
            # Create temp file for output
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                output_file = tmp.name
            
            # Run piper
            process = subprocess.run(
                [
                    PIPER_BINARY,
                    "--model", VOICE_MODEL,
                    "--output_file", output_file,
                    "--quiet"
                ],
                input=text.encode(),
                capture_output=True
            )
            
            if process.returncode != 0:
                print(f"Piper error: {process.stderr.decode()}")
                self.send_error(500, "TTS generation failed")
                return
            
            # Read output file
            with open(output_file, "rb") as f:
                audio_data = f.read()
            
            # Clean up
            os.unlink(output_file)
            
            # Send response
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(audio_data)
            
        except Exception as e:
            print(f"Error: {e}")
            self.send_error(500, str(e))

    def log_message(self, format, *args):
        # Suppress logs
        pass


def run_server():
    # Run setup first
    setup_script = os.path.join(PIPER_DIR, "setup.sh")
    if os.path.exists(setup_script):
        subprocess.run(["bash", setup_script], check=False)
    
    with socketserver.TCPServer(("", PORT), TTSHandler) as httpd:
        print(f"Piper TTS server running on port {PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    run_server()
