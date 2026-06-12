import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { isRealWindAvailable, fillRealWind } from "./realWindData.js";
import GlobeView from "./GlobeView.jsx";
import TuningPanel, { ParamEditor } from "./TuningPanel.jsx";
import { loadPresets, deletePreset } from "./paramDefs.js";
import { parseAzgaarJSON, rasterizeAzgaar, rasterizeHeightmap, loadImageFile } from "./mapImport.js";
import { generateResources, tileResourceSummary, RESOURCES } from "./resourceGen.js";
import { computeRivers, RIVER_NAMES, RIVER_STREAM } from "./riverGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "./peopleSim/index.js";
import { cropSuitability } from "./cropGen.js";
import { applyTuning, resetTuning, tuningDefaults } from "./peopleSim/tuning.js";
import SimLevers from "./SimLevers.jsx";
import { baseEdgeCost } from "./peopleSim/transport.js";
import { getExportBreakdown, getTradeProfile, getWealthReserve, TIER_THRESHOLD } from "./peopleSim/settlement.js";
import { IN_LABELS, OUT_LABELS, IN_GOODS } from "./peopleSim/money.js";
import { TECHS, ERAS, TECH_IDX, techState, techNodeState, nextTechs, techLayout, techEdgePath, techEffectList, techTotalList } from "./peopleSim/tech.js";
// tech-chip tint per era: stone · bronze · classical · medieval · renaissance · industrial · modern
const ERA_BG=["#b7b0a2","#cf9a63","#dab347","#86a98f","#b596c4","#8fa6bb","#d9e2ea"];
// effect-chip colour per channel (food=green, naval=teal, build=tan, war=red, admin=violet, trade=jade, wealth=gold)
const FX_COLOR={farm:"#5f7d33",fish:"#2f7d8a",build:"#9a6f38",military:"#9c3a36",reach:"#6a4a8d",cohesion:"#9a6a33",defense:"#566089",trade:"#2f7d5a",wealth:"#9a7a24",seaSpeed:"#2f6d8a",seaRange:"#2f6d8a",embark:"#2f7d8a",ocean:"#2a6a8a",colonize:"#2a6a8a",walls:"#566089",market:"#2f7d5a"};
import WorldGenWorker from "./worldGenWorker.js?worker&inline";
import PeopleSimWorker from "./peopleSimWorker.js?worker&inline";

// Noise + PRNG utilities moved to src/worldgenUtils.js so worldgen code can
// also run headlessly (Node tests, future tooling) without dragging React in.
import { initNoise, noise2D, fbm, ridged, worley } from "./worldgenUtils.js";

const RES=1;
// ── Mercator projection helpers ──
const MAX_LAT_DEG = 78;
const MAX_LAT = MAX_LAT_DEG * Math.PI / 180;
const MERC_MAX = Math.log(Math.tan(Math.PI / 4 + MAX_LAT / 2));
const CW_FLAT = 1920, CH_FLAT = 960; // equirectangular canvas (matches world at RES=1)
// Mercator height: match equator pixel scale to flat mode, then add space for polar stretch
// Formula: CH = 2 * MERC_MAX * (CH_FLAT / π) — equator stays same size as flat mode
const CH_MERC = Math.round(2 * MERC_MAX * CH_FLAT / Math.PI); // ~688
// Views whose base raster is a pure function of the world (not the sim), so it
// can be rendered once to an offscreen canvas and blitted each frame instead
// of rebuilt per-pixel. Sim-dependent views (population, transport, roads,
// money, tribes) and atlas are excluded.
const BASE_CACHE_VIEWS = new Set(["terrain","depth","wind","fertility","crop","crossing","resources","moisture","temperature","country","atlas"]);
// Sim-DYNAMIC data views: also cacheable (a GPU blit instead of a full-canvas
// putImageData every frame — the reason these lagged next to the country view),
// but their raster must refresh as the sim advances, so the cache key carries a
// step bucket: rebuild every STEP_CACHE_REGEN sim-steps, blit between (the same
// trick the political overlay uses). When paused the step is constant, so they
// blit every frame and cost nothing.
const STEP_CACHE_VIEWS = new Set(["money","roads"]);
const STEP_CACHE_REGEN = 8;
let _mercator = false; // module-level flag for projection functions

function screenYtoDataY(sy, ch, H) {
  if (!_mercator) return Math.min(H - 1, sy * RES);
  const mercY = MERC_MAX - (sy / ch) * 2 * MERC_MAX;
  const latRad = 2 * Math.atan(Math.exp(mercY)) - Math.PI / 2;
  return Math.max(0, Math.min(H - 1, ((90 - latRad * 180 / Math.PI) / 180) * H));
}

function dataYtoScreenY(dy, H, ch) {
  if (!_mercator) return Math.min(ch - 1, dy / RES);
  const latDeg = 90 - (dy / H) * 180;
  const latClamped = Math.max(-MAX_LAT_DEG, Math.min(MAX_LAT_DEG, latDeg));
  const latRad = latClamped * Math.PI / 180;
  const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return Math.max(0, Math.min(ch - 1, ((MERC_MAX - mercY) / (2 * MERC_MAX)) * ch));
}

let _tecParams = {};

// generateWorld extracted to ./worldgen.js so worldgen can run headlessly.
import { generateWorld } from "./worldgen.js";

const BC=[
[10,22,56],      // 0  Deep Ocean
[20,48,95],      // 1  Shallow Ocean
[36,78,125],     // 2  Coastal Water
[194,182,140],   // 3  Beach (unused)
[168,158,130],   // 4  Tundra — brown-tan (lichen/permafrost, satellite)
[235,240,248],   // 5  Snow / Ice
[50,80,58],      // 6  Taiga — dark blue-green (spruce canopy from satellite)
[45,78,48],      // 7  Boreal Forest — darker spruce green
[50,105,45],     // 8  Temperate Forest — muted deciduous green (satellite)
[25,100,52],     // 9  Temperate Rainforest — deep emerald
[14,72,28],      // 10 Tropical Rainforest — dark dense canopy
[192,176,82],    // 11 Savanna — golden-tan with scattered green
[158,165,78],    // 12 Grassland — tan-green prairie (more green than pure golden)
[210,185,140],   // 13 Desert — warm sandy tan (slight orange like Sahara satellite)
[140,135,78],    // 14 Shrubland — olive-brown chaparral
[78,118,48],     // 15 Tropical Dry Forest — muted olive-green
[152,145,135],   // 16 Barren / Alpine — gray-brown rock
[42,110,38],     // 17 Subtropical Forest — warm humid (SE US, S China, SE Brazil)
[195,190,180]    // 18 Cold Desert / Polar Desert — pale gray-tan
];
const BN=['Deep Ocean','Shallow Ocean','Coastal Water','Beach','Tundra','Snow / Ice','Taiga',
'Boreal Forest','Temperate Forest','Temperate Rainforest','Tropical Rainforest','Savanna',
'Grassland','Desert','Shrubland','Tropical Dry Forest','Barren / Alpine',
'Subtropical Forest','Cold Desert'];
function getBiomeD(e,m,t,sl){
  if(e<=sl)return e<sl-.08?0:e<sl-.01?1:2;
  // Effective moisture: cold regions retain moisture (low evaporation),
  // hot regions lose it to evaporation (Holdridge PET principle).
  const demand=.5+t*.5;
  const em=Math.min(1,m/demand);
  // Biome temperature bands on the calibrated air-temp scale (t = 0.60 + °C/100):
  // ICE < -15°C · tundra -15..-2 · taiga -2..+5 · temperate +5..+18 ·
  // subtropical +18..+25 · tropical > +25°C. (Moisture em then picks
  // forest/grassland/desert within each band — Holdridge PET logic, unchanged.)
  if(t<.45)return 5;                                        // permanent ice / snow (Greenland, Antarctica, high Arctic)
  if(t<.52)return em>.4?6:em>.08?4:18;                      // tundra / cold desert
  if(t<.58)return em>.35?6:em>.08?4:18;
  if(t<.65)return em>.45?7:em>.25?6:em>.08?4:18;            // taiga / boreal
  if(t<.78)return em>.55?9:em>.35?8:em>.15?12:13;           // temperate
  if(t<.85)return em>.5?17:em>.3?15:em>.18?11:em>.1?14:13;  // subtropical
  return em>.5?10:em>.3?15:em>.18?11:em>.1?12:13;           // tropical
}
function getColorD(e,m,t,sl){const c=BC[getBiomeD(e,m,t,sl)],v=((e*37.7+m*17.3+t*53.1)%1+1)%1;
return[(c[0]+(v-.5)*10)|0,(c[1]+(v-.5)*10)|0,(c[2]+(v-.5)*8)|0];}

// ── Live country colouring (Country view) ───────────────────────────
// Give every country a hue as DISTINCT as possible from the countries it borders,
// so the political map stays legible as the world changes. Builds the border-
// adjacency graph from the claim map, then runs a force-directed relaxation on the
// hue WHEEL: each country is pushed away from its neighbours' hues (repulsion that's
// stronger the closer two neighbours are). Previous hues seed the next solve, so the
// colours spread out and then drift smoothly rather than flickering each refresh.
function assignCountryColors(claimArr,tw,th,prev){
  const adj=new Map(),present=[],seen=new Set();
  const link=(a,b)=>{let s=adj.get(a);if(!s)adj.set(a,s=new Set());s.add(b);let t=adj.get(b);if(!t)adj.set(b,t=new Set());t.add(a);};
  for(let ti=0;ti<claimArr.length;ti++){
    const cc=claimArr[ti];if(cc<0)continue;
    if(!seen.has(cc)){seen.add(cc);present.push(cc);}
    const py=(ti/tw)|0,px=ti-py*tw;
    const ro=claimArr[py*tw+(px===tw-1?0:px+1)];
    if(ro>=0&&ro!==cc)link(cc,ro);
    if(py<th-1){const dno=claimArr[ti+tw];if(dno>=0&&dno!==cc)link(cc,dno);}
  }
  const hue=new Map();
  let seeded=0;
  for(const c of present){const had=prev.has(c);if(had)seeded++;hue.set(c,had?prev.get(c):((c*61)%360+360)%360);}
  // First solve needs the full relaxation to untangle the (c*61)%360 seeds;
  // once almost everything carries its previous hue, a short settle pass is
  // enough to absorb the handful of new countries — this runs per claim
  // refresh, so the steady-state cost matters.
  const iters=seeded>=present.length*0.9?14:60;
  for(let it=0;it<iters;it++){
    const nudge=[];
    for(const c of present){
      const ns=adj.get(c);if(!ns||ns.size===0){nudge.push(0);continue;}
      const hc=hue.get(c);let f=0;
      for(const n of ns){
        let d=((hc-hue.get(n)+540)%360)-180;          // signed hue gap (-180,180]
        if(d>-0.5&&d<0.5)d=d>=0?0.5:-0.5;             // break exact overlaps
        f+=Math.sign(d)*(180-Math.abs(d))/ns.size;     // repel — strongest when hues are close
      }
      nudge.push(f);
    }
    let i=0;for(const c of present)hue.set(c,((hue.get(c)+nudge[i++]*0.06)%360+360)%360);
  }
  return hue;   // Map: countryId → hue 0..360
}

// ── Tech-tree overlay (Civ-like skill tree) ─────────────────────────
// Full-screen modal showing the whole tech DAG for the selected settlement:
// era columns, prerequisite links, and per-node state (discovered / researching
// with progress / locked). Pure view over tech.js + the settlement's knowledge.
function TechTreeOverlay({k,title,onClose}){
  const ts=techState(k||{});
  const L=techLayout();
  const {pos,NW,NH,TOP,W,H}=L;
  const [hov,setHov]=useState(null);   // {id,x,y} — hovered tech for the effect card
  const chip=(bg,bd)=>(<span style={{display:"inline-block",width:9,height:9,background:bg,border:bd,borderRadius:2,marginRight:4,verticalAlign:"middle",boxSizing:"border-box"}}/>);
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(10,8,6,0.74)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} className="au-parchment au-elev" style={{padding:"10px 14px",maxWidth:"96vw",maxHeight:"94vh",overflow:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <div className="au-pico-title" style={{fontSize:15}}>Tech Tree{title?` — ${title}`:""}{" "}
            <span className="au-fade" style={{fontSize:11}}>· {ERAS[ts.era]} · {ts.count}/{TECHS.length} discovered</span></div>
          <button onClick={onClose} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--au-fade)",fontSize:18,lineHeight:1,padding:"0 2px"}}>×</button>
        </div>
        {(()=>{const tot=techTotalList(ts.have);if(!tot.length)return null;
          return <div style={{display:"flex",flexWrap:"wrap",gap:3,alignItems:"center",marginBottom:7,paddingBottom:6,borderBottom:"1px solid rgba(120,90,50,0.2)"}}>
            <span className="au-fade" style={{fontSize:10,marginRight:3,fontWeight:600,letterSpacing:0.3}}>STACKED TECH BONUSES</span>
            {tot.map((e,i)=><span key={i} style={{padding:"1.5px 6px",borderRadius:3,fontSize:10,fontWeight:600,color:"#fff",background:FX_COLOR[e.key]||"#6a5a3a",opacity:e.good?1:0.85}}>{e.text}</span>)}
          </div>;
        })()}
        <svg width={W} height={H} style={{display:"block"}}>
          {/* era labels at the centroid column of each era's techs — eras
              interleave across the depth tiers (as in Civ), so they orient
              rather than partition; node FILL carries the era colour */}
          {ERAS.map((e,ei)=>{let sx=0,n=0;for(const t of TECHS)if(t.era===ei){const pp=pos[t.id];if(pp){sx+=pp.x+NW/2;n++;}}if(!n)return null;const cx=sx/n;
            return(<g key={e}>
              <rect x={cx-46} y={TOP-26} width={92} height={3} fill={ERA_BG[ei]} rx={1.5}/>
              <text x={cx} y={TOP-12} textAnchor="middle" fontSize={11} fill="#5a4a32" fontWeight="bold" style={{textTransform:"uppercase",letterSpacing:0.5}}>{e}</text>
            </g>);
          })}
          {/* prerequisite links — orthogonal (right-angle) routing, drawn UNDER
              the opaque nodes so a long link passes cleanly behind intervening
              tiers instead of crossing them. Each link leaves the prereq's right
              edge, runs to the target column's left gutter, then rises/drops
              into the target's left edge. */}
          {TECHS.map(t=>t.prereq.map(p=>{const a=pos[p],b=pos[t.id];if(!a||!b)return null;
            const open=ts.have[TECH_IDX[p]]===1;
            const stag=(TECH_IDX[p]*3+TECH_IDX[t.id])%5;
            return <path key={p+">"+t.id} d={techEdgePath(a,b,L,stag)} fill="none"
              stroke={open?"#7a5c34":"rgba(120,100,70,0.32)"} strokeWidth={open?1.7:1} strokeDasharray={open?"":"3 3"}/>;
          }))}
          {/* tech nodes (opaque fills occlude the links routed behind them) */}
          {TECHS.map(t=>{const p=pos[t.id];const ns=techNodeState(k||{},ts.have,t);const era=ERA_BG[t.era]||"#b9b2a4";
            let fill,stroke,txt,sw,dash="";
            if(ns.state==="have"){fill=era;stroke="#3a2c18";txt="#1a140c";sw=1.1;}
            else if(ns.state==="next"){fill="#fffaf0";stroke=era;txt="#2c2114";sw=2;}
            else{fill="#e9e1ce";stroke="rgba(90,75,50,0.42)";txt="rgba(70,58,40,0.62)";sw=1;dash="4 3";}
            return(<g key={t.id} style={{cursor:"help"}}
              onMouseMove={e=>setHov({id:t.id,x:e.clientX,y:e.clientY})} onMouseLeave={()=>setHov(null)}>
              <rect x={p.x} y={p.y} width={NW} height={NH} rx={5} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash}/>
              <text x={p.x+9} y={p.y+NH/2+3.6} fontSize={10} fill={txt} fontWeight={ns.state==="have"?"bold":"normal"}>{t.name}</text>
              {ns.state==="next"&&<rect x={p.x+1} y={p.y+NH-3} width={(NW-2)*ns.prog} height={2.4} fill={era} rx={1.2}/>}
            </g>);
          })}
        </svg>
        <div className="au-fade" style={{fontSize:10,marginTop:6,display:"flex",gap:16,flexWrap:"wrap"}}>
          <span>{chip("#dab347","none")}discovered</span>
          <span>{chip("rgba(255,251,243,0.95)","2px solid #d8b24a")}researching (prerequisites met)</span>
          <span>{chip("rgba(150,140,120,0.2)","1px dashed rgba(90,75,50,0.5)")}locked — needs an earlier tech</span>
        </div>
      </div>
      {hov&&(()=>{
        const t=TECHS[TECH_IDX[hov.id]]; if(!t) return null;
        const ns=techNodeState(k||{},ts.have,t); const fx=techEffectList(hov.id);
        const vw=typeof window!=="undefined"?window.innerWidth:1280, vh=typeof window!=="undefined"?window.innerHeight:800;
        const left=Math.min(hov.x+16, vw-258), top=Math.min(hov.y+16, vh-200);
        return(<div style={{position:"fixed",left,top,width:242,zIndex:320,pointerEvents:"none",
          background:"#f6eeda",border:`2px solid ${ERA_BG[t.era]||"#b9b2a4"}`,borderRadius:7,padding:"8px 10px",boxShadow:"0 6px 18px rgba(0,0,0,0.4)"}}>
          <div style={{fontWeight:"bold",fontSize:13,color:"#2c2114"}}>{t.name}</div>
          <div style={{fontSize:9,letterSpacing:0.5,textTransform:"uppercase",color:"#8a7a55",marginBottom:4}}>
            {ERAS[t.era]} · {ns.state==="have"?"discovered":ns.state==="next"?`researching ${(ns.prog*100)|0}%`:"locked"}</div>
          <div style={{fontSize:10.5,color:"#473a28",lineHeight:1.35,marginBottom:6}}>{t.desc}</div>
          {fx.length>0
            ? <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:t.prereq.length?6:0}}>
                {fx.map((e,i)=><span key={i} style={{padding:"1.5px 5px",borderRadius:3,fontSize:9.5,fontWeight:600,color:"#fff",background:FX_COLOR[e.key]||"#6a5a3a",opacity:e.good?1:0.85}}>{e.text}</span>)}
              </div>
            : <div style={{fontSize:9.5,fontStyle:"italic",color:"#9a8a65",marginBottom:t.prereq.length?6:0}}>a stepping-stone — no direct bonus</div>}
          {t.prereq.length>0&&<div style={{fontSize:9.5,color:"#7a6a48"}}>Requires: {t.prereq.map(p=>TECHS[TECH_IDX[p]].name).join(" + ")}</div>}
        </div>);
      })()}
    </div>
  );
}

// ── Chronicle overlay — a realm's full history in its own scrollable window ──
// (the settlement card is too short to hold a long log; a modal escapes it).
// `entries` are {step,type,text}; rendered newest-first, dated via yearStr and
// colour-coded by event type (dark tones for contrast on the light parchment).
const CHRON_COL={founding:"#1f7a55",discovery:"#2f6fa8",growth:"#2f7d3f",wealth:"#9c7414",
  war:"#b23a28",conquest:"#b15212",annex:"#8a6420",secession:"#7a44b0",loss:"#a04a28",
  plague:"#8a3aa8",famine:"#9c5a1e",end:"#5a4a32"};
const CHRON_LABEL={founding:"Founding",discovery:"Discovery",growth:"Growth",wealth:"Wealth",
  war:"War",conquest:"Conquest",annex:"Annexation",secession:"Secession",loss:"Loss",
  plague:"Plague",famine:"Famine",end:"Fall"};
function ChronicleOverlay({entries,name,onClose}){
  const rows=(entries||[]).slice().reverse();   // newest first
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(10,8,6,0.74)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} className="au-parchment au-elev" style={{padding:"12px 16px",width:"min(580px,93vw)",maxHeight:"88vh",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexShrink:0}}>
          <div className="au-pico-title" style={{fontSize:15}}>Chronicle{name?` — ${name}`:""}{" "}
            <span className="au-fade" style={{fontSize:11}}>· {rows.length} events</span></div>
          <button onClick={onClose} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--au-fade)",fontSize:18,lineHeight:1,padding:"0 2px"}}>×</button>
        </div>
        {/* minHeight:0 lets this flex child shrink so overflowY:auto actually
            engages inside the maxHeight:88vh column (the flexbox scroll gotcha). */}
        <div style={{overflowY:"auto",minHeight:0,paddingRight:6}}>
          {rows.length===0
            ?<div className="au-fade" style={{fontSize:12,fontStyle:"italic"}}>No events recorded yet.</div>
            :<div style={{display:"grid",gridTemplateColumns:"auto auto 1fr",gap:"5px 10px",alignItems:"baseline",fontSize:12}}>
              {rows.map((e,i)=>(
                <Fragment key={i}>
                  <span className="au-fade" style={{textAlign:"right",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{yearStr(e.step)}</span>
                  <span style={{fontSize:9,letterSpacing:0.3,textTransform:"uppercase",color:CHRON_COL[e.type]||"#5a4a32",fontWeight:600,whiteSpace:"nowrap"}}>{CHRON_LABEL[e.type]||e.type}</span>
                  <span style={{color:"#3a2614",lineHeight:1.4}}>{e.text}</span>
                </Fragment>
              ))}
            </div>}
        </div>
      </div>
    </div>
  );
}

// ── Atlas (olde-map) cartographic symbols — hand-drawn map iconography ──
function atlasHash(a,b){let h=(a*374761393+b*668265263)>>>0;h=((h^(h>>>13))*1274126177)>>>0;return((h^(h>>>16))>>>0)/4294967296;}
function atlasMountain(c,x,y,s,snow,tone){
const h=s,wd=s*0.86;
const lum=0.82+tone*0.32;
c.beginPath();c.moveTo(x,y-h);c.lineTo(x-wd,y+h*0.66);c.lineTo(x+wd,y+h*0.66);c.closePath();
c.fillStyle=`rgb(${(176*lum)|0},${(160*lum)|0},${(120*lum)|0})`;c.fill();
c.beginPath();c.moveTo(x,y-h);c.lineTo(x+wd,y+h*0.66);c.lineTo(x,y+h*0.66);c.closePath();
c.fillStyle='rgba(44,32,18,0.5)';c.fill();
c.strokeStyle='rgba(46,34,20,0.4)';c.lineWidth=Math.max(0.4,s*0.1);
c.beginPath();c.moveTo(x,y-h*0.18);c.lineTo(x+wd*0.5,y+h*0.5);c.stroke();
if(snow){c.beginPath();c.moveTo(x,y-h);c.lineTo(x-s*0.30,y-h*0.40);c.lineTo(x-s*0.08,y-h*0.56);
c.lineTo(x+s*0.13,y-h*0.38);c.lineTo(x+s*0.30,y-h*0.48);c.closePath();c.fillStyle='rgba(236,229,212,0.9)';c.fill();}
c.strokeStyle='rgba(38,28,15,0.9)';c.lineWidth=Math.max(0.55,s*0.15);
c.beginPath();c.moveTo(x-wd,y+h*0.66);c.lineTo(x,y-h);c.lineTo(x+wd,y+h*0.66);c.stroke();}
function atlasHill(c,x,y,s){
c.strokeStyle='rgba(74,58,36,0.78)';c.lineWidth=Math.max(0.5,s*0.32);
c.beginPath();c.arc(x,y+s*0.45,s,Math.PI,2*Math.PI);c.stroke();}
// Tree — same hand-inked style as the mountains: tall, pointy, shaded, with a trunk stump
// ── Atlas tree silhouettes — one distinct shape per forest type ──
// Conifer/fir — tall narrow spire with tier hatching (taiga, boreal)
function atlasConifer(c,x,y,s,tone){
const wd=s*0.30,baseY=y+s*0.42,apexY=y-s*0.60;
const tw=Math.max(0.9,s*0.15),thh=s*0.30;
c.fillStyle='#43331d';c.fillRect(x-tw/2,baseY-0.6,tw,thh);
c.strokeStyle='rgba(32,23,11,0.85)';c.lineWidth=Math.max(0.4,s*0.08);
c.strokeRect(x-tw/2,baseY-0.6,tw,thh);
const lum=0.80+tone*0.40;
c.beginPath();c.moveTo(x,apexY);c.lineTo(x-wd,baseY);c.lineTo(x+wd,baseY);c.closePath();
c.fillStyle=`rgb(${(88*lum)|0},${(112*lum)|0},${(78*lum)|0})`;c.fill();
c.beginPath();c.moveTo(x,apexY);c.lineTo(x+wd,baseY);c.lineTo(x,baseY);c.closePath();
c.fillStyle='rgba(20,28,12,0.46)';c.fill();
c.strokeStyle='rgba(24,32,15,0.5)';c.lineWidth=Math.max(0.35,s*0.09);
c.beginPath();c.moveTo(x-wd*0.62,baseY-s*0.30);c.lineTo(x+wd*0.62,baseY-s*0.30);
c.moveTo(x-wd*0.32,baseY-s*0.62);c.lineTo(x+wd*0.32,baseY-s*0.62);c.stroke();
c.strokeStyle='rgba(26,34,16,0.92)';c.lineWidth=Math.max(0.5,s*0.13);
c.beginPath();c.moveTo(x-wd,baseY);c.lineTo(x,apexY);c.lineTo(x+wd,baseY);c.stroke();}
// Deciduous — round lumpy canopy (temperate, subtropical broadleaf)
function atlasRoundTree(c,x,y,s,tone){
const rad=s*0.58,cy=y-s*0.10;
const tw=Math.max(0.8,s*0.15),thh=s*0.34;
c.fillStyle='#4a3820';c.fillRect(x-tw/2,cy+rad*0.5,tw,thh);
c.strokeStyle='rgba(32,23,11,0.8)';c.lineWidth=Math.max(0.4,s*0.08);
c.strokeRect(x-tw/2,cy+rad*0.5,tw,thh);
const lum=0.82+tone*0.36;
c.beginPath();
c.arc(x-rad*0.46,cy+rad*0.14,rad*0.62,0,6.2832);
c.arc(x+rad*0.46,cy+rad*0.18,rad*0.58,0,6.2832);
c.arc(x-rad*0.04,cy-rad*0.40,rad*0.66,0,6.2832);
c.arc(x+rad*0.22,cy+rad*0.04,rad*0.60,0,6.2832);
c.fillStyle=`rgb(${(128*lum)|0},${(142*lum)|0},${(74*lum)|0})`;c.fill();
c.strokeStyle='rgba(40,46,22,0.9)';c.lineWidth=Math.max(0.5,s*0.12);c.stroke();}
// Jungle — broad, dark, low spreading canopy (rainforest)
function atlasJungleTree(c,x,y,s,tone){
const tw=Math.max(0.7,s*0.12);
c.fillStyle='#3a2c18';c.fillRect(x-tw/2,y-s*0.04,tw,s*0.44);
const lum=0.72+tone*0.34,cy=y-s*0.30;
c.beginPath();
c.arc(x-s*0.62,cy+s*0.08,s*0.42,0,6.2832);
c.arc(x+s*0.62,cy+s*0.08,s*0.40,0,6.2832);
c.arc(x-s*0.24,cy-s*0.10,s*0.47,0,6.2832);
c.arc(x+s*0.26,cy-s*0.08,s*0.46,0,6.2832);
c.arc(x,cy+s*0.04,s*0.44,0,6.2832);
c.fillStyle=`rgb(${(70*lum)|0},${(94*lum)|0},${(50*lum)|0})`;c.fill();
c.strokeStyle='rgba(18,26,11,0.92)';c.lineWidth=Math.max(0.45,s*0.1);c.stroke();}
// Acacia — flat-topped crown on a tall trunk (tropical dry forest, savanna)
function atlasAcacia(c,x,y,s,tone){
const tw=Math.max(0.7,s*0.12),topY=y-s*0.46;
c.fillStyle='#4a3820';c.fillRect(x-tw/2,topY+s*0.06,tw,s*0.58);
c.strokeStyle='rgba(32,23,11,0.8)';c.lineWidth=Math.max(0.35,s*0.07);
c.strokeRect(x-tw/2,topY+s*0.06,tw,s*0.58);
const lum=0.80+tone*0.34;
c.beginPath();c.ellipse(x,topY,s*0.78,s*0.27,0,0,6.2832);
c.fillStyle=`rgb(${(122*lum)|0},${(130*lum)|0},${(70*lum)|0})`;c.fill();
c.strokeStyle='rgba(40,44,22,0.88)';c.lineWidth=Math.max(0.45,s*0.1);c.stroke();}
// Grass tuft — a small fan of curved blades
function atlasTuft(c,x,y,s,tone){
c.strokeStyle=`rgba(${(94+tone*46)|0},${(104+tone*30)|0},${(58+tone*22)|0},0.82)`;
c.lineWidth=Math.max(0.34,s*0.16);
c.beginPath();
c.moveTo(x,y);c.quadraticCurveTo(x-s*0.55,y-s*0.5,x-s*0.78,y-s*1.05);
c.moveTo(x,y);c.quadraticCurveTo(x-s*0.05,y-s*0.7,x+s*0.04,y-s*1.32);
c.moveTo(x,y);c.quadraticCurveTo(x+s*0.5,y-s*0.5,x+s*0.74,y-s*1.0);
c.stroke();}
// Shrub — a small lumpy bush
function atlasShrub(c,x,y,s,tone){
c.beginPath();
c.arc(x-s*0.42,y,s*0.5,0,6.2832);
c.arc(x+s*0.42,y+s*0.05,s*0.46,0,6.2832);
c.arc(x,y-s*0.4,s*0.54,0,6.2832);
c.fillStyle=`rgba(${(84+tone*34)|0},${(96+tone*26)|0},${(56+tone*20)|0},0.72)`;c.fill();
c.strokeStyle='rgba(42,48,28,0.6)';c.lineWidth=Math.max(0.3,s*0.12);c.stroke();}

// Base climate fertility: temperature fitness × moisture bell curve, penalized by elevation
// Temperature fitness uses a COLD GATE (calibrated air-temp scale t=0.60+°C/100):
// near-zero below ~-3°C (short-season high latitudes — far-N Europe, Siberia are
// marginal), full by ~+10°C, broad warm plateau, gentle roll-off in extreme heat.
// Kept in sync with the tCrop bell below. Moisture bell peaks at 0.45.
function tileFert(t,m,e){if(e>0.45)return 0.01;
const tFactor=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);
const mFactor=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));
const base=tFactor*mFactor;
return Math.max(0.01,base*(1-Math.max(0,e-0.15)*3));}

const DIRS=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

function createTerritory(w){
const tw=Math.ceil(w.width/RES),th=Math.ceil(w.height/RES);
const tElev=new Float32Array(tw*th),tTemp=new Float32Array(tw*th),tMoist=new Float32Array(tw*th),tFert=new Float32Array(tw*th);
const tCoast=new Uint8Array(tw*th),tDiff=new Float32Array(tw*th);
// Pass 1: base tile data + climate fertility
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){const px=Math.min(w.width-1,tx*RES),py=Math.min(w.height-1,ty*RES),i=py*w.width+px;
const ti=ty*tw+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti];
const e=w.elevation[i],t=w.temperature[i],m=w.moisture[i];let diff=0;
if(e>0.35)diff=Math.max(diff,Math.min(1,(e-0.35)*3));if(t>0.5&&m<0.2)diff=Math.max(diff,Math.min(0.85,(0.2-m)*3*(t-0.3)));
if(t<0.2)diff=Math.max(diff,Math.min(0.9,(0.2-t)*4));tDiff[ti]=diff;tFert[ti]=tileFert(t,m,e);
// Swamp bonus
{let hasSwamp=false;
for(let dy=0;dy<RES;dy++)for(let dx=0;dx<RES;dx++){
const wi=Math.min(w.height-1,py+dy)*w.width+Math.min(w.width-1,px+dx);
if(w.swamp&&w.swamp[wi])hasSwamp=true;}
if(hasSwamp){tFert[ti]=Math.min(1,tFert[ti]+0.2);tDiff[ti]=Math.min(1,tDiff[ti]+0.25);}}}

// ── River hydrology ──
const rivers=computeRivers(tw,th,tElev,tMoist,tTemp);

