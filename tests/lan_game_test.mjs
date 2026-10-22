import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('native/lan_game_core.js','utf8')
 .replace('/*__MAPS__*/','const mapDefinitions='+JSON.stringify(JSON.parse(fs.readFileSync('client/Launcher/multiplayer-maps.json','utf8')).maps)+';')
 .replace('/*__TEST_DISPATCH__*/','const testNativeShotDispatch=null;')
 .replace('/*__LOADOUT__*/',fs.readFileSync('native/lan_loadout_game.js','utf8'));
const fixture=[];
function create(role,config={}){
 const bytes=new Map(),events=[],hooks=new Map(),calls=[];let time=1000000,allocation=0x70000;
 class Pointer{
  constructor(a){this.a=Number(a);}
  add(v){return new Pointer(this.a+v);}
  equals(v){return this.a===v.a;}
  isNull(){return this.a===0;}
  toInt32(){return this.a|0;}
  toUInt32(){return this.a>>>0;}
  toString(){return '0x'+this.a.toString(16);}
  replace(v){this.a=Number(v);}
  readByteArray(n){return Uint8Array.from({length:n},(_,i)=>bytes.get(this.a+i)||0).buffer;}
  writeByteArray(v){Array.from(v instanceof ArrayBuffer?new Uint8Array(v):v).forEach((x,i)=>bytes.set(this.a+i,x));}
  readU8(){return bytes.get(this.a)||0;}
  writeU8(v){bytes.set(this.a,v&255);}
  readU16(){return new DataView(this.readByteArray(2)).getUint16(0,true);}
  writeU16(v){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,v,true);this.writeByteArray(a);}
  readS32(){return new DataView(this.readByteArray(4)).getInt32(0,true);}
  readU32(){return this.readS32()>>>0;}
  writeS32(v){const a=new Uint8Array(4);new DataView(a.buffer).setInt32(0,v,true);this.writeByteArray(a);}
  writeU32(v){this.writeS32(v);}
  readFloat(){return new DataView(this.readByteArray(4)).getFloat32(0,true);}
  writeFloat(v){const a=new Uint8Array(4);new DataView(a.buffer).setFloat32(0,v,true);this.writeByteArray(a);}
  readPointer(){return new Pointer(this.readU32());}
  writePointer(v){this.writeU32(v.a);}
  readUtf8String(){let s='';for(let i=0;i<256&&this.add(i).readU8();i++)s+=String.fromCharCode(this.add(i).readU8());return s;}
  writeUtf8String(s){this.writeByteArray([...Buffer.from(s),0]);}
 }
 const p=a=>new Pointer(a),gm=p(0x10000),m=p(0x20000),local=p(0x30000),remote=p(0x40000),backend=p(0x50000),world=p(0x80000),worldData=p(0xa0000),projectiles=p(0xb0000);
 m.add(0xfcc).writePointer(local);m.add(0xfd0).writePointer(remote);m.add(0x1070).writeS32(2);
 m.add(0x1050).writePointer(local);m.add(0x104c).writePointer(backend);backend.add(0x36d).writeByteArray([7,8]);
 m.add(0xc).writePointer(world);world.add(0x1399c).writePointer(worldData);worldData.add(0x12c).writeS32(10);
 m.add(0x18).writePointer(projectiles);
 const app=p(0xc0000),input=p(0xd0000);p(0x548d5c).writePointer(app);app.add(0x120).writePointer(input);p(0x548d50).writePointer(p(0xf1000));
 gm.add(0xc).writePointer(m);gm.add(0x8e).writeUtf8String('guderian.chr');
 gm.add(0x12e).writeByteArray([0,9,6,28,19,23,24]);p(0x548d70).writeS32(1);
 for(const a of[local,remote]){
  a.add(0x264).writeS32(725);a.add(0x290).writeU8(9);a.add(0x1971).writeU8(4);a.add(0x1972).writeU8(13);
  a.add(0x1c78).writeFloat(1);
  a.add(0x1e60).writeByteArray(new Uint8Array(70).fill(255));
  for(let w=0;w<25;w++){
   a.add(0x2a0+w*56).writeU8(w===6?1:32);a.add(0x29c+w*56).writeS32(253);
  }
  a.add(0x298+9*56).writeS32(1);a.add(0x2a4+9*56).writeS32(32);a.add(0x29c+9*56).writeS32(381);
 }
 remote.add(0x262).writeU8(1);
 function pos(a,xyz,sector,yaw){xyz.forEach((v,i)=>a.add(0x1a40+i*4).writeFloat(v));a.add(0x1b44).writeS32(sector);
  a.add(0x1b4c).writeS32(sector);a.add(0x19b8).writeFloat(yaw);
  xyz.forEach((v,i)=>a.add(0x1c84+i*4).writeFloat(v+(i===1?300:0)));
 }
 const context={ptr:p,Process:{mainModule:{name:'KarmaSession.exe'},id:role==='host'?1:2,getModuleByName:()=>({getExportByName:()=>p(0xf0000)})},
  KARMA_LAN_CONFIG:{role,...config},KARMA_LOCAL_PAUSED:false,Date:{now:()=>time},send:e=>events.push(e),rpc:{exports:{}},
  Memory:{alloc(n){const r=p(allocation);allocation+=n;return r;},allocUtf8String(s){const r=p(allocation);allocation+=s.length+1;r.writeUtf8String(s);return r;}},
  Interceptor:{attach(address,h){const list=hooks.get(address.a)||[];list.push(h);hooks.set(address.a,list);}},
  NativeFunction:function(address){return (...args)=>{
   if(address.a===0xf0000)return p(0xf1000);
   calls.push([address.a,...args]);
   const actor=args[0];
   switch(address.a){
    case 0x44fd00:{
     const a=args[1]===0?local:remote;
     for(let w=0;w<52;w++){a.add(0x298+56*w).writeS32(0);a.add(0x2a4+56*w).writeS32(0);a.add(0x29c+56*w).writeS32(253);}
     a.add(0x1e60).writeByteArray(new Uint8Array(70).fill(255));
     for(let i=0;i<7;i++){
      const w=args[3].add(i).readU8();a.add(0x1e60+10*i).writeU8(w);if(w===255)continue;
      if(w===48){a.add(0x1ef4).writeS32(1);continue;}
      a.add(0x298+56*w).writeS32(1);a.add(0x2a4+56*w).writeS32(a.add(0x2a0+56*w).readU8());
      a.add(0x29c+56*w).writeS32(381);
     }break;
    }
    case 0x45e700:actor.add(0x290).writeU8(args[1]);break;
    case 0x452540:{
     const keys=local.add(0x1e60),w=args[1];
     for(let i=0;i<70;i++)if(keys.add(i).readU8()===w)return 1;
     for(let i=0;i<70;i++)if(keys.add(i).readU8()===255){keys.add(i).writeU8(w);return 1;}
     return 0;
    }
    case 0x4622d0:{
     const o=args[1]*56;actor.add(0x298+o).writeS32(1);
     actor.add(0x2a4+o).writeS32(32);actor.add(0x29c+o).writeS32(381);break;
    }
    case 0x46fe60:return args[1]>0&&args[1]<25?args[1]:-1;
    case 0x4523b0:{
     for(let i=0;i<40;i++){const d=m.add(0xb0+i*0x5c);if(d.readU8())continue;
      d.writeU8(1);d.add(1).writeU8(args[1]&63);args.slice(2,5).forEach((v,j)=>d.add(4+j*4).writeFloat(v));d.add(0x10).writeS32(args[8]);break;}
     break;
    }
    case 0x451bd0:{
     if(args[2]===6){const r=projectiles;r.add(0x8900).writeS32(1);r.add(0x8950).writeU8(6);r.add(0x8951).writeU8(args[1]);}
     break;
    }
    case 0x44a4c0:pos(args[1]===0?local:remote,args.slice(3,6),args[2],args[6]*Math.PI/180);break;
    case 0x44afd0:remote.add(0x19b8).writeFloat(args[2]);break;
    case 0x45e3a0:actor.add(0x264).writeS32(725);break;
    case 0x464160:actor.add(0x290).writeU8(args[1]);break;
    case 0x444ac0:return 4;
    case 0x463100:actor.add(0x1971).writeU8(args[1]);break;
    case 0x462560:actor.add(0x1972).writeU8(args[1]);break;
    case 0x461ae0:case 0x461d50:actor.add(0x264).writeS32(Math.max(625,actor.add(0x264).readS32()-40));break;
    case 0x461e50:actor.add(0x264).writeS32(Math.max(625,actor.add(0x264).readS32()-args[2]));break;
    case 0x422e00:{
     const attacker=args[1].add(2).readU8(),victim=args[1].add(3).readU8(),k=actor.add(0x1458+attacker*16),d=actor.add(0x1460+victim*16);
     k.writeS32(k.readS32()+1);d.writeU16(d.readU16()+1);backend.add(0x36d+victim).writeU8(1);break;
    }
   }
   return 0;
  };}
 };
 vm.createContext(context);vm.runInContext(source,context);
 function enter(address,args=[],ecx=m,extra={}){return (hooks.get(address)||[]).map(h=>{const self={context:{ecx,...extra.context},returnAddress:p(0),...extra};h.onEnter?.call(self,args);return {h,self};});}
 function leave(frames,ret=p(1)){for(const {h,self}of frames)h.onLeave?.call(self,ret);}
 leave(enter(0x420560,[],gm));
 const f=v=>{const a=new DataView(new ArrayBuffer(4));a.setFloat32(0,v,true);return p(a.getUint32(0,true));};
 const initialArgs=[p(0),p(4),f(-3846),f(400),f(-7446),f(0),p(0)];
 const initial=enter(0x44a4c0,initialArgs);
 const fv=v=>{const a=new DataView(new ArrayBuffer(4));a.setUint32(0,v.a,true);return a.getFloat32(0,true);};
 pos(local,initialArgs.slice(2,5).map(fv),initialArgs[1].a,fv(initialArgs[5]));leave(initial);
 function tick(){
  time+=100;const frames=enter(0x451380);
  // Model the native type6 receiver's movement after the adapter enqueues it.
  if(remote.add(0x1bd4).readS32()){
   const xyz=[0,4,8].map(i=>remote.add(0x1bf8+i).readFloat());xyz[1]-=remote.add(0x1be8).readU16();
   pos(remote,xyz,remote.add(0x1be6).readU8(),remote.add(0x1bf0).readFloat());remote.add(0x1bd4).writeS32(0);
  }
  leave(frames);
 }
 for(let i=0;i<17;i++)tick();
 return {context,rpc:context.rpc.exports,events,calls,local,remote,m,gm,backend,tick,enter,leave,p,
  outbound(){const messages=events.splice(0).filter(x=>x.event==='lan-outbound').map(x=>JSON.parse(JSON.stringify(x.message)));
   fixture.push(...messages);return messages;},
  shot(weapon=9,hit=18){const args=[p(0),p(weapon),f(0),f(700),f(0),f(1),f(0),f(0),p(4),p(4),f(0),f(0),p(1000)];
   const frames=enter(0x451bd0,args);m.add(0x10ac).writeS32(1);m.add(0x10a8).writeU8(hit);leave(frames);
  }
 };
}
const host=create('host'),join=create('join');
assert.deepEqual(JSON.parse(JSON.stringify(join.rpc.lanstatus().local.pos)),[5315,400,-8272]);
assert.deepEqual(JSON.parse(JSON.stringify(host.rpc.lanstatus().local.pos)),[-3846,400,-7446]);
function deliver(from,to){for(const x of from.outbound())to.rpc.lanreceive(x);to.tick();}
deliver(host,join);deliver(join,host);deliver(host,join);
assert.equal(host.rpc.lanstatus().remoteLife,1);
assert.equal(join.rpc.lanstatus().remoteLife,1);
host.shot();deliver(host,join);
assert.equal(join.local.add(0x264).readS32(),685);
assert.equal(join.rpc.lanstatus().receivedHits,1);
// A repeated hit ID cannot apply twice, nor can a previous-life hit.
const duplicate={version:1,type:'hit',life:1,seq:999,id:1,victimLife:1,weapon:9,kind:'bullet',region:1,direction:[1,0,0],armorPierce:0};
join.rpc.lanreceive(duplicate);join.tick();assert.equal(join.local.add(0x264).readS32(),685);
join.context.KARMA_LOCAL_PAUSED=true;
join.context.KARMA_LOCAL_INPUT_PAUSED=true;
host.shot();deliver(host,join);host.shot();deliver(host,join);
assert.equal(join.rpc.lanstatus().localDead,true,'Menu must not prevent native damage');
deliver(join,host);
assert.equal(host.gm.add(0x1458).readS32(),1);assert.equal(host.gm.add(0x1470).readU16(),1);
assert.equal(join.gm.add(0x1460).readU16(),1);assert.equal(join.gm.add(0x1468).readS32(),1);
join.rpc.lanreceive({...duplicate,id:2});join.tick();
assert.equal(join.rpc.lanstatus().receivedHits,3);
// Offline helper restores local HP; adapter increments life and sends respawn.
join.local.add(0x264).writeS32(725);join.tick();deliver(join,host);
assert.equal(join.rpc.lanstatus().life,2);assert.equal(host.rpc.lanstatus().remoteLife,2);
join.rpc.lanreceive({...duplicate,id:99,victimLife:1});join.tick();
assert.equal(join.local.add(0x264).readS32(),725);
// New projectile state replays exactly once despite ordinary repeated states.
host.shot(6);deliver(host,join);const shots=join.rpc.lanstatus().remoteShots;
host.tick();deliver(host,join);assert.equal(join.rpc.lanstatus().remoteShots,shots);
assert(join.calls.some(c=>c[0]===0x451bd0&&c[3]===6));
assert.equal(join.m.add(0x1064).readS32(),0);assert(join.m.add(0x1050).readPointer().equals(join.local));
assert.deepEqual([...new Uint8Array(join.backend.add(0x36d).readByteArray(2))],[7,8]);
assert.throws(()=>host.rpc.placeLocal([0,0,0],4,0),/test-process-only/);
assert.throws(()=>host.rpc.queueNativeShot(9),/test-process-only/);
assert.throws(()=>host.rpc.lanreceive({...duplicate,region:50}),/Invalid/);
assert.throws(()=>host.rpc.lanreceive({...duplicate,direction:[NaN,0,0]}),/Invalid/);
const beforePos=JSON.stringify(join.rpc.lanstatus().remoteActual.pos);
join.rpc.lanreceive({...host.rpc.lanstatus().local,version:1,type:'state',life:1,seq:9999,sector:99});
join.tick();assert.equal(JSON.stringify(join.rpc.lanstatus().remoteActual.pos),beforePos);
const nextPose={...join.rpc.lanstatus().local,version:1,type:'state',life:2,weapon:50};
for(let i=0;i<400;i++)host.rpc.lanreceive({...nextPose,seq:10000+i});
assert.equal(host.rpc.lanstatus().queue,1,'Adjacent ordinary states must coalesce during loading');
host.tick();assert.equal(host.rpc.lanstatus().remoteActual.weapon,50,'Auxiliary equipment state must survive replication');
assert.equal(join.rpc.lanstatus().local.paused,true,'LAN input-menu state is separate from world pause');
fs.writeFileSync('tests/generated-messages.json',JSON.stringify(fixture,null,2));
console.log('PASS: separate initial spawns; two-peer native hit/death/KD/respawn; hit dedup and stale-life rejection; damage during menu; projectile dedup and context restore; sector bounds; test RPC guard.');
const loadout=create('host',{localPlayerId:'local-player',remotePlayerId:'remote-player',
 local:{inventory:[50,9,1,6,48,24,18],selectedWeapon:1}});
