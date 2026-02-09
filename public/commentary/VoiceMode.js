/**
 * VoiceMode - Voice commentary with animated avatars
 * 
 * This component replaces the text bubble UI with:
 * - Side-by-side avatars for two commentators
 * - TTS audio playback
 * - Real-time lip-sync
 * - Expression reactions based on play mood
 * 
 * Dependencies:
 * - TTSManager.js
 * - LipSyncManager.js
 * - Live2DAvatar.js (or ThreeDAvatar.js)
 * 
 * Usage:
 * const voiceMode = new VoiceMode('voice-container', {
 *   commentatorA: { name: 'Big Mike', voice: {...}, avatar: {...} },
 *   commentatorB: { name: 'Salty Steve', voice: {...}, avatar: {...} }
 * });
 * voiceMode.playCommentary(turns);
 */

class VoiceMode {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) throw new Error(`Container #${containerId} not found`);
    
    this.options = {
      width: options.width || '100%',
      height: options.height || '500px',
      commentatorA: options.commentatorA || {},
      commentatorB: options.commentatorB || {},
      autoPlay: options.autoPlay !== false,
      showSubtitles: options.showSubtitles !== false,
      ...options
    };
    
    // Sub-components
    this.tts = null;
    this.lipSyncA = null;
    this.lipSyncB = null;
    this.avatarA = null;
    this.avatarB = null;
    
    // State
    this.isPlaying = false;
    this.currentTurn = 0;
    this.turnQueue = [];
    this.subtitleElement = null;
    
    this._init();
  }

  /**
   * Initialize UI and components
   */
  async _init() {
    this._createUI();
    
    // Initialize TTS
    this.tts = new TTSManager({
      provider: this.options.ttsProvider || 'webspeech',
      apiKey: this.options.ttsApiKey
    });
    
    // Initialize lip-sync managers
    this.lipSyncA = new LipSyncManager({ mode: 'volume', smoothing: 0.4 });
    this.lipSyncB = new LipSyncManager({ mode: 'volume', smoothing: 0.4 });
    await this.lipSyncA.initialize();
    await this.lipSyncB.initialize();
    
    // Initialize avatars (after DOM created)
    await this._initAvatars();
  }

  /**
   * Create the UI structure
   */
  _createUI() {
    this.container.innerHTML = `
      <div class="voice-mode-container" style="
        width: ${this.options.width};
        height: ${this.options.height};
        background: linear-gradient(180deg, #0a0a0f 0%, #12121a 100%);
        border-radius: 16px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
      ">
        <!-- Header -->
        <div style="
          padding: 12px 16px;
          background: rgba(255,255,255,0.03);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="
              width: 8px;
              height: 8px;
              background: #FFB81C;
              border-radius: 50%;
              animation: pulse 2s infinite;
            "></div>
            <span style="font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.7);">
              AI COMMENTARY
            </span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="vm-skip" style="
              padding: 4px 12px;
              background: rgba(255,255,255,0.05);
              border: 1px solid rgba(255,255,255,0.1);
              border-radius: 6px;
              color: rgba(255,255,255,0.5);
              font-size: 11px;
              cursor: pointer;
            ">Skip</button>
            <button id="vm-mute" style="
              padding: 4px 12px;
              background: rgba(255,255,255,0.05);
              border: 1px solid rgba(255,255,255,0.1);
              border-radius: 6px;
              color: rgba(255,255,255,0.5);
              font-size: 11px;
              cursor: pointer;
            ">Mute</button>
          </div>
        </div>
        
        <!-- Avatar Stage -->
        <div style="
          flex: 1;
          display: flex;
          justify-content: center;
          align-items: flex-end;
          gap: 20px;
          padding: 20px;
          position: relative;
        ">
          <!-- Avatar A -->
          <div id="vm-avatar-a" style="
            width: 45%;
            height: 100%;
            position: relative;
          "></div>
          
          <!-- VS Badge -->
          <div style="
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #FFB81C, #FF6B35);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 900;
            color: #000;
            z-index: 10;
          ">VS</div>
          
          <!-- Avatar B -->
          <div id="vm-avatar-b" style="
            width: 45%;
            height: 100%;
            position: relative;
          "></div>
        </div>
        
        <!-- Subtitles -->
        ${this.options.showSubtitles ? `
        <div id="vm-subtitles" style="
          padding: 16px 20px;
          background: linear-gradient(0deg, rgba(0,0,0,0.8) 0%, transparent 100%);
          min-height: 60px;
          text-align: center;
        ">
          <div id="vm-speaker" style="
            font-size: 10px;
            font-weight: 700;
            color: #FFB81C;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 4px;
          ">Waiting...</div>
          <div id="vm-text" style="
            font-size: 16px;
            font-weight: 500;
            color: rgba(255,255,255,0.9);
            line-height: 1.4;
            min-height: 24px;
          ">Click to start commentary</div>
        </div>
        ` : ''}
      </div>
      
      <style>
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
        .voice-mode-container button:hover {
          background: rgba(255,255,255,0.1) !important;
        }
        .voice-mode-container .speaking {
          filter: drop-shadow(0 0 20px rgba(255,184,28,0.3));
        }
      </style>
    `;
    
    // Event listeners
    this.container.querySelector('#vm-skip')?.addEventListener('click', () => this.skip());
    this.container.querySelector('#vm-mute')?.addEventListener('click', () => this.toggleMute());
    this.container.addEventListener('click', () => this._handleFirstInteraction());
    
    this.subtitleElement = {
      speaker: this.container.querySelector('#vm-speaker'),
      text: this.container.querySelector('#vm-text')
    };
  }

  /**
   * Initialize avatar instances
   */
  async _initAvatars() {
    const avatarConfig = this.options.commentatorA?.avatar || { type: 'live2d' };
    const avatarConfigB = this.options.commentatorB?.avatar || { type: 'live2d' };
    
    try {
      // Avatar A
      if (avatarConfig.type === 'live2d') {
        this.avatarA = new Live2DAvatar('vm-avatar-a', {
          width: 300,
          height: 400,
          modelPath: avatarConfig.model || '/avatars/models/live2d/default_a/model3.json',
          scale: avatarConfig.scale || 1.2
        });
        await this.avatarA.load();
      }
      // TODO: Add 3D avatar support
      
      // Avatar B
      if (avatarConfigB.type === 'live2d') {
        this.avatarB = new Live2DAvatar('vm-avatar-b', {
          width: 300,
          height: 400,
          modelPath: avatarConfigB.model || '/avatars/models/live2d/default_b/model3.json',
          scale: avatarConfigB.scale || 1.2
        });
        await this.avatarB.load();
      }
      
      console.log('Avatars initialized');
    } catch (error) {
      console.error('Failed to load avatars:', error);
      // Show placeholder if avatars fail
      this._showAvatarPlaceholder('vm-avatar-a', this.options.commentatorA?.name || 'A');
      this._showAvatarPlaceholder('vm-avatar-b', this.options.commentatorB?.name || 'B');
    }
  }

  /**
   * Show placeholder when avatar fails to load
   */
  _showAvatarPlaceholder(containerId, name) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = `
      <div style="
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(255,255,255,0.03);
        border-radius: 12px;
      ">
        <div style="
          width: 80px;
          height: 80px;
          background: linear-gradient(135deg, #FFB81C, #FF6B35);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          font-weight: 900;
          color: #000;
          margin-bottom: 12px;
        ">${name.charAt(0)}</div>
        <div style="font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.7);">${name}</div>
      </div>
    `;
  }

  /**
   * Handle first user interaction (browser audio policy)
   */
  async _handleFirstInteraction() {
    if (this.hasInteracted) return;
    this.hasInteracted = true;
    
    await this.tts.resume();
    await this.lipSyncA.initialize();
    await this.lipSyncB.initialize();
    
    // Auto-play if we have queued commentary
    if (this.turnQueue.length > 0 && !this.isPlaying) {
      this._playNextTurn();
    }
  }

  /**
   * Play commentary turns
   * @param {Array} turns - Array of { speaker: 'A'|'B', name, text, team, mood? }
   * @param {Object} playMood - Current play mood for reactions
   */
  async playCommentary(turns, playMood = null) {
    this.turnQueue = turns;
    this.currentTurn = 0;
    
    // Set initial reactions based on mood
    if (playMood && this.avatarA && this.avatarB) {
      this.avatarA.react(playMood);
      this.avatarB.react(playMood);
    }
    
    if (this.hasInteracted) {
      this._playNextTurn();
    } else {
      this._updateSubtitle('Click to start', 'Waiting for interaction...');
    }
  }

  /**
   * Play the next turn in queue
   */
  async _playNextTurn() {
    if (this.currentTurn >= this.turnQueue.length) {
      this.isPlaying = false;
      this._updateSubtitle('', 'Commentary complete');
      return;
    }
    
    const turn = this.turnQueue[this.currentTurn];
    const isA = turn.speaker === 'A';
    const avatar = isA ? this.avatarA : this.avatarB;
    const lipSync = isA ? this.lipSyncA : this.lipSyncB;
    const voiceConfig = isA 
      ? this.options.commentatorA?.voice 
      : this.options.commentatorB?.voice;
    
    this.isPlaying = true;
    
    // Update UI
    this._highlightSpeaker(isA);
    this._updateSubtitle(turn.name, turn.text);
    
    // React to content (simple sentiment)
    if (avatar) {
      const sentiment = this._analyzeSentiment(turn.text);
      if (sentiment !== 'neutral') {
        avatar.react(sentiment);
      }
    }
    
    try {
      // Speak with lip-sync
      await this.tts.speak(turn.text, voiceConfig, (audioData) => {
        // Connect audio to lip-sync
        if (audioData && audioData.node) {
          lipSync.connectSource(audioData.node);
          lipSync.start((data) => {
            if (avatar) {
              avatar.setLipSync(data.volume, data.viseme);
            }
          });
        }
      });
      
      // Stop lip-sync
      lipSync.stop();
      if (avatar) {
        avatar.setLipSync(0);
      }
      
    } catch (error) {
      console.error('TTS error:', error);
      // Continue even if TTS fails
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Next turn
    this.currentTurn++;
    this._playNextTurn();
  }

  /**
   * Simple sentiment analysis for reactions
   */
  _analyzeSentiment(text) {
    const lower = text.toLowerCase();
    if (lower.match(/\b(great|amazing|incredible|wow|yes|perfect)\b/)) return 'electric';
    if (lower.match(/\b(bad|terrible|awful|no|ugh|disaster)\b/)) return 'disaster';
    if (lower.match(/\b(haha|lol|funny|laugh)\b/)) return 'happy';
    if (lower.match(/\b(what|how|why|unbelievable)\b/)) return 'surprised';
    return 'neutral';
  }

  /**
   * Highlight current speaker
   */
  _highlightSpeaker(isA) {
    const containerA = document.getElementById('vm-avatar-a');
    const containerB = document.getElementById('vm-avatar-b');
    
    if (containerA) containerA.classList.toggle('speaking', isA);
    if (containerB) containerB.classList.toggle('speaking', !isA);
  }

  /**
   * Update subtitle text
   */
  _updateSubtitle(speaker, text) {
    if (!this.subtitleElement) return;
    
    if (this.subtitleElement.speaker) {
      this.subtitleElement.speaker.textContent = speaker;
    }
    if (this.subtitleElement.text) {
      this.subtitleElement.text.textContent = text;
      // Fade in animation
      this.subtitleElement.text.style.opacity = '0';
      setTimeout(() => {
        this.subtitleElement.text.style.transition = 'opacity 0.2s';
        this.subtitleElement.text.style.opacity = '1';
      }, 50);
    }
  }

  /**
   * Skip current commentary
   */
  skip() {
    this.tts.stop();
    this.lipSyncA.stop();
    this.lipSyncB.stop();
    
    if (this.avatarA) this.avatarA.setLipSync(0);
    if (this.avatarB) this.avatarB.setLipSync(0);
    
    this.currentTurn++;
    this._playNextTurn();
  }

  /**
   * Toggle mute
   */
  toggleMute() {
    // TODO: Implement mute
    console.log('Toggle mute');
  }

  /**
   * Cleanup
   */
  destroy() {
    this.tts?.stop();
    this.lipSyncA?.destroy();
    this.lipSyncB?.destroy();
    this.avatarA?.destroy();
    this.avatarB?.destroy();
    this.container.innerHTML = '';
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VoiceMode;
}
