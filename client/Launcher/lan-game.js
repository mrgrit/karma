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
const authoritative=cfg.central===true&&['karma290-central3','karma290-central4','karma290-central5','karma290-central6'].includes(cfg.local?.settings?.build);
function peerById(id){return id?peers.find(p=>p.id===id):peers.length===1?peers[0]:null;}
function peerByIndex(index){return peers.find(p=>p.index===index);}
function nativeIndex(id){return id===selfId?0:peerById(id)?.index??-1;}
function playerId(index){return index===0?selfId:peerByIndex(index)?.id??null;}
function friendly(peer){return teamMode&&peer?.team===selfTeam;}
function syncLegacy(){const p=peers.find(p=>!p.left)||peers[0];st.r=p?.r||null;st.remoteLife=p?.life||0;st.remoteSeq=p?.seq??-1;st.remoteDead=p?.dead??true;st.latestRemote=p?.latest||null;st.remotePaused=p?.paused??false;}

// Included in the LAN closure by lan_build_game.py. Native pickup/quantity
// mechanics are backed by lan-loadout-native.jsonl; Node owns all authority.
const nativeFullEquip=new NativeFunction(P(0x45e700),'void',['pointer','int'],'thiscall');
const nativeRegisterKey=new NativeFunction(P(0x452540),'int',['pointer','int'],'thiscall');
const nativePickup=new NativeFunction(P(0x4622d0),'void',['pointer','int'],'thiscall');
const nativeDropCode=new NativeFunction(P(0x46fe60),'int',['pointer','int'],'thiscall');
const nativeWorldDrop=new NativeFunction(P(0x4523b0),'void',
 ['pointer','int','float','float','float','float','float','float','int','int','int'],'thiscall');
const loot={inventory:null,drops:new Map(),indices:new Map(),removed:new Set(),grants:new Set(),
 claimSerial:0,damageSerial:0,deathSnapshot:null,lastDamage:null,projectiles:new Map(),configured:false,
 eHeld:false,gHeld:false,ePressed:false,eConsumed:false,pendingDrop:null,nearby:null,lastHint:0};
const lootForeground=typeof Process.getModuleByName==='function'?
 new NativeFunction(Process.getModuleByName('user32.dll').getExportByName('GetForegroundWindow'),'pointer',[],'stdcall'):null;
