import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { clampArmMinutes, CAPABILITY_FLAGS } from '../shared/protocol.mjs';
import { CONTRACT_VERSION } from '../shared/errors.mjs';
import { validateCommand, isAllowedWindow, classifyPcWindow } from './guard.mjs';
import { TargetRecovery, sameTarget, TEMPORARY_TARGET_MS } from './target-recovery.mjs';
import { normalizeBlockedApps } from './config-store.mjs';
const INPUT = new Set(['click', 'move', 'type', 'key', 'scroll', 'drag', 'move_window', 'close_window']);
const READ = new Set(['screenshot', 'snapshot']);
const fail = (error, message = error) => ({ok:false, error, message});

export class HostController extends EventEmitter {
  constructor({configStore, auditLog, executor, clock = Date.now}) {
    super(); Object.assign(this, {configStore, auditLog, executor, clock});
    this.mode='off'; this.expiresAt=null; this.activeBot=null; this.leaseEndsAt=0;
    this.relayStatus={connected:false, authenticated:false}; this.relay=null;
    this.targetWindow=null; this.snapshots=new Map(); this.epoch=0; this.controlGeneration=null; this.operator='bot';
    this.operation=null; this.expiryTimer=null; this.seen=new Set(); this.stopLatched=false; this.inputSafetyFault=null;
    this.recording=false; this.recordAbort=null;
    this.targetHealth={state:['pc-access','owner-control'].includes(configStore.load().accessMode)?'pc-access':'missing',checkedAt:null,reason:null}; this.targetDeadline=null;
    this.recovery=new TargetRecovery(this); this.ownerOperation=false;
  }
  attachRelay(relay) {
    this.relay=relay;
    relay.on('status', status => {
      this.relayStatus=status;
      if (!status.authenticated) this.setMode('off', {source:'relay-disconnected',notify:this.mode!=='off'});
      if (!status.authenticated) this.recovery.clear();
      if (status.authenticated && !['pc-access','owner-control'].includes(this.configStore.load().accessMode)) void this.revalidateTarget();
      this.emitStatus();
    });
  }
  getStatus() {
    if (this.targetDeadline && this.clock()>=this.targetDeadline) this.invalidateTarget('temporary-target-expired');
    if (this.expiresAt && this.clock()>=this.expiresAt) this.setMode('off', {source:'expiry'});
    const config=this.configStore.load();
    return {mode:this.mode, expiresAt:this.expiresAt, activeBot:this.activeBot, recording:this.recording,
      relay:this.relayStatus, stopLatched:this.stopLatched, inputSafetyFault:this.inputSafetyFault, targetWindow:this.targetWindow,
      targetHealth:this.targetHealth, targetDeadline:this.targetDeadline,
      allowRemoteArm:Boolean(config.allowRemoteArm), hostId:config.hostId||null,
      contractVersion:CONTRACT_VERSION, capabilities:{...CAPABILITY_FLAGS,fullDesktopMode:['pc-access','owner-control'].includes(config.accessMode),clipboard:!['pc-access','owner-control'].includes(config.accessMode),launchApplications:['pc-access','owner-control'].includes(config.accessMode)},
      operator:this.operator, scope:{mode:this.mode, expiresAt:this.expiresAt, selectedWindow:Boolean(this.targetWindow), fullDesktop:['pc-access','owner-control'].includes(config.accessMode), editingAllowed:config.accessMode!=='pc-access', blockedApps:config.blockedApps}};
  }
  selectTarget(window, {temporary=false,notify=true}={}) {
    this.setMode('off', {source:'target-changed',notify}); this.targetWindow=window ? structuredClone(window) : null;
    this.targetDeadline=window&&temporary?this.clock()+TEMPORARY_TARGET_MS:null;
    this.targetHealth={state:window?'ready':'missing',checkedAt:window?this.clock():null,reason:null}; this.emitStatus();
  }
  invalidateTarget(reason) {
    this.targetWindow=null; this.targetDeadline=null;
    this.targetHealth={state:'reselect-required',checkedAt:this.clock(),reason};
    this.setMode('off',{source:'target-invalid'});
    return fail('target-reselect-required',reason);
  }
  async revalidateTarget(options) {
    if(['pc-access','owner-control'].includes(this.configStore.load().accessMode))return {ok:true};
    const target=this.targetWindow, epoch=this.epoch;
    if(!target)return fail('target-required');
    let current;
    try { current=await this.executor.inspect(target,options); }
    catch { current=fail('target-check-unavailable'); }
    if(epoch!==this.epoch||options?.signal?.aborted)return fail('command-cancelled');
    if(this.targetDeadline&&this.clock()>=this.targetDeadline)return this.invalidateTarget('temporary-target-expired');
    if(!current.ok||!sameTarget(target,current.window)||!isAllowedWindow(current.window,this.configStore.load().allowedApps))
      return this.invalidateTarget(current.error||'target-identity-or-safety-changed');
    this.targetWindow=current.window; this.targetHealth={state:'ready',checkedAt:this.clock(),reason:null}; this.emitStatus();
    return {ok:true,window:current.window};
  }
  async ownerTarget({action,...args}) {
    if(this.ownerOperation)return fail('host-busy');
    this.ownerOperation=true;
    try { return {ok:true,result:action==='list'?await this.recovery.list():action==='approve'?await this.recovery.approve(args):action==='policy'?this.setAccessPolicy(args,{notify:false}):(()=>{throw new Error('invalid-target-action');})()}; }
    catch(error){return fail(error.message);}
    finally{this.ownerOperation=false;}
  }
  setAccessPolicy({accessMode,blockedApps},{notify=true}={}) {
    if(!['selected-window','pc-access','owner-control'].includes(accessMode))throw new Error('invalid-access-mode');
    const normalized=normalizeBlockedApps(blockedApps);
    this.setMode('off',{source:'access-policy-changed',notify});
    this.targetWindow=null;this.targetDeadline=null;this.snapshots.clear();this.recovery.clear();
    this.configStore.save({accessMode,blockedApps:normalized});
    this.targetHealth={state:['pc-access','owner-control'].includes(accessMode)?'pc-access':'missing',checkedAt:this.clock(),reason:null};
    this.emitStatus();return this.getStatus();
  }
  whenIdle() { return this.idlePromise || Promise.resolve(); }
  clearLocalStop() { if(this.inputSafetyFault)throw new Error(this.inputSafetyFault);this.stopLatched=false; this.emitStatus(); }
  setMode(mode, {minutes=480, expiresAt, source='local', generation, operator='bot', notify=true}={}) {
    if (!['off','armed','paused'].includes(mode)) throw new Error('invalid-mode');
    if(mode==='armed'&&this.inputSafetyFault)throw new Error(this.inputSafetyFault);
    if (mode==='armed' && (this.stopLatched||(!this.targetWindow&&!['pc-access','owner-control'].includes(this.configStore.load().accessMode)))) throw new Error(this.stopLatched?'local-stop-latched':'select-a-window-first');
    if(mode==='armed'&&this.targetDeadline&&this.clock()>=this.targetDeadline)throw new Error('temporary-target-expired');
    this.recovery.clear();
    if(mode!=='armed'&&this.targetDeadline){
      this.targetWindow=null;this.targetDeadline=null;
      this.targetHealth={state:'reselect-required',checkedAt:this.clock(),reason:'temporary-target-revoked'};
    }
    this.epoch++; this.operation?.abort(); this.snapshots.clear();
    this.mode=mode; this.activeBot=null; this.leaseEndsAt=0; clearTimeout(this.expiryTimer);
    this.controlGeneration=generation??null; this.operator=mode==='armed'&&operator==='owner'?'owner':'bot';
    this.expiresAt=mode==='armed'?Math.min(expiresAt||Infinity,this.clock()+clampArmMinutes(minutes)*60_000,this.targetDeadline||Infinity):null;
    if (this.expiresAt) {
      this.expiryTimer=setTimeout(()=>this.setMode('off',{source:'expiry'}),Math.max(1,this.expiresAt-this.clock()));
      this.expiryTimer.unref?.();
    }
    if (mode!=='armed') this.stopRecording();
    this.auditLog.write({command:'state',outcome:mode+':'+source});
    if (notify && mode!=='armed') this.relay?.send({type:'local_state',mode,expiresAt:null,controlGeneration:this.controlGeneration,source:this.stopLatched?'emergency':source});
    this.emitStatus(); return this.getStatus();
  }
  async applyOwnerState({mode,minutes=480,expiresAt,requestId,controlGeneration,operator='bot'}) {
    let result;
    try {
      if (mode==='armed') {
        if(operator==='owner'&&this.configStore.load().accessMode!=='owner-control')throw new Error('owner-control-required');
        if (!this.configStore.load().allowRemoteArm) throw new Error('remote-arm-disabled');
        if (this.stopLatched) throw new Error('local-stop-latched');
        const pcAccess=['pc-access','owner-control'].includes(this.configStore.load().accessMode);
        if (!this.targetWindow&&!pcAccess) throw new Error('select-a-window-first');
        if (!Number.isFinite(expiresAt)||expiresAt<=this.clock()) throw new Error('expired-arm-request');
        const epoch=this.epoch;
        if(this.ownerOperation)throw new Error('host-busy');
        if(!pcAccess){const valid=await this.revalidateTarget();if(!valid.ok)throw new Error(valid.error);}
        if(this.targetDeadline&&expiresAt>this.targetDeadline)throw new Error('temporary-target-limit');
        if(!pcAccess&&this.executor.focus){
          const focused=await this.executor.focus(this.targetWindow);
          if(epoch!==this.epoch||this.stopLatched)throw new Error('local-stop-latched');
          if(!focused.ok)throw new Error(focused.error||'focus-refused');
        }
      }
      this.setMode(mode,{minutes,expiresAt,source:'owner-remote',generation:controlGeneration,operator,notify:false});
      result={ok:true,mode:this.mode,expiresAt:this.expiresAt};
    } catch(error) { result={ok:false,mode:this.mode,expiresAt:this.expiresAt,error:error.message}; }
    this.relay?.send({type:'owner_state_result',requestId,controlGeneration,...result}); return result;
  }
  async runCommand({commandId,name,args={},botId='remote-bot',controlGeneration,expiresAt}) {
    const access=this.configStore.load();
    const pcAccess=['pc-access','owner-control'].includes(access.accessMode);
    if(name==='status' || name==='capabilities') return {ok:true,result:name==='capabilities'?{
      contractVersion:CONTRACT_VERSION, capabilities:{...CAPABILITY_FLAGS,fullDesktopMode:pcAccess,clipboard:!pcAccess,launchApplications:pcAccess}, mode:this.mode, expiresAt:this.expiresAt,
      scope:{selectedWindow:Boolean(this.targetWindow), fullDesktop:pcAccess, editingAllowed:access.accessMode!=='pc-access', blockedApps:access.blockedApps},
      limitations:['Cannot bypass UAC or secure desktop.',access.accessMode==='owner-control'?'Elevated apps require BotDoor itself to run as administrator. Password controls remain blocked.':'Elevated and password controls are blocked.',...(access.accessMode==='pc-access'?['PC access permits pointer movement, viewing, scrolling, moving and closing ordinary windows, and launching an existing local executable by exact path. Editing controls remain blocked.']:[])]
    }:this.getStatus()};
    if(name==='stop_all') {this.setMode('off',{source:'bot-stop'});return {ok:true,result:this.getStatus()};}
    if(name==='record_stop') {if(this.operationName==='record_start')this.operation?.abort();return {ok:true,result:await this.stopRecording()};}
    if(typeof commandId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(commandId)||!Number.isFinite(expiresAt)||!Number.isInteger(controlGeneration))return fail('invalid-command-envelope');
    if(this.operator==='owner'&&botId!=='owner-preview')return fail('owner-has-control');
    if(botId==='owner-preview'&&!['screenshot','snapshot','list_windows','list_monitors'].includes(name)&&this.operator!=='owner')return fail('take-control-first');
    if(this.operation||this.ownerOperation) return fail('host-busy');
    if(commandId&&this.seen.has(commandId)) return fail('command-replayed');
    if(commandId) {this.seen.add(commandId);if(this.seen.size>2000)this.seen.delete(this.seen.values().next().value);}
    if(expiresAt!==undefined&&(!Number.isFinite(expiresAt)||expiresAt<=this.clock())) return fail('command-expired');
    if(controlGeneration!==undefined&&controlGeneration!==this.controlGeneration) return fail('stale-session');
    if(this.leaseEndsAt<=this.clock())this.activeBot=null;
    if(botId!=='owner-preview'&&this.activeBot&&this.activeBot!==botId)return fail('bot-lease-held');
    const operation=new AbortController();this.operation=operation;this.operationName=name;const epoch=this.epoch;
    let finished;this.idlePromise=new Promise(resolve=>{finished=resolve;});
    const timer=setTimeout(()=>operation.abort(),Math.max(1,Math.min(20000,(expiresAt||this.clock()+20000)-this.clock())));
    timer.unref?.();
    try {
      this.getStatus();
      if(!['armed','running'].includes(this.mode))return fail('not-armed');
      if(name==='list_monitors'||name==='launch_app') {
        const verdict=validateCommand(name,args,{mode:this.mode,expiresAt:this.expiresAt,now:this.clock(),
          foreground:{},targetWindow:this.targetWindow||{handle:'0',processId:1},allowedApps:access.allowedApps,accessMode:access.accessMode,blockedApps:access.blockedApps});
        if(!verdict.allowed)return fail(verdict.category,verdict.reason);
        const result=await this.executor.run(name,{...args,accessMode:access.accessMode,blockedApps:access.blockedApps},{signal:operation.signal});
        if(!result.ok)return fail(result.error||'command-failed',result.message||result.error);
        if(name==='launch_app')this.auditLog.write({botId,command:name,outcome:'ok',app:args.app});
        return {ok:true,result};
      }
      if(!pcAccess){const valid=await this.revalidateTarget({signal:operation.signal});if(!valid.ok)return valid;}
      let foreground=await this.executor.foreground({signal:operation.signal});
      if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
      const canRestore=!pcAccess&&(READ.has(name)||name==='list_windows');
      const target=this.targetWindow;
      if(canRestore && this.executor.focus && target &&
        (String(foreground.handle)!==String(target.handle)||foreground.processId!==target.processId)) {
        // Check the session and approved target before any focus change. The native
        // executor verifies current desktop, privileges and sensitive controls too.
        const preflight=validateCommand(name,args,{mode:this.mode,expiresAt:this.expiresAt,now:this.clock(),
          foreground:target,targetWindow:target,allowedApps:access.allowedApps});
        if(!preflight.allowed)return fail(preflight.category,preflight.reason);
        this.snapshots.clear();
        const focused=await this.executor.focus(target,{signal:operation.signal});
        if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
        if(!focused.ok)return fail(focused.error||'focus-refused');
        foreground=await this.executor.foreground({signal:operation.signal});
      }
      if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
      let focusTarget=this.targetWindow;
      if(pcAccess&&name==='focus'){
        if(typeof args.windowHandle!=='string'||!/^[1-9][0-9]{0,18}$/.test(args.windowHandle))return fail('invalid-target');
        const listed=await this.executor.listWindows({signal:operation.signal,accessMode:access.accessMode,blockedApps:access.blockedApps});
        if(!listed.ok)return fail(listed.error||'window-list-unavailable');
        focusTarget=listed.windows?.find(w=>w.handle===args.windowHandle);
        if(!focusTarget)return fail('target-unavailable');
      }
      const verdict=validateCommand(name,args,{mode:this.mode,expiresAt:this.expiresAt,now:this.clock(),foreground,
        targetWindow:focusTarget,allowedApps:access.allowedApps,accessMode:access.accessMode,blockedApps:access.blockedApps});
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
      let result;const nativeArgs={...args,expectedWindow:pcAccess?foreground:this.targetWindow,geometry:snapshot?.window.geometry,snapshotTitle:snapshot?.window.title,
        accessMode:access.accessMode,blockedApps:access.blockedApps};
      if(name==='focus') {
        const focused=await this.executor.focus(focusTarget,{signal:operation.signal,accessMode:access.accessMode,blockedApps:access.blockedApps});
        if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
        if(!focused.ok){
          const refused=focused.error==='focus-refused'||focused.error==='target-not-foreground';
          this.auditLog.write({botId,command:name,outcome:focused.error||'focus-refused',app:focusTarget.processName});
          return fail(refused?'focus-refused':focused.error||'focus-refused', refused?'Windows refused to foreground the approved window.':focused.message||focused.error||'focus-refused');
        }
        const restored=await this.executor.foreground({signal:operation.signal});
        if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
        if(String(focusTarget.handle)!==String(restored.handle)||focusTarget.processId!==restored.processId){
          this.auditLog.write({botId,command:name,outcome:'target-changed',app:focusTarget.processName});
          return fail('target-changed','The approved window could not be restored to the foreground.');
        }
        const post=validateCommand('screenshot',{},{mode:this.mode,expiresAt:this.expiresAt,now:this.clock(),foreground:restored,
          targetWindow:focusTarget,allowedApps:access.allowedApps,accessMode:access.accessMode,blockedApps:access.blockedApps});
        if(!post.allowed){
          this.auditLog.write({botId,command:name,outcome:post.category,app:restored.processName});
          return fail(post.category,post.reason);
        }
        this.snapshots.clear();result={ok:true,focused:true,window:restored};
      } else if(name==='record_start') {
        if(pcAccess)return fail('pc-recording-unavailable','Recording across changing apps is not available yet.');
        if(this.recording)return fail('already-recording');
        const abort=new AbortController();this.recordAbort=abort;
        operation.signal.addEventListener('abort',()=>abort.abort(),{once:true});
        result=await this.executor.recordStart({targetWindow:this.targetWindow,signal:abort.signal,
          onFailure:()=>{this.stopRecording();this.emitStatus();}});
        if(epoch===this.epoch&&!operation.signal.aborted&&!abort.signal.aborted&&this.recordAbort===abort&&result.ok)this.recording=true;
        else {abort.abort();await this.stopRecording();}
      } else result=await this.executor.run(name,nativeArgs,{signal:operation.signal});
      if(['windows-drag-stop-unconfirmed','windows-drag-release-unconfirmed'].includes(result?.error)) {
        this.inputSafetyFault=result.error;
        this.emergencyStop('input-safety-fault');
        this.auditLog.write({botId,command:name,outcome:result.error,app:foreground.processName});
        return fail(result.error);
      }
      if(epoch!==this.epoch||operation.signal.aborted)return fail('command-cancelled');
      if(result.ok&&READ.has(name)) {
        const snapshotId=randomUUID();
        this.snapshots.set(snapshotId,{botId,epoch,at:this.clock(),window:result.window||foreground});
        if(this.snapshots.size>8)this.snapshots.delete(this.snapshots.keys().next().value);
        result={...result,snapshotId};
      }
      // Large PNG base64 frames were observed completing locally then timing out in relay delivery.
      if(result.ok&&name==='screenshot'&&result.image?.data&&result.image.data.length>7_500_000){
        this.auditLog.write({botId,command:name,outcome:'capture-too-large',app:foreground.processName});
        return fail('capture-too-large','Screenshot exceeded the relay transport budget after capture.');
      }
      this.auditLog.write({botId,command:name,outcome:result.ok?'ok':result.error||'failed',app:(result.window||this.targetWindow||foreground).processName});
      return result.ok?{ok:true,result}:fail(result.error||'command-failed');
    }catch(error){return fail(operation.signal.aborted?'command-cancelled':error.message);}
    finally {clearTimeout(timer);if(this.operation===operation)this.operation=null;
      if(epoch===this.epoch&&this.mode==='running')this.mode='armed';this.emitStatus();finished();}
  }
  async stopRecording(){this.recordAbort?.abort();this.recordAbort=null;this.recording=false;
    try{return await this.executor.recordStop();}catch{return {ok:false,error:'recording-stop-failed'};}}
  emergencyStop(source='local-hotkey'){this.stopLatched=true;return this.setMode('off',{source});}
  emitStatus(){const status=this.getStatus();this.emit('status',status);
    const w=status.targetWindow;
      this.relay?.send({type:'target_status',target:{...status.targetHealth,temporaryUntil:status.targetDeadline,
      accessMode:this.configStore.load().accessMode,blockedApps:this.configStore.load().blockedApps,
      operator:this.operator,
      window:w?{title:w.title,processName:w.processName,processId:w.processId,handle:w.handle}:null}});
  }
}
