import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
// Reuse the real LAN adapter fixture without executing its unrelated scenarios.
const harness=fs.readFileSync('tests/lan_game_test.mjs','utf8').split("const host=create('host')")[0]
 .replace(/^import .*;\r?\n/gm,'').replace("name:'KarmaSession.exe'","name:'KarmaAIProbe.exe'")
 .replace('KARMA_LOCAL_PAUSED:false','KARMA_LOCAL_PAUSED:false,KARMA_PICKUP_TEST_INPUT:true');
const sandbox={fs,vm,assert,Uint8Array,ArrayBuffer,DataView,Buffer};
vm.runInNewContext(harness+'\nglobalThis.make=create;',sandbox);
const c=sandbox.make('host',{localPlayerId:'local-player',remotePlayerId:'remote-player',
 local:{inventory:[0,9,1,6,48,24,18],selectedWeapon:9},
 equipmentCatalog:{inventoryCapacity:1500,weapons:[{id:9,name:'MP38',cost:200},{id:10,name:'MP40',cost:400}]}});
const app=c.p(0xc0000),input=c.p(0xd0000);c.p(0x548d5c).writePointer(app);app.add(0x120).writePointer(input);
const claims=type=>c.events.filter(e=>e.message?.type===type).map(e=>e.message);
const key=(scan,held)=>input.add(0x40+scan).writeU8(held?0x80:0);
const drop={id:'manual-ground',weapon:10,magazine:2,reserve:5,pos:[-3846,400,-7446],sector:4};
const proximity=()=>c.leave(c.enter(0x452540,[c.p(10)],c.m,
 {returnAddress:c.p(0x4526b1),context:{ecx:c.m,ebx:c.p(0)}}),c.p(1));
c.rpc.lanreceive({version:1,type:'drop',drop});c.tick();
proximity();proximity();assert.equal(claims('pickup-claim').length,0,'proximity cannot auto-pickup');
assert(c.events.find(e=>e.event==='lan-loot-hint'&&e.message.includes('[E] MP40 · 2/5')&&e.ttlMs===900&&!e.message.includes('\n')));
key(0x12,true);c.tick();assert.equal(claims('pickup-claim').length,1,'E sends explicit pickup');
c.tick();proximity();assert.equal(claims('pickup-claim').length,1,'held E cannot repeat');
c.rpc.lanreceive({version:1,type:'pickup-denied',dropId:drop.id,reason:'loadout: budget exceeded'});c.tick();
assert(c.events.find(e=>e.event==='lan-loot-hint'&&e.message.includes('장비 조건 불충족')));
const ownedBefore=c.local.add(0x298+9*56).readS32();
c.local.add(0x2a4+9*56).writeS32(3);c.local.add(0x29c+9*56).writeS32(260);
key(0x12,false);key(0x22,true);c.tick();
assert.equal(claims('drop-claim').length,1,'G sends explicit discard');
const request=claims('drop-claim')[0];assert.equal(request.magazine,3);assert.equal(request.reserve,7);
assert.equal(c.local.add(0x298+9*56).readS32(),ownedBefore,'request does not remove gun before approval');
c.tick();assert.equal(claims('drop-claim').length,1,'held G cannot repeat');
const grant={id:request.requestId,playerId:'local-player',life:1,weapon:9,removeSlot:1,selectedWeapon:1,
 inventory:[0,255,1,6,48,24,18],drop:{...drop,id:'discard-9',weapon:9,magazine:3,reserve:7}};
c.rpc.lanreceive({version:1,type:'drop-grant',grant});c.tick();
assert.equal(c.local.add(0x298+9*56).readS32(),0);assert.equal(c.local.add(0x290).readU8(),1);
assert.equal(c.rpc.lanstatus().loadout.drops.length,2,'ack creates exact physical drop');
const count=c.calls.length;c.rpc.lanreceive({version:1,type:'drop-grant',grant});c.tick();
assert.equal(c.calls.length,count,'duplicate drop grant has no native mutations');
key(0x22,false);c.tick();proximity();c.context.KARMA_LOCAL_INPUT_PAUSED=true;key(0x12,true);key(0x22,true);c.tick();
assert.equal(claims('pickup-claim').length,1);assert.equal(claims('drop-claim').length,1,'pause suppresses both keys');
c.context.KARMA_LOCAL_INPUT_PAUSED=false;c.context.KARMA_PICKUP_TEST_INPUT=false;c.p(0x548d50).writePointer(c.p(0));key(0x12,false);key(0x22,false);c.tick();
proximity();key(0x12,true);key(0x22,true);c.tick();
assert.equal(claims('pickup-claim').length,1);assert.equal(claims('drop-claim').length,1,'unfocused game suppresses both keys');
c.context.KARMA_PICKUP_TEST_INPUT=true;key(0x12,false);key(0x22,false);c.tick();proximity();key(0x12,true);c.tick();
assert.equal(claims('pickup-claim').length,2,'release and new E retries after denial');
c.rpc.lanreceive({version:1,type:'pickup-grant',grant:{id:'manual-pickup',dropId:drop.id,playerId:'local-player',
 life:1,weapon:10,magazine:2,reserve:5,replaceSlot:1,replacedWeapon:255}});c.tick();
assert.equal(c.local.add(0x2a4+10*56).readS32(),2);assert.equal(c.local.add(0x29c+10*56).readS32(),258);
assert.equal(c.local.add(0x290).readU8(),10);assert.equal(c.rpc.lanstatus().loadout.drops.length,1);
for(const scan of [0x12,0x22]){const result=c.p(0x80);c.leave(c.enter(0x4a8330,[c.p(scan)]),result);assert.equal(result.toInt32(),0,'original E/G binding suppressed');}
console.log('PASS manual pickup: proximity hint only, explicit E, budget reason, G exact ammo and acknowledgement, duplicate/held-key guard, pause/focus guard, original binding suppression.');
