export const viewerHtml = `<style>body{padding-bottom:100px}#remote-stop{position:fixed;bottom:max(16px,env(safe-area-inset-bottom));right:16px;z-index:20;background:#ff4d3e;color:#111315;border:2px solid #111315;box-shadow:0 3px 12px #0003}#screen{touch-action:pan-y}#viewer-status{overflow-wrap:anywhere}</style><button id="remote-stop">STOP ACCESS</button><section class="card" aria-labelledby="viewer-heading">
<h2 id="viewer-heading">Control from this phone</h2>
<div id="handoff-panel" hidden role="status"><strong>Waiting for you</strong><p id="handoff-message"></p><button id="handoff-done">DONE — CONTINUE</button><p class="meta">Type or click below, then return control. Your bot can continue when it checks the completed handoff.</p></div>
<p class="meta">Take control to pause bot input. Tap the picture to click. This viewer refreshes the current window; it is not a video stream.</p>
<div class="bot-token-actions"><button id="take-control">TAKE CONTROL</button><button id="give-control">RETURN TO BOT</button></div>
<p id="viewer-status" class="meta" role="status">Choose Owner control in access rules first.</p>
<label class="access-toggle"><input id="auto-view" type="checkbox" checked>Refresh picture automatically</label>
<label class="access-list-label">Tap action<select id="tap-action"><option value="left">Click</option><option value="double">Double click</option><option value="right">Right click</option></select></label>
<div class="bot-token-actions"><button data-owner-key="ENTER">ENTER</button><button data-owner-key="ESCAPE">ESC</button><button data-owner-key="TAB">TAB</button><button data-owner-key="BACKSPACE">BACKSPACE</button><button data-owner-key="CTRL+S">SAVE</button><button data-owner-scroll="-600">SCROLL UP</button><button data-owner-scroll="600">SCROLL DOWN</button></div>
<label class="access-list-label">Text to type<input id="owner-text" maxlength="4000" autocomplete="off" spellcheck="false"></label><button id="send-text">TYPE TEXT</button>
<div class="bot-token-actions"><button id="list-owner-windows">REFRESH WINDOWS</button><button id="focus-owner-window">OPEN SELECTED WINDOW</button></div>
<select id="owner-windows" aria-label="Open windows"></select>
<button id="close-owner-window">CLOSE CURRENT WINDOW</button>
<label class="access-list-label">Program to open — full .exe path<input id="launch-path" placeholder="C:\\path\\to\\program.exe" autocomplete="off" spellcheck="false"></label><button id="owner-launch">OPEN PROGRAM</button>
</section>`;

