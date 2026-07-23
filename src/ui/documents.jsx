// ── Full-screen documents: tech tree · chronicle · dynasty ─────────────────
// Extracted from WorldSim.jsx (the monolith dissolution, plan §13.1): pure
// presentational components over snapshot data — no worker or map coupling.
import { useState, useEffect, Fragment } from "react";
import { TECHS, ERAS, TECH_IDX, techState, techNodeState, techLayout, techEdgePath, techEffectList, techTotalList } from "../sim/peopleSim/tech.js";
import { displayYearStr } from "../sim/calendar.js";

// tech-chip tint per era: stone · bronze · classical · medieval · renaissance · industrial · modern
export const ERA_BG=["#b7b0a2","#cf9a63","#dab347","#86a98f","#b596c4","#8fa6bb","#d9e2ea"];
// effect-chip colour per channel (food=green, naval=teal, build=tan, war=red, admin=violet, trade=jade, wealth=gold)
export const FX_COLOR={farm:"#5f7d33",fish:"#2f7d8a",build:"#9a6f38",military:"#9c3a36",reach:"#6a4a8d",cohesion:"#9a6a33",defense:"#566089",trade:"#2f7d5a",wealth:"#9a7a24",seaSpeed:"#2f6d8a",seaRange:"#2f6d8a",embark:"#2f7d8a",ocean:"#2a6a8a",colonize:"#2a6a8a",walls:"#566089",market:"#2f7d5a"};

