// Isolated process-only harness around the production native loot module.
(()=>{
'use strict';
const P=ptr,processName=Process.mainModule.name.toLowerCase();
if(processName!=='karmaaiprobe.exe')throw Error('Pickup probe refuses production process');
globalThis.KARMA_PICKUP_TEST_INPUT=true;
const origin=Date.now(),now=()=>Math.max(1,Date.now()-origin),selfId='probe-player';
const cfg={localPlayerId:selfId,local:{inventory:[0,9,1,6,48,24,18],selectedWeapon:9},
 equipmentCatalog:{inventoryCapacity:1500,weapons:[{id:9,name:'MP38',cost:200},{id:10,name:'MP40',cost:400}]}};
const st={ready:false,closed:false,placed:false,firstTick:0,gm:null,m:null,p:null,life:1,localDead:false};
const queue=[],results=new Map(),events=[];let serial=0;
function integer(v,a,b){return Number.isInteger(v)&&v>=a&&v<=b;}
function idValid(v){return typeof v==='string'&&v.length>0&&v.length<=96;}
function vector(v){return Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<1e6);}
function vec(p,o){return [0,4,8].map(i=>p.add(o+i).readFloat());}
function hp(p){return p.add(0x264).readS32()-625;}
function remoteConfig(){return {};}
function safeSector(s){return integer(s,0,255);}
function boundedRemember(set,id){set.add(id);if(set.size>1000)set.delete(set.values().next().value);}
function emit(message){events.push(message);send({event:'pickup-probe-outbound',message});}
function sendState(){if(st.ready)send({event:'pickup-probe-state',inventory:inventoryStatus()});}
const projectileWeapons=new Set();function playerId(){return null;}
const nativeInventory=new NativeFunction(P(0x44fd00),'void',['pointer','int','int','pointer','int'],'thiscall');
/*__PICKUP_MODULE__*/
function snapshot(){return {ready:st.ready,life:st.life,inventory:st.ready?inventoryStatus():null,
 pos:st.ready?vec(st.p,0x1a40):null,sector:st.ready?st.p.add(0x1b44).readS32():null,
 events:[...events],pendingDrop:loot.pendingDrop,
 physical:st.ready?[...loot.drops.values()].map(d=>({id:d.id,weapon:d.weapon,index:d.index,
  pos:vec(st.m.add(0xb0+d.index*0x5c),4),active:st.m.add(0xb0+d.index*0x5c).readU8(),nearbyAt:d.nearbyAt||0})):[]};}
Interceptor.attach(P(0x44a4c0),{onLeave(){st.placed=true;}});
Interceptor.attach(P(0x451380),{onEnter(){
 if(!st.placed)return;st.m=this.context.ecx;
 if(st.m.add(0x1070).readS32()<1)return;
 st.p=st.m.add(0xfcc).readPointer();st.gm=P(0x548d5c).readPointer().add(0x140).readPointer();
 if(!st.firstTick)st.firstTick=now();if(!st.ready&&now()-st.firstTick<1500)return;
 if(!st.ready){st.ready=true;seedLoadouts(st.gm);resetSpawnInventory(true);send({event:'pickup-probe-ready'});}
 if(!queue.length)return;
 const c=queue.shift();let result;
 try{
  if(c.action==='key')P(0x548d5c).readPointer().add(0x120).readPointer().add(0x40+c.scan).writeU8(c.held?0x80:0);
  else if(c.action==='ammo'){st.p.add(0x2a4+c.weapon*56).writeS32(c.magazine);st.p.add(0x29c+c.weapon*56).writeS32(c.reserve+253);nativeFullEquip(st.p,c.weapon);}
  else if(c.action==='message')lootMessage(c.message);
  else if(c.action==='inventory'){cfg.local={inventory:c.inventory,selectedWeapon:c.selectedWeapon};seedLoadouts(st.gm);resetSpawnInventory(true);}
  else if(c.action==='pause')globalThis.KARMA_LOCAL_PAUSED=Boolean(c.value);
  else if(c.action!=='snapshot')throw Error('Unknown command');
  result={ok:true,...snapshot()};
 }catch(e){result={ok:false,error:String(e)};}
 results.set(c.id,result);
}});
rpc.exports=Object.assign(rpc.exports||{}, {
 pickupProbeStatus:snapshot,
 pickupProbeQueue(c){const id=++serial;queue.push({...c,id});return id;},
 pickupProbeResult:id=>results.get(id)||null
});
})();
