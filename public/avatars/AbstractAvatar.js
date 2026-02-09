/**
 * AbstractAvatar - Polished geometric avatars with real-time effects
 * 
 * No external models needed - pure SVG/CSS/Canvas
 * Professional sports-broadcast aesthetic
 * 
 * Features:
 * - Hexagon avatar with team colors
 * - Real-time audio waveform visualization
 * - Expression emojis that change with mood
 * - Glow/pulse effects when speaking
 * - Particle celebration effects
 * - Smooth CSS transitions
 * 
 * Usage:
 * const avatar = new AbstractAvatar('container', {
 *   name: 'Big Mike',
 *   teamColor: '#ff6b35',
 *   teamAbbr: 'KC'
 * });
 * avatar.setSpeaking(true);
 * avatar.setExpression('excited');
 */

class AbstractAvatar {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) throw new Error(`Container #${containerId} not found`);
    
    this.options = {
      name: options.name || 'Commentator',
      teamColor: options.teamColor || '#FFB81C',
      teamAbbr: options.teamAbbr || '',
      teamLogo: options.teamLogo || null,
      size: options.size || 200,
      ...options
    };
    
    this.state = {
      isSpeaking: false,
      expression: 'neutral',
      intensity: 0, // 0-1 for animation
      waveformData: new Array(32).fill(0)
    };
    
    this.animationId = null;
    this.particles = [];
    
    this._init();
  }

  /**
   * Expressions and their emojis
   */
  static EXPRESSIONS = {
    neutral: '😐',
    happy: '😄',
    excited: '🤩',
    angry: '😤',
    sad: '😔',
    surprised: '😮',
    thinking: '🤔',
    laughing: '😂',
    cool: '😎',
    frustrated: '😒'
  };

  /**
   * Mood mapping from play outcomes
   */
  static MOOD_MAP = {
    electric: 'excited',
    big_play: 'excited',
    momentum_shift: 'surprised',
    disaster: 'frustrated',
    defensive_dominance: 'cool',
    controversial: 'angry',
    stuffed: 'sad',
    routine: 'neutral',
    pre: 'thinking',
    post: 'neutral'
  };

  _init() {
    this._createDOM();
    this._startAnimationLoop();
  }

  /**
   * Create the avatar DOM structure
   */
  _createDOM() {
    const size = this.options.size;
    const halfSize = size / 2;
    
    this.container.innerHTML = `
      <div class="abstract-avatar" style="
        width: ${size}px;
        height: ${size + 60}px;
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
      ">
        <!-- Main Avatar Container -->
        <div class="avatar-main" style="
          width: ${size}px;
          height: ${size}px;
          position: relative;
          transition: transform 0.3s ease;
        ">
          <!-- Glow Effect -->
          <div class="avatar-glow" style="
            position: absolute;
            inset: -20px;
            background: radial-gradient(circle, ${this.options.teamColor}40 0%, transparent 70%);
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
          "></div>
          
          <!-- Outer Ring (Waveform) -->
          <canvas class="waveform-ring" width="${size}" height="${size}" style="
            position: absolute;
            top: 0;
            left: 0;
            transform: rotate(-90deg);
          "></canvas>
          
          <!-- Hexagon Background -->
          <svg class="hexagon-bg" viewBox="0 0 100 100" style="
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            filter: drop-shadow(0 4px 20px ${this.options.teamColor}30);
          ">
            <defs>
              <linearGradient id="hexGradient-${this.container.id}" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${this._lighten(this.options.teamColor, 20)}" />
                <stop offset="100%" style="stop-color:${this.options.teamColor}" />
              </linearGradient>
            </defs>
            <polygon 
              points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" 
              fill="url(#hexGradient-${this.container.id})"
              stroke="${this.options.teamColor}"
              stroke-width="2"
            />
          </svg>
          
          <!-- Inner Hexagon -->
          <svg class="hexagon-inner" viewBox="0 0 100 100" style="
            position: absolute;
            top: 10%;
            left: 10%;
            width: 80%;
            height: 80%;
          ">
            <polygon 
              points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" 
              fill="rgba(0,0,0,0.3)"
              stroke="rgba(255,255,255,0.1)"
              stroke-width="1"
            />
          </svg>
          
          <!-- Expression Emoji -->
          <div class="avatar-expression" style="
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: ${size * 0.35}px;
            transition: all 0.3s ease;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
          ">${AbstractAvatar.EXPRESSIONS.neutral}</div>
          
          <!-- Team Badge -->
          ${this.options.teamAbbr ? `
          <div class="team-badge" style="
            position: absolute;
            bottom: 5%;
            right: 5%;
            background: rgba(0,0,0,0.5);
            color: white;
            font-size: ${size * 0.08}px;
            font-weight: 900;
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px solid ${this.options.teamColor};
          ">${this.options.teamAbbr}</div>
          ` : ''}
          
          <!-- Speaking Indicator -->
          <div class="speaking-indicator" style="
            position: absolute;
            top: 5%;
            right: 5%;
            width: ${size * 0.1}px;
            height: ${size * 0.1}px;
            background: #00ff88;
            border-radius: 50%;
            opacity: 0;
            transition: opacity 0.2s ease;
            box-shadow: 0 0 10px #00ff88;
          "></div>
          
          <!-- Particle Container -->
          <canvas class="particle-canvas" width="${size}" height="${size}" style="
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
          "></canvas>
        </div>
        
        <!-- Name Label -->
        <div class="avatar-name" style="
          margin-top: 12px;
          text-align: center;
          color: ${this.options.teamColor};
          font-weight: 700;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        ">${this.options.name}</div>
        
        <!-- Role Label -->
        <div class="avatar-role" style="
          margin-top: 4px;
          text-align: center;
          color: rgba(255,255,255,0.5);
          font-size: 11px;
        ">${this.options.teamAbbr ? this.options.teamAbbr + ' Commentator' : 'Commentator'}</div>
      </div>
    `;
    
    // Store references
    this.els = {
      main: this.container.querySelector('.avatar-main'),
      glow: this.container.querySelector('.avatar-glow'),
      expression: this.container.querySelector('.avatar-expression'),
      speakingIndicator: this.container.querySelector('.speaking-indicator'),
      waveformCanvas: this.container.querySelector('.waveform-ring'),
      particleCanvas: this.container.querySelector('.particle-canvas'),
      name: this.container.querySelector('.avatar-name')
    };
    
    this.waveformCtx = this.els.waveformCanvas.getContext('2d');
    this.particleCtx = this.els.particleCanvas.getContext('2d');
  }

  /**
   * Set speaking state
   */
  setSpeaking(isSpeaking) {
    this.state.isSpeaking = isSpeaking;
    
    if (isSpeaking) {
      this.els.main.style.transform = 'scale(1.1)';
      this.els.glow.style.opacity = '1';
      this.els.speakingIndicator.style.opacity = '1';
      this.container.classList.add('speaking');
    } else {
      this.els.main.style.transform = 'scale(1)';
      this.els.glow.style.opacity = '0';
      this.els.speakingIndicator.style.opacity = '0';
      this.container.classList.remove('speaking');
      
      // Reset waveform
      this.state.waveformData.fill(0);
    }
  }

  /**
   * Set expression by name or mood
   */
  setExpression(expression) {
    // Handle mood mapping
    const mappedExpression = AbstractAvatar.MOOD_MAP[expression] || expression;
    
    if (AbstractAvatar.EXPRESSIONS[mappedExpression]) {
      this.state.expression = mappedExpression;
      this.els.expression.textContent = AbstractAvatar.EXPRESSIONS[mappedExpression];
      
      // Add bounce animation
      this.els.expression.style.transform = 'translate(-50%, -50%) scale(1.3)';
      setTimeout(() => {
        this.els.expression.style.transform = 'translate(-50%, -50%) scale(1)';
      }, 200);
    }
  }

  /**
   * Update waveform data from audio analysis
   */
  setWaveform(data) {
    // data should be array of 0-1 values
    if (Array.isArray(data) && data.length > 0) {
      this.state.waveformData = data.slice(0, 32);
    }
  }

  /**
   * Trigger celebration particles
   */
  celebrate(intensity = 1) {
    const colors = [this.options.teamColor, '#ffffff', '#ffd700'];
    const count = Math.floor(20 * intensity);
    
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: this.options.size / 2,
        y: this.options.size / 2,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10 - 5,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 2 + Math.random() * 4
      });
    }
  }

  /**
   * Animation loop
   */
  _startAnimationLoop() {
    const animate = () => {
      this._drawWaveform();
      this._drawParticles();
      
      // Random subtle expression changes when idle
      if (!this.state.isSpeaking && Math.random() < 0.001) {
        const expressions = ['neutral', 'thinking'];
        this.setExpression(expressions[Math.floor(Math.random() * expressions.length)]);
      }
      
      this.animationId = requestAnimationFrame(animate);
    };
    animate();
  }

  /**
   * Draw circular waveform
   */
  _drawWaveform() {
    const ctx = this.waveformCtx;
    const canvas = this.els.waveformCanvas;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const baseRadius = this.options.size * 0.45;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!this.state.isSpeaking) return;
    
    // Generate synthetic waveform if no data
    const data = this.state.waveformData.map((v, i) => {
      if (v > 0) return v;
      // Synthetic wave
      return Math.sin(Date.now() / 100 + i) * 0.3 + 0.3;
    });
    
    // Draw waveform segments
    const segments = data.length;
    const angleStep = (Math.PI * 2) / segments;
    
    ctx.strokeStyle = this.options.teamColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    
    for (let i = 0; i < segments; i++) {
      const angle = i * angleStep;
      const amplitude = data[i] * 20; // Scale factor
      
      const innerRadius = baseRadius;
      const outerRadius = baseRadius + amplitude;
      
      const x1 = centerX + Math.cos(angle) * innerRadius;
      const y1 = centerY + Math.sin(angle) * innerRadius;
      const x2 = centerX + Math.cos(angle) * outerRadius;
      const y2 = centerY + Math.sin(angle) * outerRadius;
      
      ctx.globalAlpha = 0.3 + data[i] * 0.7;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    
    ctx.globalAlpha = 1;
  }

  /**
   * Draw particle effects
   */
  _drawParticles() {
    const ctx = this.particleCtx;
    const canvas = this.els.particleCanvas;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Update and draw particles
    this.particles = this.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3; // Gravity
      p.life -= p.decay;
      
      if (p.life <= 0) return false;
      
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      
      return true;
    });
    
    ctx.globalAlpha = 1;
  }

  /**
   * Look direction (for when listening to other commentator)
   */
  lookAt(direction) {
    const rotate = direction === 'right' ? 10 : direction === 'left' ? -10 : 0;
    this.els.main.style.transform = `rotateY(${rotate}deg)`;
  }

  /**
   * Update team color dynamically
   */
  setTeamColor(color) {
    this.options.teamColor = color;
    this._createDOM(); // Rebuild with new color
  }

  /**
   * Utility: Lighten hex color
   */
  _lighten(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    this.container.innerHTML = '';
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AbstractAvatar;
}
