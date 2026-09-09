const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('botdesk',{
  getState:()=>ipcRenderer.invoke('botdesk:get-state'),
  setMode:(mode,minutes)=>ipcRenderer.invoke('botdesk:set-mode',{mode,minutes}),
  clearStop:()=>ipcRenderer.invoke('botdesk:clear-stop'),
  emergencyStop:()=>ipcRenderer.invoke('botdesk:stop'),
  saveConfig:config=>ipcRenderer.invoke('botdesk:save-config',config),
  listWindows:()=>ipcRenderer.invoke('botdesk:windows'),
  selectWindow:handle=>ipcRenderer.invoke('botdesk:select-window',handle),
  openCaptures:()=>ipcRenderer.invoke('botdesk:captures'),
  copyOwnerLink:()=>ipcRenderer.invoke('botdesk:copy-owner-link'),
  showMain:()=>ipcRenderer.invoke('botdesk:show'),
  recordingChunk:chunk=>ipcRenderer.invoke('botdesk:record-chunk',chunk),
  recordingDone:id=>ipcRenderer.invoke('botdesk:record-done',id),
  onStatus:fn=>ipcRenderer.on('botdesk:status',(_e,value)=>fn(value)),
  onRecord:(event,fn)=>{if(['record-start','record-frame','record-stop'].includes(event))ipcRenderer.on('botdesk:'+event,(_e,value)=>fn(value));}
});
