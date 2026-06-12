// Headless UI smoke: serves the built bundle, loads it in Chromium, and
// watches for render crashes through world generation — the class of bug
// (runtime-only, render-path) that lint, unit smoke, and the build all miss.
//
//   npm i -D --no-save puppeteer     # one-time, not a tracked dependency
//   npx vite build --minify false --mode development
//   node tools/ui_smoke.mjs          # exits non-zero on a page error
//
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';

const html = fs.readFileSync('dist/index.html');
const srv = http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(r=>srv.listen(8731,r));

const browser = await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
const page = await browser.newPage();
await page.setViewport({width:1600,height:900});
const errors=[];
page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message+'\n'+(e.stack||'').split('\n').slice(0,6).join('\n')));
page.on('console',m=>{const t=m.text();if(m.type()==='error'&&!t.includes('ERR_CERT')&&!t.includes('Failed to load resource'))errors.push('CONSOLE: '+t.slice(0,500));});
await page.goto('http://127.0.0.1:8731/Simman-/',{waitUntil:'domcontentloaded'});
for(let t=0;t<40;t++){
  await new Promise(r=>setTimeout(r,1500));
  const state=await page.evaluate(()=>{
    const root=document.getElementById('root');
    return {children:root?root.children.length:-1, html:root?root.innerHTML.length:0,
      hasCanvas:!!document.querySelector('canvas'), bodyText:document.body.innerText.slice(0,80)};
  });
  if(t%6===0||errors.length)console.log(`t=${t*1.5}s root.children=${state.children} html=${state.html} canvas=${state.hasCanvas}`);
  if(errors.length){console.log('\n── ERRORS ──');for(const e of errors)console.log(e);break;}
  if(t===39)console.log('final text:',state.bodyText);
}
await page.screenshot({path:'/tmp/ui.png'});
if(errors.length)process.exitCode=1;
await browser.close();srv.close();