// ── River moisture boost: rivers raise local moisture, then fertility recalculates ──
// This is the physically correct approach: rivers bring water → soil moisture rises →
// fertility formula (bell curve) naturally produces good values.
// Biome classification, resources, and all downstream systems react correctly.
const riverMoist=new Float32Array(tw*th);
{// Tributary+ rivers get moisture gradient. Streams are too small for map-scale effect.
const riverRadius=[0,0,1,2,3];// NONE,STREAM,TRIB,MAJOR,GREAT (~21km/tile)
const riverMoistPeak=[0,0,0.25,0.40,0.55];
for(let ti=0;ti<tw*th;ti++){
const mag=rivers.riverMag[ti];if(mag<RIVER_STREAM)continue;
const R=riverRadius[mag],peak=riverMoistPeak[mag];
if(R<1)continue;
const sx=ti%tw,sy=(ti-sx)/tw;
for(let dy=-R;dy<=R;dy++){const ny=sy+dy;if(ny<0||ny>=th)continue;
for(let dx=-R;dx<=R;dx++){const nx=(sx+dx+tw)%tw;
const ni=ny*tw+nx;
if(tElev[ni]<=0)continue;
let ddx=Math.abs(dx);if(ddx>tw/2)ddx=tw-ddx;
const dist=Math.sqrt(ddx*ddx+dy*dy);
if(dist>R)continue;
// Clamp minimum distance so center tile blends with surroundings (no biome spike)
const effDist=Math.max(dist,0.8);
const t2=effDist/R;const falloff=0.5+0.5*Math.cos(t2*Math.PI);
const v=peak*falloff;
riverMoist[ni]=Math.max(riverMoist[ni],v);}}}
// Apply moisture boost and recompute fertility
for(let ti=0;ti<tw*th;ti++){
if(riverMoist[ti]<0.01)continue;
const rm=riverMoist[ti];
const oldMoist=tMoist[ti];
// Cap moisture boost so it approaches but doesn't overshoot the bell curve peak.
// In dry areas: full boost toward 0.50 (near peak).
// In wet areas: minimal boost (land already has water, river just levels terrain).
if(oldMoist<0.45){
tMoist[ti]=Math.min(0.50,oldMoist+rm);
}else{
tMoist[ti]=Math.min(1,oldMoist+rm*0.08);
}
tFert[ti]=tileFert(tTemp[ti],tMoist[ti],tElev[ti]);}}

// ── Lake moisture boost: lakes act as local moisture sources ──
if(rivers.lake){
const lakeRadius=3;const lakeMoistPeak=0.20;
for(let ti=0;ti<tw*th;ti++){
if(rivers.lake[ti]<0)continue;
const sx=ti%tw,sy=(ti-sx)/tw;
for(let dy=-lakeRadius;dy<=lakeRadius;dy++){const ny=sy+dy;if(ny<0||ny>=th)continue;
for(let dx=-lakeRadius;dx<=lakeRadius;dx++){const nx=(sx+dx+tw)%tw;
const ni=ny*tw+nx;
if(tElev[ni]<=0||rivers.lake[ni]>=0)continue;// skip ocean and other lake tiles
let ddx=Math.abs(dx);if(ddx>tw/2)ddx=tw-ddx;
const dist=Math.sqrt(ddx*ddx+dy*dy);
if(dist>lakeRadius)continue;
const effDist=Math.max(dist,0.8);
const falloff=0.5+0.5*Math.cos(effDist/lakeRadius*Math.PI);
const boost=lakeMoistPeak*falloff;
const oldM=tMoist[ni];
if(oldM<0.45){tMoist[ni]=Math.min(0.50,oldM+boost);}
else{tMoist[ni]=Math.min(1,oldM+boost*0.08);}
tFert[ni]=tileFert(tTemp[ni],tMoist[ni],tElev[ni]);}}}
// Lake tiles themselves: water, not land — zero fertility, impassable
for(let ti=0;ti<tw*th;ti++){
if(rivers.lake[ti]>=0){tMoist[ti]=0.8;tFert[ti]=0;tDiff[ti]=1.0;}}}

// ── Pass 2: Geological fertility modifiers ──
// These require neighbor access so run after base pass.

// 2a: Tropical soil penalty — laterite soils in hot wet regions are nutrient-poor.
// The Amazon/Congo paradox: lush forest but terrible soil for agriculture.
// Exception: river floodplains have fresh alluvial silt, not leached laterite.
for(let ti=0;ti<tw*th;ti++){
const t=tTemp[ti],m=tMoist[ti],e=tElev[ti];
if(e<=0)continue;
if(t>0.65&&m>0.50){
const tropicality=Math.min(1,(t-0.65)/0.25)*Math.min(1,(m-0.50)/0.35);
// River floodplains resist laterization: fresh silt replaces leached soil annually
const riverProtect=riverMoist[ti]>0.01?Math.min(0.8,riverMoist[ti]*2.5):0;
tFert[ti]*=(1-tropicality*0.55*(1-riverProtect));}}

// 2b: Temperate grassland bonus — chernozem/mollisol deep topsoil.
// Moderate temp, moderate moisture, low elevation = breadbasket zones.
for(let ti=0;ti<tw*th;ti++){
const e=tElev[ti],t=tTemp[ti],m=tMoist[ti];
if(e<=0||e>0.15)continue;
// Temperate sweet spot: not too hot, not too cold
const tempFit=Math.exp(-((t-0.45)*(t-0.45))/(2*0.10*0.10));// peak at t=0.45
// Semi-arid to moderate moisture: grassland/steppe zone (not forest, not desert)
const moistFit=Math.exp(-((m-0.28)*(m-0.28))/(2*0.10*0.10));// peak at m=0.28
const bonus=tempFit*moistFit*0.30;// up to +30%
if(bonus>0.02)tFert[ti]=Math.min(1,tFert[ti]+tFert[ti]*bonus);}

// 2d: Volcanic soil bonus — near plate boundaries in tectonic mode.
// Andisols from volcanic ash are mineral-rich, excellent for agriculture.
// bDist (plate-boundary distance) is also exposed to Pass 3's tCrop
// so the tropical penalty can spare young volcanic / orogenic tropical
// regions (Java, Mekong, Ganges) that escape Amazon-style lateritic
// soil leaching.
let bDist=null;
if(w.pixPlate){const W=w.width,H=w.height;
// Build a plate-boundary distance map at tile resolution
const plateBound=new Uint8Array(tw*th);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES);
const myP=w.pixPlate[py*W+px];let isBoundary=false;
for(const[dx,dy]of DIRS){const nx2=Math.min(W-1,Math.max(0,px+dx*RES)),ny2=Math.min(H-1,Math.max(0,py+dy*RES));
if(w.pixPlate[ny2*W+nx2]!==myP){isBoundary=true;break;}}
if(isBoundary)plateBound[ty*tw+tx]=1;}
// Expand boundary influence: BFS to get distance from plate boundaries.
// Radius 15 so tCrop can see "near-orogenic" regions far enough inland
// to cover Ganges plain / Indochina interior; volcanic bonus still
// gates itself at <7 so its behavior is unchanged.
bDist=new Uint8Array(tw*th);bDist.fill(255);
const bdQ=[];
for(let i=0;i<tw*th;i++)if(plateBound[i]&&tElev[i]>0){bDist[i]=0;bdQ.push(i);}
for(let qi=0;qi<bdQ.length;qi++){const ci=bdQ[qi],cd=bDist[ci],cx=ci%tw,cy=(ci-cx)/tw;
if(cd>=15)continue;// max 15-tile influence radius
for(const[dx,dy]of DIRS){const nx=(cx+dx+tw)%tw,ny=cy+dy;if(ny<0||ny>=th)continue;
const ni=ny*tw+nx;if(bDist[ni]<=cd+1||tElev[ni]<=0)continue;
bDist[ni]=cd+1;bdQ.push(ni);}}
// Apply volcanic bonus: strongest at boundary, decays with distance
for(let ti=0;ti<tw*th;ti++){if(bDist[ti]>=7||tElev[ti]<=0)continue;
// Only apply where there's enough moisture for agriculture
if(tMoist[ti]<0.15)continue;
const proximity=1-bDist[ti]/7;// 1.0 at boundary, 0 at distance 7
// Mountains near boundaries get less bonus (already high elevation)
const elevPenalty=tElev[ti]>0.25?Math.max(0,1-(tElev[ti]-0.25)*4):1;
const bonus=proximity*elevPenalty*0.40;// up to +40%
tFert[ti]=Math.min(1,tFert[ti]+tFert[ti]*bonus);}}

// 2e: Coastal fertility bonus — fishing, salt, trade access.
for(let ti=0;ti<tw*th;ti++){
if(tCoast[ti]&&tElev[ti]>0)tFert[ti]=Math.min(1,tFert[ti]+0.06);}

// ── Pass 3: Analytical overlays (Crop suitability + Crossing difficulty) ──
// Two derived maps the user can toggle to inspect *why* settlements
// behave where they do. Stored separately from tFert so the sim's
// food-production math is untouched.
//
// tCrop — agronomic crop potential (primitive-tech baseline).
//   Differs from tFert:
//     - tighter moisture window (crops dislike waterlogging more than
//       biomass does — chernozem semi-humid > rainforest)
//     - HARDER tropical lateritic penalty (×0.25 at the rainforest
//       core, vs ×0.45 in tFert). The Amazon/Congo paradox writ large.
//     - hill / upland penalty (terracing without construction tech).
//   Temperate forest zones still rate high — they ARE prime cropland,
//   the clearing cost is a transport/construction issue handled
//   elsewhere, not an inherent crop-quality issue.
//
// tCross — average per-edge crossing cost across the 4 land
//   neighbours, using the same continuous baseEdgeCost as the sim's
//   transport map (peopleSim/transport.js). The slope component is
//   real — climbing a steep face costs more than walking a flat
//   plateau even at the same absolute elevation — so the rendered
//   gradient varies continuously rather than stair-stepping at the
//   old e=0.20 / e=0.35 thresholds. Normalized against CROSS_MAX so
//   most land falls in the visible mid-range; rivers / coast push to
//   the easy end, peaks + cold / peaks + desert sit at the brutal end.
const tCrop=new Float32Array(tw*th);
const tCross=new Float32Array(tw*th);
// Normalisation ceiling. With the wider cost spread, typical land
// reads between ~1.0 (plains) and ~6 (mid-mountains); peaks + climb
// can hit 12+. CROSS_MAX=6 maps that into the full green→yellow→red
// gradient — plains stay bright green, hills go yellow, real
// mountains hit red.
const CROSS_MAX=6.0;
const crossWorld={elev:tElev,temp:tTemp,moist:tMoist,coast:tCoast,
                  riverMag:rivers&&rivers.riverMag?rivers.riverMag:null};
for(let ti=0;ti<tw*th;ti++){
const e=tElev[ti],t=tTemp[ti],m=tMoist[ti];
if(e<=0){tCrop[ti]=0;tCross[ti]=1;continue;}
// Crop suitability. Temperature is now calibrated to real annual-mean air temp
// (t = 0.60 + °C/100, see tools/probe_temperature.mjs), so the optimum is a
// realistic agricultural band rather than the old wide bell (which, tuned to the
// previous hot scale, peaked in the cold and wrongly rated far-northern Europe /
// Siberia as prime farmland). A COLD GATE rules out short-season high latitudes
// (annual mean below ~-3°C ≈ 0; rising to full suitability by ~+10°C), then a
// broad warm plateau (temperate breadbaskets → subtropics → watered tropics)
// with only a gentle roll-off in extreme heat. Hot-wet laterite and aridity are
// handled by the moisture bell + penalties below.
tCrop[ti]=cropSuitability(t,m,e,tCoast[ti],rivers&&rivers.riverMag?rivers.riverMag[ti]:0,bDist?bDist[ti]:null);
// Crossing difficulty: average edge cost from each land neighbour
// into this tile. Edge-based so slope shows up; averaged so the
// overlay is direction-agnostic.
const ty=(ti/tw)|0,tx=ti-ty*tw;
const left=ty*tw+(tx===0?tw-1:tx-1);
const right=ty*tw+(tx===tw-1?0:tx+1);
const up=ty>0?(ty-1)*tw+tx:-1;
const down=ty<th-1?(ty+1)*tw+tx:-1;
let csum=0,cnt=0;
const nbrs=[left,right,up,down];
for(let k=0;k<4;k++){
const ni=nbrs[k];
if(ni<0)continue;
if(tElev[ni]<=0)continue;// approach across water doesn't count
const c=baseEdgeCost(crossWorld,ni,ti);
if(c===Infinity)continue;
csum+=c;cnt++;}
const cAvg=cnt>0?csum/cnt:1.0;
tCross[ti]=Math.min(1,cAvg/CROSS_MAX);}

// ── Natural resource deposits ──
const deposits=generateResources(tw,th,tElev,tTemp,tMoist,tCoast,w,w._seed||0,rivers);
// (The legacy tribe-seeding / background-population layer that lived here —
// valley scoring, bgPop/cityPop, tribe knowledge/budget/port/coast tables —
// was removed with the tribe system itself: the peopleSim worker owns ALL
// population now, and the views that read those static estimates are gone.)
return{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,tCrop,tCross,deposits,rivers,stepCount:0};}

// ── Calendar: a steady step-based clock, anchored so the era ladder lands on real
// history. The sim seeds Neolithic farming cradles holding STONE tools — that is
// ~9000 BC, not 2000 BC (when the real cradles were already bronze-age cities with
// writing), so the long Stone/Neolithic opening spans the most calendar time even
// though little changes, then the clock accelerates as the eras shorten, the way
// history actually ran. YEAR_ANCHORS map peopleSim step → year (negative = BC,
// positive = AD): on the reference world the leading civilisation reaches each era
// near the step listed (measured against the current tech pace, not guessed).
// CLOCK_STRETCH is a manual fine-tune. The clock tracks the LEADING civilisation,
// which develops at roughly the same per-step rate regardless of map size (only the
// periphery lags on a big map), so ≈1.0 fits most worlds. Nudge it only if the
// displayed year drifts from your tech: raise it if the year runs AHEAD of the tech,
// lower it if BEHIND.
const CLOCK_STRETCH = 1.0;
const PRESENT_YEAR  = 2025;
const YEAR_ANCHORS = [   // [reference step, year]
  [0,     -9000],   // Stone / Neolithic — cradles seeded with stone tools
  [4000,  -3300],   // Bronze — first cities, the wheel, writing
  [8500,   -500],   // Classical / Iron Age
  [10000,   900],   // Medieval
  [13000,  1500],   // Renaissance
  [18000,  1800],   // Industrial
  [22000,  1950],   // Modern
];
function stepToYear(step){
  const A=YEAR_ANCHORS, n=A.length, s=step/CLOCK_STRETCH;
  if(s<=0)return A[0][1];
  for(let i=1;i<n;i++){
    if(s<=A[i][0]){
      const [s0,y0]=A[i-1], [s1,y1]=A[i];
      return y0+(y1-y0)*(s-s0)/(s1-s0);
    }
  }
  // Past the last era anchor: keep advancing at the final (modern) rate up to the
  // present day, then clamp — we date history, not the future.
  const [sp,yp]=A[n-2], [sl,yl]=A[n-1];
  return Math.min(PRESENT_YEAR, yl+(yl-yp)/(sl-sp)*(s-sl));
}
function yearStr(step){const y=Math.round(stepToYear(step));
return y<0?`${-y} BC`:`${y} AD`;}

// ── Transport TEST: standalone greedy claim by capital cost ──────────
// Independent of the live sim. Each "test capital" runs a Dijkstra that
// expands through:
//   - land (cost from params, terrain-modulated)
//   - water (cost / nav, only if nav > 0)
//   - mode-change transitions pay a port-load cost on top of the next
//     tile's cost
// Tiles are claimed by whichever capital reaches them at lowest cost,
// until each capital has hit tileLimit. Returns {cost, ownerArr} where
// ownerArr[ti] is the index of the capital that claimed it (or -1).
function runTransportTest(ter, capitals, params){
  const tw=ter.tw,th=ter.th,N=tw*th;
  const tElev=ter.tElev,tDiff=ter.tDiff,tCoast=ter.tCoast,tTemp=ter.tTemp,tMoist=ter.tMoist;
  const riverMag=ter.rivers?ter.rivers.riverMag:null;
  const cost=new Float32Array(N);cost.fill(999);
  const ownerArr=new Int16Array(N);ownerArr.fill(-1);
  const visited=new Uint8Array(N);
  const claimed=new Int32Array(capitals.length);
  const TILE_LIMIT=params.tileLimit;
  // Deterministic per-tile noise (xorshift-style hash on tile index).
  // Used to perturb costs so borders aren't perfectly Voronoi-straight in
  // flat terrain. Deterministic so the BFS is stable across runs.
  function tileNoise(ti){
    let h=(ti+0x9E3779B9)|0;
    h^=h>>>15;h=Math.imul(h,2246822519);
    h^=h>>>13;h=Math.imul(h,3266489917);
    h^=h>>>16;
    return ((h>>>0)/4294967295);// 0..1
  }
  function modeOf(ti){
    const e=tElev[ti];
    if(e<=0)return 2;
    if(riverMag&&riverMag[ti]>=2)return 1;
    return 0;
  }
  function moveCost(ni,ciMode,ciElev){
    const niMode=modeOf(ni);
    let base;
    if(niMode===2){
      if(params.nav<=0.01)return 999;
      base=params.water/Math.max(0.3,params.nav);
    }else if(niMode===1){
      const rm=riverMag[ni];
      base=rm>=4?params.river:rm>=3?params.river*1.3:params.river*2;
    }else{
      const e=tElev[ni],diff=tDiff[ni],t=tTemp[ni],m=tMoist[ni];
      base=params.plain;
      if(e>0.25)base+=(e-0.25)*params.elev;
      base+=diff*diff*params.harsh;
      if(t>0.55&&m<0.25)base+=(t-0.55)*5+(0.25-m)*4;
      if(t<0.18)base+=(0.18-t)*8;
      if(m>0.7&&t>0.4)base+=(m-0.7)*6;
      if(tCoast[ni])base=Math.min(base,params.coast);
      if(ciElev>0){
        const slope=Math.abs(e-ciElev);
        if(slope>0.05)base+=(slope-0.05)*params.slope;
      }
    }
    if(niMode!==ciMode)base+=params.port;
    // Deterministic noise perturbation — scales cost by (1 ± noise/2).
    // At noise=0.3 each tile is between 0.85x and 1.15x its base cost.
    if(params.noise>0){
      base*=(1+(tileNoise(ni)-0.5)*params.noise);
    }
    return base;
  }
  // Heap (ti, cost, tribe) as parallel arrays
  const heapTi=new Int32Array(N*2);
  const heapCost=new Float32Array(N*2);
  const heapTribe=new Int16Array(N*2);
  let heapSize=0;
  function hPush(ti,c,t){
    let i=heapSize++;
    heapTi[i]=ti;heapCost[i]=c;heapTribe[i]=t;
    while(i>0){const p=(i-1)>>1;if(heapCost[p]<=heapCost[i])break;
      const tt=heapTi[p],tc=heapCost[p],tb=heapTribe[p];
      heapTi[p]=heapTi[i];heapCost[p]=heapCost[i];heapTribe[p]=heapTribe[i];
      heapTi[i]=tt;heapCost[i]=tc;heapTribe[i]=tb;i=p;}
  }
  let _ti=0,_cost=0,_tribe=0;
  function hPop(){
    _ti=heapTi[0];_cost=heapCost[0];_tribe=heapTribe[0];
    heapSize--;
    if(heapSize===0)return;
    heapTi[0]=heapTi[heapSize];heapCost[0]=heapCost[heapSize];heapTribe[0]=heapTribe[heapSize];
    let i=0;for(;;){const l=i*2+1,r=l+1;let s=i;
      if(l<heapSize&&heapCost[l]<heapCost[s])s=l;
      if(r<heapSize&&heapCost[r]<heapCost[s])s=r;
      if(s===i)break;
      const tt=heapTi[s],tc=heapCost[s],tb=heapTribe[s];
      heapTi[s]=heapTi[i];heapCost[s]=heapCost[i];heapTribe[s]=heapTribe[i];
      heapTi[i]=tt;heapCost[i]=tc;heapTribe[i]=tb;i=s;}
  }
  const DX4=[-1,1,0,0],DY4=[0,0,-1,1];
  // Seed each capital
  for(let i=0;i<capitals.length;i++){
    const c=capitals[i];const ti=c.y*tw+c.x;
    if(ti<0||ti>=N||tElev[ti]<=0)continue;// can't seed in water
    hPush(ti,0,i);
  }
  let totalClaimed=0;
  const totalTarget=capitals.length*TILE_LIMIT;
  while(heapSize>0&&totalClaimed<totalTarget){
    hPop();
    const ti=_ti,cc=_cost,tribe=_tribe;
    if(visited[ti])continue;
    if(claimed[tribe]>=TILE_LIMIT)continue;
    visited[ti]=1;
    ownerArr[ti]=tribe;
    cost[ti]=cc;
    claimed[tribe]++;totalClaimed++;
    const cx=ti%tw,cy=(ti-cx)/tw;
    const ciMode=modeOf(ti);
    const ciElev=tElev[ti];
    for(let d=0;d<4;d++){
      const nx=((cx+DX4[d])%tw+tw)%tw,ny=cy+DY4[d];
      if(ny<0||ny>=th)continue;
      const ni=ny*tw+nx;
      if(visited[ni])continue;
      const mc=moveCost(ni,ciMode,ciElev);
      if(mc>=999)continue;
      hPush(ni,cc+mc,tribe);
    }
  }
  return{cost,ownerArr,claimed};
}

// Find the cheapest path between two tile coordinates using the same
// cost function as runTransportTest. Returns {path: [tileIndices...],
// totalCost} or null if no path exists. Used by the "route" sub-mode
// in the transport-test view.
function findRoute(ter, startTile, endTile, params){
  const tw=ter.tw,th=ter.th,N=tw*th;
  const tElev=ter.tElev,tDiff=ter.tDiff,tCoast=ter.tCoast,tTemp=ter.tTemp,tMoist=ter.tMoist;
  const riverMag=ter.rivers?ter.rivers.riverMag:null;
  const cost=new Float32Array(N);cost.fill(Infinity);
  const parent=new Int32Array(N);parent.fill(-1);
  const visited=new Uint8Array(N);
  function tileNoise(ti){
    let h=(ti+0x9E3779B9)|0;
    h^=h>>>15;h=Math.imul(h,2246822519);
    h^=h>>>13;h=Math.imul(h,3266489917);
    h^=h>>>16;return ((h>>>0)/4294967295);
  }
  function modeOf(ti){
    const e=tElev[ti];
    if(e<=0)return 2;
    if(riverMag&&riverMag[ti]>=2)return 1;
    return 0;
  }
  function moveCost(ni,ciMode,ciElev){
    const niMode=modeOf(ni);
    let base;
    if(niMode===2){
      if(params.nav<=0.01)return Infinity;
      base=params.water/Math.max(0.3,params.nav);
    }else if(niMode===1){
      const rm=riverMag[ni];
      base=rm>=4?params.river:rm>=3?params.river*1.3:params.river*2;
    }else{
      const e=tElev[ni],diff=tDiff[ni],t=tTemp[ni],m=tMoist[ni];
      base=params.plain;
      if(e>0.25)base+=(e-0.25)*params.elev;
      base+=diff*diff*params.harsh;
      if(t>0.55&&m<0.25)base+=(t-0.55)*5+(0.25-m)*4;
      if(t<0.18)base+=(0.18-t)*8;
      if(m>0.7&&t>0.4)base+=(m-0.7)*6;
      if(tCoast[ni])base=Math.min(base,params.coast);
      if(ciElev>0){
        const slope=Math.abs(e-ciElev);
        if(slope>0.05)base+=(slope-0.05)*params.slope;
      }
    }
    if(niMode!==ciMode)base+=params.port;
    if(params.noise>0)base*=(1+(tileNoise(ni)-0.5)*params.noise);
    return base;
  }
  const heapTi=new Int32Array(N*2);
  const heapCost=new Float32Array(N*2);
  let heapSize=0;
  function hPush(ti,c){
    let i=heapSize++;heapTi[i]=ti;heapCost[i]=c;
    while(i>0){const p=(i-1)>>1;if(heapCost[p]<=heapCost[i])break;
      const tt=heapTi[p],tc=heapCost[p];
      heapTi[p]=heapTi[i];heapCost[p]=heapCost[i];
      heapTi[i]=tt;heapCost[i]=tc;i=p;}
  }
  let _ti=0,_cost=0;
  function hPop(){
    _ti=heapTi[0];_cost=heapCost[0];heapSize--;
    if(heapSize===0)return;
    heapTi[0]=heapTi[heapSize];heapCost[0]=heapCost[heapSize];
    let i=0;for(;;){const l=i*2+1,r=l+1;let s=i;
      if(l<heapSize&&heapCost[l]<heapCost[s])s=l;
      if(r<heapSize&&heapCost[r]<heapCost[s])s=r;
      if(s===i)break;
      const tt=heapTi[s],tc=heapCost[s];
      heapTi[s]=heapTi[i];heapCost[s]=heapCost[i];
      heapTi[i]=tt;heapCost[i]=tc;i=s;}
  }
  const DX4=[-1,1,0,0],DY4=[0,0,-1,1];
  const startTi=startTile.y*tw+startTile.x;
  const endTi=endTile.y*tw+endTile.x;
  if(startTi<0||startTi>=N||endTi<0||endTi>=N)return null;
  cost[startTi]=0;
  hPush(startTi,0);
  while(heapSize>0){
    hPop();const ti=_ti,cc=_cost;
    if(visited[ti])continue;
    visited[ti]=1;
    if(ti===endTi)break;
    if(cc>cost[ti])continue;
    const cx=ti%tw,cy=(ti-cx)/tw;
    const ciMode=modeOf(ti);
    const ciElev=tElev[ti];
    for(let d=0;d<4;d++){
      const nx=((cx+DX4[d])%tw+tw)%tw,ny=cy+DY4[d];
      if(ny<0||ny>=th)continue;
      const ni=ny*tw+nx;
      if(visited[ni])continue;
      const mc=moveCost(ni,ciMode,ciElev);
      if(!isFinite(mc))continue;
      const newCost=cc+mc;
      if(newCost<cost[ni]){
        cost[ni]=newCost;
        parent[ni]=ti;
        hPush(ni,newCost);
      }
    }
  }
  if(!visited[endTi])return null;
  const path=[];
  let cur=endTi;let safety=N;
  while(cur>=0&&safety-->0){
    path.push(cur);
    if(cur===startTi)break;
    cur=parent[cur];
  }
  if(cur!==startTi)return null;
  return{path,totalCost:cost[endTi]};
}

// ── Display units (peopleSim) ───────────────────────────────────────
// The sim runs on compact internal units; these scale them to realistic,
// human-readable figures at the DISPLAY layer ONLY — the simulation math is
// untouched. One sim-"person" ≈ POP_SCALE real people (the map labels already
// assumed this convention); food is shown as a mass of grain; wealth as a mass
// of gold. Tweak these three to taste.
const POP_SCALE        = 1000;   // sim pop → people: metropolis ~3.4M, city ~1.2M, town ~250k, village ~25k
const FOOD_KG_PER_UNIT = 1000;   // one sim food unit → kg of grain (1 unit = 1 tonne)
const GOLD_G_PER_COIN  = 8;      // one sim coin → grams of gold (a gold ducat ≈ 3.5g; 8g keeps treasuries legible)
const HISTORY_INTERVAL = 100;    // sim steps between History-chart samples

// Compact number: 1234 → "1.2k", 3_400_000 → "3.4M", 2.1e9 → "2.1B".
function fmtNum(n){
  const s=n<0?"-":""; const a=Math.abs(n);
  if(a>=1e9)return s+(a/1e9).toFixed(1)+"B";
  if(a>=1e6)return s+(a/1e6).toFixed(a>=1e7?0:1)+"M";
  if(a>=1e3)return s+(a/1e3).toFixed(a>=1e4?0:1)+"k";
  return s+Math.round(a).toString();
}
// Mass in kilograms → grams / kg / tonnes / kilotonnes.
function fmtMass(kg){
  const s=kg<0?"-":""; const a=Math.abs(kg);
  if(a>=1e6)return s+(a/1e6).toFixed(1)+" kt";
  if(a>=1e3)return s+(a/1e3).toFixed(a>=1e4?0:1)+" t";
  if(a>=1)return s+(a>=100?Math.round(a):a.toFixed(1))+" kg";
  return s+Math.round(a*1000)+" g";
}
// People — scale sim population to real people.
function fmtPeople(p){ return fmtNum((p||0)*POP_SCALE); }
// Food (grain) shown as a mass.
function fmtFood(simFood){ return fmtMass((simFood||0)*FOOD_KG_PER_UNIT); }
// Wealth shown as a mass of gold.
function fmtGoldKg(simCoin){ return fmtMass((simCoin||0)*GOLD_G_PER_COIN/1000); }

