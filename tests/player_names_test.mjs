import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('client/Launcher/player-names.js','utf8');
const memory=Buffer.alloc(0x50000),hooks=new Map();let allocation=0x30000;
function ptr(n){return {value:Number(n),add:x=>ptr(Number(n)+x),isNull:()=>!Number(n),
 readPointer:()=>ptr(memory.readUInt32LE(Number(n))),
 writeByteArray:value=>Buffer.from(value).copy(memory,Number(n)),
 readByteArray:count=>Uint8Array.from(memory.subarray(Number(n),Number(n)+count)).buffer};}
const allocate=size=>{const p=ptr(allocation);allocation+=size;return p;};
const encoded=string=>Buffer.from([...string].flatMap(c=>c==='한'?[0xc7,0xd1]:c==='글'?[0xb1,0xdb]:[c.charCodeAt(0)]));
const context={ptr,send(){},rpc:{exports:{}},
 Process:{getModuleByName:()=>({getExportByName:()=>ptr(1)})},
 Memory:{alloc:allocate,allocUtf16String:name=>{const data=Buffer.from(name+'\0','utf16le'),p=allocate(data.length);p.writeByteArray(data);return p;}},
 NativeFunction:function(){return (page,flags,wide,length,out,capacity)=>{
   assert.equal(page,949);assert.equal(length,-1);assert.equal(capacity,256);
   let end=wide.value;while(memory.readUInt16LE(end)!==0)end+=2;
   const bytes=Buffer.concat([encoded(memory.subarray(wide.value,end).toString('utf16le')),Buffer.from([0])]);out.writeByteArray(bytes);return bytes.length;
 }},Interceptor:{attach:(p,h)=>hooks.set(p.value,h)},
 KARMA_LAN_CONFIG:{local:{character:{name:'한글 Host'}},peers:[{config:{character:{name:'Guest'}}}]}};
const gm=ptr(0x1000),manager=ptr(0x5000),actors=[ptr(0x10000),ptr(0x15000)];
memory.writeUInt32LE(manager.value,gm.value+12);actors.forEach((p,i)=>memory.writeUInt32LE(p.value,manager.value+0xfcc+4*i));
memory.fill(0x58,gm.value+0x166,gm.value+0x366);
vm.runInNewContext(source,context);
const hook=hooks.get(0x420560),call={context:{ecx:gm}};hook.onEnter.call(call);hook.onLeave.call(call,{toInt32:()=>1});
for(const [index,name] of ['한글 Host','Guest'].entries())for(const start of [gm.value+0x166+index*256,actors[index].value+0x160]){
 const bytes=encoded(name);assert.deepEqual(memory.subarray(start,start+bytes.length),bytes);
 assert.equal(memory[start+bytes.length],0);assert.equal(memory[start+255],0);
}
context.KARMA_WRITE_PLAYER_NAME(gm.add(0x266),'한글 New');
assert.deepEqual(memory.subarray(gm.value+0x266,gm.value+0x26a),encoded('한글'),'late entrants retain Korean bytes');
assert.equal(memory[gm.value+0x166],0xc7,'replacing a peer leaves local name intact');
context.KARMA_WRITE_PLAYER_NAME(gm.add(0x266),'a'.repeat(500));
assert.equal(memory[gm.value+0x266+32],0,'bounded to account name length');
console.log('PASS native names: separate roster/actor records, Korean CP949, late entrants, bounded writes.');
