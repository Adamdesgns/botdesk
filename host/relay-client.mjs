import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { relayOrigin } from './config-store.mjs';

export class RelayClient extends EventEmitter {
  constructor({getConfig,onCommand,onOwnerState}) {
    super();Object.assign(this,{getConfig,onCommand,onOwnerState});
    this.socket=null;this.timer=null;this.heartbeat=null;this.closed=true;this.retryMs=1000;
  }
  connect(){this.closed=false;this.open();}
  reconnect(){this.disconnect();this.connect();}
  disconnect(){this.closed=true;clearTimeout(this.timer);clearInterval(this.heartbeat);
    const old=this.socket;this.socket=null;old?.terminate();
    this.emit('status',{connected:false,authenticated:false});}
  send(message){if(this.socket?.readyState!==WebSocket.OPEN)return false;this.socket.send(JSON.stringify(message));return true;}
  open(){
    if(this.closed)return;
    const c=this.getConfig();
    if(!c.relayUrl||!c.hostId||!c.hostToken)return this.emit('status',{connected:false,reason:'setup-required'});
    let url;try{url=new URL(relayOrigin(c.relayUrl));}catch{return this.emit('status',{connected:false,reason:'invalid-relay-url'});}
    url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname='/api/host/'+encodeURIComponent(c.hostId)+'/socket';
    const socket=new WebSocket(url,{headers:{Authorization:'Bearer '+c.hostToken},handshakeTimeout:10000,maxPayload:128*1024,followRedirects:false});
    this.socket=socket;
    socket.on('open',()=>{if(this.socket===socket)this.emit('status',{connected:true,authenticated:false});});
    socket.on('message',raw=>{if(this.socket===socket)this.message(socket,raw).catch(()=>socket.close(1011,'invalid-message'));});
    socket.on('error',()=>{});
    socket.on('close',()=>{if(this.socket!==socket)return;this.socket=null;clearInterval(this.heartbeat);
      this.emit('status',{connected:false,authenticated:false});
      if(!this.closed){this.timer=setTimeout(()=>this.open(),this.retryMs);this.retryMs=Math.min(30000,this.retryMs*2);}});
  }
  async message(socket,raw){
    const m=JSON.parse(raw.toString('utf8'));
    if(m.type==='auth_ok'){
      this.retryMs=1000;this.lastAck=Date.now();clearInterval(this.heartbeat);
      this.heartbeat=setInterval(()=>{if(Date.now()-this.lastAck>35000)return socket.terminate();this.send({type:'heartbeat'});},10000);
      this.emit('status',{connected:true,authenticated:true});
    }else if(m.type==='heartbeat_ack')this.lastAck=Date.now();
    else if(m.type==='owner_state')await this.onOwnerState(m);
    else if(m.type==='command'){const response=await this.onCommand(m);
      if(socket===this.socket&&socket.readyState===WebSocket.OPEN){
        const payload=JSON.stringify({type:'command_result',commandId:m.commandId,...response});
        // Refuse oversized frames instead of sending a payload that trips relay disconnect.
        if(payload.length>9*1024*1024){
          socket.send(JSON.stringify({type:'command_result',commandId:m.commandId,ok:false,error:'capture-too-large'}));
        } else socket.send(payload);
      }}
  }
  async ownerState(mode,minutes=480){
    const c=this.getConfig();
    const response=await fetch(relayOrigin(c.relayUrl)+'/api/owner/'+encodeURIComponent(c.hostId)+'/state',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+c.ownerToken,'content-type':'application/json','x-request-id':randomUUID()},
      body:JSON.stringify({mode,minutes})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'owner-state-failed');return result;
  }
}
