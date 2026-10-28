// Isolated original-engine regression: no desktop window/input or live accounts.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCentralPeer} from '../client/Launcher/central-transport.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),support=path.join(repo,'client/Launcher');
assert(process.env.KARMA_GAME_ROOT&&process.env.KARMA_SERVER_ROOT,'Set isolated game and server roots');
const root=path.resolve(process.env.KARMA_GAME_ROOT),game=path.join(root,'App_Executables'),serverRoot=path.resolve(process.env.KARMA_SERVER_ROOT);
const {startKarmaServer}=await import(pathToFileURL(path.join(serverRoot,'server.mjs')).href);
const {validateRules,GAME_RULES}=await import(pathToFileURL(path.join(serverRoot,'rules.mjs')).href);
const runtime=JSON.parse(fs.readFileSync(path.join(support,'runtime.json'),'utf8'));
const mapIndex=Number(process.env.KARMA_TEST_MAP??7),map=JSON.parse(fs.readFileSync(path.join(support,'multiplayer-maps.json'),'utf8')).maps.find(m=>m.mapIndex===mapIndex&&m.publicReady);
assert(map,'Test only released maps');
const template=fs.readFileSync(path.join(support,'session-template.bin'));
assert.equal(crypto.createHash('sha256').update(template).digest('hex'),runtime.sha256);
for(const [k,v] of Object.entries({local:1,mode:1,matchType:1,age:map.age,map:mapIndex,character:0,camp:0}))template.writeInt32LE(v,runtime.offsets[k]);
const exe=path.join(game,'KarmaAIProbe.exe'),previous=fs.existsSync(exe)?fs.readFileSync(exe):null;
if(previous){const normalized=Buffer.from(previous);for(const offset of Object.values(runtime.offsets))template.copy(normalized,offset,offset,offset+4);assert(normalized.equals(template),'Probe identity');}
fs.writeFileSync(exe,template);
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'karma-death-chat-'));
const server=await startKarmaServer({host:'127.0.0.1',port:0,healthPort:0,dataDir,roundIntermissionMs:1200,logger:()=>{}});
const frida=await import(pathToFileURL(path.join(root,'Runtime/node_modules/frida/build/src/frida.js')).href),device=await frida.getLocalDevice();
const output=process.env.KARMA_TEST_OUTPUT||path.join(repo,'tests/native-death-chat.jsonl');fs.writeFileSync(output,'');
const log=(event,data={})=>fs.appendFileSync(output,JSON.stringify({time:new Date().toISOString(),event,...data})+'\n');
const clients=[],delay=ms=>new Promise(r=>setTimeout(r,ms));let failure,stopping=false;
async function wait(label,fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(failure)throw failure;const result=await fn();if(result)return result;await delay(80);}throw Error('Timeout: '+label);}
const states=()=>Promise.all(clients.map(c=>c.script.exports.lanstatus()));
const config={map:mapIndex,age:map.age,character:{index:0,camp:0,model:'cpom_050.chr',name:'Probe'},inventory:[50,9,1,6,48,49,18],selectedWeapon:9,settings:{build:'karma290-central6',mode:1}};
const probeSource=`(()=>{
 if(Process.mainModule.name.toLowerCase()!=='karmaaiprobe.exe')throw Error('Test-only');
 let pending=false,frames=0;
 const damage=new NativeFunction(ptr(0x461e50),'void',['pointer','int','int','int'],'thiscall');
 const post=new NativeFunction(Process.getModuleByName('user32.dll').getExportByName('PostMessageW'),'int',['pointer','uint','pointer','pointer'],'stdcall');
 Interceptor.attach(ptr(0x451380),{onEnter(){frames++;if(!pending)return;pending=false;const a=this.context.ecx.add(0xfcc).readPointer();damage(a,1,200,9);}});
 rpc.exports.testlethal=()=>{pending=true;};
 rpc.exports.testmessage=(message,key,repeat=false)=>post(ptr(0x548d50).readPointer(),message,ptr(key),ptr(repeat?0x40000000:0));
 rpc.exports.testinput=()=>({frames,paused:KARMA_LOCAL_INPUT_PAUSED,worldPaused:KARMA_LOCAL_PAUSED});
})();`;
try{
 for(let i=0;i<4;i++){
  const account=await server.auth.createAccount({rulesAcceptance:validateRules({rulesAccepted:true,rulesVersion:GAME_RULES.version}),email:crypto.randomUUID()+'@test.invalid',password:crypto.randomUUID(),name:'DeathProbe '+i});
  const c={i,events:[],pending:[],status:[]};clients.push(c);
  c.peer=await createCentralPeer({role:i===0?'host':'join',host:'127.0.0.1',port:server.port,secure:false,identityPath:null,identity:{authToken:server.auth.issueSession(account).authToken},code:'734200',config,mode:'tdm',maxPlayers:4,roundWinLimit:10,manualStart:true,
   onStatus:s=>{c.status.push(s);log('transport',{client:i,...s});},
   onMessage:m=>{if(stopping)return;if(c.loaded)c.script.exports.lanreceive(m).catch(e=>{if(!stopping)failure=e;});else c.pending.push(m);}});
 }
 await wait('four seats',()=>clients[0].peer.match.members?.length===4);
 for(const c of clients)c.peer.updateLobby({requestId:crypto.randomUUID(),ready:true});
 await wait('ready',()=>clients[0].peer.match.canStart);clients[0].peer.startMatch();
 await Promise.all(clients.map(async c=>{c.hello=await c.peer.ready;}));
 for(const c of clients){
  c.pid=await device.spawn([exe],{cwd:game});c.session=await device.attach(c.pid);
  let source=fs.readFileSync(path.join(repo,'tests/ai_unattended_shim.js'),'utf8')+'\nglobalThis.KARMA_LAN_CONFIG='+JSON.stringify({role:c.i===0?'host':'join',central:true,local:c.peer.effectiveConfig,localPlayerId:c.peer.playerId,remotePlayerId:c.peer.remotePlayerId,remoteHello:c.hello,peers:c.peer.peers,slot:c.peer.slot,team:c.peer.team,match:c.peer.match})+';\n';
  for(const name of ['startup-diagnostics.js','input-lan.js','legacy-controls.js','offline-death.js','window-size.js','lan-game.js']){
   let code=fs.readFileSync(path.join(support,name),'utf8');
   if(name==='input-lan.js')code=code.replace("const foreground = api('GetForegroundWindow', 'pointer', []);","const foreground = () => ptr('0x548d50').readPointer();").replace("const getKey = api('GetAsyncKeyState', 'int16', ['int']);","const getKey = key => 0;");
   source+='\n(()=>{'+code+'})();\n';
  }
  c.script=await c.session.createScript(source+probeSource);
  c.script.message.connect(m=>{
   if(m.type==='error'){failure=Error(m.description);log('script-error',{client:c.i,message:m.description});return;}
   if(m.type!=='send')return;const e=m.payload;
   if(e.event==='lan-outbound'){try{c.peer.send(e.message);}catch(error){failure=error;}return;}
   if(e.event==='lan-damage-proof'){c.peer.send({type:'damage-proof',proof:e.proof});return;}
   c.events.push(e);if(e.event!=='lan-tick')log('native',{client:c.i,...e});
   if(e.event==='native-exception'||e.event==='unattended-safety-violation')failure=Error(e.event);
  });
  c.session.detached.connect((reason,crash)=>{c.ended=true;log('detached',{client:c.i,reason,crash:crash?String(crash):null});if(!stopping)failure=Error('Unexpected exit '+c.i);});
  await c.script.load();c.loaded=true;for(const m of c.pending.splice(0))await c.script.exports.lanreceive(m);await device.resume(c.pid);
 }
 await wait('four native engines',async()=>{const s=await states();return s.every(x=>x.ready&&x.peers.every(p=>p.life===1));},60000);
 assert(clients.every(c=>c.events.some(e=>e.event==='unattended-isolation-verified')));
 const victim=clients[0],ally=clients.find(c=>c.i!==0&&c.peer.team===victim.peer.team);
 for(let round=1;round<=6;round++){
  const before=(await states())[0];assert.equal(before.life,round);assert.equal(before.local.hp,100);
  if(round%2){
   await victim.script.exports.testmessage(0x100,round===3?0x59:0x54);await victim.script.exports.testmessage(0x101,round===3?0x59:0x54);
   await wait('chat input pause',async()=>(await victim.script.exports.testinput()).paused);
   const requestId=crypto.randomUUID();victim.peer.sendChat(round===3?'team':'all','death transition probe '+round,requestId);
   await wait('chat delivered',()=>victim.status.some(s=>s.phase==='chat'&&s.requestId===requestId));
  }
  await victim.script.exports.testlethal();
  await wait('native death',async()=>{const s=await states();return s[0].localDead&&s[0].local.hp===0&&s[0].scores[0].deaths===round;});
  await delay(700);assert.equal(server.stats().players,4);assert(clients.every(c=>c.peer.connected&&!c.ended));
  const dead=(await states())[0];assert.equal(dead.life,round,'No mid-round resurrection');
  if(process.argv.includes('--spectator')){
   await wait('native spectator camera renders',async()=>{const s=(await states())[0];return s.spectator?.active&&s.spectator.cameraFrames>round*3;});
   const s=(await states())[0],view=s.spectator;
   assert.equal(view.targetId,ally.peer.playerId,'Watch only living teammate');
   assert.equal(view.error,null);assert(view.cameraRestores>=view.cameraFrames-1,'Every borrowed camera frame is restored');
   assert.equal(view.lastView.physicalLocalIndex,0,'Physical player identity stays local');
   assert.equal(view.lastView.localHp,0,'Spectator does not resurrect corpse');
   assert(view.lastView.visibleSectors>0,'Target view includes world geometry');
   assert.equal(view.targetName,'DeathProbe '+ally.i,'Spectator displays account name');
   assert((await victim.script.exports.lanspectate(1)).accepted);
   log('spectator-proof',{round,...view});
  }
  if(round%2){
   const frame=(await victim.script.exports.testinput()).frames;await delay(250);assert((await victim.script.exports.testinput()).frames>frame,'World progresses during dead-player chat');
  }
  await ally.script.exports.testlethal();
  await wait('next native round',async()=>{const s=await states();return s.every(x=>x.life===round+1&&x.local.hp===100);},15000);
  if(round%2){await victim.script.exports.menucommand('resume');await wait('chat resume',async()=>!(await victim.script.exports.testinput()).paused);}
  if(process.argv.includes('--spectator'))assert.equal((await states())[0].spectator?.active,false,'Own view restored on respawn');
  log('round-pass',{round,chat:round%2===1,players:server.stats().players});
 }
 assert(!clients.some(c=>c.events.some(e=>e.kind==='exit-requested')),'No accidental quit');
 assert(clients.every(c=>c.peer.connected&&!c.ended));
 log('test-pass',{map:map.name,rounds:6,nativeDeaths:12,spectator:process.argv.includes('--spectator'),chatAcrossDeathAndRespawn:true,bothArmorNative:config.inventory,isolated:true});
 console.log('PASS four native '+map.name+' clients: twelve deaths, six round transitions, chat across death and respawn, no unwanted disconnect/quit.');
}catch(error){log('test-failed',{message:String(error),stack:error.stack});console.error(error);process.exitCode=1;}
finally{
 stopping=true;for(const c of clients){c.peer?.close();if(c.pid&&!c.ended)await device.kill(c.pid).catch(()=>{});}await server.close();
 const tempRoot=path.resolve(os.tmpdir());assert(path.resolve(dataDir).startsWith(tempRoot+path.sep)&&path.basename(dataDir).startsWith('karma-death-chat-'));fs.rmSync(dataDir,{recursive:true,force:true});
 for(let attempt=0;attempt<30;attempt++)try{if(previous)fs.writeFileSync(exe,previous);else fs.unlinkSync(exe);break;}catch(error){if(attempt===29)throw error;await delay(100);}
}
