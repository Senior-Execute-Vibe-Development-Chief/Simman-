// ── GPU-accelerated Population Step (WebGL2 GPGPU) ──
// Handles per-tile farmer growth and migration diffusion on the GPU.
// This replaces the heaviest inner loop of stepBackgroundPop —
// ~800K land tiles × 4 neighbor lookups per step.
//
// Two passes per step:
//   1. Growth: logistic farmer growth toward farmland capacity
//   2. Migration: 4-neighbor diffusion flow toward higher opportunity
//
// Per-tribe stats (surplus fraction, growth rate, etc.) are packed into
// a tribe lookup texture so the shader can index by owner ID.

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){v_uv=a_pos*0.5+0.5;gl_Position=vec4(a_pos,0,1);}`;

// Pass 1: Growth + urbanization per tile
// Reads: bgPop, cityPop, owner, fertility, difficulty, tribeStats
// Writes: updated bgPop (RG = bgPop, cityPop)
const GROWTH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_pop;        // R=bgPop, G=cityPop
uniform sampler2D u_owner;      // R=owner+1 (0=unowned)
uniform sampler2D u_terrain;    // R=fert, G=diff, B=elev
uniform sampler2D u_tribeStats; // per-tribe: R=surplusFrac, G=growthRate, B=maxCity, A=foodSurplus
uniform sampler2D u_transport;  // R=transportCost
uniform vec2 u_gridSize;
uniform float u_maxTribes;

void main(){
  vec4 popData=texture(u_pop,v_uv);
  float bp=popData.r, cp=popData.g;
  float owRaw=texture(u_owner,v_uv).r;
  int ow=int(owRaw*255.0)-1;
  vec4 terr=texture(u_terrain,v_uv);
  float fert=terr.r, diff=terr.g, elev=terr.b;

  // Skip ocean/frozen
  if(elev<=0.0||fert<0.001){fragColor=vec4(bp,cp,0,1);return;}

  if(ow<0){
    // Unowned: hunter-gatherer growth
    float farmCap=fert*2.0*(1.0-diff*0.5);
    if(bp<farmCap&&farmCap>0.001){
      bp=bp+bp*0.02*(1.0-bp/farmCap);
    }
    // Unowned city decay
    if(cp>0.0)cp=max(0.0,cp*0.97);
    fragColor=vec4(bp,cp,0,1);
    return;
  }

  // Look up tribe stats from 1D texture
  float tribeU=(float(ow)+0.5)/u_maxTribes;
  vec4 ts=texture(u_tribeStats,vec2(tribeU,0.5));
  float surplusFrac=ts.r, growthRate=ts.g, maxCityK=ts.b, foodSurplus=ts.a;

  // Farmer growth: logistic toward farmland capacity
  float farmCap=fert*(1.0+surplusFrac*3.0)*(1.0-diff*0.4);
  if(farmCap>0.001&&bp<farmCap){
    bp=bp+bp*growthRate*(1.0-bp/farmCap);
  }

  // City growth: food-driven
  if(cp>0.0){
    float tCost=texture(u_transport,v_uv).r;
    float transportFactor=1.0/(1.0+tCost*0.1);
    float localMaxCity=maxCityK*transportFactor;
    float foodCap=min(localMaxCity,foodSurplus*transportFactor);
    if(cp<foodCap&&foodSurplus>1.0){
      cp+=min(0.03,(foodCap-cp)*0.02);
    }
    if(cp>foodCap*1.1&&foodCap>0.0){
      cp=max(0.01,cp*0.97);
    }
    if(foodSurplus<0.7&&cp>0.01){
      cp=max(0.01,cp*(0.96+foodSurplus*0.02));
    }
  }

  fragColor=vec4(bp,cp,0,1);
}`;

// Pass 2: Migration diffusion
// Each tile checks 4 neighbors. Pop flows toward higher opportunity.
const MIGRATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_pop;      // R=bgPop, G=cityPop (after growth pass)
uniform sampler2D u_owner;    // R=owner
uniform sampler2D u_terrain;  // R=fert, G=diff, B=elev
uniform sampler2D u_river;    // R=riverMag, G=isCoast
uniform sampler2D u_tribeStats; // A channel = infraLevel
uniform vec2 u_gridSize;
uniform float u_maxTribes;

