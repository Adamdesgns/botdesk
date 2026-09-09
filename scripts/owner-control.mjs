import { randomUUID } from 'node:crypto';
import { relayOrigin } from '../host/config-store.mjs';
const action=process.argv[2];
if(!['status','live','pause','off'].includes(action))throw new Error('Usage: node scripts/owner-control.mjs status|live|pause|off');
const url=relayOrigin(process.env.BOTDESK_RELAY_URL);
const host=process.env.BOTDESK_HOST_ID,token=process.env.BOTDESK_OWNER_TOKEN;
if(!/^[a-z0-9-]{1,64}$/.test(host||'')||!token)throw new Error('Set BOTDESK_RELAY_URL, BOTDESK_HOST_ID and the private BOTDESK_OWNER_TOKEN.');
const response=await fetch(url+'/api/owner/'+host+'/'+(action==='status'?'status':'state'),{
  method:action==='status'?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Authorization:'Bearer '+token,'content-type':'application/json','x-request-id':randomUUID()},
  body:action==='status'?undefined:JSON.stringify({mode:{live:'armed',pause:'paused',off:'off'}[action],minutes:480})});
const result=await response.json();if(!response.ok)throw new Error(result.error||'Owner control failed.');
console.log(JSON.stringify(result,null,2));
