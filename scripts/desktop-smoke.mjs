import {_electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const data=await fs.mkdtemp(path.join(os.tmpdir(),'botdesk-ui-proof-'));
const env={...process.env,BOTDESK_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
// The NSIS launcher is verified by portable-launch-smoke.ps1 without debugger flags.
const packaged=process.argv.includes('--packaged');
const executablePath=path.resolve(packaged?'dist/win-unpacked/BotDesk.exe':'node_modules/electron/dist/electron.exe');
const client=await _electron.launch({executablePath,args:packaged?[]:['.'],env,timeout:30000});
const evidence=path.resolve('evidence');await fs.mkdir(evidence,{recursive:true});
try{
  await client.firstWindow();
  let page;
  for(let tries=0;tries<60;tries++){
    page=client.windows().find(window=>window.url().endsWith('/index.html'));
    if(page)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(page,'BotDesk main window did not load: '+client.windows().map(window=>window.url()).join(', '));
  await page.waitForSelector('#statusTitle');
  await page.waitForFunction(()=>document.querySelector('#hostState').textContent==='Not configured');
  assert.equal(await page.locator('#statusTitle').textContent(),'Bot access is off');
  await page.locator('#stopButton').click();await page.waitForFunction(()=>!document.querySelector('#unlockButton').hidden);
  await page.locator('#unlockButton').click();await page.waitForFunction(()=>document.querySelector('#unlockButton').hidden);
  await page.locator('#armButton').click();await page.waitForFunction(()=>document.querySelector('#saveResult').textContent.includes('Choose a window'));
  const settings=await page.evaluate(()=>window.botdesk.getState());assert.equal(settings.config.allowRemoteArm,false);assert.equal(settings.config.startAtLogin,false);
  // Exercise encrypted storage with synthetic tokens and no configured network endpoint.
  const token='test_'.padEnd(43,'a');
  const stored=await page.evaluate(async token=>window.botdesk.saveConfig({hostToken:token,ownerToken:token,botToken:token}),token);
  assert.equal(stored.ok,true);
  const disk=await fs.readFile(path.join(data,'config.json'),'utf8');assert.ok(disk.includes('dpapi:'));assert.ok(!disk.includes(token));
  await page.screenshot({path:path.join(evidence,packaged?'desktop-packaged.png':'desktop-local.png')});
  // Exercise renderer recorder start/stop handlers without desktop capture.
  // The complete frame-to-WebM pipeline is covered by recording-smoke.mjs.
  await client.evaluate(({BrowserWindow},id)=>{
    const wc=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='BotDesk Host')?.webContents||BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).webContents;
    wc.send('botdesk:record-start',{id});
  },'smoke-recording');
  // Stop-event path is exercised without opening a native display-capture stream.
  await client.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('botdesk:record-stop',{id:'smoke-recording'});});
  const windows=await client.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({sandbox:w.webContents.getLastWebPreferences().sandbox,contextIsolation:w.webContents.getLastWebPreferences().contextIsolation,nodeIntegration:w.webContents.getLastWebPreferences().nodeIntegration})));
  assert.ok(windows.every(w=>w.sandbox&&w.contextIsolation&&!w.nodeIntegration));
  console.log(JSON.stringify({ok:true,packaged,checks:['startup-disarmed','stop-unlock','no-target-arm-denied','defaults-off','DPAPI-at-rest','sandboxed-renderers'],evidence},null,2));
}finally{await client.close();}