assert.equal(loadout.rpc.lanstatus().local.weapon,1,'configured starting weapon uses native equip');
assert.deepEqual(JSON.parse(JSON.stringify(loadout.rpc.lanstatus().local.inventory)),[50,9,1,6,48,24,18]);
const drop={id:'drop-1',weapon:10,magazine:2,reserve:5,pos:[-3846,550,-7506],sector:4};
loadout.rpc.lanreceive({version:1,type:'drop',drop});loadout.tick();
assert.equal(loadout.rpc.lanstatus().loadout.drops[0].index,0);
const savedKeys=[...new Uint8Array(loadout.local.add(0x1e60).readByteArray(70))];
const frames=loadout.enter(0x452540,[loadout.p(10)],loadout.m,{returnAddress:loadout.p(0x4526b1),context:{ecx:loadout.m,ebx:loadout.p(0)}});
loadout.local.add(0x1e61).writeU8(10);
const retval=loadout.p(1);loadout.leave(frames,retval);
assert.equal(retval.toInt32(),0);
assert.deepEqual([...new Uint8Array(loadout.local.add(0x1e60).readByteArray(70))],savedKeys);
assert.equal(loadout.events.filter(e=>e.message?.type==='pickup-claim').length,0,'native proximity cannot auto-pickup');
loadout.p(0xd0000+0x52).writeU8(0x80);loadout.tick();
assert.equal(loadout.events.filter(e=>e.message?.type==='pickup-claim').length,1,'E sends one explicit claim');
loadout.leave(loadout.enter(0x452540,[loadout.p(10)],loadout.m,{returnAddress:loadout.p(0x4526b1),context:{ecx:loadout.m,ebx:loadout.p(0)}}),loadout.p(1));
assert.equal(loadout.events.filter(e=>e.message?.type==='pickup-claim').length,1,'pending claim deduplicates');
const grant={id:'grant-1',dropId:'drop-1',playerId:'local-player',life:1,weapon:10,magazine:2,reserve:5,replaceSlot:7,replacedWeapon:255};
loadout.rpc.lanreceive({version:1,type:'pickup-grant',grant});loadout.tick();
assert.equal(loadout.local.add(0x2a4+10*56).readS32(),2);
assert.equal(loadout.local.add(0x29c+10*56).readS32(),258);
assert.equal(loadout.local.add(0x290).readU8(),10);
assert.deepEqual(JSON.parse(JSON.stringify(loadout.rpc.lanstatus().local.inventory)),[50,9,1,6,48,24,18,10]);
assert.equal(loadout.rpc.lanstatus().loadout.drops.length,0);
const callCount=loadout.calls.filter(c=>c[0]===0x4622d0).length;
loadout.rpc.lanreceive({version:1,type:'pickup-grant',grant});loadout.tick();
assert.equal(loadout.calls.filter(c=>c[0]===0x4622d0).length,callCount,'grant cannot award twice');
loadout.rpc.lanreceive({version:1,type:'pickup-grant',grant:{...grant,id:'grant-zero',dropId:'drop-zero',magazine:0,reserve:0,replacedWeapon:10}});
loadout.tick();
assert.equal(loadout.local.add(0x2a4+10*56).readS32(),0);
assert.equal(loadout.local.add(0x29c+10*56).readS32(),253);
loadout.rpc.lanreceive({version:1,type:'pickup-grant',grant:{...grant,id:'grant-stale',life:2,magazine:10,replacedWeapon:10}});
loadout.tick();assert.equal(loadout.local.add(0x2a4+10*56).readS32(),0,'future-life grant refused');
loadout.rpc.lanreceive({version:1,type:'drop-removed',dropId:'drop-late'});
loadout.rpc.lanreceive({version:1,type:'drop',drop:{...drop,id:'drop-late'}});loadout.tick();
assert.equal(loadout.rpc.lanstatus().loadout.drops.length,0,'late create cannot resurrect removed drop');
loadout.rpc.lanreceive({...duplicate,id:7});loadout.tick();
const proof=loadout.events.find(e=>e.event==='lan-damage-proof')?.proof;
assert.equal(proof.shotId,7);assert.equal(proof.attackerId,'remote-player');assert.equal(proof.victimLife,1);
loadout.rpc.lanreceive({version:1,type:'state',life:1,seq:2000,pos:[-3846,400,-8446],yaw:0,pitch:0,
 sector:4,weapon:6,hp:100,shot:{id:81,life:1,weapon:6,origin:[-3846,700,-8446],
 direction:[0,0,1],sector:4,renderSector:4,yaw:0,pitch:0}});