// ── History charts ──────────────────────────────────────────────────
// One metric over sim-steps as a small SVG line chart (the History panel).
function MiniChart({data,get,label,color,fmtY}){
  const W=300,H=54,padL=3,padR=3,padT=2,padB=8;
  if(!data||data.length<2)
    return <div style={{padding:"5px 10px"}}><div className="au-sc au-fade" style={{fontSize:9}}>{label}</div><div className="au-fade" style={{fontSize:10,fontStyle:"italic"}}>gathering data…</div></div>;
  let yMin=Infinity,yMax=-Infinity;
  for(const d of data){const v=get(d);if(v<yMin)yMin=v;if(v>yMax)yMax=v;}
  if(!(yMax>yMin))yMax=yMin+1;
  const x0=data[0].step,x1=data[data.length-1].step,dx=Math.max(1,x1-x0);
  const sx=v=>padL+(W-padL-padR)*((v-x0)/dx);
  const sy=v=>padT+(H-padT-padB)*(1-(v-yMin)/(yMax-yMin));
  let pts="";
  for(const d of data)pts+=sx(d.step).toFixed(1)+","+sy(get(d)).toFixed(1)+" ";
  const cur=get(data[data.length-1]);
  return(
    <div style={{padding:"3px 10px 6px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
        <span className="au-sc au-fade" style={{fontSize:9}}>{label}</span>
        <span style={{fontSize:11,fontWeight:600,color}}>{fmtY(cur)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{width:"100%",height:H,display:"block"}}>
        <polyline points={pts.trim()} fill="none" stroke={color} strokeWidth={1.3} vectorEffect="non-scaling-stroke"/>
      </svg>
      <div style={{display:"flex",justifyContent:"space-between"}}>
        <span className="au-fade" style={{fontSize:8}}>{fmtY(yMin)}</span>
        <span className="au-fade" style={{fontSize:8}}>peak {fmtY(yMax)}</span>
      </div>
    </div>);
}
// Copyable markdown rundown of the run so far (downsampled to ~40 rows).
function buildHistoryExport(H){
  if(!H||!H.length)return "No history yet — let the simulation run for a while, then copy again.";
  const N=H.length,stride=Math.max(1,Math.ceil(N/40)),rows=[];
  for(let i=0;i<N;i+=stride)rows.push(H[i]);
  if(rows[rows.length-1]!==H[N-1])rows.push(H[N-1]);
  const head="| step | population | gold | land % | countries | settlements | villages | towns | cities | metros | largest empire (tiles) | army |";
  const sep ="|---|---|---|---|---|---|---|---|---|---|---|---|";
  const body=rows.map(r=>`| ${r.step} | ${fmtPeople(r.pop)} | ${fmtGoldKg(r.gold)} | ${(r.landPct*100).toFixed(0)}% | ${r.countries} | ${r.sett} | ${r.villages} | ${r.towns} | ${r.cities} | ${r.metros} | ${r.largest} | ${fmtPeople(r.army)} |`).join("\n");
  return `Simman — global stats over time (display units: 1 sim-person = ${POP_SCALE} people; gold by weight; land % of all land)\n\n${head}\n${sep}\n${body}`;
}

// ── Settlement-card presentational components ──
// Defined at module scope (stable identities) so they are NOT redefined
// every WorldSim render. The card re-renders several times a second while
// the sim plays; if these lived inside the render, React would treat them
// as new component types each time and tear down + rebuild their DOM —
// causing flicker and making the collapsible headers flaky to click.
function PsBar({ v, color }) {
  return (
    <div style={{ position:"relative", height:5, background:"rgba(0,0,0,0.15)", borderRadius:2, marginTop:1 }}>
      <div style={{ position:"absolute", inset:0, width:`${Math.max(0,Math.min(1,v))*100}%`, background:color||"#7a5", borderRadius:2 }} />
    </div>
  );
}
function PsKRow({ label, val, colour, note }) {
  return (
    <div style={{ margin:"3px 0" }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10 }}>
        <span>{label}{note ? <span className="au-fade" style={{ marginLeft:4, fontSize:9 }}>{note}</span> : null}</span>
        <span>{(val*100|0)}%</span>
      </div>
      <PsBar v={val} color={colour} />
    </div>
  );
}
function PsSection({ id, title, right, open, onToggle, children }) {
  return (
    <div style={{ marginTop:6, borderTop:"1px solid rgba(0,0,0,0.10)", paddingTop:5 }}>
      <div onClick={(e)=>{ e.stopPropagation(); onToggle(id); }} className="au-fade"
        style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", userSelect:"none", fontSize:10, letterSpacing:0.4, textTransform:"uppercase" }}>
        <span>{open ? "▾" : "▸"} {title}</span>
        {right!=null && <span style={{ textTransform:"none", letterSpacing:0 }}>{right}</span>}
      </div>
      {open && <div style={{ marginTop:4 }}>{children}</div>}
    </div>
  );
}

// ── SINGLE CANVAS: terrain + overlay composited together ──
export default function WorldSim(){
const canvasRef=useRef(null);
const[seed,setSeed]=useState(8817);const[world,setWorld]=useState(null);
const[playing,setPlaying]=useState(false);const[speed,setSpeed]=useState(5);
const[viewMode,setViewMode]=useState("terrain");const[preset,setPreset]=useState("tectonic");
// Transport-test mode state. Each click in this view places a capital;
// the BFS re-runs whenever params or capitals change.
const[ttCapitals,setTtCapitals]=useState([]);
// Transport-test cost model — RAW per-terrain / per-mode travel costs, dialed
// DIRECTLY. This view exposes the EXACT cost of each tile/terrain type and of
// the mode changes, instead of abstract tech points:
//   plain    flat land, per tile
//   rough    rough-terrain coefficient (× slope-variance²)
//   mountain elevation penalty coefficient (above e=0.25)
//   slope    per-step climb penalty coefficient
//   river    moving ALONG a river (mag≥4; mag-3 ×1.3, mag-2 ×2)
//   coast    hugging a coastline
//   water    crossing open SEA, per tile ("sea passable" off ⇒ impassable)
//   port     MODE CHANGE — the tax to step on/off water, or land↔river
const[ttCost,setTtCost]=useState({
  tileLimit:6000, plain:0.95, rough:14, mountain:6, slope:8,
  river:0.35, coast:0.5, water:3.5, port:5, seaPassable:true,
});
// The BFS reads these raw costs straight (no tech derivation). nav is just the
// on/off switch for sea travel; water carries the actual per-tile sea cost.
const ttParams={
  tileLimit:ttCost.tileLimit, plain:ttCost.plain, harsh:ttCost.rough,
  elev:ttCost.mountain, slope:ttCost.slope, river:ttCost.river, coast:ttCost.coast,
  water:ttCost.seaPassable?ttCost.water:999, nav:ttCost.seaPassable?1:0,
  port:ttCost.port, noise:0,
};
const ttResultRef=useRef(null);
const ttCapitalsRef=useRef([]);
// Sub-mode: "capitals" places tribe seeds and runs claim BFS;
// "route" places two endpoints and shows the cheapest path between them.
const[ttSubMode,setTtSubMode]=useState("capitals");
const[ttRoute,setTtRoute]=useState({start:null,end:null});
const ttRouteResultRef=useRef(null);
useEffect(()=>{ttCapitalsRef.current=ttCapitals;
  // Re-run BFS whenever capitals or tech change AND we're in test mode
  if(viewMode!=="transport-test"){ttResultRef.current=null;return;}
  if(!terRef.current||ttCapitals.length===0){ttResultRef.current=null;
    if(terRef.current)draw(terRef.current);return;}
  ttResultRef.current=runTransportTest(terRef.current,ttCapitals,ttParams);
  draw(terRef.current);
},[ttCapitals,ttCost,viewMode]);
const[depthFromSea,setDepthFromSea]=useState(false);
const[depthCeil,setDepthCeil]=useState(1.0);
const[showPlates,setShowPlates]=useState(false);
const[showRivers,setShowRivers]=useState(false);
const[showStreams,setShowStreams]=useState(false);
const[showLakes,setShowLakes]=useState(false);
const[importStatus,setImportStatus]=useState(null);
const[hoverInfo,setHoverInfo]=useState(null);
const[tecPresetName,setTecPresetName]=useState("Default");
const[rightPanel,setRightPanel]=useState("");  // "" | "params" | "tribes"
const[showTuning,setShowTuning]=useState(false);
// peopleSim settlement selection — id of the clicked settlement, or -1.
const[selectedSettlementId,setSelectedSettlementId]=useState(-1);
const[techTreeOpen,setTechTreeOpen]=useState(false);   // full tech-tree overlay (for the selected settlement)
const[chronicleOpen,setChronicleOpen]=useState(false); // full chronicle (realm history) overlay
// Ref mirror so draw() (memoized) sees the current selection without
// needing the state in its dep list.
const selectedSettlementIdRef=useRef(-1);
useEffect(()=>{selectedSettlementIdRef.current=selectedSettlementId;},[selectedSettlementId]);
// ── Layer visibility ────────────────────────────────────────────────
// All toggles for what gets drawn on the peopleSim view. Tier toggles
// independently hide villages / towns / cities / metropolises; the road
// overlay also respects them (links with both endpoints in a hidden tier
// drop out). Stored as a single state object so the panel can edit it
// declaratively; mirrored to a ref so draw() (memoized) reads current
// values without needing them in its deps.
const[layers,setLayers]=useState({
  icons:true, tints:true, borders:true, provinces:false, roads:true, seaLanes:true,
  moneyFlow:true, ships:true, shocks:true,
  village:true, town:true, city:true, metropolis:true,
});
const[layersOpen,setLayersOpen]=useState(false);
const[boardOpen,setBoardOpen]=useState(false);
const[leversOpen,setLeversOpen]=useState(false);
const[tuneVals,setTuneVals]=useState(()=>tuningDefaults());
const tuneValsRef=useRef(tuneVals);
// Push a tuning change to the sim. Covers BOTH execution paths: postMessage to
// the worker (normal) and a direct applyTuning for the main-thread fallback sim.
const pushTune=useCallback((vals,reset)=>{
  if(reset){resetTuning();}
  applyTuning(vals);
  if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'tune',values:vals,reset:!!reset});
},[]);
const onLeverChange=useCallback((key,val)=>{
  setTuneVals(prev=>{const next={...prev,[key]:val};tuneValsRef.current=next;return next;});
  pushTune({[key]:val});
},[pushTune]);
const onLeverResetKey=useCallback((key)=>{
  const def=tuningDefaults()[key];
  setTuneVals(prev=>{const next={...prev,[key]:def};tuneValsRef.current=next;return next;});
  pushTune({[key]:def});
},[pushTune]);
const onLeverResetAll=useCallback(()=>{
  const def=tuningDefaults();tuneValsRef.current=def;setTuneVals(def);
  pushTune(def,true);
},[pushTune]);
const[boardMode,setBoardMode]=useState("countries");   // "countries" | "settlements"
const[boardSort,setBoardSort]=useState("size");        // see SORT_KEYS below
const layersRef=useRef(layers);
useEffect(()=>{layersRef.current=layers;},[layers]);
// Country view: live per-country hue assignment (seeded by the previous solve so
// colours drift smoothly as borders shift). Map: countryId → hue 0..360.
const countryColorsRef=useRef(new Map());
// Which collapsible sections of the settlement card are open. Persists
// across re-renders (the card re-renders every few ticks) and across
// selecting different settlements.
const[psCardOpen,setPsCardOpen]=useState({food:true,tech:true,knowledge:false,resources:false,trade:true,chronicle:true});
const togglePsCard=id=>setPsCardOpen(o=>({...o,[id]:!o[id]}));
const[useRealWind,setUseRealWind]=useState(false);
const useMercator=false;
const[showGlobe,setShowGlobe]=useState(false);
const[globeBuf,setGlobeBuf]=useState(null);
const[globeVer,setGlobeVer]=useState(0);          // bumps when the (reused) globe buffer's contents changed
const globeBufScratchRef=useRef(null);            // the one 25MB texture buffer, reused across rebuilds
const globeStampRef=useRef(0);                    // last globe rebuild time (throttle)
const[globeTexSize,setGlobeTexSize]=useState({w:4096,h:2048});
const CH=useMercator?CH_MERC:CH_FLAT;
_mercator=useMercator;
const[activeRes,setActiveRes]=useState(()=>{const s={};for(const r of RESOURCES)s[r.id]=true;return s;});
const[keyOpen,setKeyOpen]=useState(true);
useEffect(()=>{
  // On mouse-up, clear any in-flight pan that ended outside the canvas —
  // otherwise the next click would see panDragRef with a stale "moved" flag
  // and either pan or swallow the click depending on timing.
  const up=()=>{if(panDragRef.current&&!panDragRef.current.moved)panDragRef.current=null;};
  window.addEventListener("mouseup",up);
  return()=>window.removeEventListener("mouseup",up);
},[]);
const activeResRef=useRef(null);activeResRef.current=activeRes;
const playRef=useRef(false),worldRef=useRef(null),terRef=useRef(null),speedRef=useRef(5),viewRef=useRef("terrain");
// ── Pan / zoom view transform ────────────────────────────────────────
// All map drawing applies `ctx.translate(panX,panY); ctx.scale(zoom,zoom)`
// so the existing draw code can stay in canvas-pixel coordinates; only the
// inverse is needed when hit-testing a click or hover. Stored as refs to
// avoid re-renders during a drag — the `draw()` call already runs every
// frame so we don't need React state for these to repaint.
const viewXRef=useRef(0),viewYRef=useRef(0),viewZRef=useRef(1);
const panDragRef=useRef(null);   // {sx,sy,vx,vy} during a middle/right or drag-from-empty-space pan
const hoverThrottleRef=useRef({ti:-2,t:0,x:0,y:0});   // hover-card re-render throttle (see onCanvasMove)
const ZOOM_MIN=0.5,ZOOM_MAX=8;
// peopleSim world — entity-based replacement for the legacy tribe system.
// Bands, settlements, etc. live here. The legacy `ter` object is kept
// alive only so the existing draw() pipeline doesn't break; it is not
// stepped (the runTribeStep call is disabled below).
const peopleRef=useRef(null);
// peopleSim runs in a Web Worker so its heavy passes can't stutter rendering.
// simWorkerRef holds the worker; peopleRef.current becomes a MIRROR populated
// from snapshots (shaped like the real world so draw()/the card read it
// unchanged). If the worker can't start, we fall back to stepping on the main
// thread (simWorkerRef stays null and the rAF loop steps as before).
const simWorkerRef=useRef(null);
const applySnapshotRef=useRef(null);
const [psStats,setPsStats]=useState({step:0,bands:0,settlements:0,totalPeople:0});
// Time-series of global metrics for the History charts + copyable export. Kept
// in a ref (no re-render on every sample); the charts read it on the regular
// psStats-driven re-render. Sampled every HISTORY_INTERVAL sim steps.
const psHistoryRef=useRef([]);
const [chartsOpen,setChartsOpen]=useState(false);
const [statsCopied,setStatsCopied]=useState(false);
const oceanLevelRef=useRef(0.78);const depthFromSeaRef=useRef(false);const depthCeilRef=useRef(1.0);const showPlatesRef=useRef(false);const showRiversRef=useRef(false);const showStreamsRef=useRef(false);const showLakesRef=useRef(false);const showGlobeRef=useRef(false);
const presetRef=useRef("tectonic");const fileRef=useRef(null);const importedWorldRef=useRef(null);
const useRealWindRef=useRef(false);
// Cache terrain RGB to avoid recomputing every frame
const terrainCache=useRef(null);
const atlasCache=useRef(null);
// Offscreen cache for the political overlay (territory tint + borders + roads).
// That overlay is a pure function of owner[]/roadQuality[], which change only
// slowly (territory recomputes every 96 ticks, roads on plan cycles), yet it
// re-rasterised ~460k tiles every frame. We render it to this canvas and only
// regenerate every PS_OVERLAY_REGEN sim-steps, blitting it otherwise.
const psOverlayRef=useRef(null);
const psOverlayMeta=useRef({step:-1,ch:0});
// Reusable scratch for the money-flow coin particles (money view). Coins are
// bucketed by link busyness so the whole overlay costs ~4 fillStyle changes
// instead of one per link; the position arrays are reused across frames to
// avoid per-frame allocation at 60fps.
const moneyDotsRef=useRef(null);
// Offscreen cache of the STATIC base raster (terrain etc.). Rebuilt only when
// the view or a relevant toggle changes; blitted every frame otherwise — the
// per-pixel terrain rebuild + putImageData was a big per-frame cost now that
// the sim is off-thread.
const baseLayerRef=useRef(null);
const baseLayerKey=useRef(null);
// Reuse ImageData between frames to avoid 7.3MB allocation per draw
const imgRef=useRef(null);
// Wind particle animation state
const windParticlesRef=useRef(null);
const W=1920,H=960,CW=CW_FLAT;
const workerRef=useRef(null);
// Helper: finalize a generated world (shared by worker + main thread paths)
const finalizeWorld=useCallback((w)=>{
// generateWorld stamps the seed as `_seed`; everything downstream (people-sim
// RNG, resource placement) reads `w.seed`. Without this alias the sim's RNG
// silently fell back to seed 1 for EVERY world.
if(w.seed==null)w.seed=w._seed??1;
setWorld(w);worldRef.current=w;const t=createTerritory(w);
terRef.current=t;
// Rivers (and deposits) are computed inside createTerritory and stored
// on the `ter` object, not on the raw worldgen output. peopleSim reads
// from `w` — so re-export those onto `w` so the cradle finder + settle
// check + later trade/port phases can see water access.
if(t.rivers)w.rivers=t.rivers;
if(t.deposits)w.deposits=t.deposits;
// peopleSim: entity-based simulator that replaces the legacy tribe model.
// Pass t.tCrop so the sim's fertility uses the SAME formula as the
// Crop overlay (young-soil discount, tropical penalty, wide bell).
// Runs in a Web Worker (off the render thread); peopleRef.current becomes a
// snapshot-fed mirror. Falls back to a main-thread sim if the worker fails.
let usedWorker=false;
try{
  if(simWorkerRef.current){simWorkerRef.current.terminate();simWorkerRef.current=null;}
  const sw=new PeopleSimWorker();
  sw.onmessage=(e)=>{
    const d=e.data;
    if(d.type==='snapshot'){if(applySnapshotRef.current)applySnapshotRef.current(d);}
    else if(d.type==='error'){console.error('[SimWorker]',d.message,d.stack);}
  };
  sw.onerror=(err)=>{
    console.warn('[SimWorker] error — falling back to main-thread sim:',err.message);
    try{if(simWorkerRef.current){simWorkerRef.current.terminate();}}catch{/* already dead */}
    simWorkerRef.current=null;
    peopleRef.current=initPeopleSim(w,{seed:w.seed,tCrop:t.tCrop,tileRes:RES,deposits:t.deposits});
    setPsStats(peopleSimStats(peopleRef.current));
  };
  simWorkerRef.current=sw;
  // Empty mirror until the first snapshot arrives.
  peopleRef.current={_isMirror:true,step:0,settlements:[],tw:t.tw||0,th:t.th||0,tileRes:RES,N:0,countries:new Map(),_byId:new Map()};
  // Send ONLY the fields createWorld reads (structured-clone copies them; the
  // main thread keeps its own w arrays for terrain rendering). Avoids cloning
  // the full worldgen object, which may carry non-cloneable extras.
  const initW={width:w.width,height:w.height,seed:w.seed,preset:w.preset,
    elevation:w.elevation,temperature:w.temperature,moisture:w.moisture,coastal:w.coastal,
    windX:w.windX,windY:w.windY,
    rivers:(w.rivers&&w.rivers.riverMag)?{riverMag:w.rivers.riverMag}:null,
    deposits:w.deposits};
  sw.postMessage({type:'init',w:initW,tCrop:t.tCrop,tileRes:RES,seed:w.seed});
  // Push current play/speed/view state to the fresh worker.
  sw.postMessage({type:'control',playing:false,speed:speedRef.current});
  sw.postMessage({type:'view',view:viewRef.current});
  // A fresh worker starts at default tuning — re-send the user's current levers.
  sw.postMessage({type:'tune',values:tuneValsRef.current});
  usedWorker=true;
}catch(e){console.warn('[SimWorker] init failed — main-thread sim:',e);}
if(!usedWorker){
  peopleRef.current=initPeopleSim(w,{seed:w.seed,tCrop:t.tCrop,tileRes:RES,deposits:t.deposits});
  setPsStats(peopleSimStats(peopleRef.current));
}
setPlaying(false);playRef.current=false;
terrainCache.current=null;atlasCache.current=null;imgRef.current=null;},[]);
const generate=useCallback((s,ol)=>{
// Import path
if(presetRef.current==="import"&&importedWorldRef.current){
const w=importedWorldRef.current;importedWorldRef.current=null;finalizeWorld(w);return;}
const _ol=ol!==undefined?ol:oceanLevelRef.current;
// Real-wind Earth-Sim stays on the main thread: the NCEP data set lives in
// this bundle only (duplicating 2.3MB of JSON into the worker isn't worth a
// rare power-user toggle). EVERYTHING else generates in the worker — the old
// main-thread path froze the UI 2-5s for every non-tectonic preset.
const _realWind=presetRef.current==="earth_sim"&&useRealWindRef.current&&isRealWindAvailable();
if(!_realWind){
try{
if(workerRef.current)workerRef.current.terminate();
const worker=new WorldGenWorker();workerRef.current=worker;
worker.onmessage=(e)=>{
if(e.data.type==='result'){console.log(`[Worker] Done in ${e.data.time?.toFixed(0)}ms`);finalizeWorld(e.data.world);}
else{console.warn('[Worker]',e.data.type,e.data.message||'');
finalizeWorld(generateWorld(W,H,s,presetRef.current,_ol,true,false,_tecParams));}};
worker.onerror=(err)=>{console.warn('[Worker] Error:',err.message);
finalizeWorld(generateWorld(W,H,s,presetRef.current,_ol,true,false,_tecParams));};
worker.postMessage({type:'generate',W,H,seed:s,preset:presetRef.current,oceanLevel:_ol,tecParams:_tecParams});
return;}catch(e){console.warn('[Worker] Init failed:',e);}}
// Main thread: real-wind Earth-Sim (or worker init failure fallback).
finalizeWorld(generateWorld(W,H,s,presetRef.current,_ol,true,_realWind,_tecParams,{isRealWindAvailable,fillRealWind}));},[finalizeWorld]);
useEffect(()=>{generate(seed)},[seed,generate]);
// Build globe texture at 2048×1024 (GPU-friendly power-of-2) with polar blending
// Clear caches when globe toggled off (canvas remounts)
useEffect(()=>{if(!showGlobe){terrainCache.current=null;imgRef.current=null;windParticlesRef.current=null;}
},[showGlobe]);

// Build terrain RGB cache at tile resolution (one entry per tile)
const updateTerrainCache=useCallback((w,ter)=>{
const buf=new Uint8Array(CW*CH*3);const sl=0;
for(let ty=0;ty<CH;ty++){
const dataY=Math.round(screenYtoDataY(ty,CH,H));
for(let tx=0;tx<CW;tx++){
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,dataY);
const si=sy*W+sx;const e=w.elevation[si];
let m=w.moisture[si];
if(ter&&ter.tMoist){const tti=Math.min(ter.th-1,(sy/RES)|0)*ter.tw+Math.min(ter.tw-1,(sx/RES)|0);m=ter.tMoist[tti];}
const t=w.temperature[si];let r,g,b;
if(e<=sl){const df=Math.min(1,Math.max(0,(sl-e)/0.15));
r=Math.round(32-df*24);g=Math.round(72-df*50);b=Math.round(120-df*60);
}else{const c=getColorD(e,m,t,sl);r=c[0];g=c[1];b=c[2];}
// Swamp overlay
let hasSwamp=false;
for(let dy=0;dy<RES;dy++)for(let dx=0;dx<RES;dx++){
const wi=Math.min(H-1,sy+dy)*W+Math.min(W-1,sx+dx);
if(w.swamp&&w.swamp[wi])hasSwamp=true;}
let pr=r,pg=g,pb=b;
if(e>sl&&hasSwamp){pr=40;pg=58;pb=38;}
const ti3=(ty*CW+tx)*3;buf[ti3]=pr;buf[ti3+1]=pg;buf[ti3+2]=pb;}}
return buf;},[CH]);

