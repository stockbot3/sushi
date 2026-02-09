/**
 * TTSManager - Text-to-Speech with multiple provider support
 * 
 * Providers:
 * - 'webspeech': Free, built-in browser voices
 * - 'elevenlabs': High quality, requires API key
 * - 'openai': Good quality, requires API key
 * 
 * Usage:
 * const tts = new TTSManager({ provider: 'elevenlabs', apiKey: '...' });
 * await tts.speak('Hello world', { voiceId: '...' });
 */

class TTSManager {
  constructor(options = {}) {
    this.provider = options.provider || 'webspeech';
    this.apiKey = options.apiKey || null;
    
    // Web Speech API
    this.synth = window.speechSynthesis;
    this.voices = [];
    
    // Audio context for all providers
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Current playback
    this.currentSource = null;
    this.isPlaying = false;
    this.onComplete = null;
    
    // Load voices for Web Speech
    if (this.provider === 'webspeech') {
      this._loadWebSpeechVoices();
    }
  }

  /**
   * Load available Web Speech voices
   */
  _loadWebSpeechVoices() {
    const loadVoices = () => {
      this.voices = this.synth.getVoices();
      console.log('Loaded', this.voices.length, 'Web Speech voices');
    };
    
    loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoices;
    }
  }

  /**
   * Get available voices for current provider
   */
  async getVoices() {
    switch (this.provider) {
      case 'webspeech':
        return this.voices.map(v => ({
          id: v.voiceURI,
          name: v.name,
          lang: v.lang,
          gender: v.name.toLowerCase().includes('female') ? 'female' : 'male'
        }));
        
      case 'elevenlabs':
        if (!this.apiKey) throw new Error('ElevenLabs API key required');
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
          headers: { 'xi-api-key': this.apiKey }
        });
        const data = await response.json();
        return data.voices.map(v => ({
          id: v.voice_id,
          name: v.name,
          preview: v.preview_url,
          labels: v.labels
        }));
        
      case 'openai':
        return [
          { id: 'alloy', name: 'Alloy', gender: 'neutral' },
          { id: 'echo', name: 'Echo', gender: 'male' },
          { id: 'fable', name: 'Fable', gender: 'neutral' },
          { id: 'onyx', name: 'Onyx', gender: 'male' },
          { id: 'nova', name: 'Nova', gender: 'female' },
          { id: 'shimmer', name: 'Shimmer', gender: 'female' }
        ];
        
      default:
        return [];
    }
  }

  /**
   * Speak text and return audio data for lip-sync
   * 
   * @param {string} text - Text to speak
   * @param {Object} options - Voice options
   * @param {Function} onAudioReady - Callback with audio node for lip-sync
   * @returns {Promise} Resolves when speech completes
   */
  async speak(text, options = {}, onAudioReady = null) {
    switch (this.provider) {
      case 'webspeech':
        return this._speakWebSpeech(text, options, onAudioReady);
      case 'elevenlabs':
        return this._speakElevenLabs(text, options, onAudioReady);
      case 'openai':
        return this._speakOpenAI(text, options, onAudioReady);
      default:
        throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  /**
   * Web Speech API implementation
   */
  _speakWebSpeech(text, options, onAudioReady) {
    return new Promise((resolve, reject) => {
      if (!this.synth) {
        reject(new Error('Web Speech API not supported'));
        return;
      }
      
      // Cancel any ongoing speech
      this.synth.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Voice selection
      if (options.voiceId) {
        utterance.voice = this.voices.find(v => v.voiceURI === options.voiceId);
      } else if (options.lang) {
        utterance.voice = this.voices.find(v => v.lang === options.lang);
      }
      
      // Settings
      utterance.rate = options.rate || 1.0;
      utterance.pitch = options.pitch || 1.0;
      utterance.volume = options.volume || 1.0;
      
      // Events
      utterance.onstart = () => {
        this.isPlaying = true;
        // For Web Speech, we can't easily get audio data for lip-sync
        // So we simulate it with a oscillator
        if (onAudioReady) {
          const oscillator = this._createSimulatedAudio();
          onAudioReady(oscillator);
        }
      };
      
      utterance.onend = () => {
        this.isPlaying = false;
        resolve();
      };
      
      utterance.onerror = (e) => {
        this.isPlaying = false;
        reject(new Error(`Speech error: ${e.error}`));
      };
      
      this.synth.speak(utterance);
    });
  }

  /**
   * Create simulated audio analysis for Web Speech
   * (Since we can't access the actual audio stream)
   */
  _createSimulatedAudio() {
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    const analyser = this.audioContext.createAnalyser();
    
    oscillator.frequency.value = 150;
    gainNode.gain.value = 0.1;
    
    oscillator.connect(gainNode);
    gainNode.connect(analyser);
    // Don't connect to destination - we just want analysis
    
    // Modulate based on speaking
    let speaking = true;
    const modulate = () => {
      if (!speaking) return;
      gainNode.gain.value = 0.05 + Math.random() * 0.1;
      setTimeout(modulate, 50);
    };
    modulate();
    
    oscillator.start();
    
    return { node: analyser, stop: () => {
      speaking = false;
      oscillator.stop();
    }};
  }

  /**
   * ElevenLabs implementation
   */
  async _speakElevenLabs(text, options, onAudioReady) {
    if (!this.apiKey) throw new Error('ElevenLabs API key required');
    
    const voiceId = options.voiceId || 'pNInz6obpgDQGcFmaJgB'; // Default: Adam
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: options.model || 'eleven_turbo_v2',
        voice_settings: {
          stability: options.stability ?? 0.5,
          similarity_boost: options.similarity_boost ?? 0.75,
          style: options.style ?? 0.0,
          use_speaker_boost: options.use_speaker_boost ?? true
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`ElevenLabs error: ${error.detail?.message || 'Unknown'}`);
    }
    
    // Get audio blob
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    
    // Play with audio context for lip-sync
    return this._playAudioWithAnalysis(audioUrl, onAudioReady);
  }

  /**
   * OpenAI TTS implementation
   */
  async _speakOpenAI(text, options, onAudioReady) {
    if (!this.apiKey) throw new Error('OpenAI API key required');
    
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: options.model || 'tts-1',
        voice: options.voiceId || 'alloy',
        input: text,
        response_format: 'mp3'
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI error: ${error.error?.message || 'Unknown'}`);
    }
    
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    
    return this._playAudioWithAnalysis(audioUrl, onAudioReady);
  }

  /**
   * Play audio with Web Audio API analysis for lip-sync
   */
  _playAudioWithAnalysis(audioUrl, onAudioReady) {
    return new Promise(async (resolve, reject) => {
      try {
        // Fetch and decode audio
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        
        // Create source
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        // Create analyser for lip-sync
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        
        // Connect: source -> analyser -> destination
        source.connect(analyser);
        analyser.connect(this.audioContext.destination);
        
        // Notify caller about audio node
        if (onAudioReady) {
          onAudioReady({ node: analyser, source });
        }
        
        // Play
        this.currentSource = source;
        this.isPlaying = true;
        
        source.onended = () => {
          this.isPlaying = false;
          this.currentSource = null;
          URL.revokeObjectURL(audioUrl);
          resolve();
        };
        
        source.start(0);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop current speech
   */
  stop() {
    if (this.provider === 'webspeech' && this.synth) {
      this.synth.cancel();
    }
    
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {}
      this.currentSource = null;
    }
    
    this.isPlaying = false;
  }

  /**
   * Check if currently speaking
   */
  isSpeaking() {
    return this.isPlaying;
  }

  /**
   * Resume audio context (needed after user interaction)
   */
  async resume() {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Set provider
   */
  setProvider(provider, apiKey = null) {
    this.provider = provider;
    if (apiKey) this.apiKey = apiKey;
    
    if (provider === 'webspeech') {
      this._loadWebSpeechVoices();
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TTSManager;
}
