import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import os from 'node:os';
import {createCentralPeer} from '../client/Launcher/central-transport.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.KARMA_GAME_ROOT||!process.env.KARMA_SERVER_ROOT)throw Error('Set KARMA_GAME_ROOT to an extracted release and KARMA_SERVER_ROOT to the server repository.');
const {startKarmaServer}=await import(pathToFileURL(path.resolve(process.env.KARMA_SERVER_ROOT,'server.mjs')).href);
const mode='duel';
const mapIndex=Number(process.argv.find(v=>v.startsWith('--map='))?.split('=')[1]??4),dual=process.argv.includes('--dual');
assert([0,4,7].includes(mapIndex),'Supported test map');
const work=path.join(repo,'tests'),support=path.join(repo,'client/Launcher');
const gameRoot=path.resolve(process.env.KARMA_GAME_ROOT),game=path.join(gameRoot,'App_Executables');
const runtime=JSON.parse(fs.readFileSync(path.join(support,'runtime.json'),'utf8').replace(/^\uFEFF/,''));
const battlefield=JSON.parse(fs.readFileSync(path.join(support,'multiplayer-maps.json'),'utf8')).maps.find(m=>m.mapIndex===mapIndex);
const arena=mapIndex===0?{sectorCount:6,testPair:[{position:[-3846,400,-7446],nativeSectorIndex:4},{position:[-3846,400,-8446],nativeSectorIndex:4}],sixDistant:Array.from({length:6},(_,i)=>({position:[4800+((i+1)%2)*400,400,-14000-(i+1)*500],nativeSectorIndex:4}))}:JSON.parse(fs.readFileSync(path.join(work,'map-combat-fixtures.json'),'utf8').replace(/^\uFEFF/,'')).find(m=>m.mapIndex===mapIndex);
const pointA=arena.testPair[0],pointB=arena.testPair[1];
const facing=Math.atan2(-(pointB.position[2]-pointA.position[2]),pointB.position[0]-pointA.position[0]);
const place=async(c,p,yaw=facing)=>{
 await c.script.exports.placeLocal(p.position,p.nativeSectorIndex,yaw);
 await c.script.exports.probeCameraPlacement(p.position,yaw);
};
// Native 450020 respawn calls 4061e0(camera,yaw,0,x,y,z). Actor-only
// placement is insufficient: 45034a reads camera yaw back into the actor.
// Keep this camera setup inside the isolated probe; collision, firing, damage,
// models, and score handling still run through the unmodified native paths.
const probeCameraSource=`(()=>{
 if(Process.mainModule.name.toLowerCase()!=='karmaaiprobe.exe')throw Error('Probe camera refuses process');
 const cameraInit=new NativeFunction(ptr(0x4061e0),'int',['pointer','float','float','float','float','float'],'thiscall');
 let pending=null;
 Interceptor.attach(ptr(0x451380),{
  onEnter(){this.manager=this.context.ecx;},
  onLeave(){
   if(!pending)return;
   const m=this.manager,p=m.add(0xfcc).readPointer();if(p.isNull())return;
   const position=[0,4,8].map(i=>p.add(0x1a40+i).readFloat());
   if(Math.hypot(...position.map((v,i)=>v-pending.position[i]))>=25)return;
   const request=pending;pending=null;
   cameraInit(m.add(0x1054).readPointer(),request.yaw,0,...position);
   send({event:'probe-camera-placed',position,yaw:request.yaw});
  }
 });
 rpc.exports.probeCameraPlacement=(position,yaw)=>{pending={position,yaw};return {accepted:true};};
})();`;
const template=fs.readFileSync(path.join(support,'session-template.bin'));
assert.equal(crypto.createHash('sha256').update(template).digest('hex'),runtime.sha256);
for(const [key,value] of Object.entries({local:1,mode:1,matchType:1,age:0,map:mapIndex,character:dual?4:0,camp:0}))template.writeInt32LE(value,runtime.offsets[key]);
const probe=path.join(game,'KarmaAIProbe.exe'),createdProbe=!fs.existsSync(probe);
const originalProbe=createdProbe?null:fs.readFileSync(probe);
if(originalProbe){const comparable=Buffer.from(originalProbe);for(const offset of Object.values(runtime.offsets))template.copy(comparable,offset,offset,offset+4);assert(comparable.equals(template),'Existing probe differs outside supported configuration fields');}
fs.writeFileSync(probe,template);
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'karma-eight-native-'));
const server=await startKarmaServer({host:'127.0.0.1',port:0,healthPort:0,dataDir,logger:()=>{}});
const frida=await import(pathToFileURL(path.join(gameRoot,'Runtime/node_modules/frida/build/src/frida.js')).href);
const device=await frida.getLocalDevice();
const logPath=path.join(work,'native-drop-after-fire.jsonl');fs.writeFileSync(logPath,'');
const log=(event,details={})=>fs.appendFileSync(logPath,JSON.stringify({time:new Date().toISOString(),event,...details})+'\n');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const clients=[];let failure=null,stopping=false;
const character={index:dual?4:0,camp:0,model:dual?'cpom_020.chr':'cpom_050.chr',name:'Player'};
const startingXp=dual?600:0,blastWeapon=dual?21:6;
const config={map:mapIndex,age:0,character,inventory:dual?[50,9,21,22,255,255,255]:[50,9,1,6,48,24,18],selectedWeapon:9,settings:{build:'karma290-central5',mode:1}};
async function wait(label,predicate,timeout=20000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(failure)throw failure;const r=await predicate();if(r)return r;await delay(200);}
 throw Error('Timeout: '+label);
}
const states=()=>Promise.all(clients.filter(c=>!c.left).map(c=>c.script.exports.lanstatus()));
async function waitPlacement(client,point,label='native placement'){
 await wait(label,async()=>{
  const s=await states();
  if(!s.every(x=>x.ready))return false;
  const distance=p=>Math.hypot(...p.map((v,k)=>v-point.position[k]));
  return distance(s[client.i].local.pos)<25&&s.every((v,i)=>i===client.i||distance(v.peers.find(p=>p.id===client.peer.playerId).actual.pos)<25);
 });
}
function compactPlayers(s){return s.map((v,i)=>({i,local:v.local,localDead:v.localDead,receivedHits:v.receivedHits,renderCalls:v.renderCalls,peers:v.peers.map(p=>({id:p.id,index:p.index,team:p.team,dead:p.dead,actual:p.actual}))}));}
const deadline=setTimeout(()=>{failure=Error('Eight-player native deadline');for(const c of clients)if(c.pid)device.kill(c.pid).catch(()=>{});},120000);

