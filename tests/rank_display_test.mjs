import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('client/Launcher/rank-display.js','utf8');
const bytes=new Map(),hooks=new Map(),events=[];
const ptr=a=>({value:Number(a),add:n=>ptr(Number(a)+n),writeS32:v=>bytes.set(Number(a),v)});
const gm=ptr(0x10000),context={ptr,send:e=>events.push(e),rpc:{exports:{}},
  KARMA_LAN_CONFIG:{local:{rank:{id:'lieutenant'}},peers:[{config:{rank:{id:'private'}}},{config:{rank:{id:'sergeant'}}}]},
  Interceptor:{attach:(p,h)=>hooks.set(p.value,h)}};
vm.runInNewContext(source,context);
const hook=hooks.get(0x420560),call={context:{ecx:gm}};
hook.onEnter.call(call);hook.onLeave.call(call,{toInt32:()=>1});
assert.equal(bytes.get(gm.value+0x18d8),8,'HUD must not retain hardcoded sergeant');
for(const [i,expected] of [8,1,4].entries()){
  assert.equal(bytes.get(gm.value+0xfc4+i*0x98),expected);
  assert.equal(bytes.get(gm.value+0xb04+i*0x98),expected);
}
for(const [id,expected] of Object.entries({recruit:0,private:1,corporal:3,sergeant:4,lieutenant:8})){
  context.rpc.exports.accountrank({id});hooks.get(0x451380).onEnter();
  assert.equal(bytes.get(gm.value+0x18d8),expected);
  assert.equal(bytes.get(gm.value+0xfc4),expected);
  assert.equal(bytes.get(gm.value+0xfc4+0x98),1,'promotion must not change another player');
}
assert.throws(()=>context.rpc.exports.accountrank({id:'admin'}),/Invalid/);
console.log('PASS native rank mapping: HUD, scoreboard, distinct peers and queued promotions.');
