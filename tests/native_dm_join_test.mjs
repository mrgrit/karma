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
const mode=process.argv.includes('--tdm')?'tdm':'dm';
const mapIndex=Number(process.argv.find(v=>v.startsWith('--map='))?.split('=')[1]??0),dual=process.argv.includes('--dual');
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
const logPath=path.join(work,'native-dm-join.jsonl');fs.writeFileSync(logPath,'');
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
const deadline=setTimeout(()=>{failure=Error('Eight-player native deadline');for(const c of clients)if(c.pid)device.kill(c.pid).catch(()=>{});},240000);

const loadouts=JSON.parse(fs.readFileSync(path.join(support,'loadouts.json'),'utf8'));
const models=['cpom_050.chr','cpom_050.chr','cpoo_030.chr','cpom_020.chr'];
const chars=[0,0,1,4];
async function connect(i,reuse){
 const account=reuse?.account||await server.auth.createAccount({email:`dmjoin${i}@native.invalid`,password:crypto.randomUUID(),name:'Late '+i,role:'admin'});
 const token=server.auth.issueSession(account).authToken;
 const response=await fetch(`http://127.0.0.1:${server.healthPort}/api/admin/users/${account.playerId}`,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({xp:i===0?600:1000})});assert.equal(response.status,200);
 const c={i,account,role:i===0?'host':'join',events:[],pending:[]};clients.push(c);
 const offered={map:0,age:0,character:{index:chars[i],camp:0,model:models[i],name:'Late '+i},settings:{build:'karma290-central5',mode:1}};
 c.peer=await createCentralPeer({role:c.role,host:'127.0.0.1',port:server.port,secure:false,identityPath:null,
  identity:{authToken:token},code:'888123',config:offered,maxPlayers:4,mode:'dm',manualStart:true,
  onStatus:x=>log('transport',{client:i,...x}),onProfile:x=>{c.profile=x;},
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
 for(const name of [path.join(work,'ai_unattended_shim.js'),...['startup-diagnostics.js','input-lan.js','offline-death.js','window-size.js'].map(n=>path.join(support,n))])source+='\n(()=>{\n'+fs.readFileSync(name,'utf8')+'\n})();\n';
 // A single executable image stays open while multiple probes run. The original
 // model-name records are configured at the same pre-loader boundary as peers.
 source+=`Interceptor.attach(ptr(0x420560),{onEnter(){this.g=this.context.ecx;},onLeave(r){if(!r.toInt32())return;for(const p of [this.g.add(0x8e),this.g.add(0xc).readPointer().add(0x1768)]){p.writeByteArray(new Uint8Array(20));p.writeUtf8String(globalThis.KARMA_LAN_CONFIG.local.character.model);}}});\n`;
 for(const name of ['lan-game.js','rank-display.js'])source+='\n(()=>{\n'+fs.readFileSync(path.join(support,name),'utf8')+'\n})();\n';
 source+='\n'+probeCameraSource;
 c.script=await c.session.createScript(source);
 c.script.message.connect(m=>{
  if(m.type==='error'){failure=Error(m.description);log('script-error',{client:c.i,...m});return;}
  if(m.type!=='send')return;const p=m.payload;
  if(p.event==='lan-outbound'){try{c.peer.send(p.message);}catch(e){failure=e;}return;}
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
try{
 const a=await connect(0),b=await connect(1);
 await wait('two players waiting',()=>server.stats().players===2);await delay(300);assert(a.peer.startMatch());
 await Promise.all([launch(a),launch(b)]);let all=await allPeers(2);
 const stableIndex=all[0].peers.find(p=>p.id===b.peer.playerId).index;
 await kill(a,b);log('initial-native-kill',{scores:await states()});
 const c=await connect(2);await launch(c);all=await allPeers(3);
 assert.equal(all[0].peers.find(p=>p.id===b.peer.playerId).index,stableIndex);
 assert(all.every(s=>s.scores.find(row=>row.playerId===a.peer.playerId).kills===1));
 assert(all.every(s=>s.scores.find(row=>row.playerId===b.peer.playerId).deaths===1));
 assert.equal((await c.script.exports.lanstatus()).remoteShots,0,'Historical retained shot must not replay after late join');
 const newcomer=all[0].peers.find(p=>p.id===c.peer.playerId);
 assert.notEqual(newcomer.actual.model,all[0].peers.find(p=>p.id===b.peer.playerId).actual.model);
 assert.equal(newcomer.actual.weapon,c.peer.effectiveConfig.selectedWeapon);assert.equal(newcomer.actual.rank,8);
 log('third-player-midmatch',{passed:true,players:all});
 const departingIndex=newcomer.index;await leave(c);
 await wait('departed actor hidden',async()=>{const s=await a.script.exports.lanstatus();const p=s.peers.find(p=>p.id===c.peer.playerId);return p.left&&!p.actual.visible&&!p.actual.spawned&&!p.actual.active;});
 const d=await connect(3);await launch(d);all=await allPeers(3);
 const replacement=all[0].peers.find(p=>p.id===d.peer.playerId);
 assert.equal(replacement.index,departingIndex);assert.notEqual(replacement.actual.model,newcomer.actual.model);
 assert.equal(replacement.actual.weapon,d.peer.effectiveConfig.selectedWeapon);
 assert.equal(all[0].peers.find(p=>p.id===b.peer.playerId).index,stableIndex);
 assert(all.every(s=>s.scores.find(row=>row.playerId===a.peer.playerId).kills===1));
 log('native-slot-replacement',{passed:true,players:all});
 await place(b,arena.sixDistant[0]);await kill(a,d);
 log('replacement-native-damage',{passed:true,players:await states()});
 await leave(d);const d2=await connect(3,d);await launch(d2);all=await allPeers(3);
 assert(d2.peer.match.initialLife>1);assert.equal(all[2].life,d2.peer.match.initialLife);
 assert(all.every(s=>s.scores.find(row=>row.playerId===a.peer.playerId).kills===2));
 assert(all.every(s=>s.scores.find(row=>row.playerId===d2.peer.playerId).deaths===1));
 log('reconnect-life-score-continuity',{passed:true,initialLife:d2.peer.match.initialLife,players:all});
 await leave(b);await leave(d2);all=await allPeers(1);assert(a.peer.connected);assert.equal(all[0].local.hp,100);
 log('last-player-remains-active',{passed:true});
 // Exercise all 20 shipped characters against the real native cache, then revisit
 // them. Keep the local actor fixed; the same free remote slot is rebound 40 times.
 const catalog=JSON.parse(fs.readFileSync(path.join(support,'catalog.json'),'utf8')).characters.filter(c=>c.age===0);
 const assets=new Map();let serial=0;
 for(let pass=0;pass<2;pass++)for(const character of catalog){
  const model=path.basename(character.model).toLowerCase(),profile=loadouts.characters[character.id],id='cache-probe-'+ ++serial;
  const config={map:0,age:0,character:{index:character.characterIndex,camp:character.camp,model,name:'Cache '+serial},inventory:profile.defaultInventory,selectedWeapon:profile.defaultSelectedWeapon,rank:{id:'lieutenant'},settings:{build:'karma290-central5',mode:1}};
  await a.script.exports.lanreceive({version:1,type:'peer-joined',peer:{playerId:id,slot:1,team:1,config}});
  await a.script.exports.lanreceive({version:1,type:'state',senderId:id,life:1,seq:1,pos:pointB.position,sector:pointB.nativeSectorIndex,yaw:facing+Math.PI,pitch:0,hp:100,weapon:profile.defaultSelectedWeapon,shotSequence:0});
  const status=await wait('native model '+model,async()=>{const v=await a.script.exports.lanstatus();return v.peers.some(p=>p.id===id&&p.latest)&&v;});
  const actor=status.peers.find(p=>p.id===id),entry=status.modelCache.find(e=>e.index===actor.actual.model);
  assert.equal(entry.name,model);assert.equal(actor.index,1);assert(status.retainedModelCount<=20);
  if(assets.has(model))assert.equal(entry.pointer,assets.get(model),'A revisited character reuses the retained native resource');else assets.set(model,entry.pointer);
  await a.script.exports.lanreceive({version:1,type:'peer-left',playerId:id});
  await wait('native model hidden '+model,async()=>{const v=await a.script.exports.lanstatus(),p=v.peers.find(p=>p.id===id);return p.left&&!p.actual.visible&&!p.actual.spawned&&!p.actual.active;});
 }
 assert.equal(assets.size,20);log('bounded-native-model-cache',{passed:true,characters:assets.size,rebindings:serial,status:await a.script.exports.lanstatus()});
 const activeIds=[];
 async function addCacheActor(character,id,slot){
  const model=path.basename(character.model).toLowerCase(),profile=loadouts.characters[character.id];
  const config={map:0,age:0,character:{index:character.characterIndex,camp:character.camp,model,name:id},inventory:profile.defaultInventory,selectedWeapon:profile.defaultSelectedWeapon,rank:{id:'lieutenant'},settings:{build:'karma290-central5',mode:1}};
  await a.script.exports.lanreceive({version:1,type:'peer-joined',peer:{playerId:id,slot,team:1,config}});
  await a.script.exports.lanreceive({version:1,type:'state',senderId:id,life:1,seq:1,pos:[pointB.position[0]+slot*150,pointB.position[1],pointB.position[2]],sector:pointB.nativeSectorIndex,yaw:facing+Math.PI,pitch:0,hp:100,weapon:profile.defaultSelectedWeapon,shotSequence:0});
  return await wait('full cache native actor '+id,async()=>{const v=await a.script.exports.lanstatus();return v.peers.some(p=>p.id===id&&p.latest)&&v;});
 }
 for(let i=1;i<=7;i++){const id='full-cache-'+i;activeIds.push(id);await addCacheActor(catalog[i],id,i);}
 const full=await a.script.exports.lanstatus();assert.equal(full.peers.filter(p=>!p.left).length,7);
 const stable=full.peers.filter(p=>!p.left&&p.id!==activeIds[3]).map(p=>({id:p.id,index:p.index,model:p.actual.model,asset:full.modelCache.find(e=>e.index===p.actual.model)}));
 assert.equal(new Set(full.peers.map(p=>p.actual.model)).size,7);
 await a.script.exports.lanreceive({version:1,type:'peer-left',playerId:activeIds[3]});
 await wait('middle slot departed',async()=>{const v=await a.script.exports.lanstatus();return v.peers.find(p=>p.id===activeIds[3]).left;});
 const fullReplacement=await addCacheActor(catalog[18],'full-cache-replacement',4);
 for(const before of stable){const after=fullReplacement.peers.find(p=>p.id===before.id);assert.equal(after.index,before.index);assert.equal(after.actual.model,before.model);assert.deepEqual(fullReplacement.modelCache.find(e=>e.index===after.actual.model),before.asset);}
 const replaced=fullReplacement.peers.find(p=>p.id==='full-cache-replacement');assert.equal(replaced.index,4);assert.equal(fullReplacement.modelCache.find(e=>e.index===replaced.actual.model).name,path.basename(catalog[18].model).toLowerCase());
 assert.equal(fullReplacement.modelCache.find(e=>e.name==='cpom_050.chr').pointer,assets.get('cpom_050.chr'));
 log('full-native-model-cache-replacement',{passed:true,activePlayers:8,preservedPeers:stable.length,status:fullReplacement});

 stopping=true;await a.script.exports.menucommand('quit');await wait('last native clean exit',()=>a.ended);
 log('test-pass',{checks:['2-player manual start','real native kill before join','third player joins running DM','model/loadout/rank','all score snapshot continuity','stable active actor slots','departure hides ghost','replacement different model','native damage after replacement','reconnect life and score continuity','one player keeps match alive','hidden input isolation']});
}catch(error){failure=error;log('test-failed',{message:String(error),stack:error.stack});process.exitCode=1;}
finally{
 stopping=true;clearTimeout(deadline);for(const c of clients){c.peer?.close();if(c.pid&&!c.ended)try{await device.kill(c.pid);}catch{}}
 await server.close();for(const name of ['profiles.json','auth.json']){const f=path.join(dataDir,name);if(fs.existsSync(f))fs.unlinkSync(f);}fs.rmdirSync(dataDir);
 for(let attempt=0;;attempt++)try{if(createdProbe)fs.unlinkSync(probe);else fs.writeFileSync(probe,originalProbe);break;}catch(error){if(attempt===49)throw error;await delay(100);}
}
console.log(JSON.stringify({passed:!failure,logPath,error:failure?String(failure):null}));