function lootHint(phase,message,d,extra={}){
 const catalog=cfg.equipmentCatalog||{},weapons=catalog.weapons||[];
 const item=weapons.find(w=>(w.weaponId??w.id)===d?.weapon);
 const cost=w=>{const x=weapons.find(v=>(v.weaponId??v.id)===w);return x?(x.inventoryCost??x.cost):0;};
 const inventoryScore=(loot.inventory||[]).filter(w=>w!==255).reduce((n,w)=>n+cost(w),0);
 const weaponCost=d?cost(d.weapon):0,capacity=catalog.inventoryCapacity;
 const projectedScore=inventoryScore+((loot.inventory||[]).includes(d?.weapon)?0:weaponCost);
 if(phase==='nearby'&&item){
  const owned=(loot.inventory||[]).includes(d.weapon),full=Number.isFinite(capacity)&&projectedScore>capacity;
  message=(owned?'보유 중 · ':full?'점수 부족 · ':'[E] ')+(item.name||('무기 '+d.weapon))+' · '+d.magazine+'/'+d.reserve;
 }
 if(phase==='picked')message='획득 · '+(item?.name||'무기');
 if(phase==='dropped')message='무기를 버렸습니다';
 if(phase==='pending')message='장비 확인 중…';
 send({event:'lan-loot-hint',phase,message,ttlMs:phase==='nearby'?900:1800,weapon:d?.weapon,
  magazine:d?.magazine,reserve:d?.reserve,inventory:[...(loot.inventory||[])],inventoryScore,weaponCost,projectedScore,capacity,...extra});
}
function lootKeys(){
 try{
  const game=P(0x548d5c).readPointer(),input=game.isNull()?P(0):game.add(0x120).readPointer();
  if(input.isNull())return {e:false,g:false,active:false};
  // Isolated probes have no DirectInput devices and inject only this private
  // process buffer. Production always requires its own foreground window.
  const test=processName==='karmaaiprobe.exe'&&globalThis.KARMA_PICKUP_TEST_INPUT===true;
  const hwnd=P(0x548d50).readPointer();
  const active=!globalThis.KARMA_LOCAL_PAUSED&&!globalThis.KARMA_LOCAL_INPUT_PAUSED&&
   (test||(!hwnd.isNull()&&lootForeground&&lootForeground().equals(hwnd)));
  return {e:(input.add(0x52).readU8()&0x80)!==0,g:(input.add(0x62).readU8()&0x80)!==0,active};
 }catch(_){return {e:false,g:false,active:false};}
}
function nearestLoot(){
 const here=vec(st.p,0x1a40);
 return [...loot.drops.values()].filter(d=>d.nearbyAt&&now()-d.nearbyAt<=200)
  .sort((a,b)=>Math.hypot(...a.pos.map((v,i)=>v-here[i]))-Math.hypot(...b.pos.map((v,i)=>v-here[i])))[0]||null;
}
function claimPickup(d){
 if(!d||d.pending||loot.pendingDrop||st.localDead||hp(st.p)<=0)return false;
 d.pending=true;d.lastAttempt=now();
 const requestId=selfId+':'+st.life+':pickup:'+ ++loot.claimSerial;
 // State and claim use the same ordered transport, so the authoritative
 // distance/selection check sees this frame before processing the request.
 sendState();emit({type:'pickup-claim',dropId:d.id,requestId,life:st.life});
 lootHint('pending','무기 줍기를 확인하고 있습니다.',d);
 return true;
}
function requestDrop(){
 if(loot.pendingDrop)return;
 const item=deathInventory();
 if(!item||!integer(item.selectedWeapon,0,47)||!(loot.inventory||[]).includes(item.selectedWeapon)){
  lootHint('denied','이 장비는 버릴 수 없습니다. 버릴 총을 먼저 선택하세요.');return;
 }
 const requestId=selfId+':'+st.life+':drop:'+ ++loot.claimSerial;
 loot.pendingDrop={requestId,at:now()};sendState();
 emit({type:'drop-claim',requestId,life:st.life,weapon:item.selectedWeapon,magazine:item.magazine,reserve:item.reserve});
 lootHint('pending','무기 버리기를 확인하고 있습니다.',{...item,weapon:item.selectedWeapon});
}
function selectedConfig(value){
 const c=value||{},l=c.loadout||{};
 return {inventory:c.inventory||c.inventory7||l.inventory||l.inventory7,selectedWeapon:c.selectedWeapon??l.selectedWeapon};
}
function initialInventory(c){
 return Array.isArray(c.inventory)&&c.inventory.length===7&&
  c.inventory.every(x=>integer(x,0,51)||x===255)&&
  new Set(c.inventory.filter(x=>x!==255)).size===c.inventory.filter(x=>x!==255).length;
}
function seedLoadouts(g){
 const local=selectedConfig(cfg.local||cfg),remote=selectedConfig(remoteConfig());
 if(initialInventory(local))g.add(0x12e).writeByteArray(local.inventory);
 if(initialInventory(remote))g.add(0x135).writeByteArray(remote.inventory);
 loot.inventory=Array.from(new Uint8Array(g.add(0x12e).readByteArray(7)));
}
function weaponRecord(actor,w){
 return {weapon:w,owned:actor.add(0x298+w*56).readS32(),
  magazine:actor.add(0x2a4+w*56).readS32(),reserve:actor.add(0x29c+w*56).readS32()-253,
  capacity:actor.add(0x2a0+w*56).readU8()};
}
function ownsItem(actor,w){
 if(w===48)return actor.add(0x1ef4).readS32()!==0;
 if(w===49)return actor.add(0x1eec).readS32()!==0;
 if(w===51)return actor.add(0x1efc).readS32()!==0;
 return integer(w,0,50)&&actor.add(0x298+w*56).readS32()!==0;
}
function inventoryStatus(){
 if(!st.ready)return null;
 return {inventory:[...(loot.inventory||[])],selectedWeapon:st.p.add(0x290).readU8(),
  owned:Array.from({length:52},(_,w)=>w).filter(w=>ownsItem(st.p,w)),
  ammo:Array.from({length:52},(_,w)=>weaponRecord(st.p,w)).filter(r=>r.owned&&r.capacity>0&&r.reserve>=0),
  drops:[...loot.drops.values()].map(d=>({id:d.id,index:d.index,weapon:d.weapon,pending:d.pending}))};
}
function resetSpawnInventory(first){
 const local=selectedConfig(cfg.local||cfg);
 loot.inventory=Array.from(new Uint8Array(st.gm.add(0x12e).readByteArray(7)));
 if(first&&initialInventory(local))
  nativeInventory(st.m,0,st.p.add(0x262).readU8(),st.gm.add(0x12e),0);
 if(integer(local.selectedWeapon,0,47)&&loot.inventory.includes(local.selectedWeapon)&&
  ownsItem(st.p,local.selectedWeapon)&&weaponRecord(st.p,local.selectedWeapon).capacity>0)
  nativeFullEquip(st.p,local.selectedWeapon);
 loot.deathSnapshot=null;loot.lastDamage=null;loot.configured=true;
}
function deathInventory(){
 const w=st.p.add(0x290).readU8();
 if(!integer(w,0,51)||!ownsItem(st.p,w))return null;
 const r=weaponRecord(st.p,w);
 if(!integer(r.magazine,0,r.capacity)||!integer(r.reserve,0,746)||r.capacity<1||
  nativeDropCode(st.m.add(0x18).readPointer(),w)<0)return null;
 return {selectedWeapon:w,magazine:r.magazine,reserve:r.reserve,
  pos:vec(st.p,0x1a40),sector:st.p.add(0x1b44).readS32()};
}
function rememberDeathInventory(){loot.deathSnapshot=deathInventory();}
function reportDamage(before,after,owner,weapon,shot){
 if(before<=0||after>=before||!shot||!idValid(shot.id)||!integer(shot.life,1,1e9))return;
 const attackerId=playerId(owner);
 const proof={id:selfId+':'+st.life+':damage:'+ ++loot.damageSerial,shotId:shot.id,victimLife:st.life,attackerId:attackerId||null,
  attackerLife:attackerId?shot.life:null,attackerSlot:owner,weapon,before,after};
 loot.lastDamage=proof;
 send({event:'lan-damage-proof',proof});
}
// 46cd50 allocates the first inactive projectile among 300 records (stride a8).
// The before/after comparison surrounds exactly one native launch on the game
// thread, so it associates a real projectile with its original wire shot ID.
function projectileSnapshot(){
 const manager=st.m.add(0x18).readPointer();
 if(manager.isNull())return null;
 return {manager,active:Array.from({length:300},(_,i)=>manager.add(0x8900+i*0xa8).readS32()!==0)};
}
function rememberProjectiles(before,shot,owner){
 if(!before||!projectileWeapons.has(shot.weapon))return;
 for(let i=0;i<300;i++){
  const r=before.manager.add(i*0xa8);
  if(before.active[i]||!r.add(0x8900).readS32())continue;
  const actualOwner=r.add(0x8951).readU8(),weapon=r.add(0x8950).readU8();
  loot.projectiles.delete(i);
  if(actualOwner===owner&&weapon===shot.weapon)
   loot.projectiles.set(i,{id:shot.id,life:shot.life,weapon,owner});
 }
}
function validDrop(d){
 return d&&idValid(d.id)&&integer(d.weapon,0,47)&&integer(d.magazine,0,127)&&
  integer(d.reserve,0,746)&&vector(d.pos)&&integer(d.sector,0,255);
}
function validGrant(g){
 return g&&idValid(g.id)&&idValid(g.dropId)&&typeof g.playerId==='string'&&
  integer(g.life,1,1e9)&&integer(g.weapon,0,47)&&integer(g.magazine,0,127)&&
  integer(g.reserve,0,746)&&integer(g.replaceSlot,0,51)&&
  (integer(g.replacedWeapon,0,51)||g.replacedWeapon===255);
}
function validDropGrant(g){
 return g&&idValid(g.id)&&typeof g.playerId==='string'&&integer(g.life,1,1e9)&&
  integer(g.weapon,0,47)&&integer(g.removeSlot,0,51)&&integer(g.selectedWeapon,0,51)&&validDrop(g.drop)&&
  Array.isArray(g.inventory)&&g.inventory.length>0&&g.inventory.length<=52&&
  g.inventory.every(w=>integer(w,0,51)||w===255)&&g.inventory.includes(g.selectedWeapon)&&
  !g.inventory.includes(g.weapon)&&new Set(g.inventory.filter(w=>w!==255)).size===g.inventory.filter(w=>w!==255).length;
}
function forgetWeapon(w){
 // localPose repeats the latest shot in ordinary states for delivery. Once
 // authority removes this gun, that retained payload must stop travelling
 // with our new inventory. Keep the sequence and live projectile identities:
 // a shell fired before G may still legitimately hit a victim afterward.
 if(st.lastShot?.weapon===w){
  const shot=st.lastShot;st.lastShot=null;
  send({event:'lan-shot-retired',weapon:w,id:shot.id,life:shot.life,reason:'weapon-dropped'});
 }
 st.p.add(0x298+56*w).writeS32(0);
 const keys=st.p.add(0x1e60);
 for(let i=0;i<70;i++)if(keys.add(i).readU8()===w)keys.add(i).writeU8(255);
}
function applyDropGrant(g){
 if(g.playerId!==cfg.localPlayerId||loot.grants.has(g.id))return;
 loot.pendingDrop=null;
 if(g.life!==st.life||st.localDead||hp(st.p)<=0)return;
 const list=loot.inventory;
 if(list[g.removeSlot]!==g.weapon||!ownsItem(st.p,g.weapon)||g.selectedWeapon===g.weapon||
  (g.selectedWeapon!==0&&!ownsItem(st.p,g.selectedWeapon))){
  send({event:'lan-drop-rejected',id:g.id,reason:'inventory-changed'});
  lootHint('denied','장비 상태가 바뀌어 무기를 버리지 못했습니다.');return;
 }
 forgetWeapon(g.weapon);loot.inventory=[...g.inventory];
 if(!ownsItem(st.p,g.selectedWeapon)){nativeRegisterKey(st.m,g.selectedWeapon);nativePickup(st.p,g.selectedWeapon);}
 nativeFullEquip(st.p,g.selectedWeapon);boundedRemember(loot.grants,g.id);
 createDrop(g.drop);sendState();
 send({event:'lan-drop-applied',id:g.id,dropId:g.drop.id,weapon:g.weapon,inventory:[...loot.inventory],selectedWeapon:g.selectedWeapon});
 lootHint('dropped','무기를 버렸습니다. 다른 무기 가까이에서 E를 눌러 주우세요.',g.drop);
}
function removeDrop(id){
 boundedRemember(loot.removed,id);
 const d=loot.drops.get(id);
 if(!d)return;
 // Exact native active-byte removal; don't erase neighboring equal weapons.
 st.m.add(0xb0+d.index*0x5c).writeU8(0);
 loot.indices.delete(d.index);loot.drops.delete(id);
}
function createDrop(d){
 if(loot.removed.has(d.id)||loot.drops.has(d.id)||!safeSector(d.sector))return;
 const code=nativeDropCode(st.m.add(0x18).readPointer(),d.weapon),r=weaponRecord(st.p,d.weapon);
 if(code<0||r.capacity<1||d.magazine>r.capacity){send({event:'lan-drop-rejected',id:d.id,reason:'unsupported-native-item'});return;}
 let index=-1;
 for(let i=0;i<40;i++)if(!st.m.add(0xb0+i*0x5c).readU8()){index=i;break;}
 if(index<0){send({event:'lan-drop-rejected',id:d.id,reason:'native-pool-full'});return;}
 // The wire position is the donor's feet. Start the native radius-50 physics
 // object above the floor, matching the hidden native pickup experiment.
 const origin=[d.pos[0],d.pos[1]+150,d.pos[2]];
 nativeWorldDrop(st.m,(code&63)|64,...origin,0,0,0,d.sector,st.m.add(0x1760).readS32(),0);
 if(!st.m.add(0xb0+index*0x5c).readU8()){send({event:'lan-drop-rejected',id:d.id,reason:'native-create-failed'});return;}
 const item={...d,index,pending:false,lastAttempt:-10000};
 loot.drops.set(d.id,item);loot.indices.set(index,item);
 send({event:'lan-drop-created',id:d.id,index,weapon:d.weapon});
}
function applyGrant(g){
 // All peers remove the same authoritative item, only the named live player
 // changes inventory. Death after a claim must not award a later respawn.
 removeDrop(g.dropId);
 if(g.playerId!==cfg.localPlayerId||loot.grants.has(g.id))return;
 if(g.life!==st.life||st.localDead||hp(st.p)<=0){send({event:'lan-pickup-rejected',id:g.id,reason:'dead-or-stale-life'});return;}
 const list=loot.inventory,r=weaponRecord(st.p,g.weapon),slot=g.replaceSlot;
 if(slot>list.length||(list[slot]??255)!==g.replacedWeapon||
  list.some((w,i)=>i!==slot&&w===g.weapon)||r.capacity<1||g.magazine>r.capacity||
  nativeDropCode(st.m.add(0x18).readPointer(),g.weapon)<0){
  send({event:'lan-pickup-rejected',id:g.id,reason:'inventory-changed-or-invalid-ammo'});return;
 }
 const keys=st.p.add(0x1e60);
 if(!nativeRegisterKey(st.m,g.weapon)){send({event:'lan-pickup-rejected',id:g.id,reason:'native-key-list-full'});return;}
 nativePickup(st.p,g.weapon);
 st.p.add(0x2a4+56*g.weapon).writeS32(g.magazine);
 st.p.add(0x29c+56*g.weapon).writeS32(g.reserve+253);
 if(g.replacedWeapon!==255&&g.replacedWeapon!==g.weapon){
  st.p.add(0x298+56*g.replacedWeapon).writeS32(0);
  for(let i=0;i<70;i++)if(keys.add(i).readU8()===g.replacedWeapon)keys.add(i).writeU8(255);
  if(g.replacedWeapon===48)st.p.add(0x1ef4).writeS32(0);
  if(g.replacedWeapon===49)st.p.add(0x1eec).writeS32(0);
  if(g.replacedWeapon===51)st.p.add(0x1efc).writeS32(0);
 }
 list[slot]=g.weapon;boundedRemember(loot.grants,g.id);
 nativeFullEquip(st.p,g.weapon);sendState();
 send({event:'lan-pickup-applied',id:g.id,dropId:g.dropId,inventory:[...list],
  weapon:g.weapon,magazine:g.magazine,reserve:g.reserve});
 lootHint('picked','무기를 주웠습니다. 남은 탄약도 그대로 이어받았습니다.',g);
}
function lootMessage(x){
 if(x.type==='drop')createDrop(x.drop);
 else if(x.type==='drop-removed')removeDrop(x.dropId);
 else if(x.type==='pickup-grant')applyGrant(x.grant);
 else if(x.type==='pickup-denied'){
  const d=loot.drops.get(x.dropId);if(d)d.pending=false;
  const reason=String(x.reason||'');
  const message=reason==='weapon-already-owned'?'이미 보유 · G로 버린 뒤 E로 줍기':
   reason.includes('loadout')?'장비 조건 불충족 · G로 비운 뒤 E':
   reason.includes('distance')||reason.includes('far')||reason==='out-of-range'?'거리가 멉니다 · 가까이에서 E':
   reason.includes('claimed')||reason.includes('missing')?'다른 플레이어가 먼저 획득했습니다':'지금은 이 무기를 주울 수 없습니다.';
  lootHint('denied',message,d,{reason});
 }
 else if(x.type==='drop-grant')applyDropGrant(x.grant);
 else if(x.type==='drop-denied'){
  if(loot.pendingDrop?.requestId===x.requestId)loot.pendingDrop=null;
  lootHint('denied','버릴 수 없음 · 총 선택 후 G',null,{reason:String(x.reason||'')});
 }
}
function clearDrops(){for(const id of [...loot.drops.keys()])removeDrop(id);}
Interceptor.attach(P(0x452540),{
 onEnter(){
  if(!st.ready||!this.returnAddress.equals(P(0x4526b1)))return;
  this.block=true;this.index=this.context.ebx.toInt32();this.keys=st.p.add(0x1e60).readByteArray(70);
 },
 onLeave(result){
  if(!this.block)return;
  st.p.add(0x1e60).writeByteArray(this.keys);result.replace(0);
  const d=loot.indices.get(this.index);
  if(!d||st.localDead||hp(st.p)<=0)return;
  // The original routine already checked <300 native units and line of
  // sight. Keep that evidence; proximity alone never awards or claims loot.
  d.nearbyAt=now();const nearest=nearestLoot();
  if(nearest&&(loot.nearby!==nearest.id||now()-loot.lastHint>=600)){
   loot.nearby=nearest.id;loot.lastHint=now();
   lootHint('nearby','E: 바닥 무기 줍기 · G: 현재 무기 버리기',nearest);
  }
  if(loot.ePressed&&!loot.eConsumed&&nearest&&lootKeys().active){
   loot.eConsumed=claimPickup(nearest);
  }
 }
});
// 4a8330 is the native scan-code query used by the configurable action
// dispatcher (40a4f9). Reserve E/G for the authoritative LAN interaction so
// the original binding cannot also change inventory or perform an action.
Interceptor.attach(P(0x4a8330),{
 onEnter(args){this.reserved=st.ready&&(args[0].toInt32()===0x12||args[0].toInt32()===0x22);},
 onLeave(result){if(this.reserved)result.replace(0);}
});
Interceptor.attach(P(0x451380),{
 onEnter(){
  if(!st.ready||st.closed)return;
  const keys=lootKeys(),ePressed=keys.e&&!loot.eHeld,gPressed=keys.g&&!loot.gHeld;
  loot.eHeld=keys.e;loot.gHeld=keys.g;loot.ePressed=keys.active&&ePressed;loot.eConsumed=false;
  if(!keys.active||st.localDead||hp(st.p)<=0)return;
  if(gPressed)requestDrop();
  const nearby=nearestLoot();
  if(loot.ePressed&&nearby)loot.eConsumed=claimPickup(nearby);
  if(!nearby)loot.nearby=null;
 }
});
Interceptor.attach(P(0x462180),{
 onEnter(){if(st.ready&&this.context.ecx.equals(st.p))rememberDeathInventory();}
});

