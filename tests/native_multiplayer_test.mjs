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
const logPath=path.join(work,'native-eight-'+mode+(mapIndex?'-map'+mapIndex:'')+(dual?'-dual':'')+'.jsonl');fs.writeFileSync(logPath,'');
const log=(event,details={})=>fs.appendFileSync(logPath,JSON.stringify({time:new Date().toISOString(),event,...details})+'\n');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const clients=[];let failure=null,stopping=false;
const character={index:dual?4:0,camp:0,model:dual?'cpom_020.chr':'cpom_050.chr',name:'Player'};
const startingXp=dual?600:0,blastWeapon=dual?21:6;
const config={map:mapIndex,age:0,character,inventory:dual?[50,9,21,22,255,255,255]:[50,9,1,6,48,24,18],selectedWeapon:9,settings:{build:'karma290-central4',mode:1}};
async function wait(label,predicate,timeout=20000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(failure)throw failure;const r=await predicate();if(r)return r;await delay(200);}
 throw Error('Timeout: '+label);
}
const states=()=>Promise.all(clients.map(c=>c.script.exports.lanstatus()));
async function waitPlacement(client,point,label='native placement'){
 await wait(label,async()=>{
  const s=await states();
  if(!s.every(x=>x.ready))return false;
  const distance=p=>Math.hypot(...p.map((v,k)=>v-point.position[k]));
  return distance(s[client.i].local.pos)<25&&s.every((v,i)=>i===client.i||distance(v.peers.find(p=>p.id===client.peer.playerId).actual.pos)<25);
 });
}
function compactPlayers(s){return s.map((v,i)=>({i,local:v.local,localDead:v.localDead,receivedHits:v.receivedHits,renderCalls:v.renderCalls,peers:v.peers.map(p=>({id:p.id,index:p.index,team:p.team,dead:p.dead,actual:p.actual}))}));}
const deadline=setTimeout(()=>{failure=Error('Eight-player native deadline');for(const c of clients)if(c.pid)device.kill(c.pid).catch(()=>{});},180000);
try{
 for(let i=0;i<8;i++){
  const account=await server.auth.createAccount({email:`player${i}@native.invalid`,password:crypto.randomUUID(),name:'Player '+i,role:'admin'});
  const token=server.auth.issueSession(account).authToken;
  if(dual){const response=await fetch(`http://127.0.0.1:${server.healthPort}/api/admin/users/${account.playerId}`,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({xp:startingXp})});assert.equal(response.status,200);}
  const c={i,role:i===0?'host':'join',events:[],pending:[]};clients.push(c);
  c.peer=await createCentralPeer({role:c.role,host:'127.0.0.1',port:server.port,secure:false,identityPath:null,
   identity:{authToken:token},code:'888123',config,maxPlayers:8,mode,
   onStatus:x=>log('transport',{client:i,...x}),onProfile:x=>{c.profile=x;},
   onMessage:x=>{if(stopping)return;if(c.loaded)c.script.exports.lanreceive(x).catch(e=>{if(!stopping)failure=e;});else c.pending.push(x);}});
 }
 await Promise.all(clients.map(async c=>{c.hello=await c.peer.ready;}));
 for(const c of clients){
  const exe=path.join(game,'KarmaAIProbe.exe');c.pid=await device.spawn([exe],{cwd:game});c.session=await device.attach(c.pid);
  let source='globalThis.KARMA_LAN_CONFIG='+JSON.stringify({role:c.role,central:true,local:c.peer.effectiveConfig,
   localPlayerId:c.peer.playerId,remotePlayerId:c.peer.remotePlayerId,remoteHello:c.hello,peers:c.peer.peers,
   slot:c.peer.slot,team:c.peer.team,match:c.peer.match})+';\n';
  for(const file of [path.join(work,'ai_unattended_shim.js'),...['startup-diagnostics.js','input-lan.js','offline-death.js','window-size.js','lan-game.js'].map(n=>path.join(support,n))])
   source+='\n(()=>{\n'+fs.readFileSync(file,'utf8')+'\n})();\n';
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
  c.session.detached.connect((reason,crash)=>{c.ended=true;log('detached',{client:c.i,reason,crash:crash?String(crash):null});if(!stopping)failure=Error('Unexpected process exit '+c.i);});
  await c.script.load();c.loaded=true;for(const x of c.pending.splice(0))await c.script.exports.lanreceive(x);
  await device.resume(c.pid);
 }
 let all=await wait('8 clients and 56 remote actors',async()=>{const s=await states();return s.every(x=>x.ready&&x.peers.length===7&&x.peers.every(p=>p.life===1))&&s;},60000);
 assert(all.every(s=>s.scores.length===8));assert.equal(new Set(all.map(s=>JSON.stringify(s.local.pos))).size,8,'All initial spawn positions are distinct');assert(clients.every(c=>c.events.some(e=>e.event==='unattended-isolation-verified')));
 assert(clients.every(c=>c.events.some(e=>e.event==='lan-game-ready'&&e.sectorCount===arena.sectorCount)),'Correct native map sectors loaded');
 for(const s of all){assert.equal(s.local.hp,100);assert(s.local.sector>=0&&s.local.sector<arena.sectorCount);assert.deepEqual(s.loadout.inventory,config.inventory);}
 if(dual)assert(all.every(s=>s.loadout.owned.includes(21)&&s.loadout.owned.includes(22)&&s.loadout.owned.includes(9)),'Both native cannons and light automatic are equipped');
 log('eight-ready',{passed:true,mode,actors:all.map(s=>s.peers.map(p=>({id:p.id,life:p.life,team:p.team,pos:p.actual.pos})))});
 for(let i=1;i<7;i++)await place(clients[i],arena.sixDistant[i-1]);
 await place(clients[0],pointA);
 await place(clients[7],pointB,facing+Math.PI);await delay(2500);
 all=await states();
 log('combat-placement',{players:all.map((s,i)=>({i,hp:s.local.hp,pos:s.local.pos,sector:s.local.sector}))});
 for(let i=0;i<8;i++)for(let j=0;j<8;j++)if(i!==j){
  const p=all[i].peers.find(p=>p.id===clients[j].peer.playerId);
  assert(p);assert(Math.hypot(...p.actual.pos.map((v,k)=>v-all[j].local.pos[k]))<25,`position ${i} receives ${j}`);
 }
 log('eight-position-sync',{passed:true});
 if(mode==='tdm'){
  // An ally fires a real native explosive into player0; HP must remain 100.
  await place(clients[2],pointB,facing+Math.PI);
  await place(clients[7],arena.sixDistant[1]);
  await waitPlacement(clients[2],pointB,'ally firing position settled');
  await waitPlacement(clients[7],arena.sixDistant[1],'enemy held clear of ally test');await delay(1000);
  const before=(await states())[0].receivedHits;
  for(let n=0;n<3;n++){await clients[2].script.exports.queueNativeShot(blastWeapon,null,clients[0].peer.playerId);await delay(700);}
  await delay(1000);all=await states();assert.equal(all[0].local.hp,100);assert.equal(all[0].receivedHits,before);
  log('friendly-explosive-blocked',{passed:true,hp:all[0].local.hp,players:compactPlayers(all)});
  await place(clients[2],arena.sixDistant[1]);
  await place(clients[0],pointA);
  await place(clients[7],pointB,facing+Math.PI);
  await waitPlacement(clients[2],arena.sixDistant[1],'ally moved clear');
  await waitPlacement(clients[0],pointA,'shooter restored after friendly blast knockback');
  await waitPlacement(clients[7],pointB,'enemy firing position settled');await delay(1500);
  log('enemy-combat-ready',{players:compactPlayers(await states())});
 }
 const combatBaseline=(await states()).map(s=>s.local.hp);
 log('targeted-combat-hp-baseline',{hp:combatBaseline});
 for(let n=0;n<24;n++){
  const state=await clients[7].script.exports.lanstatus();if(state.localDead||state.life>1)break;
  await clients[0].script.exports.queueNativeShot(9,null,clients[7].peer.playerId);await delay(450);
  if(n===0||n===12||n===23)log('bullet-progress',{shot:n,players:compactPlayers(await states())});
 }
 await wait('slot7 death, credited killer and all 8 scoreboards',async()=>{
  const s=await states();return s.every((v,i)=>v.scores[i===0?0:v.peers.find(p=>p.id===clients[0].peer.playerId).index].kills===1)&&
   clients[0].profile.xp===startingXp+25&&clients[7].profile.xp===startingXp+5;
 });
 all=await states();for(let i=1;i<7;i++)assert.equal(all[i].local.hp,combatBaseline[i],'unrelated victim '+i+' takes no damage during targeted fire');
 log('eight-targeted-combat',{passed:true,scores:all.map(s=>s.scores),profiles:clients.map(c=>({xp:c.profile.xp,kills:c.profile.kills,deaths:c.profile.deaths}))});
 const diedAt=Date.now(),deathPosition=all[7].local.pos;
 if(mode==='tdm'){
  await delay(10500);all=await states();assert.equal(all[7].life,1);assert.equal(all[7].local.hp,0,'team player stays dead beyond ten seconds');
  log('team-no-mid-round-respawn',{passed:true});
  for(const victim of [1,3,5]){
   await place(clients[victim],pointB,facing+Math.PI);
   await waitPlacement(clients[victim],pointB,'cannon target '+victim+' settled');await delay(900);
   const cannon=dual&&victim===3?22:blastWeapon;
   for(let n=0;n<10;n++){
    if((await clients[victim].script.exports.lanstatus()).localDead)break;
    await clients[0].script.exports.queueNativeShot(cannon,null,clients[victim].peer.playerId);await delay(650);
   }
   await wait('enemy '+victim+' killed',async()=>{const v=await clients[victim].script.exports.lanstatus();return v.localDead;});
   assert(clients[0].events.some(e=>e.event==='lan-test-shot-result'&&e.weapon===cannon&&e.targetId===clients[victim].peer.playerId),'Native cannon '+cannon+' dispatched at player '+victim);
   log('native-cannon-kill',{passed:true,weapon:cannon,victim});
  }
  await wait('all eight next-round respawns',async()=>{const s=await states();return s.every(v=>v.life===2&&v.local.hp===100)&&s;},15000);
  all=await states();
  for(let viewer=0;viewer<8;viewer++)for(let player=0;player<8;player++){
   const index=viewer===player?0:all[viewer].peers.find(p=>p.id===clients[player].peer.playerId).index;
   assert.equal(all[viewer].scores[index].kills,player===0?4:0,'All scoreboards retain correct kills after the round');
   assert.equal(all[viewer].scores[index].deaths,player%2,'All scoreboards retain correct deaths after the round');
  }
  assert.equal(clients[0].profile.xp,startingXp+100,'Four native kills earn server XP');
  for(let i=0;i<8;i++)assert(battlefield.teamSpawns.slice((i%2)*4,(i%2+1)*4).some(p=>Math.hypot(...p.position.map((v,k)=>v-all[i].local.pos[k]))<160),'team spawn remains at its own map end');
  log('team-round-reset',{passed:true,positions:all.map(s=>s.local.pos),scores:all.map(s=>s.scores)});
 }else{
  await delay(7000);assert.equal((await clients[7].script.exports.lanstatus()).life,1,'no respawn before ten seconds');
  await wait('slot7 respawn received by all peers',async()=>{const s=await states();return s[7].life===2&&s.slice(0,7).every(v=>v.peers.find(p=>p.id===clients[7].peer.playerId).life===2);});
  const deathEvent=clients[7].events.find(e=>e.event==='offline-player-death');
  assert.equal(deathEvent.respawnInMs,10000);
  all=await states();assert.notDeepEqual(all[7].local.pos,deathPosition);
  log('dm-ten-second-random-respawn',{passed:true,elapsedSinceScoreMs:Date.now()-diedAt,position:all[7].local.pos});
 }
 clients[3].peer.close();await wait('single leave hides only one actor',async()=>{const s=await clients[0].script.exports.lanstatus();return s.peers.find(p=>p.id===clients[3].peer.playerId).left;});
 assert.equal(server.stats().players,7);assert(clients[0].peer.connected);
 log('eight-disconnect-continues',{passed:true});
 stopping=true;await Promise.all(clients.map(c=>c.script.exports.menucommand('quit').catch(()=>{})));
 await wait('all clean exits',()=>clients.every(c=>c.ended),10000);
 log('test-pass',{mode,mapIndex,dual,checks:['8 native games','56 remote actors','all-pair native position replication','slot7 targeted combat','all 8 scoreboards','server XP','individual disconnect','clean exit','input isolation',...(mode==='tdm'?['friendly explosive immunity','no mid-round respawn','team elimination and opposite-end next-round reset',...(dual?['both original cannons kill opponents']:[])]:['10-second random respawn'])]});
}catch(error){failure=error;log('test-failed',{message:String(error),stack:error.stack});process.exitCode=1;}
finally{
 stopping=true;clearTimeout(deadline);for(const c of clients){c.peer?.close();if(c.pid&&!c.ended)try{await device.kill(c.pid);}catch{}}
 await server.close();for(const name of ['profiles.json','auth.json']){const f=path.join(dataDir,name);if(fs.existsSync(f))fs.unlinkSync(f);}fs.rmdirSync(dataDir);
 for(let attempt=0;;attempt++)try{if(createdProbe)fs.unlinkSync(probe);else fs.writeFileSync(probe,originalProbe);break;}catch(error){if(attempt===49)throw error;await delay(100);}
}
console.log(JSON.stringify({mode,mapIndex,dual,passed:!failure,logPath,error:failure?String(failure):null}));
