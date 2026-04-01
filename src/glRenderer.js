// ── WebGL Tile Renderer ──
// Uploads tile data as textures, fragment shader does all coloring on GPU.
// Replaces the 1.8M-pixel CPU loop in draw() with a single GPU draw call.

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){v_uv=a_pos*0.5+0.5;v_uv.y=1.0-v_uv.y;gl_Position=vec4(a_pos,0,1);}`;

// Fragment shader: reads tile data textures, outputs colored pixel
// Each texture is a 2D grid of float values packed into RGBA channels
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_elev;     // R=elevation
uniform sampler2D u_owner;    // R=owner (normalized), G=tenure
uniform sampler2D u_climate;  // R=temp, G=moisture, B=fertility
uniform sampler2D u_pop;      // R=bgPop, G=cityPop
uniform sampler2D u_terrain;  // RGB=precomputed terrain color
uniform int u_mode;           // 0=terrain, 1=tribes, 2=population, 3=fertility, 4=moisture, 5=temp
uniform float u_maxPop;       // max population for normalization
uniform float u_time;         // for animation
uniform int u_selectedTribe;  // -1 or tribe ID
uniform int u_tribeCount;     // total tribes for color mapping

// HSL to RGB for tribe colors (matches tribeRGB in JS)
float hue2rgb(float p2,float q2,float t2){
  if(t2<0.0)t2+=1.0;if(t2>1.0)t2-=1.0;
  if(t2<1.0/6.0)return p2+(q2-p2)*6.0*t2;
  if(t2<0.5)return q2;
  if(t2<2.0/3.0)return p2+(q2-p2)*(2.0/3.0-t2)*6.0;
  return p2;
}
vec3 tribeColor(int id){
  float h=mod(float(id)*67.0+20.0,360.0)/360.0;
  float s=(60.0+mod(float(id)*31.0,25.0))/100.0;
  float l=(45.0+mod(float(id)*17.0,25.0))/100.0;
  float q=l<0.5?l*(1.0+s):l+s-l*s;
  float p=2.0*l-q;
  return vec3(hue2rgb(p,q,h+1.0/3.0),hue2rgb(p,q,h),hue2rgb(p,q,h-1.0/3.0));
}

// Era color from knowledge (approximation)
vec3 eraColor(float mt, float ag, float org){
  if(mt>0.83&&org>0.55)return vec3(0.35,0.29,0.39);
  if(org>0.5&&mt>0.4)return vec3(0.51,0.22,0.22);
  if(mt>0.5)return vec3(0.39,0.39,0.43);
  if(mt>0.3)return vec3(0.61,0.47,0.22);
  if(mt>0.15)return vec3(0.67,0.43,0.22);
  if(ag>0.3)return vec3(0.35,0.43,0.20);
  if(ag>0.1)return vec3(0.29,0.32,0.18);
  return vec3(0.22,0.19,0.15);
}

void main(){
  float e=texture(u_elev,v_uv).r;
  vec4 own=texture(u_owner,v_uv);
  vec4 clim=texture(u_climate,v_uv);
  vec4 pop=texture(u_pop,v_uv);
  vec3 terr=texture(u_terrain,v_uv).rgb;

  float temp=clim.r,moist=clim.g,fert=clim.b;
  float bgP=pop.r,cityP=pop.g;
  int ow=int(own.r*255.0)-1;// -1=unowned, 0+=tribe

  vec3 col;

  if(u_mode==0){// Terrain view
    if(e<=0.0){col=vec3(0.024,0.031,0.063);}// ocean
    else{
      col=terr;
      // Tribe border tint
      if(ow>=0){
        vec3 tc=tribeColor(ow);
        col=mix(col,tc,0.25);
      }
    }
  }
  else if(u_mode==2){// Population heatmap
    if(e<=0.0){col=vec3(0.016,0.020,0.047);}
    else{
      float totalPop=bgP+cityP;
      if(totalPop<0.01){col=terr*0.2;}
      else{
        float t=clamp(log(totalPop+1.0)/log(u_maxPop+1.0),0.0,1.0);
        // Navy→blue→cyan→green→yellow→orange→red→white
        if(t<0.15)col=mix(vec3(0.02,0.02,0.12),vec3(0.06,0.08,0.35),t/0.15);
        else if(t<0.30)col=mix(vec3(0.06,0.08,0.35),vec3(0.04,0.40,0.47),smoothstep(0.15,0.30,t));
        else if(t<0.50)col=mix(vec3(0.04,0.40,0.47),vec3(0.35,0.90,0.12),(t-0.30)/0.20);
        else if(t<0.70)col=mix(vec3(0.35,0.90,0.12),vec3(0.98,0.92,0.04),(t-0.50)/0.20);
        else if(t<0.85)col=mix(vec3(0.98,0.92,0.04),vec3(0.98,0.40,0.08),(t-0.70)/0.15);
        else col=mix(vec3(0.98,0.40,0.08),vec3(1.0,0.80,0.70),(t-0.85)/0.15);
        col=mix(terr*0.15,col,0.85);
      }
    }
  }
  else if(u_mode==3){// Fertility
    if(e<=0.0)col=vec3(0.024,0.031,0.063);
    else{
      float f=clamp(fert,0.0,1.0);
      col=mix(vec3(0.6,0.2,0.1),vec3(0.1,0.7,0.2),f);
      col=mix(terr*0.3,col,0.7);
    }
  }
  else if(u_mode==4){// Moisture
    if(e<=0.0)col=vec3(0.024,0.031,0.063);
    else{
      float m=clamp(moist,0.0,1.0);
      col=mix(vec3(0.5,0.3,0.15),vec3(0.1,0.3,0.7),m);
    }
  }
  else if(u_mode==5){// Temperature
    if(e<=0.0)col=vec3(0.024,0.031,0.063);
    else{
      float t2=clamp(temp,0.0,1.0);
      if(t2<0.25)col=mix(vec3(0.1,0.2,0.8),vec3(0.1,0.7,0.7),t2/0.25);
      else if(t2<0.5)col=mix(vec3(0.1,0.7,0.7),vec3(0.2,0.8,0.2),(t2-0.25)/0.25);
      else if(t2<0.75)col=mix(vec3(0.2,0.8,0.2),vec3(0.9,0.8,0.1),(t2-0.5)/0.25);
      else col=mix(vec3(0.9,0.8,0.1),vec3(0.9,0.2,0.1),(t2-0.75)/0.25);
    }
  }
  else{// Default: terrain
    col=e<=0.0?vec3(0.024,0.031,0.063):terr;
  }

  fragColor=vec4(col,1.0);
}`;

