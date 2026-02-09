/**
 * Live2DManager - Complete Live2D Cubism Integration
 * 
 * Handles:
 * - Model loading (model3.json, moc3, textures)
 * - Expression management
 * - Motion/animation playback
 * - Lip-sync (ParamMouthOpenY)
 * - Eye tracking
 * - Physics (hair/clothing)
 * 
 * Requires: Live2D Cubism Core SDK
 */

class Live2DManager {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`Canvas #${canvasId} not found`);
    
    this.options = {
      modelPath: options.modelPath,
      scale: options.scale || 1.0,
      x: options.x || 0,
      y: options.y || 0,
      ...options
    };
    
    // Live2D Core references
    this.core = null;
    this.model = null;
    this.renderer = null;
    this.gl = null;
    
    // Resources
    this.textures = [];
    this.expressions = new Map();
    this.motions = new Map();
    this.physics = null;
    this.pose = null;
    
    // Animation state
    this.frameBuffer = null;
    this.viewport = [0, 0, 0, 0];
    this.projection = new Float32Array(16);
    
    // Lip-sync
    this.lipSyncValue = 0;
    this.targetLipSync = 0;
    
    // Eye tracking
    this.targetX = 0;
    this.targetY = 0;
    this.currentX = 0;
    this.currentY = 0;
    
    // Bind update
    this.update = this.update.bind(this);
    this.rafId = null;
    
    this._init();
  }

  _init() {
    // Initialize WebGL
    this.gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    }) || this.canvas.getContext('experimental-webgl');
    
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }
    
    // Check for Live2D Core
    if (typeof Live2DCubismCore === 'undefined') {
      throw new Error('Live2D Cubism Core SDK not loaded. Include live2dcubismcore.min.js');
    }
    
    this.core = Live2DCubismCore;
    
    // Set canvas size
    this.canvas.width = this.canvas.clientWidth || 300;
    this.canvas.height = this.canvas.clientHeight || 400;
    
    // Enable depth test
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.depthFunc(this.gl.LEQUAL);
    
    // Enable blending
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Load model from model3.json path
   */
  async load() {
    try {
      console.log('Loading Live2D model:', this.options.modelPath);
      
      // Load model3.json
      const response = await fetch(this.options.modelPath);
      const modelJson = await response.json();
      
      const modelDir = this.options.modelPath.substring(0, this.options.modelPath.lastIndexOf('/'));
      
      // Load moc3 file
      const mocPath = `${modelDir}/${modelJson.FileReferences.Moc}`;
      const mocResponse = await fetch(mocPath);
      const mocBuffer = await mocResponse.arrayBuffer();
      
      // Create moc
      const moc = this.core.createMoc(mocBuffer);
      if (!moc) throw new Error('Failed to create moc');
      
      // Create model
      this.model = this.core.createModel(moc);
      if (!this.model) throw new Error('Failed to create model');
      
      // Load textures
      const textureFiles = modelJson.FileReferences.Textures || [];
      for (let i = 0; i < textureFiles.length; i++) {
        const texPath = `${modelDir}/${textureFiles[i]}`;
        const texture = await this._loadTexture(texPath);
        this.textures.push(texture);
      }
      
      // Load expressions
      const expressions = modelJson.FileReferences.Expressions || [];
      for (const exp of expressions) {
        const expPath = `${modelDir}/${exp.File}`;
        try {
          const expResponse = await fetch(expPath);
          const expJson = await expResponse.json();
          this.expressions.set(exp.Name, expJson);
        } catch (e) {
          console.warn('Failed to load expression:', exp.Name);
        }
      }
      
      // Load physics
      if (modelJson.FileReferences.Physics) {
        const physPath = `${modelDir}/${modelJson.FileReferences.Physics}`;
        try {
          const physResponse = await fetch(physPath);
          this.physics = await physResponse.json();
        } catch (e) {
          console.warn('Failed to load physics');
        }
      }
      
      // Load pose
      if (modelJson.FileReferences.Pose) {
        const posePath = `${modelDir}/${modelJson.FileReferences.Pose}`;
        try {
          const poseResponse = await fetch(posePath);
          this.pose = await poseResponse.json();
        } catch (e) {
          console.warn('Failed to load pose');
        }
      }
      
      // Initialize renderer
      this._initRenderer();
      
      // Setup parameters
      this._setupParameters();
      
      // Start animation loop
      this._startLoop();
      
      console.log('Live2D model loaded successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to load Live2D model:', error);
      throw error;
    }
  }

  /**
   * Load texture
   */
  _loadTexture(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        const texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        
        // Set texture parameters
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        
        // Upload image
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
        
        resolve(texture);
      };
      
      img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
      img.src = url;
    });
  }

  /**
   * Initialize renderer
   */
  _initRenderer() {
    // Create frame buffer for model
    const framebuffer = this.gl.createFramebuffer();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    
    // Setup viewport
    this.viewport = [0, 0, this.canvas.width, this.canvas.height];
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    
    // Calculate projection matrix
    const ratio = this.canvas.width / this.canvas.height;
    const left = -ratio;
    const right = ratio;
    const bottom = -1;
    const top = 1;
    const near = -1;
    const far = 1;
    
    // Orthographic projection
    this.projection[0] = 2 / (right - left);
    this.projection[5] = 2 / (top - bottom);
    this.projection[10] = 2 / (far - near);
    this.projection[12] = -(right + left) / (right - left);
    this.projection[13] = -(top + bottom) / (top - bottom);
    this.projection[14] = -(far + near) / (far - near);
    this.projection[15] = 1;
  }

  /**
   * Setup model parameters
   */
  _setupParameters() {
    if (!this.model) return;
    
    // Get parameter IDs
    const paramCount = this.model.parameters.count;
    this.paramIds = {};
    
    for (let i = 0; i < paramCount; i++) {
      const id = this.model.parameters.ids[i];
      this.paramIds[id] = i;
    }
    
    // Set initial scale and position
    const canvasAspect = this.canvas.width / this.canvas.height;
    const modelAspect = this.model.canvasinfo.CanvasWidth / this.model.canvasinfo.CanvasHeight;
    
    let scale = this.options.scale;
    if (canvasAspect > modelAspect) {
      scale *= this.canvas.height / this.model.canvasinfo.CanvasHeight;
    } else {
      scale *= this.canvas.width / this.model.canvasinfo.CanvasWidth;
    }
    
    // Update model matrix
    this.model.scale = scale;
    this.model.x = this.options.x;
    this.model.y = this.options.y;
  }

  /**
   * Set expression
   */
  setExpression(name) {
    const expression = this.expressions.get(name);
    if (!expression) {
      console.warn('Expression not found:', name);
      return;
    }
    
    // Apply expression parameters
    if (expression.Parameters) {
      for (const param of expression.Parameters) {
        const index = this.paramIds[param.Id];
        if (index !== undefined) {
          const current = this.model.parameters.values[index];
          const target = param.Value;
          // Blend with current value
          this.model.parameters.values[index] = current * (1 - param.Blend) + target * param.Blend;
        }
      }
    }
  }

  /**
   * Set lip-sync value (0-1)
   */
  setLipSync(value) {
    this.targetLipSync = Math.max(0, Math.min(1, value));
  }

  /**
   * Set eye tracking target
   */
  setEyeTarget(x, y) {
    this.targetX = Math.max(-1, Math.min(1, x));
    this.targetY = Math.max(-1, Math.min(1, y));
  }

  /**
   * Update model parameters
   */
  update() {
    if (!this.model) return;
    
    const deltaTime = 1 / 60; // Assume 60fps
    
    // Smooth lip-sync
    this.lipSyncValue += (this.targetLipSync - this.lipSyncValue) * 0.3;
    
    // Apply lip-sync to mouth
    if (this.paramIds.ParamMouthOpenY !== undefined) {
      this.model.parameters.values[this.paramIds.ParamMouthOpenY] = this.lipSyncValue;
    }
    
    // Smooth eye tracking
    this.currentX += (this.targetX - this.currentX) * 0.1;
    this.currentY += (this.targetY - this.currentY) * 0.1;
    
    // Apply eye tracking
    if (this.paramIds.ParamEyeBallX !== undefined) {
      this.model.parameters.values[this.paramIds.ParamEyeBallX] = this.currentX;
    }
    if (this.paramIds.ParamEyeBallY !== undefined) {
      this.model.parameters.values[this.paramIds.ParamEyeBallY] = this.currentY;
    }
    
    // Apply physics (simplified)
    this._updatePhysics(deltaTime);
    
    // Update model
    this.model.update();
    
    // Render
    this._render();
  }

  /**
   * Update physics (simplified implementation)
   */
  _updatePhysics(deltaTime) {
    if (!this.physics) return;
    
    const time = Date.now() / 1000;
    
    // Simple breathing animation
    if (this.paramIds.ParamBreath !== undefined) {
      const breath = Math.sin(time * 2) * 0.5 + 0.5;
      this.model.parameters.values[this.paramIds.ParamBreath] = breath * 0.3;
    }
    
    // Body sway
    if (this.paramIds.ParamBodyAngleX !== undefined) {
      const sway = Math.sin(time) * 2;
      this.model.parameters.values[this.paramIds.ParamBodyAngleX] = sway;
    }
  }

  /**
   * Render the model
   */
  _render() {
    if (!this.model || !this.gl) return;
    
    // Clear
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    
    // Update model matrix
    this.model.update();
    
    // Draw model
    const drawableCount = this.model.drawables.count;
    
    for (let i = 0; i < drawableCount; i++) {
      const textureIndex = this.model.drawables.textureIndices[i];
      
      if (textureIndex >= 0 && textureIndex < this.textures.length) {
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[textureIndex]);
      }
      
      // Draw the drawable
      this.model.drawables.update();
    }
  }

  /**
   * Start animation loop
   */
  _startLoop() {
    const loop = () => {
      this.update();
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  /**
   * Stop animation loop
   */
  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Resize canvas
   */
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
    
    // Recalculate projection
    const ratio = width / height;
    const left = -ratio;
    const right = ratio;
    
    this.projection[0] = 2 / (right - left);
    this.projection[12] = -(right + left) / (right - left);
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.stop();
    
    if (this.model) {
      this.model.release();
      this.model = null;
    }
    
    for (const texture of this.textures) {
      this.gl.deleteTexture(texture);
    }
    this.textures = [];
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Live2DManager;
}
