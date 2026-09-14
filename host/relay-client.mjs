import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { relayOrigin } from './config-store.mjs';
import { classifySocketError, describeOwnerError, describeRelayStatus } from './relay-status.mjs';

const SAFE_CLOSE_REASON = /^[a-z0-9-]{1,64}$/;

export class RelayClient extends EventEmitter {
  constructor({getConfig,onCommand,onOwnerState}) {
    super();Object.assign(this,{getConfig,onCommand,onOwnerState});
    this.socket=null;this.timer=null;this.heartbeat=null;this.closed=true;this.retryMs=1000;
    this.attempts=0;this.lastError=null;this.lastAuthenticatedAt=null;this.nextRetryAt=null;this.lastErrorAt=null;this.pendingFailure=null;
    this.status={connected:false,authenticated:false,reason:'stopped'};
  }
  connect(){this.closed=false;this.open();}
  reconnect(){this.disconnect();this.connect();}
  disconnect(){this.closed=true;clearTimeout(this.timer);clearInterval(this.heartbeat);this.nextRetryAt=null;
    const old=this.socket;this.socket=null;old?.terminate();
    this.emitStatus({connected:false,authenticated:false,reason:'stopped'});}
  send(message){if(this.socket?.readyState!==WebSocket.OPEN)return false;this.socket.send(JSON.stringify(message));return true;}
  emitStatus(partial){
    const status={connected:false,authenticated:false,...partial,attempts:this.attempts,
      lastAuthenticatedAt:this.lastAuthenticatedAt,lastErrorAt:this.lastErrorAt,nextRetryAt:this.nextRetryAt};
    status.summary=describeRelayStatus(status);
    this.status=status;this.emit('status',status);
  }
  open(){
    if(this.closed)return;
    clearTimeout(this.timer);this.nextRetryAt=null;
    const c=this.getConfig();
    if(!c.relayUrl||!c.hostId||!c.hostToken)return this.emitStatus({connected:false,reason:'setup-required'});
    let url;try{url=new URL(relayOrigin(c.relayUrl));}catch{return this.emitStatus({connected:false,reason:'invalid-relay-url'});}
    url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname='/api/host/'+encodeURIComponent(c.hostId)+'/socket';
    this.attempts++;this.emitStatus({connected:false,authenticated:false,reason:'connecting'});
    const socket=new WebSocket(url,{headers:{Authorization:'Bearer '+c.hostToken},handshakeTimeout:10000,maxPayload:128*1024,followRedirects:false});
    this.socket=socket;let authenticated=false;let failure=null;
    socket.on('open',()=>{if(this.socket===socket)this.emitStatus({connected:true,authenticated:false});});
    socket.on('message',raw=>{if(this.socket===socket)this.message(socket,raw,()=>{authenticated=true;}).catch(()=>socket.close(1011,'invalid-message'));});
    // Only classified codes leave this handler; raw messages may include the relay hostname and are not shown.
    socket.on('error',error=>{if(this.socket===socket&&!failure)failure=classifySocketError(error);});
    socket.on('close',(closeCode,reasonBuffer)=>{if(this.socket!==socket)return;this.socket=null;clearInterval(this.heartbeat);
      const closeReason=String(reasonBuffer||'');
      const detail=failure||this.pendingFailure||{reason:authenticated?'disconnected':'connection-failed'};
      this.pendingFailure=null;this.lastError={...detail,closeCode,closeReason:SAFE_CLOSE_REASON.test(closeReason)?closeReason:undefined};this.lastErrorAt=Date.now();
      if(!this.closed){this.nextRetryAt=Date.now()+this.retryMs;this.timer=setTimeout(()=>this.open(),this.retryMs);this.retryMs=Math.min(30000,this.retryMs*2);}
      this.emitStatus({connected:false,authenticated:false,...this.lastError});});
  }
  async message(socket,raw,onAuthenticated){
    const m=JSON.parse(raw.toString('utf8'));
    if(m.type==='auth_ok'){
      this.retryMs=1000;this.attempts=0;this.lastError=null;this.lastAuthenticatedAt=Date.now();this.lastAck=Date.now();clearInterval(this.heartbeat);
      onAuthenticated?.();
      this.heartbeat=setInterval(()=>{if(Date.now()-this.lastAck>35000){this.pendingFailure={reason:'heartbeat-timeout'};return socket.terminate();}this.send({type:'heartbeat'});},10000);
      this.emitStatus({connected:true,authenticated:true});
    }else if(m.type==='heartbeat_ack')this.lastAck=Date.now();
    else if(m.type==='owner_state')await this.onOwnerState(m);
    else if(m.type==='command'){const response=await this.onCommand(m);
      if(socket===this.socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'command_result',commandId:m.commandId,...response}));}
  }
  async ownerState(mode,minutes=480){
    const c=this.getConfig();
    let response;
    try{
      response=await fetch(relayOrigin(c.relayUrl)+'/api/owner/'+encodeURIComponent(c.hostId)+'/state',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{Authorization:'Bearer '+c.ownerToken,'content-type':'application/json','x-request-id':randomUUID()},
        body:JSON.stringify({mode,minutes})});
    }catch(error){
      const code=String(error?.cause?.code||error?.name||'network');
      throw new Error('The relay could not be reached for the owner request ('+code.replace(/[^A-Za-z0-9_]/g,'')+'). Check the relay connection above.');
    }
    const result=await response.json();if(!response.ok)throw new Error(describeOwnerError(result.error||'owner-state-failed'));return result;
  }
}
