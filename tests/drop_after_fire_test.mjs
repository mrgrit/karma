import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const harness=fs.readFileSync('tests/lan_game_test.mjs','utf8').split("const host=create('host')")[0].replace(/^import .*;\r?\n/gm,'');
const sandbox={fs,vm,assert,Uint8Array,ArrayBuffer,DataView,Buffer};
vm.runInNewContext(harness+'\nglobalThis.make=create;',sandbox);
for(const weapon of [9,14,21]){
 const inventory=weapon===21?[50,21,1,9,48,24,19]:[50,weapon,1,21,48,24,19];
 const c=sandbox.make('host',{localPlayerId:'local-player',remotePlayerId:'remote-player',local:{inventory,selectedWeapon:weapon}});
 c.shot(weapon);const fired=c.rpc.lanstatus().local.shot;
 assert.equal(fired.weapon,weapon);assert.equal(fired.id,1);
 c.p(0xd0000+0x62).writeU8(0x80);c.tick();
 const request=c.events.find(e=>e.message?.type==='drop-claim')?.message;assert(request,'G request');
 assert.equal(c.rpc.lanstatus().local.shot.id,1,'pending authority must preserve prior shot');
 const next=[...inventory];next[1]=255;
 c.rpc.lanreceive({version:1,type:'drop-grant',grant:{id:request.requestId,playerId:'local-player',life:1,
  weapon,removeSlot:1,selectedWeapon:1,inventory:next,drop:{id:'dropped-'+weapon,weapon,magazine:request.magazine,
  reserve:request.reserve,pos:c.rpc.lanstatus().local.pos,sector:c.rpc.lanstatus().local.sector}}});c.tick();
 const after=c.rpc.lanstatus().local;
 assert.equal(after.shot,undefined,'G acknowledgement must retire repeated shot of removed weapon '+weapon);
 assert.equal(after.shotSequence,1,'G must not rewind shot sequence');
 for(let n=0;n<4;n++)c.tick();
 const messages=c.events.filter(e=>e.message?.type==='state').map(e=>e.message);
 const retired=messages.findIndex(m=>!m.inventory.includes(weapon));assert(retired>=0);
 assert(messages.slice(retired).every(m=>m.shot===undefined),'post-grant state cannot advertise unowned historical shot');
 c.shot(1);const subsequent=c.rpc.lanstatus().local.shot;
 assert.equal(subsequent.weapon,1);assert.equal(subsequent.id,2,'next legitimate shot remains monotonic');
 console.log('PASS fire → G for weapon '+weapon+': history retired, sequence preserved, next weapon fires.');
}