loadout.tick();
const collision=loadout.p(0xe0000);collision.add(4).writePointer(loadout.m.add(0x18).readPointer());
const blast=loadout.enter(0x4570e0,[loadout.p(0),loadout.p(0)],collision);
loadout.local.add(0x264).writeS32(625);loadout.leave(blast);
const blastProof=loadout.events.filter(e=>e.event==='lan-damage-proof').at(-1)?.proof;
assert.equal(blastProof.shotId,81);assert.notEqual(blastProof.id,proof.id);assert.equal(blastProof.weapon,6);assert.equal(blastProof.attackerId,'remote-player');
const death=loadout.events.filter(e=>e.message?.type==='death').at(-1)?.message;
assert.equal(death.damageId,blastProof.id);assert.equal(death.hpAfter,0);
assert.equal(death.drop.selectedWeapon,10);assert.equal(death.drop.magazine,0);assert.equal(death.drop.reserve,0);
console.log('PASS: configured seven-slot inventory/equip; native claim gate and pending dedup; appended grant; exact zero ammo; duplicate/stale grants; removal-before-create; bullet/projectile damage proof; exact death drop snapshot.');

const initialPositions=roomId=>Array.from({length:8},(_,slot)=>JSON.stringify(create('host',{slot,match:{mode:'dm',roomId}}).rpc.lanstatus().local.pos));
const firstRoom=initialPositions('room-alpha');
assert.equal(new Set(firstRoom).size,8,'All eight initial DM spawns must be distinct');
assert.deepEqual(initialPositions('room-alpha'),firstRoom,'All clients agree on one room permutation');
assert.notDeepEqual(initialPositions('room-beta'),firstRoom,'A new room changes initial positions');
console.log('PASS: room-specific random initial deathmatch spawns without overlap.');