// ── Atlas (olde-map) renderer: stained parchment land, dark seas, cartographic symbols ──
// Heavy build; runs once per world (cached as ImageData), reused each frame.
const buildAtlas=useCallback((w,ter)=>{
const cv=document.createElement("canvas");cv.width=CW;cv.height=CH;
const octx=cv.getContext("2d");
const img=new ImageData(CW,CH);const d=img.data;
const N=CW*CH,tw=ter.tw,th=ter.th;
const lk=ter.rivers&&ter.rivers.lake?ter.rivers.lake:null;
// Per-screen-pixel data index + water mask; find land elevation ceiling
const dataIdx=new Int32Array(N),water=new Uint8Array(N);
let landEMax=0.001;
for(let ty=0;ty<CH;ty++){
const dy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H)));
const tyTile=Math.min(th-1,(dy/RES)|0);
for(let tx=0;tx<CW;tx++){
const sx=Math.min(W-1,tx*RES),si=dy*W+sx,i=ty*CW+tx;
dataIdx[i]=si;const e=w.elevation[si];
const isLake=lk?lk[tyTile*tw+Math.min(tw-1,(sx/RES)|0)]>=0:false;
water[i]=(e<=0||isLake)?1:0;
if(e>landEMax)landEMax=e;}}
const mtnHi=landEMax*0.55,mtnLo=landEMax*0.34,hillLo=landEMax*0.19,footLo=landEMax*0.10;
// Chamfer distance transform — coastDist drives the worn, inked shoreline
const chamfer=(f)=>{
for(let ty=0;ty<CH;ty++)for(let tx=0;tx<CW;tx++){const i=ty*CW+tx;let dd=f[i];
if(tx>0){const v=f[i-1]+1;if(v<dd)dd=v;}
if(ty>0){const v=f[i-CW]+1;if(v<dd)dd=v;}
if(tx>0&&ty>0){const v=f[i-CW-1]+1.4142;if(v<dd)dd=v;}
if(tx<CW-1&&ty>0){const v=f[i-CW+1]+1.4142;if(v<dd)dd=v;}
f[i]=dd;}
for(let ty=CH-1;ty>=0;ty--)for(let tx=CW-1;tx>=0;tx--){const i=ty*CW+tx;let dd=f[i];
if(tx<CW-1){const v=f[i+1]+1;if(v<dd)dd=v;}
if(ty<CH-1){const v=f[i+CW]+1;if(v<dd)dd=v;}
if(tx<CW-1&&ty<CH-1){const v=f[i+CW+1]+1.4142;if(v<dd)dd=v;}
if(tx>0&&ty<CH-1){const v=f[i+CW-1]+1.4142;if(v<dd)dd=v;}
f[i]=dd;}};
const coastDist=new Float32Array(N),seaDist=new Float32Array(N);
for(let i=0;i<N;i++){coastDist[i]=water[i]?0:1e9;seaDist[i]=water[i]?1e9:0;}
chamfer(coastDist);chamfer(seaDist);
// Downsampled fbm fields — staining is low-frequency, so 4× downsample is invisible (~16× fewer fbm calls)
const QW=(CW>>2)+2,QH=(CH>>2)+2;
const mkField=(fx,fy,oct,ox,oy)=>{const f=new Float32Array(QW*QH);
for(let j=0;j<QH;j++)for(let k=0;k<QW;k++)f[j*QW+k]=fbm(k*4/CW*fx+ox,j*4/CH*fy+oy,oct,2,0.5);
return f;};
const bigF=mkField(3.0,3.0,3,11,11),stnF=mkField(4.6,4.6,3,93,93),midF=mkField(8,8,3,40,40),
fineF=mkField(27,27,2,71,71);
const samp=(f,x,y)=>{const fx=x*0.25,fy=y*0.25,x0=fx|0,y0=fy|0,dx=fx-x0,dy=fy-y0,
a=f[y0*QW+x0],b=f[y0*QW+x0+1],cc=f[(y0+1)*QW+x0],dd=f[(y0+1)*QW+x0+1];
return a*(1-dx)*(1-dy)+b*dx*(1-dy)+cc*(1-dx)*dy+dd*dx*dy;};
// Base layer — stained, worn parchment land + dark, textured seas
const COAST=58,HALO=12;
for(let ty=0;ty<CH;ty++)for(let tx=0;tx<CW;tx++){
const i=ty*CW+tx,si=dataIdx[i],pi=i<<2,e=w.elevation[si];
const big=samp(bigF,tx,ty),mid=samp(midF,tx,ty),fine=samp(fineF,tx,ty),stn=samp(stnF,tx,ty);
const grain=atlasHash(tx,ty)-0.5;
if(water[i]){
// Sea: pale parchment, broadly discoloured by the wind field —
// windier water reads as darker, more weathered staining
let r=197,g=174,b=126;
let wd=0;
if(w.windX){const vx=w.windX[si],vy=w.windY[si];wd=Math.min(1,Math.pow(vx*vx+vy*vy,0.25));}
r-=wd*42;g-=wd*48;b-=wd*54;
r+=big*12;g+=big*11;b+=big*9;
r+=grain*9;g+=grain*9;b+=grain*8;
r+=(246-r)*0.2;g+=(242-g)*0.2;b+=(234-b)*0.2;
// broad darkened halo hugging every ocean coastline (skip lakes — too small,
// the halo would swallow them into dark blobs; their ink shore defines them)
const sd=seaDist[i];
if(sd<HALO&&!(lk&&lk[si]>=0)){const hh=1-sd/HALO,hk=hh*hh;
r-=hk*86;g-=hk*87;b-=hk*79;}
d[pi]=r;d[pi+1]=g;d[pi+2]=b;d[pi+3]=255;continue;}
const m=w.moisture[si],t=w.temperature[si],biome=getBiomeD(e,m,t,0);
let r=197,g=174,b=126;
// broad uneven aged tone
r+=big*40;g+=big*37;b+=big*31;
// blotchy brown stains at two scales — worn discolouring
const stain=Math.max(0,mid+0.15)+Math.max(0,stn-0.05)*0.65;
r-=stain*36;g-=stain*44;b-=stain*49;
if(mid>0.30){const s=(mid-0.30)*1.6;r-=s*36;g-=s*40;b-=s*40;}
// finer mottle + per-pixel paper grain (fibres)
r+=fine*17+grain*12;g+=fine*16+grain*12;b+=fine*13+grain*11;
// biome discolouration
if(biome===13){r+=15;g-=3;b-=36;}           // desert — warm orange
else if(biome===14){r+=8;b-=21;}            // shrubland — mild tan
else if(biome===11){r+=9;g+=2;b-=18;}       // savanna — golden
else if(biome===12){r-=14;g+=4;b-=26;}      // grassland — soft green
else if(biome===5){r+=24;g+=27;b+=39;}      // snow / ice — aged white
else if(biome===4||biome===18){r+=11;g+=14;b+=22;} // tundra / cold desert — pale wash
else if(biome===6||biome===7){r-=14;g-=7;b-=14;}   // taiga / boreal — cool shade
else if(biome===8||biome===9||biome===10||biome===15||biome===17){r-=9;g-=3;b-=13;} // forest — faint green
if(e>mtnLo){const s=Math.min(1,(e-mtnLo)/(landEMax-mtnLo+1e-3));r-=s*16;g-=s*12;b-=s*4;}
// shoreline: broad gradient to a darker tea-stained discolour
if(coastDist[i]<COAST){const tt=1-coastDist[i]/COAST,t2=tt*(0.45+tt*0.55);
r-=t2*36;g-=t2*44;b-=t2*47;r+=tt*9;g+=tt*3;}
// hand-inked coastline — darkness varied so it reads as worn ink, not a clean vector line
if(coastDist[i]<=1.7){const ink=0.6+atlasHash(tx,ty)*0.34;
r=r*(1-ink)+34*ink;g=g*(1-ink)+27*ink;b=b*(1-ink)+18*ink;}
d[pi]=r;d[pi+1]=g;d[pi+2]=b;d[pi+3]=255;}
// Smudge the sea — water-only separable box blur so the swells read soft and natural
{const BR=3,tmp=new Float32Array(N*3);
for(let ty=0;ty<CH;ty++){const row=ty*CW;
for(let tx=0;tx<CW;tx++){const i=row+tx;if(!water[i])continue;
let sr=0,sg=0,sb=0,c=0;const x0=tx-BR<0?0:tx-BR,x1=tx+BR>=CW?CW-1:tx+BR;
for(let x2=x0;x2<=x1;x2++){const j=row+x2;if(!water[j])continue;
const pj=j<<2;sr+=d[pj];sg+=d[pj+1];sb+=d[pj+2];c++;}
const p3=i*3;tmp[p3]=sr/c;tmp[p3+1]=sg/c;tmp[p3+2]=sb/c;}}
for(let tx=0;tx<CW;tx++){
for(let ty=0;ty<CH;ty++){const i=ty*CW+tx;if(!water[i])continue;
let sr=0,sg=0,sb=0,c=0;const y0=ty-BR<0?0:ty-BR,y1=ty+BR>=CH?CH-1:ty+BR;
for(let y2=y0;y2<=y1;y2++){const j=y2*CW+tx;if(!water[j])continue;
const pj=j*3;sr+=tmp[pj];sg+=tmp[pj+1];sb+=tmp[pj+2];c++;}
const pi=i<<2;d[pi]=sr/c;d[pi+1]=sg/c;d[pi+2]=sb/c;}}}
octx.putImageData(img,0,0);
// ── Cartographic symbols ──
octx.lineJoin="round";octx.lineCap="round";
// Foxing — soft, irregular age-blooms across the whole sheet
for(let gy=5;gy<CH-5;gy+=11)for(let gx=5;gx<CW-5;gx+=11){
const h=atlasHash(gx+9,gy+9);if(h>0.34)continue;
const px=gx+(atlasHash(gx+3,gy+5)-0.5)*10,py=gy+(atlasHash(gx+7,gy+1)-0.5)*10;
const ix=px|0,iy=py|0;if(ix<2||ix>=CW-2||iy<2||iy>=CH-2)continue;
const onWater=water[iy*CW+ix];
const h2=atlasHash(gx+1,gy+4),h3=atlasHash(gx+6,gy+2);
const rad=1.7+h2*4.8;
let cr,cg,cb,ca;
if(onWater){cr=164;cg=142;cb=102;ca=0.10+h*0.36;}      // paler tan over the sea
else{cr=(98+h*94)|0;cg=(76+h*52)|0;cb=42;ca=0.05+h*0.36;} // brown on land
octx.save();octx.translate(px,py);octx.rotate(h2*6.283);octx.scale(1,0.5+h3*0.8);
const blobs=h<0.15?2:1;
for(let bi=0;bi<blobs;bi++){
const ox=bi?(h3-0.5)*rad*1.5:0,oy=bi?(h2-0.5)*rad*1.1:0,rr=bi?rad*(0.45+h3*0.4):rad;
const g=octx.createRadialGradient(ox,oy,0,ox,oy,rr);
g.addColorStop(0,`rgba(${cr},${cg},${cb},${ca})`);
g.addColorStop(0.5,`rgba(${cr},${cg},${cb},${ca*0.5})`);
g.addColorStop(1,`rgba(${cr},${cg},${cb},0)`);
octx.fillStyle=g;octx.beginPath();octx.arc(ox,oy,rr,0,6.2832);octx.fill();}
octx.restore();}
// Hachures — short downhill strokes shading steep ground (escarpments, hill flanks)
for(let gy=6;gy<CH-6;gy+=7)for(let gx=6;gx<CW-6;gx+=7){
const px=(gx+(atlasHash(gx+3,gy+1)-0.5)*5)|0,py=(gy+(atlasHash(gx+1,gy+5)-0.5)*5)|0;
if(px<4||px>=CW-4||py<4||py>=CH-4)continue;
const i=py*CW+px;if(water[i]||coastDist[i]<5)continue;
const si=dataIdx[i],e=w.elevation[si];if(e<=0||e>=mtnLo)continue;
const gX=w.elevation[si+3]-w.elevation[si-3],gY=w.elevation[si+3*W]-w.elevation[si-3*W];
const slope=Math.sqrt(gX*gX+gY*gY),steep=slope/(landEMax+1e-3);
if(steep<0.04)continue;
if(atlasHash(gx+9,gy+7)>Math.min(0.9,0.15+steep*8))continue;
const dl=slope||1,dx=-gX/dl,dy=-gY/dl,len=1.8+Math.min(3.2,steep*30);
octx.strokeStyle=`rgba(60,48,32,${0.26+Math.min(0.34,steep*5)})`;
octx.lineWidth=0.4+Math.min(0.5,steep*5);
octx.beginPath();octx.moveTo(px-dx*len*0.5,py-dy*len*0.5);octx.lineTo(px+dx*len*0.5,py+dy*len*0.5);octx.stroke();}
// Coastlines — hatched cliffs on steep shores, pale sand flecks on gentle ones
for(let gy=5;gy<CH-5;gy+=6)for(let gx=5;gx<CW-5;gx+=6){
const i0=gy*CW+gx;if(water[i0]||coastDist[i0]>5)continue;
const si=dataIdx[i0],e=w.elevation[si];if(e<=0)continue;
const gX=w.elevation[si+3]-w.elevation[si-3],gY=w.elevation[si+3*W]-w.elevation[si-3*W];
const slope=Math.sqrt(gX*gX+gY*gY),steep=slope/(landEMax+1e-3);
if(steep>0.05){
const dl=slope||1,dx=-gX/dl,dy=-gY/dl;
octx.strokeStyle='rgba(50,40,26,0.62)';octx.lineWidth=0.5;octx.beginPath();
for(let tk=-1;tk<=1;tk++){const ox=-dy*tk*1.7,oy=dx*tk*1.7;
octx.moveTo(gx+ox,gy+oy);octx.lineTo(gx+ox+dx*2.6,gy+oy+dy*2.6);}
octx.stroke();
}else if(atlasHash(gx+2,gy+8)<0.4){
octx.fillStyle='rgba(234,222,178,0.5)';
octx.beginPath();octx.arc(gx+(atlasHash(gx,gy)-0.5)*4,gy+(atlasHash(gx+4,gy)-0.5)*4,0.95,0,6.2832);octx.fill();}}
// Ground cover — grass, scrub and barren speckle for the open biomes
for(let gy=5;gy<CH-5;gy+=9)for(let gx=5;gx<CW-5;gx+=9){
const px=(gx+(atlasHash(gx+2,gy+3)-0.5)*8)|0,py=(gy+(atlasHash(gx+5,gy+7)-0.5)*8)|0;
if(px<2||px>=CW-2||py<2||py>=CH-2)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i],e=w.elevation[si];if(e>=mtnLo)continue;
const m=w.moisture[si],biome=getBiomeD(e,m,w.temperature[si],0);
const h=atlasHash(gx+11,gy+4),tone=atlasHash(gx+3,gy+9);
if(biome===12){if(h>0.42+m*0.5)continue;atlasTuft(octx,px,py,2.6+tone*2.1,tone);}
else if(biome===11){if(h>0.4)continue;
if(atlasHash(gx+7,gy+1)<0.1)atlasAcacia(octx,px,py,4.4+tone*2.1,tone);
else atlasTuft(octx,px,py,2.2+tone*1.8,tone);}
else if(biome===14){if(h>0.5)continue;atlasShrub(octx,px,py,1.9+tone*1.3,tone);}
else if(biome===4){if(h>0.34)continue;
octx.fillStyle=`rgba(${(112+tone*40)|0},${(114+tone*34)|0},${(106+tone*28)|0},0.5)`;
octx.beginPath();octx.arc(px,py,0.7+tone*0.6,0,6.2832);octx.fill();}
else if(biome===18){if(h>0.3)continue;
octx.fillStyle='rgba(120,110,92,0.45)';
octx.beginPath();octx.arc(px,py,0.6+tone*0.5,0,6.2832);octx.fill();}}
// Mountains — dense & overlapping so high ground forms continuous ranges; hills below
for(let gy=5;gy<CH-5;gy+=8)for(let gx=5;gx<CW-5;gx+=8){
const px=(gx+(atlasHash(gx,gy)-0.5)*6)|0,py=(gy+(atlasHash(gx+7,gy+3)-0.5)*6)|0;
if(px<2||px>=CW-2||py<2||py>=CH-2)continue;
const i=py*CW+px;if(water[i])continue;
const e=w.elevation[dataIdx[i]];
if(e>=mtnLo){
const dens=(e-mtnLo)/(landEMax-mtnLo+1e-3);
if(atlasHash(gx+11,gy+19)>0.62+dens*0.36)continue;
const big=e>mtnHi,size=(big?5.4:3.6)+dens*3.8+atlasHash(gx+3,gy+9)*1.5;
atlasMountain(octx,px,py,size,big,atlasHash(gx+6,gy+2));
}else if(e>=hillLo){
if(atlasHash(gx+5,gy+8)>0.13)continue;
atlasHill(octx,px,py,1.7+atlasHash(gx+2,gy+6)*1.3);
}else if(e>=footLo){
if(atlasHash(gx+5,gy+8)>0.06)continue;
atlasHill(octx,px,py,0.85+atlasHash(gx+2,gy+6)*0.6);}}
// Ordinary forests — moderate scatter; tree silhouette varies by biome
for(let gy=4;gy<CH-4;gy+=6)for(let gx=4;gx<CW-4;gx+=6){
const px=(gx+(atlasHash(gx+1,gy+2)-0.5)*5)|0,py=(gy+(atlasHash(gx+4,gy+8)-0.5)*5)|0;
if(px<2||px>=CW-2||py<2||py>=CH-2)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i],e=w.elevation[si];if(e>=mtnLo)continue;
const biome=getBiomeD(e,w.moisture[si],w.temperature[si],0);
let cover=0,kind=0;                          // kind: 0 conifer, 1 deciduous, 2 acacia
if(biome===6){cover=0.40;kind=0;}            // taiga — fir, closed forest
else if(biome===8||biome===17){cover=0.42;kind=1;} // temperate / subtropical — broadleaf
else if(biome===15){cover=0.16;kind=2;}      // tropical dry forest — open acacia woodland
else continue;
if(atlasHash(gx+13,gy+5)>cover)continue;
const tone=atlasHash(gx+2,gy+11),size=4.2+atlasHash(gx+9,gy+1)*2.8;
if(kind===0)atlasConifer(octx,px,py,size,tone);
else if(kind===1)atlasRoundTree(octx,px,py,size,tone);
else atlasAcacia(octx,px,py,size,tone);}
// Dense forest — packed, overlapping thicket: rainforests (jungle) + boreal (fir)
for(let gy=3;gy<CH-3;gy+=4)for(let gx=3;gx<CW-3;gx+=4){
const px=(gx+(atlasHash(gx+1,gy+5)-0.5)*4)|0,py=(gy+(atlasHash(gx+6,gy+2)-0.5)*4)|0;
if(px<2||px>=CW-2||py<2||py>=CH-2)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i],e=w.elevation[si];if(e>=mtnLo)continue;
const bm=getBiomeD(e,w.moisture[si],w.temperature[si],0);
if(bm!==9&&bm!==10&&bm!==7)continue;
if(atlasHash(gx+7,gy+9)>0.95)continue;
const tone=atlasHash(gx+2,gy+11);
if(bm===7)atlasConifer(octx,px,py,4.4+atlasHash(gx+9,gy+1)*2.3,tone);
else atlasJungleTree(octx,px,py,5.0+atlasHash(gx+9,gy+1)*2.4,tone);}
// Desert stipple (dune dots)
for(let gy=4;gy<CH-4;gy+=7)for(let gx=4;gx<CW-4;gx+=7){
const px=(gx+(atlasHash(gx+6,gy+1)-0.5)*6)|0,py=(gy+(atlasHash(gx+2,gy+9)-0.5)*6)|0;
if(px<1||px>=CW-1||py<1||py>=CH-1)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i],e=w.elevation[si],dm=w.moisture[si];
if(getBiomeD(e,dm,w.temperature[si],0)!==13)continue;
if(atlasHash(gx+3,gy+7)>0.62-dm*1.6)continue;
octx.fillStyle="rgba(120,84,38,0.5)";
octx.beginPath();octx.arc(px,py,0.7,0,6.2832);octx.fill();}
// Swamp reeds
if(w.swamp){
for(let gy=5;gy<CH-5;gy+=10)for(let gx=5;gx<CW-5;gx+=10){
const px=(gx+(atlasHash(gx+8,gy+4)-0.5)*7)|0,py=(gy+(atlasHash(gx+5,gy+2)-0.5)*7)|0;
if(px<1||px>=CW-1||py<1||py>=CH-1)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i];if(!w.swamp[si])continue;
octx.strokeStyle="rgba(64,72,48,0.75)";octx.lineWidth=0.7;
octx.beginPath();
octx.moveTo(px-2.4,py+1);octx.lineTo(px+2.4,py+1);
octx.moveTo(px-1.4,py+1);octx.lineTo(px-1.4,py-2);
octx.moveTo(px,py+1);octx.lineTo(px,py-2.6);
octx.moveTo(px+1.4,py+1);octx.lineTo(px+1.4,py-2);
octx.stroke();}}
// Re-stamp lake water over the symbol layer. Tree canopies from shoreline
// trees overhang small lakes and would otherwise bury them; the base layer
// (d) still holds the clean water colour, so copy it back for lake tiles
// only — land symbols are left untouched.
if(lk){const cur=octx.getImageData(0,0,CW,CH),cd=cur.data;
for(let i=0;i<N;i++){if(lk[i]<0)continue;
const pi=i<<2;cd[pi]=d[pi];cd[pi+1]=d[pi+1];cd[pi+2]=d[pi+2];cd[pi+3]=255;}
octx.putImageData(cur,0,0);}
// Rivers — traced from the flow network, drawn as smooth meandering ink
// (the raw D8 flow is 8-directional/blocky; tracing + curve smoothing
// turns it into natural winding rivers). Lakes break the trace: a river
// ends at the lake shore, and the lake's outflow is drawn as its own
// river from the outlet — so rivers visibly enter and leave lakes.
if(ter.rivers&&ter.rivers.flowDir){
const rmg=ter.rivers.riverMag,fd=ter.rivers.flowDir,RN=tw*th;
const DDX=[1,1,0,-1,-1,-1,0,1],DDY=[0,1,1,1,0,-1,-1,-1];
const isLk=(t)=>!!(lk&&lk[t]>=0);
const hasUp=new Uint8Array(RN),drawn=new Uint8Array(RN);
// Upstream flag ignores lake tiles, so a tile fed only by a lake's outlet
// counts as a river source — that becomes the lake's outflow head.
for(let ti=0;ti<RN;ti++){if(rmg[ti]<2||isLk(ti))continue;const d=fd[ti];if(d===255)continue;
const nx=((ti%tw)+DDX[d]+tw)%tw,ny=((ti/tw)|0)+DDY[d];if(ny<0||ny>=th)continue;hasUp[ny*tw+nx]=1;}
octx.lineCap="round";octx.lineJoin="round";octx.strokeStyle="rgba(42,58,78,0.92)";
const wOf=(m)=>m>=4?2.2:m>=3?1.5:0.95;
const drawSeg=(pts,a,b,lw)=>{if(b<=a)return;octx.lineWidth=lw;octx.beginPath();
octx.moveTo(pts[a].x,pts[a].y);
for(let k=a+1;k<b;k++)octx.quadraticCurveTo(pts[k].x,pts[k].y,(pts[k].x+pts[k+1].x)*0.5,(pts[k].y+pts[k+1].y)*0.5);
octx.lineTo(pts[b].x,pts[b].y);octx.stroke();};
for(let ti=0;ti<RN;ti++){
if(rmg[ti]<2||hasUp[ti]||isLk(ti))continue;
const pts=[];let ci=ti,guard=0;
// If this head is fed by a lake outlet, prepend that outlet tile so the
// river visibly emerges from the water rather than starting beside it.
if(lk){const sx=ti%tw,sy=(ti/tw)|0;
for(let d=0;d<8;d++){const lx=((sx+DDX[d])%tw+tw)%tw,ly=sy+DDY[d];
if(ly<0||ly>=th)continue;const lci=ly*tw+lx;
if(lk[lci]>=0&&fd[lci]!==255){
const ld=fd[lci],fx2=((lx+DDX[ld])%tw+tw)%tw,fy2=ly+DDY[ld];
if(fx2===sx&&fy2===sy){pts.push({x:lx,y:ly,m:rmg[ti]});break;}}}}
for(;;){if(guard++>6000)break;
drawn[ci]=1;pts.push({x:ci%tw,y:(ci/tw)|0,m:rmg[ci]});
const d=fd[ci];if(d===255)break;
const cx=ci%tw,cy=(ci/tw)|0,nx=((cx+DDX[d])%tw+tw)%tw,ny=cy+DDY[d];
if(ny<0||ny>=th)break;const nci=ny*tw+nx;
// Reaching a lake: end the river at the shore (the lake tile is the
// terminal point so the line just touches the water).
if(isLk(nci)){pts.push({x:nx,y:ny,m:pts[pts.length-1].m});break;}
if(rmg[nci]<2||drawn[nci]){pts.push({x:nx,y:ny,m:rmg[nci]>=2?rmg[nci]:pts[pts.length-1].m});break;}
ci=nci;}
const n=pts.length;if(n<2)continue;
// decimate to ~every 4th tile, then the quadratic curve smooths out the
// D8 stair-steps — the path already wanders (jittered flow in riverGen)
const dp=[pts[0]];
for(let k=4;k<n-1;k+=4)dp.push(pts[k]);
dp.push(pts[n-1]);
const dn=dp.length;
let a=0;
for(let k=1;k<dn;k++){if(wOf(dp[k].m)!==wOf(dp[a].m)){drawSeg(dp,a,k,wOf(dp[a].m));a=k;}}
drawSeg(dp,a,dn-1,wOf(dp[a].m));}
}
return octx.getImageData(0,0,CW,CH);
},[CH]);

