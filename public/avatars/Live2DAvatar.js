/**
 * Live2DAvatar - 2D animated avatar using Live2D Cubism SDK
 * 
 * Features:
 * - Loads Live2D models (model3.json format)
 * - Lip-sync support via parameter binding
 * - Expression/emotion system
 * - Idle animations
 * - React-style API for easy integration
 * 
 * Setup:
 * 1. Include Cubism SDK: https://github.com/Live2D/CubismWebFramework
 * 2. Place models in /avatars/models/live2d/
 */

class Live2DAvatar {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) throw new Error(`Container #${containerId} not found`);
    
    this.options = {
      width: options.width || 300,
      height: options.height || 400,
      modelPath: options.modelPath || '/avatars/models/live2d/default/model3.json',
      scale: options.scale || 1.0,
      x: options.x || 0,
      y: options.y || 0,
      ...options
    };
    
    // Live2D SDK references (populated after load)
    this.core = null; // CubismCore
    this.model = null; // Live2D model
    this.renderer = null;
    this.canvas = null;
    this.gl = null;
    
    // Animation state
    this.expressions = new Map();
    this.currentExpression = 'neutral';
    this.mouthOpenY = 0;
    this.eyeOpen = 1;
    this.breathTime = 0;
    this.isTalking = false;
    
    // Bind methods
    this.update = this.update.bind(this);
    this.draw = this.draw.bind(this);
    
    this._init();
  }

  /**
   * Initialize canvas and WebGL
   */
  _init() {
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.options.width;
    this.canvas.height = this.options.height;
    this.canvas.style.cssText = `
      width: 100%;
      height: 100%;
      display: block;
    `;
    this.container.appendChild(this.canvas);
    
    // Get WebGL context
    this.gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true
    }) || this.canvas.getContext('experimental-webgl');
    
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }
    
    // Set transparent background
    this.gl.clearColor(0, 0, 0, 0);
  }

  /**
   * Load Live2D model
   */
  async load() {
    // Check if Cubism SDK is loaded
    if (typeof CubismCore === 'undefined') {
      throw new Error('Live2D Cubism SDK not loaded. Include CubismCore.js first.');
    }
    
    this.core = CubismCore;
    
    try {
      // Fetch model3.json
      const response = await fetch(this.options.modelPath);
      const modelJson = await response.json();
      
      // Load model data
      const modelDir = this.options.modelPath.replace(/\/[^\/]*$/, '');
      const mocPath = `${modelDir}/${modelJson.FileReferences.Moc}`;
      
      // Load moc3 file
      const mocResponse = await fetch(mocPath);
      const mocBuffer = await mocResponse.arrayBuffer();
      
      // Create model
      const moc = this.core.createMoc(mocBuffer);
      this.model = this.core.createModel(moc);
      
      // Load textures
      const textures = modelJson.FileReferences.Textures || [];
      for (let i = 0; i < textures.length; i++) {
        const texPath = `${modelDir}/${textures[i]}`;
        await this._loadTexture(i, texPath);
      }
      
      // Load expressions
      const expressions = modelJson.FileReferences.Expressions || [];
      for (const exp of expressions) {
        const expResponse = await fetch(`${modelDir}/${exp.File}`);
        const expJson = await expResponse.json();
        this.expressions.set(exp.Name, expJson);
      }
      
      // Load physics if exists
      if (modelJson.FileReferences.Physics) {
        const physResponse = await fetch(`${modelDir}/${modelJson.FileReferences.Physics}`);
        const physJson = await physResponse.json();
        // Initialize physics (simplified)
        this.physics = physJson;
      }
      
      // Set initial parameters
      this._setupParameters();
      
      // Start render loop
      this._startLoop();
      
      console.log('Live2D model loaded:', this.options.modelPath);
      return true;
      
    } catch (error) {
      console.error('Failed to load Live2D model:', error);
      throw error;
    }
  }

  /**
   * Load texture
   */
  _loadTexture(index, path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
        resolve(texture);
      };
      img.onerror = reject;
      img.src = path;
    });
  }

  /**
   * Setup model parameters
   */
  _setupParameters() {
    if (!this.model) return;
    
    // Common Live2D parameters
    this.params = {
      mouthOpenY: this.model.parameters.ids.indexOf('ParamMouthOpenY'),
      mouthForm: this.model.parameters.ids.indexOf('ParamMouthForm'),
      eyeLOpen: this.model.parameters.ids.indexOf('ParamEyeLOpen'),
      eyeROpen: this.model.parameters.ids.indexOf('ParamEyeROpen'),
      breath: this.model.parameters.ids.indexOf('ParamBreath'),
      bodyAngleX: this.model.parameters.ids.indexOf('ParamBodyAngleX'),
      bodyAngleY: this.model.parameters.ids.indexOf('ParamBodyAngleY'),
      bodyAngleZ: this.model.parameters.ids.indexOf('ParamBodyAngleZ'),
      // Expression parameters
      browLY: this.model.parameters.ids.indexOf('ParamBrowLY'),
      browRY: this.model.parameters.ids.indexOf('ParamBrowRY'),
      cheek: this.model.parameters.ids.indexOf('ParamCheek'),
    };
    
    // Set initial scale and position
    const canvasAspect = this.options.width / this.options.height;
    const modelAspect = this.model.canvasinfo.CanvasWidth / this.model.canvasinfo.CanvasHeight;
    
    let scale = this.options.scale;
    if (canvasAspect > modelAspect) {
      scale *= this.options.height / this.model.canvasinfo.CanvasHeight;
    } else {
      scale *= this.options.width / this.model.canvasinfo.CanvasWidth;
    }
    
    this.model.scale = scale;
    this.model.x = this.options.x;
    this.model.y = this.options.y;
  }

  /**
   * Update lip-sync (call this from LipSyncManager)
   */
  setLipSync(value, viseme = null) {
    // value: 0-1 (mouth openness)
    this.mouthOpenY = Math.max(0, Math.min(1, value));
    this.isTalking = value > 0.1;
  }

  /**
   * Set expression/emotion
   */
  setExpression(expressionName) {
    if (!this.expressions.has(expressionName)) {
      console.warn('Expression not found:', expressionName);
      return;
    }
    
    this.currentExpression = expressionName;
    const exp = this.expressions.get(expressionName);
    
    // Apply expression parameters
    if (exp && exp.Parameters) {
      for (const param of exp.Parameters) {
        const index = this.model.parameters.ids.indexOf(param.Id);
        if (index !== -1) {
          this.model.parameters.values[index] = param.Value;
        }
      }
    }
  }

  /**
   * React to play outcome
   */
  react(mood) {
    const moodMap = {
      'electric': 'happy',
      'big_play': 'excited',
      'momentum_shift': 'surprised',
      'disaster': 'sad',
      'defensive_dominance': 'angry',
      'controversial': 'confused',
      'stuffed': 'disappointed',
      'routine': 'neutral'
    };
    
    const expression = moodMap[mood] || 'neutral';
    this.setExpression(expression);
    
    // Reset to neutral after 3 seconds
    setTimeout(() => {
      this.setExpression('neutral');
    }, 3000);
  }

  /**
   * Update animation (call every frame)
   */
  update(deltaTime = 16.67) {
    if (!this.model) return;
    
    this.breathTime += deltaTime * 0.001;
    
    // Breathing animation
    const breath = Math.sin(this.breathTime * 2) * 0.5 + 0.5;
    if (this.params.breath !== -1) {
      this.model.parameters.values[this.params.breath] = breath * 0.3;
    }
    
    // Body sway
    if (this.params.bodyAngleX !== -1) {
      this.model.parameters.values[this.params.bodyAngleX] = Math.sin(this.breathTime) * 2;
    }
    
    // Apply lip-sync
    if (this.params.mouthOpenY !== -1) {
      // Smooth interpolation
      const current = this.model.parameters.values[this.params.mouthOpenY] || 0;
      const target = this.mouthOpenY;
      this.model.parameters.values[this.params.mouthOpenY] = current * 0.7 + target * 0.3;
    }
    
    // Blink randomly
    if (Math.random() < 0.005) {
      this._blink();
    }
    
    // Update model
    this.model.update();
  }

  /**
   * Blink animation
   */
  _blink() {
    if (this.params.eyeLOpen === -1) return;
    
    let progress = 0;
    const blinkAnim = () => {
      progress += 0.2;
      const value = progress < 0.5 
        ? 1 - (progress * 2)  // Close
        : (progress - 0.5) * 2; // Open
      
      this.model.parameters.values[this.params.eyeLOpen] = value;
      this.model.parameters.values[this.params.eyeROpen] = value;
      
      if (progress < 1) {
        requestAnimationFrame(blinkAnim);
      }
    };
    blinkAnim();
  }

  /**
   * Draw frame
   */
  draw() {
    if (!this.model || !this.gl) return;
    
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.model.draw(this.gl);
  }

  /**
   * Start render loop
   */
  _startLoop() {
    const loop = (timestamp) => {
      if (!this.model) return;
      
      this.update();
      this.draw();
      
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /**
   * Resize canvas
   */
  resize(width, height) {
    this.options.width = width;
    this.options.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.model) {
      this.model.release();
      this.model = null;
    }
    if (this.canvas && this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Live2DAvatar;
}
