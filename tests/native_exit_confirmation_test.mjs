// Isolated original-engine Factory duel. No real accounts, fees or desktop input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createCentralPeer} from '../client/Launcher/central-transport.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert(process.env.KARMA_GAME_ROOT&&process.env.KARMA_SERVER_ROOT,'Set game/server test roots');
const root=path.resolve(process.env.KARMA_GAME_ROOT),game=path.join(root,'App_Executables'),support=path.join(repo,'client/Launcher');
const {startKarmaServer}=await import(pathToFileURL(path.resolve(process.env.KARMA_SERVER_ROOT,'server.mjs')).href);
const server=await startKarmaServer({host:'127.0.0.1',port:0,healthPort:0,dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'karma-confirm-')),logger:()=>{}});
const runtime=JSON.parse(fs.readFileSync(path.join(support,'runtime.json'),'utf8'));
const template=fs.readFileSync(path.join(support,'session-template.bin'));
assert.equal(crypto.createHash('sha256').update(template).digest('hex'),runtime.sha256);
for(const [key,value] of Object.entries({local:1,mode:1,matchType:1,age:0,map:7,character:0,camp:0}))template.writeInt32LE(value,runtime.offsets[key]);
const exe=path.join(game,'KarmaAIProbe.exe'),previous=fs.existsSync(exe)?fs.readFileSync(exe):null;
fs.writeFileSync(exe,template);
const frida=await import(pathToFileURL(path.join(root,'Runtime/node_modules/frida/build/src/frida.js')).href);
const device=await frida.getLocalDevice(),clients=[];
const output=process.env.KARMA_TEST_OUTPUT||path.join(repo,'tests/native-exit-confirmation.jsonl');fs.writeFileSync(output,'');
const log=e=>fs.appendFileSync(output,JSON.stringify({time:new Date().toISOString(),...e})+'\n');
let failure,stopping=false;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(label,predicate){for(let i=0;i<300;i++){if(failure)throw failure;const r=await predicate();if(r)return r;await delay(100);}throw Error('Timeout: '+label);}
const config={map:7,age:0,character:{index:0,camp:0,model:'cpom_050.chr',name:'Probe'},inventory:[50,9,1,6,48,24,18],selectedWeapon:9,settings:{build:'karma290-central5',mode:1}};
try {
 for(let i=0;i<2;i++){
  const account=await server.auth.createAccount({email:`confirm${i}@native.invalid`,password:crypto.randomUUID(),name:'Probe'+i,role:'admin'});
  const c={i,role:i?'join':'host',events:[],pending:[]};clients.push(c);
  c.peer=await createCentralPeer({role:c.role,host:'127.0.0.1',port:server.port,secure:false,identityPath:null,
   identity:{authToken:server.auth.issueSession(account).authToken},code:'876123',config,maxPlayers:2,mode:'duel',manualStart:true,
   onMessage:x=>{if(stopping||c.expectExit||c.ended)return;if(c.loaded)c.script.exports.lanreceive(x).catch(e=>{if(!stopping&&!c.expectExit&&!c.ended)failure=e;});else c.pending.push(x);}});
 }
 await wait('two lobby seats',()=>clients[0].peer.match.members?.length===2);
 for(const c of clients)c.peer.updateLobby({requestId:crypto.randomUUID(),ready:true});
 await wait('both ready',()=>clients[0].peer.match.canStart);assert(clients[0].peer.startMatch());
 await Promise.all(clients.map(async c=>{c.hello=await c.peer.ready;}));
 for(const c of clients){
  c.pid=await device.spawn([exe],{cwd:game});c.session=await device.attach(c.pid);
  let source=fs.readFileSync(path.join(repo,'tests/ai_unattended_shim.js'),'utf8');
  source+='\nglobalThis.KARMA_LAN_CONFIG='+JSON.stringify({role:c.role,central:true,local:c.peer.effectiveConfig,localPlayerId:c.peer.playerId,remotePlayerId:c.peer.remotePlayerId,remoteHello:c.hello,peers:c.peer.peers,slot:c.peer.slot,team:c.peer.team,match:c.peer.match})+';\n';
  // Substitute only the input module's foreground/key providers. The isolation
  // shim still verifies the real desktop foreground and absence of devices.
  source+='\nglobalThis.KARMA_TEST_HELD=0x1b;\n';
  for(const file of ['input-lan.js','legacy-controls.js','native-font.js','offline-death.js','window-size.js','lan-game.js']){
   let code=fs.readFileSync(path.join(support,file),'utf8');
   if(file==='input-lan.js')code=code.replace("const foreground = api('GetForegroundWindow', 'pointer', []);","const foreground = () => ptr('0x548d50').readPointer();")
    .replace("const getKey = api('GetAsyncKeyState', 'int16', ['int']);","const getKey = key => globalThis.KARMA_TEST_HELD === key ? -32768 : 0;");
   source+='\n(()=>{'+code+'})();\n';
  }
  source+=`\nrpc.exports.testkey=key=>{globalThis.KARMA_TEST_HELD=key;};`;
  c.script=await c.session.createScript(source);
  c.script.message.connect(m=>{
   if(m.type==='error'){failure=Error(m.description);log({event:'script-error',client:c.i,...m});return;}
   if(m.type!=='send')return;const p=m.payload;
   if(p.event==='lan-outbound'){c.peer.send(p.message);return;}
   if(p.event==='lan-damage-proof'){c.peer.send({type:'damage-proof',proof:p.proof});return;}
   c.events.push(p);log({client:c.i,...p});
   if(['native-exception','unattended-safety-violation'].includes(p.event))failure=Error(p.event);
  });
  c.session.detached.connect((reason,crash)=>{c.ended=true;log({event:'detached',client:c.i,reason,crash:crash?String(crash):null});if(!stopping&&!c.expectExit)failure=Error('Unexpected exit '+c.i);});
  await c.script.load();c.loaded=true;for(const x of c.pending.splice(0))await c.script.exports.lanreceive(x);await device.resume(c.pid);
 }
 await wait('Factory actors loaded',async()=>{const s=await Promise.all(clients.map(c=>c.script.exports.lanstatus()));return s.every(x=>x.ready&&x.peers.length===1);});
 await wait('desktop isolated',()=>clients.every(c=>c.events.some(e=>e.event==='unattended-isolation-verified')));
 assert(clients.every(c=>c.events.some(e=>e.kind==='hotkey-held-on-focus')),'both startup Esc states suppressed');
 assert(clients.every(c=>!c.events.some(e=>e.kind==='pause-requested'||e.kind==='exit-requested')));
 const c=clients[0];await c.script.exports.testkey(0);await delay(500);await c.script.exports.testkey(0x1b);
 await wait('exit confirmation',()=>c.events.some(e=>e.kind==='pause-requested'&&e.confirmExit));
 assert(!c.ended);assert(!clients[1].ended);
 await c.script.exports.menucommand('resume');
 await wait('cancel resumes',()=>c.events.some(e=>e.kind==='pause-resumed'));
 await delay(500);assert.equal(c.events.filter(e=>e.kind==='pause-requested').length,1,'held Esc cannot reopen');
 await c.script.exports.testkey(0);await delay(300);await c.script.exports.testkey(0x79);
 await wait('F10 remains available',()=>c.events.some(e=>e.kind==='pause-requested'&&!e.confirmExit));
 assert(!c.events.some(e=>e.kind==='exit-requested'));
 c.expectExit=true;await c.script.exports.menucommand('quit');
 await wait('confirmed exit',()=>c.ended);
 assert(c.events.some(e=>e.kind==='exit-requested'&&e.confirmation));
 assert(!clients[1].ended,'peer native process remains alive before transport cleanup');
 log({event:'PASS',map:7,players:2,startupHeldEscape:true,confirmationCancel:true,f10:true,confirmedExit:true});
 console.log('PASS original-engine Factory duel: both ready, first-frame held Esc ignored, confirmation/cancel preserves two clients, F10 and explicit exit.');
}catch(e){log({event:'FAIL',message:String(e)});console.error(e);process.exitCode=1;}
finally{
 stopping=true;
 for(const c of clients){c.peer?.close();if(c.pid&&!c.ended)await device.kill(c.pid).catch(()=>{});}
 await server.close();
 for(let attempt=0;attempt<20;attempt++)try{if(previous)fs.writeFileSync(exe,previous);else fs.unlinkSync(exe);break;}catch(e){if(attempt===19)throw e;await delay(100);}
}