export const viewerScript = String.raw`
let ownerFrame=null,ownerBusy=false,ownerRevision=0,ownerCapturing=false;
const vq=s=>document.querySelector(s);
const isOwner=()=>current?.hostOnline&&current?.operator==='owner'&&['armed','running'].includes(current?.mode)&&current?.target?.accessMode==='owner-control'&&!document.hidden;
function invalidateOwnerFrame(){ownerFrame=null;ownerRevision++;}
function ownerNotice(text){vq('#viewer-status').textContent=text;}
async function ownerCommand(name,args={}){const r=await request('/api/owner/'+host+'/command',{name,args});if(r.ok===false)throw new Error(r.error||'Command failed');return r.result;}
async function ownerCapture(){
 if(ownerBusy||ownerCapturing||previewBusy||!isOwner())return;
 ownerCapturing=true;ownerFrame=null;const revision=++ownerRevision;
 try{const r=await ownerCommand('screenshot');const im=r?.image;
  if(!im||!['image/png','image/jpeg'].includes(im.mimeType)||typeof im.data!=='string'||im.data.length>8388608||!r.snapshotId||!r.window?.geometry)throw new Error('Invalid picture');
  const picture=new Image();picture.src='data:'+im.mimeType+';base64,'+im.data;await picture.decode();
  if(revision!==ownerRevision||!isOwner())return;
  screen.src=picture.src;screen.style.display='block';
  await screen.decode();if(revision!==ownerRevision||!isOwner())return;
  ownerFrame={id:r.snapshotId,geometry:r.window.geometry,at:Date.now()};
  vq('#preview-time').textContent='Captured '+new Date().toLocaleTimeString();
  ownerNotice('You have control · '+(r.window.title||r.window.processName||'Current window'));
 }catch(e){if(revision===ownerRevision){clearScreen();ownerNotice(e.message);}}
 finally{ownerCapturing=false;}
}
async function ownerAct(name,args={},needsFrame=true){
 if(!isOwner()||ownerBusy||ownerCapturing)return;
 if(needsFrame&&(!ownerFrame||Date.now()-ownerFrame.at>12000)){ownerNotice('Refresh the picture before acting.');await ownerCapture();return;}
 const snapshotId=ownerFrame?.id;ownerBusy=true;invalidateOwnerFrame();let failure;
 try{await ownerCommand(name,{...args,...(needsFrame?{snapshotId}:{})});ownerNotice('Action completed.');}
 catch(e){failure=e.message;ownerNotice(e.message);}
 finally{ownerBusy=false;clearScreen();await refresh();await ownerCapture();if(failure)ownerNotice(failure);}
}
async function changeOperator(operator){
 if(ownerBusy)return;ownerBusy=true;invalidateOwnerFrame();clearScreen();
 try{const handoffId=operator==='bot'&&current?.handoff?.state==='waiting'?current.handoff.id:undefined;render(await request('/api/owner/'+host+'/state',{mode:'armed',minutes:480,operator,...(handoffId?{handoffId}:{})}));ownerNotice(operator==='owner'?'You have control. Bot input is paused.':'Bot control enabled.');}
 catch(e){ownerNotice(e.message);}finally{ownerBusy=false;await refresh();if(operator==='owner')await ownerCapture();}
}
vq('#take-control').onclick=()=>changeOperator('owner');
vq('#give-control').onclick=()=>changeOperator('bot');
vq('#handoff-done').onclick=()=>changeOperator('bot');
vq('#remote-stop').onclick=()=>vq('[data-action="off"]').click();
screen.addEventListener('click',event=>{
 if(!ownerFrame||!isOwner()||ownerBusy||ownerCapturing)return;
 const rect=screen.getBoundingClientRect(),g=ownerFrame.geometry;
 const x=Math.floor((event.clientX-rect.left)*g.width/rect.width),y=Math.floor((event.clientY-rect.top)*g.height/rect.height);
 if(x<0||y<0||x>=g.width||y>=g.height)return;
 const action=vq('#tap-action').value;void ownerAct('click',{x,y,button:action==='right'?'right':'left',count:action==='double'?2:1});
});
document.querySelectorAll('[data-owner-key]').forEach(b=>b.onclick=()=>ownerAct('key',{key:b.dataset.ownerKey}));
document.querySelectorAll('[data-owner-scroll]').forEach(b=>b.onclick=()=>ownerAct('scroll',{deltaY:Number(b.dataset.ownerScroll)}));
vq('#send-text').onclick=async()=>{const text=vq('#owner-text').value;if(text)await ownerAct('type',{text});};
vq('#list-owner-windows').onclick=async()=>{
 if(!isOwner()||ownerBusy||ownerCapturing)return;ownerBusy=true;
 try{const r=await ownerCommand('list_windows');const select=vq('#owner-windows');select.replaceChildren();
  for(const w of r.windows||[]){const o=document.createElement('option');o.value=w.handle;o.textContent=w.processName+' · '+w.title;o.dataset.path=w.executablePath||'';select.append(o);}
 }catch(e){ownerNotice(e.message);}finally{ownerBusy=false;}
};
vq('#owner-windows').onchange=()=>{vq('#launch-path').value=vq('#owner-windows').selectedOptions[0]?.dataset.path||'';};
vq('#focus-owner-window').onclick=()=>{const windowHandle=vq('#owner-windows').value;if(windowHandle)void ownerAct('focus',{windowHandle},false);};
vq('#close-owner-window').onclick=()=>{if(confirm('Close the window shown? Unsaved changes may be lost.'))void ownerAct('close_window');};
vq('#owner-launch').onclick=()=>ownerAct('launch_app',{app:vq('#launch-path').value.trim()},false);
const oldPreview=vq('#preview').onclick;vq('#preview').onclick=()=>isOwner()?ownerCapture():oldPreview();
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',invalidateOwnerFrame));
document.addEventListener('visibilitychange',()=>{if(document.hidden){invalidateOwnerFrame();clearScreen();}});
window.addEventListener('pagehide',()=>{invalidateOwnerFrame();clearScreen();});
function renderViewerState(){
 const waiting=current?.handoff?.state==='waiting';vq('#handoff-panel').hidden=!waiting;vq('#handoff-message').textContent=waiting?current.handoff.message:'';vq('#handoff-done').disabled=!isOwner()||ownerBusy||ownerCapturing;
 const active=isOwner();vq('#take-control').disabled=!current?.hostOnline||current?.target?.accessMode!=='owner-control'||ownerBusy;
 vq('#give-control').disabled=!active||ownerBusy;
 if(waiting)vq('#take-control').disabled=true;
 document.querySelectorAll('[data-owner-key],[data-owner-scroll],#send-text,#list-owner-windows,#focus-owner-window,#close-owner-window,#owner-launch').forEach(b=>b.disabled=!active||ownerBusy||ownerCapturing);
 if(!active)invalidateOwnerFrame();
}
async function viewerTick(){
 renderViewerState();const active=isOwner();
 if(active&&vq('#auto-view').checked)await ownerCapture();
 setTimeout(viewerTick,2500);
}
void viewerTick();
`;
