const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const memory=new Map(),hooks=new Map(),events=[];let allocation=0x100000,tid=1,hresult=0,format=22;
class Pointer{
 constructor(value){this.value=Number(value);}
 add(n){return new Pointer(this.value+n);}
 readPointer(){return new Pointer(memory.get(this.value)||0);}
 readU32(){return memory.get(this.value)||0;}
 readS32(){return this.readU32()|0;}
 toInt32(){return this.value|0;}
 isNull(){return this.value===0;}
 replace(n){this.value=Number(n);}
}
const ptr=x=>new Pointer(x),renderer=ptr(0x1000);
memory.set(0x1038,0x2000);memory.set(0x2000,0x3000);memory.set(0x3020,0x4000);
const context={ptr,send:x=>events.push(x),Process:{getCurrentThreadId:()=>tid,getModuleByName:()=>({getExportByName:()=>ptr(0)})},
 Memory:{alloc(n){const p=ptr(allocation);allocation+=n;return p;}},
 NativeFunction:function(address){return (...args)=>{
  if(address.value!==0x4000)return 0;
  const out=args[2];[3840,2160,60,format].forEach((v,i)=>memory.set(out.value+i*4,v));return hresult;
 };},Interceptor:{attach(p,h){hooks.set(p.value,h);}}};
vm.runInNewContext(fs.readFileSync('client/Launcher/window-size.js','utf8'),context);
function initialize(address,windowed,fn){
 memory.set(0x539f8c,windowed?0:1);
 const h=hooks.get(address),self={};h.onEnter.call(self,[ptr(800),ptr(600),ptr(windowed?1:0)]);
 try{fn();}finally{h.onLeave.call(self);}
}
function mode(original=0){const h=hooks.get(0x4040a0),self={context:{ecx:renderer}},result=ptr(original);
 h.onEnter.call(self,[ptr(800),ptr(600)]);h.onLeave.call(self,result);return result.value;}
assert.equal(mode(),0,'Calls outside window initialization are untouched');
for(const address of [0x416fd0,0x415e50]){
 initialize(address,true,()=>{
  assert.equal(mode(),22,'Missing 800x600 mode uses desktop format in windowed mode');
  assert.equal(mode(23),23,'Existing native format is preserved');
  tid=2;assert.equal(mode(),0,'Other threads cannot inherit windowed initialization');tid=1;
  hresult=-1;assert.equal(mode(),0,'Failed desktop mode queries are not used');hresult=0;
  format=0;assert.equal(mode(),0,'Invalid desktop format is rejected');format=22;
 });
 initialize(address,false,()=>assert.equal(mode(),0,'Fullscreen mode does not use this fallback'));
 assert.equal(mode(),0,'Initializer context is removed on return');
}
assert.equal(events.filter(x=>x.event==='windowed-display-format-fallback').length,2);
console.log('PASS: startup and game reinitialization missing-mode fallback; fullscreen, existing format, failed query and thread isolation.');