// Composite render: terrain + tribe overlay into single canvas
const draw=useCallback((ter)=>{
if(!ter)return;const w=worldRef.current;if(!w)return;
if(import.meta.env.DEV&&typeof window!=='undefined'){window.__ter=ter;window.__world=w;}
const sl=0,vm=viewRef.current;
const isGlobe=showGlobeRef.current;
// Use onscreen canvas if available, otherwise create offscreen for globe
let ctx=canvasRef.current?canvasRef.current.getContext("2d"):null;
if(!ctx&&!isGlobe)return;
// ── Apply pan/zoom view transform (peopleSim views only — legacy views
// like globe/preview keep their own coordinate handling). Cleared first
// because at zoom<1 the transformed image doesn't cover the whole canvas
// and we'd otherwise see stale pixels around the edges. Hit-testing
// reverses this transform (see onCanvasMove / onCanvasClick).
const _pz=ctx&&!isGlobe;
if(_pz){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle="#000";ctx.fillRect(0,0,CW,CH);
  // Crisp upscale at zoom > 1 — match the `imageRendering: pixelated` style
  // on the <canvas>. Without this the base raster smooths into mush when
  // zoomed in.
  ctx.imageSmoothingEnabled=false;
  ctx.setTransform(viewZRef.current,0,0,viewZRef.current,viewXRef.current,viewYRef.current);
}
if(!imgRef.current)imgRef.current=new ImageData(CW,CH);
const img=imgRef.current;const d=img.data;
// Lake lookup for rendering
const lk=ter.rivers&&ter.rivers.lake?ter.rivers.lake:null;
const N=CW*CH;
// Static-base cache: blit the cached terrain raster instead of rebuilding it
// per-pixel when nothing affecting it changed.
const _stepCacheV=STEP_CACHE_VIEWS.has(vm);
const _staticBase=(BASE_CACHE_VIEWS.has(vm)||_stepCacheV)&&!isGlobe;
// Dynamic data views fold a coarse sim-step bucket into the key so the cached
// raster refreshes as the world changes (and is stable/blitted while paused).
const _simStep=(peopleRef.current&&peopleRef.current.step)||0;
const _stepTag=_stepCacheV?('|s'+((_simStep/STEP_CACHE_REGEN)|0)):'';
const _baseKey=_staticBase?(vm+'|'+(w._seed)+'|'+CH+'|'+(showPlatesRef.current?1:0)+(showRiversRef.current?1:0)+(showStreamsRef.current?1:0)+(showLakesRef.current?1:0)+'|'+(depthFromSeaRef.current?1:0)+'|'+depthCeilRef.current+'|'+(activeResRef.current||'')+'|'+oceanLevelRef.current+_stepTag):null;
let _baseHit=false;
if(_staticBase&&ctx&&baseLayerRef.current&&baseLayerRef.current.width===CW&&baseLayerRef.current.height===CH&&baseLayerKey.current===_baseKey){ctx.drawImage(baseLayerRef.current,0,0);_baseHit=true;}
if(!_baseHit){
if(vm==="depth"){
// Depth/heightmap view — flat black-to-white gradient using actual data range
// Find actual min/max elevation
let eMin=Infinity,eMax=-Infinity;
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const si=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H)))*W+Math.min(W-1,tx*RES);
const e=w.elevation[si];if(e<eMin)eMin=e;if(e>eMax)eMax=e;}
const floor=depthFromSeaRef.current?0:eMin;
const fullRange=eMax-floor||1;
const ceil=depthCeilRef.current;
const range=fullRange*ceil||1;
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];
const v=Math.min(255,Math.max(0,((e-floor)/range)*255))|0;
const pi4=ti<<2;d[pi4]=v;d[pi4+1]=v;d[pi4+2]=v;d[pi4+3]=255;}
}else if(vm==="wind"){
// Wind view — speed heatmap everywhere (land + ocean), like Windy.com
const wX=w.windX,wY=w.windY;
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w,ter);}
const tc=terrainCache.current;
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const pi4=ti<<2;
const e=w.elevation[si];
const vx=wX?wX[si]:0,vy=wY?wY[si]:0;
const spd=Math.sqrt(vx*vx+vy*vy);
const t=Math.min(1,Math.pow(spd*1.0,0.5));
// Speed heatmap matched to Windy.com: navy→blue→teal→green→yellow→orange→red
let r,g,b;
if(t<0.08){const s=t/0.08;r=(3+s*5)|0;g=(4+s*15)|0;b=(40+s*60)|0;}
else if(t<0.18){const s=(t-0.08)/0.10;r=(8+s*12)|0;g=(19+s*55)|0;b=(100+s*80)|0;}
else if(t<0.30){const s=(t-0.18)/0.12;r=(20+s*5)|0;g=(74+s*80)|0;b=(180-s*40)|0;}
else if(t<0.42){const s=(t-0.30)/0.12;r=(25-s*5)|0;g=(154+s*50)|0;b=(140-s*90)|0;}
else if(t<0.55){const s=(t-0.42)/0.13;r=(20+s*130)|0;g=(204+s*46)|0;b=(50-s*20)|0;}
else if(t<0.68){const s=(t-0.55)/0.13;r=(150+s*95)|0;g=(250-s*30)|0;b=(30-s*15)|0;}
else if(t<0.82){const s=(t-0.68)/0.14;r=(245+s*10)|0;g=(220-s*100)|0;b=(15+s*10)|0;}
else{const s=(t-0.82)/0.18;r=255;g=(120-s*80)|0;b=(25+s*15)|0;}
// Blend with dim terrain on land for topographic context
if(e>sl){
const landDim=0.25;const heatW=0.65;
const tr=(tc[ti*3]*landDim)|0,tg=(tc[ti*3+1]*landDim)|0,tb=(tc[ti*3+2]*landDim)|0;
r=(r*heatW+tr*(1-heatW))|0;g=(g*heatW+tg*(1-heatW))|0;b=(b*heatW+tb*(1-heatW))|0;
}
d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;}
}else if(vm==="transport-test"){
// Standalone test: each click placed a capital; the BFS claims tileLimit
// tiles per capital by cheapest transport cost using the test params.
// Tiles painted per-capital colour with brightness = inverse cost.
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w,ter);}
const tc=terrainCache.current;const ptw=ter.tw,pth=ter.th;
const res=ttResultRef.current;
const palette=[[230,80,80],[80,170,230],[110,210,110],[230,200,80],[200,120,220],[230,150,80],[100,220,200],[230,100,160]];
// Track per-tribe max cost for normalisation
let maxCost=1;if(res){for(let qi=0;qi<res.cost.length;qi++){if(res.ownerArr[qi]>=0&&res.cost[qi]<999&&res.cost[qi]>maxCost)maxCost=res.cost[qi];}}
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty2=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty2,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=0){d[pi4]=4;d[pi4+1]=5;d[pi4+2]=12;d[pi4+3]=255;continue;}
const ttx=Math.min(ptw-1,tx),tty=Math.min(pth-1,Math.round(screenYtoDataY(ty2,CH,H)/RES));
const tti=tty*ptw+ttx;
const ownerT=res?res.ownerArr[tti]:-1;
if(ownerT<0){
  // unclaimed — dim terrain
  d[pi4]=(tc[ti*3]*0.18)|0;d[pi4+1]=(tc[ti*3+1]*0.18)|0;d[pi4+2]=(tc[ti*3+2]*0.18)|0;d[pi4+3]=255;continue;
}
const col=palette[ownerT%palette.length];
const cc2=res.cost[tti];
// log-scale brightness: 0→full, maxCost→dim
const t=Math.min(1,Math.log10(cc2+1)/Math.log10(maxCost+1));
const bright=1-t*0.7;// dimmest 30% of full
d[pi4]=(col[0]*bright)|0;d[pi4+1]=(col[1]*bright)|0;d[pi4+2]=(col[2]*bright)|0;d[pi4+3]=255;
}
// Mark capitals with white dots
if(ttCapitalsRef.current){
  for(const c of ttCapitalsRef.current){
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const cx=c.x+dx,cy=c.y+dy;if(cy<0||cy>=pth)continue;
      const px=cx%CW,py=Math.min(CH-1,Math.round(dataYtoScreenY(cy,CH,H)));
      if(px<0||px>=CW||py<0||py>=CH)continue;
      const pi=(py*CW+px)<<2;d[pi]=240;d[pi+1]=240;d[pi+2]=240;d[pi+3]=255;
    }
  }
}
// Route mode: paint the path in cyan; endpoints in white
const rr=ttRouteResultRef.current;
if(rr&&rr.path){
  for(const pti of rr.path){
    const px2=pti%ptw,py2=(pti-px2)/ptw;
    const sx2=px2%CW,sy2=Math.min(CH-1,Math.round(dataYtoScreenY(py2,CH,H)));
    if(sx2<0||sx2>=CW||sy2<0||sy2>=CH)continue;
    const pi=(sy2*CW+sx2)<<2;d[pi]=30;d[pi+1]=220;d[pi+2]=240;d[pi+3]=255;
  }
}
// Endpoint markers
const epts=[];
if(ttRoute.start)epts.push(ttRoute.start);
if(ttRoute.end)epts.push(ttRoute.end);
for(const ep of epts){
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
    if(Math.abs(dx)+Math.abs(dy)>4)continue;
    const cx=ep.x+dx,cy=ep.y+dy;if(cy<0||cy>=pth)continue;
    const px=cx%CW,py=Math.min(CH-1,Math.round(dataYtoScreenY(cy,CH,H)));
    if(px<0||px>=CW||py<0||py>=CH)continue;
    const pi=(py*CW+px)<<2;d[pi]=255;d[pi+1]=255;d[pi+2]=180;d[pi+3]=255;
  }
}
}else if(vm==="fertility"){
// Fertility overlay — green (high) → yellow → red (low)
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=8;d[pi4+1]=12;d[pi4+2]=22;d[pi4+3]=255;continue;}
const v=Math.max(0,Math.min(1,ter.tFert[ti]));
let r,g,b;
if(v>0.5){const t2=(v-0.5)*2;r=((1-t2)*255)|0;g=200;b=((t2)*40)|0;}
else{const t2=v*2;r=220;g=(t2*200)|0;b=0;}
const shade=1-Math.max(0,e-0.1)*0.5;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else if(vm==="crop"){
// Crop suitability overlay — agronomic potential, sharper than tFert.
// Same green→yellow→red gradient as fertility; differences vs fert
// are visible where it matters (Amazon goes deeper red, temperate
// hill country tones down to yellow).
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=8;d[pi4+1]=12;d[pi4+2]=22;d[pi4+3]=255;continue;}
const v=Math.max(0,Math.min(1,ter.tCrop[ti]));
let r,g,b;
if(v>0.5){const t2=(v-0.5)*2;r=((1-t2)*255)|0;g=200;b=((t2)*40)|0;}
else{const t2=v*2;r=220;g=(t2*200)|0;b=0;}
const shade=1-Math.max(0,e-0.1)*0.5;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else if(vm==="crossing"){
// Crossing difficulty overlay — green (easy) → yellow → red (brutal).
// Same scalar the sim uses for transport routing, so dark-red areas
// on this map ARE the places where farm placement and trade routes
// will refuse to cross.
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=8;d[pi4+1]=12;d[pi4+2]=22;d[pi4+3]=255;continue;}
const v=Math.max(0,Math.min(1,ter.tCross[ti]));
let r,g,b;
if(v<0.5){const t2=v*2;r=(t2*220)|0;g=200;b=0;}
else{const t2=(v-0.5)*2;r=220;g=((1-t2)*200)|0;b=0;}
const shade=1-Math.max(0,e-0.1)*0.5;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else if(vm==="roads"){
// Road network overlay — empty parchment background, then roads
// drawn coloured-by-network so disconnected systems pop visually.
// Settlements drawn as small grey dots so you can see which
// communities each network connects.
for(let ti=0;ti<N;ti++){const pi4=ti<<2;
d[pi4]=240;d[pi4+1]=230;d[pi4+2]=205;d[pi4+3]=255;}
}else if(vm==="money"){
// Money-flow overlay — dark slate backdrop so gold sources and the
// flowing-coin particles glow. Land tiles a touch lighter than sea so
// coastlines stay legible. Roads + sources + flow drawn in the
// peopleSim overlay pass below.
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),sx=Math.min(W-1,tx*RES),si=sy*W+sx;
const land=w.elevation[si]>sl;const pi4=ti<<2;
d[pi4]=land?28:16;d[pi4+1]=land?30:18;d[pi4+2]=land?36:26;d[pi4+3]=255;}
}else if(vm==="resources"){
// Resource overlay — blend all active resource layers per tile
const ar=activeResRef.current;
const activeList=RESOURCES.filter(r=>ar[r.id]);
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=6;d[pi4+1]=8;d[pi4+2]=16;d[pi4+3]=255;continue;}
let br=0,bg=0,bb=0,totalW=0;
if(ter.deposits){
for(const r of activeList){
const v=ter.deposits[r.id][ti];
if(v>0.05){const w2=v*v;br+=r.color[0]*w2;bg+=r.color[1]*w2;bb+=r.color[2]*w2;totalW+=w2;}}}
if(totalW>0.001){const inv=1/totalW;br=(br*inv)|0;bg=(bg*inv)|0;bb=(bb*inv)|0;
const alpha=Math.min(0.95,Math.sqrt(totalW)*0.8+0.15);const invA=1-alpha;
br=(12*invA+br*alpha)|0;bg=(11*invA+bg*alpha)|0;bb=(10*invA+bb*alpha)|0;
}else{br=12;bg=11;bb=10;}
d[pi4]=br;d[pi4+1]=bg;d[pi4+2]=bb;d[pi4+3]=255;}
}else if(vm==="moisture"){
// Moisture overlay — brown (dry) → yellow → green → teal → blue (wet)
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){// Ocean: dim blue
d[pi4]=8;d[pi4+1]=15;d[pi4+2]=35;d[pi4+3]=255;continue;}
const m=ter.tMoist[ti];let r,g,b;
if(m<0.1){const s=m/0.1;r=(140+s*20)|0;g=(100+s*30)|0;b=(50+s*10)|0;}// brown (desert dry)
else if(m<0.25){const s=(m-0.1)/0.15;r=(160-s*50)|0;g=(130+s*50)|0;b=(60+s*10)|0;}// brown→olive
else if(m<0.4){const s=(m-0.25)/0.15;r=(110-s*60)|0;g=(180+s*20)|0;b=(70+s*20)|0;}// olive→green
else if(m<0.55){const s=(m-0.4)/0.15;r=(50-s*30)|0;g=(200-s*10)|0;b=(90+s*60)|0;}// green→teal
else if(m<0.7){const s=(m-0.55)/0.15;r=(20-s*10)|0;g=(190-s*40)|0;b=(150+s*50)|0;}// teal→blue-green
else if(m<0.85){const s=(m-0.7)/0.15;r=(10)|0;g=(150-s*80)|0;b=(200+s*30)|0;}// blue
else{const s=(m-0.85)/0.15;r=(10+s*20)|0;g=(70-s*30)|0;b=(230+s*25)|0;}// deep blue
// Darken with elevation for topographic context
const shade=1-Math.max(0,e-0.1)*0.4;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else if(vm==="temperature"){
// Temperature overlay — blue (cold) → cyan → green → yellow → orange → red (hot)
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){// Ocean temp: cooler than land in tropics, warmer than land at poles (water moderates)
const t=w.temperature[si];
// Ocean temp already adjusted in world gen. Just small display tweak:
// Warm ocean slightly cooler than raw value, cold ocean slightly warmer (water moderates)
const shift=t>0.8?-0.03:t>0.5?0:t>0.3?0.02:0.05;// warm→cool, cold→warm
const ot=Math.max(0.52,Math.min(1,t+shift));// floor at ~-8°C (near sea ice)
let r,g,b;
if(ot<0.20){const s=ot/0.20;r=(230-s*130)|0;g=(225-s*185)|0;b=(240-s*40)|0;}
else if(ot<0.40){const s=(ot-0.20)/0.20;r=(100-s*70)|0;g=(40-s*10)|0;b=(200-s*10)|0;}
else if(ot<0.50){const s=(ot-0.40)/0.10;r=(30+s*10)|0;g=(30+s*20)|0;b=(190-s*40)|0;}
else if(ot<0.60){const s=(ot-0.50)/0.10;r=(40+s*60)|0;g=(50+s*130)|0;b=(150+s*50)|0;}
else if(ot<0.70){const s=(ot-0.60)/0.10;r=(100-s*30)|0;g=(180+s*40)|0;b=(200-s*150)|0;}
else if(ot<0.80){const s=(ot-0.70)/0.10;r=(70+s*160)|0;g=(220+s*30)|0;b=(50-s*30)|0;}
else if(ot<0.90){const s=(ot-0.80)/0.10;r=(230+s*25)|0;g=(250-s*100)|0;b=(20-s*10)|0;}
else{const s=(ot-0.90)/0.10;r=255;g=(150-s*110)|0;b=(10+s*5)|0;}
d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;continue;}
const t=w.temperature[si];let r,g,b;
// Palette: white(-60°C) → purple(-20°C) → dark blue(-10°C) → light blue(0°C) → light green(10°C) → yellow(20°C) → orange(30°C) → red(40°C)
if(t<0.20){const s=t/0.20;r=(230-s*130)|0;g=(225-s*185)|0;b=(240-s*40)|0;}// white→purple (-60→-20°C)
else if(t<0.40){const s=(t-0.20)/0.20;r=(100-s*70)|0;g=(40-s*10)|0;b=(200-s*10)|0;}// purple→purple-blue (-20→-12°C) WIDER PURPLE
else if(t<0.50){const s=(t-0.40)/0.10;r=(30+s*10)|0;g=(30+s*20)|0;b=(190-s*40)|0;}// purple-blue→dark blue (-12→-10°C)
else if(t<0.60){const s=(t-0.50)/0.10;r=(40+s*60)|0;g=(50+s*130)|0;b=(150+s*50)|0;}// dark blue→light blue (-10→0°C)
else if(t<0.70){const s=(t-0.60)/0.10;r=(100-s*30)|0;g=(180+s*40)|0;b=(200-s*150)|0;}// light blue→light green (0→10°C)
else if(t<0.80){const s=(t-0.70)/0.10;r=(70+s*160)|0;g=(220+s*30)|0;b=(50-s*30)|0;}// light green→yellow (10→20°C)
else if(t<0.90){const s=(t-0.80)/0.10;r=(230+s*25)|0;g=(250-s*100)|0;b=(20-s*10)|0;}// yellow→orange (20→30°C)
else{const s=(t-0.90)/0.10;r=255;g=(150-s*110)|0;b=(10+s*5)|0;}// orange→red (30→40°C)
// Darken with elevation for topographic context
const shade=1-Math.max(0,e-0.1)*0.4;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else if(vm==="atlas"){
// Olde-map "Atlas" view — cached parchment render, rebuilt only when world/projection changes
if(!atlasCache.current||atlasCache.current.seed!==w._seed||atlasCache.current.ch!==CH){
atlasCache.current={img:buildAtlas(w,ter),seed:w._seed,ch:CH};}
d.set(atlasCache.current.img.data);
}else{
// Default terrain view with white tribe borders
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w,ter);}
const tc=terrainCache.current;
for(let ti=0;ti<N;ti++){const ow=ter.owner[ti];
const pi4=ti<<2,ti3=ti*3;
const tr=tc[ti3],tg=tc[ti3+1],tb=tc[ti3+2];
if(ow>=0&&ter.tElev[ti]>sl){
const tx3=ti%ter.tw,ty3=(ti-tx3)/ter.tw;let isBorder=false;
for(let di=0;di<4;di++){
const dnx=((tx3+DIRS[di][0])%ter.tw+ter.tw)%ter.tw,dny=ty3+DIRS[di][1];
if(dny<0||dny>=ter.th){isBorder=true;break;}
if(ter.owner[dny*ter.tw+dnx]!==ow){isBorder=true;break;}}
if(isBorder){// White border over terrain
d[pi4]=(tr*0.4+200*0.6+.5)|0;d[pi4+1]=(tg*0.4+195*0.6+.5)|0;d[pi4+2]=(tb*0.4+185*0.6+.5)|0;
}else{d[pi4]=tr;d[pi4+1]=tg;d[pi4+2]=tb;}// pure terrain inside
}else{d[pi4]=tr;d[pi4+1]=tg;d[pi4+2]=tb;}
d[pi4+3]=255;}}
// Plate boundary overlay — domain-warped lookup for organic boundaries
if(showPlatesRef.current&&w.pixPlate&&vm!=="atlas"){
const plateAt=(px,py)=>{
const nx=px/W,ny=py/H;
// Same multi-scale warp as tectonicGen elevation sampling
const wx=px+fbm(nx*1.5+200,ny*1.5+200,4,2,0.5)*12+fbm(nx*4+300,ny*4+300,3,2,0.5)*4.8+fbm(nx*10+400,ny*10+400,2,2,0.5)*1.6;
const wy=py+fbm(nx*1.5+250,ny*1.5+250,4,2,0.5)*12+fbm(nx*4+350,ny*4+350,3,2,0.5)*4.8+fbm(nx*10+450,ny*10+450,2,2,0.5)*1.6;
const sx2=Math.max(0,Math.min(W-1,Math.round(wx))),sy2=Math.max(0,Math.min(H-1,Math.round(wy)));
return w.pixPlate[sy2*W+sx2];};
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H)));
const myP=plateAt(sx,sy);let boundary=false;
for(let dy=-RES;dy<=RES&&!boundary;dy+=RES)for(let dx=-RES;dx<=RES&&!boundary;dx+=RES){
if(!dx&&!dy)continue;
const nx2=(sx+dx+W)%W,ny2=sy+dy;if(ny2<0||ny2>=H)continue;
if(plateAt(nx2,ny2)!==myP)boundary=true;}
if(boundary){const pi4=ti<<2;d[pi4]=200;d[pi4+1]=60;d[pi4+2]=40;}}}
// Lake overlay
if(showLakesRef.current&&lk&&vm!=="atlas"){for(let ti=0;ti<N;ti++){if(lk[ti]<0)continue;
const pi4=ti<<2;d[pi4]=25;d[pi4+1]=60;d[pi4+2]=105;d[pi4+3]=255;}}
// River overlay — Rivers: tributary+. Streams: streams only.
if(ter.rivers&&vm!=="atlas"){const rm=ter.rivers.riverMag;
const rivers=showRiversRef.current,streams=showStreamsRef.current;
if(rivers||streams){
for(let ti=0;ti<N;ti++){const mag=rm[ti];if(mag<1)continue;
const pi4=ti<<2;
if(mag>=4&&rivers){d[pi4]=55;d[pi4+1]=150;d[pi4+2]=245;}
else if(mag>=3&&rivers){d[pi4]=45;d[pi4+1]=120;d[pi4+2]=220;}
else if(mag>=2&&rivers){d[pi4]=35;d[pi4+1]=95;d[pi4+2]=190;}
else if(mag===1&&streams){const a=0.45;d[pi4]=(d[pi4]*(1-a)+25*a)|0;d[pi4+1]=(d[pi4+1]*(1-a)+65*a)|0;d[pi4+2]=(d[pi4+2]*(1-a)+150*a)|0;}}}}
// Update globe texture from rendered canvas data (supports all view modes).
// The 25MB buffer is allocated ONCE and reused, and the rebuild is throttled
// to ~4Hz — building + re-uploading a 4096×2048 texture on every snapshot
// (30/s) churned ~750MB/s of allocations while the globe was open.
if(showGlobeRef.current){
const _gNow=performance.now();
if(_gNow-(globeStampRef.current||0)>=250){
globeStampRef.current=_gNow;
const gW=4096,gH=2048;
let buf=globeBufScratchRef.current;
if(!buf||buf.length!==gW*gH*3){buf=globeBufScratchRef.current=new Uint8Array(gW*gH*3);}
for(let gy=0;gy<gH;gy++){
const lat=Math.abs(gy/gH-0.5)*2;
const polarBlend=Math.max(0,Math.min(1,(lat-0.83)/0.17));
const sy=gy/gH*CH;
const sy0=Math.min(CH-2,sy|0),fy=sy-sy0;
for(let gx=0;gx<gW;gx++){
const sx=gx/gW*CW;
const sx0=Math.min(CW-2,sx|0),fx=sx-sx0;
// Bilinear sample from canvas ImageData
const p00=(sy0*CW+sx0)*4,p10=(sy0*CW+sx0+1)*4;
const p01=((sy0+1)*CW+sx0)*4,p11=((sy0+1)*CW+sx0+1)*4;
let r=(d[p00]*(1-fx)+d[p10]*fx)*(1-fy)+(d[p01]*(1-fx)+d[p11]*fx)*fy;
let g=(d[p00+1]*(1-fx)+d[p10+1]*fx)*(1-fy)+(d[p01+1]*(1-fx)+d[p11+1]*fx)*fy;
let b=(d[p00+2]*(1-fx)+d[p10+2]*fx)*(1-fy)+(d[p01+2]*(1-fx)+d[p11+2]*fx)*fy;
if(polarBlend>0){const pr=220,pg=225,pb=235;
r=r*(1-polarBlend)+pr*polarBlend;g=g*(1-polarBlend)+pg*polarBlend;b=b*(1-polarBlend)+pb*polarBlend;}
const ti3=(gy*gW+gx)*3;buf[ti3]=r|0;buf[ti3+1]=g|0;buf[ti3+2]=b|0;}}
setGlobeBuf(buf);setGlobeTexSize({w:gW,h:gH});setGlobeVer(v=>v+1);}
}
}
if(!ctx)return;
if(!_baseHit){
  if(_staticBase){
    // Stash the freshly-built base into the offscreen cache, then blit it.
    if(!baseLayerRef.current)baseLayerRef.current=document.createElement('canvas');
    const _bl=baseLayerRef.current;if(_bl.width!==CW||_bl.height!==CH){_bl.width=CW;_bl.height=CH;}
    _bl.getContext('2d').putImageData(img,0,0);ctx.drawImage(_bl,0,0);baseLayerKey.current=_baseKey;
  }else{
    // Non-cached views: route the image data through a temp canvas so the
    // pan/zoom transform (set on ctx above) applies to the blit. putImageData
    // ignores the active transform and would otherwise paint at literal 0,0.
    if(!baseLayerRef.current)baseLayerRef.current=document.createElement('canvas');
    const _bl=baseLayerRef.current;if(_bl.width!==CW||_bl.height!==CH){_bl.width=CW;_bl.height=CH;}
    _bl.getContext('2d').putImageData(img,0,0);ctx.drawImage(_bl,0,0);
  }
}
// Wind particles — animated white streaks that flow along wind vectors
if(vm==="wind"&&w.windX&&w.windY){
const NUM_PARTICLES=3000;const TRAIL_LEN=12;const MAX_AGE=80;
// Initialize particles if needed
if(!windParticlesRef.current||windParticlesRef.current.length!==NUM_PARTICLES){
windParticlesRef.current=[];
for(let i=0;i<NUM_PARTICLES;i++){
windParticlesRef.current.push({x:Math.random()*CW,y:Math.random()*CH,
age:Math.random()*MAX_AGE|0,trail:[]});}}
const particles=windParticlesRef.current;
const wX=w.windX,wY=w.windY;
// Step + draw each particle
ctx.lineCap="round";
for(let i=0;i<particles.length;i++){
const p=particles[i];
// Sample wind at particle position (screen → data via Mercator)
const sx=Math.min(W-1,(p.x*RES)|0),sy=Math.min(H-1,Math.round(screenYtoDataY(p.y,CH,H))),si=sy*W+sx;
const vx=wX[si]||0,vy=wY[si]||0;
const spd=Math.sqrt(vx*vx+vy*vy);
// Move particle along wind (speed scaled for visual effect)
const moveScale=5;
p.trail.push({x:p.x,y:p.y});
if(p.trail.length>TRAIL_LEN)p.trail.shift();
p.x+=vx*moveScale;p.y+=vy*moveScale;
p.age++;
// Respawn if out of bounds, too old, or in dead air
if(p.x<0||p.x>=CW||p.y<0||p.y>=CH||p.age>MAX_AGE||spd<0.002){
// Bias respawn toward faster wind areas: try a few random spots, keep the windiest
let bestX=Math.random()*CW,bestY=Math.random()*CH,bestSpd=0;
for(let t=0;t<3;t++){
const cx=Math.random()*CW,cy=Math.random()*CH;
const csx=Math.min(W-1,(cx*RES)|0),csy=Math.min(H-1,Math.round(screenYtoDataY(cy,CH,H)));
const cvx=wX[csy*W+csx]||0,cvy=wY[csy*W+csx]||0;
const cs=cvx*cvx+cvy*cvy;
if(cs>bestSpd){bestSpd=cs;bestX=cx;bestY=cy;}}
p.x=bestX;p.y=bestY;p.age=0;p.trail.length=0;continue;}
// Draw trail — fading white line
if(p.trail.length<2)continue;
const fadeIn=Math.min(1,p.age/8);const fadeOut=Math.max(0,1-(p.age-MAX_AGE+15)/15);
const brightness=fadeIn*fadeOut;
for(let j=1;j<p.trail.length;j++){
const segAlpha=(j/p.trail.length)*brightness*0.7;
if(segAlpha<0.02)continue;
const lw=0.4+(j/p.trail.length)*1.0;
ctx.strokeStyle=`rgba(255,255,255,${segAlpha.toFixed(2)})`;
ctx.lineWidth=lw;
ctx.beginPath();ctx.moveTo(p.trail[j-1].x,p.trail[j-1].y);ctx.lineTo(p.trail[j].x,p.trail[j].y);ctx.stroke();}
// Draw head dot
const headAlpha=brightness*0.9;
ctx.fillStyle=`rgba(255,255,255,${headAlpha.toFixed(2)})`;
ctx.beginPath();ctx.arc(p.x,p.y,0.8,0,Math.PI*2);ctx.fill();}
}
// ── peopleSim entity overlay ────────────────────────────────────────
// When vm === "roads", render ONLY the road network — no farmland,
// no settlement icons. Each disconnected network (closed graph of
// roads + settlements) is coloured distinctly so the player can
// see at a glance which settlements trade with each other.
// Otherwise: normal rendering of farmland + roads + settlement icons.
{
  const psw=peopleRef.current;
  const vmRoads = viewRef.current === "roads";
  const vmMoney = viewRef.current === "money";
  const vmCountry = viewRef.current === "country";
  const vmFR = viewRef.current === "frTerritory";
  if(psw&&ctx&&vmRoads){
    const TR=psw.tileRes;
    // ── Network components per tile ── world._tileComp is an Int32Array of
    // component-root ids. On the REAL world it's stamp-validated (only valid
    // where _tileCompSeen === _tileCompStampVal); the worker MIRROR ships a
    // pre-cleaned copy (-1 = no component). compAt() reads the root or -1.
    const tc=psw._tileComp,tcSeen=psw._tileCompSeen,tcStamp=psw._tileCompStampVal;
    const compAt = tc ? (tcSeen ? (ti)=>(tcSeen[ti]===tcStamp?tc[ti]:-1) : (ti)=>tc[ti]) : null;
    const find = (sid) => {
      const s = psw.settlements.find(o => o.id === sid);
      if (!s) return sid;
      const ti = (s.pos.y | 0) * psw.tw + (s.pos.x | 0);
      const c = compAt ? compAt(ti) : -1;
      return c >= 0 ? c : sid;
    };
    const compColour = (rootId) => {
      const h = ((rootId * 137) % 360 + 360) % 360;
      return `hsl(${h}, 65%, 45%)`;
    };
    // ── Tier filter (Layers panel): drop any component whose ONLY settlements
    // belong to hidden tiers, so only roads connecting the active tiers show.
    const _Lr=layersRef.current;
    const tierShowR=[_Lr.village,_Lr.town,_Lr.city,_Lr.metropolis];
    const allTiers=tierShowR.every(Boolean);
    let compVisible=null;
    if(!allTiers){
      compVisible=new Set();
      for(const s of psw.settlements){
        if(!s||s.mode!=="settled")continue;
        if(!tierShowR[s.tier|0])continue;
        const ti=(s.pos.y|0)*psw.tw+(s.pos.x|0);
        const c=compAt?compAt(ti):-1;
        compVisible.add(c>=0?c:s.id);
      }
    }
    const _showComp=c=>allTiers||compVisible.has(c);
    // ── Draw road tiles, coloured by their component (or a uniform colour
    // when component data isn't available yet) ──
    if(_Lr.roads&&psw.roadQuality){
      const rq=psw.roadQuality;
      for(let ti=0;ti<rq.length;ti++){
        if(rq[ti]>=1.0)continue;
        const comp=compAt?compAt(ti):-1;
        if(comp>=0&&!_showComp(comp))continue;
        const py=(ti/psw.tw)|0,px=ti-py*psw.tw;
        const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
        ctx.fillStyle=comp>=0?compColour(comp):"rgba(150,110,60,0.9)";
        ctx.fillRect(sx,sy,TR,TR);
      }
    }
    // ── Settlement dots, also coloured by network ──
    // Smaller than the normal icons so the road shapes dominate;
    // every settlement shown so isolated ones (no roads) are
    // visible as their own coloured dot too.
    if(_Lr.icons)for(const s of psw.settlements){
      if(!s||s.mode!=="settled")continue;
      if(!tierShowR[s.tier|0])continue;
      const sx=s.pos.x*TR;
      const sy=dataYtoScreenY(s.pos.y*TR,H,CH);
      const root=find(s.id);
      ctx.beginPath();
      ctx.arc(sx,sy,3,0,Math.PI*2);
      ctx.fillStyle=compColour(root);
      ctx.fill();
      ctx.lineWidth=0.6;
      ctx.strokeStyle="rgba(0,0,0,0.5)";
      ctx.stroke();
    }
  }
  if(psw&&ctx&&vmMoney&&layersRef.current.moneyFlow){
    // ── Money-flow overlay ──────────────────────────────────────────
    // Maps the economy: where money is minted (mining), which way it
    // flows along roads, and which settlements are gaining vs losing it.
    const TR=psw.tileRes;
    const sx=ti=>((ti%psw.tw)+0.5)*TR;
    const sy=ti=>dataYtoScreenY(((ti/psw.tw|0)+0.5)*TR,H,CH);
    // 1) Faint road network, so the flow has visible channels.
    if(psw.roadQuality){
      const rq=psw.roadQuality;
      ctx.fillStyle="rgba(150,160,180,0.18)";
      for(let ti=0;ti<rq.length;ti++){
        if(rq[ti]>=1.0)continue;
        const py=(ti/psw.tw)|0,px=ti-py*psw.tw;
        ctx.fillRect(px*TR,dataYtoScreenY(py*TR,H,CH),TR,TR);
      }
    }
    // 2) Animated coin particles streaming along trade links in the net-money
    // direction. EVERY active link gets a stream of coins at a roughly constant
    // spacing (busier links pack them tighter + brighter), so the whole live
    // trade network reads as "money in motion". (The old code shared one global
    // budget by sqrt(mag); with 1500+ links each link's share rounded to zero,
    // so only the busiest ~100 links ever showed a single dot — the map looked
    // empty despite a thriving economy.) Coins are binned into a few brightness
    // buckets and drawn in batches, so thousands of them cost ~4 fillStyle
    // changes instead of one per link.
    const flows=psw._moneyFlows;
    if(flows&&flows.length){
      let maxMag=0;for(const f of flows){if(f.mag>maxMag)maxMag=f.mag;}
      const logMax=Math.log1p(maxMag);
      const NB=4, CAPB=2600;                 // brightness buckets · per-bucket dot cap (perf safety)
      let mb=moneyDotsRef.current;
      if(!mb||mb.cap!==CAPB){mb={cap:CAPB,n:new Int32Array(NB),xy:Array.from({length:NB},()=>new Float32Array(CAPB*2))};moneyDotsRef.current=mb;}
      for(let b=0;b<NB;b++)mb.n[b]=0;
      const now=performance.now();
      const period=2600;                     // ms for a coin to traverse a link
      for(const f of flows){
        const pts=f.tiles;const np=pts.length;if(np<2)continue;
        // busyness 0..1 (log so a giant trunk doesn't flatten the rest); sets
        // both the brightness bucket and the coin spacing.
        const busy=logMax>0?Math.log1p(f.mag)/logMax:0;
        const b=Math.min(NB-1,(busy*NB)|0);
        if(mb.n[b]>=mb.cap)continue;          // bucket full (faintest links drop first; trunks live in higher buckets)
        const spacing=14-9*busy;             // tiles per coin: ~14 (faint) → ~5 (busiest)
        let dots=Math.round(np/spacing);if(dots<1)dots=1;else if(dots>20)dots=20;
        // Per-link phase from the start tile (golden-ratio hash) so the
        // thousands of single-coin links don't all pulse in lockstep.
        const ph=(pts[0]*0.6180339887)%1;
        const arr=mb.xy[b];let cnt=mb.n[b];
        for(let j=0;j<dots;j++){
          let u=((now/period)+(j/dots)+ph)%1;
          if(!f.toEnd)u=1-u;                 // reverse direction
          const fi=u*(np-1);const i0=fi|0;const i1=Math.min(np-1,i0+1);const fr=fi-i0;
          const x0=sx(pts[i0]),x1=sx(pts[i1]);
          const y0=sy(pts[i0]),y1=sy(pts[i1]);
          if(Math.abs(x1-x0)>CW*0.5)continue;   // skip segments that wrap the seam
          if(cnt>=mb.cap)break;
          arr[cnt*2]=x0+(x1-x0)*fr;arr[cnt*2+1]=y0+(y1-y0)*fr;cnt++;
        }
        mb.n[b]=cnt;
      }
      // Batched draw: one fillStyle per brightness bucket, cheap fillRect coins.
      const ALPHA=[0.42,0.60,0.77,0.95];
      for(let b=0;b<NB;b++){
        const cnt=mb.n[b];if(!cnt)continue;
        ctx.fillStyle=`rgba(255,205,70,${ALPHA[b]})`;
        const arr=mb.xy[b];
        for(let q=0;q<cnt;q++)ctx.fillRect(arr[q*2]-1.1,arr[q*2+1]-1.1,2.2,2.2);
      }
    }
    // 3) Per-settlement markers (the net-wealth node dots and the gold
    // mining-source glow) are intentionally NOT drawn — this view shows ONLY
    // the flowing money, so the trade itself is the whole picture.
  }
  if(psw&&ctx&&!vmRoads&&!vmMoney){
    const TR=psw.tileRes;
    // ── Territory tint + borders + roads ── cached to an offscreen canvas
    // and regenerated only every PS_OVERLAY_REGEN sim-steps (it's a pure
    // function of owner[]/roadQuality[], which change slowly), then blitted.
    // This took ~460k per-tile fillRect+Map.get ops off EVERY frame.
    const PS_OVERLAY_REGEN=30;
    let ov=psOverlayRef.current;
    if(!ov||ov.width!==CW||ov.height!==CH){
      ov=psOverlayRef.current=(typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(CW,CH):document.createElement('canvas'));
      ov.width=CW;ov.height=CH;psOverlayMeta.current.step=-1;
    }
    const meta=psOverlayMeta.current;
    const stepNow=psw.step||0;
    const L=layersRef.current;
    // Toggle key — when any of the rendered-into-overlay layers flips on/off
    // we must rebuild, otherwise the cached image stays stale.
    const layerKey=(L.tints?1:0)|(L.borders?2:0)|(L.roads?4:0)|(L.provinces?8:0)|(vmCountry?16:0)|(vmFR?32:0);
    if(meta.step<0||meta.ch!==CH||stepNow<meta.step||stepNow-meta.step>=PS_OVERLAY_REGEN||meta.layerKey!==layerKey){
      meta.layerKey=layerKey;
      const octx=ov.getContext('2d');
      octx.clearRect(0,0,CW,CH);
      // National territory tints + dotted borders. Prefer the SMOOTH national
      // CLAIM (countryId per tile, peopleSim/countryClaim.js) — country-centric
      // borders that follow terrain and enclose frontier hinterland; fall back
      // to the per-settlement owner map only until the first claim arrives.
      const owner=psw._territoryOwner, claimArr=psw._countryClaim;
      // ── Country view: BOLD opaque political map with thick borders + live,
      // maximally-distinct neighbour colours (assignCountryColors). ──
      if(vmCountry&&claimArr){
        const tw=psw.tw,th=psw.th;
        const hues=assignCountryColors(claimArr,tw,th,countryColorsRef.current);
        countryColorsRef.current=hues;
        const fillByCountry=new Map();
        // opaque bold fills (cover the terrain so the colours read clean)
        let lastFs=null;
        for(let ti=0;ti<claimArr.length;ti++){
          const cc=claimArr[ti];if(cc<0)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          let fs=fillByCountry.get(cc);
          if(fs===undefined){const h=(hues.get(cc)??((cc*61)%360+360)%360)|0;fs=`hsl(${h},60%,50%)`;fillByCountry.set(cc,fs);}
          if(fs!==lastFs){octx.fillStyle=fs;lastFs=fs;}
          octx.fillRect(sx,sy,TR+0.6,TR+0.6);   // slight overdraw kills inter-tile seams
        }
        // thick dark borders between neighbouring countries
        octx.strokeStyle="rgba(8,8,12,0.92)";octx.lineWidth=Math.max(1.6,TR*1.1);octx.lineJoin="round";octx.lineCap="round";octx.beginPath();
        for(let ti=0;ti<claimArr.length;ti++){
          const cc=claimArr[ti];if(cc<0)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          const ro=claimArr[py*tw+(px===tw-1?0:px+1)];
          if(ro>=0&&ro!==cc){const ex=(px+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
          if(py<th-1){const dno=claimArr[ti+tw];if(dno>=0&&dno!==cc){const by=dataYtoScreenY((py+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}
        }
        octx.stroke();
      }
      if(!vmCountry&&!vmFR&&(L.tints||L.borders)&&claimArr){
        const tw=psw.tw,th=psw.th,tintByCountry=new Map();
        if(L.borders){octx.strokeStyle="rgba(15,15,15,0.8)";octx.lineWidth=1;octx.setLineDash([2,2]);octx.beginPath();}
        let lastFs=null;
        for(let ti=0;ti<claimArr.length;ti++){
          const cc=claimArr[ti];if(cc<0)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          if(L.tints){
            let fs=tintByCountry.get(cc);
            if(fs===undefined){const h=((cc*61)%360+360)%360;fs=`hsla(${h},50%,50%,0.34)`;tintByCountry.set(cc,fs);}
            if(fs!==lastFs){octx.fillStyle=fs;lastFs=fs;}
            octx.fillRect(sx,sy,TR,TR);
          }
          if(!L.borders)continue;
          const ro=claimArr[py*tw+(px===tw-1?0:px+1)];
          if(ro>=0&&ro!==cc){const ex=(px+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
          if(py<th-1){const dno=claimArr[ti+tw];
            if(dno>=0&&dno!==cc){const by=dataYtoScreenY((py+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}
        }
        if(L.borders){octx.stroke();octx.setLineDash([]);}
      } else if(!vmCountry&&!vmFR&&(L.tints||L.borders)&&owner){
        const tw=psw.tw,th=psw.th;
        let maxId=0; for(const s of psw.settlements){if(s&&s.mode==="settled"&&s.id>maxId)maxId=s.id;}
        const tintById=new Array(maxId+1); const ctryById=new Int32Array(maxId+1).fill(-1);
        const tintByCountry=new Map();
        for(const s of psw.settlements){if(s&&s.mode==="settled"){
          let t=tintByCountry.get(s.countryId);
          if(t===undefined){const h=((s.countryId*61)%360+360)%360;t=`hsla(${h},50%,50%,0.32)`;tintByCountry.set(s.countryId,t);}
          tintById[s.id]=t; ctryById[s.id]=s.countryId;
        }}
        if(L.borders){octx.strokeStyle="rgba(15,15,15,0.8)";octx.lineWidth=1;octx.setLineDash([2,2]);octx.beginPath();}
        let lastFs=null;
        for(let ti=0;ti<owner.length;ti++){
          const oid=owner[ti];if(oid<0)continue;
          const fs=tintById[oid];if(fs===undefined)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          if(L.tints){
            if(fs!==lastFs){octx.fillStyle=fs;lastFs=fs;}
            octx.fillRect(sx,sy,TR,TR);
          }
          if(!L.borders)continue;
          const co=ctryById[oid];
          const ro=owner[py*tw+(px===tw-1?0:px+1)];
          if(ro>=0&&ro!==oid&&ctryById[ro]!==co){const ex=(px+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
          if(py<th-1){const dno=owner[ti+tw];
            if(dno>=0&&dno!==oid&&ctryById[dno]!==co){const by=dataYtoScreenY((py+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}
        }
        if(L.borders){octx.stroke();octx.setLineDash([]);}
      }
      // ── Farming-Region territory view: outline EACH settlement's economic
      // catchment (_territoryOwner — the food-producing land it administers).
      // With urban nodes releasing their land, these ARE the farming regions, so
      // you can see how much land each rural region holds (often a country's
      // de-facto core). Tint per region + a solid edge wherever the owner changes
      // (including against wilderness), so every region's territory is outlined.
      if(vmFR&&owner){
        const tw=psw.tw,th=psw.th;
        let maxId=0; for(const s of psw.settlements){if(s&&s.mode==="settled"&&s.id>maxId)maxId=s.id;}
        const tintById=new Array(maxId+1);
        for(const s of psw.settlements){if(s&&s.mode==="settled"){
          const h=((s.id*97)%360+360)%360;
          tintById[s.id]=`hsla(${h},55%,52%,${(s.tier|0)===0?0.42:0.24})`;
        }}
        let lastFs=null;
        for(let ti=0;ti<owner.length;ti++){
          const oid=owner[ti];if(oid<0)continue;
          const fs=tintById[oid];if(fs===undefined)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          if(fs!==lastFs){octx.fillStyle=fs;lastFs=fs;}
          octx.fillRect(sx,sy,TR+0.6,TR+0.6);
        }
        octx.strokeStyle="rgba(25,18,8,0.85)";octx.lineWidth=Math.max(1,TR*0.5);octx.lineJoin="round";octx.lineCap="round";octx.beginPath();
        for(let ti=0;ti<owner.length;ti++){
          const oid=owner[ti];if(oid<0)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          const ro=owner[py*tw+(px===tw-1?0:px+1)];
          if(ro!==oid){const ex=(px+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
          if(py<th-1){const dno=owner[ti+tw];if(dno!==oid){const by=dataYtoScreenY((py+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}
        }
        octx.stroke();
      }
      // ── Province borders (Layers → Provinces) ──
      // Internal administrative divisions. A province follows the SIM's own
      // territory, not a fresh geometric guess: every tile is taken by the
      // settlement that ADMINISTERS it (_territoryOwner — the transport-cost
      // catchment), and that settlement's province is:
      //   • a CAPTURED town → its _homeland (the nation it was conquered from),
      //     so an absorbed country stays ONE province bordered by its FORMER
      //     extent (the conquered-border lines), until it assimilates (~HOMELAND_
      //     MEMORY) and rejoins the core; and
      //   • a NATIVE town → its administrative seat (_provinceCity, the nearest
      //     CITY by the sim's reach), so the heartland splits into city regions.
      // Because the cells are unions of transport catchments they BEND with
      // terrain (no straight Euclidean bisectors). Captured-nation provinces use
      // negative keys so they never collide with a native city-seat id. Tiles
      // with no settlement catchment (gap-filled interior) fall back to nearest
      // city. Drawn lighter/dotted beneath the national border.
      if(L.provinces&&claimArr){
        const tw=psw.tw,th=psw.th,halfTw=tw/2;
        const provById=new Map();   // settlementId → province key (neg = captured nation)
        const cityList=new Map();   // countryId → [cities] (fallback for catchment-less tiles)
        for(const s of psw.settlements){if(!(s&&s.mode==="settled"&&s.countryId>=0))continue;
          const hl=s._homeland??-1; const captured=hl>=0&&hl!==s.countryId;   // ignore a stale self-home
          provById.set(s.id, captured ? -(hl+2) : ((s._provinceCity??-1)>=0 ? s._provinceCity : s.countryId));
          if((s.tier|0)>=2){let a=cityList.get(s.countryId);if(!a)cityList.set(s.countryId,a=[]);a.push(s);}}
        const nearestCity=(ti,cc)=>{const arr=cityList.get(cc);if(!arr)return cc;if(arr.length===1)return arr[0].id;
          const py=((ti/tw)|0)+0.5,px=(ti-((ti/tw)|0)*tw)+0.5;let best=cc,bd=Infinity;
          for(const c of arr){let dx=Math.abs(c.pos.x-px);if(dx>halfTw)dx=tw-dx;const dy=c.pos.y-py;const d=dx*dx+dy*dy;if(d<bd){bd=d;best=c.id;}}return best;};
        const prov=new Int32Array(claimArr.length).fill(-2147483648);   // sentinel = unset
        for(let ti=0;ti<claimArr.length;ti++){
          const cc=claimArr[ti];if(cc<0)continue;
          const sid=owner?owner[ti]:-1;
          let pv=sid>=0?provById.get(sid):undefined;
          prov[ti]=pv!==undefined?pv:nearestCity(ti,cc);   // catchment province, else nearest-city fallback
        }
        // Two pens. A border touching a CAPTURED-nation province (negative key) is
        // a former national frontier inside the realm — drawn heavier/longer-dashed
        // so a conquered country's old outline reads as historically significant;
        // ordinary city-seam borders in the heartland stay faint dots.
        const drawSeams=(heritage)=>{
          for(let ti=0;ti<claimArr.length;ti++){
            const cc=claimArr[ti];if(cc<0)continue;const pv=prov[ti];
            const py=(ti/tw)|0,px=ti-py*tw;const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
            const rti=py*tw+(px===tw-1?0:px+1);
            if(claimArr[rti]===cc){const qv=prov[rti];if(qv!==pv&&((pv<0||qv<0)===heritage)){const ex=(px+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}}
            if(py<th-1){const dti=ti+tw;if(claimArr[dti]===cc){const qv=prov[dti];if(qv!==pv&&((pv<0||qv<0)===heritage)){const by=dataYtoScreenY((py+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}}
          }
        };
        octx.strokeStyle="rgba(20,20,20,0.45)";octx.lineWidth=1;octx.setLineDash([1,2]);octx.beginPath();drawSeams(false);octx.stroke();
        octx.strokeStyle="rgba(15,15,15,0.75)";octx.lineWidth=1;octx.setLineDash([3,2]);octx.beginPath();drawSeams(true);octx.stroke();
        octx.setLineDash([]);
      }
      // Roads — thickness + alpha from current flow.
      if(L.roads&&psw.roadQuality&&psw.roadFlow){
        const rq=psw.roadQuality,rf=psw.roadFlow,FLOW_FULL=50;
        for(let ti=0;ti<rq.length;ti++){
          if(rq[ti]>=1.0)continue;
          const py=(ti/psw.tw)|0,px=ti-py*psw.tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          const intensity=Math.min(1,(rf[ti]||0)/FLOW_FULL);
          const w=1.4+intensity*1.6,off=(TR-w)*0.5;
          octx.fillStyle=`rgba(120,80,40,${(0.55+intensity*0.35).toFixed(2)})`;
          octx.fillRect(sx+off,sy+off,w,w);
        }
      }
      meta.step=stepNow;meta.ch=CH;
    }
    ctx.drawImage(ov,0,0);
    // ── Settlement glyphs ──
    // Compact single-glyph per settlement, much smaller than the old
    // building-cluster sprite. Tier picks the SHAPE (village=dot,
    // town=square, city=diamond, metropolis=larger diamond), the FILL is
    // wealth-tinted, and overlay marks layer on top to communicate:
    //   – garrison size (armoured outline)
    //   – active shock (red plague / amber famine outline)
    //   – capital (gold star above — kept from old code)
    //   – provincial seat (small ring above — kept)
    //   – selection (gold halo)
    // Sizing scales with √log(pop) so a metropolis is visibly bigger than a
    // hamlet, but the dynamic range is small — the visual distinction comes
    // from SHAPE + COLOUR + DECORATION, not raw size.
    // Icons live in canvas-pixel coordinates inside the view transform, so
    // they grow with zoom naturally (a metropolis at 8x zoom IS 8x bigger,
    // because that's the point of zooming in — more detail). iconScale is
    // kept as a knob for fine-tuning but stays at 1 here so the visible
    // size scales 1:1 with the user's zoom level.
    const iconScale=1;
    // Pop → "weight" 0..1 (log scale across the population range).
    let _popMax=1;
    for(const s of psw.settlements){if(s&&s.mode==="settled"&&s.people>_popMax)_popMax=s.people;}
    const _logMax=Math.log(Math.max(2,_popMax));
    const popWeight=p=>Math.max(0,Math.min(1,Math.log(Math.max(1,p))/_logMax));
    const selId=selectedSettlementIdRef.current;
    const capitalIds=new Set();
    if(psw.countries)for(const c of psw.countries.values())if(c.capital)capitalIds.add(c.capital.id);
    // Tier sizes (canvas pixels at zoom=1) — village dot, town square, city
    // diamond, metropolis bigger diamond.
    const tierBaseSize=[1.6,2.4,3.4,4.6];
    // Per-tier visibility (Layers panel). When all tiers are off the loop
    // does nothing — same as turning icons off entirely.
    const _L=layersRef.current;
    const tierShow=[_L.icons&&_L.village,_L.icons&&_L.town,_L.icons&&_L.city,_L.icons&&_L.metropolis];
    for(const s of psw.settlements){
      if(!s||s.mode!=="settled")continue;
      if(!tierShow[s.tier|0])continue;
      const sx=s.pos.x*TR;
      const sy=dataYtoScreenY(s.pos.y*TR,H,CH);
      const tier=s.tier|0;
      const pw=popWeight(s.people);
      // Size: base by tier + small √pop boost within tier, scaled for zoom.
      const r=(tierBaseSize[tier]||2)*(0.85+pw*0.35)*iconScale;
      // Selection halo — bright gold ring behind the glyph.
      if(s.id===selId){
        ctx.beginPath();ctx.arc(sx,sy,r+3*iconScale,0,Math.PI*2);
        ctx.fillStyle="rgba(255,215,90,0.28)";ctx.fill();
        ctx.lineWidth=1.2*iconScale;ctx.strokeStyle="rgba(255,200,70,1)";ctx.stroke();
      }
      // Wealth-per-capita drives fill brightness (poor = dark earth, rich
      // = warm cream); kept in a narrow range so country tints still read.
      const wpc=(s.wealth||0)/Math.max(1,s.people);
      const richT=Math.min(1,wpc/80);
      const fr=Math.round(95+richT*105), fg=Math.round(75+richT*95), fb=Math.round(55+richT*55);
      ctx.fillStyle=`rgb(${fr},${fg},${fb})`;
      ctx.strokeStyle="rgba(20,15,5,0.95)";
      ctx.lineWidth=0.7*iconScale;
      // Tier glyph
      if(tier===0){          // village — dot
        ctx.beginPath();ctx.arc(sx,sy,r,0,Math.PI*2);ctx.fill();ctx.stroke();
      }else if(tier===1){    // town — square
        ctx.fillRect(sx-r,sy-r,r*2,r*2);ctx.strokeRect(sx-r,sy-r,r*2,r*2);
      }else{                 // city / metropolis — diamond
        ctx.beginPath();ctx.moveTo(sx,sy-r);ctx.lineTo(sx+r,sy);ctx.lineTo(sx,sy+r);ctx.lineTo(sx-r,sy);ctx.closePath();
        ctx.fill();ctx.stroke();
        // Metropolis gets a second concentric diamond for visual weight.
        if(tier>=3){
          const r2=r*0.5;
          ctx.beginPath();ctx.moveTo(sx,sy-r2);ctx.lineTo(sx+r2,sy);ctx.lineTo(sx,sy+r2);ctx.lineTo(sx-r2,sy);ctx.closePath();
          ctx.strokeStyle="rgba(40,30,10,0.8)";ctx.lineWidth=0.6*iconScale;ctx.stroke();
        }
      }
      // GARRISON ring — a settlement with an army > 5% of pop gets a thin
      // armoured outline; saturates at 15%. Lets defended towns be read
      // at a glance even when their tier glyph is small.
      const armyFrac=(s.army||0)/Math.max(1,s.people);
      if(armyFrac>0.05){
        const t=Math.min(1,(armyFrac-0.05)/0.10);
        ctx.beginPath();ctx.arc(sx,sy,r+1.4*iconScale,0,Math.PI*2);
        ctx.strokeStyle=`rgba(80,60,30,${0.5+t*0.4})`;ctx.lineWidth=(0.8+t*0.9)*iconScale;ctx.stroke();
      }
      // ACTIVE SHOCK ring — plague (purple) or famine (amber). Overrides the
      // garrison ring colour because a struck town is the more urgent signal.
      const shock=_L.shocks?(s._shock||0):0;
      if(shock){
        ctx.beginPath();ctx.arc(sx,sy,r+2.2*iconScale,0,Math.PI*2);
        ctx.strokeStyle=shock===2?"rgba(190,80,210,0.9)":"rgba(245,170,40,0.9)";
        ctx.lineWidth=1.3*iconScale;ctx.stroke();
      }
      // Adjust below rank-marker offset for the new (smaller) icon.
      const _markerR=r;
      // ── Rank marker ── a gold star above national capitals, a small open
      // ring above provincial seats (settlements that have vassals). Lets
      // the administrative hierarchy be read at a glance over the country
      // tint: stars = kingdoms' seats, rings = the regional centres beneath.
      if(capitalIds.has(s.id)){
        const my=sy-_markerR-3*iconScale;
        const starOuter=3.2*iconScale,starInner=1.4*iconScale;
        ctx.fillStyle="rgba(255,210,70,0.95)";ctx.strokeStyle="rgba(60,40,0,0.9)";ctx.lineWidth=0.6*iconScale;
        ctx.beginPath();
        for(let p=0;p<10;p++){const ang=-Math.PI/2+p*Math.PI/5;const rr=(p%2===0)?starOuter:starInner;
          const px=sx+Math.cos(ang)*rr,py=my+Math.sin(ang)*rr;p===0?ctx.moveTo(px,py):ctx.lineTo(px,py);}
        ctx.closePath();ctx.fill();ctx.stroke();
      }else if((s._vassalCount||0)>0){
        const my=sy-_markerR-2.5*iconScale;
        ctx.beginPath();ctx.arc(sx,my,1.9*iconScale,0,Math.PI*2);
        ctx.fillStyle="rgba(255,235,180,0.85)";ctx.fill();
        ctx.lineWidth=0.7*iconScale;ctx.strokeStyle="rgba(90,60,10,0.9)";ctx.stroke();
      }
    }
  }
  // ── Sea lanes ── faint dashed routes over open water connecting the
  // ports that trade by ship (sea.js). Drawn in every view except the
  // land-roads view, beneath the moving ships and armies.
  if(psw&&ctx&&!vmRoads&&psw._seaLanes&&psw._seaLanes.length&&layersRef.current.seaLanes){
    const TR=psw.tileRes,tw=psw.tw;
    ctx.save();
    ctx.strokeStyle="rgba(90,175,225,0.28)";
    ctx.lineWidth=0.8;
    ctx.setLineDash([3,3]);
    for(const lane of psw._seaLanes){
      const pts=lane.tiles;if(!pts||pts.length<2)continue;
      let started=false,px=0;
      for(let k=0;k<pts.length;k++){
        const ti=pts[k],ty=(ti/tw)|0,tx=ti-ty*tw;
        const X=(tx+0.5)*TR,Y=dataYtoScreenY((ty+0.5)*TR,H,CH);
        if(started&&Math.abs(X-px)>CW*0.5){ctx.stroke();started=false;}
        if(!started){ctx.beginPath();ctx.moveTo(X,Y);started=true;}else ctx.lineTo(X,Y);
        px=X;
      }
      if(started)ctx.stroke();
    }
    ctx.restore();
  }
  // ── Colony ships ── diamonds in the founding country's colour sailing
  // toward the shore they'll settle, with a faint line to that
  // destination. Drawn in every view (like armies).
  if(psw&&ctx&&psw.ships&&psw.ships.length&&layersRef.current.ships){
    const TR=psw.tileRes,tw=psw.tw;
    for(const sh of psw.ships){
      const sxp=sh.x*TR,syp=dataYtoScreenY(sh.y*TR,H,CH);
      const lt=sh.landTi,ly=(lt/tw)|0,lx=lt-ly*tw;
      const dxs=(lx+0.5)*TR,dys=dataYtoScreenY((ly+0.5)*TR,H,CH);
      if(Math.abs(dxs-sxp)<CW*0.5){
        ctx.strokeStyle="rgba(60,150,210,0.55)";ctx.lineWidth=0.7;
        ctx.beginPath();ctx.moveTo(sxp,syp);ctx.lineTo(dxs,dys);ctx.stroke();
      }
      const hue=((sh.countryId*61)%360+360)%360;
      ctx.save();ctx.translate(sxp,syp);ctx.rotate(Math.PI/4);
      ctx.fillStyle=`hsl(${hue},75%,55%)`;
      ctx.fillRect(-2.6,-2.6,5.2,5.2);
      ctx.lineWidth=1;ctx.strokeStyle="rgba(0,20,40,0.9)";ctx.strokeRect(-2.6,-2.6,5.2,5.2);
      ctx.restore();
    }
  }
}
},[updateTerrainCache,buildAtlas,CH]);

// Apply a snapshot from the sim worker into the mirror (peopleRef.current),
// shaped like the real world so draw()/the card read it unchanged, then draw.
const applySnapshot=useCallback((snap)=>{
  let psw=peopleRef.current;
  if(!psw||!psw._isMirror){psw=peopleRef.current={_isMirror:true};}
  psw.step=snap.step;psw.tw=snap.tw;psw.th=snap.th;psw.tileRes=snap.tileRes;psw.N=snap.N;
  psw.globalP=snap.globalP;
  if(snap.owner)psw._territoryOwner=snap.owner;
  if(snap.roadQuality)psw.roadQuality=snap.roadQuality;
  if(snap.roadFlow)psw.roadFlow=snap.roadFlow;
  if(snap.tileComp)psw._tileComp=snap.tileComp;   // network-component map (roads view); keep last
  psw._tileCompSeen=undefined;                     // mirror's tileComp is already clean (-1 = none)
  if(snap.countryClaim)psw._countryClaim=snap.countryClaim;  // capital-claim prototype (Capital Claim view); keep last
  psw._moneyFlows=snap.moneyFlows||null;           // animated coin flows (money view)
  if(snap.seaLanes)psw._seaLanes=snap.seaLanes;   // null between static sends → keep last
  psw.ships=snap.ships;
  psw._chronicle=snap.chronicle||null;             // selected realm's history (null when nothing selected)
  const setts=snap.settlements||[];
  if(snap.selected){const sel=setts.find(x=>x.id===snap.selected.id);if(sel)Object.assign(sel,snap.selected);}
  psw.settlements=setts;
  const byId=new Map();for(const s of setts)byId.set(s.id,s);psw._byId=byId;
  const countries=new Map();
  for(const c of (snap.countries||[])){
    const members=c.memberIds.map(id=>byId.get(id)).filter(Boolean);
    const capital=byId.get(c.capitalId)||members[0]||null;
    countries.set(c.id,{id:c.id,members,capital,capitalId:c.capitalId,hue:c.hue,range:c.range,_capacity:c._capacity,_loadTotal:c._loadTotal,_momentum:c._momentum,_fronts:c._fronts,_capitalBesieged:c._capitalBesieged,_treasury:c._treasury,_govRevenue:c._govRevenue,_govSpend:c._govSpend,_solvency:c._solvency,_taxRate:c._taxRate,_priceLevel:c._priceLevel,personality:c.personality});
  }
  psw.countries=countries;
  // HUD state updates re-render the whole component, so throttle them to ~5Hz
  // (the sim numbers don't need 30Hz); drawing still happens every snapshot.
  psw._snapN=(psw._snapN||0)+1;
  if(psw._snapN%6===1){if(snap.stats)setPsStats(snap.stats);}
  // History sample for the charts/export (gated by sim-step, reset on new run).
  if(snap.stats){
    const H=psHistoryRef.current, st=snap.step, last=H[H.length-1];
    if(last&&st<last.step)H.length=0;                       // step jumped back → new world
    if(!H.length||st-H[H.length-1].step>=HISTORY_INTERVAL){
      const x=snap.stats;
      H.push({step:st,pop:x.totalPeople||0,gold:x.totalWealth||0,landPct:x.landPct||0,
              countries:x.countries||0,sett:x.settlements||0,villages:x.villages||0,
              towns:x.towns||0,cities:x.cities||0,metros:x.metropolises||0,
              largest:x.largestEmpire||0,army:x.totalArmy||0});
      if(H.length>5000)H.splice(0,H.length-5000);
    }
  }
  if(terRef.current){try{draw(terRef.current);}catch(e){console.error('[DRAW CRASH]',e.message,e.stack);}}
},[draw]);
useEffect(()=>{applySnapshotRef.current=applySnapshot;},[applySnapshot]);

// Forward play/pause + speed to the sim worker.
useEffect(()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'control',playing,speed});},[playing,speed]);
// Forward selection so the worker includes that settlement's full detail.
useEffect(()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'select',id:selectedSettlementId});},[selectedSettlementId]);
// Close the per-realm overlays when the selection changes, so they don't
// auto-reopen (or show a stale realm) the next time a settlement is picked.
useEffect(()=>{setChronicleOpen(false);setTechTreeOpen(false);},[selectedSettlementId]);
// Tell the worker the current view so it ships money-flow / road-component extras only when shown.
useEffect(()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'view',view:viewMode});},[viewMode]);
// Terminate both workers on unmount so they don't leak across hot-reloads / route changes.
useEffect(()=>()=>{try{simWorkerRef.current?.terminate();}catch{}try{workerRef.current?.terminate();}catch{}},[]);

useEffect(()=>{viewRef.current=viewMode;depthFromSeaRef.current=depthFromSea;depthCeilRef.current=depthCeil;showPlatesRef.current=showPlates;showRiversRef.current=showRivers;showStreamsRef.current=showStreams;showLakesRef.current=showLakes;showGlobeRef.current=showGlobe;if(world&&terRef.current)draw(terRef.current);},[world,draw,viewMode,depthFromSea,depthCeil,showPlates,showRivers,showStreams,showLakes,showGlobe,activeRes,layers]);

useEffect(()=>{let fid,acc=0,last=performance.now(),drawSkip=0;
const loop=now=>{fid=requestAnimationFrame(loop);if(!playRef.current||!terRef.current||!worldRef.current){last=now;return;}
// Worker mode: the sim runs off-thread and drives drawing via snapshots, so
// this loop does nothing. Only the main-thread FALLBACK steps + draws here.
if(simWorkerRef.current){last=now;return;}
acc+=now-last;last=now;const iv=Math.max(8,100/speedRef.current);
if(acc>=iv){acc=0;
// Adaptive step rate: early history flies by, modern era slows down.
// Uses current step count to determine how many sim steps per frame.
const curStep=terRef.current.stepCount;
// Early game (<200 steps = pre-agriculture): fast. Late game (>800): slow.
// Scaled by user speed setting.
// Early Bronze Age runs faster, modern era slower
const eraFactor=curStep<100?3:curStep<200?2:curStep<500?1.5:1;
const sub=Math.min(12,Math.max(1,Math.ceil(speedRef.current/3*eraFactor)));// cap raised so high-speed actually accelerates the sim
// Time-budgeted sim: stop stepping if we've used >8ms this frame
const _simStart=performance.now();
for(let s=0;s<sub;s++){
// Legacy tribe sim DISABLED — peopleSim is the new entity-based model.
// runTribeStep call removed at user request ("completely erase the tribe system").
// The `ter` object is still kept around so UI panels that read tribeCenters
// etc. don't crash, but it is no longer mutated each tick.
try{if(peopleRef.current)stepPeopleSim(peopleRef.current,1);}
catch(e){console.error('[PEOPLESIM CRASH]',e.message,e.stack);playRef.current=false;return;}
if(performance.now()-_simStart>8)break;
}
// peopleSim stats — drives the HUD instead of legacy tribe metrics.
if(peopleRef.current&&peopleRef.current.step%5===0){
  setPsStats(peopleSimStats(peopleRef.current));
}
// Only redraw every 3rd sim frame to save 10-30ms/frame on CPU canvas rendering
drawSkip++;
if(drawSkip>=3){drawSkip=0;
try{draw(terRef.current);}catch(e){console.error('[DRAW CRASH]',e.message,e.stack);playRef.current=false;}}}};
fid=requestAnimationFrame(loop);return()=>cancelAnimationFrame(fid);},[draw]);

// Animation loop for the views with per-frame motion (wind particle streaks,
// money-flow coins) — one shared rAF instead of one per view; it no-ops on
// every other view, and keeps animating while the sim is paused (so a frozen
// economy can still be studied).
useEffect(()=>{let afid;
const animLoop=()=>{afid=requestAnimationFrame(animLoop);
const v=viewRef.current;
if((v!=="wind"&&v!=="money")||!worldRef.current||!terRef.current)return;
draw(terRef.current);};
afid=requestAnimationFrame(animLoop);
return()=>cancelAnimationFrame(afid);},[draw]);

const togglePlay=()=>{playRef.current=!playRef.current;setPlaying(p=>!p);};
const handleImport=useCallback(async(e)=>{const file=e.target.files?.[0];if(!file)return;
e.target.value="";
setImportStatus("Loading...");
try{let w;
if(file.name.endsWith(".json")||file.name.endsWith(".map")){
const text=await file.text();const parsed=parseAzgaarJSON(text);
w=rasterizeAzgaar(parsed,W,H);
setImportStatus(`Azgaar map loaded (${parsed.n} cells, ${parsed.stateSet.size} states)`);
}else if(file.type.startsWith("image/")){
const img=await loadImageFile(file);
w=rasterizeHeightmap(img.data,img.width,img.height,W,H);
setImportStatus(`Heightmap loaded (${img.width}\u00d7${img.height})`);
}else{setImportStatus("Unsupported file type");return;}
const swamp=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
if(w.elevation[i]>0&&w.elevation[i]<0.025&&w.moisture[i]>0.45&&w.temperature[i]>0.35){
const nv=fbm(x/W*20+300,y/H*20+300,2,2,.5);if(nv>-0.1)swamp[i]=1;}}
w.swamp=swamp;
importedWorldRef.current=w;presetRef.current="import";setPreset("import");
setSeed(Math.floor(Math.random()*999999));
setTimeout(()=>setImportStatus(null),4000);
}catch(err){setImportStatus("Import failed: "+err.message);setTimeout(()=>setImportStatus(null),5000);}
},[seed]);
// Screen → canvas-pixel-space (reversing the pan/zoom transform). Returns
// {sx,sy} in the same coordinate system the existing hit-testing already uses.
const screenToCanvas=useCallback((ev)=>{
  const c=canvasRef.current;if(!c)return null;
  const r=c.getBoundingClientRect();
  const rawX=(ev.clientX-r.left)/r.width*CW;
  const rawY=(ev.clientY-r.top)/r.height*CH;
  const z=viewZRef.current;
  return {sx:(rawX-viewXRef.current)/z, sy:(rawY-viewYRef.current)/z, rawX, rawY};
},[CW,CH]);
const onCanvasMove=useCallback((ev)=>{
const c=canvasRef.current;if(!c||!worldRef.current)return;
// Pan dragging — any button. Only PAN if the mouse has crossed the
// click/drag threshold; once it has, mark it so the subsequent click is
// suppressed (drag-to-pan + plain-click-to-select on the same button).
if(panDragRef.current){
  const pd=panDragRef.current;
  const dx=ev.clientX-pd.mx,dy=ev.clientY-pd.my;
  if(!pd.moved&&Math.hypot(dx,dy)<=3)return;   // below threshold; wait
  pd.moved=true;
  viewXRef.current=pd.vx+dx*(CW/c.getBoundingClientRect().width);
  viewYRef.current=pd.vy+dy*(CH/c.getBoundingClientRect().height);
  if(terRef.current)draw(terRef.current);
  return;
}
const _sc=screenToCanvas(ev);if(!_sc)return;
const sx=_sc.sx,sy=_sc.sy;
const wx=Math.floor(sx)*RES,wy=Math.round(screenYtoDataY(Math.floor(sy),CH,H));
const w=worldRef.current,i=wy*1920+wx;
if(wx<0||wx>=1920||wy<0||wy>=960){setHoverInfo(null);return;}
const elev=w.elevation[i]||0;
const temp=w.temperature[i]||0;
const terTi=terRef.current?Math.min(terRef.current.th-1,(wy/RES)|0)*terRef.current.tw+Math.min(terRef.current.tw-1,(wx/RES)|0):-1;
const moist=terTi>=0&&terRef.current?terRef.current.tMoist[terTi]:(w.moisture[i]||0);
const biome=getBiomeD(elev,moist,temp,0);
const biomeName=BN[biome]||"Ocean";
const elevM=elev<=0?Math.round(elev*4000):Math.round(elev*8000);
const tempC=Math.round(temp*100-60);// range: -60°C to +40°C
const lat=Math.abs(wy/960-0.5)*2;
const fertVal=elev>0?(terTi>=0&&terRef.current?terRef.current.tFert[terTi]:tileFert(temp,moist,elev)):0;
const wdx=w.windX?w.windX[i]:0,wdy=w.windY?w.windY[i]:0;
const wspd=Math.sqrt(wdx*wdx+wdy*wdy);
const wkmh=Math.round(wspd*100); // normalized → km/h (median ~18 km/h)
// +Y is south in screen coords, so negate wdy for compass direction
// Direction = where the wind is blowing TO
const wdeg=((Math.atan2(-wdy,wdx)*180/Math.PI)+360)%360;
const wdir=["E","NE","N","NW","W","SW","S","SE"][Math.round(wdeg/45)%8];
// Throttle: hovering re-renders the WHOLE (large) component via setHoverInfo,
// so only push a new card when the cursor moved to a different tile or ~90ms
// passed (the card position still tracks smoothly at that rate).
const _hv=hoverThrottleRef.current;
const _now=performance.now();
if(_hv.ti===terTi&&_now-_hv.t<90){_hv.x=ev.clientX;_hv.y=ev.clientY;return;}
_hv.ti=terTi;_hv.t=_now;
// Resource info at this tile
const tileRes=terTi>=0&&terRef.current&&terRef.current.deposits?tileResourceSummary(terRef.current.deposits,terTi):[];
const riverMag=terTi>=0&&terRef.current&&terRef.current.rivers?terRef.current.rivers.riverMag[terTi]:0;
const riverAccum=terTi>=0&&terRef.current&&terRef.current.rivers?terRef.current.rivers.flowAccum[terTi]:0;
const isLake=terTi>=0&&terRef.current&&terRef.current.rivers&&terRef.current.rivers.lake?terRef.current.rivers.lake[terTi]>=0:false;
const lakeSize=isLake?terRef.current.rivers.lakeInfo[terRef.current.rivers.lake[terTi]].size:0;
setHoverInfo({x:ev.clientX,y:ev.clientY,elevM,tempC,moist,biome:biomeName,fert:fertVal,lat,wspd,wdir,wkmh,resources:tileRes,river:riverMag,riverAccum,isLake,lakeSize});
},[CW,CH]);
const onCanvasLeave=useCallback(()=>setHoverInfo(null),[]);
const onCanvasClick=useCallback((ev)=>{
const c=canvasRef.current;if(!c||!terRef.current)return;
// If the mouse-down → up was actually a drag (moved past threshold), the
// onCanvasMove pass already set pd.moved=true and panned. Swallow the click
// in that case so dragging never accidentally selects.
if(panDragRef.current){
  const wasDrag=panDragRef.current.moved===true;
  panDragRef.current=null;
  if(wasDrag)return;
}
const _sc=screenToCanvas(ev);if(!_sc)return;
const sx=_sc.sx,sy=_sc.sy;
const wx=Math.floor(sx),wy=Math.round(screenYtoDataY(Math.floor(sy),CH,H));
const ter=terRef.current;if(!ter)return;
const ttx=Math.min(ter.tw-1,(wx/RES)|0),tty=Math.min(ter.th-1,(wy/RES)|0);
// Transport-test mode: capitals sub-mode places tribe seeds; route
// sub-mode places two endpoints and shows the cheapest path.
if(viewMode==="transport-test"){
  if(ev.shiftKey){
    if(ttSubMode==="capitals")setTtCapitals([]);
    else setTtRoute({start:null,end:null});
    return;
  }
  if(ttSubMode==="capitals"){
    if(ter.tElev[tty*ter.tw+ttx]<=0)return;
    setTtCapitals(prev=>[...prev,{x:ttx,y:tty}]);
  }else{
    // route mode
    setTtRoute(prev=>{
      if(!prev.start||(prev.start&&prev.end))return{start:{x:ttx,y:tty},end:null};
      return{...prev,end:{x:ttx,y:tty}};
    });
  }
  return;
}
// peopleSim mode: find the closest settlement to the click. Match
// against the peopleSim tile-space (tw=960, half of canvas width).
const psw=peopleRef.current;
if(psw){
  const psTx=ttx/psw.tileRes,psTy=tty/psw.tileRes;
  let best=null,bestD2=Infinity;
  for(const s of psw.settlements){
    if(!s||s.mode!=="settled")continue;
    let dx=Math.abs(s.pos.x-psTx);
    if(dx>psw.tw/2)dx=psw.tw-dx;
    const dy=s.pos.y-psTy;
    const d2=dx*dx+dy*dy;
    if(d2<bestD2){bestD2=d2;best=s;}
  }
  // Pick within ~6 tile radius (handles small icons and slop).
  // Sync the ref BEFORE the immediate redraw (the effect that mirrors the
  // state into the ref runs after render, so the halo used to lag one frame).
  if(best&&bestD2<36){
    selectedSettlementIdRef.current=best.id;
    setSelectedSettlementId(best.id);
  }else{
    selectedSettlementIdRef.current=-1;
    setSelectedSettlementId(-1);
  }
  draw(ter);
}
},[CW,CH,draw,viewMode,ttSubMode]);
// ── Pan / zoom mouse handlers ────────────────────────────────────────
// Wheel: zoom around the cursor (Google-Maps style). Pan: middle-button or
// shift+left-button drag (left-only drag is reserved for settlement clicks).
// React's synthetic onWheel is registered as PASSIVE in most browsers, so
// ev.preventDefault() is a no-op (the page scrolls behind the canvas while
// we zoom). Attach a native non-passive listener directly to the element so
// preventDefault actually fires.
useEffect(()=>{
  const c=canvasRef.current;if(!c)return;
  const onWheel=(ev)=>{
    ev.preventDefault();
    const r=c.getBoundingClientRect();
    const rawX=(ev.clientX-r.left)/r.width*CW;
    const rawY=(ev.clientY-r.top)/r.height*CH;
    const zOld=viewZRef.current;
    const factor=ev.deltaY<0?1.15:1/1.15;
    const zNew=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,zOld*factor));
    if(zNew===zOld)return;
    const k=zNew/zOld;
    viewXRef.current=rawX-(rawX-viewXRef.current)*k;
    viewYRef.current=rawY-(rawY-viewYRef.current)*k;
    viewZRef.current=zNew;
    if(terRef.current)draw(terRef.current);
  };
  c.addEventListener("wheel",onWheel,{passive:false});
  return()=>c.removeEventListener("wheel",onWheel);
},[CW,CH,draw]);
const onCanvasMouseDown=useCallback((ev)=>{
  // Any button (left, middle, right) can start a drag. onCanvasClick fires
  // only if the mouse hardly moved (see the moved>3 check there), so plain
  // left-click → still selects a settlement, but left-drag → pans.
  if(ev.button===0||ev.button===1||ev.button===2){
    panDragRef.current={mx:ev.clientX,my:ev.clientY,vx:viewXRef.current,vy:viewYRef.current,moved:false};
  }
},[]);
// Reset view (double-click to recentre at zoom 1).
const resetView=useCallback(()=>{
  viewXRef.current=0;viewYRef.current=0;viewZRef.current=1;
  if(terRef.current)draw(terRef.current);
},[draw]);
// Re-run route Dijkstra whenever endpoints or tech change
useEffect(()=>{
  if(viewMode!=="transport-test"||ttSubMode!=="route"){ttRouteResultRef.current=null;return;}
  if(!terRef.current||!ttRoute.start||!ttRoute.end){ttRouteResultRef.current=null;
    if(terRef.current)draw(terRef.current);return;}
  ttRouteResultRef.current=findRoute(terRef.current,ttRoute.start,ttRoute.end,ttParams);
  draw(terRef.current);
},[ttRoute,ttCost,ttSubMode,viewMode]);
const setPresetAndGo=(p)=>{presetRef.current=p;setPreset(p);setSeed(Math.floor(Math.random()*999999));};

// ── Aggregate world stats for the chronicle ribbon ──
const _step=(peopleRef.current&&peopleRef.current.step)||psStats.step||0;
const _ys=yearStr(_step);
// Leading era comes from the WORKER stats (the most advanced capital's tech
// era) — the old ribbon averaged the dead tribe arrays and so sat frozen on
// "Stone Age" forever.
const _era=ERAS[psStats.leadingEra||0]||ERAS[0];
const _psw=peopleRef.current;
const _countryCount=(_psw&&_psw.countries)?_psw.countries.size:0;

// View modes for the right rail
const VIEW_MODES=[
  ["terrain","Terrain"],["atlas","Atlas"],["depth","Depth"],["wind","Wind"],
  ["moisture","Moisture"],["temperature","Temp"],["fertility","Fertility"],
  ["crop","Crop"],["crossing","Crossing"],["country","Country"],["frTerritory","Farm Regions"],["roads","Roads"],["money","Money"],
  ["resources","Resources"],["transport-test","Trans Test"]
];

return(
<div className="au-root" style={{width:"100vw",height:"calc(100vh - 40px)",
  background:"var(--au-table-dark)",overflow:"hidden",display:"flex",position:"relative"}}>

{/* ══════════ LEFT SPINE ══════════ */}
<aside className="au-parchment au-scroll" style={{
  width:142,minWidth:142,margin:"6px 3px 6px 6px",padding:"10px 8px",
  display:"flex",flexDirection:"column",gap:5,overflowY:"auto"}}>

<button onClick={togglePlay}
  className={"au-btn au-block"+(playing?" au-wax au-active":"")}
  style={{padding:"8px 6px",fontSize:13,fontFamily:"'Cinzel',Georgia,serif",letterSpacing:"0.10em"}}>
  {playing?"❚❚  Pause":"▶  Play"}
</button>

<div style={{display:"flex",alignItems:"center",gap:6,padding:"2px 4px"}}>
  <span className="au-sc au-fade" style={{fontSize:10}}>Speed</span>
  <input type="range" min={1} max={30} value={speed}
    onChange={e=>{setSpeed(+e.target.value);speedRef.current=+e.target.value;}}
    style={{flex:1}} />
  <span className="au-mute" style={{fontSize:10,width:18,textAlign:"right"}}>{speed}</span>
</div>

<div className="au-rule" />
<div className="au-sc au-fade au-heading" style={{fontSize:10,padding:"2px 4px 0"}}>World</div>

<button onClick={()=>setPresetAndGo("earth_sim")}
  className={"au-btn au-block"+(preset==="earth_sim"?" au-active":"")}>Earth (Sim)</button>
{preset==="earth_sim"&&
  <label style={{fontSize:10,padding:"0 4px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}} className="au-fade">
    <input type="checkbox" checked={useRealWind}
      onChange={e=>{setUseRealWind(e.target.checked);useRealWindRef.current=e.target.checked;generate(seed);}}
      style={{width:11,height:11}} />
    {isRealWindAvailable()?"Real Winds":"Real Winds (n/a)"}
  </label>}

<button onClick={()=>setPresetAndGo("tectonic")}
  className={"au-btn au-block"+(preset==="tectonic"?" au-active":"")}>Tectonic</button>
{preset==="tectonic"&&<>
  <select value={tecPresetName} onChange={e=>{
    const name=e.target.value;setTecPresetName(name);
    if(name==="Default"){_tecParams={};generate(seed);}
    else{const presets=loadPresets();if(presets[name]){_tecParams=presets[name];generate(seed);}}
  }} style={{width:"100%",marginTop:2}}>
    <option value="Default">Default</option>
    {Object.keys(loadPresets()).map(name=><option key={name} value={name}>{name}</option>)}
  </select>
  {tecPresetName!=="Default"&&<button onClick={()=>{
    if(confirm("Delete '"+tecPresetName+"'?")){deletePreset(tecPresetName);setTecPresetName("Default");_tecParams={};generate(seed);}}}
    className="au-btn au-block au-wax" style={{fontSize:10}}>Delete Preset</button>}
</>}

<input ref={fileRef} type="file" accept=".json,.map,.png,.jpg,.jpeg,.webp"
  style={{display:"none"}} onChange={handleImport} />
<button onClick={()=>fileRef.current?.click()} className="au-btn au-block">Import</button>
{importStatus&&<span className="au-fade" style={{fontSize:9,wordBreak:"break-all",padding:"0 4px"}}>{importStatus}</span>}

<div style={{flex:1}} />
<div className="au-rule" />
<button onClick={()=>setSeed(Math.floor(Math.random()*999999))}
  className="au-btn au-block au-flat" style={{fontSize:11}} title="Roll new seed">⚄ Roll</button>
<span className="au-fade" style={{fontSize:9,textAlign:"center",fontFamily:"'Courier New',monospace"}}>Seed {seed}</span>
</aside>

{/* ══════════ CENTER COLUMN ══════════ */}
<div style={{flex:1,display:"flex",flexDirection:"column",padding:"6px 3px",gap:6,minWidth:0}}>

{/* Chronicle ribbon */}
<div className="au-parchment au-chronicle" style={{flexShrink:0}}>
  <span className="au-era">{_era}</span>
  <span className="au-vrule" style={{height:20,margin:"0 2px"}} />
  <span className="au-year">{_ys}</span>
  <span className="au-fade" style={{fontSize:11}}>Step {_step.toLocaleString()}</span>
  <span className="au-vrule" style={{height:20,margin:"0 2px"}} />
  <span style={{fontSize:13}}>{_countryCount} <span className="au-sc au-fade" style={{fontSize:11}}>nations</span></span>
  <span style={{fontSize:13}}>{Math.round((psStats.landPct||0)*100)}<span className="au-fade">%</span> <span className="au-sc au-fade" style={{fontSize:11}}>claimed</span></span>
  {(()=>{
    // Wheat-price ticker — population-weighted global price level. The number
    // shown is the price of 1 unit of farmed wheat relative to its baseline.
    // (The displayed number is `globalP × baselineFOOD_PRICE`.)
    const psw=peopleRef.current;
    const P=psw&&isFinite(psw.globalP)?psw.globalP:null;
    if(P==null)return null;
    const price=(5*P).toFixed(2);
    const dir=P>1.04?"▲":P<0.96?"▼":"·";
    const col=P>1.1?"hsl(8,75%,55%)":P<0.9?"hsl(195,65%,50%)":"var(--au-ink)";
    return(
      <>
        <span className="au-vrule" style={{height:20,margin:"0 2px"}} />
        <span style={{fontSize:13}} title={`global price level ×${P.toFixed(2)} (1.00 = baseline)`}>
          <span className="au-sc au-fade" style={{fontSize:11,marginRight:4}}>Wheat</span>
          <span style={{color:col,fontWeight:600}}>{price}</span>
          <span className="au-fade" style={{fontSize:11,marginLeft:3}}>{dir}</span>
        </span>
      </>
    );
  })()}
  <div style={{flex:1}} />
</div>

{/* Map area */}
<div style={{flex:1,position:"relative",display:"flex",alignItems:"center",justifyContent:"center",minHeight:0,overflow:"hidden"}}>

{showGlobe?
  <div style={{width:"100%",aspectRatio:"4/3",maxHeight:"100%"}}>
    <GlobeView terrainBuf={globeBuf} version={globeVer} world={world} CW={globeTexSize.w} CH={globeTexSize.h} />
  </div>:
  <canvas ref={canvasRef} width={CW} height={CH}
    onMouseMove={onCanvasMove} onMouseLeave={onCanvasLeave} onClick={onCanvasClick}
    onMouseDown={onCanvasMouseDown} onDoubleClick={resetView}
    style={{display:"block",imageRendering:"pixelated",
      maxWidth:"100%",maxHeight:"100%",width:"auto",height:"auto",aspectRatio:`${CW}/${CH}`,
      boxShadow:"0 8px 36px rgba(0,0,0,0.7)",border:"1px solid var(--au-paper-deep)"}} />
}

{/* ─── Pico hover card ─── */}
{hoverInfo&&<div className="au-parchment au-pico"
  style={{left:hoverInfo.x+14,top:hoverInfo.y-12}}>
  <div className="au-pico-title" style={{
    color:hoverInfo.isLake?"var(--au-verdigris)":hoverInfo.elevM<=0?"var(--au-verdigris)":"var(--au-ink)"}}>
    {hoverInfo.isLake?`Lake (${hoverInfo.lakeSize}t)`:hoverInfo.biome}
  </div>
  <div className="au-fade" style={{fontSize:11}}>
    {hoverInfo.elevM}m · {hoverInfo.tempC}°C · {(hoverInfo.moist*100|0)}% moist
  </div>
  {hoverInfo.river>0&&<div className="au-verde-text" style={{fontSize:11}}>
    {RIVER_NAMES[hoverInfo.river]}
  </div>}
  <div className="au-fade" style={{fontSize:9,marginTop:2,fontStyle:"italic"}}>click for full info</div>
</div>}

{/* ─── peopleSim settlement card ─── */}
{(()=>{
  if(selectedSettlementId<0)return null;
  const psw=peopleRef.current;
  if(!psw)return null;
  const s=psw.settlements.find(x=>x&&x.id===selectedSettlementId&&x.mode==="settled");
  if(!s)return null;
  const tierName=["farming region","town","city","metropolis"][s.tier]||"settlement";
  // A farming region (tier 0) does NOT promote in place — it FOUNDS a town nearby
  // once it fills out (urban genesis). Only urban nodes climb, at the sim's
  // canonical TIER_THRESHOLD (town→city→metropolis); index [1] isn't a promotion
  // gate (towns are spawned, not grown from regions), so progress is urban-only.
  const isRegion=(s.tier|0)===0;
  const nextThr=isRegion?0:TIER_THRESHOLD[s.tier+1];
  const progress=nextThr?Math.min(1,s.people/nextThr):1;
  const k=s.knowledge||{};
  const tech=techState(k);                 // Civ-like discovery layer derived from knowledge (tech.js)
  const techList=TECHS.filter((t,i)=>tech.have[i]===1);
  const techNext=nextTechs(k,tech.have,3);
  const r=s.localRes||{};
  const farm=s._terrTiles||0;
  const K=s._k||0;
  const foodK=s._foodK||0,houseK=s._houseK||0;
  const limitedBy=foodK<=houseK?"food":"housing";
  // Era label is driven by metallurgy KNOWLEDGE (which is monotonic —
  // you don't unlearn how to make steel) rather than current
  // resource access. A city that lost its iron mine still knows the
  // craft; it just can't make new iron until a trade route reopens.
  const m=k.metallurgy||0;
  let era="stone age";
  if(m>=0.88)era="steel age";
  else if(m>=0.68)era="iron age";
  else if(m>=0.42)era="bronze age";
  else if(m>=0.15)era="chalcolithic";
  // Local resources, sorted by richness, only show ones present.
  const RES_LABEL={timber:"Timber",stone:"Stone",copper:"Copper",tin:"Tin",iron:"Iron",coal:"Coal",horses:"Horses",salt:"Salt",precious:"Precious",gems:"Gems",spices:"Spices",furs:"Furs",incense:"Incense",dyes:"Dyes"};
  const presentRes=Object.entries(r).filter(([,v])=>v>0.10).sort((a,b)=>b[1]-a[1]);
  // Ore-access flags drive the metallurgy "(no ore)/(copper)/.../(steel)"
  // hint — it shows what's POSSIBLE from current local deposits, which
  // is independent of the era label above (driven by accumulated
  // knowledge).
  const cu=(r.copper||0)>0.10,sn=(r.tin||0)>0.10,fe=(r.iron||0)>0.10,co=(r.coal||0)>0.10;
  // Water-access label.
  const wa=s.waterAccess||0;
  const waterLabel=wa<=0?"landlocked":wa<0.3?"minor river":wa<0.6?"river":wa<0.85?"coastal":"port";
  // Food balance. surplus is the REAL flow balance — local production +
  // smoothed imports − consumption. An import-fed city sits near 0 (it
  // eats grain as fast as it arrives, so stored food stays low); that is
  // "balanced", NOT starving. Only a genuine, uncovered shortfall that is
  // actually draining the granary counts as starving.
  const supply=s._foodSupply||0, demand=s._foodDemand||0, importRate=s._foodImportRate||0;
  const surplus=(supply+importRate)-demand;
  const eps=Math.max(0.02,demand*0.02);
  const ticksLeft=demand>0?(s.food||0)/demand:Infinity;
  let status,statusColor;
  if(surplus>eps){status="surplus";statusColor="#3a7";}
  else if(surplus<-eps){
    if(ticksLeft<50){status="starving";statusColor="#c44";}
    else{status="deficit";statusColor="#c84";}
  } else {status="balanced";statusColor="#888";}

  // Treasury + trade.
  const wealth=Math.round(s.wealth||0);
  const available=Math.max(0,wealth-Math.round(getWealthReserve(s)));
  const profile=s._tradeProfile||getTradeProfile(s,peopleRef.current);
  // Export composition (specific goods) — each good's value contribution to what
  // this settlement makes for sale. The "goods sold" coin is earned in
  // proportion to these shares, so we split that $/tick across the named goods.
  const _xb=getExportBreakdown(s);
  const _xbTot=_xb.reduce((t,b)=>t+b.value,0)||1;
  const produces=_xb.filter(b=>b.label!=="Baseline").slice(0,3).map(b=>b.label.toLowerCase());
  const _goodsRate=(s._mInRate&&s._mInRate[IN_GOODS])||0;
  const goodsBreakdown=_goodsRate>0.005
    ? _xb.map(b=>[b.label==="Baseline"?"Basic produce":b.label, _goodsRate*b.value/_xbTot])
         .filter(x=>x[1]>0.005).sort((a,b)=>b[1]-a[1])
    : [];
  // Smoothed net wealth change rate from the sim (the categorised in/out
  // breakdown below comes from s._mInRate / s._mOutRate).
  const wealthDelta=s._wealthDelta||0;
  const moneyCol=v=>v>0.02?"#3a7":v<-0.02?"#c44":"#8a8f9c";
  const nextName=isRegion?null:["town","city","metropolis"][s.tier];

  return(
    <div className="au-parchment au-pico au-elev"
      style={{position:"absolute",left:14,top:14,width:248,padding:"10px 12px",fontSize:11,zIndex:30,maxHeight:"calc(100vh - 28px)",overflowY:"auto",
        pointerEvents:"auto"/* au-pico sets pointer-events:none for the hover tooltip; this card is interactive */}}>

      {/* Full tech-tree overlay (fixed-position; escapes the panel) */}
      {techTreeOpen&&<TechTreeOverlay k={k} title={s.name} onClose={()=>setTechTreeOpen(false)}/>}
      {chronicleOpen&&psw._chronicle&&psw._chronicle.countryId===s.countryId&&
        <ChronicleOverlay entries={psw._chronicle.entries} name={psw._chronicle.name} onClose={()=>setChronicleOpen(false)}/>}

      {/* ── Header ── (the chronicle opener lives here so it's always visible
          without scrolling the card — a long card can push a bottom section
          out of easy reach) */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div className="au-pico-title" style={{fontSize:14,textTransform:"capitalize"}}>{s.name}</div>
        <div style={{display:"flex",alignItems:"center",gap:1,flexShrink:0}}>
          {psw._chronicle&&psw._chronicle.countryId===s.countryId&&psw._chronicle.entries&&psw._chronicle.entries.length>0&&
            <button onClick={()=>setChronicleOpen(true)} title={`Open chronicle — ${psw._chronicle.entries.length} events`}
              style={{background:"transparent",border:"none",cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 3px"}}>📜</button>}
          <button onClick={()=>setSelectedSettlementId(-1)}
            style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--au-fade)",fontSize:16,lineHeight:1,padding:"0 2px"}}>×</button>
        </div>
      </div>
      <div className="au-fade" style={{fontSize:10,textTransform:"capitalize",marginBottom:6}}>
        {tierName} · {era} · {waterLabel}
      </div>

      {/* ── Country / polity (with administrative lineage) ── */}
      {(()=>{
        const ctry=psw.countries&&psw.countries.get(s.countryId);
        const n=ctry?ctry.members.length:1;
        const hue=((s.countryId*61)%360+360)%360;
        const cap=ctry&&ctry.capital;
        const isCap=cap&&cap.id===s.id;
        const byId=psw._byId||(()=>{const m=new Map();for(const o of psw.settlements)m.set(o.id,o);return m;})();
        const liege=(!isCap&&s.liegeId>=0)?byId.get(s.liegeId):null;
        let label;
        if(n<=1)label="independent city-state";
        else if(isCap)label=`national capital · ${n} settlements`;
        else{
          const role=(s._vassalCount>0)?"provincial seat":(tierName||"settlement");
          label=`${role} · answers to ${liege?liege.name:(cap?cap.name:"?")}`;
          if(liege&&cap&&liege.id!==cap.id)label+=` · realm of ${cap.name}`;
        }
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:`hsl(${hue},55%,50%)`,flexShrink:0}}/>
            <span className="au-fade" style={{textTransform:"capitalize"}}>{label}</span>
          </div>
        );
      })()}

      {/* ── National temperament (personality) ── */}
      {(()=>{
        const ctry=psw.countries&&psw.countries.get(s.countryId);
        const p=ctry&&ctry.personality;
        if(!p)return null;
        // Hue per dominant temperament so the label reads at a glance.
        const labelHue={Warlike:8,Conqueror:340,"Raider-Republic":30,Mercantile:140,"Trading Empire":175,Expansionist:265,Insular:210,Balanced:45}[p.label]??45;
        // Compact CENTERED trait bars: traits are −1..1 (0=neutral), so the
        // fill grows rightward from the centre for a positive (trait-expressing)
        // value and leftward for a negative (mirror) one, against a centre tick.
        const bar=(v,h)=>{
          const c=Math.max(-1,Math.min(1,v||0));
          const half=Math.abs(c)*50;                 // % of the half-track filled
          const left=c>=0?50:50-half;                // start at centre (right) or back off (left)
          return(
          <span style={{display:"inline-block",width:22,height:5,borderRadius:2,background:"rgba(255,255,255,0.12)",position:"relative",overflow:"hidden"}}>
            <span style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:"rgba(255,255,255,0.35)"}}/>
            <span style={{position:"absolute",left:`${left}%`,top:0,bottom:0,width:`${half}%`,background:`hsl(${h},60%,52%)`}}/>
          </span>
          );
        };
        return(
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10,marginBottom:6,flexWrap:"wrap"}}>
            <span style={{width:9,height:9,borderRadius:2,background:`hsl(${labelHue},60%,50%)`,flexShrink:0}}/>
            <span className="au-fade" style={{fontWeight:600}}>{p.label}</span>
            <span style={{display:"inline-flex",alignItems:"center",gap:3}} title={`aggression ${(p.aggression||0).toFixed(2)}`}>{bar(p.aggression,8)}<span className="au-fade" style={{opacity:0.5}}>war</span></span>
            <span style={{display:"inline-flex",alignItems:"center",gap:3}} title={`commerce ${(p.commerce||0).toFixed(2)}`}>{bar(p.commerce,140)}<span className="au-fade" style={{opacity:0.5}}>trade</span></span>
            <span style={{display:"inline-flex",alignItems:"center",gap:3}} title={`expansionism ${(p.expansionism||0).toFixed(2)}`}>{bar(p.expansionism,265)}<span className="au-fade" style={{opacity:0.5}}>expand</span></span>
          </div>
        );
      })()}

      {/* ── Loyalty / control budget (overextension) ── */}
      {(()=>{
        const ctry=psw.countries&&psw.countries.get(s.countryId);
        if(!ctry||ctry.members.length<=1)return null;   // city-states have no internal control problem
        const isCap=ctry.capital&&ctry.capital.id===s.id;
        if(isCap){
          // The realm's overall control budget: load drawn vs capacity available.
          const cap=ctry._capacity,load=ctry._loadTotal;
          if(cap==null||load==null)return null;
          const over=load>cap;
          const pct=cap>0?Math.round(load/cap*100):0;
          // Why the budget is squeezed (capacity already reflects this).
          let strain="";
          if(ctry._capitalBesieged)strain=" · capital besieged";
          else if((ctry._fronts||0)>1)strain=` · ${ctry._fronts}-front war`;
          const treas=ctry._treasury;
          return(
            <>
            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
              <span style={{width:9,height:9,borderRadius:2,background:over?"hsl(8,70%,52%)":"hsl(140,45%,45%)",flexShrink:0}}/>
              <span className="au-fade">control {load.toFixed(1)}/{cap.toFixed(1)} ({pct}%){over?" · over-extended":""}{strain}</span>
            </div>
            {(()=>{const mom=ctry._momentum||0;if(mom<1)return null;return(
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
                <span style={{width:9,height:9,borderRadius:2,background:"hsl(28,80%,52%)",flexShrink:0}}/>
                <span className="au-fade">conquest momentum +{mom.toFixed(1)} · holding on the offensive (fades if the advance stalls)</span>
              </div>
            );})()}
            {treas!=null&&(()=>{const sv=ctry._solvency??1;const broke=sv<0.99;return(
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
                <span style={{width:9,height:9,borderRadius:2,background:broke?"hsl(8,75%,52%)":"hsl(48,65%,48%)",flexShrink:0}}/>
                <span className="au-fade">state treasury {fmtGoldKg(treas)}{ctry._govSpend>0.01?` · spends ${fmtGoldKg(ctry._govSpend)}/pass`:""}{broke?` · INSOLVENT (army ${Math.round(sv*100)}% paid)`:""}</span>
              </div>
            );})()}
            {(()=>{const pro=ctry._armyPro||0,con=ctry._armyCon||0;if(pro+con<1)return null;const mp=ctry._manpowerCap>0?(ctry._manpower||0)/ctry._manpowerCap:1;return(
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
                <span style={{width:9,height:9,borderRadius:2,background:con>0.5?"hsl(0,70%,52%)":"hsl(0,40%,50%)",flexShrink:0}}/>
                <span className="au-fade">army {fmtPeople(pro+con)} — {fmtPeople(pro)} professional{con>0.5?` + ${fmtPeople(con)} conscript levy`:""} · manpower {Math.round(mp*100)}%{mp<0.5?" (bled)":""}</span>
              </div>
            );})()}
            {(()=>{const P=ctry._priceLevel;if(P==null||Math.abs(P-1)<0.04)return null;
              const inflating=P>1;return(
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
                <span style={{width:9,height:9,borderRadius:2,background:inflating?"hsl(28,75%,50%)":"hsl(200,65%,50%)",flexShrink:0}}/>
                <span className="au-fade">price level ×{P.toFixed(2)} · {inflating?"inflating":"deflating"}</span>
              </div>
            );})()}
            </>
          );
        }
        const loy=s.loyalty;
        if(loy==null)return null;
        const pct=Math.round(loy*100);
        const amb=s._ambition||0;
        // An ambitious governor (scheming to break away with his vassals) is the
        // more telling signal — show it instead of loyalty when it's brewing.
        if(amb>0.15){
          return(
            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
              <span style={{width:9,height:9,borderRadius:2,background:"hsl(28,75%,50%)",flexShrink:0}}/>
              <span className="au-fade">ambitious governor · scheming {Math.round(amb*100)}%{amb>0.6?" · on the brink of revolt":""}</span>
            </div>
          );
        }
        const hue=loy>0.66?140:loy>0.33?42:8;   // green / amber / red
        const load=s._adminLoad;
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:`hsl(${hue},60%,48%)`,flexShrink:0}}/>
            <span className="au-fade">loyalty {pct}%{loy<0.34?" · restless":""}{load!=null?` · admin load ${load.toFixed(2)}`:""}</span>
          </div>
        );
      })()}

      {/* ── Active shock (plague / famine) ── */}
      {(()=>{
        const sh=s._shock||0;
        if(!sh)return null;
        const plague=sh===2;
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:plague?"hsl(280,55%,52%)":"hsl(30,80%,48%)",flexShrink:0}}/>
            <span className="au-fade">{plague?"struck by plague":"famine — harvest failing"}</span>
          </div>
        );
      })()}

      {/* ── Popular unrest (separate stock from loyalty) ── */}
      {(()=>{
        const u=s.unrest||0;
        if(u<0.15)return null;
        const hue=u>0.66?8:u>0.33?28:42;   // red / orange / amber as it climbs
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:`hsl(${hue},75%,50%)`,flexShrink:0}}/>
            <span className="au-fade">unrest {Math.round(u*100)}%{s._unrestCause?` · ${s._unrestCause}`:""}{u>0.8?" · on the verge of revolt":""}</span>
          </div>
        );
      })()}

      {/* ── Maritime (ports / sea trade / colonies) ── */}
      {(()=>{
        const isPort=!!s._isPort;
        const seaPeers=s._seaReachSize??(s._seaReach?s._seaReach.size:0);
        const sent=s.history?s.history.filter(h=>h.type==="colony-launched").length:0;
        const isColony=s.history?s.history.some(h=>h.type==="colony-founded"):false;
        if(!isPort&&seaPeers===0&&sent===0&&!isColony)return null;
        const bits=[];
        if(isPort)bits.push("port");
        if(seaPeers>0)bits.push(`${seaPeers} sea route${seaPeers>1?"s":""}`);
        if(sent>0)bits.push(`${sent} colon${sent>1?"ies":"y"} sent`);
        if(isColony)bits.push("founded as a colony");
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:"hsl(205,60%,52%)",flexShrink:0}}/>
            <span className="au-fade" style={{textTransform:"capitalize"}}>{bits.join(" · ")}</span>
          </div>
        );
      })()}

      {/* ── At-a-glance summary (always visible) ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
        <div>
          <span style={{fontSize:18,fontWeight:600}}>{fmtPeople(s.people)}</span>
          {K?<span className="au-fade" style={{fontSize:10}}> / {fmtPeople(K)}</span>:null}
          <span className="au-fade" style={{fontSize:9,marginLeft:3}}>people</span>
        </div>
        <span style={{fontSize:9,fontWeight:600,color:"#fff",background:statusColor,borderRadius:8,padding:"1px 8px",textTransform:"uppercase",letterSpacing:0.3}}>{status}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginTop:3}}>
        <div>
          <span style={{fontSize:13}} className="au-gold-text">{fmtGoldKg(s.wealth||0)}</span>
          <span className="au-fade" style={{fontSize:9,marginLeft:3}}>gold treasury</span>
        </div>
        <span className="au-fade" style={{fontSize:9}}>
          {isRegion?"rural · founds towns":nextName?`${Math.round(progress*100)}% → ${nextName}`:"max tier"}
        </span>
      </div>

      {/* ── Population & food ── */}
      <PsSection id="food" title="Population & food" open={psCardOpen.food} onToggle={togglePsCard}
        right={<span style={{color:statusColor}}>{surplus>=0?"+":""}{fmtFood(surplus)}</span>}>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"2px 8px",fontSize:10}}>
          <span className="au-fade">Grain stored</span><span>{fmtFood(s.food)}</span>
          <span className="au-fade">Produced /tick</span><span>{fmtFood(supply)}</span>
          {(s._fishYield||0)>0.01&&(<><span className="au-fade">· of which fish</span><span className="au-fade">{fmtFood(s._fishYield||0)}</span></>)}
          {importRate>0.001&&(<><span className="au-fade">Imported /tick</span><span>+{fmtFood(importRate)}</span></>)}
          <span className="au-fade">Consumed /tick</span><span>{fmtFood(demand)}</span>
          <span style={{color:statusColor}}>Balance</span>
          <span style={{color:statusColor}}>{surplus>=0?"+":""}{fmtFood(surplus)} ({status})</span>
          <span className="au-fade">Territory</span><span>{farm} tile{farm===1?"":"s"}</span>
          <span className="au-fade">Capacity</span>
          <span>{fmtPeople(K)} <span className="au-fade" style={{fontSize:9}}>({limitedBy}-limited)</span></span>
          {(s.infrastructure||0)>1&&(<><span className="au-fade">· housing</span><span className="au-fade">{fmtPeople(s.infrastructure||0)}</span></>)}
          {limitedBy==="housing"&&((s._developRate||0)>0.001
            ?<><span style={{color:"#caa24a"}}>· building</span><span style={{color:"#caa24a"}}>+{fmtPeople(s._developRate||0)}/tk</span></>
            :<><span className="au-fade">· can't grow</span><span style={{color:"#c84"}}>{s._devReason==="space"?"no room (built out)":s._devReason==="materials"?"no timber/stone":s._devReason==="coin"?"can't afford materials":"—"}</span></>)}
          {limitedBy==="food"&&houseK>foodK*1.05&&(<><span className="au-fade">· could house</span><span className="au-fade">{fmtPeople(houseK)} if fed</span></>)}
          {nextThr&&<><span className="au-fade">To next tier</span><span>{fmtPeople(s.people)}/{fmtPeople(nextThr)}</span></>}
          {(s.army||0)>0.5&&(<>
            <span className="au-fade">Garrison</span>
            <span>{fmtPeople(s.army)} <span className="au-fade" style={{fontSize:9}}>({((s.army||0)/Math.max(1,s.people)*100).toFixed(1)}% of pop · fed from food)</span></span>
          </>)}
        </div>
      </PsSection>

      {/* ── Knowledge ── */}
      <PsSection id="knowledge" title="Knowledge" open={psCardOpen.knowledge} onToggle={togglePsCard}
        right={<span className="au-fade" style={{textTransform:"capitalize"}}>{era}</span>}>
        <>
          <PsKRow label="Agriculture"  val={k.agriculture||0}  colour="#7a5"/>
          <PsKRow label="Construction" val={k.construction||0} colour="#a85"/>
          <PsKRow label="Organization" val={k.organization||0} colour="#967"/>
          <PsKRow label="Metallurgy"   val={k.metallurgy||0}   colour="#86a"
                note={!cu&&!fe?"(no ore)":(fe&&co?"(steel)":fe?"(iron)":(cu&&sn?"(bronze)":"(copper)"))}/>
          <PsKRow label="Navigation"   val={k.navigation||0}   colour="#58a"
                note={wa<=0?"(no water)":null}/>
          <PsKRow label="Mobility"     val={k.mobility||0}     colour="#a76"
                note={(r.horses||0)<=0.10?"(no horses)":null}/>
        </>
      </PsSection>

      {/* ── Technologies (Civ-like discovery layer, derived from knowledge) ── */}
      <PsSection id="tech" title="Technologies" open={psCardOpen.tech} onToggle={togglePsCard}
        right={<span className="au-fade">{ERAS[tech.era]} · {tech.count}/{TECHS.length}</span>}>
        <div style={{fontSize:10}}>
          <button onClick={()=>setTechTreeOpen(true)}
            style={{width:"100%",marginBottom:6,padding:"4px 6px",cursor:"pointer",borderRadius:4,
              background:"rgba(120,90,50,0.14)",border:"1px solid rgba(120,90,50,0.35)",color:"#3a2c18",fontSize:10.5}}>
            ⛬ Open tech tree
          </button>
          <div style={{display:"flex",flexWrap:"wrap",gap:"3px 4px"}}>
            {techList.map(t=>(
              <span key={t.id} title={ERAS[t.era]}
                style={{padding:"1px 5px",borderRadius:3,background:ERA_BG[t.era]||"#b9b2a4",color:"#1a140c",whiteSpace:"nowrap",fontSize:9.5}}>
                {t.name}
              </span>
            ))}
          </div>
          {techNext.length>0&&(
            <div style={{marginTop:6,paddingTop:5,borderTop:"1px solid rgba(120,90,50,0.22)"}}>
              <div className="au-fade" style={{marginBottom:3,fontSize:9.5}}>Researching</div>
              {techNext.map(t=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <span style={{flex:"0 0 100px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.name}</span>
                  <div style={{flex:1,height:5,background:"rgba(80,60,30,0.22)",borderRadius:3,overflow:"hidden"}}>
                    <div style={{width:`${(t.prog*100)|0}%`,height:"100%",background:ERA_BG[t.era]||"#8a6"}}/>
                  </div>
                  <span className="au-fade" style={{flex:"0 0 26px",textAlign:"right"}}>{(t.prog*100)|0}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </PsSection>

      {/* ── Resources ── */}
      <PsSection id="resources" title="Resources" open={psCardOpen.resources} onToggle={togglePsCard}
        right={presentRes.length>0?<span className="au-fade">{presentRes.length}</span>:null}>
        {presentRes.length>0
          ?<div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"1px 8px",fontSize:10}}>
              {presentRes.map(([id,v])=>(
                <Fragment key={id}><span>{RES_LABEL[id]||id}</span><span>{(v*100|0)}%</span></Fragment>
              ))}
            </div>
          :<span className="au-fade" style={{fontSize:10,fontStyle:"italic"}}>No notable deposits in reach.</span>}
      </PsSection>

      {/* ── Trade & economy ── */}
      <PsSection id="trade" title="Trade & economy" open={psCardOpen.trade} onToggle={togglePsCard}
        right={<span style={{color:moneyCol(wealthDelta)}}>{wealthDelta>=0?"+":""}{fmtGoldKg(wealthDelta)}/tick</span>}>
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"2px 8px",fontSize:10}}>
            <span className="au-fade">Exchange</span>
            <span style={{color:available>0?"#caa24a":"#8a8f9c"}}>{available>0?"gold economy":"barter"}</span>
            <span style={{color:moneyCol(wealthDelta)}}>Net wealth /tick</span>
            <span style={{color:moneyCol(wealthDelta)}}>{wealthDelta>=0?"+":""}{fmtGoldKg(wealthDelta)}</span>
            <span className="au-fade">Gold held</span>
            <span style={available<=0?{color:"#8a8f9c"}:undefined} className="au-gold-text">{fmtGoldKg(s.wealth||0)}</span>
          </div>
          {/* ── Where the money comes from / goes ── categorised $/tick from
              the sim (mining, selling food, buying lumber, tribute, …). */}
          {(()=>{
            const inR=s._mInRate, outR=s._mOutRate, EPS=0.005;
            const ins=[], outs=[];
            if(inR)for(let i=0;i<inR.length;i++)if(inR[i]>EPS)ins.push([IN_LABELS[i],inR[i]]);
            if(outR)for(let i=0;i<outR.length;i++)if(outR[i]>EPS)outs.push([OUT_LABELS[i],outR[i]]);
            ins.sort((a,b)=>b[1]-a[1]); outs.sort((a,b)=>b[1]-a[1]);
            const totIn=ins.reduce((t,x)=>t+x[1],0), totOut=outs.reduce((t,x)=>t+x[1],0);
            if(ins.length===0&&outs.length===0)
              return <div className="au-fade" style={{fontSize:9,fontStyle:"italic",marginTop:4}}>No coin moving (barter / self-sufficient).</div>;
            return(
              <div style={{marginTop:5}}>
                <div className="au-fade" style={{fontSize:9}}>Gold in / out (/tick)</div>
                <div style={{display:"grid",gridTemplateColumns:"auto 1fr auto",gap:"1px 6px",fontSize:10,marginTop:1}}>
                  {ins.map(([l,v])=>(
                    <Fragment key={"i"+l}>
                      <span style={{color:"#3a7"}}>in</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l}</span>
                      <span style={{color:"#3a7"}}>+{fmtGoldKg(v)}</span>
                    </Fragment>
                  ))}
                  {outs.map(([l,v])=>(
                    <Fragment key={"o"+l}>
                      <span style={{color:"#c44"}}>out</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l}</span>
                      <span style={{color:"#c44"}}>-{fmtGoldKg(v)}</span>
                    </Fragment>
                  ))}
                  <span className="au-fade" style={{borderTop:"1px solid var(--au-line,#0002)",marginTop:1}}>net</span>
                  <span className="au-fade" style={{borderTop:"1px solid var(--au-line,#0002)",marginTop:1}}></span>
                  <span style={{color:moneyCol(totIn-totOut),borderTop:"1px solid var(--au-line,#0002)",marginTop:1}}>{totIn-totOut>=0?"+":""}{fmtGoldKg(totIn-totOut)}</span>
                </div>
              </div>
            );
          })()}
          {goodsBreakdown.length>0?(
            <div style={{marginTop:4}}>
              <div className="au-fade" style={{fontSize:9}}>Goods sold — by good ($/tick)</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"1px 6px",fontSize:10,marginTop:1}}>
                {goodsBreakdown.map(([l,v])=>(
                  <Fragment key={"g"+l}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l}</span>
                    <span style={{color:"#3a7"}}>+{v.toFixed(2)}</span>
                  </Fragment>
                ))}
              </div>
            </div>
          ):produces.length>0&&(
            <div className="au-fade" style={{fontSize:9,marginTop:3}}>Produces: {produces.join(", ")}</div>
          )}
          {profile.length===0
            ?<div className="au-fade" style={{fontSize:10,fontStyle:"italic",marginTop:4}}>No active trade routes.</div>
            :<>
              <div className="au-fade" style={{fontSize:9,marginTop:4}}>Routes (coin $/tick, or ⇄ barter)</div>
              <div style={{display:"grid",gridTemplateColumns:"auto 1fr auto",gap:"1px 6px",fontSize:10,marginTop:1}}>
                {profile.slice(0,10).map(p=>{
                  const money=Math.abs(p.netPerTick)>0.005;
                  const rl=id=>(RES_LABEL[id]||id).toLowerCase();
                  const barter=p.give&&p.get?`${rl(p.give)} ⇄ ${rl(p.get)}`:p.give?`gives ${rl(p.give)}`:p.get?`wants ${rl(p.get)}`:"barter";
                  return(
                  <Fragment key={p.partnerId}>
                    <span style={{color:money?(p.netPerTick>=0?"#3a7":"#c66"):"#8a8f9c"}}>{money?(p.netPerTick>=0?"in":"out"):"⇄"}</span>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {p.partner}
                      {!money&&<span className="au-fade" style={{marginLeft:4,fontSize:9}}>({barter})</span>}
                      {p.foodRole&&<span style={{marginLeft:4,fontSize:9,color:p.foodRole==="selling food"?"#3a7":"#c84"}}>· {p.foodRole}</span>}
                    </span>
                    <span style={{color:money?(p.netPerTick>=0?"#3a7":"#c44"):"#8a8f9c"}}>{money?`${p.netPerTick>=0?"+":""}${p.netPerTick.toFixed(2)}`:"barter"}</span>
                  </Fragment>
                  );
                })}
              </div>
            </>}
        </>
      </PsSection>

      {/* ── Chronicle (the realm's history: foundings, wars, conquests,
          plagues, famines, discoveries, growth & wealth milestones) ── */}
      {(()=>{
        const chron=psw._chronicle;
        if(!chron||chron.countryId!==s.countryId||!chron.entries||!chron.entries.length)return null;
        // The log itself opens in its own scrollable window (a long history
        // doesn't fit the card); the section here is just an opener + the latest
        // event as a teaser.
        const latest=chron.entries[chron.entries.length-1];
        return(
          <PsSection id="chronicle" title="Chronicle" open={psCardOpen.chronicle} onToggle={togglePsCard}
            right={<span className="au-fade">{chron.entries.length}</span>}>
            <div style={{fontSize:10}}>
              <button onClick={()=>setChronicleOpen(true)}
                style={{width:"100%",marginBottom:5,padding:"4px 6px",cursor:"pointer",borderRadius:4,
                  background:"rgba(120,90,50,0.14)",border:"1px solid rgba(120,90,50,0.35)",color:"#3a2c18",fontSize:10.5}}>
                📜 Open chronicle ({chron.entries.length} events)
              </button>
              <div style={{display:"flex",gap:6,lineHeight:1.3}}>
                <span className="au-fade" style={{flexShrink:0,fontVariantNumeric:"tabular-nums"}}>{yearStr(latest.step)}</span>
                <span style={{color:CHRON_COL[latest.type]||"#5a4a32"}}>{latest.text}</span>
              </div>
            </div>
          </PsSection>
        );
      })()}
    </div>
  );
})()}