// A late entrant receives a stripped baseline, then live states may still carry
// the previous shot. It must replay only shots newer than that baseline.
const lateShot=create('host');
const baseline={...host.rpc.lanstatus().local,version:1,type:'state',life:1,seq:1,shotSequence:40};delete baseline.shot;
lateShot.rpc.lanreceive(baseline);lateShot.tick();
const oldShot={id:40,life:1,weapon:6,origin:[0,700,0],direction:[1,0,0],sector:4,renderSector:4,yaw:0,pitch:0};
lateShot.rpc.lanreceive({...baseline,seq:2,shot:oldShot});lateShot.tick();
assert.equal(lateShot.rpc.lanstatus().remoteShots,0,'Old retained shot must not replay after late-join snapshot');
lateShot.rpc.lanreceive({...baseline,seq:3,shotSequence:41,shot:{...oldShot,id:41}});lateShot.tick();
assert.equal(lateShot.rpc.lanstatus().remoteShots,1,'New shot after join must replay once');
console.log('PASS late-join shot baseline suppresses historical shots and preserves new fire.');

// Point is an encoded profile value consumed by the actual Shift row renderer,
// distinct from K/D and the account's rank. Only server-confirmed values change it.
const pointGame=create('host',{localPlayerId:'points-host',remotePlayerId:'points-guest',central:true,
 local:{settings:{build:'karma290-central5'}}});
