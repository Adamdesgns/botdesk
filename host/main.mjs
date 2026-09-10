import {app,BrowserWindow,globalShortcut,ipcMain,screen,session,safeStorage,Tray,Menu,nativeImage,shell,clipboard,powerMonitor} from 'electron';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {AuditLog} from './audit-log.mjs';
import {ConfigStore} from './config-store.mjs';
import {HostController} from './controller.mjs';
import {DesktopExecutor} from './executor.mjs';
import {RelayClient} from './relay-client.mjs';
import {RecordingService} from './recording.mjs';
import {listWindows,focus} from './windows.mjs';
import {isAllowedWindow} from './guard.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
let mainWindow,overlayWindow,controller,configStore,recorder,tray,quitting=false;
let choices=[];let quitReady=false;let quitPending=false;
if(process.env.BOTDESK_TEST_DATA)app.setPath('userData',process.env.BOTDESK_TEST_DATA);
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{mainWindow?.show();mainWindow?.focus();});
function safeSend(window,event,value){
  if(!window||window.isDestroyed()||window.webContents.isDestroyed())return;
  try{
    const frame=window.webContents.mainFrame;
    if(frame&&!frame.isDestroyed()&&!frame.detached)frame.send('botdesk:'+event,value);
  }catch{/* A renderer may exit between the checks and delivery. */}
}
const send=(event,value)=>safeSend(mainWindow,event,value);
function lockedWindow(options){
  const w=new BrowserWindow({...options,webPreferences:{preload:path.join(dir,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  w.webContents.on('will-navigate',e=>e.preventDefault());
  w.webContents.on('render-process-gone',()=>{if(!quitting)controller?.emergencyStop('renderer-crash');});
  return w;
}
function trusted(event,overlay=false){
  const expected=overlay?overlayWindow:mainWindow;
  return expected&&!expected.isDestroyed()&&event.sender===expected.webContents&&event.senderFrame===expected.webContents.mainFrame;
}
function handle(name,fn,{allowOverlay=false}={}){
  ipcMain.handle('botdesk:'+name,async(event,...args)=>{
    if(!trusted(event)&&!(allowOverlay&&trusted(event,true)))throw new Error('Untrusted BotDesk IPC sender');
    try{return await fn(...args);}catch(e){return {ok:false,error:e.message};}
  });
}
function installIpc(){
  handle('get-state',()=>({status:controller.getStatus(),config:configStore.publicView(),version:app.getVersion()}));
  handle('windows',async()=>{const result=await listWindows();
    choices=(result.windows||[]).filter(w=>isAllowedWindow(w,configStore.load().allowedApps));
    return {ok:result.ok,windows:choices,error:result.error};});
  handle('select-window',handle=>{
    const target=choices.find(w=>w.handle===handle&&isAllowedWindow(w,configStore.load().allowedApps));if(!target)throw new Error('Refresh and choose an available window.');
    controller.selectTarget(target);return {ok:true,status:controller.getStatus()};
  });
  handle('set-mode',async input=>{
    if(input?.mode==='off')return {ok:true,status:controller.emergencyStop('local-button')};
    if(input?.mode==='paused'){
      const status=controller.setMode('paused');
      if(controller.relayStatus.authenticated)await controller.relay.ownerState('paused');
      return {ok:true,status};
    }
    if(input?.mode!=='armed')throw new Error('invalid-mode');
    if(!controller.targetWindow)throw new Error('Choose a window first.');
    if(controller.stopLatched)throw new Error('Unlock the local stop first.');
    const epoch=controller.epoch;
    const focused=await focus({expectedWindow:controller.targetWindow});
    if(!focused.ok)throw new Error(focused.error);
    if(epoch!==controller.epoch)throw new Error('Arming was cancelled.');
    configStore.save({allowRemoteArm:true});
    send('status',controller.getStatus());
    if(controller.relayStatus.authenticated)return {ok:true,status:await controller.relay.ownerState('armed',input.minutes)};
    // Local sessions are useful for owner-present validation, but are never exposed to the network.
    throw new Error('Connect the relay before going live.');
  });
  handle('stop',()=>({ok:true,status:controller.emergencyStop('local-overlay')}),{allowOverlay:true});
  handle('clear-stop',()=>{controller.clearLocalStop();return {ok:true};});
  handle('set-studio-access',enabled=>{
    if(typeof enabled!=='boolean')throw new Error('Invalid Studio preference.');
    controller.emergencyStop('studio-access-changed');
    const allowedApps=configStore.load().allowedApps.filter(name=>name!=='robloxstudiobeta');
    if(enabled)allowedApps.push('robloxstudiobeta');
    configStore.save({allowedApps});
    choices=[];controller.selectTarget(null);
    return {ok:true,config:configStore.publicView(),status:controller.getStatus()};
  });
  handle('save-config',input=>{
    controller.emergencyStop('settings-changed');
    const next=configStore.save(input||{});
    // Portable apps extract to a temporary executable path. Startup must use the stable portable path.
    const startupPath=process.env.PORTABLE_EXECUTABLE_FILE;
    if(next.startAtLogin&&!startupPath)throw new Error('Start at sign-in is available in the portable build only.');
    app.setLoginItemSettings({openAtLogin:next.startAtLogin,...(startupPath?{path:startupPath,args:['--background']}:{})});
    controller.clearLocalStop();controller.relay.reconnect();
    return {ok:true,config:configStore.publicView()};
  });
  handle('copy-owner-link',()=>{
    const c=configStore.load();if(!c.ownerToken||!c.relayUrl||!c.hostId)throw new Error('Import pairing details first.');
    clipboard.writeText(c.relayUrl+'/control/'+c.hostId+'#'+c.ownerToken);return {ok:true};
  });
  handle('captures',async()=>{await shell.openPath(path.join(app.getPath('userData'),'captures'));return {ok:true};});
  handle('record-chunk',chunk=>recorder.chunk(chunk));
  handle('record-done',id=>recorder.finish(id));
  handle('show',()=>{mainWindow.show();mainWindow.focus();return {ok:true};},{allowOverlay:true});
}
app.whenReady().then(()=>{
  if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable.');
  configStore=new ConfigStore(path.join(app.getPath('userData'),'config.json'),{
    encrypt:text=>safeStorage.encryptString(text),decrypt:data=>safeStorage.decryptString(data)});
  recorder=new RecordingService({directory:path.join(app.getPath('userData'),'captures'),send});
  const executor=new DesktopExecutor({recorder});
  controller=new HostController({configStore,auditLog:new AuditLog(path.join(app.getPath('userData'),'logs')),executor});
  const relay=new RelayClient({getConfig:()=>configStore.load(),onCommand:m=>controller.runCommand(m),onOwnerState:m=>controller.applyOwnerState(m)});
  controller.attachRelay(relay);
  mainWindow=lockedWindow({width:980,height:830,minWidth:760,minHeight:650,backgroundColor:'#0d0d0d',title:'BotDesk Host'});
  mainWindow.on('close',event=>{if(!quitting){event.preventDefault();mainWindow.hide();}});
  const display=screen.getPrimaryDisplay();
  overlayWindow=lockedWindow({x:display.bounds.x,y:display.bounds.y,width:display.bounds.width,height:44,
    frame:false,backgroundColor:'#c92118',alwaysOnTop:true,skipTaskbar:true,resizable:false,show:false,focusable:false});
  overlayWindow.setAlwaysOnTop(true,'screen-saver');
  installIpc();
  mainWindow.loadFile(path.join(dir,'ui/index.html'));
  overlayWindow.loadFile(path.join(dir,'ui/overlay.html'));
  controller.on('status',status=>{
    if(quitting||overlayWindow.isDestroyed())return;
    if(['armed','running'].includes(status.mode))overlayWindow.showInactive();else overlayWindow.hide();
    send('status',status);safeSend(overlayWindow,'status',status);
  });
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  const icon=nativeImage.createFromPath(path.join(dir,'ui/assets/icon.png')).resize({width:32,height:32});
  tray=new Tray(icon);tray.setToolTip('BotDesk — local owner control');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Open BotDesk',click:()=>mainWindow.show()},
    {label:'STOP BOT ACCESS',click:()=>controller.emergencyStop('tray-stop')},
    {type:'separator'},{label:'Quit BotDesk',click:()=>app.quit()}]));
  tray.on('double-click',()=>mainWindow.show());
  if(!globalShortcut.register('CommandOrControl+Shift+F12',()=>controller.emergencyStop()))throw new Error('Emergency stop shortcut could not be registered.');
  powerMonitor.on('lock-screen',()=>controller.emergencyStop('windows-locked'));
  powerMonitor.on('suspend',()=>controller.emergencyStop('windows-suspended'));
  relay.connect();
  if(process.argv.includes('--background'))mainWindow.hide();
}).catch(error=>{console.error('BotDesk startup failed:',error.message);quitting=true;app.quit();});
app.on('before-quit',event=>{
  if(quitReady)return;
  if(quitPending){event.preventDefault();return;}
  quitting=true;
  // Preserve Electron's synchronous quit when there is nothing to flush. Deferring
  // every quit can leave automation waiting for a second app.quit() during teardown.
  const needsFlush=Boolean(recorder?.active||recorder?.starting||controller?.operation);
  if(needsFlush){event.preventDefault();quitPending=true;}
  controller?.emergencyStop('app-quit');controller?.relay?.disconnect();globalShortcut.unregisterAll();
  if(!needsFlush){quitReady=true;return;}
  Promise.allSettled([recorder.stop(),controller.whenIdle()]).finally(()=>{quitReady=true;setImmediate(()=>app.quit());});
});
app.on('window-all-closed',()=>{});