{/* ─── Bottom-left collapsible legend ─── */}
{viewMode==="transport-test"&&
<div className="au-parchment" style={{position:"absolute",top:8,left:8,
  padding:"8px 12px",fontSize:11,width:240,zIndex:20,maxHeight:"calc(100vh - 80px)",overflowY:"auto"}}>
  <div className="au-heading au-sc" style={{fontSize:12,marginBottom:6,borderBottom:"1px solid rgba(58,38,20,0.25)",paddingBottom:4}}>Transport Test</div>
  {/* Era presets — set all RAW cost sliders to era-appropriate values. */}
  <div className="au-sc au-fade" style={{fontSize:9,marginBottom:3}}>Era preset (sets raw costs)</div>
  <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:6}}>
    {[
      ["Stone",      {tileLimit:1500, plain:1.30,rough:22,mountain:9,slope:12,river:0.50,coast:0.80,water:8.0,port:9,seaPassable:false}],
      ["Neolithic",  {tileLimit:3000, plain:1.15,rough:18,mountain:8,slope:10,river:0.45,coast:0.65,water:6.0,port:7,seaPassable:false}],
      ["Bronze",     {tileLimit:6000, plain:0.95,rough:14,mountain:6,slope:8, river:0.35,coast:0.50,water:3.5,port:5,seaPassable:true}],
      ["Iron",       {tileLimit:9000, plain:0.75,rough:11,mountain:5,slope:6, river:0.28,coast:0.40,water:2.2,port:3.5,seaPassable:true}],
      ["Medieval",   {tileLimit:11000,plain:0.60,rough:9, mountain:4,slope:5, river:0.22,coast:0.32,water:1.6,port:2.5,seaPassable:true}],
      ["Industrial", {tileLimit:15000,plain:0.40,rough:6, mountain:3,slope:3, river:0.18,coast:0.25,water:1.0,port:1.5,seaPassable:true}],
    ].map(([name,t])=>(
      <button key={name} className="au-btn"
        style={{fontSize:10,padding:"2px 5px",flex:"1 1 30%"}}
        onClick={()=>setTtCost(t)}>{name}</button>
    ))}
  </div>
  {/* Sub-mode toggle */}
  <div style={{display:"flex",gap:4,marginBottom:6}}>
    <button className={"au-btn"+(ttSubMode==="capitals"?" au-active":"")}
      style={{flex:1,fontSize:11,padding:"3px 6px"}}
      onClick={()=>setTtSubMode("capitals")}>Capitals</button>
    <button className={"au-btn"+(ttSubMode==="route"?" au-active":"")}
      style={{flex:1,fontSize:11,padding:"3px 6px"}}
      onClick={()=>setTtSubMode("route")}>Route</button>
  </div>
  {ttSubMode==="capitals" ? (
    <>
      <div className="au-fade" style={{fontSize:10,marginBottom:6,lineHeight:1.3}}>
        Click on land to place a capital. Shift-click clears.<br/>
        Each capital greedy-claims tiles by cheapest path.
      </div>
      <div style={{fontSize:10,marginBottom:8}}>
        Capitals: <b>{ttCapitals.length}</b>
        {ttResultRef.current && <> · claimed: {Array.from(ttResultRef.current.claimed).join(" / ")}</>}
      </div>
    </>
  ) : (
    <>
      <div className="au-fade" style={{fontSize:10,marginBottom:6,lineHeight:1.3}}>
        Click two points. The cheapest path is drawn in cyan.<br/>
        Shift-click clears. Third click starts over.
      </div>
      <div style={{fontSize:10,marginBottom:8}}>
        Start: <b>{ttRoute.start?`(${ttRoute.start.x},${ttRoute.start.y})`:"—"}</b><br/>
        End: <b>{ttRoute.end?`(${ttRoute.end.x},${ttRoute.end.y})`:"—"}</b>
        {ttRouteResultRef.current && <><br/>
          Length: <b>{ttRouteResultRef.current.path.length} tiles</b><br/>
          Total cost: <b>{ttRouteResultRef.current.totalCost.toFixed(1)}</b>
        </>}
      </div>
    </>
  )}
  {/* Raw travel-cost sliders — the EXACT per-terrain / per-mode costs the BFS
      charges. Grouped: land terrain, then water/river, then the mode-change. */}
  <div className="au-sc au-fade" style={{fontSize:9,margin:"2px 0 3px"}}>Travel cost per tile</div>
  {/* Sea-passable toggle (going on/off water at all). */}
  <button className={"au-btn au-block"+(ttCost.seaPassable?" au-active":"")} style={{fontSize:10,marginBottom:5}}
    onClick={()=>setTtCost(p=>({...p,seaPassable:!p.seaPassable}))}>
    Sea {ttCost.seaPassable?"passable":"IMPASSABLE"}
  </button>
  {[
    ["tileLimit","Tiles / capital",100,15000,100,"how much each capital claims"],
    ["plain","Plain (flat land)",0.2,3,0.05,"open level ground, per tile"],
    ["rough","Rough terrain",0,30,0.5,"× local slope-variance² (hills, badlands)"],
    ["mountain","Mountain (elevation)",0,20,0.5,"penalty above e=0.25"],
    ["slope","Slope climb",0,20,0.5,"per-step elevation change"],
    ["river","River (along)",0.1,2,0.05,"travelling along a major river"],
    ["coast","Coast",0.1,2,0.05,"hugging the shoreline"],
    ["water","Sea crossing",0.3,20,0.1,"open ocean, per tile (if passable)"],
    ["port","Mode change ⇄",0,15,0.25,"on/off water · land↔river"],
  ].map(([k,label,min,max,step,hint])=>(
    <div key={k} style={{marginBottom:4}} title={hint}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10}}>
        <span>{label}</span><b>{ttCost[k].toFixed(k==="tileLimit"?0:2)}</b>
      </div>
      <input type="range" min={min} max={max} step={step}
        value={ttCost[k]} disabled={k==="water"&&!ttCost.seaPassable}
        onChange={e=>setTtCost(p=>({...p,[k]:parseFloat(e.target.value)}))}
        style={{width:"100%",opacity:(k==="water"&&!ttCost.seaPassable)?0.4:1}}/>
      <div className="au-fade" style={{fontSize:8.5,lineHeight:1.1,marginTop:-1}}>{hint}</div>
    </div>
  ))}
  <button className="au-btn au-block" style={{marginTop:6,fontSize:11}}
    onClick={()=>{
      if(ttSubMode==="capitals")setTtCapitals([]);
      else setTtRoute({start:null,end:null});
    }}>{ttSubMode==="capitals"?"Clear capitals":"Clear route"}</button>
