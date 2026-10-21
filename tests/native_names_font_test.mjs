import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.KARMA_GAME_ROOT)throw Error('Set KARMA_GAME_ROOT to the extracted game.');
const root=path.resolve(process.env.KARMA_GAME_ROOT),support=path.join(repo,'client/Launcher'),game=path.join(root,'App_Executables');
const frida=await import(pathToFileURL(path.join(root,'Runtime/node_modules/frida/build/src/frida.js')).href);
const runtime=JSON.parse(fs.readFileSync(path.join(support,'runtime.json'),'utf8'));
const template=fs.readFileSync(path.join(support,'session-template.bin'));
for(const [key,value] of Object.entries({local:1,mode:1,matchType:1,age:0,map:7,character:0,camp:0}))template.writeInt32LE(value,runtime.offsets[key]);
const exe=path.join(game,'KarmaAIProbe.exe');fs.writeFileSync(exe,template);
const output=process.env.KARMA_TEST_OUTPUT||path.join(repo,'tests/native-names-font.jsonl');fs.writeFileSync(output,'');
const log=event=>fs.appendFileSync(output,JSON.stringify({time:new Date().toISOString(),...event})+'\n');
let pid,device,session,script,detached=false,failure;const events=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(predicate){for(let i=0;i<150;i++){if(failure)throw failure;if(detached)throw Error('Unexpected process exit');const result=await predicate();if(result)return result;await sleep(100);}throw Error('Native UI test timed out');}
try{
 device=await frida.getLocalDevice();pid=await device.spawn([exe],{cwd:game});session=await device.attach(pid);
 let source=fs.readFileSync(path.join(repo,'tests/ai_unattended_shim.js'),'utf8');
 const local={map:7,age:0,character:{model:'cpom_050.chr',name:'한글사용자'},rank:{id:'recruit'},inventory:[50,9,1,6,48,24,18],selectedWeapon:9,settings:{build:'karma290-central5'}};
 const peer={playerId:'guest',slot:1,team:1,config:{...local,character:{...local.character,name:'테스트Guest'}}};
 source+='\nglobalThis.KARMA_LAN_CONFIG='+JSON.stringify({role:'host',central:true,localPlayerId:'host',remotePlayerId:'guest',slot:0,team:0,local,peers:[peer],match:{mode:'duel',roomId:'presentation-test'}})+';\n';
 for(const file of ['input-lan.js','legacy-controls.js','native-font.js','offline-death.js','window-size.js','lan-game.js','rank-display.js','player-names.js'])source+='\n(()=>{'+fs.readFileSync(path.join(support,file),'utf8')+'})();\n';
 source+=`(() => {
  let frames=0,held=0;const fontHeights=[];const queries={};const names=[];
  const decode=new NativeFunction(Process.getModuleByName('kernel32.dll').getExportByName('MultiByteToWideChar'),'int',['uint','uint','pointer','int','pointer','int'],'stdcall');
  function name(p){const b=Memory.alloc(512);const n=decode(949,0,p,-1,b,256);return n>0?b.readUtf16String():null;}
  Interceptor.attach(Process.getModuleByName('gdi32.dll').getExportByName('CreateFontA'),{onEnter(a){fontHeights.push({height:a[0].toInt32(),caller:this.returnAddress.toString()});}});
  Interceptor.attach(ptr(0x42b980),{onEnter(a){names.push(name(a[0]));}});
  Interceptor.attach(ptr(0x4190d0),{onEnter(){frames++;}});
  Interceptor.attach(ptr(0x4a8330),{onEnter(a){this.scan=a[0].toInt32();},onLeave(r){if(held&&this.scan===held){r.replace(1);queries[held]=(queries[held]||0)+1;}}});
  Process.setExceptionHandler(d=>{send({event:'native-exception',type:d.type,address:d.address.toString()});return false;});
  rpc.exports.presentation=(scan=0)=>{held=scan;const main=ptr(0x548d5c).readPointer();if(main.isNull())return {frames};
   const g=main.add(0x140).readPointer();if(g.isNull())return {frames};const m=g.add(0xc).readPointer();
   return {frames,fontHeights,queries,names,roster:[0,1].map(i=>name(g.add(0x166+256*i))),actors:[0,1].map(i=>{const a=m.add(0xfcc+4*i).readPointer();return a.isNull()?null:name(a.add(0x160));})};};
 })();`;
 script=await session.createScript(source);script.message.connect(m=>{
  const e=m.type==='send'?m.payload:{event:'script-error',message:m.description};events.push(e);log(e);
  if(['native-exception','script-error','unattended-safety-violation'].includes(e.event))failure=Error(JSON.stringify(e));
 });session.detached.connect((reason,crash)=>{detached=true;log({event:'detached',reason,crash:crash?String(crash):null});});
 await script.load();await device.resume(pid);
 await wait(()=>events.some(e=>e.event==='unattended-isolation-verified')&&events.some(e=>e.event==='lan-game-ready'));
 let state=await script.exports.presentation(0x2a);await sleep(500);state=await script.exports.presentation(0);
 assert(state.queries[0x2a]>0,'native Shift scoreboard branch exercised');
 await script.exports.presentation(0x3b);await sleep(100);await script.exports.presentation(0);await sleep(500);
 state=await script.exports.presentation();assert(state.queries[0x3b]>0,'native help branch exercised');
 assert.deepEqual(state.roster,['한글사용자','테스트Guest']);assert.deepEqual(state.actors,state.roster);
 assert(state.names.includes('한글사용자'),'HUD name cache must use the account name');
 assert(!state.names.includes('KampGrupe'),'original practice name must not leak into HUD');
 assert(events.some(e=>e.event==='native-font-dpi'&&e.desktopDpi===192&&e.fontDpi===96),'actual 200% desktop DPI normalized for fonts');
 assert(state.fontHeights.some(f=>Math.abs(f.height)===13),'10pt font uses 13px');
 assert(state.fontHeights.some(f=>Math.abs(f.height)===16),'12pt font uses 16px');
 if(failure)throw failure;log({event:'PASS',...state});console.log('PASS original engine: Korean local/peer roster and actor names, HUD account name, Shift/F1 queries, 200% DPI fonts.');
}catch(e){log({event:'FAIL',message:String(e)});console.error(e);process.exitCode=1;}
finally{if(pid&&!detached)await device.kill(pid).catch(()=>{});}