const loadouts=JSON.parse(fs.readFileSync(path.join(support,'loadouts.json'),'utf8'));
const models=['cpom_020.chr','cpom_020.chr'];
const chars=[4,4];
async function connect(i,reuse){
 const account=reuse?.account||await server.auth.createAccount({email:`dmjoin${i}@native.invalid`,password:crypto.randomUUID(),name:'Late '+i,role:'admin'});
 const token=server.auth.issueSession(account).authToken;
 const response=await fetch(`http://127.0.0.1:${server.healthPort}/api/admin/users/${account.playerId}`,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({xp:100})});assert.equal(response.status,200);
 const c={i,account,role:i===0?'host':'join',events:[],pending:[]};clients.push(c);
 const offered={map:mapIndex,age:0,inventory:[50,14,1,21,48,24,19],selectedWeapon:21,character:{index:chars[i],camp:0,model:models[i],name:'Late '+i},settings:{build:'karma290-central5',mode:1}};
 c.peer=await createCentralPeer({role:c.role,host:'127.0.0.1',port:server.port,secure:false,identityPath:null,
  identity:{authToken:token},code:'888123',config:offered,maxPlayers:2,mode:'dm',manualStart:true,
  onStatus:x=>{log('transport',{client:i,...x});if(x.phase==='disconnected'&&!stopping)failure=Error(x.message||'unexpected disconnect');},onProfile:x=>{c.profile=x;},
  onMessage:x=>{if(stopping||c.left)return;if(c.loaded)c.script.exports.lanreceive(x).catch(e=>{if(!stopping&&!c.left)failure=e;});else c.pending.push(x);}});
 return c;
}
async function launch(c){
 c.hello=await c.peer.ready;
 const exe=path.join(game,'KarmaAIProbe.exe');c.pid=await device.spawn([exe],{cwd:game});c.session=await device.attach(c.pid);
 const local=c.peer.effectiveConfig;
 const equipmentCatalog={weapons:loadouts.weapons.filter(w=>w.age===0).map(w=>({id:w.id,name:w.name,cost:w.inventoryCost})),inventoryCapacity:loadouts.characters[local.character.model.slice(0,-4)].inventoryCapacity+local.rank.budgetBonus};
 let source='globalThis.KARMA_LAN_CONFIG='+JSON.stringify({role:c.role,central:true,local,equipmentCatalog,
  localPlayerId:c.peer.playerId,remotePlayerId:c.peer.remotePlayerId,remoteHello:c.hello,peers:c.peer.peers,
  slot:c.peer.slot,team:c.peer.team,match:c.peer.match})+';\n';
 for(const name of [path.join(work,'ai_unattended_shim.js'),...['startup-diagnostics.js','offline-death.js','window-size.js'].map(n=>path.join(support,n))])source+='\n(()=>{\n'+fs.readFileSync(name,'utf8')+'\n})();\n';
 // A single executable image stays open while multiple probes run. The original
 // model-name records are configured at the same pre-loader boundary as peers.
 source+=`Interceptor.attach(ptr(0x420560),{onEnter(){this.g=this.context.ecx;},onLeave(r){if(!r.toInt32())return;for(const p of [this.g.add(0x8e),this.g.add(0xc).readPointer().add(0x1768)]){p.writeByteArray(new Uint8Array(20));p.writeUtf8String(globalThis.KARMA_LAN_CONFIG.local.character.model);}}});\n`;
 for(const name of ['lan-game.js','rank-display.js'])source+='\n(()=>{\n'+fs.readFileSync(path.join(support,name),'utf8')+'\n})();\n';
 source+='\n'+probeCameraSource+'\n'+privateControls;
 c.script=await c.session.createScript(source);
 c.script.message.connect(m=>{
  if(m.type==='error'){failure=Error(m.description);log('script-error',{client:c.i,...m});return;}
  if(m.type!=='send')return;const p=m.payload;
  if(p.event==='lan-outbound'){c.outbound??=[];c.outbound.push(p.message);try{c.peer.send(p.message);}catch(e){failure=e;}return;}
  if(p.event==='lan-damage-proof'){c.peer.send({type:'damage-proof',proof:p.proof});return;}
  c.events.push(p);log('native',{client:c.i,...p});
  if(['native-exception','unattended-safety-violation'].includes(p.event))failure=Error(p.event);
 });
 c.session.detached.connect((reason,crash)=>{c.ended=true;log('detached',{client:c.i,reason,crash:crash?String(crash):null});if(!stopping&&!c.left)failure=Error('Unexpected process exit '+c.i);});
 await c.script.load();c.loaded=true;for(const x of c.pending.splice(0))await c.script.exports.lanreceive(x);await device.resume(c.pid);
 await wait('native entrant ready '+c.i,async()=>{const s=await c.script.exports.lanstatus();return s.ready&&s.peers.filter(p=>!p.left).every(p=>p.latest)&&s;},45000);
 assert(c.events.some(e=>e.event==='unattended-isolation-verified'));return c;
}
async function leave(c){c.left=true;c.peer.close();await c.script.exports.menucommand('quit');await wait('departing native exits',()=>c.ended);}
async function allPeers(count){return await wait('active native roster '+count,async()=>{const s=await states();return s.length===count&&s.every(v=>v.peers.filter(p=>!p.left).length===count-1&&v.peers.filter(p=>!p.left).every(p=>p.latest&&p.actual))&&s;},40000);}
async function kill(shooter,victim){
 await place(shooter,pointA);await place(victim,pointB,facing+Math.PI);await delay(2000);
 const before=(await shooter.script.exports.lanstatus()).scores[0].kills;
 for(let n=0;n<30;n++){const v=await victim.script.exports.lanstatus();if(v.localDead)break;await shooter.script.exports.queueNativeShot(9,null,victim.peer.playerId);await delay(450);}
 await wait('native kill and all scoreboards',async()=>{const s=await states();return s.every(v=>v.scores.find(row=>row.playerId===shooter.peer.playerId)?.kills===before+1);});
}

