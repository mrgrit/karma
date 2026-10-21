// Two-to-eight-player LAN adapter for the original Karma290 actor and weapon engine.
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
// Original loader allocates all eight actor objects (44f8bf); configure reuses them.
const nativeConfigure=new NativeFunction(P(0x44fb30),'int',['pointer','int','int','pointer','int','pointer','pointer','int'],'thiscall');
const nativeLoadModel=new NativeFunction(P(0x44f960),'int',['pointer','pointer','int','int'],'thiscall');
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
 life:integer(cfg.match?.initialLife,1,1e9)?cfg.match.initialLife:1,remoteLife:0,seq:0,remoteSeq:-1,remoteDead:false,localDead:false,lastState:0,lastLog:0,
 shotSequence:0,lastShot:null,remoteShotIds:new Set(),hitIds:new Set(),deathIds:new Set(),
 queue:[],latestRemote:null,renderCalls:0,hitHooks:0,sentHits:0,receivedHits:0,remoteShots:0,scoreEvents:0,
 placement:null,testShot:null,testPending:null,testSerial:0,remotePaused:false,closed:false};
let nextRound=null,intermission=false;
const nativePlayerRespawn=new NativeFunction(P(0x450020),'void',['pointer','int','float','float','float','float'],'thiscall');
const scorePacket=Memory.alloc(6),blastStack=[];
const roster=(cfg.peers?.length?cfg.peers:[cfg.remoteHello||{playerId:cfg.remotePlayerId,config:cfg.remote||{}}]);
if(roster.length<1||roster.length>7)throw Error('Expected 1 to 7 peers');
const peers=roster.map((peer,i)=>({...peer,index:i+1,id:peer.playerId||cfg.remotePlayerId||'remote',
 team:peer.team??1,r:null,life:0,seq:-1,dead:false,paused:false,left:false,latest:null,shots:new Set(),hits:new Set()}));
const selfId=cfg.localPlayerId||'local',selfTeam=cfg.team??0,teamMode=cfg.match?.mode==='tdm';
const authoritative=cfg.central===true&&['karma290-central3','karma290-central4','karma290-central5'].includes(cfg.local?.settings?.build);
function peerById(id){return id?peers.find(p=>p.id===id):peers.length===1?peers[0]:null;}
function peerByIndex(index){return peers.find(p=>p.index===index);}
function nativeIndex(id){return id===selfId?0:peerById(id)?.index??-1;}
function playerId(index){return index===0?selfId:peerByIndex(index)?.id??null;}
function friendly(peer){return teamMode&&peer?.team===selfTeam;}
function syncLegacy(){const p=peers.find(p=>!p.left)||peers[0];st.r=p?.r||null;st.remoteLife=p?.life||0;st.remoteSeq=p?.seq??-1;st.remoteDead=p?.dead??true;st.latestRemote=p?.latest||null;st.remotePaused=p?.paused??false;}

