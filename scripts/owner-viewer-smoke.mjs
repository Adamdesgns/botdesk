import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const compiled=await build({entryPoints:['relay/src/dashboard.ts'],write:false,bundle:true,format:'esm',platform:'node',target:'es2022'});
const {dashboardHtml}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const token=randomBytes(32).toString('base64url'),errors=[],actions=[];
let pixel='',sequence=0,state={mode:'off',operator:'bot',hostOnline:true,target:{accessMode:'owner-control',state:'pc-access',blockedApps:[]}};
let delayed=false,releaseCapture;
const server=createServer(async(req,res)=>{
 try{
  if(req.url==='/control/fixture'){res.writeHead(200,{'content-type':'text/html'});res.end(dashboardHtml('fixture'));return;}
  if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
  assert.equal(req.headers.authorization,'Bearer '+token);const chunks=[];for await(const c of req)chunks.push(c);
  const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;let result;
  if(req.url.endsWith('/status'))result=state;
  else if(req.url.endsWith('/state')){if(state.handoff?.state==='waiting'&&body.mode==='armed'){assert.equal(body.handoffId,state.handoff.id);state.handoff={...state.handoff,state:'completed'};}state={...state,mode:body.mode,operator:body.operator||'bot',expiresAt:body.mode==='armed'?Date.now()+480*60000:null,...(body.mode==='off'?{handoff:null}:{})};result={...state,confirmed:true};}
  else if(req.url.endsWith('/command')){
   actions.push(body);
   if(body.name==='screenshot'){if(delayed)await new Promise(resolve=>releaseCapture=resolve);result={ok:true,result:{snapshotId:'fixture-'+(++sequence),window:{title:'Fixture coding session',geometry:{width:640,height:360}},image:{mimeType:'image/png',data:pixel}}};}
   else if(body.name==='list_windows')result={ok:true,result:{windows:[{handle:'100',title:'Project <img src=x onerror=alert(1)>',processName:'code',executablePath:'C:\\fixture\\Code.exe'}]}};
   else result={ok:true,result:{}};
  }else throw new Error('Unexpected route '+req.url);
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
 }catch(e){errors.push(e.message);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'fixture-error'}));}
});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('http://127.0.0.1:'+server.address().port+'/control/fixture#'+token);
 pixel=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');g.fillStyle='#18202c';g.fillRect(0,0,640,360);g.fillStyle='white';g.font='24px sans-serif';g.fillText('Fixture coding session',24,55);g.font='16px sans-serif';g.fillText('Synthetic image - no real PC shown',24,90);return c.toDataURL('image/png').split(',')[1];});
 await page.waitForFunction(()=>!document.querySelector('#take-control').disabled);
 await page.locator('#auto-view').uncheck();
 await page.locator('#take-control').click();await page.waitForFunction(()=>ownerFrame!==null);
 assert.equal(state.operator,'owner');
 await page.locator('#screen').scrollIntoViewIfNeeded();const box=await page.locator('#screen').boundingBox();
 await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 await page.waitForFunction(()=>ownerFrame!==null&&!ownerBusy);
 const clicked=actions.find(x=>x.name==='click');assert.ok(clicked);assert.ok(Math.abs(clicked.args.x-320)<=1);assert.ok(Math.abs(clicked.args.y-180)<=1);assert.ok(clicked.args.snapshotId);
 await page.locator('#owner-text').fill('Start a local coding session');await page.locator('#send-text').click();
 await page.waitForFunction(()=>ownerFrame!==null&&!ownerBusy);assert.equal(actions.find(x=>x.name==='type').args.text,'Start a local coding session');
 await page.locator('#list-owner-windows').click();await page.waitForFunction(()=>document.querySelector('#owner-windows').options.length===1);
 assert.match(await page.locator('#owner-windows').textContent(),/<img/);assert.equal(await page.locator('#owner-windows img').count(),0);
 await page.locator('#focus-owner-window').click();await page.waitForFunction(()=>ownerFrame!==null&&!ownerBusy);assert.equal(actions.find(x=>x.name==='focus').args.windowHandle,'100');
 await page.locator('#launch-path').fill('C:\\fixture\\Code.exe');await page.locator('#owner-launch').click();await page.waitForFunction(()=>ownerFrame!==null&&!ownerBusy);assert.ok(actions.some(x=>x.name==='launch_app'));
 await page.locator('#close-owner-window').click();await page.waitForFunction(()=>ownerFrame!==null&&!ownerBusy);assert.ok(actions.some(x=>x.name==='close_window'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 state.handoff={id:randomUUID(),state:'waiting',message:'Please type your message <img src=x onerror=alert(1)>'};
 await page.evaluate(()=>refresh());await page.waitForFunction(()=>!document.querySelector('#handoff-panel').hidden);
 assert.equal(await page.locator('#handoff-message img').count(),0);
 await fs.mkdir('evidence',{recursive:true});await page.locator('#handoff-panel').scrollIntoViewIfNeeded();await page.screenshot({path:'evidence/handoff-phone-fixture.png'});
 await page.locator('#handoff-done').click();await page.waitForFunction(()=>current?.handoff?.state==='completed'&&!ownerBusy);
 assert.equal(state.operator,'bot');assert.equal(await page.evaluate(()=>ownerFrame),null);
 await page.locator('#take-control').click();await page.waitForFunction(()=>ownerFrame!==null);
 await fs.mkdir('evidence',{recursive:true});await page.screenshot({path:'evidence/owner-phone-fixture.png',fullPage:true});
 // A pending screenshot must not repopulate the viewer after STOP.
 delayed=true;await page.locator('#preview').click();
 for(let n=0;n<100&&!releaseCapture;n++)await new Promise(r=>setTimeout(r,20));assert.ok(releaseCapture);
 await page.locator('#remote-stop').click();await page.waitForFunction(()=>current?.mode==='off');releaseCapture();
 await page.waitForFunction(()=>!ownerCapturing);assert.equal(await page.locator('#screen').getAttribute('src'),null);assert.equal(await page.evaluate(()=>ownerFrame),null);
 assert.deepEqual(errors,[]);console.log('Phone viewer fixture passed: takeover, scaled tap, type, focus, launch, close, no overflow, escaped titles, STOP discards late capture. No real desktop or production access.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
