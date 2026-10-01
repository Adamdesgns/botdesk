import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_APP_ALLOWLIST, SUPPORTED_APP_ALLOWLIST } from './guard.mjs';
const SECRETS=['hostToken','ownerToken','botToken'];
const DEFAULTS={relayUrl:'',hostId:'',hostToken:'',ownerToken:'',botToken:'',allowRemoteArm:false,startAtLogin:false,allowedApps:[...DEFAULT_APP_ALLOWLIST],accessMode:'selected-window',blockedApps:[]};
export function normalizeBlockedApps(value){
  if(!Array.isArray(value)||value.length>64)throw new Error('Invalid blocked app list.');
  const normalized=value.map(app=>{
    if(typeof app!=='string')throw new Error('Invalid blocked app name.');
    const name=app.trim().toLowerCase().replace(/\.exe$/,'');
    if(!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(name))throw new Error('Invalid blocked app name.');
    return name;
  });
  return [...new Set(normalized)].sort();
}
export function relayOrigin(value){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Relay URL must be an origin without credentials or path.');
  if(url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('Relay must use HTTPS or local loopback HTTP.');
  return url.origin;
}
export class ConfigStore{
  constructor(filePath,{encrypt,decrypt}={}){
    this.filePath=filePath;this.encrypt=encrypt;this.decrypt=decrypt;
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
  }
  load(){
    if(!fs.existsSync(this.filePath))return structuredClone(DEFAULTS);
    const raw=JSON.parse(fs.readFileSync(this.filePath,'utf8'));
    const result={...structuredClone(DEFAULTS),...raw};
    for(const key of SECRETS){
      if(raw[key] && !raw[key].startsWith('dpapi:'))throw new Error('Unencrypted BotDesk credentials rejected. Import pairing again.');
      result[key]=raw[key]?this.decrypt(Buffer.from(raw[key].slice(6),'base64')):'';
    }
    if(!Array.isArray(result.allowedApps))throw new Error('Invalid app list.');
    result.allowedApps=SUPPORTED_APP_ALLOWLIST.filter(x=>result.allowedApps.includes(x));
    if(!['selected-window','pc-access','owner-control'].includes(result.accessMode))throw new Error('Invalid access mode.');
    result.blockedApps=normalizeBlockedApps(result.blockedApps);
    return result;
  }
  save(update){
    const old=this.load(),next={...old};
    for(const key of Object.keys(DEFAULTS))if(Object.hasOwn(update,key))next[key]=update[key];
    for(const key of SECRETS){
      if(typeof next[key]!=='string')throw new Error('Invalid pairing token.');
      const incoming=next[key].trim();
      next[key]=incoming==='saved'||incoming===''?old[key]:incoming;
      if(next[key]&&!/^[A-Za-z0-9_-]{32,128}$/.test(next[key]))throw new Error('Invalid pairing token.');
    }
    if(next.relayUrl)next.relayUrl=relayOrigin(next.relayUrl);
    if(typeof next.hostId!=='string'||(next.hostId&&!/^[a-z0-9-]{1,64}$/.test(next.hostId)))throw new Error('Invalid host ID.');
    next.allowRemoteArm=next.allowRemoteArm===true;next.startAtLogin=next.startAtLogin===true;
    if(!Array.isArray(next.allowedApps))throw new Error('Invalid app list.');
    next.allowedApps=SUPPORTED_APP_ALLOWLIST.filter(x=>next.allowedApps.includes(x));
    if(!['selected-window','pc-access','owner-control'].includes(next.accessMode))throw new Error('Invalid access mode.');
    next.blockedApps=normalizeBlockedApps(next.blockedApps);
    const stored={...next};
    for(const key of SECRETS){
      if(next[key]&&!this.encrypt)throw new Error('Windows credential encryption unavailable.');
      stored[key]=next[key]?'dpapi:'+this.encrypt(next[key]).toString('base64'):'';
    }
    const temp=this.filePath+'.'+crypto.randomUUID()+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(stored,null,2)+'\n',{mode:0o600});
    fs.renameSync(temp,this.filePath);return next;
  }
  publicView(){const c=this.load();for(const key of SECRETS)c[key]=c[key]?'saved':'';return c;}
}
