const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('client/Launcher/screenshot-window.js','utf8');
function fixture(x,y,width,height){
 const mem=new Map(),hooks=new Map(),events=[],state={thread:1,dpi:1};let next=0x1000;
 class P{
  constructor(n){this.n=Number(n);}add(n){return new P(this.n+n);}equals(p){return this.n===p.n;}isNull(){return this.n===0;}
  readPointer(){return new P(0x3000);}readS32(){return mem.get(this.n)||0;}writeS32(v){mem.set(this.n,v);}
  readByteArray(){return Uint8Array.from([0x83,0xec,0x40]).buffer;}
 }
 const ptr=n=>new P(n),api={
  GetClientRect:(h,r)=>{r.writeS32(0);r.add(4).writeS32(0);r.add(8).writeS32(width);r.add(12).writeS32(height);return 1;},
  ClientToScreen:(h,p)=>{p.writeS32(x);p.add(4).writeS32(y);return 1;},
  SetThreadDpiAwarenessContext:p=>{const old=state.dpi;state.dpi=p.n;return ptr(old);}
 };
 vm.runInNewContext(source,{ptr,Uint8Array,Map,Memory:{alloc:n=>{const p=ptr(next);next+=n;return p;}},
  Process:{getCurrentThreadId:()=>state.thread,getModuleByName:()=>({getExportByName:n=>n,findExportByName:n=>n})},
  NativeFunction:function(name){return api[name];},Interceptor:{attach:(at,h)=>hooks.set(at instanceof P?at.n:at,h)},send:e=>events.push(e)});
 return {ptr,state,hooks,events};
}
for(const [x,y,w,h] of [[320,180,800,600],[-1920,80,1600,1200],[2400,-600,1920,1080]]){
 const f=fixture(x,y,w,h),capture=f.hooks.get(0x4e2670),blit=f.hooks.get('BitBlt');
 const context={},args=[f.ptr(24),f.ptr(800),f.ptr(600)];capture.onEnter.call(context,args);
 assert.equal(args[1].n,w);assert.equal(args[2].n,h);assert.equal(f.state.dpi,1,'restore caller DPI context');
 let b=Array.from({length:9},()=>f.ptr(0));b[5]=f.ptr(55);
 blit.onEnter.call({returnAddress:f.ptr(0x4e26cd)},b);assert.equal(b[7].n,x);assert.equal(b[8].n,y);assert.equal(b[5].n,55,'source DC unchanged');
 const untouched=Array.from({length:9},()=>f.ptr(0));blit.onEnter.call({returnAddress:f.ptr(0x123456)},untouched);assert.equal(untouched[7].n,0,'other drawing calls untouched');
 f.state.thread=2;blit.onEnter.call({returnAddress:f.ptr(0x4e26cd)},untouched);assert.equal(untouched[7].n,0,'thread isolated');
 f.state.thread=1;capture.onLeave.call(context);blit.onEnter.call({returnAddress:f.ptr(0x4e26cd)},untouched);assert.equal(untouched[7].n,0,'capture scope cleared');
}
const invalid=fixture(20,30,0,0),args=[invalid.ptr(24),invalid.ptr(800),invalid.ptr(600)];invalid.hooks.get(0x4e2670).onEnter.call({},args);assert.equal(args[1].n,800);
assert.equal(invalid.state.dpi,1);
console.log('PASS screenshot geometry: moved and resized client area, negative/multi-monitor coordinates, physical DPI context, scoped BitBlt and invalid rectangle');