/*__LOADOUT__*/
function emit(message){send({event:'lan-outbound',message:{version:1,life:st.life,seq:++st.seq,...message}});}
function boundedRemember(set,key){if(set.has(key))return false;set.add(key);if(set.size>512)set.delete(set.values().next().value);return true;}
function remoteConfig(){return peers[0].config||cfg.remoteHello?.config||cfg.remote||{};}
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
 if(x.type==='drop-grant')return validDropGrant(x.grant);
 if(x.type==='drop-denied')return idValid(x.requestId);
 if(x.type==='drop-removed'||x.type==='pickup-denied')return idValid(x.dropId);
 if(x.type==='pause')return typeof x.paused==='boolean';
 if(x.type==='leave')return true;
 if(x.type==='peer-left')return typeof x.playerId==='string';
 if(x.type==='peer-joined')return validPeer(x.peer);
 if(x.type==='match-snapshot')return Array.isArray(x.players)&&x.players.length<=8&&x.players.every(p=>idValid(p.playerId)&&integer(p.kills,0,1e6)&&integer(p.deaths,0,65535))&&integer(x.remainingSeconds,0,86400);
 if(x.type==='round-start')return integer(x.round,1,1000)&&x.lives&&integer(x.lives[selfId],1,1e9);
 if(x.type==='round-ended')return integer(x.round,1,1000);
 if(x.type==='death-confirmed')return x.receipt&&typeof x.receipt.victimId==='string'&&integer(x.receipt.victimLife,1,1e9);
 if(!integer(x.life,1,1e9)||!Number.isSafeInteger(x.seq)||x.seq<0)return false;
 if(x.type==='state'||x.type==='respawn')return validPose(x)&&(!x.shot||validShot(x.shot));
 if(x.type==='death')return ['remote','self','environment'].includes(x.killer)&&integer(x.weapon,-1,38);
 if(x.type==='hit')return ['bullet','pellets'].includes(x.kind)&&idValid(x.id)&&
  integer(x.victimLife,1,1e9)&&integer(x.weapon,0,38)&&vector(x.direction)&&
  (x.kind==='bullet'?integer(x.region,0,14):integer(x.count,1,10))&&
  (x.armorPierce===undefined||integer(x.armorPierce,0,1));
 return false;
}
function scores(){return st.gm?Array.from({length:Math.max(0,...peers.map(p=>p.index))+1},(_,slot)=>({slot,playerId:playerId(slot),active:slot===0||!peerByIndex(slot)?.left,kills:st.gm.add(0x1458+slot*16).readS32(),deaths:st.gm.add(0x1460+slot*16).readU16()})):null;}
function countDeath(victim,life,killer,weapon){
 const key=playerId(victim)+':'+life;
 if(!boundedRemember(st.deathIds,key)||!st.gm)return;
 const attacker=Number.isInteger(killer)?killer:killer==='remote'?1-victim:-1,backend=st.m.add(0x104c).readPointer();
 if(attacker>=0&&!backend.isNull()){
  const saved=backend.add(0x36d).readByteArray(8);
  scorePacket.writeByteArray([1,1,attacker,victim,0,weapon&255]);
  try{nativeKD(st.gm,scorePacket);}finally{backend.add(0x36d).writeByteArray(saved);}
 }else{
  const d=st.gm.add(0x1460+victim*16);d.writeU16((d.readU16()+1)&65535);
  if(attacker>=0){const k=st.gm.add(0x1458+attacker*16);k.writeS32(k.readS32()+1);}
  nativeSort(st.gm);
 }
 st.scoreEvents++;send({event:'lan-score',victim,life,killer,weapon,scores:scores()});
}
function localDeath(killer='environment',weapon=-1,attackerId=null){
 if(st.localDead||!st.ready||hp(st.p)>0)return;
 st.localDead=true;if(!authoritative)countDeath(0,st.life,attackerId?nativeIndex(attackerId):killer,weapon);
 const proof=loot.lastDamage;
 emit({type:'death',killer,weapon,killerId:cfg.localPlayerId?attackerId:null,hpAfter:hp(st.p),
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
  ammo:(()=>{const r=weaponRecord(p,p.add(0x290).readU8());return r.capacity>0&&r.magazine>=0&&r.reserve>=0?{[r.weapon]:{magazine:r.magazine,reserve:r.reserve}}:{};})(),
  shotSequence:st.shotSequence,...(st.lastShot?{shot:st.lastShot}:{})};
}
function sendState(type='state'){if(st.ready){const pose=localPose();if(!validPose(pose))return;
 st.lastState=now();emit({type,...pose});}}
function activateRemote(message,reset,peer){
 const m=st.m,r=peer.r,index=peer.index;
 if(reset){
  nativeReset(r);nativeInventory(m,index,r.add(0x262).readU8(),st.gm.add(0x12e+7*index),0);
  for(const o of [0x1974,0x1978,0x1980,0x1984])r.add(o).writeS32(14);
  nativeStance(r,0);nativeBody(r,4);nativeWeaponAction(r,13);
  nativePlace(m,index,message.sector,...message.pos,message.yaw*180/Math.PI,message.stance||0);
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
 nativeYaw(m,index,message.yaw);r.add(0x19bc).writeFloat((message.pitch+.175)*180/Math.PI);
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
function replayShot(shot,peer){
 if(!shot||shot.life!==peer.life||!safeSector(shot.sector)||!safeSector(shot.renderSector))return;
 if(Number.isInteger(shot.id)&&shot.id<=(peer.shotFloor||0))return;
 if(!boundedRemember(peer.shots,shot.life+':'+shot.id))return;
 if(shot.weapon>38)return; // Original auxiliary equipment has no combat replay.
 const m=st.m,r=peer.r,index=peer.index;
 nativeWeaponAction(r,15);nativeFireEffects(r);
 if(projectileWeapons.has(shot.weapon)){
  const projectiles=projectileSnapshot();
  const oldIndex=m.add(0x1064).readS32(),oldActor=m.add(0x1050).readPointer(),hit=m.add(0x109c).readByteArray(20);
  try{
   m.add(0x1064).writeS32(index);m.add(0x1050).writePointer(r);
   nativeHitscan(m,index,shot.weapon,...shot.origin,...shot.direction,shot.sector,shot.renderSector,
    shot.yaw,shot.pitch*180/Math.PI,m.add(0x1760).readU32());
  }finally{m.add(0x1064).writeS32(oldIndex);m.add(0x1050).writePointer(oldActor);m.add(0x109c).writeByteArray(hit);}
  rememberProjectiles(projectiles,shot,index);
 }
 st.remoteShots++;send({event:'lan-remote-shot',id:shot.id,weapon:shot.weapon,projectile:projectileWeapons.has(shot.weapon)});
}
function receivePose(x,peer){
 if(!safeSector(x.sector)||x.life<peer.life||x.seq<=peer.seq||peer.left)return;
 const first=!peer.latest,newLife=x.life>peer.life;
 if(newLife)peer.shotFloor=0;
 if(first&&!x.shot&&integer(x.shotSequence,0,1e9))peer.shotFloor=x.shotSequence;
 peer.seq=x.seq;peer.life=x.life;peer.paused=!!x.paused;
 activateRemote(x,first||newLife||(x.hp>0&&hp(peer.r)<=0),peer);
 peer.latest=x;peer.dead=x.hp<=0;
 replayShot(x.shot,peer);syncLegacy();
}
function receiveHit(x,peer){
 if(intermission||peer.left||friendly(peer)||x.victimLife!==st.life||st.localDead||hp(st.p)<=0)return;
 if(!boundedRemember(peer.hits,x.life+':'+x.id))return;
 const before=hp(st.p),d=x.direction,team=peer.r.add(0x262).readU8(),mode=teamMode?1:0;
 rememberDeathInventory();
 if(x.kind==='pellets')nativePellets(st.p,peer.index,x.count,x.weapon,...d,team,mode);
 else nativeDamage(st.p,x.region,peer.index,x.weapon,...d,team,mode,x.armorPierce||0);
 st.receivedHits++;
 send({event:'lan-native-damage',senderId:peer.id,kind:x.kind,weapon:x.weapon,before,after:hp(st.p),id:x.id});
 reportDamage(before,hp(st.p),peer.index,x.weapon,{id:x.id,life:x.life});
 localDeath('remote',x.weapon,peer.id);
}
function validPeer(p){
 return p&&typeof p.playerId==='string'&&p.playerId!==selfId&&integer(p.slot,0,7)&&integer(p.team,0,1)&&
  p.config&&p.config.map===cfg.local.map&&p.config.age===0&&p.config.settings?.build===cfg.local.settings?.build&&
  /^[a-z0-9_.-]{1,15}\.chr$/i.test(p.config.character?.model||'')&&
  Array.isArray(p.config.inventory)&&p.config.inventory.length===7&&p.config.inventory.every(v=>integer(v,0,51)||v===255);
}
function seedPeer(g,m,peer){
 const i=peer.index,c=peer.config||{},character=c.character||{};
 g.add(0x968+i*4).writeS32(1);g.add(0x5c+i*4).writeS32(i);
 g.add(0x7c+i).writeU8(peer.team);g.add(0x86+i).writeU8(g.add(0x86).readU8());
 copy(g.add(0x8e+i*20),g.add(0x8e),20);copy(m.add(0x1768+i*20),m.add(0x1768),20);
 copy(g.add(0x12e+i*7),g.add(0x12e),7);
 const model=(i===1?cfg.remoteModel:null)||character.model;
 if(typeof model==='string'&&/^[a-z0-9_.-]{1,15}\.chr$/i.test(model)){
  for(const p of [g.add(0x8e+i*20),m.add(0x1768+i*20)]){p.writeByteArray(new Uint8Array(20));p.writeUtf8String(model);}
 }
 const inventory=(i===1?cfg.remoteInventory:null)||c.inventory;
 if(Array.isArray(inventory)&&inventory.length===7&&inventory.every(v=>integer(v,0,51)||v===255))g.add(0x12e+i*7).writeByteArray(inventory);
 const name=String(character.name||c.name||'Player '+(peer.slot??i));
 if(globalThis.KARMA_WRITE_PLAYER_NAME)globalThis.KARMA_WRITE_PLAYER_NAME(g.add(0x166+i*0x100),name);
 else {g.add(0x166+i*0x100).writeByteArray(new Uint8Array(0x100));g.add(0x166+i*0x100).writeUtf8String(name.replace(/[^ -~]/g,'').slice(0,63)||'Player '+i);}
 g.add(0x990+i*4).writeS32(0);
 g.add(0xad0+i*0x98).writeByteArray(new Uint8Array(0x98));g.add(0xf90+i*0x98).writeByteArray(new Uint8Array(0x98));
 g.add(0xab0+i*4).writeS32(0);g.add(0x9b0+i*32).writeByteArray(new Uint8Array(32));g.add(0x1450+i).writeU8(0);
 globalThis.KARMA_SET_PEER_RANK?.(i,c.rank);
}
// The engine has eight model-cache entries. Preserve a displaced asset until this
// process exits because inactive actor instances can still reference it. Reusing
// the retained asset bounds memory by the 20 supported character models, rather
// than the number of join/leave operations.
const retainedModels=new Map();
const supportedModels=new Set(['cpom_050','cpoo_030','cpos_030','cpom_010','cpom_020','cpom_040','cpos_010','cpos_021','cpos_033','cpos_040','cpes_010','cpeo_010','cpes_050','cpes_020','cpes_040','cpeg_050','cpep_010','cpep_020','cper_020','cpes_060'].map(n=>n+'.chr'));
function modelCacheEntry(index,p){
 const registry=st.m.add(0x105c).readPointer();
 return {p,value:registry.add(0x10+index*4).readPointer(),matrix:registry.add(0x30+index*64).readByteArray(64),texture:registry.add(0x230+index*4).readS32(),surface:registry.add(0x258+index*4).readPointer()};
}
function ensureModel(peer){
 const m=st.m,name=peer.config.character.model.toLowerCase(),text=st.gm.add(0x8e+peer.index*20);
 if(!supportedModels.has(name))throw Error('Unsupported native character model');
 const registry=m.add(0x105c).readPointer();
 const entries=Array.from({length:8},(_,i)=>{const p=m.add(0x48+i*4).readPointer();return {i,p,name:p.isNull()?null:p.add(8).readUtf8String().toLowerCase()};});
 for(const e of entries)if(e.name)retainedModels.set(e.name,modelCacheEntry(e.i,e.p));
 if(entries.some(e=>e.name===name))return;
 const used=new Set([st.p.add(0x1f00).readS32(),...peers.filter(p=>!p.left&&p.id!==peer.id&&p.r).map(p=>p.r.add(0x1f00).readS32())]);
 const target=entries.find(e=>e.p.isNull())||entries.find(e=>!used.has(e.i));
 if(!target)throw Error('No free character model slot');
 if(retainedModels.has(name)){
  const saved=retainedModels.get(name);
  m.add(0x48+target.i*4).writePointer(saved.p);
  registry.add(0x10+target.i*4).writePointer(saved.value);
  registry.add(0x30+target.i*64).writeByteArray(saved.matrix);
  registry.add(0x230+target.i*4).writeS32(saved.texture);
  registry.add(0x258+target.i*4).writePointer(saved.surface);
 }else{
  // The original loader selects the first empty slot, or its fallback index when
  // all eight are occupied. Do not null a middle entry: model lookup assumes a
  // packed cache until its matching entry is reached.
  registry.add(0x230+target.i*4).writeS32(-1);registry.add(0x258+target.i*4).writePointer(P(0));
  nativeLoadModel(m,text,target.i,st.gm.add(0x988).readS32());
  const loaded=m.add(0x48+target.i*4).readPointer();
  if(loaded.isNull()||loaded.add(8).readUtf8String().toLowerCase()!==name)throw Error('Character model failed to load');
  retainedModels.set(name,modelCacheEntry(target.i,loaded));
 }
}
function updateNativeCount(){
 st.m.add(0x1070).writeS32(Math.max(0,...peers.filter(p=>!p.left).map(p=>p.index))+1);
 nativeSort(st.gm);
}
function hidePeer(peer){
 peer.left=true;peer.dead=true;peer.latest=null;
 if(peer.r){peer.r.add(0x1e24).writeU8(0);peer.r.add(0x19b0).writeS32(0);peer.r.add(0x19ac).writeS32(0);peer.r.add(0x19b4).writeS32(0);}
 if(st.gm){st.gm.add(0x968+peer.index*4).writeS32(0);st.gm.add(0x166+peer.index*0x100).writeU8(0);}
 if(st.m&&st.gm)updateNativeCount();
 globalThis.KARMA_SET_PEER_RANK?.(peer.index,null);
}
function joinPeer(value){
 if(!authoritative||teamMode||cfg.match?.mode!=='dm'||!validPeer(value))return;
 if(peers.some(p=>p.id===value.playerId&&!p.left))return;
 const index=Array.from({length:7},(_,i)=>i+1).find(i=>!peers.some(p=>p.index===i&&!p.left));
 if(!index)throw Error('Native participant capacity exceeded');
 const old=peerByIndex(index),peer={...value,index,id:value.playerId,r:st.m.add(0xfcc+index*4).readPointer(),life:0,seq:-1,dead:false,paused:false,left:false,latest:null,shots:new Set(),hits:new Set()};
 if(peer.r.isNull())throw Error('Original actor slot was not allocated');
 if(old)peers.splice(peers.indexOf(old),1,peer);else peers.push(peer);
 seedPeer(st.gm,st.m,peer);ensureModel(peer);nativeReset(peer.r);
 if(!nativeConfigure(st.m,index,peer.team,st.gm.add(0x8e+index*20),6,st.gm.add(0x166+index*0x100),st.gm.add(0x12e+index*7),0))throw Error('Native actor configuration failed');
 peer.r.add(0x1e58).writeU8(0);peer.r.add(0x288).writeS32(0);peer.r.add(0x15c).writeS32(0);
 peer.r.add(0x1e24).writeU8(0);peer.r.add(0x19b0).writeS32(0);peer.r.add(0x19ac).writeS32(0);peer.r.add(0x19b4).writeS32(0);
 st.gm.add(0x1458+index*16).writeByteArray(new Uint8Array(16));
 updateNativeCount();syncLegacy();
 send({event:'lan-peer-joined',playerId:peer.id,index,slot:peer.slot,model:peer.config.character.model,modelIndex:peer.r.add(0x1f00).readS32()});
}
function applySnapshot(x){
 for(const p of x.players){const index=nativeIndex(p.playerId);if(index<0)continue;
  st.gm.add(0x1458+index*16).writeS32(p.kills);st.gm.add(0x1460+index*16).writeU16(p.deaths);}
 nativeSort(st.gm);send({event:'lan-match-snapshot',scores:scores(),remainingSeconds:x.remainingSeconds});
}
function processMessage(x){
 if(x.type==='peer-joined'){joinPeer(x.peer);return;}
 if(x.type==='match-snapshot'){applySnapshot(x);return;}
 if(x.type==='round-ended'){intermission=true;send({event:'lan-round-ended',...x});return;}
 if(x.type==='round-start'){nextRound=x;intermission=false;return;}
 if(['drop','drop-removed','pickup-grant','pickup-denied','drop-grant','drop-denied'].includes(x.type)){lootMessage(x);return;}
 if(x.type==='death-confirmed'){
  const d=x.receipt,victim=nativeIndex(d.victimId),attacker=d.verified?nativeIndex(d.killerId):-1;
  if(victim>=0)countDeath(victim,d.victimLife,attacker,d.weapon);return;
 }
 if(x.type==='peer-left'){const p=peerById(x.playerId);if(p)hidePeer(p);syncLegacy();return;}
 if(x.type==='leave'&&!x.senderId){clearDrops();st.closed=true;for(const p of peers)hidePeer(p);send({event:'lan-peer-left'});return;}
 const peer=peerById(x.senderId);if(!peer||peer.left)return;
 if(x.type==='state'||x.type==='respawn')receivePose(x,peer);
 else if(x.type==='hit')receiveHit(x,peer);
 else if(x.type==='death'){
  if(!authoritative)countDeath(peer.index,x.life,x.killerId?nativeIndex(x.killerId):x.killer==='remote'?0:-1,x.weapon);
  if(x.life===peer.life){peer.dead=true;if(hp(peer.r)>0)nativeSimpleDamage(peer.r,1,hp(peer.r),x.weapon);}
 }else if(x.type==='pause')peer.paused=x.paused;
 else if(x.type==='leave')hidePeer(peer);
 syncLegacy();
}
Interceptor.attach(P(0x420560),{
 onEnter(){this.gm=this.context.ecx;},
 onLeave(result){
  if(result.toInt32()===0||P(0x548d70).readS32()!==1)return;
  const g=this.gm,m=g.add(0xc).readPointer();st.gm=g;
  // Every machine keeps itself at native slot0; wire IDs are mapped to 1..7.
  // These arrays each have eight native entries. Seed the complete online profile
  // records before the original loader instantiates actors and target badges.
  g.add(0x7c).writeU8(selfTeam);m.add(0x1140).writeS32(teamMode?1:0);
  for(const peer of peers)seedPeer(g,m,peer);
  seedLoadouts(g);
  send({event:'lan-roster-seeded',role:cfg.role,players:peers.length+1,peers:peers.map(p=>({id:p.id,index:p.index,team:p.team}))});
 }
});
const nativeSectorByName=new NativeFunction(P(0x444ac0),'int',['pointer','pointer'],'thiscall');
/*__MAPS__*/
const battlefield=mapDefinitions.find(map=>map.mapIndex===(cfg.local?.map??0));
if(!battlefield)throw Error('Unsupported multiplayer battlefield');
const spawns=battlefield.dmSpawns.map(p=>[p.sectorName,p.position,p.yawDegrees]);
const teamSpawns=battlefield.teamSpawns.map(p=>[p.sectorName,p.position,p.yawDegrees]);
// A room has a random server UUID. All clients derive the same permutation,
// so a fresh deathmatch starts at random, non-overlapping spawn positions.
const initialSpawnOrder=spawns.map((_,i)=>i);
if(cfg.match?.mode==='dm'&&cfg.match.roomId){
 let seed=2166136261;
 for(const char of cfg.match.roomId)seed=Math.imul(seed^char.charCodeAt(0),16777619)>>>0;
 for(let i=initialSpawnOrder.length-1;i>0;i--){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const j=seed%(i+1);[initialSpawnOrder[i],initialSpawnOrder[j]]=[initialSpawnOrder[j],initialSpawnOrder[i]];
 }
}
function spawnFor(m,serial=0){
 const slot=cfg.slot??(cfg.role==='join'?1:0);
 // Legacy duel retains its measured native sector, including small unit fixtures.
 if(!cfg.match)return {sector:4,pos:spawns[slot%8][1],yaw:0};
 let index=initialSpawnOrder[slot%8];
 if(!teamMode&&serial>0){
  const options=spawns.map((p,i)=>({i,d:Math.min(...peers.filter(p=>!p.dead&&!p.left&&p.latest).map(r=>Math.hypot(...p[1].map((v,k)=>v-r.latest.pos[k]))),1e9)}))
   .filter(p=>p.i!==lastSpawnIndex);
  const safe=options.filter(p=>p.d>=1200),pool=safe.length?safe:options;index=pool[Math.floor(Math.random()*pool.length)].i;
 }
 lastSpawnIndex=index;
 const point=teamMode?teamSpawns[selfTeam*4+((Math.floor(slot/2)+serial)%4)]:spawns[index];
 const text=Memory.allocUtf8String(point[0]),world=m.add(0xc).readPointer();
 return {sector:nativeSectorByName(world,text),pos:point[1],yaw:point[2]||0};
}
let spawnSerial=0,lastSpawnIndex=cfg.slot??(cfg.role==='join'?1:0);
globalThis.KARMA_LAN_RESPAWN=(m)=>{
 if(teamMode)return false;
 const s=spawnFor(m,++spawnSerial);return s.sector>=0?{position:s.pos,sector:s.sector,yaw:s.yaw*Math.PI/180}:null;
};
Interceptor.attach(P(0x44a4c0),{
 onEnter(args){
  this.local=args[0].toInt32()===0;this.m=this.context.ecx;
  if(this.local&&!st.localPlaced&&(cfg.match||cfg.role==='join')){
   const s=spawnFor(this.m);if(s.sector<0)return;
   args[1]=P(s.sector);s.pos.forEach((v,i)=>{args[i+2]=P(floatBits(v));});args[5]=P(floatBits(s.yaw));
  }
 },
 onLeave(){if(this.local&&!st.localPlaced){st.localPlaced=true;st.placedAt=now();st.m=this.m;}}
});

Interceptor.attach(P(0x451bd0),{
 onEnter(args){
  this.active=st.ready&&!intermission&&args[0].toInt32()===0&&this.context.ecx.equals(st.m);
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
  if(projectileWeapons.has(shot.weapon))return;
  for(const peer of peers){
   if(!peer.latest||peer.dead||peer.left||friendly(peer))continue;
   let report=null;
   if(pelletWeapons.has(shot.weapon)){
    const count=m.add(0x109c+peer.index).readU8();
    if(m.add(0x10a4).readS32()&&count>0&&count<=10)report={kind:'pellets',count};
   }else{
    const hit=m.add(0x10a8).readU8(),region=(hit&15)-1;
    if(m.add(0x10ac).readS32()&&(hit>>>4)===peer.index&&region>=0)report={kind:'bullet',region};
   }
   if(report){st.sentHits++;emit({type:'hit',...report,id:shot.id,targetId:peer.id,victimLife:peer.life,
    weapon:shot.weapon,direction:shot.direction,armorPierce:st.p.add(0x1f0c).readS32()?1:0});
    send({event:'lan-native-hit',...report,targetId:peer.id,id:shot.id,weapon:shot.weapon,victimLife:peer.life});}
  }
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
  localDeath(f.owner>0?'remote':'self',f.weapon,playerId(f.owner));
  const i=blastStack.lastIndexOf(this.frame);if(i>=0)blastStack.splice(i,1);}}
});
Interceptor.attach(P(0x461e50),{
 onEnter(args){this.local=st.ready&&this.context.ecx.equals(st.p);this.weapon=args[2].toInt32()&255;
  if(this.local&&!blastStack.length)rememberDeathInventory();
  const frame=blastStack[blastStack.length-1];
  if(this.local&&intermission)args[1]=P(0);
  if(this.local&&frame&&frame.owner>0&&friendly(peerByIndex(frame.owner)))args[1]=P(0);},
 onLeave(){if(this.local&&!blastStack.length)localDeath('environment',this.weapon<=38?this.weapon:-1);}
});
Interceptor.attach(P(0x45f490),{onEnter(){if(st.ready&&peers.some(p=>p.r&&this.context.ecx.equals(p.r)))st.renderCalls++;}});
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
 if(!st.testShot||st.testPending||hp(st.p)<=0)return;
 const peer=peerById(st.testShot.targetId)||peers[0];
 if(!peer.latest||hp(peer.r)<=0)return;
 const request=st.testShot;st.testShot=null;
 const pp=vec(st.p,0x1a40),rp=vec(peer.r,0x1a40),height=localPose().eyeHeight;
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
  if(m.add(0x1070).readS32()<1)return;
  st.m=m;st.p=m.add(0xfcc).readPointer();
  st.p.add(0x262).writeU8(selfTeam);m.add(0x1140).writeS32(teamMode?1:0);
  for(const peer of peers){peer.r=m.add(0xfcc+4*peer.index).readPointer();peer.r.add(0x262).writeU8(peer.team);}
  syncLegacy();
  if(!st.firstTick)st.firstTick=now();
  if(!st.ready&&now()-st.firstTick<1500)return;
  if(!st.ready){st.ready=true;resetSpawnInventory(true);
   send({event:'lan-game-ready',role:cfg.role,life:st.life,sectorCount:sectorCount(),local:localPose()});sendState();}
  // Input menus never suspend network damage or respawn progression.
  if(st.localDead&&hp(st.p)>0){st.localDead=false;st.life++;st.lastShot=null;resetSpawnInventory(false);sendState('respawn');
   send({event:'lan-local-respawn',life:st.life,pos:vec(st.p,0x1a40)});}
  for(let i=0;i<64&&st.queue.length;i++)processMessage(st.queue.shift());
  if(nextRound){
   const round=nextRound;nextRound=null;const spawn=spawnFor(m,round.round-1);
   if(spawn.sector>=0){
    nativePlayerRespawn(m,spawn.sector,...spawn.pos,spawn.yaw);m.add(0xfb4).writeS32(0);m.add(0x114c).writeS32(0);
    st.life=round.lives[selfId];st.localDead=false;st.lastShot=null;resetSpawnInventory(true);clearDrops();sendState('respawn');
    send({event:'lan-round-started',round:round.round,life:st.life,pos:vec(st.p,0x1a40)});
   }
  }
  for(const p of peers)if(p.latest&&!p.left){p.r.add(0x1e24).writeU8(1);if(!p.dead)p.r.add(0x19b0).writeS32(1);}
  testTick();
 },
 onLeave(){
  if(!st.ready||st.closed)return;
  localDeath();
  if(now()-st.lastState>=50)sendState();
  if(now()-st.lastLog>=2000){st.lastLog=now();send({event:'lan-tick',role:cfg.role,life:st.life,remoteLife:st.remoteLife,
   localHp:hp(st.p),remoteHp:st.r?hp(st.r):null,localPos:vec(st.p,0x1a40),remotePos:st.r?vec(st.r,0x1a40):null,
   renderCalls:st.renderCalls,sentHits:st.sentHits,receivedHits:st.receivedHits,remoteShots:st.remoteShots,queue:st.queue.length});}
 }
});
rpc.exports=Object.assign(rpc.exports||{},{
 lanreceive(message){
  if(!validate(message))throw new Error('Invalid LAN gameplay message');
  let tailIndex=st.queue.length-1;
  while(tailIndex>=0&&st.queue[tailIndex].senderId!==message.senderId)tailIndex--;
  const tail=st.queue[tailIndex];
  // Keep reliable ordering and every distinct shot, while a slow map load
  // needs only the newest adjacent movement snapshot from the same life.
  if(message.type==='state'&&tail?.type==='state'&&tail.senderId===message.senderId&&tail.life===message.life&&
   (tail.shot?.id??null)===(message.shot?.id??null)&&message.seq>tail.seq){
   st.queue[tailIndex]=message;return {queued:true,coalesced:true};
  }
  if(st.queue.length>=256)throw new Error('LAN game queue overflow');
  st.queue.push(message);return {queued:true};
 },
 lanstatus(){return {ready:st.ready,role:cfg.role,life:st.life,remoteLife:st.remoteLife,localDead:st.localDead,
  local:st.ready?localPose():null,remote:st.latestRemote,remoteActual:st.ready&&st.r?{
   pos:vec(st.r,0x1a40),hp:hp(st.r),yaw:st.r.add(0x19b8).readFloat(),weapon:st.r.add(0x290).readU8(),
   sector:st.r.add(0x1b44).readS32(),model:st.r.add(0x1f00).readS32(),spawned:st.r.add(0x19b0).readS32()}:null,
  scores:scores(),peers:peers.map(p=>({id:p.id,index:p.index,team:p.team,life:p.life,left:p.left,dead:p.dead,latest:p.latest,
   actual:p.r?{pos:vec(p.r,0x1a40),hp:hp(p.r),weapon:p.r.add(0x290).readU8(),team:p.r.add(0x262).readU8(),model:p.r.add(0x1f00).readS32(),visible:p.r.add(0x1e24).readU8(),spawned:p.r.add(0x19b0).readS32(),active:p.r.add(0x19b4).readS32(),rank:st.gm.add(0xb04+p.index*0x98).readS32()}:null})),
  queue:st.queue.length,loadout:inventoryStatus(),retainedModelCount:retainedModels.size,
  modelCache:st.ready?Array.from({length:8},(_,i)=>{const p=st.m.add(0x48+i*4).readPointer();return {index:i,pointer:p.toString(),name:p.isNull()?null:p.add(8).readUtf8String().toLowerCase()};}):[],
  sentHits:st.sentHits,receivedHits:st.receivedHits,remoteShots:st.remoteShots,hitHooks:st.hitHooks,renderCalls:st.renderCalls};},
 placeLocal(pos,sector,yaw=0){
  if(processName!=='karmaaiprobe.exe')throw new Error('Placement is test-process-only');
  if(!vector(pos)||!integer(sector,0,255)||!finite(yaw,1e4))throw new Error('Invalid placement');
  st.placement={pos,sector,yaw};return {accepted:true};
 },
 queueNativeShot(weapon=9,target=null,targetId=null){
  if(processName!=='karmaaiprobe.exe')throw new Error('Shot request is test-process-only');
  if(!integer(weapon,0,38)||(target!==null&&!vector(target)))throw new Error('Invalid test shot');
  if(st.testShot||st.testPending||testNativeShotDispatch.status()!==0)return {accepted:false,reason:'busy'};
  st.testShot={id:++st.testSerial,weapon,target,targetId};return {accepted:true,id:st.testSerial};
 }
});
send({event:'lan-adapter-ready',role:cfg.role,version:1,projectileWeapons:[...projectileWeapons]});
})();