// ── Tech-tree overlay (Civ-like skill tree) ─────────────────────────
// Full-screen modal showing the whole tech DAG for the selected settlement:
// era columns, prerequisite links, and per-node state (discovered / researching
// with progress / locked). Pure view over tech.js + the settlement's knowledge.
export function TechTreeOverlay({k,title,onClose,z=60}){
  const ts=techState(k||{});
  const L=techLayout();
  const {pos,NW,NH,TOP,W,H}=L;
  const [hov,setHov]=useState(null);   // {id,x,y} — hovered tech for the effect card
  const chip=(bg,bd)=>(<span style={{display:"inline-block",width:9,height:9,background:bg,border:bd,borderRadius:2,marginRight:4,verticalAlign:"middle",boxSizing:"border-box"}}/>);
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(10,8,6,0.74)",zIndex:z,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} className="au-parchment au-elev" style={{padding:"10px 14px",maxWidth:"96vw",maxHeight:"94vh",overflow:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <div className="au-pico-title" style={{fontSize:15}}>Tech Tree{title?` — ${title}`:""}{" "}
            <span className="au-fade" style={{fontSize:11}}>· {ERAS[ts.era]} · {ts.count}/{TECHS.length} discovered</span></div>
          <button onClick={onClose} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--au-fade)",fontSize:18,lineHeight:1,padding:"0 2px"}}>×</button>
        </div>
        {(()=>{const tot=techTotalList(ts.have);if(!tot.length)return null;
          return <div style={{display:"flex",flexWrap:"wrap",gap:3,alignItems:"center",marginBottom:7,paddingBottom:6,borderBottom:"1px solid rgba(216,190,150,0.2)"}}>
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
              <text x={cx} y={TOP-12} textAnchor="middle" fontSize={11} fill="#b8a482" fontWeight="bold" style={{textTransform:"uppercase",letterSpacing:0.5}}>{e}</text>
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
              stroke={open?"#a8895c":"rgba(216,190,150,0.22)"} strokeWidth={open?1.7:1} strokeDasharray={open?"":"3 3"}/>;
          }))}
          {/* tech nodes (opaque fills occlude the links routed behind them) */}
          {TECHS.map(t=>{const p=pos[t.id];const ns=techNodeState(k||{},ts.have,t);const era=ERA_BG[t.era]||"#b9b2a4";
            let fill,stroke,txt,sw,dash="";
            if(ns.state==="have"){fill=era;stroke="#3a2c18";txt="#1a140c";sw=1.1;}
            else if(ns.state==="next"){fill="#fffaf0";stroke=era;txt="#2c2114";sw=2;}
            else{fill="rgba(255,255,255,0.07)";stroke="rgba(216,190,150,0.30)";txt="rgba(228,214,184,0.55)";sw=1;dash="4 3";}
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
          <span>{chip("rgba(255,255,255,0.07)","1px dashed rgba(216,190,150,0.4)")}locked — needs an earlier tech</span>
        </div>
      </div>
      {hov&&(()=>{
        const t=TECHS[TECH_IDX[hov.id]]; if(!t) return null;
        const ns=techNodeState(k||{},ts.have,t); const fx=techEffectList(hov.id);
        const vw=typeof window!=="undefined"?window.innerWidth:1280, vh=typeof window!=="undefined"?window.innerHeight:800;
        const left=Math.min(hov.x+16, vw-258), top=Math.min(hov.y+16, vh-200);
        return(<div style={{position:"fixed",left,top,width:242,zIndex:320,pointerEvents:"none",
          background:"#262019",border:`2px solid ${ERA_BG[t.era]||"#b9b2a4"}`,borderRadius:7,padding:"8px 10px",boxShadow:"0 6px 18px rgba(0,0,0,0.55)"}}>
          <div style={{fontWeight:"bold",fontSize:13,color:"var(--au-ink)"}}>{t.name}</div>
          <div style={{fontSize:9,letterSpacing:0.5,textTransform:"uppercase",color:"var(--au-ink-faded)",marginBottom:4}}>
            {ERAS[t.era]} · {ns.state==="have"?"discovered":ns.state==="next"?`researching ${(ns.prog*100)|0}%`:"locked"}</div>
          <div style={{fontSize:10.5,color:"var(--au-ink)",opacity:0.85,lineHeight:1.35,marginBottom:6}}>{t.desc}</div>
          {fx.length>0
            ? <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:t.prereq.length?6:0}}>
                {fx.map((e,i)=><span key={i} style={{padding:"1.5px 5px",borderRadius:3,fontSize:9.5,fontWeight:600,color:"#fff",background:FX_COLOR[e.key]||"#6a5a3a",opacity:e.good?1:0.85}}>{e.text}</span>)}
              </div>
            : <div style={{fontSize:9.5,fontStyle:"italic",color:"var(--au-ink-faded)",marginBottom:t.prereq.length?6:0}}>a stepping-stone — no direct bonus</div>}
          {t.prereq.length>0&&<div style={{fontSize:9.5,color:"var(--au-ink-faded)"}}>Requires: {t.prereq.map(p=>TECHS[TECH_IDX[p]].name).join(" + ")}</div>}
        </div>);
      })()}
    </div>
  );
}

// ── Chronicle overlay — a realm's full history in its own scrollable window ──
// (the settlement card is too short to hold a long log; a modal escapes it).
// `entries` are {step,type,text}; rendered newest-first, dated via the display clock and
// colour-coded by event type (dark tones for contrast on the light parchment).
// Category tints, bright enough to read on the dark cards.
export const CHRON_COL={founding:"#4fbc8a",discovery:"#6aa8e0",growth:"#66b573",wealth:"#d4a83e",
  war:"#e06a52",conquest:"#dd8a44",annex:"#c39a4a",secession:"#b084e4",loss:"#d08258",
  plague:"#c078e0",famine:"#d49250",end:"#b8a482",
  industry:"#8fb0c4",trade:"#5cc0aa",faith:"#8f9fe4",society:"#c99078"};
export const CHRON_LABEL={founding:"Founding",discovery:"Discovery",growth:"Growth",wealth:"Wealth",
  war:"War",conquest:"Conquest",annex:"Annexation",secession:"Secession",loss:"Loss",
  plague:"Plague",famine:"Famine",end:"Fall",
  industry:"Industry",trade:"Trade",faith:"Faith",society:"Society"};
