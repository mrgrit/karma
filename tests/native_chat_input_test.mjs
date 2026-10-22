// Original-engine input boundary test. Hidden probe, no accounts or desktop input.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert(process.env.KARMA_GAME_ROOT,'Set KARMA_GAME_ROOT to an extracted release');
const root=path.resolve(process.env.KARMA_GAME_ROOT),game=path.join(root,'App_Executables'),support=path.join(repo,'client/Launcher');
const frida=await import(pathToFileURL(path.join(root,'Runtime/node_modules/frida/build/src/frida.js')).href);
const runtime=JSON.parse(fs.readFileSync(path.join(support,'runtime.json'),'utf8'));
const template=fs.readFileSync(path.join(support,'session-template.bin'));
assert.equal(crypto.createHash('sha256').update(template).digest('hex'),runtime.sha256);
for(const [k,v] of Object.entries({local:1,mode:1,matchType:1,age:0,map:7,character:0,camp:0}))template.writeInt32LE(v,runtime.offsets[k]);
const exe=path.join(game,'KarmaAIProbe.exe'),previous=fs.existsSync(exe)?fs.readFileSync(exe):null;
if(previous){const normalized=Buffer.from(previous);for(const offset of Object.values(runtime.offsets))template.copy(normalized,offset,offset,offset+4);assert(normalized.equals(template),'Existing probe differs outside config');}
fs.writeFileSync(exe,template);
const output=process.env.KARMA_TEST_OUTPUT||path.join(repo,'tests/native-chat-input.jsonl');fs.writeFileSync(output,'');
const log=e=>fs.appendFileSync(output,JSON.stringify({time:new Date().toISOString(),...e})+'\n');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let device,pid,session,script,ended=false,stopping=false,failure;const events=[];
async function wait(label,predicate){for(let i=0;i<250;i++){if(failure)throw failure;const value=await predicate();if(value)return value;await delay(100);}throw Error('Timeout: '+label);}
try{
 device=await frida.getLocalDevice();pid=await device.spawn([exe],{cwd:game});session=await device.attach(pid);
 const local={map:7,age:0,character:{model:'cpom_050.chr',name:'ChatHost'},rank:{id:'recruit'},inventory:[50,9,1,6,48,24,18],selectedWeapon:9,settings:{build:'karma290-central5'}};
 const peer={playerId:'guest',slot:1,team:1,config:{...local,character:{...local.character,name:'ChatGuest'}}};
 let source=fs.readFileSync(path.join(repo,'tests/ai_unattended_shim.js'),'utf8');
 source+='\nglobalThis.KARMA_TEST_HELD=0x54;globalThis.KARMA_LAN_CONFIG='+JSON.stringify({role:'host',central:true,localPlayerId:'host',remotePlayerId:'guest',slot:0,team:0,local,peers:[peer],match:{mode:'tdm',roomId:'chat-input-test'}})+';\n';
 for(const file of ['input-lan.js','legacy-controls.js','native-font.js','offline-death.js','window-size.js','lan-game.js']){
  let code=fs.readFileSync(path.join(support,file),'utf8');
  // Substitute only this module's observations; the isolation shim verifies
  // the actual desktop foreground and no keyboard/mouse devices independently.
  if(file==='input-lan.js')code=code.replace("const foreground = api('GetForegroundWindow', 'pointer', []);","const foreground = () => ptr('0x548d50').readPointer();")
   .replace("const getKey = api('GetAsyncKeyState', 'int16', ['int']);","const getKey = key => globalThis.KARMA_TEST_HELD === key ? -32768 : 0;");
  source+='\n(()=>{'+code+'})();\n';
 }
 source+=`(()=>{
  let frames=0;Interceptor.attach(ptr(0x451380),{onEnter(){frames++;}});
  const post=new NativeFunction(Process.getModuleByName('user32.dll').getExportByName('PostMessageW'),'int',['pointer','uint','pointer','pointer'],'stdcall');
  rpc.exports.testkey=key=>{globalThis.KARMA_TEST_HELD=key;};
  rpc.exports.testmessage=(message,key,repeat=false)=>post(ptr(0x548d50).readPointer(),message,ptr(key),ptr(repeat?0x40000000:0));
  rpc.exports.chatinputstate=()=>({frames,gate:KARMA_LOCAL_INPUT_NATIVE.flagPage.readU8(),clock:KARMA_LOCAL_INPUT_NATIVE.clockState.readU8(),paused:KARMA_LOCAL_PAUSED,inputPaused:KARMA_LOCAL_INPUT_PAUSED});
 })();`;
 script=await session.createScript(source);script.message.connect(m=>{
  if(m.type==='error'){failure=Error(m.description);log({event:'script-error',message:m.description});return;}
  if(m.type!=='send')return;const e=m.payload;if(e.event==='lan-outbound')return;events.push(e);log(e);
  if(['native-exception','unattended-safety-violation'].includes(e.event))failure=Error(e.event);
 });session.detached.connect((reason,crash)=>{ended=true;log({event:'detached',reason,crash:crash?String(crash):null});if(!stopping)failure=Error('Unexpected probe exit');});
 await script.load();await device.resume(pid);
 await wait('loaded and isolated',()=>events.some(e=>e.event==='unattended-isolation-verified')&&events.some(e=>e.event==='lan-game-ready'));
 assert(events.some(e=>e.kind==='hotkey-held-on-focus'&&e.key==='T'));
 assert(!events.some(e=>e.kind==='chat-requested'),'startup held T is ignored');
 await script.exports.testkey(0);await delay(400);await script.exports.testkey(0x54);
 await wait('all chat',()=>events.some(e=>e.kind==='chat-requested'&&e.channel==='all'));
 let before=await script.exports.chatinputstate();
 assert.equal(before.inputPaused,true);assert.equal(before.paused,false);assert.equal(before.gate,0);assert.equal(before.clock,0);
 await delay(700);let after=await script.exports.chatinputstate();assert(after.frames>before.frames,'native gameplay frames continue during chat');
 await script.exports.testmessage(0x100,0x54,true);await delay(200);
 assert.equal(events.filter(e=>e.kind==='chat-requested').length,1,'native repeated WM does not open another chat');
 await script.exports.menucommand('resume');await wait('resume all chat',async()=>!(await script.exports.chatinputstate()).inputPaused);
 await delay(300);assert.equal(events.filter(e=>e.kind==='chat-requested').length,1,'held opener cannot reopen after resume');
 await script.exports.testkey(0);await delay(300);await script.exports.testmessage(0x100,0x59);
 await wait('team chat from real WndProc',()=>events.some(e=>e.kind==='chat-requested'&&e.channel==='team'));
 assert(!events.some(e=>e.kind==='pause-requested'),'chat does not also request a pause dialog');
 before=await script.exports.chatinputstate();await delay(500);after=await script.exports.chatinputstate();assert(after.frames>before.frames);
 await script.exports.menucommand('results');await wait('results',()=>events.some(e=>e.kind==='results-ready'));
 await delay(300);before=await script.exports.chatinputstate();
 await script.exports.menucommand('resume');await script.exports.testmessage(0x101,0x54);await script.exports.testmessage(0x100,0x54);await delay(700);
 after=await script.exports.chatinputstate();assert.equal(after.frames,before.frames);assert.equal(after.gate,1);assert.equal(after.clock,1);assert.equal(after.inputPaused,true);
 assert.equal(events.filter(e=>e.kind==='chat-requested').length,2,'finished match cannot reopen chat');
 log({event:'PASS',startupHeldT:true,allChat:true,teamChatNativeWindowMessage:true,worldFramesContinue:true,resumeDebounced:true,resultsRemainFrozen:true});
 console.log('PASS isolated original Factory engine: startup T, all/team chat, actual WndProc Y, continued native gameplay, debounced resume and terminal results.');
}catch(e){log({event:'FAIL',message:String(e)});console.error(e);process.exitCode=1;}
finally{
 stopping=true;if(pid&&!ended)await device.kill(pid).catch(()=>{});
 for(let attempt=0;attempt<30;attempt++)try{if(previous)fs.writeFileSync(exe,previous);else fs.unlinkSync(exe);break;}catch(e){if(attempt===29)throw e;await delay(100);}
}