function compileShader(gl, src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export function initGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) { console.warn('WebGL2 not available, falling back to canvas 2D'); return null; }

  const vs = compileShader(gl, VS, gl.VERTEX_SHADER);
  const fs = compileShader(gl, FS, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
    return null;
  }

  // Full-screen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');

  // Create textures
  function makeTex(w, h, internalFormat, format, type) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    return tex;
  }

  const uniforms = {};
  ['u_elev','u_owner','u_climate','u_pop','u_terrain','u_mode','u_maxPop','u_time','u_selectedTribe','u_tribeCount'].forEach(name => {
    uniforms[name] = gl.getUniformLocation(prog, name);
  });

  return { gl, prog, buf, aPos, uniforms, makeTex, textures: {} };
}

// Upload tile data to GPU textures
export function uploadTileData(glState, ter, w, terrainRGB) {
  const { gl, makeTex, textures } = glState;
  const tw = ter.tw, th = ter.th;

  // Elevation: R channel = elevation (float)
  if (!textures.elev) textures.elev = makeTex(tw, th, gl.R32F, gl.RED, gl.FLOAT);
  gl.bindTexture(gl.TEXTURE_2D, textures.elev);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.RED, gl.FLOAT, ter.tElev);

  // Owner: R = (owner+1)/255, packed as bytes for fast upload
  if (!textures.owner) {
    textures.ownerBuf = new Uint8Array(tw * th);
    textures.owner = makeTex(tw, th, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
  }
  const ob = textures.ownerBuf;
  for (let i = 0; i < tw * th; i++) ob[i] = ter.owner[i] + 1; // -1→0, 0→1, etc
  gl.bindTexture(gl.TEXTURE_2D, textures.owner);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.RED, gl.UNSIGNED_BYTE, ob);

  // Climate: RGB = temp, moisture, fertility (pack into 3-channel)
  if (!textures.climate) {
    textures.climateBuf = new Float32Array(tw * th * 3);
    textures.climate = makeTex(tw, th, gl.RGB32F, gl.RGB, gl.FLOAT);
  }
  const cb = textures.climateBuf;
  for (let i = 0; i < tw * th; i++) {
    cb[i * 3] = ter.tTemp[i];
    cb[i * 3 + 1] = ter.tMoist[i];
    cb[i * 3 + 2] = ter.tFert[i];
  }
  gl.bindTexture(gl.TEXTURE_2D, textures.climate);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.RGB, gl.FLOAT, cb);

  // Population: RG = bgPop, cityPop
  if (!textures.pop) {
    textures.popBuf = new Float32Array(tw * th * 2);
    textures.pop = makeTex(tw, th, gl.RG32F, gl.RG, gl.FLOAT);
  }
  const pb = textures.popBuf;
  for (let i = 0; i < tw * th; i++) {
    pb[i * 2] = ter.bgPop[i];
    pb[i * 2 + 1] = ter.cityPop ? ter.cityPop[i] : 0;
  }
  gl.bindTexture(gl.TEXTURE_2D, textures.pop);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.RG, gl.FLOAT, pb);

  // Terrain: RGB precomputed colors (only update once or when world changes)
  if (!textures.terrain && terrainRGB) {
    textures.terrain = makeTex(tw, th, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE);
    gl.bindTexture(gl.TEXTURE_2D, textures.terrain);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.RGB, gl.UNSIGNED_BYTE, terrainRGB);
  }
}

// Render a frame using GPU
export function renderGL(glState, mode, maxPop, selectedTribe, tribeCount) {
  const { gl, prog, buf, aPos, uniforms, textures } = glState;

  gl.useProgram(prog);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  // Bind textures to units
  const texList = [
    [textures.elev, 'u_elev', 0],
    [textures.owner, 'u_owner', 1],
    [textures.climate, 'u_climate', 2],
    [textures.pop, 'u_pop', 3],
    [textures.terrain, 'u_terrain', 4],
  ];
  for (const [tex, name, unit] of texList) {
    if (!tex) continue;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uniforms[name], unit);
  }

  // Mode mapping: terrain=0, tribes=1, population=2, fertility=3, moisture=4, temp=5
  const modeMap = { terrain: 0, tribes: 1, population: 2, fertility: 3, moisture: 4, temperature: 5 };
  gl.uniform1i(uniforms.u_mode, modeMap[mode] || 0);
  gl.uniform1f(uniforms.u_maxPop, maxPop || 1);
  gl.uniform1f(uniforms.u_time, performance.now() * 0.001);
  gl.uniform1i(uniforms.u_selectedTribe, selectedTribe || -1);
  gl.uniform1i(uniforms.u_tribeCount, tribeCount || 1);

  // Draw quad
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