export function ChronicleOverlay({entries,name,perspective,onTogglePerspective,onClose,eraAt,armsURL,z=60}){
  const rows=(entries||[]).slice().reverse();   // newest first
  const yr=(step)=>displayYearStr(step);
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(10,8,6,0.74)",zIndex:z,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} className="au-parchment au-elev" style={{padding:"12px 16px",width:"min(580px,93vw)",maxHeight:"88vh",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexShrink:0,gap:8}}>
          <div className="au-pico-title" style={{fontSize:15,display:"flex",alignItems:"center",gap:8}}>
            {armsURL&&<img src={armsURL} alt="" style={{height:26,filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.3))"}}/>}
            <span>Chronicle{name?` — ${name}`:""}{" "}
            <span className="au-fade" style={{fontSize:11}}>· {rows.length} events</span></span></div>
          {/* True record vs the realm's own tradition: same events, different
              survivors — the scribes' version drops what burned, never heard
              the distant news, and flatters the court. */}
          <button onClick={onTogglePerspective} className={"au-btn"+(perspective?" au-active":"")}
            style={{fontSize:10,whiteSpace:"nowrap"}}
            title="Toggle between the omniscient record and what this realm's own scribes kept">
            {perspective?"scribes' version":"true record"}</button>
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
                  <span className="au-fade" style={{textAlign:"right",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{yr(e.step)}</span>
                  <span style={{fontSize:9,letterSpacing:0.3,textTransform:"uppercase",color:CHRON_COL[e.type]||"#b8a482",fontWeight:600,whiteSpace:"nowrap"}}>{CHRON_LABEL[e.type]||e.type}</span>
                  <span style={{color:"var(--au-ink)",lineHeight:1.4}}>{e.text}</span>
                </Fragment>
              ))}
            </div>}
        </div>
      </div>
    </div>
  );
}

