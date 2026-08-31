// ── Shared display bits: units, formatters, small presentational pieces ────
// Extracted from WorldSim.jsx (monolith dissolution). Module-scope component
// types on purpose: a component defined inside a render is a NEW type every
// render, so React remounts it each sim tick and clicks get eaten.

// ── Display units (peopleSim) ───────────────────────────────────────
// MOVED to src/sim/units.js and re-exported here so existing imports keep working.
// They had to leave this file because it is JSX: node cannot parse it, so the
// measurement tools could not import the scale and reported raw sim units while
// the game reported people — a silent thousand-fold discrepancy that produced two
// retracted findings. See src/sim/units.js for the full note.
export { POP_SCALE, FOOD_KG_PER_UNIT, GOLD_G_PER_COIN } from "../sim/units.js";
import { POP_SCALE, FOOD_KG_PER_UNIT, GOLD_G_PER_COIN } from "../sim/units.js";

// Compact number: 1234 → "1.2k", 3_400_000 → "3.4M", 2.1e9 → "2.1B".
export function fmtNum(n){
  const s=n<0?"-":""; const a=Math.abs(n);
  if(a>=1e9)return s+(a/1e9).toFixed(1)+"B";
  if(a>=1e6)return s+(a/1e6).toFixed(a>=1e7?0:1)+"M";
  if(a>=1e3)return s+(a/1e3).toFixed(a>=1e4?0:1)+"k";
  return s+Math.round(a).toString();
}
// Mass in kilograms → grams / kg / tonnes / kilotonnes.
export function fmtMass(kg){
  const s=kg<0?"-":""; const a=Math.abs(kg);
  if(a>=1e6)return s+(a/1e6).toFixed(1)+" kt";
  if(a>=1e3)return s+(a/1e3).toFixed(a>=1e4?0:1)+" t";
  if(a>=1)return s+(a>=100?Math.round(a):a.toFixed(1))+" kg";
  return s+Math.round(a*1000)+" g";
}
// People — scale sim population to real people.
export function fmtPeople(p){ return fmtNum((p||0)*POP_SCALE); }
// Food (grain) shown as a mass.
export function fmtFood(simFood){ return fmtMass((simFood||0)*FOOD_KG_PER_UNIT); }
// Wealth shown as a mass of gold.
export function fmtGoldKg(simCoin){ return fmtMass((simCoin||0)*GOLD_G_PER_COIN/1000); }

// Settlement population readout: s.people is the CATCHMENT (city + countryside);
// s._urbanPop is the city core alone (when CITY_CORE is on).
export function fmtCatchmentPop(simUnits, note) {
  const p = fmtPeople(simUnits);
  return note ? `${p} (${note})` : p;
}
export function fmtUrbanCatchment(urban, catchment) {
  if (urban != null && urban > 0 && catchment > urban * 1.05) {
    return `${fmtPeople(urban)} in the city · ${fmtPeople(catchment)} catchment`;
  }
  return `${fmtPeople(catchment)} catchment`;
}

// Food ledger for the inspect card — mirrors the famine physics' rulers
// (_foodSupply = net flow incl. imports; _landFood = local harvest only;
// granary = s.food; _coreNeed = urban core + garrison mouths).
export function foodLedgerInfo(s) {
  const supply = s._foodAvail != null ? s._foodAvail : (s._foodSupply || 0);
  const flow = s._foodFlow != null ? s._foodFlow : (s._foodSupply || 0);
  const demand = s._foodDemand || 0;
  const importRate = s._foodImportRate || 0;
  const landFood = s._landFood || 0;
  const surplus = supply - demand;
  const eps = Math.max(0.02, demand * 0.02);
  const ticksLeft = demand > 0 ? (s.food || 0) / demand : Infinity;
  const coreNeed = s._coreNeed !== undefined ? s._coreNeed : demand;
  const fedM = s._fedM;
  const besieged = !!s._besiegedNow;
  let status, statusColor;
  if (besieged) {
    status = "besieged";
    statusColor = "#a44";
  } else if (surplus > eps) {
    status = "surplus";
    statusColor = "#3a7";
  } else if (surplus < -eps) {
    const store = s.food || 0;
    if (store <= 0.01 && flow < coreNeed && store < coreNeed) {
      status = "starving";
      statusColor = "#c44";
    } else if (ticksLeft < 50) {
      status = "eating stores";
      statusColor = "#a95";
    } else {
      status = "on stores";
      statusColor = "#c84";
    }
  } else {
    status = "balanced";
    statusColor = "#888";
  }
  return { supply, demand, importRate, landFood, surplus, eps, ticksLeft, coreNeed, fedM, besieged, status, statusColor };
}

