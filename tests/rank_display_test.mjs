import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('client/Launcher/rank-display.js','utf8');
const bytes=new Map(),hooks=new Map(),events=[];
const ptr=a=>({value:Number(a),add:n=>ptr(Number(a)+n),writeS32:v=>bytes.set(Number(a),v)});
const gm=ptr(0x10000),context={ptr,send:e=>events.push(e),rpc:{exports:{}},
  KARMA_LAN_CONFIG:{equipmentCatalog:{inventoryCapacity:1500},local:{rank:{id:'lieutenant'}},peers:[{config:{rank:{id:'private'}}},{config:{rank:{id:'sergeant'}}}]},
  Interceptor:{attach:(p,h)=>hooks.set(p.value,h)}};
vm.runInNewContext(source,context);
const hook=hooks.get(0x420560),call={context:{ecx:gm}};
hook.onEnter.call(call);hook.onLeave.call(call,{toInt32:()=>1});
assert.equal(bytes.get(gm.value+0x18d8),8,'HUD must not retain hardcoded sergeant');
for(const [i,expected] of [8,1,4].entries()){
  assert.equal(bytes.get(gm.value+0xfc4+i*0x98),expected);
  assert.equal(bytes.get(gm.value+0xb04+i*0x98),expected);
}
// Verified against the original PE's 0x4c190c rank dispatch, not a
// contiguous server rank index (the server skips several enlisted ranks).
const ranks={recruit:0,private:1,corporal:3,sergeant:4,lieutenant:8,
  first_lieutenant:9,captain:10,major:11,lieutenant_colonel:12,colonel:13,
  brigadier_general:14,major_general:15,lieutenant_general:16,general:17};
for(const [id,expected] of Object.entries(ranks)){
  const previous=bytes.get(gm.value+0x18d8);
  context.rpc.exports.accountrank({id});
  assert.equal(bytes.get(gm.value+0x18d8),previous,'promotion waits for the game thread');
  hooks.get(0x451380).onEnter();
  assert.equal(bytes.get(gm.value+0x18d8),expected);
  assert.equal(bytes.get(gm.value+0xb04),expected);
  assert.equal(bytes.get(gm.value+0xfc4),expected);
  assert.equal(bytes.get(gm.value+0xfc4+0x98),1,'promotion must not change another player');
  assert.equal(context.KARMA_LAN_CONFIG.equipmentCatalog.inventoryCapacity,1500,'rank display must not invent a higher equipment budget');
}
context.KARMA_SET_PEER_RANK(3,{id:'corporal'});hooks.get(0x451380).onEnter();
assert.equal(bytes.get(gm.value+0xb04+3*0x98),3,'late entrant rank uses its native slot');
context.KARMA_SET_PEER_RANK(1,null);context.KARMA_SET_PEER_RANK(1,{id:'lieutenant'});hooks.get(0x451380).onEnter();
assert.equal(bytes.get(gm.value+0xfc4+0x98),8,'replacement rank updates without moving existing slots');
assert.equal(bytes.get(gm.value+0xfc4+2*0x98),4,'other peer rank remains stable');
for(const [id,expected] of Object.entries(ranks)){
  context.KARMA_SET_PEER_RANK(7,{id});hooks.get(0x451380).onEnter();
  assert.equal(bytes.get(gm.value+0xb04+7*0x98),expected,'highest roster slot supports every officer');
  assert.equal(bytes.get(gm.value+0xfc4+7*0x98),expected);
  assert.equal(bytes.get(gm.value+0x18d8),17,'peer changes do not change local general rank');
}
for(const rank of [null,{id:'admin'},{id:'marshal'},{id:'toString'},{id:'__proto__'},{id:18}]){
  assert.throws(()=>context.rpc.exports.accountrank(rank),/Invalid/);
  context.KARMA_SET_PEER_RANK(7,rank);hooks.get(0x451380).onEnter();
  assert.equal(bytes.get(gm.value+0xfc4+7*0x98),0,'unsupported peer rank falls back to recruit');
  assert.equal(bytes.get(gm.value+0x18d8),17,'rejected promotion does not change local rank');
}
for(const slot of [0,-1,8,1.5,'1'])assert.throws(()=>context.KARMA_SET_PEER_RANK(slot,{id:'general'}),/Invalid/);
const allowedWrites=new Set([gm.value+0x18d8,...Array.from({length:8},(_,i)=>[gm.value+0xb04+i*0x98,gm.value+0xfc4+i*0x98]).flat()]);
assert.equal(bytes.size,17,'only the local HUD and sixteen roster fields are written');
for(const [address,value] of bytes){
  assert.ok(allowedWrites.has(address),'rank display must not modify combat state');
  assert.ok(Number.isInteger(value)&&value>=0&&value<19,'all writes fit the verified native icon range');
}
context.rpc.exports.accountrank({id:'private'},1600);
assert.equal(context.KARMA_LAN_CONFIG.equipmentCatalog.inventoryCapacity,1600,'pickup hint budget updates on promotion');
context.rpc.exports.accountrank({id:'private'},null);
assert.equal(context.KARMA_LAN_CONFIG.equipmentCatalog.inventoryCapacity,1600,'missing capacity does not clear budget');
console.log('PASS native rank mapping: all 14 ranks, HUD, both scoreboards, queued promotions, peer slots and safe bounds.');