void main(){
  vec2 texel=1.0/u_gridSize;
  vec4 popData=texture(u_pop,v_uv);
  float bp=popData.r, cp=popData.g;
  float elev=texture(u_terrain,v_uv).b;
  float fert=texture(u_terrain,v_uv).r;
  float diff=texture(u_terrain,v_uv).g;

  if(elev<=0.0||bp<0.01){fragColor=vec4(bp,cp,0,1);return;}

  float owRaw=texture(u_owner,v_uv).r;
  int ow=int(owRaw*255.0)-1;
  float isOwned=ow>=0?1.0:0.0;

  // Compute my opportunity value
  float myValue=fert;
  float rm=texture(u_river,v_uv).r;
  float isCoast=texture(u_river,v_uv).g;
  if(isOwned>0.5){
    if(cp>0.1)myValue+=sqrt(cp)*0.5;
    if(rm>=3.0)myValue+=0.5;else if(rm>=2.0)myValue+=0.2;
    if(isCoast>0.5)myValue+=0.3;
  }
  float myDensity=bp+cp;
  float myOpp=myValue/(myDensity+0.3);

  // Infrastructure from tribe stats
  float infra=1.0;
  if(ow>=0){
    float tribeU=(float(ow)+0.5)/u_maxTribes;
    infra=texture(u_tribeStats,vec2(tribeU,0.5)).a;
    if(infra<0.1)infra=1.0;// fallback
  }
  float baseFlow=bp*0.003*infra;

  // Check 4 neighbors
  vec2 offsets[4];
  offsets[0]=vec2(-texel.x,0);offsets[1]=vec2(texel.x,0);
  offsets[2]=vec2(0,-texel.y);offsets[3]=vec2(0,texel.y);

  float totalFlow=0.0;
  for(int d=0;d<4;d++){
    vec2 nUV=v_uv+offsets[d];
    // Wrap X for globe, clamp Y
    nUV.x=fract(nUV.x);
    if(nUV.y<0.0||nUV.y>1.0)continue;

    float nElev=texture(u_terrain,nUV).b;
    if(nElev<=0.0)continue;
    float nOwRaw=texture(u_owner,nUV).r;
    int nOw=int(nOwRaw*255.0)-1;

    // Only flow within same ownership category
    if(isOwned>0.5&&nOw!=ow)continue;
    if(isOwned<0.5&&nOw>=0)continue;

    float nFert=texture(u_terrain,nUV).r;
    float nDiff=texture(u_terrain,nUV).g;
    vec4 nPop=texture(u_pop,nUV);
    float nBp=nPop.r, nCp=nPop.g;

    float nValue=nFert;
    if(isOwned>0.5){
      float nRm=texture(u_river,nUV).r;
      float nCoast=texture(u_river,nUV).g;
      if(nCp>0.1)nValue+=sqrt(nCp)*0.5;
      if(nRm>=3.0)nValue+=0.5;else if(nRm>=2.0)nValue+=0.2;
      if(nCoast>0.5)nValue+=0.3;
    }
    float nDensity=nBp+nCp;
    float nOpp=nValue/(nDensity+0.3);

    if(nOpp>myOpp){
      float pull=(nOpp-myOpp)/(myOpp+0.05);
      float flow=min(bp*0.08,baseFlow*pull*(1.0-nDiff));
      if(flow>0.001)totalFlow+=flow;
    }
  }

  bp=max(0.0,bp-totalFlow);
  fragColor=vec4(bp,cp,0,1);
}`;


function compileShader(gl,src,type){
  const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error('GPU Pop shader:',gl.getShaderInfoLog(s));return null;}
  return s;}
function createProg(gl,vsSrc,fsSrc){
  const vs=compileShader(gl,vsSrc,gl.VERTEX_SHADER),fs=compileShader(gl,fsSrc,gl.FRAGMENT_SHADER);
  if(!vs||!fs)return null;const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error('GPU Pop link:',gl.getProgramInfoLog(p));return null;}
  return p;}

function makeFBO(gl,w,h,fmt,channels,cType){
  const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,fmt,w,h,0,channels,cType,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
  return{tex,fbo};}

export function initGPUPopSolver(){
  const canvas=new OffscreenCanvas(1,1);
  const gl=canvas.getContext('webgl2',{antialias:false,alpha:false});
  if(!gl){console.warn('[GPUPop] WebGL2 not available');return null;}
  if(!gl.getExtension('EXT_color_buffer_float')){console.warn('[GPUPop] No float FBO');return null;}
  const growthProg=createProg(gl,VS,GROWTH_FS);
  const migrateProg=createProg(gl,VS,MIGRATE_FS);
  if(!growthProg||!migrateProg)return null;
  const quadBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  console.log('[GPUPop] Population solver initialized');
  return{gl,growthProg,migrateProg,quadBuf,_cache:null};}

// Run one population step on GPU.
// tribeStats: Float32Array(n*4) packed as [surplusFrac, growthRate, maxCity, infra] per tribe
export function stepPopGPU(state,tw,th,bgPop,cityPop,owner,tFert,tDiff,tElev,
  tCoast,riverMag,transportCost,tribeStatsArr,numTribes){
  const{gl,growthProg,migrateProg,quadBuf}=state;
  gl.canvas.width=tw;gl.canvas.height=th;gl.viewport(0,0,tw,th);
  const N=tw*th;

  // Create/resize textures on first call or size change
  if(!state._cache||state._cache.tw!==tw||state._cache.th!==th){
    const c={tw,th};
    c.popA=makeFBO(gl,tw,th,gl.RG32F,gl.RG,gl.FLOAT);
    c.popB=makeFBO(gl,tw,th,gl.RG32F,gl.RG,gl.FLOAT);
    // Static textures (updated less frequently)
    c.ownerTex=makeFBO(gl,tw,th,gl.R8,gl.RED,gl.UNSIGNED_BYTE);
    c.terrTex=makeFBO(gl,tw,th,gl.RGB32F,gl.RGB,gl.FLOAT);
    c.riverTex=makeFBO(gl,tw,th,gl.RG32F,gl.RG,gl.FLOAT);
    c.transTex=makeFBO(gl,tw,th,gl.R32F,gl.RED,gl.FLOAT);
    c.tribeStatsTex=makeFBO(gl,256,1,gl.RGBA32F,gl.RGBA,gl.FLOAT);
    // Reusable upload buffers
    c.popBuf=new Float32Array(N*2);
    c.ownerBuf=new Uint8Array(N);
    c.terrBuf=new Float32Array(N*3);
    c.riverBuf=new Float32Array(N*2);
    state._cache=c;
  }
  const c=state._cache;

  // Upload population data
  const pb=c.popBuf;
  for(let i=0;i<N;i++){pb[i*2]=bgPop[i];pb[i*2+1]=cityPop[i];}
  gl.bindTexture(gl.TEXTURE_2D,c.popA.tex);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,tw,th,gl.RG,gl.FLOAT,pb);

  // Upload owner
  const ob=c.ownerBuf;
  for(let i=0;i<N;i++)ob[i]=owner[i]+1;
  gl.bindTexture(gl.TEXTURE_2D,c.ownerTex.tex);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,tw,th,gl.RED,gl.UNSIGNED_BYTE,ob);

  // Upload terrain (fert, diff, elev)
  const tb=c.terrBuf;
  for(let i=0;i<N;i++){tb[i*3]=tFert[i];tb[i*3+1]=tDiff[i];tb[i*3+2]=tElev[i];}
  gl.bindTexture(gl.TEXTURE_2D,c.terrTex.tex);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,tw,th,gl.RGB,gl.FLOAT,tb);

  // Upload river + coast
  const rb=c.riverBuf;
  for(let i=0;i<N;i++){rb[i*2]=riverMag?riverMag[i]:0;rb[i*2+1]=tCoast[i]?1:0;}
  gl.bindTexture(gl.TEXTURE_2D,c.riverTex.tex);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,tw,th,gl.RG,gl.FLOAT,rb);

  // Upload transport cost
  gl.bindTexture(gl.TEXTURE_2D,c.transTex.tex);
  if(transportCost&&transportCost.length>=N)
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,tw,th,gl.RED,gl.FLOAT,transportCost);

  // Upload tribe stats (256-wide 1D texture)
  const tsBuf=new Float32Array(256*4);
  if(tribeStatsArr)tsBuf.set(tribeStatsArr.subarray(0,Math.min(tribeStatsArr.length,256*4)));
  gl.bindTexture(gl.TEXTURE_2D,c.tribeStatsTex.tex);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,1,gl.RGBA,gl.FLOAT,tsBuf);

  // Helper
  function bindTex(prog,name,tex,unit){
    gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.uniform1i(gl.getUniformLocation(prog,name),unit);}
  function drawQuad(prog){
    gl.useProgram(prog);gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
    const a=gl.getAttribLocation(prog,'a_pos');gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}

  // ── Pass 1: Growth ──
  gl.bindFramebuffer(gl.FRAMEBUFFER,c.popB.fbo);
  gl.useProgram(growthProg);
  bindTex(growthProg,'u_pop',c.popA.tex,0);
  bindTex(growthProg,'u_owner',c.ownerTex.tex,1);
  bindTex(growthProg,'u_terrain',c.terrTex.tex,2);
  bindTex(growthProg,'u_tribeStats',c.tribeStatsTex.tex,3);
  bindTex(growthProg,'u_transport',c.transTex.tex,4);
  gl.uniform2f(gl.getUniformLocation(growthProg,'u_gridSize'),tw,th);
  gl.uniform1f(gl.getUniformLocation(growthProg,'u_maxTribes'),Math.max(numTribes,1));
  drawQuad(growthProg);

  // ── Pass 2: Migration ──
  gl.bindFramebuffer(gl.FRAMEBUFFER,c.popA.fbo);
  gl.useProgram(migrateProg);
  bindTex(migrateProg,'u_pop',c.popB.tex,0);
  bindTex(migrateProg,'u_owner',c.ownerTex.tex,1);
  bindTex(migrateProg,'u_terrain',c.terrTex.tex,2);
  bindTex(migrateProg,'u_river',c.riverTex.tex,3);
  bindTex(migrateProg,'u_tribeStats',c.tribeStatsTex.tex,4);
  gl.uniform2f(gl.getUniformLocation(migrateProg,'u_gridSize'),tw,th);
  gl.uniform1f(gl.getUniformLocation(migrateProg,'u_maxTribes'),Math.max(numTribes,1));
  drawQuad(migrateProg);

  // ── Read back ──
  gl.bindFramebuffer(gl.FRAMEBUFFER,c.popA.fbo);
  const result=new Float32Array(N*4);
  gl.readPixels(0,0,tw,th,gl.RGBA,gl.FLOAT,result);

  // Extract bgPop and cityPop from RG channels
  for(let i=0;i<N;i++){
    bgPop[i]=result[i*4];
    cityPop[i]=result[i*4+1];
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
}
