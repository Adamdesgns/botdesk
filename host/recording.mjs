import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Only already-guarded target-window frames enter this service. No desktop stream.
export class RecordingService {
  constructor({directory, send}) { this.directory=directory;this.send=send;this.active=null; }
  async start({getFrame, signal, onFailure}) {
    if (this.active || this.starting) return {ok:false,error:'already-recording'};
    this.starting=true;
    try {
    const id=randomUUID(); await fs.mkdir(this.directory,{recursive:true});
    if(signal.aborted)return {ok:false,error:'recording-cancelled'};
    const file=path.join(this.directory,'botdesk-'+new Date().toISOString().replace(/[:.]/g,'-')+'.webm');
    const handle=await fs.open(file,'wx');
    const state={id,handle,file,bytes:0,frames:0,stopped:false,write:Promise.resolve()};this.active=state;
    this.send('record-start',{id});
    const loop=async()=>{
      while(this.active===state&&!state.stopped&&!signal.aborted){
        const frame=await getFrame();
        if(this.active!==state||state.stopped||signal.aborted)break;
        if(!frame.ok){onFailure();break;}
        state.frames++;this.send('record-frame',{id,image:frame.image});
        await new Promise(resolve=>setTimeout(resolve,700));
      }
    };
    loop().catch(()=>onFailure());
    return {ok:true,recordingId:id,format:'WebM',captureRate:'up to 1 frame per second'};
    } finally { this.starting=false; }
  }
  async chunk({id,bytes}){
    const state=this.active;
    if(!state||id!==state.id||!(bytes instanceof Uint8Array)||bytes.byteLength>8*1024*1024)throw new Error('invalid-recording-chunk');
    state.bytes+=bytes.byteLength;
    if(state.bytes>250*1024*1024){this.stop();throw new Error('recording-size-limit');}
    state.write=state.write.then(()=>state.handle.write(bytes));await state.write;return {ok:true};
  }
  async stop(){
    const state=this.active;
    if(!state)return {ok:true,recording:false};
    if(state.stopPromise)return state.stopPromise;
    state.stopped=true;
    state.stopPromise=new Promise(resolve=>{
      state.resolve=resolve;state.timer=setTimeout(()=>this.finish(state.id),5000);
      this.send('record-stop',{id:state.id});
    });return state.stopPromise;
  }
  async finish(id){
    const s=this.active;if(!s||s.id!==id)return {ok:false,error:'recording-not-active'};
    if(s.finishing)return s.finishing;
    s.finishing=(async()=>{
      clearTimeout(s.timer);let error;
      try{await s.write;}catch{error='recording-write-failed';}
      try{await s.handle.close();}catch{error=error||'recording-close-failed';}
      if(this.active===s)this.active=null;
      const result={ok:!error&&s.bytes>0,path:s.file,bytes:s.bytes,frames:s.frames,...(error?{error}:{})};
      s.resolve?.(result);return result;
    })();return s.finishing;
  }
}