// Private process buffer only: no SendInput, keyboard device or foreground changes.
const privateControls=`(()=>{
 if(Process.mainModule.name.toLowerCase()!=='karmaaiprobe.exe')throw Error('Private controls require hidden fixture');
 globalThis.KARMA_PICKUP_TEST_INPUT=true;
 const equip=new NativeFunction(ptr(0x45e700),'void',['pointer','int'],'thiscall');
 let command=null;const keys={};
 Interceptor.attach(ptr(0x451380),{onLeave(){
  const game=ptr(0x548d5c).readPointer();if(game.isNull())return;
  const input=game.add(0x120).readPointer(),gm=game.add(0x140).readPointer();if(input.isNull()||gm.isNull())return;
  const m=gm.add(0xc).readPointer(),actor=m.add(0xfcc).readPointer();if(actor.isNull())return;
  for(const [scan,held]of Object.entries(keys))input.add(0x40+Number(scan)).writeU8(held?0x80:0);
  if(command){const c=command;command=null;equip(actor,c.weapon);if(c.magazine!==undefined){actor.add(0x2a4+c.weapon*56).writeS32(c.magazine);actor.add(0x29c+c.weapon*56).writeS32(c.reserve+253);}}
 }});
 rpc.exports.privateSelect=(weapon,magazine,reserve)=>{command={weapon,magazine,reserve};return true;};
 rpc.exports.privateKey=(scan,held)=>{keys[scan]=Boolean(held);return true;};
})();`;
async function select(c,weapon,magazine,reserve){
 await c.script.exports.privateSelect(weapon,magazine,reserve);
 await wait('selected '+weapon,async()=>{const s=await c.script.exports.lanstatus();return s.local.weapon===weapon&&s;});
}
async function fire(c,weapon){
 const before=await c.script.exports.lanstatus(),id=before.local.shotSequence;
 const target=[before.local.pos[0],before.local.pos[1]+1200,before.local.pos[2]+2500];
 await c.script.exports.queueNativeShot(weapon,target);
 return await wait('native shot '+weapon,async()=>{const s=await c.script.exports.lanstatus();return s.local.shotSequence>id&&s;});
}
try{
 const a=await connect(0),b=await connect(1);
 await wait('two players waiting',()=>server.stats().players===2&&a.peer.match.members?.length===2);
 assert.equal(a.peer.match.canStart,false,'New arrivals reserve unready seats');
 for(const c of [a,b])assert(c.peer.updateLobby({requestId:crypto.randomUUID(),ready:true}));
 await wait('all participants explicitly ready',()=>a.peer.match.canStart===true);
 assert(a.peer.startMatch());
 await Promise.all([launch(a),launch(b)]);await allPeers(2);
 await place(a,pointA);await place(b,pointB,facing+Math.PI);await delay(800);
 for(const c of [a,b]){
  await select(c,14,35,122);const fired=await fire(c,14);await delay(250);
  assert.equal(fired.local.shot.weapon,14);const shotId=fired.local.shot.id;
  log('pps43-fired-before-G',{client:c.i,shot:fired.local.shot,inventory:fired.local.inventory});
  const eventsBefore=c.events.length,outboundBefore=c.outbound.length;
  await c.script.exports.privateKey(0x22,true);
  await wait('G approval '+c.i,()=>c.events.slice(eventsBefore).some(e=>e.event==='lan-drop-applied'&&e.weapon===14));
  await c.script.exports.privateKey(0x22,false);await delay(600);
  const after=await c.script.exports.lanstatus();
  assert(!after.local.inventory.includes(14));assert.equal(after.local.weapon,1);
  assert.equal(after.local.shot,undefined);assert.equal(after.local.shotSequence,shotId);
  const outgoing=c.outbound.slice(outboundBefore).filter(m=>m.type==='state'&&!m.inventory.includes(14));
  assert(outgoing.length>=3);assert(outgoing.every(m=>!m.shot),'native states after G must omit retired shot');
  const drop=c.events.slice(eventsBefore).find(e=>e.event==='lan-drop-applied');
  assert(c.events.slice(eventsBefore).some(e=>e.event==='lan-shot-retired'&&e.weapon===14&&e.id===shotId));
  log('G-after-PPS43-keeps-connected',{client:c.i,passed:true,drop,statesAfterRemoval:outgoing.length,local:after.local});
  const pistol=await fire(c,1);assert.equal(pistol.local.shot.id,shotId+1);await delay(300);
  assert.equal(server.stats().players,2);assert(!a.ended&&!b.ended);
  await wait('native nearby dropped PPS43',()=>c.events.slice(eventsBefore).some(e=>e.event==='lan-loot-hint'&&e.phase==='nearby'&&e.weapon===14));
  await c.script.exports.privateKey(0x12,true);
  await wait('E approval '+c.i,()=>c.events.slice(eventsBefore).some(e=>e.event==='lan-pickup-applied'&&e.dropId===drop.dropId));
  await c.script.exports.privateKey(0x12,false);await delay(300);
  const picked=await c.script.exports.lanstatus(),ammo=picked.loadout.ammo.find(w=>w.weapon===14);
  assert.equal(ammo.magazine,35);assert.equal(ammo.reserve,122);assert.equal(picked.local.weapon,14);
  assert.equal(server.stats().players,2);log('E-after-G-exact-ammo',{client:c.i,passed:true,ammo,shotSequence:picked.local.shotSequence});
 }
 await delay(700);assert.equal(server.stats().players,2);assert(!a.ended&&!b.ended);
 log('test-pass',{checks:['Rescue duel two hidden native peers','actual PPS43 native shot before G on both peers','native G authority acknowledgement','no retired shot in subsequent native state','shot sequence remains monotonic','new pistol shot accepted after G','E pickup preserves 35/122 ammo','both TCP connections remain active','hidden devices and cursor isolation']});
}catch(error){failure=error;log('test-failed',{message:String(error),stack:error.stack});process.exitCode=1;}
finally{
 stopping=true;clearTimeout(deadline);for(const c of clients){c.peer?.close();if(c.pid&&!c.ended)try{await device.kill(c.pid);}catch{}}
 await server.close();for(const name of ['profiles.json','auth.json']){const f=path.join(dataDir,name);if(fs.existsSync(f))fs.unlinkSync(f);}fs.rmdirSync(dataDir);
 for(let attempt=0;;attempt++)try{if(createdProbe)fs.unlinkSync(probe);else fs.writeFileSync(probe,originalProbe);break;}catch(error){if(attempt===49)throw error;await delay(100);}
}
console.log(JSON.stringify({passed:!failure,logPath,error:failure?String(failure):null}));
