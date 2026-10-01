import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createDecipheriv} from 'node:crypto';

// Explicit local opt-in: only the current Windows user's already paired bot
// credential is decrypted. Owner and host credentials never leave this file.
export function readLocalPairing({env=process.env,platform=process.platform,readFile=fs.readFileSync,decrypt=decryptWindows}={}) {
  if(env.BOTDESK_LOCAL_PAIRING!=='1')return null;
  if(platform!=='win32')throw new Error('local-pairing-requires-windows');
  try {
    const directory=env.LOCALAPPDATA;
    if(!directory)throw new Error();
    const c=JSON.parse(readFile(path.join(directory,'BotDesk','config.json'),'utf8'));
    if(typeof c.botToken!=='string'||!/^dpapi:[A-Za-z0-9+/]+=*$/.test(c.botToken))throw new Error();
    const origin=new URL(c.relayUrl);
    if(origin.protocol!=='https:'||origin.origin!==c.relayUrl||!/^[-a-z0-9]{1,64}$/.test(c.hostId))throw new Error();
    const botToken=decrypt(c.botToken.slice(6),()=>JSON.parse(readFile(path.join(directory,'BotDesk','Local State'),'utf8')));
    if(!/^[A-Za-z0-9_-]{43,128}$/.test(botToken))throw new Error();
    return {relayUrl:c.relayUrl,hostId:c.hostId,botToken,botId:env.BOTDESK_BOT_ID||'local-coding-bot'};
  }catch {throw new Error('local-pairing-unavailable');}
}
function unprotect(ciphertext) {
  const command="Add-Type -AssemblyName System.Security; try { $bytes=[Convert]::FromBase64String([Console]::In.ReadLine()); $plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($plain)) } catch { exit 1 }";
  const result=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{input:ciphertext,encoding:'utf8',timeout:10000,maxBuffer:4096,windowsHide:true,shell:false});
  if(result.status!==0)throw new Error('decrypt-failed');
  return Buffer.from(result.stdout.trim(),'base64');
}
function decryptWindows(ciphertext,readState) {
 const bytes=Buffer.from(ciphertext,'base64');
 // Electron/Chromium can use either DPAPI directly or v10 AES-GCM with a
 // DPAPI-wrapped profile key. Unknown formats are rejected, never downgraded.
 if(bytes.subarray(0,3).toString()==='v10'){
  const wrapped=Buffer.from(readState().os_crypt.encrypted_key,'base64');
  if(wrapped.subarray(0,5).toString()!=='DPAPI'||bytes.length<31)throw new Error();
  const key=unprotect(wrapped.subarray(5).toString('base64'));
  try{const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(3,15));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(15,-16)),decipher.final()]).toString('utf8');}
  finally{key.fill(0);}
 }
 return unprotect(ciphertext).toString('utf8');
}