</div>}
{(viewMode==="terrain"||viewMode==="atlas"||viewMode==="resources")&&
<div className="au-parchment" style={{position:"absolute",bottom:8,left:8,
  padding:keyOpen?"6px 10px 8px":"4px 10px",fontSize:11,maxWidth:200,zIndex:20}}>
<div style={{cursor:"pointer",display:"flex",alignItems:"center",gap:5,
  borderBottom:keyOpen?"1px solid rgba(58,38,20,0.18)":"none",paddingBottom:keyOpen?3:0,marginBottom:keyOpen?4:0}}
  onClick={()=>setKeyOpen(v=>!v)}>
  <span className="au-heading au-sc" style={{fontSize:10,flex:1}}>{keyOpen?"▾":"▸"} Key</span>
</div>
{keyOpen&&<div className="au-key">
  {viewMode==="terrain"&&[4,5,6,7,8,9,10,15,11,12,14,13,16].map(bi=>(
    <div key={bi} className="au-key-row">
      <span className="au-key-swatch" style={{background:`rgb(${BC[bi][0]},${BC[bi][1]},${BC[bi][2]})`}} />
      <span>{BN[bi]}</span>
    </div>))}
  {viewMode==="atlas"&&[["#e6d8ad","Lowland"],["#e3bd83","Desert"],["#ede7e1","Snow / tundra"],["#586139","Forest"],["#cabd8f","Mountains"],["#1a0f04","Sea"]].map(([c,l])=>(
    <div key={l} className="au-key-row">
      <span className="au-key-swatch" style={{background:c}} />
      <span>{l}</span>
    </div>))}
  {viewMode==="resources"&&<div>
    {RESOURCES.map(r=>{const on=activeRes[r.id];return(
      <div key={r.id} className="au-key-row" style={{cursor:"pointer",opacity:on?1:0.4}}
        onClick={()=>setActiveRes(prev=>{const next={...prev};next[r.id]=!prev[r.id];return next;})}>
        <span className="au-key-swatch" style={{background:on?`rgb(${r.color.join(",")})`:"#888"}} />
        <span>{r.label}</span>
        <span className="au-fade" style={{fontSize:9,marginLeft:"auto"}}>{r.era}</span>
      </div>);})}
    <div className="au-rule" style={{margin:"4px 0"}} />
    <div style={{display:"flex",gap:8,fontSize:10}}>
      <span style={{cursor:"pointer"}} className="au-fade"
        onClick={()=>{const s={};for(const r of RESOURCES)s[r.id]=true;setActiveRes(s);}}>All</span>
      <span style={{cursor:"pointer"}} className="au-fade"
        onClick={()=>{const s={};for(const r of RESOURCES)s[r.id]=false;setActiveRes(s);}}>None</span>
    </div>
  </div>}
</div>}
</div>}

