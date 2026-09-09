import * as native from './windows.mjs';
export class DesktopExecutor{
  constructor({recorder}){this.recorder=recorder;}
  foreground(options){return native.foregroundWindow(options);}
  focus(targetWindow,options){return native.focus({expectedWindow:targetWindow},options);}
  async run(name,args,options){
    switch(name){
      case 'screenshot':return native.capture({expectedWindow:args.expectedWindow},options);
      case 'snapshot':return native.snapshot({expectedWindow:args.expectedWindow},options);
      case 'list_windows':{const w=await this.foreground(options);return {ok:true,windows:[w]};}
      case 'click':return native.click({...args,x:args.geometry.x+args.x,y:args.geometry.y+args.y},options);
      case 'type':return native.typeText(args,options);
      case 'key':return native.pressKey(args,options);
      case 'scroll':return native.scroll(args,options);
      default:return {ok:false,error:'unknown-command'};
    }
  }
  recordStart({targetWindow,signal,onFailure}){
    return this.recorder.start({signal,onFailure,getFrame:()=>native.capture({expectedWindow:targetWindow},{signal})});
  }
  recordStop(){return this.recorder.stop();}
}
