// ── GPU-accelerated Wind Solver (WebGL2 GPGPU) ──
// Runs the 500-iteration pressure/Coriolis/drag wind solver on the GPU
// using framebuffer ping-pong rendering. Each iteration is a single
// fragment shader dispatch over the coarse grid (480×240 at 4x downscale).
//
// Speedup: 10-50x vs CPU for the iterative refinement phase.
// The pressure field, drag, elevation are uploaded once as textures.
// Wind state ping-pongs between two framebuffers each iteration.

const WIND_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Fragment shader: one iteration of wind solver
// Reads previous wind (RG), pressure, drag, elevation
// Outputs new wind (RG)
const WIND_ITER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_wind;     // RG = windX, windY (previous step)
uniform sampler2D u_pressure; // R = pressure
uniform sampler2D u_drag;     // R = drag coefficient
uniform sampler2D u_elev;     // R = elevation (for blocking)
uniform vec2 u_gridSize;      // (wW, wH)
uniform float u_dt;           // timestep
uniform float u_visc;         // viscosity
uniform float u_coriolisStr;  // Coriolis strength

void main() {
  vec2 texel = 1.0 / u_gridSize;
  float wy = v_uv.y * u_gridSize.y;
  float wx = v_uv.x * u_gridSize.x;

  // Skip boundary rows
  if (wy < 1.0 || wy >= u_gridSize.y - 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Sample current wind and neighbors
  vec2 w = texture(u_wind, v_uv).rg;
  vec2 wL = texture(u_wind, v_uv + vec2(-texel.x, 0.0)).rg;
  vec2 wR = texture(u_wind, v_uv + vec2( texel.x, 0.0)).rg;
  vec2 wU = texture(u_wind, v_uv + vec2(0.0, -texel.y)).rg;
  vec2 wD = texture(u_wind, v_uv + vec2(0.0,  texel.y)).rg;

  // Pressure gradient
  float pL = texture(u_pressure, v_uv + vec2(-texel.x, 0.0)).r;
  float pR = texture(u_pressure, v_uv + vec2( texel.x, 0.0)).r;
  float pU = texture(u_pressure, v_uv + vec2(0.0, -texel.y)).r;
  float pD = texture(u_pressure, v_uv + vec2(0.0,  texel.y)).r;

  float latSigned = (wy / u_gridSize.y - 0.5) * 2.0;
  float cosLat = cos(abs(latSigned) * 3.14159265 / 2.0);
  cosLat = max(0.15, cosLat);

  float pgfX = -(pR - pL) * 0.5 / cosLat;
  float pgfY = -(pD - pU) * 0.5;

  // Coriolis
  float f = -sin(latSigned * 3.14159265 / 2.0) * u_coriolisStr;
  float corX = -f * w.y;
  float corY = f * w.x;

  // Drag
  float kf = texture(u_drag, v_uv).r;
  float drgX = -kf * w.x;
  float drgY = -kf * w.y;

  // Diffusion (Laplacian)
  float lapX = (wL.x + wR.x + wU.x + wD.x) * 0.25 - w.x;
  float lapY = (wL.y + wR.y + wU.y + wD.y) * 0.25 - w.y;

  // Update
  vec2 newWind;
  newWind.x = w.x + u_dt * (pgfX + corX + drgX) + u_visc * lapX;
  newWind.y = w.y + u_dt * (pgfY + corY + drgY) + u_visc * lapY;

  fragColor = vec4(newWind, 0.0, 1.0);
}`;

// Divergence projection shader (runs every 10 iterations)
const DIV_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_wind;
uniform sampler2D u_elev;
uniform vec2 u_gridSize;

void main() {
  vec2 texel = 1.0 / u_gridSize;
  float wy = v_uv.y * u_gridSize.y;
  if (wy < 1.0 || wy >= u_gridSize.y - 1.0) {
    fragColor = vec4(0.0);
    return;
  }
  float e = texture(u_elev, v_uv).r;
  if (e > 0.3) {
    fragColor = vec4(0.0);
    return;
  }
  float wR = texture(u_wind, v_uv + vec2( texel.x, 0.0)).r;
  float wL = texture(u_wind, v_uv + vec2(-texel.x, 0.0)).r;
  float wD = texture(u_wind, v_uv + vec2(0.0,  texel.y)).g;
  float wU = texture(u_wind, v_uv + vec2(0.0, -texel.y)).g;
  float div = (wR - wL) * 0.5 + (wD - wU) * 0.5;
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}`;

// Pressure correction Jacobi iteration
const JACOBI_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_pCorr;
uniform sampler2D u_div;
uniform sampler2D u_elev;
uniform vec2 u_gridSize;
uniform float u_omega;

void main() {
  vec2 texel = 1.0 / u_gridSize;
  float wy = v_uv.y * u_gridSize.y;
  if (wy < 1.0 || wy >= u_gridSize.y - 1.0) {
    fragColor = vec4(0.0);
    return;
  }
  float e = texture(u_elev, v_uv).r;
  if (e > 0.3) {
    fragColor = vec4(0.0);
    return;
  }
  float pC = texture(u_pCorr, v_uv).r;
  float eR = texture(u_elev, v_uv + vec2( texel.x, 0.0)).r;
  float eL = texture(u_elev, v_uv + vec2(-texel.x, 0.0)).r;
  float eU = texture(u_elev, v_uv + vec2(0.0, -texel.y)).r;
  float eD = texture(u_elev, v_uv + vec2(0.0,  texel.y)).r;
  float pR = eR > 0.3 ? pC : texture(u_pCorr, v_uv + vec2( texel.x, 0.0)).r;
  float pL = eL > 0.3 ? pC : texture(u_pCorr, v_uv + vec2(-texel.x, 0.0)).r;
  float pU = eU > 0.3 ? pC : texture(u_pCorr, v_uv + vec2(0.0, -texel.y)).r;
  float pD = eD > 0.3 ? pC : texture(u_pCorr, v_uv + vec2(0.0,  texel.y)).r;
  float d = texture(u_div, v_uv).r;
  float jacobi = (pR + pL + pU + pD - d) * 0.25;
  float result = (1.0 - u_omega) * pC + u_omega * jacobi;
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;

// Apply pressure correction to wind
const CORRECT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_wind;
uniform sampler2D u_pCorr;
uniform sampler2D u_elev;
uniform vec2 u_gridSize;
uniform float u_corrStr;

void main() {
  vec2 texel = 1.0 / u_gridSize;
  float wy = v_uv.y * u_gridSize.y;
  vec2 w = texture(u_wind, v_uv).rg;
  float e = texture(u_elev, v_uv).r;

  if (wy < 1.0 || wy >= u_gridSize.y - 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  if (e > 0.3) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float pR = texture(u_pCorr, v_uv + vec2( texel.x, 0.0)).r;
  float pL = texture(u_pCorr, v_uv + vec2(-texel.x, 0.0)).r;
  float pU = texture(u_pCorr, v_uv + vec2(0.0, -texel.y)).r;
  float pD = texture(u_pCorr, v_uv + vec2(0.0,  texel.y)).r;

  w.x -= (pR - pL) * 0.5 * u_corrStr;
  w.y -= (pD - pU) * 0.5 * u_corrStr;

  fragColor = vec4(w, 0.0, 1.0);
}`;


function compileShader(gl, src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('GPU Wind shader error:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, vsSrc, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fsSrc, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('GPU Wind link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

function createFBO(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, w, h, 0, gl.RG, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); // wrap X for globe
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
}

function createR32FFBO(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
}

function uploadR32F(gl, tex, w, h, data) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, data);
}

function uploadRG32F(gl, tex, w, h, dataX, dataY) {
  const buf = new Float32Array(w * h * 2);
  for (let i = 0; i < w * h; i++) { buf[i * 2] = dataX[i]; buf[i * 2 + 1] = dataY[i]; }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RG, gl.FLOAT, buf);
}

// Initialize the GPU wind solver. Call once, reuse across generations.
export function initGPUWindSolver() {
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) { console.warn('WebGL2 not available for GPU wind solver'); return null; }

  // Check for float texture support (required for GPGPU)
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) { console.warn('EXT_color_buffer_float not available'); return null; }

  // Compile all shader programs
  const iterProg = createProgram(gl, WIND_VS, WIND_ITER_FS);
  const divProg = createProgram(gl, WIND_VS, DIV_FS);
  const jacobiProg = createProgram(gl, WIND_VS, JACOBI_FS);
  const correctProg = createProgram(gl, WIND_VS, CORRECT_FS);
  if (!iterProg || !divProg || !jacobiProg || !correctProg) return null;

  // Full-screen quad
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  return { gl, iterProg, divProg, jacobiProg, correctProg, quadBuf, _fbos: null };
}

// Run the GPU wind solver. Returns { windX, windY } on the coarse grid.
export function solveWindGPU(state, wW, wH, windX, windY, pressure, drag, elevation, params) {
  const { gl, iterProg, divProg, jacobiProg, correctProg, quadBuf } = state;
  const N = wW * wH;

  const _solverIter = params.windSolverIter || 500;
  const _coriolisStr = params.coriolisStrength || 0.406;
  const dt = 0.35;
  const visc = 0.06;

  // Resize offscreen canvas to match grid
  gl.canvas.width = wW;
  gl.canvas.height = wH;
  gl.viewport(0, 0, wW, wH);

  // Create/reuse framebuffers
  if (!state._fbos || state._fbos.w !== wW || state._fbos.h !== wH) {
    state._fbos = {
      w: wW, h: wH,
      windA: createFBO(gl, wW, wH),
      windB: createFBO(gl, wW, wH),
      divFBO: createR32FFBO(gl, wW, wH),
      pCorrA: createR32FFBO(gl, wW, wH),
      pCorrB: createR32FFBO(gl, wW, wH),
      pressureTex: (() => { const f = createR32FFBO(gl, wW, wH); return f; })(),
      dragTex: (() => { const f = createR32FFBO(gl, wW, wH); return f; })(),
      elevTex: (() => { const f = createR32FFBO(gl, wW, wH); return f; })(),
    };
  }
  const fbos = state._fbos;

  // Upload input data to textures
  uploadRG32F(gl, fbos.windA.tex, wW, wH, windX, windY);
  uploadR32F(gl, fbos.pressureTex.tex, wW, wH, pressure);
  uploadR32F(gl, fbos.dragTex.tex, wW, wH, drag);
  uploadR32F(gl, fbos.elevTex.tex, wW, wH, elevation);

  // Helper: bind quad and draw
  function drawQuad(prog) {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function bindTex(prog, name, tex, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  }

  let src = fbos.windA, dst = fbos.windB;

  // ── Main solver loop ──
  for (let iter = 0; iter < _solverIter; iter++) {
    // Wind iteration step
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.useProgram(iterProg);
    bindTex(iterProg, 'u_wind', src.tex, 0);
    bindTex(iterProg, 'u_pressure', fbos.pressureTex.tex, 1);
    bindTex(iterProg, 'u_drag', fbos.dragTex.tex, 2);
    bindTex(iterProg, 'u_elev', fbos.elevTex.tex, 3);
    gl.uniform2f(gl.getUniformLocation(iterProg, 'u_gridSize'), wW, wH);
    gl.uniform1f(gl.getUniformLocation(iterProg, 'u_dt'), dt);
    gl.uniform1f(gl.getUniformLocation(iterProg, 'u_visc'), visc);
    gl.uniform1f(gl.getUniformLocation(iterProg, 'u_coriolisStr'), _coriolisStr);
    drawQuad(iterProg);

    // Swap
    [src, dst] = [dst, src];

    // Divergence projection every 10 iterations
    if (iter % 10 === 9) {
      // Compute divergence
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.divFBO.fbo);
      gl.useProgram(divProg);
      bindTex(divProg, 'u_wind', src.tex, 0);
      bindTex(divProg, 'u_elev', fbos.elevTex.tex, 1);
      gl.uniform2f(gl.getUniformLocation(divProg, 'u_gridSize'), wW, wH);
      drawQuad(divProg);

      // Clear pressure correction
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.pCorrA.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.pCorrB.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // 20 Jacobi iterations for pressure correction
      let pSrc = fbos.pCorrA, pDst = fbos.pCorrB;
      for (let pi = 0; pi < 20; pi++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, pDst.fbo);
        gl.useProgram(jacobiProg);
        bindTex(jacobiProg, 'u_pCorr', pSrc.tex, 0);
        bindTex(jacobiProg, 'u_div', fbos.divFBO.tex, 1);
        bindTex(jacobiProg, 'u_elev', fbos.elevTex.tex, 2);
        gl.uniform2f(gl.getUniformLocation(jacobiProg, 'u_gridSize'), wW, wH);
        gl.uniform1f(gl.getUniformLocation(jacobiProg, 'u_omega'), 1.4);
        drawQuad(jacobiProg);
        [pSrc, pDst] = [pDst, pSrc];
      }

      // Apply correction to wind
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.useProgram(correctProg);
      bindTex(correctProg, 'u_wind', src.tex, 0);
      bindTex(correctProg, 'u_pCorr', pSrc.tex, 1);
      bindTex(correctProg, 'u_elev', fbos.elevTex.tex, 2);
      gl.uniform2f(gl.getUniformLocation(correctProg, 'u_gridSize'), wW, wH);
      gl.uniform1f(gl.getUniformLocation(correctProg, 'u_corrStr'), 0.2);
      drawQuad(correctProg);
      [src, dst] = [dst, src];
    }
  }

  // Read back results
  gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
  const result = new Float32Array(wW * wH * 4);
  gl.readPixels(0, 0, wW, wH, gl.RGBA, gl.FLOAT, result);

  // Extract windX, windY from RG channels
  const outX = new Float32Array(N);
  const outY = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    outX[i] = result[i * 4];
    outY[i] = result[i * 4 + 1];
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { windX: outX, windY: outY };
}