// Shock banner copy — distinguish lean harvest from granary crisis.
export function foodShockLabel(s) {
  const sh = s._shock || 0;
  if (sh === 2) return { text: "struck by plague", hue: 280 };
  if (s._besiegedNow) return { text: "under siege — eating granary stores", hue: 8 };
  if (sh !== 1) return null;
  const demand = s._foodDemand || 1;
  const runway = demand > 0 ? (s.food || 0) / demand : Infinity;
  if (runway < 30) return { text: "famine — granary draining", hue: 30 };
  return { text: "lean harvest — stores buffering", hue: 42 };
}

// ── History charts ──────────────────────────────────────────────────
// One metric over sim-steps as a small SVG line chart (the History panel).
export function MiniChart({data,get,label,color,fmtY}){
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
export function buildHistoryExport(H){
  if(!H||!H.length)return "No history yet — let the simulation run for a while, then copy again.";
  const N=H.length,stride=Math.max(1,Math.ceil(N/40)),rows=[];
  for(let i=0;i<N;i+=stride)rows.push(H[i]);
  if(rows[rows.length-1]!==H[N-1])rows.push(H[N-1]);
  const head="| step | catchment pop | gold | land % | countries | settlements | villages | cities | metros | largest empire (tiles) | army |";
  const sep ="|---|---|---|---|---|---|---|---|---|---|---|";
  const body=rows.map(r=>`| ${r.step} | ${fmtPeople(r.pop)} | ${fmtGoldKg(r.gold)} | ${(r.landPct*100).toFixed(0)}% | ${r.countries} | ${r.sett} | ${r.villages} | ${(r.towns||0)+(r.cities||0)} | ${r.metros} | ${r.largest} | ${fmtPeople(r.army)} |`).join("\n");
  return `Simman — global stats over time (catchment pop = Σ settlement catchments; 1 sim-person = ${POP_SCALE} people; gold by weight; land % of all land)\n\n${head}\n${sep}\n${body}`;
}

// ── Settlement-card presentational components ──
// Defined at module scope (stable identities) so they are NOT redefined
// every WorldSim render. The card re-renders several times a second while
// the sim plays; if these lived inside the render, React would treat them
// as new component types each time and tear down + rebuild their DOM —
// causing flicker and making the collapsible headers flaky to click.
// A clickable entity chip: swatch/emblem + name → navigates the codex.
// MODULE scope, like every presentational component here: a component type
// defined inside WorldSim's render is a NEW type each render, so React
// remounts it every sim tick and clicks that straddle a remount are lost
// (the layer-toggle bug of old — see the layers popover comment).
export function Chip({hue,img,onClick,cap=true,children,title}){
  return(
    <button className="au-chip" onClick={onClick} title={title||"Open"}>
      {img?<img src={img} alt="" style={{height:13,flexShrink:0}}/>:hue!=null?<span className="au-chip-sw" style={{background:`hsl(${hue|0},58%,50%)`}}/>:null}
      <span style={cap?{textTransform:"capitalize"}:undefined}>{children}</span>
    </button>
  );
}
export function PsBar({ v, color }) {
  return (
    <div style={{ position:"relative", height:5, background:"rgba(255,255,255,0.10)", borderRadius:2, marginTop:1 }}>
      <div style={{ position:"absolute", inset:0, width:`${Math.max(0,Math.min(1,v))*100}%`, background:color||"#7a5", borderRadius:2 }} />
    </div>
  );
}
export function PsKRow({ label, val, colour, note }) {
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
export function PsSection({ id, title, right, open, onToggle, children }) {
  return (
    <div style={{ marginTop:6, borderTop:"1px solid rgba(216,190,150,0.12)", paddingTop:5 }}>
      <div onClick={(e)=>{ e.stopPropagation(); onToggle(id); }} className="au-fade"
        style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", userSelect:"none", fontSize:10, letterSpacing:0.4, textTransform:"uppercase" }}>
        <span>{open ? "▾" : "▸"} {title}</span>
        {right!=null && <span style={{ textTransform:"none", letterSpacing:0 }}>{right}</span>}
      </div>
      {open && <div style={{ marginTop:4 }}>{children}</div>}
    </div>
  );
}
