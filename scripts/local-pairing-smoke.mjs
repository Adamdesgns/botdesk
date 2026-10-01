import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {readLocalPairing} from '../mcp/local-config.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'botdoor-pairing-test-'));
const dir=path.join(root,'BotDesk');fs.mkdirSync(dir);
const file=path.join(root,'encrypt.cjs');
fs.writeFileSync(file,`const {app,safeStorage}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(dir)});app.whenReady().then(()=>{fs.writeFileSync(${JSON.stringify(path.join(dir,'config.json'))},JSON.stringify({relayUrl:'https://relay.example.test',hostId:'fixture',botToken:'dpapi:'+safeStorage.encryptString('a'.repeat(43)).toString('base64')}));app.quit();});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
execFileSync(path.resolve('node_modules/electron/dist/electron.exe'),[file],{env,windowsHide:true,timeout:30000,stdio:'pipe'});
const value=readLocalPairing({env:{BOTDESK_LOCAL_PAIRING:'1',LOCALAPPDATA:root}});
assert.equal(value.botToken,'a'.repeat(43));
console.log('Actual Electron safeStorage -> local connector round trip passed with synthetic token. No live credentials read.');
// Leave only disposable encrypted fixtures in the OS temp directory.
