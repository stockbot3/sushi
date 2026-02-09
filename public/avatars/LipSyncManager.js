/**
 * LipSyncManager - Real-time audio analysis for avatar lip-sync
 * 
 * Supports two modes:
 * 1. Volume-based (simple): Maps audio volume to mouth openness
 * 2. Viseme-based (advanced): Detects phonemes using frequency analysis
 * 
 * Compatible with: Live2D (ParamMouthOpenY) and 3D models (blendshapes)
 */

class LipSyncManager {
  constructor(options = {}) {
    this.mode = options.mode || 'volume'; // 'volume' | 'viseme'
    this.smoothing = options.smoothing || 0.3; // 0-1, lower = smoother
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.isActive = false;
    this.rafId = null;
    
    // For smoothing
    this.lastVolume = 0;
    this.lastViseme = 'PP';
    
    // Viseme detection thresholds (tune these)
    this.visemeThresholds = {
      aa: { low: 0.6, mid: 0.3, high: 0.1 },  // A - low freq dominant
      E:  { low: 0.3, mid: 0.6, high: 0.1 },  // E - mid freq dominant  
      I:  { low: 0.3, mid: 0.6, high: 0.3 },  // I - mid freq
      O:  { low: 0.6, mid: 0.2, high: 0.2 },  // O - low freq
      U:  { low: 0.2, mid: 0.2, high: 0.6 },  // U - high freq
    };
  }

  /**
   * Initialize audio context and analyser
   * Call this once before starting lip-sync
   */
  async initialize() {
    if (this.audioContext) return;
    
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = this.smoothing;
    
    // Resume context if suspended (browser policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Connect an audio element or media stream for analysis
   */
  connectSource(source) {
    if (!this.audioContext) throw new Error('Call initialize() first');
    
    let node;
    if (source instanceof HTMLMediaElement) {
      node = this.audioContext.createMediaElementSource(source);
    } else if (source instanceof MediaStream) {
      node = this.audioContext.createMediaStreamSource(source);
    } else {
      throw new Error('Source must be HTMLMediaElement or MediaStream');
    }
    
    node.connect(this.analyser);
    // Don't connect analyser to destination - let caller handle audio output
    return node;
  }

  /**
   * Start analyzing audio and calling callback with lip data
   * @param {Function} callback - Called with { volume: 0-1, viseme: string, isActive: bool }
   */
  start(callback) {
    if (!this.analyser) throw new Error('Call initialize() first');
    if (this.isActive) return;
    
    this.isActive = true;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    
    const analyze = () => {
      if (!this.isActive) return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      const result = this.mode === 'viseme' 
        ? this._analyzeVisemes(dataArray)
        : this._analyzeVolume(dataArray);
      
      callback(result);
      this.rafId = requestAnimationFrame(analyze);
    };
    
    analyze();
  }

  /**
   * Stop analysis
   */
  stop() {
    this.isActive = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Get current audio data (one-shot)
   */
  getCurrentData() {
    if (!this.analyser) return { volume: 0, viseme: 'PP', isActive: false };
    
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    
    return this.mode === 'viseme'
      ? this._analyzeVisemes(dataArray)
      : this._analyzeVolume(dataArray);
  }

  /**
   * Volume-based analysis (simple, fast)
   */
  _analyzeVolume(dataArray) {
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    const volume = average / 255;
    
    // Smooth
    const smoothed = this.lastVolume * this.smoothing + volume * (1 - this.smoothing);
    this.lastVolume = smoothed;
    
    return {
      volume: smoothed,
      viseme: smoothed > 0.3 ? 'aa' : 'PP',
      isActive: smoothed > 0.05,
      raw: dataArray
    };
  }

  /**
   * Viseme-based analysis (detects vowels)
   */
  _analyzeVisemes(dataArray) {
    const binCount = dataArray.length;
    
    // Split into frequency bands
    const lowEnd = Math.floor(binCount * 0.15);   // 0-15% - bass/vowels
    const midEnd = Math.floor(binCount * 0.50);   // 15-50% - mids
    // Remaining 50-100% - highs
    
    const low = dataArray.slice(0, lowEnd).reduce((a, b) => a + b) / lowEnd / 255;
    const mid = dataArray.slice(lowEnd, midEnd).reduce((a, b) => a + b) / (midEnd - lowEnd) / 255;
    const high = dataArray.slice(midEnd).reduce((a, b) => a + b) / (binCount - midEnd) / 255;
    
    // Determine viseme based on dominant frequency
    let bestViseme = 'PP';
    let bestScore = 0.2; // Threshold
    
    for (const [viseme, thresholds] of Object.entries(this.visemeThresholds)) {
      const score = (low * thresholds.low + mid * thresholds.mid + high * thresholds.high);
      if (score > bestScore) {
        bestScore = score;
        bestViseme = viseme;
      }
    }
    
    // Smooth viseme changes
    if (bestViseme === this.lastViseme) {
      // Stay longer on same viseme
    } else if (bestScore < 0.3) {
      bestViseme = this.lastViseme; // Not confident enough
    }
    this.lastViseme = bestViseme;
    
    const volume = (low + mid + high) / 3;
    
    return {
      volume,
      viseme: bestViseme,
      bands: { low, mid, high },
      isActive: volume > 0.05,
      raw: dataArray
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LipSyncManager;
}
