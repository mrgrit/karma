const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
let hook;const events=[];
class Pointer{
  constructor(n){this.value=Number(n);}
  toInt32(){return this.value|0;}
  toString(){return '0x'+this.value.toString(16);}
  replace(n){this.value=Number(n);}
}
const ptr=n=>new Pointer(n);
const context={Set,send:x=>events.push(x),Process:{getModuleByName(name){
  assert.equal(name,'gdi32.dll');return {getExportByName(name){assert.equal(name,'GetDeviceCaps');return ptr(0x70000000);}};
}},Interceptor:{attach(address,h){assert.equal(address.value,0x70000000);hook=h;}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../client/Launcher/native-font.js'),'utf8'),context);
function query(caller,index,dpi){
  const invocation={returnAddress:ptr(caller)},result=ptr(dpi);
  hook.onEnter.call(invocation,[ptr(123),ptr(index)]);hook.onLeave.call(invocation,result);return result.value;
}
for(const dpi of [96,120,144,192,288]){
  for(const caller of [0x40123f,0x426dd1,0x426e26,0x477cdc,0x480ba6,0x4b9f6e,0x4b9fbb]){
    assert.equal(query(caller,90,dpi),96,'Native font metrics use the original game surface density');
    assert.equal(query(caller,88,dpi),dpi,'Even font callers retain LOGPIXELSX and other device caps');
  }
  assert.equal(query(0x4190d0,90,dpi),dpi,'Non-font game DPI queries stay unchanged');
  assert.equal(query(0x70001234,90,dpi),dpi,'Queries from other modules stay unchanged');
}
assert.equal(query(0x426dd1,90,0),0,'Failed native query remains failed');
assert.equal(query(0x426dd1,90,-1),-1,'Negative native failure stays unchanged');
assert.equal(events.filter(x=>x.event==='native-font-dpi').length,7,'Diagnostics are bounded to one per font call site');
assert.equal(events.filter(x=>x.event==='native-font-ready').length,1);
// Separate nested invocations cannot accidentally normalize a foreign query.
const font={returnAddress:ptr(0x426dd1)},foreign={returnAddress:ptr(0x70001234)};
hook.onEnter.call(font,[ptr(123),ptr(90)]);hook.onEnter.call(foreign,[ptr(123),ptr(90)]);
const foreignResult=ptr(192),fontResult=ptr(192);
hook.onLeave.call(foreign,foreignResult);hook.onLeave.call(font,fontResult);
assert.equal(foreignResult.value,192);assert.equal(fontResult.value,96);
console.log('PASS: native font DPI normalization at 100–300% scale; non-font/device queries, failures and nested invocation isolation.');
