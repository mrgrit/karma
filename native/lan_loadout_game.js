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
 if(phase==='nearby'&&item&&Number.isFinite(capacity))message=(item.name||('무기 '+d.weapon))+' · '+weaponCost+'점 · '+d.magazine+'/'+d.reserve+'발\n'+
  '줍기 후 '+projectedScore+' / 한도 '+capacity+'점'+(projectedScore>capacity?' (한도 초과)':'')+'\n'+
  ((loot.inventory||[]).includes(d.weapon)?'이미 보유 중 · G로 먼저 버린 뒤 E로 줍기':'E: 줍기 · G: 현재 무기 버리기');
 send({event:'lan-loot-hint',phase,message,ttlMs:3500,weapon:d?.weapon,
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
  const message=reason==='weapon-already-owned'?'이미 가진 무기입니다. 먼저 G로 버린 뒤 E로 주우세요.':
   reason.includes('loadout')?'인벤토리 점수가 부족합니다. 버릴 총을 선택하고 G를 누른 뒤 E로 주우세요.':
   reason.includes('distance')||reason.includes('far')||reason==='out-of-range'?'무기에 더 가까이 다가가서 E를 눌러 주세요.':
   reason.includes('claimed')||reason.includes('missing')?'다른 플레이어가 이미 주운 무기입니다.':'지금은 이 무기를 주울 수 없습니다.';
  lootHint('denied',message,d,{reason});
 }
 else if(x.type==='drop-grant')applyDropGrant(x.grant);
 else if(x.type==='drop-denied'){
  if(loot.pendingDrop?.requestId===x.requestId)loot.pendingDrop=null;
  lootHint('denied','지금은 이 무기를 버릴 수 없습니다. 총을 다시 선택하고 G를 눌러 주세요.',null,{reason:String(x.reason||'')});
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
  if(nearest&&(loot.nearby!==nearest.id||now()-loot.lastHint>=3000)){
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
