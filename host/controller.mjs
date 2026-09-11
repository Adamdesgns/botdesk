import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { clampArmMinutes } from '../shared/protocol.mjs';
import { validateCommand } from './guard.mjs';
const INPUT = new Set(['click', 'type', 'key', 'scroll']);
const READ = new Set(['screenshot', 'snapshot']);
const fail = (error, message = error) => ({ok:false, error, message});

export class HostController extends EventEmitter {
  constructor({configStore, auditLog, executor, clock = Date.now}) {
    super(); Object.assign(this, {configStore, auditLog, executor, clock});
    this.mode='off'; this.expiresAt=null; this.activeBot=null; this.leaseEndsAt=0;
    this.relayStatus={connected:false, authenticated:false}; this.relay=null;
    this.targetWindow=null; this.snapshots=new Map(); this.epoch=0; this.controlGeneration=null;
    this.operation=null; this.expiryTimer=null; this.seen=new Set(); this.stopLatched=false;
    this.recording=false; this.recordAbort=null;
  }
  attachRelay(relay) {
    this.relay=relay;
    relay.on('status', status => {
      this.relayStatus=status;
      if (!status.authenticated && this.mode!=='off') this.setMode('off', {source:'relay-disconnected'});
      this.emitStatus();
    });
  }
  getStatus() {
    if (this.expiresAt && this.clock()>=this.expiresAt) this.setMode('off', {source:'expiry'});
    return {mode:this.mode, expiresAt:this.expiresAt, activeBot:this.activeBot, recording:this.recording,
      relay:this.relayStatus, stopLatched:this.stopLatched, targetWindow:this.targetWindow,
      allowRemoteArm:Boolean(this.configStore.load().allowRemoteArm), hostId:this.configStore.load().hostId||null};
  }
  selectTarget(window) { this.setMode('off', {source:'target-changed'}); this.targetWindow=window; this.emitStatus(); }
  clearLocalStop() { this.stopLatched=false; this.emitStatus(); }
  setMode(mode, {minutes=480, expiresAt, source='local', generation, notify=true}={}) {
    if (!['off','armed','paused'].includes(mode)) throw new Error('invalid-mode');
    if (mode==='armed' && (this.stopLatched||!this.targetWindow)) throw new Error(this.stopLatched?'local-stop-latched':'select-a-window-first');
    this.epoch++; this.operation?.abort(); this.snapshots.clear();
    this.mode=mode; this.activeBot=null; this.leaseEndsAt=0; clearTimeout(this.expiryTimer);
    this.controlGeneration=generation??null;
    this.expiresAt=mode==='armed'?Math.min(expiresAt||Infinity,this.clock()+clampArmMinutes(minutes)*60_000):null;
    if (this.expiresAt) {
      this.expiryTimer=setTimeout(()=>this.setMode('off',{source:'expiry'}),Math.max(1,this.expiresAt-this.clock()));
      this.expiryTimer.unref?.();
    }
    if (mode!=='armed') this.stopRecording();
    this.auditLog.write({command:'state',outcome:mode+':'+source});
    if (notify && mode!=='armed') this.relay?.send({type:'local_state',mode,expiresAt:null,controlGeneration:this.controlGeneration,source:this.stopLatched?'emergency':source});
    this.emitStatus(); return this.getStatus();
  }
  async applyOwnerState({mode,minutes=480,expiresAt,requestId,controlGeneration}) {
    let result;
    try {
      if (mode==='armed') {
        if (!this.configStore.load().allowRemoteArm) throw new Error('remote-arm-disabled');
        if (this.stopLatched) throw new Error('local-stop-latched');
        if (!this.targetWindow) throw new Error('select-a-window-first');
        if (!Number.isFinite(expiresAt)||expiresAt<=this.clock()) throw new Error('expired-arm-request');
        const epoch=this.epoch;
        if(this.executor.focus){
          const focused=await this.executor.focus(this.targetWindow);
          if(epoch!==this.epoch||this.stopLatched)throw new Error('local-stop-latched');
          if(!focused.ok)throw new Error(focused.error||'focus-refused');
        }
      }
      this.setMode(mode,{minutes,expiresAt,source:'owner-remote',generation:controlGeneration,notify:false});
      result={ok:true,mode:this.mode,expiresAt:this.expiresAt};
    } catch(error) { result={ok:false,mode:this.mode,expiresAt:this.expiresAt,error:error.message}; }
    this.relay?.send({type:'owner_state_result',requestId,controlGeneration,...result}); return result;
  }
  async runCommand({commandId,name,args={},botId='remote-bot',controlGeneration,expiresAt}) {
    if(name==='status') return {ok:true,result:this.getStatus()};
    if(name==='stop_all') {this.setMode('off',{source:'bot-stop'});return {ok:true,result:this.getStatus()};}
    if(name==='record_stop') {if(this.operationName==='record_start')this.operation?.abort();return {ok:true,result:await this.stopRecording()};}
    if(typeof commandId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(commandId)||!Number.isFinite(expiresAt)||!Number.isInteger(controlGeneration))return fail('invalid-command-envelope');
    if(this.operation) return fail('host-busy');
    if(commandId&&this.seen.has(commandId)) return fail('command-replayed');
    if(commandId) {this.seen.add(commandId);if(this.seen.size>2000)this.seen.delete(this.seen.values().next().value);}
    if(expiresAt!==undefined&&(!Number.isFinite(expiresAt)||expiresAt<=this.clock())) return fail('command-expired');
    if(controlGeneration!==undefined&&controlGeneration!==this.controlGeneration) return fail('stale-session');
    if(this.leaseEndsAt<=this.clock())this.activeBot=null;
    if(botId!=='owner-preview'&&this.activeBot&&this.activeBot!==botId)return fail('bot-lease-held');
    const operation=new AbortController();this.operation=operation;this.operationName=name;const epoch=this.epoch;
    const timer=setTimeout(()=>operation.abort(),Math.max(1,Math.min(20000,(expiresAt||this.clock()+20000)-this.clock())));
    timer.unref?.();
    try {
      this.getStatus();
      const foreground=await this.executor.foreground({signal:operation.signal});
      if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
      const verdict=validateCommand(name,args,{mode:this.mode,expiresAt:this.expiresAt,now:this.clock(),foreground,
        targetWindow:this.targetWindow,allowedApps:this.configStore.load().allowedApps});
      if(!verdict.allowed) {
        this.auditLog.write({botId,command:name,outcome:verdict.category,app:foreground.processName});
        return fail(verdict.category,verdict.reason);
      }
      let snapshot;
      if(INPUT.has(name)) {
        snapshot=this.snapshots.get(args.snapshotId);
        if(!snapshot||snapshot.botId!==botId||snapshot.epoch!==epoch||this.clock()-snapshot.at>15000)return fail('fresh-snapshot-required');
        const a=snapshot.window,b=foreground;
        if(a.handle!==b.handle||a.processId!==b.processId||a.title!==b.title||JSON.stringify(a.geometry)!==JSON.stringify(b.geometry))return fail('window-moved-retake-snapshot');
        this.snapshots.clear();
      }
      if(botId!=='owner-preview'){this.activeBot=botId;this.leaseEndsAt=this.clock()+60000;}
      this.mode='running';this.emitStatus();
      let result;const nativeArgs={...args,expectedWindow:this.targetWindow,geometry:snapshot?.window.geometry};
      if(name==='focus') {
        const focused=this.executor.focus
          ? await this.executor.focus(this.targetWindow,{signal:operation.signal})
          : await this.executor.run(name,nativeArgs,{signal:operation.signal});
        if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
        if(!focused.ok){
          const refused=focused.error==='focus-refused'||focused.error==='target-not-foreground';
          this.auditLog.write({botId,command:name,outcome:focused.error||'focus-refused',app:this.targetWindow.processName});
          return fail(refused?'focus-refused':focused.error||'focus-refused', refused?'Windows refused to foreground the approved window.':focused.message);
        }
        const restored=await this.executor.foreground({signal:operation.signal});
        if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
        if(String(this.targetWindow.handle)!==String(restored.handle)||this.targetWindow.processId!==restored.processId){
          this.auditLog.write({botId,command:name,outcome:'target-changed',app:this.targetWindow.processName});
          return fail('target-changed','The approved window could not be restored to the foreground.');
        }
        const post=validateCommand('screenshot',{},{mode:this.mode,expiresAt:this.expiresAt,now:this.clock(),foreground:restored,
          targetWindow:this.targetWindow,allowedApps:this.configStore.load().allowedApps});
        if(!post.allowed){
          this.auditLog.write({botId,command:name,outcome:post.category,app:restored.processName});
          return fail(post.category,post.reason);
        }
        result={ok:true,focused:true,window:restored};
      } else if(name==='record_start') {
        if(this.recording)return fail('already-recording');
        const abort=new AbortController();this.recordAbort=abort;
        operation.signal.addEventListener('abort',()=>abort.abort(),{once:true});
        result=await this.executor.recordStart({targetWindow:this.targetWindow,signal:abort.signal,
          onFailure:()=>{this.stopRecording();this.emitStatus();}});
        if(epoch===this.epoch&&!operation.signal.aborted&&!abort.signal.aborted&&this.recordAbort===abort&&result.ok)this.recording=true;
        else {abort.abort();await this.stopRecording();}
      } else result=await this.executor.run(name,nativeArgs,{signal:operation.signal});
      if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
      if(result.ok&&READ.has(name)) {
        const snapshotId=randomUUID();
        this.snapshots.set(snapshotId,{botId,epoch,at:this.clock(),window:result.window||foreground});
        if(this.snapshots.size>8)this.snapshots.delete(this.snapshots.keys().next().value);
        result={...result,snapshotId};
      }
      this.auditLog.write({botId,command:name,outcome:result.ok?'ok':result.error||'failed',app:foreground.processName});
      return result.ok?{ok:true,result}:fail(result.error||'command-failed');
    }catch(error){return fail(operation.signal.aborted?'command-cancelled':error.message);}
    finally {clearTimeout(timer);if(this.operation===operation)this.operation=null;
      if(epoch===this.epoch&&this.mode==='running')this.mode='armed';this.emitStatus();}
  }
  async stopRecording(){this.recordAbort?.abort();this.recordAbort=null;this.recording=false;
    try{return await this.executor.recordStop();}catch{return {ok:false,error:'recording-stop-failed'};}}
  emergencyStop(source='local-hotkey'){this.stopLatched=true;return this.setMode('off',{source});}
  emitStatus(){this.emit('status',this.getStatus());}
}