assert.equal(pointGame.gm.add(0xfc8).readS32(),12345,'Local Point starts at encoded zero');
assert.equal(pointGame.gm.add(0xfc8+0x98).readS32(),12345,'Remote Point starts at encoded zero');
pointGame.gm.add(0xfc4).writeS32(8);pointGame.gm.add(0x145c).writeS32(777);
const pointSnapshot={version:1,type:'match-snapshot',remainingSeconds:599,players:[
 {playerId:'points-host',kills:1,deaths:0,points:25},
 {playerId:'points-guest',kills:0,deaths:1,points:5}]};
pointGame.rpc.lanreceive(pointSnapshot);pointGame.tick();
assert.equal(pointGame.gm.add(0xfc8).readS32(),12370);
assert.equal(pointGame.gm.add(0xfc8+0x98).readS32(),12350);
assert.equal(pointGame.gm.add(0xfc4).readS32(),8,'Point update preserves account rank');
assert.equal(pointGame.gm.add(0x145c).readS32(),777,'Do not write the guessed adjacent K/D word');
assert.deepEqual(JSON.parse(JSON.stringify(pointGame.rpc.lanstatus().scores.map(p=>[p.kills,p.deaths,p.points]))),[[1,0,25],[0,1,5]]);
pointGame.rpc.lanreceive(pointSnapshot);pointGame.tick();
assert.equal(pointGame.gm.add(0xfc8).readS32(),12370,'Repeated snapshot does not add XP again');
pointGame.rpc.lanreceive({...pointSnapshot,players:[{playerId:'points-host',kills:2,deaths:1,points:55}]});pointGame.tick();
assert.equal(pointGame.rpc.lanstatus().scores[0].points,55,'Later confirmed total replaces the prior Point');
for(const points of [-1,1.5,NaN,Infinity,1000000001]){
 assert.throws(()=>pointGame.rpc.lanreceive({...pointSnapshot,players:[{playerId:'points-host',kills:0,deaths:0,points}]}),/Invalid/);
}
pointGame.rpc.lanreceive({...pointSnapshot,players:[{playerId:'points-host',kills:2,deaths:1}]});pointGame.tick();
assert.equal(pointGame.rpc.lanstatus().scores[0].points,55,'Legacy snapshot cannot erase a confirmed Point');
console.log('PASS encoded native Point initialization, server snapshot mapping, exact/idempotent totals, bounds and rank/KD-field separation.');