{/* ─── Depth contextual controls ─── */}
{viewMode==="depth"&&<div className="au-parchment" style={{position:"absolute",bottom:8,left:8,
  padding:"6px 12px",fontSize:11,display:"flex",alignItems:"center",gap:10,zIndex:20}}>
<button onClick={()=>{setDepthFromSea(v=>!v);depthFromSeaRef.current=!depthFromSeaRef.current;}}
  className={"au-btn"+(depthFromSea?" au-active":"")}>{depthFromSea?"From Sea":"From Floor"}</button>
<span className="au-sc au-fade" style={{fontSize:10}}>Range</span>
<input type="range" min="0.05" max="1.0" step="0.05" value={depthCeil}
  onChange={e=>{const v=parseFloat(e.target.value);setDepthCeil(v);depthCeilRef.current=v;}}
  style={{width:90}} />
<span className="au-fade">{Math.round(depthCeil*100)}%</span>
</div>}

{viewMode==="money"&&<div className="au-parchment" style={{position:"absolute",bottom:8,left:8,
  padding:"8px 12px",fontSize:11,zIndex:20,maxWidth:230}}>
  <div className="au-pico-title" style={{fontSize:12,marginBottom:4}}>Money flow</div>
  <div style={{display:"flex",alignItems:"center",gap:6,margin:"2px 0"}}>
    <span style={{width:12,height:12,borderRadius:"50%",background:"radial-gradient(rgba(255,210,80,0.9),rgba(255,210,80,0))",flexShrink:0}}/>
    <span>Mining — money minted into the system</span></div>
  <div style={{display:"flex",alignItems:"center",gap:6,margin:"2px 0"}}>
    <span style={{width:9,height:9,borderRadius:"50%",background:"#ffcf46",flexShrink:0}}/>
    <span>Gaining wealth</span>
    <span style={{width:9,height:9,borderRadius:"50%",background:"#e0563b",marginLeft:8,flexShrink:0}}/>
    <span>Losing</span></div>
  <div style={{display:"flex",alignItems:"center",gap:6,margin:"2px 0"}}>
    <span style={{color:"#ffcd46"}}>● ● ●</span>
    <span>Coins flow from buyer to seller</span></div>
  <div className="au-fade" style={{fontSize:9,fontStyle:"italic",marginTop:4}}>
    Dot density on each link is its share of THIS tick's total activity, so
    the busiest links pop and quiet ones go silent regardless of the world's
    absolute money supply. The world starts on barter (no coins shown).
  </div>
</div>}

</div>{/* end map area */}

</div>{/* end center column */}

{/* ══════════ RIGHT RAIL ══════════ */}
<aside className="au-parchment au-scroll" style={{
  width:128,minWidth:128,margin:"6px 6px 6px 3px",padding:"10px 0",
  display:"flex",flexDirection:"column",gap:1,overflowY:"auto"}}>

<div className="au-heading au-sc au-fade" style={{fontSize:10,padding:"0 14px 4px"}}>View</div>
{VIEW_MODES.map(([k,label])=>(
  <button key={k} onClick={()=>{setViewMode(k);viewRef.current=k;}}
    className={"au-rail-tab"+(viewMode===k?" au-active":"")}>{label}</button>
))}

<div className="au-rule" />
<div className="au-heading au-sc au-fade" style={{fontSize:10,padding:"6px 14px 4px"}}>Overlay</div>
<button onClick={()=>{setShowRivers(v=>!v);showRiversRef.current=!showRiversRef.current;}}
  className={"au-rail-tab"+(showRivers?" au-active":"")}>Rivers</button>
{showRivers&&<button onClick={()=>{setShowStreams(v=>!v);showStreamsRef.current=!showStreamsRef.current;}}
  className={"au-rail-tab"+(showStreams?" au-active":"")} style={{paddingLeft:22,fontSize:11}}>· Streams</button>}
<button onClick={()=>{setShowLakes(v=>!v);showLakesRef.current=!showLakesRef.current;}}
  className={"au-rail-tab"+(showLakes?" au-active":"")}>Lakes</button>
{world&&world.pixPlate&&<button onClick={()=>{setShowPlates(v=>!v);showPlatesRef.current=!showPlatesRef.current;}}
  className={"au-rail-tab"+(showPlates?" au-active":"")}>Plates</button>}
<button onClick={()=>setShowGlobe(!showGlobe)}
  className={"au-rail-tab"+(showGlobe?" au-active":"")}>Globe</button>
<button onClick={()=>setLayersOpen(v=>!v)}
  className={"au-rail-tab"+(layersOpen?" au-active":"")}>Layers</button>
<button onClick={()=>setBoardOpen(v=>!v)}
  className={"au-rail-tab"+(boardOpen?" au-active":"")}>Leaderboard</button>
<button onClick={()=>setChartsOpen(v=>!v)}
  className={"au-rail-tab"+(chartsOpen?" au-active":"")}>History</button>

{(preset==="tectonic"||preset==="earth"||preset==="earth_sim")&&<>
<div className="au-rule" />
<div className="au-heading au-sc au-fade" style={{fontSize:10,padding:"6px 14px 4px"}}>Tools</div>
<button onClick={()=>setRightPanel(rightPanel==="params"?"":"params")}
  className={"au-rail-tab"+(rightPanel==="params"?" au-active":"")}>Params</button>
{preset==="tectonic"&&<button onClick={()=>setShowTuning(true)}
  className="au-rail-tab">Tune</button>}
{preset==="earth_sim"&&<button onClick={()=>setLeversOpen(v=>!v)}
  className={"au-rail-tab"+(leversOpen?" au-active":"")}>Sim Levers</button>}
</>}
</aside>

{/* ══════════ PARAMS DRAWER ══════════ */}
{layersOpen&&(()=>{
  const tog=(k)=>setLayers(L=>({...L,[k]:!L[k]}));
  const Row=({k,label,indent})=>(
    <button onClick={()=>tog(k)}
      className={"au-rail-tab"+(layers[k]?" au-active":"")}
      style={{paddingLeft:14+(indent||0),width:"100%",textAlign:"left",fontSize:12}}>{label}</button>
  );
  return(
    <aside className="au-parchment au-scroll" style={{
      position:"absolute",right:142,top:6,width:220,maxHeight:"80vh",
      padding:"10px 0",overflowY:"auto",zIndex:30}}>
      <div style={{display:"flex",alignItems:"baseline",marginBottom:4,padding:"0 12px"}}>
        <span className="au-heading au-sc" style={{fontSize:12}}>Layers</span>
        <div style={{flex:1}} />
        <span onClick={()=>setLayersOpen(false)}
          style={{cursor:"pointer",fontSize:18,color:"var(--au-ink-light)"}}>×</span>
      </div>
      <div className="au-heading au-sc au-fade" style={{fontSize:10,padding:"4px 14px 2px"}}>Map</div>
      <Row k="tints" label="Country tints" />
      <Row k="borders" label="Borders" />
      <Row k="provinces" label="Province borders" />
      <Row k="roads" label="Roads" />
      <Row k="seaLanes" label="Sea lanes" />
      <Row k="moneyFlow" label="Money flow" />
      <div className="au-heading au-sc au-fade" style={{fontSize:10,padding:"8px 14px 2px"}}>Settlements</div>
      <Row k="icons" label="Icons (master)" />
      <Row k="village" label="· Farming Regions" indent={10} />
      <Row k="town" label="· Towns" indent={10} />
      <Row k="city" label="· Cities" indent={10} />
      <Row k="metropolis" label="· Metropolises" indent={10} />
      <Row k="shocks" label="Plague / famine outlines" />
      <div className="au-heading au-sc au-fade" style={{fontSize:10,padding:"8px 14px 2px"}}>Moving</div>
      <Row k="ships" label="Colony ships" />
    </aside>
  );
})()}

{boardOpen&&(()=>{
  // Leaderboard. Pulls live data from the mirror (peopleRef.current) — same
  // structure draw() reads — so the panel always reflects the current snapshot.
  const psw=peopleRef.current;
  if(!psw||!psw.settlements)return null;
  const setts=psw.settlements.filter(s=>s&&s.mode==="settled");
  const countries=psw.countries?Array.from(psw.countries.values()):[];

  // Sort keys per mode. Functions return a number (descending sort).
  const SETT_SORTS={
    population:[s=>s.people,"Population",fmtPeople],
    wealth:[s=>s.wealth||0,"Wealth",fmtGoldKg],
    army:[s=>s.army||0,"Garrison",fmtPeople],
    mining:[s=>s._minedRate||0,"Mining rate",fmtGoldKg],
    vassals:[s=>s._vassalCount||0,"Vassals"],
    income:[s=>s._wealthDelta||0,"Income (gold/tick)",fmtGoldKg],
  };
  const CNT_SORTS={
    size:[c=>c.members?c.members.length:0,"Size (settlements)"],
    population:[c=>(c.members||[]).reduce((a,m)=>a+(m.people||0),0),"Population",fmtPeople],
    wealth:[c=>(c.members||[]).reduce((a,m)=>a+(m.wealth||0),0),"Total wealth",fmtGoldKg],
    treasury:[c=>c._treasury||0,"State treasury",fmtGoldKg],
    army:[c=>(c.members||[]).reduce((a,m)=>a+(m.army||0),0),"Standing army",fmtPeople],
    capacity:[c=>c._capacity||0,"Control capacity"],
  };
  const sorts=boardMode==="settlements"?SETT_SORTS:CNT_SORTS;
  const sortKey=sorts[boardSort]?boardSort:Object.keys(sorts)[0];
  const [sortFn,sortLabel,sortFmt]=sorts[sortKey];
  const rows=(boardMode==="settlements"?setts:countries).slice()
    .sort((a,b)=>sortFn(b)-sortFn(a)).slice(0,15);

  const fmt=v=>{
    if(!isFinite(v))return "-";
    const a=Math.abs(v);
    if(a>=1e6)return (v/1e6).toFixed(1)+"M";
    if(a>=1e3)return (v/1e3).toFixed(1)+"k";
    if(a>=10)return Math.round(v).toString();
    return v.toFixed(1);
  };

  return(
    <aside className="au-parchment au-scroll" style={{
      position:"absolute",right:142,top:6,width:340,maxHeight:"80vh",
      padding:"10px 0",overflowY:"auto",zIndex:30}}>
      <div style={{display:"flex",alignItems:"baseline",marginBottom:6,padding:"0 12px"}}>
        <span className="au-heading au-sc" style={{fontSize:12}}>Leaderboard</span>
        <div style={{flex:1}} />
        <span onClick={()=>setBoardOpen(false)}
          style={{cursor:"pointer",fontSize:18,color:"var(--au-ink-light)"}}>×</span>
      </div>
      <div style={{display:"flex",gap:4,padding:"0 12px 6px"}}>
        {["countries","settlements"].map(m=>(
          <button key={m} onClick={()=>setBoardMode(m)}
            className={"au-rail-tab"+(boardMode===m?" au-active":"")}
            style={{flex:1,fontSize:11,textTransform:"capitalize"}}>{m}</button>
        ))}
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:3,padding:"0 12px 6px"}}>
        {Object.entries(sorts).map(([k,[,label]])=>(
          <button key={k} onClick={()=>setBoardSort(k)}
            className={"au-rail-tab"+(sortKey===k?" au-active":"")}
            style={{fontSize:10,padding:"3px 7px",textTransform:"none"}}>{label}</button>
        ))}
      </div>
      <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
        <thead>
          <tr style={{color:"var(--au-fade)",textAlign:"left"}}>
            <th style={{padding:"2px 6px 2px 12px",width:24}}>#</th>
            <th style={{padding:"2px 4px"}}>{boardMode==="settlements"?"Settlement":"Country"}</th>
            <th style={{padding:"2px 12px 2px 4px",textAlign:"right"}}>{sortLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r,i)=>{
            if(boardMode==="settlements"){
              const ctry=psw.countries&&psw.countries.get(r.countryId);
              const hue=((r.countryId*61)%360+360)%360;
              return(
                <tr key={r.id}
                  onClick={()=>setSelectedSettlementId(r.id)}
                  style={{cursor:"pointer",borderTop:"1px solid rgba(0,0,0,0.06)"}}>
                  <td style={{padding:"3px 6px 3px 12px",color:"var(--au-fade)"}}>{i+1}</td>
                  <td style={{padding:"3px 4px"}}>
                    <span style={{display:"inline-block",width:7,height:7,borderRadius:2,
                      background:`hsl(${hue},55%,50%)`,marginRight:6,verticalAlign:"middle"}}/>
                    <span style={{textTransform:"capitalize"}}>{r.name}</span>
                    {ctry&&ctry.capitalId===r.id&&<span style={{color:"var(--au-fade)",marginLeft:4}}>· capital</span>}
                  </td>
                  <td style={{padding:"3px 12px 3px 4px",textAlign:"right"}}>{(sortFmt||fmt)(sortFn(r))}</td>
                </tr>
              );
            }
            const cap=r.capital||(r.members&&r.members[0]);
            const hue=((r.id*61)%360+360)%360;
            return(
              <tr key={r.id}
                onClick={()=>{if(cap)setSelectedSettlementId(cap.id);}}
                style={{cursor:"pointer",borderTop:"1px solid rgba(0,0,0,0.06)"}}>
                <td style={{padding:"3px 6px 3px 12px",color:"var(--au-fade)"}}>{i+1}</td>
                <td style={{padding:"3px 4px"}}>
                  <span style={{display:"inline-block",width:7,height:7,borderRadius:2,
                    background:`hsl(${hue},55%,50%)`,marginRight:6,verticalAlign:"middle"}}/>
                  <span style={{textTransform:"capitalize"}}>{cap?cap.name:"realm-"+r.id}</span>
                </td>
                <td style={{padding:"3px 12px 3px 4px",textAlign:"right"}}>{(sortFmt||fmt)(sortFn(r))}</td>
              </tr>
            );
          })}
          {rows.length===0&&<tr><td colSpan={3} style={{padding:"10px 12px",color:"var(--au-fade)",fontStyle:"italic"}}>no data yet</td></tr>}
        </tbody>
      </table>
    </aside>
  );
})()}

{chartsOpen&&(()=>{
  const H=psHistoryRef.current;
  const copy=()=>{ const t=buildHistoryExport(H);
    try{navigator.clipboard.writeText(t);}catch{/* clipboard blocked — ignore */}
    setStatsCopied(true); setTimeout(()=>setStatsCopied(false),1500); };
  const curStep=H.length?H[H.length-1].step:0;
  return(
    <aside className="au-parchment au-scroll" style={{
      position:"absolute",right:142,top:6,width:316,maxHeight:"88vh",
      padding:"10px 0",overflowY:"auto",zIndex:31}}>
      <div style={{display:"flex",alignItems:"baseline",marginBottom:4,padding:"0 12px"}}>
        <span className="au-heading au-sc" style={{fontSize:12}}>History</span>
        <span className="au-fade" style={{fontSize:9,marginLeft:6}}>step {curStep}</span>
        <div style={{flex:1}} />
        <span onClick={()=>setChartsOpen(false)}
          style={{cursor:"pointer",fontSize:18,color:"var(--au-ink-light)"}}>×</span>
      </div>
      <MiniChart data={H} get={d=>d.pop}            label="Population"               color="#c98a3a" fmtY={fmtPeople}/>
      <MiniChart data={H} get={d=>d.gold}           label="Gold (coin + treasuries)" color="#d8b13a" fmtY={fmtGoldKg}/>
      <MiniChart data={H} get={d=>d.landPct*100}    label="Land claimed"             color="#5a9367" fmtY={v=>v.toFixed(0)+"%"}/>
      <MiniChart data={H} get={d=>d.countries}      label="Countries"                color="#7a6da8" fmtY={v=>Math.round(v).toString()}/>
      <MiniChart data={H} get={d=>d.cities+d.metros} label="Cities + metropolises"   color="#b5562f" fmtY={v=>Math.round(v).toString()}/>
      <MiniChart data={H} get={d=>d.sett}           label="Settlements"              color="#8a8f9c" fmtY={v=>Math.round(v).toString()}/>
      <MiniChart data={H} get={d=>d.largest}        label="Largest empire (tiles)"   color="#4a78a8" fmtY={v=>Math.round(v).toLocaleString()}/>
      <div style={{padding:"6px 10px 2px",borderTop:"1px solid rgba(0,0,0,0.08)",marginTop:4}}>
        <button onClick={copy} className="au-rail-tab au-active" style={{width:"100%",fontSize:11,padding:"5px 0"}}>
          {statsCopied?"Copied ✓":"Copy stats rundown"}
        </button>
        <div className="au-fade" style={{fontSize:9,marginTop:3,lineHeight:1.35}}>
          Copies a markdown table of the run so far (~40 rows) — paste it back for a full breakdown over time.
        </div>
      </div>
    </aside>
  );
})()}

{rightPanel==="params"&&(preset==="tectonic"||preset==="earth"||preset==="earth_sim")&&
<aside className="au-parchment au-scroll" style={{
  position:"absolute",right:142,top:6,bottom:6,width:300,
  padding:"10px 12px",overflowY:"auto",zIndex:30}}>
<div style={{display:"flex",alignItems:"baseline",marginBottom:6}}>
  <span className="au-heading au-sc" style={{fontSize:12}}>{preset==="tectonic"?"Parameters":"Wind & Moisture"}</span>
  <div style={{flex:1}} />
  <span onClick={()=>setRightPanel("")}
    style={{cursor:"pointer",fontSize:18,color:"var(--au-ink-light)"}}>×</span>
</div>
<ParamEditor params={{..._tecParams}}
  onChange={(p)=>{_tecParams=p;setTecPresetName("(unsaved)");generate(seed);}}
  groups={preset==="earth"?["wind"]:preset==="earth_sim"?["wind","moisture"]:undefined} />
</aside>}

{/* ══════════ SIM LEVERS PANEL ══════════ */}
{leversOpen&&<SimLevers values={tuneVals} onChange={onLeverChange}
  onResetKey={onLeverResetKey} onResetAll={onLeverResetAll}
  onClose={()=>setLeversOpen(false)} />}

{/* ══════════ TUNING MODAL ══════════ */}
{showTuning&&<TuningPanel noiseFns={{initNoise,fbm,ridged,noise2D,worley}} seed={seed}
  params={{..._tecParams}}
  onParamsChange={(p)=>{_tecParams=p;setTecPresetName("(unsaved)");generate(seed);}}
  onClose={()=>setShowTuning(false)} />}

</div>);}
