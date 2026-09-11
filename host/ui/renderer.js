const byId=id=>document.getElementById(id);
const fields=['relayUrl','hostId','hostToken','ownerToken','botToken'];
function notice(text){byId('saveResult').textContent=text;}
function checked(result){if(result?.ok===false)throw new Error(result.error||'Action failed');return result;}
async function action(fn){try{return checked(await fn());}catch(e){notice(e.message);return null;}}
function render(status){
  const mode=status.mode||'off';byId('modeBadge').className='mode '+mode;byId('modeBadge').textContent=mode.toUpperCase();
  const titles={off:'Bot access is off',armed:'Waiting for an approved bot',running:'A bot is controlling this window',paused:'Bot access is paused'};
  byId('statusTitle').textContent=titles[mode]||mode;
  byId('statusDetail').textContent=status.stopLatched?'Local stop is locked. Unlock it here before remote arming.':status.expiresAt?'Access expires '+new Date(status.expiresAt).toLocaleTimeString()+'.':'Bot commands are rejected until you arm a session.';
  byId('relayState').textContent=status.relay?.authenticated?'Securely connected':status.relay?.connected?'Authenticating':'Offline';
  byId('hostState').textContent=status.hostId||'Not configured';
  byId('recordingState').textContent=status.recording?'Recording selected window':'Stopped';
  byId('unlockButton').hidden=!status.stopLatched;
  byId('targetDetail').textContent=status.targetWindow?'Selected: '+status.targetWindow.title+' ('+status.targetWindow.processName+')':'Choose an app window before arming. Only that window is captured and controlled.';
}
async function load(){
  const state=checked(await window.botdesk.getState());render(state.status);
  for(const id of fields)byId(id).value=state.config[id]||'';
  byId('allowedApps').value=state.config.allowedApps.join(', ');
  byId('remoteArm').checked=state.config.allowRemoteArm;byId('startAtLogin').checked=state.config.startAtLogin;
}
byId('armButton').onclick=()=>action(()=>window.botdesk.setMode('armed',480));
byId('pauseButton').onclick=()=>action(()=>window.botdesk.setMode('paused'));
byId('stopButton').onclick=()=>action(()=>window.botdesk.emergencyStop());
byId('unlockButton').onclick=()=>action(()=>window.botdesk.clearStop());
byId('copyOwnerLink').onclick=async()=>{if(await action(()=>window.botdesk.copyOwnerLink()))notice('Private phone link copied. Share only with your own phone.');};
byId('openCaptures').onclick=()=>action(()=>window.botdesk.openCaptures());
byId('refreshWindows').onclick=async()=>{
  const r=await action(()=>window.botdesk.listWindows());if(!r)return;
  byId('targetWindow').replaceChildren(new Option('Choose an app window',''));
  for(const w of r.windows)byId('targetWindow').add(new Option(w.processName+' — '+w.title,w.handle));
  if(!r.windows.length)notice('No verified app windows available. Open an ordinary browser page or Notepad, then refresh.');
};
byId('targetWindow').onchange=()=>action(()=>window.botdesk.selectWindow(byId('targetWindow').value));
byId('importPairing').onclick=()=>{
  try{const parsed=JSON.parse(byId('pairingJson').value);const config=parsed.config||parsed.hostConfig||parsed;
    for(const id of fields)if(typeof config[id]==='string')byId(id).value=config[id];
    byId('pairingJson').value='';notice('Pairing fields filled. Save settings next.');
  }catch{notice('Paste the host config JSON from the private provisioning file.');}
};
byId('saveButton').onclick=async()=>{
  const config=Object.fromEntries(fields.map(id=>[id,byId(id).value.trim()]));
  for(const key of ['hostToken','ownerToken','botToken'])if(!config[key])delete config[key];
  Object.assign(config,{allowRemoteArm:byId('remoteArm').checked,startAtLogin:byId('startAtLogin').checked,allowedApps:byId('allowedApps').value.split(',').map(s=>s.trim()).filter(Boolean)});
  if(await action(()=>window.botdesk.saveConfig(config))){notice('Settings saved with Windows encryption.');await load();}
};
window.botdesk.onStatus(render);
let recording=null;
window.botdesk.onRecord('record-start',({id})=>{recording={id,canvas:document.createElement('canvas'),recorder:null,writes:Promise.resolve(),stopping:false};});
window.botdesk.onRecord('record-frame',async({id,image})=>{
  const r=recording;if(!r||r.id!==id||r.stopping)return;
  const img=new Image();img.src='data:'+image.mimeType+';base64,'+image.data;
  await img.decode();if(recording!==r||r.stopping)return;
  if(!r.recorder){
    r.canvas.width=image.width;r.canvas.height=image.height;
    r.canvas.getContext('2d').drawImage(img,0,0);
    r.stream=r.canvas.captureStream(2);
    const mimeType=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
    r.recorder=new MediaRecorder(r.stream,{mimeType,videoBitsPerSecond:1500000});
    r.recorder.ondataavailable=e=>{if(e.data.size)r.writes=r.writes.then(async()=>checked(await window.botdesk.recordingChunk({id,bytes:new Uint8Array(await e.data.arrayBuffer())})));};
    r.recorder.onstop=async()=>{try{await r.writes;}finally{r.stream.getTracks().forEach(t=>t.stop());await window.botdesk.recordingDone(id);if(recording===r)recording=null;}};
    r.recorder.start(1000);
  }else r.canvas.getContext('2d').drawImage(img,0,0,r.canvas.width,r.canvas.height);
});
window.botdesk.onRecord('record-stop',async({id})=>{
  const r=recording;if(!r||r.id!==id)return window.botdesk.recordingDone(id);
  r.stopping=true;if(r.recorder&&r.recorder.state==='recording')r.recorder.stop();
  else {await window.botdesk.recordingDone(id);if(recording===r)recording=null;}
});
load().catch(e=>notice(e.message));