// Included inside lan_game_core's closure. Team spectators borrow only the
// render camera: no local actor is moved, healed, equipped, or made authoritative.
// Native evidence: original Karma.exe SHA256 aa824dda4d48c0304de3e9ab1c6012c542dc280eca93a6d507da9a21c4bbedab.
// 4166d0/416c40 draw after451380/44bfc0;401e90 updates a camera look-at,407780 its
// frustum,406100 its FOV. Only44b6b0 reads1064 for body exclusion/actor drawing.
// The held-weapon renderer46b750 changes live global weapon animation/effects;
// do not call it with a teammate's weapon or swap whole manager/actor objects.

// SPECTATOR_STATE_BEGIN
const spectator={targetId:null,active:false,waiting:false,pendingStep:0,
 leftHeld:false,rightHeld:false,frames:0,lastView:null,lastSentKey:null,
 lastSentAt:0,error:null,render:null,restores:0,renderEntrances:0,lastRenderPath:null,lastSkip:null};
function spectatorCandidates(){
 return peers.filter(p=>p.id!==selfId&&p.team===selfTeam&&!p.left&&!p.dead&&
  p.latest&&p.latest.hp>0&&vector(p.latest.pos)&&finite(p.latest.yaw,1e4)&&
  finite(p.latest.pitch,2)).sort((a,b)=>a.index-b.index);
}
function spectatorEligible(){
 return teamMode&&st.ready&&st.localDead&&!st.closed&&!intermission&&!nextRound&&!spectator.error;
}
function spectatorTarget(){return peers.find(p=>p.id===spectator.targetId)||null;}
function spectatorName(peer){
 return String(peer?.displayName||peer?.name||peer?.config?.displayName||
  peer?.config?.playerName||peer?.config?.name||peer?.config?.character?.name||'팀원').slice(0,96);
}
function spectatorView(pose){
 if(!pose||!vector(pose.pos)||!finite(pose.yaw,1e4)||!finite(pose.pitch,2))return null;
 const pitch=Math.max(-1.55,Math.min(1.55,pose.pitch));
 const cy=Math.cos(pose.yaw),sy=Math.sin(pose.yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 const height=finite(pose.eyeHeight,1000)&&pose.eyeHeight>=30?pose.eyeHeight:300;
 const eye=[pose.pos[0],pose.pos[1]+height,pose.pos[2]],direction=[cy*cp,sp,-sy*cp];
 return {eye,direction,yaw:pose.yaw,pitch,
  fov:finite(pose.viewFov,2.8)&&pose.viewFov>=.03?pose.viewFov:1.3089969389957472,
  // Original rotation order is Rz(pitch) * Ry(yaw); row0 is forward (+X).
  rotation:[cp*cy,sp,-cp*sy,0,-sp*cy,cp,sp*sy,0,sy,0,cy,0,0,0,0,1]};
}
function spectatorStatus(){
 const peer=spectatorTarget(),pose=peer?.latest,weapon=pose?.weapon;
 const ammo=pose?.ammo?.[weapon];
 return {active:spectator.active,targetId:spectator.active?peer?.id??null:null,
  targetName:spectator.active?spectatorName(peer):null,waiting:spectator.waiting,
  hp:spectator.active?pose?.hp??null:null,weapon:spectator.active?weapon??null:null,
  magazine:spectator.active&&integer(ammo?.magazine,0,100000)?ammo.magazine:null,
  reserve:spectator.active&&integer(ammo?.reserve,0,100000)?ammo.reserve:null,
  candidates:spectatorEligible()?spectatorCandidates().map(p=>({id:p.id,name:spectatorName(p)})):[],
  cameraFrames:spectator.frames,cameraRestores:spectator.restores,lastView:spectator.lastView,
  renderEntrances:spectator.renderEntrances,lastRenderPath:spectator.lastRenderPath,lastSkip:spectator.lastSkip,
  heldWeaponMirrored:false,error:spectator.error};
}
function spectatorRefresh(){
 const allowed=spectatorEligible(),options=allowed?spectatorCandidates():[];
 let index=options.findIndex(p=>p.id===spectator.targetId);
 if(index<0)index=0;
 if(options.length&&spectator.pendingStep)index=(index+spectator.pendingStep%options.length+options.length)%options.length;
 spectator.pendingStep=0;
 spectator.targetId=options[index]?.id??null;
 spectator.active=allowed&&!!spectator.targetId;
 spectator.waiting=allowed&&!spectator.active;
 const status=spectatorStatus(),key=JSON.stringify([status.active,status.waiting,status.targetId,
  status.targetName,status.hp,status.weapon,status.magazine,status.reserve,status.error,status.candidates]);
 const changedTarget=spectator.lastSentKey===null||spectator.sentTarget!==status.targetId||
  spectator.sentActive!==status.active||spectator.sentWaiting!==status.waiting;
 const heartbeat=(status.active||status.waiting)&&now()-spectator.lastSentAt>=1000;
 if(heartbeat||key!==spectator.lastSentKey&&(changedTarget||now()-spectator.lastSentAt>=250)){
  spectator.lastSentKey=key;spectator.lastSentAt=now();spectator.sentTarget=status.targetId;
  spectator.sentActive=status.active;spectator.sentWaiting=status.waiting;
  send({event:'lan-spectator',...status});
 }
 return spectatorTarget();
}
function spectatorCycle(step){
 if(step!==-1&&step!==1)throw Error('Spectator step must be -1 or 1');
 if(!spectatorEligible())return {accepted:false,reason:'not-spectating'};
 spectator.pendingStep+=step;return {accepted:true};
}
// SPECTATOR_STATE_END

const spectatorLookAt=new NativeFunction(P(0x401e90),'void',
 ['pointer','pointer','pointer','pointer'],'thiscall');
const spectatorFov=new NativeFunction(P(0x406100),'void',['pointer','float'],'thiscall');
const spectatorProjection=new NativeFunction(P(0x407a70),'void',['pointer','int'],'thiscall');
// Original44b64c sends the camera eye, look-at, frustum, and render sector to
// this portal-visibility walk. It updates world draw lists, not player physics.
const spectatorVisibility=new NativeFunction(P(0x443cd0),'void',
 ['pointer','int','float','float','float','float','float','float','pointer'],'thiscall');
const spectatorForeground=new NativeFunction(Process.getModuleByName('user32.dll').getExportByName('GetForegroundWindow'),
 'pointer',[],'stdcall');
let spectatorSetTransform=null,spectatorSetTransformAddress=null;
function spectatorDevice(camera){return camera.add(4).readPointer().add(0x7dc).readPointer();}
function spectatorTransform(device,type,matrix){
 const address=device.readPointer().add(0x94).readPointer();
 if(!spectatorSetTransformAddress||!address.equals(spectatorSetTransformAddress)){
  spectatorSetTransformAddress=address;
  spectatorSetTransform=new NativeFunction(address,'int',['pointer','uint','pointer'],'stdcall');
 }
 spectatorSetTransform(device,type,matrix);
}
function spectatorKeys(){
 let left=false,right=false,active=false;
 try{
  const app=P(0x548d5c).readPointer(),hwnd=P(0x548d50).readPointer();
  const input=app.isNull()?P(0):app.add(0x120).readPointer();
  if(!input.isNull()){
   // DirectInput DIK_LEFT/RIGHT (0xcb/0xcd), keyboard buffer starts at0x40.
   left=(input.add(0x10b).readU8()&0x80)!==0;
   right=(input.add(0x10d).readU8()&0x80)!==0;
  }
  active=spectatorEligible()&&!globalThis.KARMA_LOCAL_PAUSED&&!globalThis.KARMA_LOCAL_INPUT_PAUSED&&
   !hwnd.isNull()&&spectatorForeground().equals(hwnd);
 }catch(_){}
 // Remember keys while typing/paused, so closing chat cannot replay held arrows.
 if(active){
  if(left&&!spectator.leftHeld&&!right)spectatorCycle(-1);
  if(right&&!spectator.rightHeld&&!left)spectatorCycle(1);
 }
 spectator.leftHeld=left;spectator.rightHeld=right;
}
function spectatorFail(error){
 if(!spectator.error){
  spectator.error=String(error?.message||error).slice(0,240);
  send({event:'lan-spectator-error',message:spectator.error});
 }
 spectatorRefresh();
}
function spectatorRestore(frame){
 if(!frame||frame.restored)return;
 frame.restored=true;
 try{
  // Restore every byte touched by camera projection/view/frustum paths. The
  // range is bounded by original camera fields8..38f, never its device pointer.
  frame.camera.add(8).writeByteArray(frame.bytes);
  if(frame.visibilityChanged)spectatorVisibility(frame.world,frame.originalSector,
   ...vec(frame.camera,0x15c),...vec(frame.camera,0x168),frame.camera.add(0x2ec));
  spectatorTransform(frame.device,2,frame.camera.add(0x44));
  spectatorTransform(frame.device,3,frame.camera.add(0xd4));
  spectatorTransform(frame.device,256,frame.camera.add(0x11c));
  spectator.restores++;
 }finally{if(spectator.render===frame)spectator.render=null;}
}
function spectatorApply(app,peer){
 const camera=app.add(0x124).readPointer(),manager=app.add(0x128).readPointer();
 const skip=reason=>{spectator.lastSkip=reason;return null;};
 if(!st.m||!manager.equals(st.m))return skip('manager-mismatch');
 if(camera.isNull()||!camera.equals(st.m.add(0x1054).readPointer()))return skip('camera-mismatch');
 if(!peer.r||peer.r.isNull()||hp(peer.r)<=0||!integer(peer.index,1,7))return skip('target-actor');
 const view=spectatorView(peer.latest);if(!view)return skip('target-view');
 const world=manager.add(0xc).readPointer();if(world.isNull())return skip('world-unavailable');
 const originalSector=world.add(0x13b38).readS32()>0?world.add(0x13b3c).readS32():st.p.add(0x1b4c).readS32();
 const actorSector=peer.r.add(0x1b4c).readS32();
 const targetSector=safeSector(actorSector)?actorSector:peer.latest.sector;
 if(!safeSector(originalSector)||!safeSector(targetSector))return skip('sector:'+originalSector+'/'+targetSector);
 const frame={camera,manager,world,originalSector,device:spectatorDevice(camera),target:peer.index,
  thread:Process.getCurrentThreadId(),bytes:camera.add(8).readByteArray(0x388),restored:false};
 if(frame.device.isNull())return skip('device-unavailable');
 spectator.render=frame;
 try{
  // World transformation must not inherit a corpse's lean or camera offsets.
  putvec(camera,0x208,[0,0,0]);putvec(camera,0x1b0,[0,0,0]);putvec(camera,0x1bc,[1,1,1]);
  putvec(camera,0x15c,view.eye);putvec(camera,0x168,view.eye.map((v,i)=>v+view.direction[i]));
  putvec(camera,0x174,[0,1,0]);
  view.rotation.forEach((v,i)=>camera.add(0x1c8+i*4).writeFloat(v));
  camera.add(0x264).writeFloat(view.yaw);camera.add(0x268).writeFloat(view.pitch);
  camera.add(0x2e0).writeFloat(view.yaw);camera.add(0x344).writeFloat(peer.latest.eyeHeight||300);
  spectatorLookAt(camera.add(8),camera.add(0x15c),camera.add(0x168),camera.add(0x174));
  spectatorFov(camera,view.fov);spectatorProjection(camera,1);
  spectatorTransform(frame.device,2,camera.add(0x44));
  frame.visibilityChanged=true;
  spectatorVisibility(world,targetSector,...vec(camera,0x15c),...vec(camera,0x168),camera.add(0x2ec));
  spectator.frames++;
  spectator.lastSkip=null;
  spectator.lastView={targetId:peer.id,eye:vec(camera,0x15c),direction:view.direction,
   yaw:view.yaw,pitch:view.pitch,fov:camera.add(0x2c0).readFloat(),sector:targetSector,
   visibleSectors:world.add(0x13b38).readS32(),
   physicalLocalIndex:manager.add(0x1064).readS32(),localHp:hp(st.p),localPos:vec(st.p,0x1a40)};
  return frame;
 }catch(error){spectatorRestore(frame);throw error;}
}
Interceptor.attach(P(0x451380),{
 onLeave(){
  try{spectatorKeys();spectatorRefresh();}catch(error){spectatorFail(error);}
 }
});
for(const renderAddress of [0x4166d0,0x416c40])Interceptor.attach(P(renderAddress),{
 onEnter(){
  this.spectatorFrame=null;
  spectator.renderEntrances++;spectator.lastRenderPath='0x'+renderAddress.toString(16);
  try{
   if(spectator.render)return;
   const peer=spectatorRefresh();
   if(spectator.active&&peer)this.spectatorFrame=spectatorApply(this.context.ecx,peer);
  }catch(error){spectatorFail(error);}
 },
 onLeave(){
  try{spectatorRestore(this.spectatorFrame);}catch(error){spectatorFail(error);}
 }
});
Interceptor.attach(P(0x44b6b0),{
 onEnter(){
  this.spectatorIndex=null;
  const frame=spectator.render;
  if(!frame||frame.restored||frame.thread!==Process.getCurrentThreadId()||!this.context.ecx.equals(frame.manager))return;
  // This function only draws actor bodies. Restore before weapon/HUD drawing
  // and, crucially, before the next simulation/network/input update.
  this.spectatorIndex={manager:frame.manager,index:frame.manager.add(0x1064).readS32()};
  frame.manager.add(0x1064).writeS32(frame.target);
 },
 onLeave(){
  if(this.spectatorIndex)this.spectatorIndex.manager.add(0x1064).writeS32(this.spectatorIndex.index);
 }
});
rpc.exports=Object.assign(rpc.exports||{},{lanspectate:step=>spectatorCycle(step)});

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
 (x.viewFov===undefined||finite(x.viewFov,2.8)&&x.viewFov>=0.03)&&
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
 if(x.type==='match-snapshot')return Array.isArray(x.players)&&x.players.length<=8&&x.players.every(p=>idValid(p.playerId)&&integer(p.kills,0,1e6)&&integer(p.deaths,0,65535)&&(p.points===undefined||integer(p.points,0,1e9)))&&integer(x.remainingSeconds,0,86400);
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
// Both original Shift row renderers read Point from this encoded profile field,
// not the unused word between K/D. The server supplies this match's combat XP;
// do not run the original XP routine (425be0), which needs the defunct online client.
function setPoints(g,slot,points){g.add(0xfc8+slot*0x98).writeS32(points+12345);}
function scores(){return st.gm?Array.from({length:Math.max(0,...peers.map(p=>p.index))+1},(_,slot)=>({slot,playerId:playerId(slot),active:slot===0||!peerByIndex(slot)?.left,kills:st.gm.add(0x1458+slot*16).readS32(),deaths:st.gm.add(0x1460+slot*16).readU16(),points:st.gm.add(0xfc8+slot*0x98).readS32()-12345})):null;}
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
 const camera=st.m.add(0x1054).readPointer(),fov=camera.isNull()?NaN:camera.add(0x2c0).readFloat();
 return {pos,yaw:p.add(0x19b8).readFloat(),pitch:Number.isFinite(pitch)?pitch:0,
  sector:p.add(0x1b44).readS32(),weapon:p.add(0x290).readU8(),hp:Math.max(0,Math.min(100,hp(p))),
  stance:p.add(0x1970).readU8(),body:p.add(0x1971).readU8(),weaponAnim:p.add(0x1972).readU8(),
  eyeHeight:finite(height,1000)&&height>=30?height:300,...(finite(fov,2.8)&&fov>=0.03?{viewFov:fov}:{}),paused:globalThis.KARMA_LOCAL_INPUT_PAUSED===true,
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
 setPoints(g,i,0);
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
  st.gm.add(0x1458+index*16).writeS32(p.kills);st.gm.add(0x1460+index*16).writeU16(p.deaths);
  if(p.points!==undefined)setPoints(st.gm,index,p.points);}
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
  for(let i=0;i<8;i++)setPoints(g,i,0);
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
const mapDefinitions=[{"id":"NMP_ryuba","name":"Mass of Winter","mapIndex":0,"age":0,"nativeMode":1,"publicReady":true,"dmSpawns":[{"sectorName":"1","position":[-3846,400,-7446],"yawDegrees":90},{"sectorName":"1","position":[5315,400,-8272],"yawDegrees":90},{"sectorName":"1","position":[5037,400,-16531],"yawDegrees":270},{"sectorName":"1","position":[-5837,400,-18965],"yawDegrees":270},{"sectorName":"5","position":[-3650,1400,-13551],"yawDegrees":270},{"sectorName":"6","position":[-147,1400,-8212],"yawDegrees":90},{"sectorName":"2","position":[-908,400,-8500],"yawDegrees":0},{"sectorName":"3","position":[2192,1200,-1314],"yawDegrees":90}],"teamSpawns":[{"sectorName":"1","position":[-10306,400,-22556],"yawDegrees":0},{"sectorName":"1","position":[-10717,400,-22174],"yawDegrees":0},{"sectorName":"1","position":[-10133,400,-22298],"yawDegrees":0},{"sectorName":"1","position":[-9537,400,-22387],"yawDegrees":0},{"sectorName":"3","position":[3401,1200,-2473],"yawDegrees":180},{"sectorName":"3","position":[2916,1200,-1252],"yawDegrees":90},{"sectorName":"3","position":[5321,2120,-13],"yawDegrees":180},{"sectorName":"3","position":[4325,2120,896],"yawDegrees":90}],"releaseOrder":0,"sniperMap":false},{"id":"NMP_Drain","name":"Drain","mapIndex":1,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"18","position":[-11658.0,0.0,-3398.0],"yawDegrees":0.0},{"sectorName":"21","position":[-1249.0,0.0,-6301.0],"yawDegrees":180.0},{"sectorName":"16","position":[-5172.0,0.0,2544.0],"yawDegrees":0.0},{"sectorName":"14","position":[-1178.0,360.0,5874.0],"yawDegrees":90.0},{"sectorName":"11","position":[-807.0,-1000.0,337.0],"yawDegrees":0.0},{"sectorName":"12","position":[822.0,-1000.0,-5210.0],"yawDegrees":270.0},{"sectorName":"5","position":[7762.0,0.0,-5883.0],"yawDegrees":270.0},{"sectorName":"8","position":[4474.0,0.0,1827.0],"yawDegrees":270.0}],"teamSpawns":[{"sectorName":"1","position":[11994.0,0.0,3766.0],"yawDegrees":180.0},{"sectorName":"1","position":[10034.0,0.0,3836.0],"yawDegrees":90.0},{"sectorName":"1","position":[11968.0,0.0,2538.0],"yawDegrees":180.0},{"sectorName":"1","position":[9473.0,0.0,2806.0],"yawDegrees":90.0},{"sectorName":"18","position":[-11726.0,0.0,-3308.0],"yawDegrees":0.0},{"sectorName":"18","position":[-9302.0,0.0,-1762.0],"yawDegrees":270.0},{"sectorName":"18","position":[-11875.0,0.0,-1712.0],"yawDegrees":0.0},{"sectorName":"18","position":[-10265.0,0.0,-3391.0],"yawDegrees":270.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":0,"sniperMap":false},{"id":"NMP_pastoraltown","name":"Pastoraltown","mapIndex":2,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"9","position":[7950.0,0.0,813.0],"yawDegrees":128.0},{"sectorName":"8","position":[4898.0,332.0,3343.0],"yawDegrees":125.0},{"sectorName":"11","position":[-1830.0,0.0,4603.0],"yawDegrees":355.0},{"sectorName":"1","position":[-4194.0,639.0,3192.0],"yawDegrees":215.0},{"sectorName":"14","position":[-1641.0,40.0,-4053.0],"yawDegrees":304.0},{"sectorName":"13","position":[-1192.0,720.0,-1024.0],"yawDegrees":232.0},{"sectorName":"16","position":[2119.0,0.0,-1279.0],"yawDegrees":311.0},{"sectorName":"7","position":[3666.0,0.0,-6918.0],"yawDegrees":187.0}],"teamSpawns":[{"sectorName":"10","position":[8584.0,0.0,-4709.0],"yawDegrees":180.0},{"sectorName":"10","position":[8575.0,0.0,-4192.0],"yawDegrees":180.0},{"sectorName":"10","position":[8563.0,0.0,-3480.0],"yawDegrees":180.0},{"sectorName":"10","position":[8471.0,0.0,-2923.0],"yawDegrees":180.0},{"sectorName":"12","position":[-6670.0,40.0,6312.0],"yawDegrees":8.0},{"sectorName":"12","position":[-6849.0,40.0,6036.0],"yawDegrees":8.0},{"sectorName":"12","position":[-6725.0,40.0,5396.0],"yawDegrees":3.0},{"sectorName":"12","position":[-6125.0,40.0,5362.0],"yawDegrees":3.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":0,"sniperMap":false},{"id":"NMP_bunker","name":"Bunker","mapIndex":3,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"19","position":[-876.0,-400.0,-12119.0],"yawDegrees":270.0},{"sectorName":"19","position":[-5239.0,-400.0,-7369.0],"yawDegrees":292.0},{"sectorName":"19","position":[-9248.0,-400.0,-4217.0],"yawDegrees":270.0},{"sectorName":"19","position":[3932.0,-400.0,-10711.0],"yawDegrees":247.0},{"sectorName":"19","position":[5915.0,-400.0,-4446.0],"yawDegrees":255.0},{"sectorName":"19","position":[5498.0,398.0,6663.0],"yawDegrees":78.0},{"sectorName":"2","position":[518.0,1039.0,7479.0],"yawDegrees":90.0},{"sectorName":"3","position":[-1453.0,1039.0,7426.0],"yawDegrees":90.0}],"teamSpawns":[{"sectorName":"20","position":[8337.0,-399.0,-10386.0],"yawDegrees":180.0},{"sectorName":"20","position":[7604.0,-399.0,-10400.0],"yawDegrees":180.0},{"sectorName":"19","position":[6949.0,-400.0,-10180.0],"yawDegrees":180.0},{"sectorName":"19","position":[6416.0,-400.0,-10476.0],"yawDegrees":180.0},{"sectorName":"8","position":[2776.0,1039.0,9972.0],"yawDegrees":180.0},{"sectorName":"8","position":[1547.0,1039.0,9234.0],"yawDegrees":266.0},{"sectorName":"8","position":[473.0,1039.0,9256.0],"yawDegrees":276.0},{"sectorName":"8","position":[1281.0,1039.0,9995.0],"yawDegrees":180.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":0,"sniperMap":false},{"id":"NMP_rescue","name":"Rescue","mapIndex":4,"age":0,"nativeMode":1,"publicReady":true,"dmSpawns":[{"sectorName":"1","position":[4457,19.397232,804],"yawDegrees":206},{"sectorName":"1","position":[3391,-119.115768,-467],"yawDegrees":251},{"sectorName":"1","position":[-3581,-119.115772,3237],"yawDegrees":30},{"sectorName":"1","position":[-1569,1127.319616,8847],"yawDegrees":57},{"sectorName":"1","position":[644,381.044678,13902],"yawDegrees":129},{"sectorName":"1","position":[-8682,251.066375,8499],"yawDegrees":59},{"sectorName":"1","position":[-6401,10.044989,397],"yawDegrees":253},{"sectorName":"1","position":[-11709,35.10997,-2692],"yawDegrees":322}],"teamSpawns":[{"sectorName":"1","position":[-10962,0,-5880],"yawDegrees":260},{"sectorName":"1","position":[-11693,0,-5896],"yawDegrees":276},{"sectorName":"1","position":[-12297,0,-5788],"yawDegrees":284},{"sectorName":"1","position":[-12901,0,-5521],"yawDegrees":293},{"sectorName":"1","position":[-2331,-119.115773,4215],"yawDegrees":45},{"sectorName":"1","position":[-1851,-119.115771,3896],"yawDegrees":45},{"sectorName":"1","position":[-1547,-119.115768,3460],"yawDegrees":34},{"sectorName":"1","position":[-3253,-119.115768,2520],"yawDegrees":12}],"releaseOrder":0,"sniperMap":false},{"id":"NMP_factory2","name":"Factory 2","mapIndex":5,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"2","position":[14473.0,137.0,7540.0],"yawDegrees":43.0},{"sectorName":"1","position":[13295.0,-989.0,6842.0],"yawDegrees":82.0},{"sectorName":"7","position":[12681.0,-989.0,-8026.0],"yawDegrees":263.0},{"sectorName":"8","position":[11600.0,137.0,-8733.0],"yawDegrees":235.0},{"sectorName":"9","position":[7903.0,-989.0,-961.0],"yawDegrees":345.0},{"sectorName":"3","position":[17493.0,-989.0,285.0],"yawDegrees":173.0},{"sectorName":"9","position":[17542.0,-1766.0,-1141.0],"yawDegrees":135.0},{"sectorName":"3","position":[8421.0,-1766.0,120.0],"yawDegrees":310.0}],"teamSpawns":[{"sectorName":"7","position":[11789.0,-989.0,-7683.0],"yawDegrees":270.0},{"sectorName":"7","position":[10979.0,-989.0,-7713.0],"yawDegrees":270.0},{"sectorName":"7","position":[10414.0,-989.0,-7587.0],"yawDegrees":270.0},{"sectorName":"7","position":[11093.0,-989.0,-7120.0],"yawDegrees":270.0},{"sectorName":"1","position":[15628.0,-989.0,6525.0],"yawDegrees":90.0},{"sectorName":"1","position":[15063.0,-989.0,6540.0],"yawDegrees":90.0},{"sectorName":"1","position":[14577.0,-989.0,6553.0],"yawDegrees":90.0},{"sectorName":"1","position":[13985.0,-989.0,6568.0],"yawDegrees":90.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":0,"sniperMap":false},{"id":"NMP_alexander","name":"Alexander","mapIndex":6,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"5","position":[-1249.0,1000.0,-14034.0],"yawDegrees":269.0},{"sectorName":"3","position":[-596.0,1000.0,-13536.0],"yawDegrees":90.0},{"sectorName":"1","position":[9152.0,1000.0,-17069.0],"yawDegrees":180.0},{"sectorName":"4","position":[2157.0,1000.0,-13320.0],"yawDegrees":257.0},{"sectorName":"9","position":[-6436.0,1000.0,-13886.0],"yawDegrees":271.0},{"sectorName":"8","position":[-11208.0,1000.0,-12588.0],"yawDegrees":306.0},{"sectorName":"7","position":[-9308.0,1000.0,-17774.0],"yawDegrees":352.0},{"sectorName":"7","position":[-2607.0,1000.0,-17186.0],"yawDegrees":330.0}],"teamSpawns":[{"sectorName":"1","position":[9355.0,1000.0,-15156.0],"yawDegrees":183.0},{"sectorName":"1","position":[9312.0,1000.0,-15885.0],"yawDegrees":183.0},{"sectorName":"1","position":[9348.0,1000.0,-16498.0],"yawDegrees":183.0},{"sectorName":"1","position":[9308.0,1000.0,-17185.0],"yawDegrees":180.0},{"sectorName":"8","position":[-11350.0,1000.0,-10267.0],"yawDegrees":357.0},{"sectorName":"8","position":[-11344.0,1000.0,-10870.0],"yawDegrees":357.0},{"sectorName":"8","position":[-11312.0,1000.0,-11533.0],"yawDegrees":357.0},{"sectorName":"8","position":[-11349.0,1000.0,-12224.0],"yawDegrees":311.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":0,"sniperMap":false},{"id":"NMP_Factory","name":"Factory","mapIndex":7,"age":0,"nativeMode":1,"publicReady":true,"dmSpawns":[{"sectorName":"3","position":[1827,600,-3659],"yawDegrees":90},{"sectorName":"9","position":[6372,300,-985],"yawDegrees":90},{"sectorName":"6","position":[8206,600,-5573],"yawDegrees":180},{"sectorName":"7","position":[10181,-149.999996,-6954],"yawDegrees":180},{"sectorName":"2","position":[-660,600,-12150],"yawDegrees":270},{"sectorName":"5","position":[-149,1600,-10071],"yawDegrees":0},{"sectorName":"6","position":[7758,1600,-9816],"yawDegrees":270},{"sectorName":"5","position":[1619,600,-13959],"yawDegrees":0}],"teamSpawns":[{"sectorName":"5","position":[4340,300,-12778],"yawDegrees":270},{"sectorName":"5","position":[3405,300,-12778],"yawDegrees":270},{"sectorName":"5","position":[3381,439.776282,-13901],"yawDegrees":270},{"sectorName":"5","position":[4507,426.277109,-13812],"yawDegrees":270},{"sectorName":"9","position":[5910,300,-2101],"yawDegrees":90},{"sectorName":"9","position":[5873,398.079367,-291],"yawDegrees":90},{"sectorName":"9","position":[6837,400.978233,-272],"yawDegrees":90},{"sectorName":"9","position":[6860,300,-1395],"yawDegrees":90}],"releaseOrder":0,"sniperMap":false},{"id":"NMP_Castle","name":"Castle","mapIndex":8,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"1","position":[-3156.0,357.0,-8541.0],"yawDegrees":0.0},{"sectorName":"2","position":[-3908.0,908.0,-5301.0],"yawDegrees":228.0},{"sectorName":"7","position":[-5130.0,351.0,465.0],"yawDegrees":268.0},{"sectorName":"5","position":[-3658.0,351.0,2474.0],"yawDegrees":268.0},{"sectorName":"8","position":[1074.0,351.0,7494.0],"yawDegrees":270.0},{"sectorName":"9","position":[4682.0,1441.0,-4818.0],"yawDegrees":269.0},{"sectorName":"4","position":[4443.0,876.0,3657.0],"yawDegrees":127.0},{"sectorName":"3","position":[1431.0,983.0,-4572.0],"yawDegrees":179.0}],"teamSpawns":[{"sectorName":"1","position":[-2816.0,351.0,-10755.0],"yawDegrees":270.0},{"sectorName":"1","position":[-2422.0,351.0,-9800.0],"yawDegrees":270.0},{"sectorName":"1","position":[-2767.0,351.0,-9075.0],"yawDegrees":270.0},{"sectorName":"1","position":[-2427.0,351.0,-8503.0],"yawDegrees":270.0},{"sectorName":"9","position":[4562.0,1441.0,-7795.0],"yawDegrees":270.0},{"sectorName":"9","position":[4768.0,1441.0,-7092.0],"yawDegrees":270.0},{"sectorName":"9","position":[4422.0,1441.0,-6256.0],"yawDegrees":270.0},{"sectorName":"9","position":[4778.0,1441.0,-5483.0],"yawDegrees":270.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":6,"sniperMap":false},{"id":"NMP_park","name":"Village","mapIndex":9,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"15","position":[-3046.0,893.0,-3583.0],"yawDegrees":0.0},{"sectorName":"5","position":[3981.0,893.0,-4542.0],"yawDegrees":180.0},{"sectorName":"15","position":[-2742.0,0.0,-3980.0],"yawDegrees":270.0},{"sectorName":"4","position":[-5527.0,603.0,2334.0],"yawDegrees":13.0},{"sectorName":"9","position":[-1742.0,0.0,4765.0],"yawDegrees":90.0},{"sectorName":"14","position":[4548.0,893.0,-286.0],"yawDegrees":270.0},{"sectorName":"12","position":[5652.0,0.0,-1467.0],"yawDegrees":270.0},{"sectorName":"14","position":[4506.0,0.0,-1312.0],"yawDegrees":270.0}],"teamSpawns":[{"sectorName":"4","position":[-4924.0,802.0,2067.0],"yawDegrees":0.0},{"sectorName":"4","position":[-4848.0,827.0,2654.0],"yawDegrees":0.0},{"sectorName":"4","position":[-5183.0,717.0,2622.0],"yawDegrees":0.0},{"sectorName":"4","position":[-5257.0,692.0,2185.0],"yawDegrees":0.0},{"sectorName":"5","position":[331.0,893.0,-4466.0],"yawDegrees":0.0},{"sectorName":"5","position":[341.0,893.0,-4909.0],"yawDegrees":340.0},{"sectorName":"5","position":[351.0,893.0,-5352.0],"yawDegrees":320.0},{"sectorName":"5","position":[-118.0,893.0,-4520.0],"yawDegrees":0.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":5,"sniperMap":false},{"id":"NMP_Baggage","name":"Baggage","mapIndex":10,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"1","position":[5342.0,962.0,5492.0],"yawDegrees":330.0},{"sectorName":"1","position":[9710.0,-2.0,-1200.0],"yawDegrees":154.0},{"sectorName":"1","position":[4057.0,-2.0,-7019.0],"yawDegrees":270.0},{"sectorName":"1","position":[1252.0,-2.0,720.0],"yawDegrees":170.0},{"sectorName":"1","position":[-3219.0,984.0,5008.0],"yawDegrees":60.0},{"sectorName":"1","position":[-8913.0,993.0,3600.0],"yawDegrees":0.0},{"sectorName":"2","position":[-8695.0,184.0,-6445.0],"yawDegrees":270.0},{"sectorName":"2","position":[-2751.0,1319.0,-7383.0],"yawDegrees":180.0}],"teamSpawns":[{"sectorName":"1","position":[-10003.0,-2.0,-7176.0],"yawDegrees":270.0},{"sectorName":"1","position":[-10003.0,-2.0,-6418.0],"yawDegrees":270.0},{"sectorName":"1","position":[-10741.0,-2.0,-6308.0],"yawDegrees":270.0},{"sectorName":"1","position":[-10755.0,-2.0,-6750.0],"yawDegrees":270.0},{"sectorName":"3","position":[9690.0,1190.0,6507.0],"yawDegrees":180.0},{"sectorName":"3","position":[8485.0,1181.0,7046.0],"yawDegrees":90.0},{"sectorName":"3","position":[8965.0,1189.0,5927.0],"yawDegrees":270.0},{"sectorName":"3","position":[8002.0,1181.0,6529.0],"yawDegrees":0.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":10,"sniperMap":false},{"id":"NMP_Flowerbed","name":"Flowerbed","mapIndex":11,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"1","position":[4250.0,0.0,-5666.0],"yawDegrees":180.0},{"sectorName":"2","position":[-3011.0,0.0,-3932.0],"yawDegrees":0.0},{"sectorName":"2","position":[-2671.0,0.0,267.0],"yawDegrees":0.0},{"sectorName":"2","position":[2827.0,0.0,2275.0],"yawDegrees":90.0},{"sectorName":"3","position":[3414.0,377.0,4338.0],"yawDegrees":135.0},{"sectorName":"2","position":[-3667.0,2.0,6951.0],"yawDegrees":0.0},{"sectorName":"2","position":[3943.0,0.0,6172.0],"yawDegrees":90.0},{"sectorName":"3","position":[84.0,1396.0,6507.0],"yawDegrees":90.0}],"teamSpawns":[{"sectorName":"1","position":[28.0,0.0,-6726.0],"yawDegrees":270.0},{"sectorName":"1","position":[888.0,0.0,-6716.0],"yawDegrees":270.0},{"sectorName":"1","position":[1503.0,0.0,-6725.0],"yawDegrees":270.0},{"sectorName":"1","position":[2242.0,0.0,-6717.0],"yawDegrees":270.0},{"sectorName":"3","position":[-3660.0,1396.0,3624.0],"yawDegrees":0.0},{"sectorName":"3","position":[-3656.0,1396.0,5401.0],"yawDegrees":0.0},{"sectorName":"3","position":[3648.0,1396.0,5414.0],"yawDegrees":241.0},{"sectorName":"3","position":[3662.0,1396.0,3586.0],"yawDegrees":180.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":2,"sniperMap":false},{"id":"NMP_training","name":"Training camp","mapIndex":12,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"plane01","position":[17.0,-206.0,3601.0],"yawDegrees":99.0},{"sectorName":"plane01","position":[-3005.0,-245.0,4136.0],"yawDegrees":35.0},{"sectorName":"plane01","position":[-6989.0,0.0,4308.0],"yawDegrees":18.0},{"sectorName":"plane01","position":[-8011.0,0.0,555.0],"yawDegrees":5.0},{"sectorName":"plane01","position":[5439.0,0.0,2075.0],"yawDegrees":178.0},{"sectorName":"plane01","position":[-5341.0,0.0,-3016.0],"yawDegrees":315.0},{"sectorName":"plane01","position":[37.0,0.0,-3714.0],"yawDegrees":274.0},{"sectorName":"plane01","position":[3154.0,0.0,-2429.0],"yawDegrees":228.0}],"teamSpawns":[{"sectorName":"plane01","position":[-7792.0,0.0,4075.0],"yawDegrees":55.0},{"sectorName":"plane01","position":[-6990.0,0.0,4427.0],"yawDegrees":29.0},{"sectorName":"plane01","position":[-8134.0,0.0,1576.0],"yawDegrees":355.0},{"sectorName":"plane01","position":[-8411.0,0.0,4102.0],"yawDegrees":358.0},{"sectorName":"plane01","position":[4594.0,210.0,4283.0],"yawDegrees":91.0},{"sectorName":"plane01","position":[5161.0,210.0,4273.0],"yawDegrees":91.0},{"sectorName":"plane01","position":[4289.0,210.0,4287.0],"yawDegrees":90.0},{"sectorName":"plane01","position":[3979.0,210.0,4292.0],"yawDegrees":73.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":3,"sniperMap":false},{"id":"NMP_armedtrain","name":"Armed Train","mapIndex":13,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"1","position":[1841.0,798.0,6538.0],"yawDegrees":130.0},{"sectorName":"1","position":[-2968.0,-1124.0,74.0],"yawDegrees":153.0},{"sectorName":"1","position":[-10496.0,-1868.0,-952.0],"yawDegrees":170.0},{"sectorName":"1","position":[-19646.0,-1773.0,1955.0],"yawDegrees":227.0},{"sectorName":"1","position":[-20030.0,798.0,8657.0],"yawDegrees":108.0},{"sectorName":"6","position":[-15620.0,798.0,1195.0],"yawDegrees":45.0},{"sectorName":"1","position":[-9093.0,798.0,1075.0],"yawDegrees":337.0},{"sectorName":"6","position":[-13091.0,798.0,1760.0],"yawDegrees":1.0}],"teamSpawns":[{"sectorName":"1","position":[2797.0,798.0,15203.0],"yawDegrees":96.0},{"sectorName":"1","position":[2074.0,798.0,14952.0],"yawDegrees":96.0},{"sectorName":"1","position":[2007.0,798.0,14393.0],"yawDegrees":96.0},{"sectorName":"1","position":[1836.0,798.0,13659.0],"yawDegrees":96.0},{"sectorName":"1","position":[-20345.0,810.0,11738.0],"yawDegrees":86.0},{"sectorName":"1","position":[-21008.0,793.0,11441.0],"yawDegrees":86.0},{"sectorName":"1","position":[-20986.0,794.0,11088.0],"yawDegrees":86.0},{"sectorName":"1","position":[-20406.0,803.0,10865.0],"yawDegrees":86.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":7,"sniperMap":false},{"id":"NMP_partisan","name":"Partisan","mapIndex":14,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"1","position":[-8921.0,662.0,12692.0],"yawDegrees":133.0},{"sectorName":"1","position":[-15911.0,725.0,9371.0],"yawDegrees":269.0},{"sectorName":"1","position":[-18570.0,846.0,10757.0],"yawDegrees":164.0},{"sectorName":"1","position":[-24538.0,137.0,9466.0],"yawDegrees":260.0},{"sectorName":"1","position":[-26753.0,119.0,16567.0],"yawDegrees":30.0},{"sectorName":"1","position":[-20190.0,-463.0,17184.0],"yawDegrees":147.0},{"sectorName":"3","position":[-23826.0,-867.0,15834.0],"yawDegrees":79.0},{"sectorName":"2","position":[-24811.0,-881.0,17022.0],"yawDegrees":126.0}],"teamSpawns":[{"sectorName":"1","position":[-22041.0,-462.0,19289.0],"yawDegrees":128.0},{"sectorName":"1","position":[-21637.0,-462.0,18968.0],"yawDegrees":128.0},{"sectorName":"1","position":[-21136.0,-463.0,18148.0],"yawDegrees":128.0},{"sectorName":"1","position":[-21392.0,-463.0,17769.0],"yawDegrees":128.0},{"sectorName":"1","position":[-9071.0,662.0,11425.0],"yawDegrees":158.0},{"sectorName":"1","position":[-9375.0,662.0,11954.0],"yawDegrees":142.0},{"sectorName":"1","position":[-9915.0,662.0,12159.0],"yawDegrees":136.0},{"sectorName":"1","position":[-10140.0,662.0,10592.0],"yawDegrees":293.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":8,"sniperMap":false},{"id":"NMP_laboratory","name":"Laboratory","mapIndex":15,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"7","position":[-797.0,0.0,-8856.0],"yawDegrees":267.0},{"sectorName":"5","position":[1141.0,-600.0,-9973.0],"yawDegrees":320.0},{"sectorName":"4","position":[3949.0,-600.0,-6426.0],"yawDegrees":358.0},{"sectorName":"2","position":[8601.0,0.0,-1875.0],"yawDegrees":116.0},{"sectorName":"3","position":[2860.0,0.0,-825.0],"yawDegrees":156.0},{"sectorName":"6","position":[-2698.0,-200.0,-5098.0],"yawDegrees":2.0},{"sectorName":"1","position":[-1793.0,0.0,-3133.0],"yawDegrees":328.0},{"sectorName":"4","position":[9443.0,-600.0,-4516.0],"yawDegrees":176.0}],"teamSpawns":[{"sectorName":"4","position":[2617.0,-600.0,-7212.0],"yawDegrees":358.0},{"sectorName":"4","position":[2602.0,-600.0,-6667.0],"yawDegrees":358.0},{"sectorName":"4","position":[3157.0,-600.0,-6900.0],"yawDegrees":358.0},{"sectorName":"4","position":[3261.0,-600.0,-6405.0],"yawDegrees":358.0},{"sectorName":"7","position":[-1718.0,0.0,-9361.0],"yawDegrees":294.0},{"sectorName":"7","position":[-1173.0,0.0,-9375.0],"yawDegrees":294.0},{"sectorName":"7","position":[-570.0,0.0,-9395.0],"yawDegrees":273.0},{"sectorName":"7","position":[125.0,0.0,-9367.0],"yawDegrees":260.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":4,"sniperMap":false},{"id":"NMP_poland","name":"Poland","mapIndex":16,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"1","position":[2766.0,-2.0,-1186.0],"yawDegrees":90.0},{"sectorName":"4","position":[3882.0,49.0,-6805.0],"yawDegrees":223.0},{"sectorName":"4","position":[4584.0,747.0,-5358.0],"yawDegrees":177.0},{"sectorName":"4","position":[6424.0,-695.0,-6695.0],"yawDegrees":230.0},{"sectorName":"5","position":[-4375.0,49.0,-4796.0],"yawDegrees":218.0},{"sectorName":"2","position":[-1021.0,43.0,4430.0],"yawDegrees":133.0},{"sectorName":"8","position":[1056.0,-800.0,5544.0],"yawDegrees":131.0},{"sectorName":"1","position":[4333.0,-695.0,1018.0],"yawDegrees":134.0}],"teamSpawns":[{"sectorName":"7","position":[-5756.0,7.0,5053.0],"yawDegrees":15.0},{"sectorName":"7","position":[-5630.0,0.0,4228.0],"yawDegrees":6.0},{"sectorName":"7","position":[-5496.0,7.0,3315.0],"yawDegrees":357.0},{"sectorName":"7","position":[-4958.0,7.0,5695.0],"yawDegrees":40.0},{"sectorName":"6","position":[9426.0,0.0,-6503.0],"yawDegrees":244.0},{"sectorName":"6","position":[8751.0,0.0,-6628.0],"yawDegrees":244.0},{"sectorName":"6","position":[9534.0,0.0,-5593.0],"yawDegrees":227.0},{"sectorName":"6","position":[9299.0,0.0,-4860.0],"yawDegrees":217.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":12,"sniperMap":false},{"id":"NMP_petersburg","name":"Petersburg","mapIndex":17,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"16","position":[-3452.0,0.0,-9419.0],"yawDegrees":276.0},{"sectorName":"14","position":[1279.0,0.0,-4257.0],"yawDegrees":182.0},{"sectorName":"18","position":[-7561.0,0.0,-7248.0],"yawDegrees":270.0},{"sectorName":"20","position":[-9852.0,0.0,-120.0],"yawDegrees":0.0},{"sectorName":"1","position":[-3457.0,156.0,3719.0],"yawDegrees":90.0},{"sectorName":"6","position":[6236.0,0.0,4912.0],"yawDegrees":180.0},{"sectorName":"4","position":[-1313.0,700.0,-2253.0],"yawDegrees":90.0},{"sectorName":"2","position":[5588.0,600.0,-4862.0],"yawDegrees":267.0}],"teamSpawns":[{"sectorName":"18","position":[-6990.0,0.0,-6585.0],"yawDegrees":270.0},{"sectorName":"18","position":[-6979.0,0.0,-5703.0],"yawDegrees":0.0},{"sectorName":"18","position":[-8054.0,0.0,-5655.0],"yawDegrees":180.0},{"sectorName":"18","position":[-8059.0,0.0,-6484.0],"yawDegrees":270.0},{"sectorName":"6","position":[6533.0,0.0,4636.0],"yawDegrees":180.0},{"sectorName":"6","position":[5573.0,0.0,4567.0],"yawDegrees":180.0},{"sectorName":"6","position":[6747.0,0.0,5578.0],"yawDegrees":180.0},{"sectorName":"6","position":[5597.0,0.0,5638.0],"yawDegrees":90.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":11,"sniperMap":false},{"id":"NMP_sektor312","name":"Enemy at the gate","mapIndex":18,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"1","position":[1915.0,1.0,1706.0],"yawDegrees":138.0},{"sectorName":"1","position":[-3379.0,0.0,-1664.0],"yawDegrees":354.0},{"sectorName":"1","position":[-3396.0,0.0,1750.0],"yawDegrees":10.0},{"sectorName":"1","position":[3110.0,103.0,-1827.0],"yawDegrees":219.0},{"sectorName":"1","position":[2982.0,27.0,1361.0],"yawDegrees":90.0},{"sectorName":"1","position":[2521.0,27.0,1060.0],"yawDegrees":90.0},{"sectorName":"7","position":[-3171.0,34.0,994.0],"yawDegrees":0.0},{"sectorName":"6","position":[-3145.0,34.0,4.0],"yawDegrees":0.0}],"teamSpawns":[{"sectorName":"1","position":[2982.0,27.0,1361.0],"yawDegrees":90.0},{"sectorName":"1","position":[2521.0,27.0,1060.0],"yawDegrees":90.0},{"sectorName":"1","position":[1915.0,1.0,1706.0],"yawDegrees":138.0},{"sectorName":"1","position":[3110.0,103.0,-1827.0],"yawDegrees":219.0},{"sectorName":"7","position":[-3171.0,34.0,994.0],"yawDegrees":0.0},{"sectorName":"6","position":[-3145.0,34.0,4.0],"yawDegrees":0.0},{"sectorName":"5","position":[-3145.0,34.0,-995.0],"yawDegrees":0.0},{"sectorName":"4","position":[-3145.0,634.0,1004.0],"yawDegrees":0.0}],"maxPlayers":8,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":1,"sniperMap":true},{"id":"NMP_mirrorsniper","name":"Honor","mapIndex":19,"age":0,"nativeMode":1,"publicReady":false,"dmSpawns":[{"sectorName":"1","position":[17.0,1798.0,2925.0],"yawDegrees":270.0},{"sectorName":"1","position":[-26.0,1798.0,-2639.0],"yawDegrees":90.0},{"sectorName":"1","position":[-4886.0,1798.0,-511.0],"yawDegrees":0.0},{"sectorName":"1","position":[-4876.0,1798.0,658.0],"yawDegrees":0.0}],"teamSpawns":[{"sectorName":"1","position":[-4886.0,1798.0,-511.0],"yawDegrees":0.0},{"sectorName":"1","position":[-4876.0,1798.0,658.0],"yawDegrees":0.0},{"sectorName":"1","position":[-4886.0,1798.0,-511.0],"yawDegrees":0.0},{"sectorName":"1","position":[-4876.0,1798.0,658.0],"yawDegrees":0.0},{"sectorName":"1","position":[4870.0,1798.0,609.0],"yawDegrees":180.0},{"sectorName":"1","position":[4864.0,1798.0,-628.0],"yawDegrees":180.0},{"sectorName":"1","position":[4870.0,1798.0,609.0],"yawDegrees":180.0},{"sectorName":"1","position":[4864.0,1798.0,-628.0],"yawDegrees":180.0}],"maxPlayers":4,"minClientBuild":"karma290-central6","spawnSource":"original-fsd","validation":"\uc6d0\ubcf8 \uc2a4\ud3f0 \uad6c\uc870 \uac80\uc0ac \u00b7 \uc2e4\uc804 \ud655\uc778 \ud544\uc694","releaseOrder":9,"sniperMap":true}];
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
// Isolated-test-only dispatch. No input, UI, or runtime production patch.
// Frida suppresses nested Interceptor callbacks for NativeFunction calls made
// inside our tick callback. Execute the queued shot after that callback returns.
const testNativeShotDispatch=(()=>{
 if(Process.mainModule.name.toLowerCase()!=='karmaaiprobe.exe')return null;
 const data=Memory.alloc(0x80),code=Memory.alloc(Process.pageSize);
 data.writeByteArray(new Uint8Array(0x80));
 Memory.protect(code,Process.pageSize,'rwx');
 const bytes=[],u32=value=>{value>>>=0;bytes.push(value&255,(value>>>8)&255,(value>>>16)&255,value>>>24);};
 const emit=(...values)=>bytes.push(...values);
 // Wrapper preserves the native tick's two stack arguments and ret8 contract.
 emit(0xff,0x74,0x24,0x08,0xff,0x74,0x24,0x08,0xb8);u32(0x451380);emit(0xff,0xd0);
 emit(0x9c,0x60,0xbe);u32(data.toUInt32()); // pushfd;pushad;esi=data
 emit(0x83,0x3e,0x01,0x0f,0x85);const skipOffset=bytes.length;u32(0);
 emit(0xc7,0x06);u32(2); // status=executing
 emit(0x8b,0x4e,0x04); // ecx=manager
 emit(0x8b,0x81);u32(0x1064);emit(0x89,0x46,0x08);
 emit(0x8b,0x81);u32(0x1050);emit(0x89,0x46,0x0c);
 for(let i=0;i<5;i++){emit(0x8b,0x81);u32(0x109c+i*4);emit(0x89,0x46,0x10+i*4);}
 emit(0xc7,0x81);u32(0x1064);u32(0);
 emit(0x8b,0x81);u32(0xfcc);emit(0x89,0x81);u32(0x1050);
 for(let i=12;i>=0;i--)emit(0xff,0x76,0x24+i*4);
 emit(0xb8);u32(0x451bd0);emit(0xff,0xd0);
 emit(0x8b,0x4e,0x04);
 emit(0x8b,0x81);u32(0x10ac);emit(0x89,0x46,0x58);
 emit(0x0f,0xb6,0x81);u32(0x10a8);emit(0x89,0x46,0x5c);
 emit(0x8b,0x46,0x08,0x89,0x81);u32(0x1064);
 emit(0x8b,0x46,0x0c,0x89,0x81);u32(0x1050);
 for(let i=0;i<5;i++){emit(0x8b,0x46,0x10+i*4,0x89,0x81);u32(0x109c+i*4);}
 emit(0xc7,0x06);u32(3); // status=complete
 const doneOffset=bytes.length;emit(0x61,0x9d,0xc2,0x08,0x00);
 const delta=doneOffset-(skipOffset+4);
 for(let i=0;i<4;i++)bytes[skipOffset+i]=(delta>>>(i*8))&255;
 code.writeByteArray(bytes);
 const callers=[0x41774b,0x417dd6,0x418a58,0x418da3];
 for(const address of callers){
  const call=P(address),old=new Uint8Array(call.readByteArray(5));
  const displacement=new DataView(old.buffer).getInt32(1,true);
  if(old[0]!==0xe8 || address+5+displacement!==0x451380)throw new Error('Unexpected tick callsite '+call);
 }
 for(const address of callers){
  const relative=(code.toUInt32()-(address+5))|0;
  Memory.patchCode(P(address),5,memory=>memory.writeByteArray([0xe8,relative&255,(relative>>>8)&255,(relative>>>16)&255,relative>>>24]));
  const installed=new Uint8Array(P(address).readByteArray(5));
  const target=(address+5+new DataView(installed.buffer).getInt32(1,true))>>>0;
  if(installed[0]!==0xe8 || target!==code.toUInt32())throw new Error('Dispatcher patch readback mismatch at '+P(address));
 }
 send({event:'test-native-dispatch-ready',code:code.toString(),size:bytes.length,callers:callers.map(a=>P(a).toString())});
 return {
  // Native code pointers referenced only by patched machine code are invisible
  // to the JS collector. Keep both allocations alive for the script's lifetime.
  code,data,
  status(){return data.readU32();},
  queue(manager,arguments13){
   if(data.readU32()!==0)throw new Error('Native test dispatcher is busy');
   if(arguments13.length!==13)throw new Error('Native shot requires13 stack arguments');
   data.add(4).writePointer(manager);
   arguments13.forEach((value,index)=>data.add(0x24+index*4).writeU32(value>>>0));
   data.writeU32(1);
  },
  consume(){
   if(data.readU32()!==3)return null;
   const result={valid:data.add(0x58).readS32(),hit:data.add(0x5c).readU32()};
   data.writeU32(0);return result;
  }
 };
})();

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
  queue:st.queue.length,loadout:inventoryStatus(),spectator:spectatorStatus(),retainedModelCount:retainedModels.size,
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
