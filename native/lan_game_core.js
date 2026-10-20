// Two-player LAN adapter for the original Karma290 actor and weapon engine.
// Native operations run only from game-thread interceptors. Node owns transport.
(()=>{
'use strict';
const P=a=>ptr(a),processName=Process.mainModule.name.toLowerCase();
if(!['karmasession.exe','karmaaiprobe.exe'].includes(processName))throw new Error('LAN refuses '+processName);
const cfg=globalThis.KARMA_LAN_CONFIG||{};
if(!['host','join'].includes(cfg.role))throw new Error('LAN role must be host or join');
const clockOrigin=Date.now(),now=()=>Math.max(1,Date.now()-clockOrigin);
const bits=new DataView(new ArrayBuffer(4));
function floatBits(v){bits.setFloat32(0,v,true);return bits.getUint32(0,true);}
function argFloat(v){bits.setUint32(0,v.toUInt32(),true);return bits.getFloat32(0,true);}
function copy(d,s,n){d.writeByteArray(s.readByteArray(n));}
function vec(p,o){return [0,4,8].map(i=>p.add(o+i).readFloat());}
function putvec(p,o,v){v.forEach((x,i)=>p.add(o+i*4).writeFloat(x));}
function hp(p){return p.add(0x264).readS32()-625;}
function finite(v,limit=1e6){return Number.isFinite(v)&&Math.abs(v)<=limit;}
function vector(v){return Array.isArray(v)&&v.length===3&&v.every(x=>finite(x));}
function integer(v,min,max){return Number.isInteger(v)&&v>=min&&v<=max;}
function idValid(v){return (Number.isSafeInteger(v)&&v>=0)||(typeof v==='string'&&v.length>0&&v.length<=96);}
const nativePlace=new NativeFunction(P(0x44a4c0),'void',['pointer','int','int','float','float','float','float','int'],'thiscall');
const nativeYaw=new NativeFunction(P(0x44afd0),'void',['pointer','int','float'],'thiscall');
const nativeDamage=new NativeFunction(P(0x461ae0),'int',['pointer','int','int','int','float','float','float','int','int','int'],'thiscall');
const nativePellets=new NativeFunction(P(0x461d50),'int',['pointer','int','int','int','float','float','float','int','int'],'thiscall');
const nativeSimpleDamage=new NativeFunction(P(0x461e50),'void',['pointer','int','int','int'],'thiscall');
const nativeReset=new NativeFunction(P(0x45e3a0),'void',['pointer'],'thiscall');
const nativeInventory=new NativeFunction(P(0x44fd00),'void',['pointer','int','int','pointer','int'],'thiscall');
const nativeStance=new NativeFunction(P(0x463dd0),'void',['pointer','int'],'thiscall');
const nativeBody=new NativeFunction(P(0x463100),'void',['pointer','int'],'thiscall');
const nativeWeaponAction=new NativeFunction(P(0x462560),'void',['pointer','int'],'thiscall');
const nativeSelectWeapon=new NativeFunction(P(0x464160),'void',['pointer','int'],'thiscall');
const nativeRefreshModel=new NativeFunction(P(0x45e6c0),'void',['pointer'],'thiscall');
const nativeRefreshPosition=new NativeFunction(P(0x45ec00),'void',['pointer'],'thiscall');
const nativeHitscan=new NativeFunction(P(0x451bd0),'void',['pointer','int','int','float','float','float','float','float','float','int','int','float','float','uint'],'thiscall');
const nativeFireEffects=new NativeFunction(P(0x461150),'void',['pointer'],'thiscall');
const nativeKD=new NativeFunction(P(0x422e00),'void',['pointer','pointer'],'thiscall');
const nativeSort=new NativeFunction(P(0x423980),'void',['pointer'],'thiscall');
const projectileWeapons=new Set([4,6,18,19,21,22,23,24,37,38]);
const pelletWeapons=new Set([28,29,30]);
const st={gm:null,m:null,p:null,r:null,localPlaced:false,placedAt:0,ready:false,firstTick:0,
 life:1,remoteLife:0,seq:0,remoteSeq:-1,remoteDead:false,localDead:false,lastState:0,lastLog:0,
 shotSequence:0,lastShot:null,remoteShotIds:new Set(),hitIds:new Set(),deathIds:new Set(),
 queue:[],latestRemote:null,renderCalls:0,hitHooks:0,sentHits:0,receivedHits:0,remoteShots:0,scoreEvents:0,
 placement:null,testShot:null,testPending:null,testSerial:0,remotePaused:false,closed:false};
const scorePacket=Memory.alloc(6),blastStack=[];
/*__LOADOUT__*/
function emit(message){send({event:'lan-outbound',message:{version:1,life:st.life,seq:++st.seq,...message}});}
function boundedRemember(set,key){if(set.has(key))return false;set.add(key);if(set.size>512)set.delete(set.values().next().value);return true;}
function remoteConfig(){return cfg.remoteHello?.config||cfg.remote||{};}
function sectorCount(){
 if(!st.m)return 0;
 const world=st.m.add(0xc).readPointer();
 if(world.isNull())return 0;
 const data=world.add(0x1399c).readPointer();
 return data.isNull()?0:data.add(0x12c).readS32();
}
function safeSector(sector){return integer(sector,0,255)&&sector<sectorCount();}
function validPose(x){
 return vector(x.pos)&&finite(x.yaw,1e4)&&finite(x.pitch,2)&&integer(x.sector,0,255)&&
 integer(x.weapon,0,50)&&integer(x.hp,0,100)&&
 (x.eyeHeight===undefined||finite(x.eyeHeight,1000)&&x.eyeHeight>=30)&&
 (x.stance===undefined||integer(x.stance,0,3))&&
 (x.body===undefined||integer(x.body,0,31))&&
 (x.weaponAnim===undefined||integer(x.weaponAnim,0,31));
}
function validShot(x){
 return x&&idValid(x.id)&&integer(x.life,1,1e9)&&integer(x.weapon,0,50)&&vector(x.origin)&&
 vector(x.direction)&&Math.hypot(...x.direction)>.1&&Math.hypot(...x.direction)<2&&
 integer(x.sector,0,255)&&integer(x.renderSector,0,255)&&finite(x.yaw,1e4)&&finite(x.pitch,2);
}
function validate(x){
 if(!x||x.version!==1||typeof x.type!=='string')return false;
 if(x.type==='drop')return validDrop(x.drop);
 if(x.type==='pickup-grant')return validGrant(x.grant);
 if(x.type==='drop-removed'||x.type==='pickup-denied')return idValid(x.dropId);
 if(x.type==='pause')return typeof x.paused==='boolean';
 if(x.type==='leave')return true;
 if(!integer(x.life,1,1e9)||!Number.isSafeInteger(x.seq)||x.seq<0)return false;
 if(x.type==='state'||x.type==='respawn')return validPose(x)&&(!x.shot||validShot(x.shot));
 if(x.type==='death')return ['remote','self','environment'].includes(x.killer)&&integer(x.weapon,-1,38);
 if(x.type==='hit')return ['bullet','pellets'].includes(x.kind)&&idValid(x.id)&&
  integer(x.victimLife,1,1e9)&&integer(x.weapon,0,38)&&vector(x.direction)&&
  (x.kind==='bullet'?integer(x.region,0,14):integer(x.count,1,10))&&
  (x.armorPierce===undefined||integer(x.armorPierce,0,1));
 return false;
}
function scores(){return st.gm?[0,1].map(slot=>({slot,kills:st.gm.add(0x1458+slot*16).readS32(),deaths:st.gm.add(0x1460+slot*16).readU16()})):null;}
function countDeath(victim,life,killer,weapon){
 const key=victim+':'+life;
 if(!boundedRemember(st.deathIds,key)||!st.gm)return;
 const attacker=killer==='remote'?1-victim:-1,backend=st.m.add(0x104c).readPointer();
 if(attacker>=0&&!backend.isNull()){
  const saved=backend.add(0x36d).readByteArray(2);
  scorePacket.writeByteArray([1,1,attacker,victim,0,weapon&255]);
  try{nativeKD(st.gm,scorePacket);}finally{backend.add(0x36d).writeByteArray(saved);}
 }else{
  const d=st.gm.add(0x1460+victim*16);d.writeU16((d.readU16()+1)&65535);
  if(attacker>=0){const k=st.gm.add(0x1458+attacker*16);k.writeS32(k.readS32()+1);}
  nativeSort(st.gm);
 }
 st.scoreEvents++;send({event:'lan-score',victim,life,killer,weapon,scores:scores()});
}
function localDeath(killer='environment',weapon=-1){
 if(st.localDead||!st.ready||hp(st.p)>0)return;
 st.localDead=true;countDeath(0,st.life,killer,weapon);
 const proof=loot.lastDamage;
 emit({type:'death',killer,weapon,hpAfter:hp(st.p),
  damageId:proof&&proof.after<=0&&proof.weapon===weapon?proof.id:null,
  drop:loot.deathSnapshot||deathInventory()});
 send({event:'lan-local-death',life:st.life,killer,weapon});
}
function localPose(){
 const p=st.p,pos=vec(p,0x1a40),eye=vec(p,0x1c84),direction=vec(p,0x1c78);
 const height=eye[1]-pos[1],pitch=Math.atan2(direction[1],Math.hypot(direction[0],direction[2]));
 return {pos,yaw:p.add(0x19b8).readFloat(),pitch:Number.isFinite(pitch)?pitch:0,
  sector:p.add(0x1b44).readS32(),weapon:p.add(0x290).readU8(),hp:Math.max(0,Math.min(100,hp(p))),
  stance:p.add(0x1970).readU8(),body:p.add(0x1971).readU8(),weaponAnim:p.add(0x1972).readU8(),
  eyeHeight:finite(height,1000)&&height>=30?height:300,paused:globalThis.KARMA_LOCAL_INPUT_PAUSED===true,
  inventory:[...(loot.inventory||[])],selectedWeapon:p.add(0x290).readU8(),
  shotSequence:st.shotSequence,...(st.lastShot?{shot:st.lastShot}:{})};
}
function sendState(type='state'){if(st.ready){const pose=localPose();if(!validPose(pose))return;
 st.lastState=now();emit({type,...pose});}}
function activateRemote(message,reset){
 const m=st.m,r=st.r;
 if(reset){
  nativeReset(r);nativeInventory(m,1,r.add(0x262).readU8(),st.gm.add(0x135),0);
  for(const o of [0x1974,0x1978,0x1980,0x1984])r.add(o).writeS32(14);
  nativeStance(r,0);nativeBody(r,4);nativeWeaponAction(r,13);
  nativePlace(m,1,message.sector,...message.pos,message.yaw*180/Math.PI,message.stance||0);
  nativeRefreshModel(r);nativeRefreshPosition(r);
  copy(r.add(0x1b14),r.add(0x1a40),12);copy(r.add(0x1b20),r.add(0x1a40),12);
  send({event:'lan-remote-placed',life:message.life,pos:message.pos,sector:message.sector});
 }
 if(message.hp<=0&&hp(r)>0)nativeSimpleDamage(r,1,hp(r),-1);
 r.add(0x264).writeS32(625+message.hp);
 r.add(0x1e24).writeU8(1);r.add(0x19ac).writeS32(1);r.add(0x19b4).writeS32(1);
 if(message.hp>0)r.add(0x19b0).writeS32(1);
 if(r.add(0x290).readU8()!==message.weapon){
  // Match the native receiver464a19: store the weapon ID before its model.
  r.add(0x290).writeU8(message.weapon);nativeSelectWeapon(r,message.weapon);
 }
 nativeYaw(m,1,message.yaw);r.add(0x19bc).writeFloat((message.pitch+.175)*180/Math.PI);
 r.add(0x1bf0).writeFloat(message.yaw);r.add(0x1bf4).writeFloat(message.pitch);
 r.add(0x1bd8).writeU8(message.weapon);r.add(0x1bd9).writeU8(message.hp>0?0x80:0);
 r.add(0x1bda).writeByteArray([0,0,0,0,0,0]);
 r.add(0x1be3).writeU8(message.stance||0);r.add(0x1be4).writeU8(message.hp>0?(message.body??4):8);
 r.add(0x1be5).writeU8(message.weaponAnim??13);r.add(0x1be6).writeU8(message.sector);
 const height=Math.round(message.eyeHeight||300);r.add(0x1be8).writeU16(height);
 copy(r.add(0x1b20),r.add(0x1a40),12);
 putvec(r,0x1bf8,[message.pos[0],message.pos[1]+height,message.pos[2]]);
 r.add(0x1bec).writeS32(0);r.add(0x1bd4).writeS32(1);
}
function replayShot(shot){
 if(!shot||shot.life!==st.remoteLife||!safeSector(shot.sector)||!safeSector(shot.renderSector))return;
 if(!boundedRemember(st.remoteShotIds,shot.life+':'+shot.id))return;
 if(shot.weapon>38)return; // Original auxiliary equipment has no combat replay.
 const m=st.m,r=st.r;
 nativeWeaponAction(r,15);nativeFireEffects(r);
 if(projectileWeapons.has(shot.weapon)){
  const projectiles=projectileSnapshot();
  const oldIndex=m.add(0x1064).readS32(),oldActor=m.add(0x1050).readPointer(),hit=m.add(0x109c).readByteArray(20);
  try{
   m.add(0x1064).writeS32(1);m.add(0x1050).writePointer(r);
   nativeHitscan(m,1,shot.weapon,...shot.origin,...shot.direction,shot.sector,shot.renderSector,
    shot.yaw,shot.pitch*180/Math.PI,m.add(0x1760).readU32());
  }finally{m.add(0x1064).writeS32(oldIndex);m.add(0x1050).writePointer(oldActor);m.add(0x109c).writeByteArray(hit);}
  rememberProjectiles(projectiles,shot,1);
 }
 st.remoteShots++;send({event:'lan-remote-shot',id:shot.id,weapon:shot.weapon,projectile:projectileWeapons.has(shot.weapon)});
}
function receivePose(x){
 if(!safeSector(x.sector)||x.life<st.remoteLife||x.seq<=st.remoteSeq)return;
 const first=!st.latestRemote,newLife=x.life>st.remoteLife;
 st.remoteSeq=x.seq;st.remoteLife=x.life;st.remotePaused=!!x.paused;
 activateRemote(x,first||newLife||(x.hp>0&&hp(st.r)<=0));
 st.latestRemote=x;st.remoteDead=x.hp<=0;
 replayShot(x.shot);
}
function receiveHit(x){
 if(x.victimLife!==st.life||st.localDead||hp(st.p)<=0)return;
 if(!boundedRemember(st.hitIds,x.life+':'+x.id))return;
 const before=hp(st.p),d=x.direction,team=st.r.add(0x262).readU8(),teamMode=st.m.add(0x1140).readS32();
 rememberDeathInventory();
 if(x.kind==='pellets')nativePellets(st.p,1,x.count,x.weapon,...d,team,teamMode);
 else nativeDamage(st.p,x.region,1,x.weapon,...d,team,teamMode,x.armorPierce||0);
 st.receivedHits++;
 send({event:'lan-native-damage',kind:x.kind,weapon:x.weapon,before,after:hp(st.p),id:x.id});
 reportDamage(before,hp(st.p),1,x.weapon,{id:x.id,life:x.life});
 localDeath('remote',x.weapon);
}
function processMessage(x){
 if(['drop','drop-removed','pickup-grant','pickup-denied'].includes(x.type))lootMessage(x);
 else if(x.type==='state'||x.type==='respawn')receivePose(x);
 else if(x.type==='hit')receiveHit(x);
 else if(x.type==='death'){
  countDeath(1,x.life,x.killer,x.weapon);
  if(x.life===st.remoteLife){st.remoteDead=true;if(hp(st.r)>0)nativeSimpleDamage(st.r,1,hp(st.r),x.weapon);}
 }else if(x.type==='pause')st.remotePaused=x.paused;
 else if(x.type==='leave'){clearDrops();st.closed=true;st.r.add(0x1e24).writeU8(0);send({event:'lan-peer-left'});}
}
Interceptor.attach(P(0x420560),{
 onEnter(){this.gm=this.context.ecx;},
 onLeave(result){
  if(result.toInt32()===0||P(0x548d70).readS32()!==1)return;
  const g=this.gm,m=g.add(0xc).readPointer(),remote=remoteConfig(),character=remote.character||{};
  st.gm=g;
  g.add(0x96c).writeS32(1);g.add(0x60).writeS32(1);
  g.add(0x7d).writeU8(1-g.add(0x7c).readU8());g.add(0x87).writeU8(g.add(0x86).readU8());
  copy(g.add(0xa2),g.add(0x8e),20);copy(m.add(0x177c),m.add(0x1768),20);copy(g.add(0x135),g.add(0x12e),7);
  const model=cfg.remoteModel||character.model;
  if(typeof model==='string'&&/^[a-z0-9_.-]{1,15}\.chr$/i.test(model)){
   g.add(0xa2).writeByteArray(new Uint8Array(20));g.add(0xa2).writeUtf8String(model);
   m.add(0x177c).writeByteArray(new Uint8Array(20));m.add(0x177c).writeUtf8String(model);
  }
  const inventory=cfg.remoteInventory||remote.inventory;
  if(Array.isArray(inventory)&&inventory.length===7&&inventory.every(v=>integer(v,0,50)||v===255))g.add(0x135).writeByteArray(inventory);
  seedLoadouts(g);
  const peerName=String(remote.name||character.name||'LAN Peer').replace(/[^\x20-\x7e]/g,'').slice(0,63)||'LAN Peer';
  g.add(0x266).writeUtf8String(peerName);g.add(0x994).writeS32(0);
  g.add(0xb68).writeByteArray(new Uint8Array(0x98));g.add(0x1028).writeByteArray(new Uint8Array(0x98));
  g.add(0xab4).writeS32(0);g.add(0x9d0).writeByteArray(new Uint8Array(32));g.add(0x1451).writeU8(0);
  send({event:'lan-roster-seeded',role:cfg.role,model:g.add(0xa2).readUtf8String(),name:peerName,
   inventory:Array.from(new Uint8Array(g.add(0x135).readByteArray(7)))});
 }
});
Interceptor.attach(P(0x44a4c0),{
 onEnter(args){
  this.local=args[0].toInt32()===0;this.m=this.context.ecx;
  if(this.local&&!st.localPlaced&&cfg.role==='join'){
   args[1]=P(4);args[2]=P(floatBits(5315));args[3]=P(floatBits(400));args[4]=P(floatBits(-8272));
  }
 },
 onLeave(){if(this.local&&!st.localPlaced){st.localPlaced=true;st.placedAt=now();st.m=this.m;}}
});
Interceptor.attach(P(0x451bd0),{
 onEnter(args){
  this.active=st.ready&&args[0].toInt32()===0&&this.context.ecx.equals(st.m);
  if(!this.active)return;
  const weapon=args[1].toInt32();
  this.shot={id:++st.shotSequence,life:st.life,weapon,origin:[2,3,4].map(i=>argFloat(args[i])),
   direction:[5,6,7].map(i=>argFloat(args[i])),sector:args[8].toInt32(),renderSector:args[9].toInt32(),
   yaw:argFloat(args[10]),pitch:argFloat(args[11])*Math.PI/180};
  this.projectiles=projectileWeapons.has(weapon)?projectileSnapshot():null;
 },
 onLeave(){
  if(!this.active||!validShot(this.shot))return;
  rememberProjectiles(this.projectiles,this.shot,0);
  st.hitHooks++;st.lastShot=this.shot;sendState();
  const m=st.m,shot=this.shot;
  if(!st.latestRemote||st.remoteDead||projectileWeapons.has(shot.weapon))return;
  let report=null;
  if(pelletWeapons.has(shot.weapon)){
   const count=m.add(0x109d).readU8();
   if(m.add(0x10a4).readS32()&&count>0&&count<=10)report={kind:'pellets',count};
  }else{
   const hit=m.add(0x10a8).readU8(),region=(hit&15)-1;
   if(m.add(0x10ac).readS32()&&(hit>>>4)===1&&region>=0)report={kind:'bullet',region};
  }
  if(report){st.sentHits++;emit({type:'hit',...report,id:shot.id,victimLife:st.remoteLife,
   weapon:shot.weapon,direction:shot.direction,armorPierce:st.p.add(0x1f0c).readS32()?1:0});
   send({event:'lan-native-hit',...report,id:shot.id,weapon:shot.weapon,victimLife:st.remoteLife});}
 }
});
// Original explosion damage is simulated once on each victim's own PC. Remote
// projectiles carry owner1; no additional synthetic explosion hit is sent.
Interceptor.attach(P(0x4570e0),{
 onEnter(args){
  this.frame=null;
  if(!st.ready||args[0].toInt32()!==0)return;
  const manager=this.context.ecx.add(4).readPointer(),record=manager.add(args[1].toInt32()*0xa8);
  const identity=loot.projectiles.get(args[1].toInt32());
  this.frame={owner:record.add(0x8951).readU8(),weapon:record.add(0x8950).readU8(),before:hp(st.p),identity};
  rememberDeathInventory();
  blastStack.push(this.frame);
 },
 onLeave(){if(this.frame){
  const f=this.frame,shot=f.identity;
  if(shot&&shot.owner===f.owner&&shot.weapon===f.weapon)reportDamage(f.before,hp(st.p),f.owner,f.weapon,shot);
  localDeath(f.owner===1?'remote':'self',f.weapon);
  const i=blastStack.lastIndexOf(this.frame);if(i>=0)blastStack.splice(i,1);}}
});
Interceptor.attach(P(0x461e50),{
 onEnter(args){this.local=st.ready&&this.context.ecx.equals(st.p);this.weapon=args[2].toInt32()&255;
  if(this.local&&!blastStack.length)rememberDeathInventory();},
 onLeave(){if(this.local&&!blastStack.length)localDeath('environment',this.weapon<=38?this.weapon:-1);}
});
Interceptor.attach(P(0x45f490),{onEnter(){if(st.ready&&this.context.ecx.equals(st.r))st.renderCalls++;}});
/*__TEST_DISPATCH__*/
function testTick(){
 if(processName!=='karmaaiprobe.exe')return;
 if(st.placement){
  const x=st.placement;st.placement=null;
  if(safeSector(x.sector)){nativePlace(st.m,0,x.sector,...x.pos,x.yaw*180/Math.PI,0);
   nativeRefreshPosition(st.p);send({event:'lan-test-local-placed',...x});sendState();}
 }
 if(st.testPending){
  const result=testNativeShotDispatch.consume();
  if(result){send({event:'lan-test-shot-result',...st.testPending,...result,hookObserved:st.hitHooks>st.testPending.hooks});
   st.testPending=null;}
 }
 if(!st.testShot||st.testPending||!st.latestRemote||hp(st.p)<=0||hp(st.r)<=0)return;
 const request=st.testShot;st.testShot=null;
 const pp=vec(st.p,0x1a40),rp=vec(st.r,0x1a40),height=localPose().eyeHeight;
 const eye=[pp[0],pp[1]+height,pp[2]],target=request.target||[rp[0],rp[1]+(projectileWeapons.has(request.weapon)?20:height*.65),rp[2]];
 const delta=target.map((v,i)=>v-eye[i]),length=Math.hypot(...delta);
 if(length<1)return;
 const direction=delta.map(v=>v/length),origin=eye.map((v,i)=>v+direction[i]*50);
 const yaw=Math.atan2(-direction[2],direction[0]),pitch=Math.atan2(direction[1],Math.hypot(direction[0],direction[2]));
 st.testPending={...request,hooks:st.hitHooks};
 testNativeShotDispatch.queue(st.m,[0,request.weapon,...origin.map(floatBits),...direction.map(floatBits),
  st.p.add(0x1b44).readS32(),st.p.add(0x1b4c).readS32(),floatBits(yaw),floatBits(pitch*180/Math.PI),st.m.add(0x1760).readU32()]);
}
Interceptor.attach(P(0x451380),{
 onEnter(){
  if(!st.localPlaced||st.closed)return;
  const m=this.context.ecx;
  if(m.add(0x1070).readS32()<2)return;
  st.m=m;st.p=m.add(0xfcc).readPointer();st.r=m.add(0xfd0).readPointer();
  if(!st.firstTick)st.firstTick=now();
  if(!st.ready&&now()-st.firstTick<1500)return;
  if(!st.ready){st.ready=true;resetSpawnInventory(true);
   send({event:'lan-game-ready',role:cfg.role,life:st.life,sectorCount:sectorCount(),local:localPose()});sendState();}
  // Input menus never suspend network damage or respawn progression.
  if(st.localDead&&hp(st.p)>0){st.localDead=false;st.life++;st.lastShot=null;resetSpawnInventory(false);sendState('respawn');
   send({event:'lan-local-respawn',life:st.life,pos:vec(st.p,0x1a40)});}
  for(let i=0;i<64&&st.queue.length;i++)processMessage(st.queue.shift());
  if(st.latestRemote&&!st.closed){st.r.add(0x1e24).writeU8(1);if(!st.remoteDead)st.r.add(0x19b0).writeS32(1);}
  testTick();
 },
 onLeave(){
  if(!st.ready||st.closed)return;
  localDeath();
  if(now()-st.lastState>=50)sendState();
  if(now()-st.lastLog>=2000){st.lastLog=now();send({event:'lan-tick',role:cfg.role,life:st.life,remoteLife:st.remoteLife,
   localHp:hp(st.p),remoteHp:hp(st.r),localPos:vec(st.p,0x1a40),remotePos:vec(st.r,0x1a40),
   renderCalls:st.renderCalls,sentHits:st.sentHits,receivedHits:st.receivedHits,remoteShots:st.remoteShots,queue:st.queue.length});}
 }
});
rpc.exports=Object.assign(rpc.exports||{},{
 lanreceive(message){
  if(!validate(message))throw new Error('Invalid LAN gameplay message');
  const tail=st.queue[st.queue.length-1];
  // Keep reliable ordering and every distinct shot, while a slow map load
  // needs only the newest adjacent movement snapshot from the same life.
  if(message.type==='state'&&tail?.type==='state'&&tail.life===message.life&&
   (tail.shot?.id??null)===(message.shot?.id??null)&&message.seq>tail.seq){
   st.queue[st.queue.length-1]=message;return {queued:true,coalesced:true};
  }
  if(st.queue.length>=256)throw new Error('LAN game queue overflow');
  st.queue.push(message);return {queued:true};
 },
 lanstatus(){return {ready:st.ready,role:cfg.role,life:st.life,remoteLife:st.remoteLife,localDead:st.localDead,
  local:st.ready?localPose():null,remote:st.latestRemote,remoteActual:st.ready?{
   pos:vec(st.r,0x1a40),hp:hp(st.r),yaw:st.r.add(0x19b8).readFloat(),weapon:st.r.add(0x290).readU8(),
   sector:st.r.add(0x1b44).readS32(),model:st.r.add(0x1f00).readS32(),spawned:st.r.add(0x19b0).readS32()}:null,
  scores:scores(),queue:st.queue.length,loadout:inventoryStatus(),
  sentHits:st.sentHits,receivedHits:st.receivedHits,remoteShots:st.remoteShots,hitHooks:st.hitHooks,renderCalls:st.renderCalls};},
 placeLocal(pos,sector,yaw=0){
  if(processName!=='karmaaiprobe.exe')throw new Error('Placement is test-process-only');
  if(!vector(pos)||!integer(sector,0,255)||!finite(yaw,1e4))throw new Error('Invalid placement');
  st.placement={pos,sector,yaw};return {accepted:true};
 },
 queueNativeShot(weapon=9,target=null){
  if(processName!=='karmaaiprobe.exe')throw new Error('Shot request is test-process-only');
  if(!integer(weapon,0,38)||(target!==null&&!vector(target)))throw new Error('Invalid test shot');
  if(st.testShot||st.testPending||testNativeShotDispatch.status()!==0)return {accepted:false,reason:'busy'};
  st.testShot={id:++st.testSerial,weapon,target};return {accepted:true,id:st.testSerial};
 }
});
send({event:'lan-adapter-ready',role:cfg.role,version:1,projectileWeapons:[...projectileWeapons]});
})();
