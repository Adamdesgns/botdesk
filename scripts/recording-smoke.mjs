import {_electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const data=await fs.mkdtemp(path.join(os.tmpdir(),'botdesk-record-proof-'));
const env={...process.env,BOTDESK_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['scripts/recording-fixture.mjs'],env,timeout:30000});
try{
  let result;
  for(let tries=0;tries<30;tries++){try{result=JSON.parse(await fs.readFile(path.join(data,'recording-result.json'),'utf8'));break;}catch{await new Promise(r=>setTimeout(r,500));}}
  assert.equal(result?.ok,true);assert.ok(result.bytes>300);assert.ok(result.frames>=2);
  const page=await app.firstWindow();
  const encoded=(await fs.readFile(result.path)).toString('base64');
  const meta=await page.evaluate(async encoded=>{const video=document.createElement('video');video.muted=true;
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'video/webm'}));
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WebM decode timed out')),10000);video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('WebM failed to decode'));};video.src=url;video.load();});
    return {width:video.videoWidth,height:video.videoHeight,readyState:video.readyState};},encoded);
  assert.equal(meta.width,256);assert.equal(meta.height,256);assert.ok(meta.readyState>=2);
  await fs.mkdir('evidence',{recursive:true});await fs.copyFile(result.path,'evidence/synthetic-recording.webm');
  console.log(JSON.stringify({ok:true,bytes:result.bytes,frames:result.frames,meta,source:'Synthetic BotDesk icon frames; no desktop captured'},null,2));
}finally{await app.close();}