// ── Ruling family tree overlay ──────────────────────────────────────────────
// Renders the reigning house as a genealogy: couples, children indented beneath
// their parents along a vine, the sitting sovereign crowned, bastards on a dashed
// border, married-in partners faded, the deceased greyed with their lifespans.
function fy(y){return y<0?`${-y} BC`:`${y} AD`;}
const TRAIT_DEF=[["vigor","Vig"],["wit","Wit"],["boldness","Bold"],["ruthlessness","Ruth"]];
function traitTip(t){return t?TRAIT_DEF.map(([k,l])=>`${l} ${t[k]>0?"+":""}${t[k]}`).join("  "):"";}
function PersonCard({n}){
  const dead=n.diedY>=0;
  const border=n.isRuler?"2px solid #d8b13a":n.bastard?"1px dashed #a8895c":"1px solid rgba(216,190,150,0.28)";
  const bg=n.isRuler?"rgba(216,177,58,0.14)":n.foreign?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.06)";
  const reigned=n.reignFrom>=0;
  return(
    <div title={[n.trait&&!n.foreign?n.trait:"",n.traits?traitTip(n.traits):"",n.foreign?"married into the house":n.bastard?"born out of wedlock":""].filter(Boolean).join("\n")||undefined}
      style={{border,background:bg,borderRadius:5,padding:"3px 7px",minWidth:96,opacity:dead&&!reigned?0.6:1,fontSize:11}}>
      <div style={{display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>
        <span style={{color:n.female?"#d886c0":"#82a4e8",fontWeight:700}}>{n.female?"♀":"♂"}</span>
        {n.isRuler&&<span title="reigning" style={{fontSize:12}}>♔</span>}
        <span style={{fontWeight:n.isRuler||reigned?700:500,color:"var(--au-ink)"}}>{n.name}{n.epithet?` ${n.epithet}`:""}</span>
        {n.bastard&&<span className="au-fade" style={{fontSize:9,fontStyle:"italic"}}>bastard</span>}
      </div>
      {n.isRuler&&n.title&&<div style={{fontSize:9,letterSpacing:0.3,textTransform:"uppercase",color:"#d8b13a",fontWeight:600}}>{n.title}</div>}
      <div className="au-fade" style={{fontSize:9.5,fontVariantNumeric:"tabular-nums"}}>
        {dead?`${fy(n.bornY)} – ${fy(n.diedY)} · ${n.age}y`:`b. ${fy(n.bornY)} · ${n.age}y`}
      </div>
      {reigned&&<div style={{fontSize:9,color:"#d8b13a",fontVariantNumeric:"tabular-nums"}}>reigned {fy(n.reignFrom)}–{n.reignTo>=0?fy(n.reignTo):"now"}</div>}
      {!n.foreign&&n.trait&&<div className="au-fade" style={{fontSize:9,fontStyle:"italic"}}>{n.trait}</div>}
    </div>
  );
}
// Per-government styling for the succession roll (crown / theocracy / council).
const GOV_META={monarchy:{icon:"♔",col:"#b8902f",label:"Crown"},
  theocracy:{icon:"☩",col:"#5566b0",label:"Theocracy"},
  republic:{icon:"⚖",col:"#2f8a78",label:"Council"},
  despotism:{icon:"⚔",col:"#a8402f",label:"Despotism"},
  elective:{icon:"♛",col:"#9c7a2f",label:"Elective Monarchy"}};
// Standard top-down genealogy: each generation a row, parents centred above
// their children, sibling/parent connectors drawn in pure CSS (classes below).
const FT_LN="rgba(216,190,150,0.35)";
const FT_CSS=`
.ft-wrap{display:inline-flex;flex-direction:column;gap:16px;min-width:100%;padding:4px 2px 8px;align-items:center}
.ft-tree ul{position:relative;padding-top:18px;display:flex;justify-content:center;margin:0}
.ft-tree li{list-style:none;position:relative;padding:18px 7px 0;display:flex;flex-direction:column;align-items:center}
.ft-tree li::before,.ft-tree li::after{content:'';position:absolute;top:0;right:50%;border-top:2px solid ${FT_LN};width:50%;height:18px}
.ft-tree li::after{right:auto;left:50%;border-left:2px solid ${FT_LN}}
.ft-tree li:only-child::after,.ft-tree li:only-child::before{display:none}
.ft-tree li:only-child{padding-top:18px}
.ft-tree li:first-child::before,.ft-tree li:last-child::after{border:0 none}
.ft-tree li:last-child::before{border-right:2px solid ${FT_LN}}
.ft-tree ul ul::before{content:'';position:absolute;top:0;left:50%;border-left:2px solid ${FT_LN};width:0;height:18px}
.ft-tree>ul{padding-top:0}
.ft-tree>ul>li:only-child{padding-top:0}`;
// One person (with their married-in partner, if any) as a tree node.
function Couple({n,sp}){
  return(
    <div style={{display:"flex",alignItems:"flex-start",gap:4}}>
      <PersonCard n={n}/>
      {sp&&<><span className="au-fade" style={{fontSize:11,alignSelf:"center"}}>⚭</span><PersonCard n={sp}/></>}
    </div>
  );
}
function FamilyTree({nodes}){
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const kidsOf=new Map();
  for(const n of nodes)if(n.parentId>=0){if(!kidsOf.has(n.parentId))kidsOf.set(n.parentId,[]);kidsOf.get(n.parentId).push(n.id);}
  for(const arr of kidsOf.values())arr.sort((a,b)=>byId.get(a).bornY-byId.get(b).bornY);
  const drawn=new Set();
  // a <li> holding the couple's card and, beneath, a <ul> of their children
  const renderLi=(id)=>{
    if(drawn.has(id))return null;
    drawn.add(id);
    const n=byId.get(id);if(!n)return null;
    const sp=n.spouseId>=0&&byId.has(n.spouseId)&&!drawn.has(n.spouseId)?byId.get(n.spouseId):null;
    if(sp)drawn.add(sp.id);
    const kids=((kidsOf.get(id)||[]).concat(sp?(kidsOf.get(sp.id)||[]):[])).filter(k=>!drawn.has(k));
    return(
      <li key={id}>
        <Couple n={n} sp={sp}/>
        {kids.length>0&&<ul>{kids.map(k=>renderLi(k))}</ul>}
      </li>
    );
  };
  // each independent line (the founder's, plus any unconnected adoptees) is its
  // own top-down tree, stacked vertically
  const roots=nodes.filter(n=>n.parentId<0&&!n.foreign).sort((a,b)=>a.bornY-b.bornY);
  const trees=[];
  for(const r of roots){ if(drawn.has(r.id))continue; trees.push(<div key={r.id} className="ft-tree"><ul>{renderLi(r.id)}</ul></div>); }
  for(const n of nodes){ if(drawn.has(n.id)||n.foreign)continue; trees.push(<div key={n.id} className="ft-tree"><ul>{renderLi(n.id)}</ul></div>); }
  return <div className="ft-wrap">{trees}</div>;
}
// Everyone who ever ruled the nation — across houses, councils and theocracies —
// in order, grouped by house with a banner when the form of rule itself changes.
function SuccessionRoll({roll}){
  const rows=[];
  let lastHouse=null,lastGov=null;
  roll.forEach((e,i)=>{
    const gm=GOV_META[e.gov]||GOV_META.monarchy;
    if(e.gov!==lastGov){
      rows.push(<div key={"g"+i} style={{margin:"10px 0 3px",fontSize:10,letterSpacing:0.4,textTransform:"uppercase",fontWeight:700,color:gm.col}}>
        {gm.icon} {gm.label==="Crown"?"Monarchy":gm.label}{lastGov?" — the order changes":""}</div>);
      lastHouse=null;
    }
    if(e.house!==lastHouse){
      rows.push(<div key={"h"+i} className="au-fade" style={{margin:"5px 0 1px",fontSize:10,fontStyle:"italic"}}>House {e.house||"—"}</div>);
    }
    lastHouse=e.house;lastGov=e.gov;
    rows.push(
      <div key={i} style={{display:"grid",gridTemplateColumns:"auto auto 1fr",gap:"2px 9px",alignItems:"baseline",fontSize:12,
        padding:"1px 4px",borderLeft:`3px solid ${gm.col}`,marginLeft:4,background:e.current?"rgba(184,144,47,0.12)":"transparent"}}>
        <span className="au-fade" style={{fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap",fontSize:11}}>{fy(e.fromY)}–{e.toY>=0?fy(e.toY):"now"}</span>
        <span style={{color:e.female?"#d886c0":"#82a4e8",fontWeight:700}}>{e.female?"♀":"♂"}</span>
        <span style={{color:"var(--au-ink)"}}>
          <span className="au-fade">{e.title?e.title+" ":""}</span>
          <b style={{fontWeight:e.current?700:600}}>{e.name}</b>{e.epithet?` ${e.epithet}`:""}
          {e.current&&<span style={{color:gm.col,fontWeight:700}}> · reigning</span>}
        </span>
      </div>
    );
  });
  return <div>{rows}</div>;
}
export function DynastyOverlay({tree,onClose,z=60}){
  const[mode,setMode]=useState("tree");
  // FREEZE a snapshot so the chart doesn't reflow under the reader as the sim
  // ticks (people age/are born/die every frame). Capture the first frame and on
  // a realm change; a manual refresh re-captures the live state.
  const[snap,setSnap]=useState(tree);
  useEffect(()=>{if(tree&&(!snap||snap.countryId!==tree.countryId))setSnap(tree);},[tree,snap]);
  const data=snap||tree;
  const houses=(data&&data.houses)||[];
  const roll=(data&&data.roll)||[];
  const Tab=({id,label})=>(
    <button onClick={()=>setMode(id)} className={"au-btn"+(mode===id?" au-active":"")}
      style={{fontSize:10,whiteSpace:"nowrap"}}>{label}</button>);
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(10,8,6,0.74)",zIndex:z,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{FT_CSS}</style>
      <div onClick={e=>e.stopPropagation()} className="au-parchment au-elev" style={{padding:"12px 16px",width:"min(860px,95vw)",maxHeight:"88vh",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4,flexShrink:0,gap:8}}>
          <div className="au-pico-title" style={{fontSize:15}}>House {data?data.houseName||"—":"—"}
            {data&&<span className="au-fade" style={{fontSize:11}}> · {data.govLabel}</span>}</div>
          <div style={{display:"flex",gap:5,alignItems:"center"}}>
            <Tab id="tree" label="Family tree"/>
            <Tab id="roll" label={`Succession${roll.length?` (${roll.length})`:""}`}/>
            <button onClick={()=>setSnap(tree)} title="Refresh to the present" className="au-btn"
              style={{fontSize:10,whiteSpace:"nowrap"}}>↻</button>
            <button onClick={onClose} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--au-fade)",fontSize:18,lineHeight:1,padding:"0 2px"}}>×</button>
          </div>
        </div>
        <div className="au-fade" style={{fontSize:10,marginBottom:8,flexShrink:0}}>
          {data?<>succession law: {data.lawLabel}{data.legitLabel?` · legitimacy ${data.legitLabel}`:""}{data.rulerTitle?` · the ${data.rulerTitle.toLowerCase()} reigns`:""} · <span style={{fontStyle:"italic"}}>snapshot — ↻ to update</span></>:"no ruling house"}
        </div>
        <div style={{overflow:"auto",minHeight:0,paddingRight:6}}>
          {mode==="tree"
            ?(houses.length===0
              ?<div className="au-fade" style={{fontSize:12,fontStyle:"italic"}}>No reigning house — the realm keeps no king-list yet.</div>
              :houses.map((h,i)=>(
                <div key={h.dynastyId} style={{marginBottom:14,opacity:h.isCurrent?1:0.92}}>
                  <div style={{display:"flex",alignItems:"baseline",gap:8,borderBottom:"1px solid rgba(216,190,150,0.22)",paddingBottom:2,marginBottom:2,marginTop:i?10:0}}>
                    <span className="au-pico-title" style={{fontSize:13}}>House {h.name}</span>
                    <span className="au-fade" style={{fontSize:10}}>
                      {h.isCurrent?"reigning":"former"} · {fy(h.founded)}–{h.ended>=0?fy(h.ended):"now"}
                    </span>
                  </div>
                  <FamilyTree nodes={h.nodes}/>
                </div>))
            )
            :(roll.length===0
              ?<div className="au-fade" style={{fontSize:12,fontStyle:"italic"}}>No sovereigns recorded yet.</div>
              :<SuccessionRoll roll={roll}/>)}
        </div>
        <div className="au-fade" style={{fontSize:9.5,marginTop:8,flexShrink:0,display:"flex",gap:12,flexWrap:"wrap",borderTop:"1px solid rgba(216,190,150,0.20)",paddingTop:6}}>
          {mode==="tree"
            ?<><span>♔ reigning</span><span>♀ / ♂</span><span>⚭ married</span><span style={{fontStyle:"italic"}}>dashed = bastard</span><span>faded = married in / deceased</span></>
            :<><span style={{color:GOV_META.monarchy.col}}>♔ crown</span><span style={{color:GOV_META.theocracy.col}}>☩ theocracy</span><span style={{color:GOV_META.republic.col}}>⚖ council</span><span style={{color:GOV_META.despotism.col}}>⚔ despotism</span><span>oldest first</span></>}
        </div>
      </div>
    </div>
  );
}

// ── Atlas (olde-map) cartographic symbols — hand-drawn map iconography ──