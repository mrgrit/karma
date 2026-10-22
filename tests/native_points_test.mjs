import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.KARMA_GAME_ROOT)throw Error('Set KARMA_GAME_ROOT to the extracted game.');
const root=path.resolve(process.env.KARMA_GAME_ROOT),support=path.join(repo,'client/Launcher'),game=path.join(root,'App_Executables');
const frida=await import(pathToFileURL(path.join(root,'Runtime/node_modules/frida/build/src/frida.js')).href);
const runtime=JSON.parse(fs.readFileSync(path.join(support,'runtime.json'),'utf8'));
const template=fs.readFileSync(path.join(support,'session-template.bin'));
assert.equal(crypto.createHash('sha256').update(template).digest('hex'),runtime.sha256);
for(const [key,value] of Object.entries({local:1,mode:1,matchType:1,age:0,map:7,character:0,camp:0}))template.writeInt32LE(value,runtime.offsets[key]);
const exe=path.join(game,'KarmaAIProbe.exe'),original=fs.existsSync(exe)?fs.readFileSync(exe):null;
if(original){const normalized=Buffer.from(original);for(const offset of Object.values(runtime.offsets))template.copy(normalized,offset,offset,offset+4);assert(normalized.equals(template),'Existing probe differs outside configuration');}
fs.writeFileSync(exe,template);
const output=process.env.KARMA_TEST_OUTPUT||path.join(repo,'tests/native-points.jsonl');fs.writeFileSync(output,'');
const log=event=>fs.appendFileSync(output,JSON.stringify({time:new Date().toISOString(),...event})+'\n');
let pid,device,session,script,detached=false,failure;const events=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(predicate){for(let i=0;i<150;i++){if(failure)throw failure;if(detached)throw Error('Unexpected process exit');const value=await predicate();if(value)return value;await sleep(100);}throw Error('Native points test timed out');}
try{
 device=await frida.getLocalDevice();pid=await device.spawn([exe],{cwd:game});session=await device.attach(pid);
 let source=fs.readFileSync(path.join(repo,'tests/ai_unattended_shim.js'),'utf8');
 const local={map:7,age:0,character:{model:'cpom_050.chr',name:'PointHost'},rank:{id:'recruit'},inventory:[50,9,1,6,48,24,18],selectedWeapon:9,settings:{build:'karma290-central5'}};
 const peer={playerId:'guest',slot:1,team:1,config:{...local,character:{...local.character,name:'PointGuest'}}};
 source+='\nglobalThis.KARMA_LAN_CONFIG='+JSON.stringify({role:'host',central:true,localPlayerId:'host',remotePlayerId:'guest',slot:0,team:0,local,peers:[peer],match:{mode:'duel',roomId:'points-test'}})+';\n';
 for(const file of ['input-lan.js','legacy-controls.js','native-font.js','offline-death.js','window-size.js','lan-game.js','rank-display.js','player-names.js'])source+='\n(()=>{'+fs.readFileSync(path.join(support,file),'utf8')+'})();\n';
 source+=`(() => {
  let held=false,overlayCalls=0;const rows=[],numbers=[];
  Interceptor.attach(ptr(0x4a8330),{onEnter(a){this.scan=a[0].toInt32();},onLeave(r){if(held&&this.scan===0x2a)r.replace(1);}});
  // The unattended shim deliberately has no foreground/input device. Select the
  // same native score-view argument while leaving its row/number paths intact.
  Interceptor.attach(ptr(0x423cb0),{onEnter(a){overlayCalls++;if(held)a[1]=ptr(1);}});
  Interceptor.attach(ptr(0x42f7d0),{onEnter(a){rows.push({slot:a[6].toInt32(),kills:a[2].toInt32(),deaths:a[3].toInt32()&65535,points:a[5].toInt32()});}});
  Interceptor.attach(ptr(0x430260),{onEnter(a){if(this.returnAddress.equals(ptr(0x42f8f5)))numbers.push(a[2].toInt32());}});
  Process.setExceptionHandler(d=>{send({event:'native-exception',type:d.type,address:d.address.toString()});return false;});
  rpc.exports.pointrows=(show=false)=>{held=show;return {overlayCalls,rows:rows.splice(0),numbers:numbers.splice(0)};};
 })();`;
 script=await session.createScript(source);script.message.connect(m=>{
  const e=m.type==='send'?m.payload:{event:'script-error',message:m.description};events.push(e);log(e);
  if(['native-exception','script-error','unattended-safety-violation'].includes(e.event))failure=Error(JSON.stringify(e));
 });session.detached.connect((reason,crash)=>{detached=true;log({event:'detached',reason,crash:crash?String(crash):null});});
 await script.load();await device.resume(pid);
 await wait(()=>events.some(e=>e.event==='unattended-isolation-verified')&&events.some(e=>e.event==='lan-game-ready'));
 const state=await script.exports.lanstatus();
 // A real replicated pose makes the remote actor eligible for the original row.
 await script.exports.lanreceive({...state.local,version:1,type:'state',senderId:'guest',life:1,seq:1});
 await script.exports.lanreceive({version:1,type:'match-snapshot',remainingSeconds:599,players:[
  {playerId:'host',kills:1,deaths:0,points:25},{playerId:'guest',kills:0,deaths:1,points:5}]});
 await wait(async()=>{const s=await script.exports.lanstatus();return s.scores[0].points===25&&s.scores[1].points===5;});
 await script.exports.pointrows(true);await sleep(600);let drawn=await script.exports.pointrows(false);
 log({event:'first-render-observed',...drawn});
 assert(drawn.rows.some(r=>r.slot===0&&r.kills===1&&r.deaths===0&&r.points===25),'Original Shift local row receives exact confirmed Point');
 assert(drawn.rows.some(r=>r.slot===1&&r.kills===0&&r.deaths===1&&r.points===5),'Original Shift peer row receives exact confirmed Point');
 assert(drawn.numbers.includes(25)&&drawn.numbers.includes(5),'Actual original numeric renderer receives both Point values');
 log({event:'points-rendered',rows:[...new Map(drawn.rows.map(r=>[r.slot,r])).values()],numbers:[...new Set(drawn.numbers)]});
 await script.exports.lanreceive({version:1,type:'match-snapshot',remainingSeconds:598,players:[
  {playerId:'host',kills:2,deaths:1,points:55},{playerId:'guest',kills:1,deaths:2,points:35}]});
 await wait(async()=>{const s=await script.exports.lanstatus();return s.scores[0].points===55&&s.scores[1].points===35;});
 await script.exports.pointrows(true);await sleep(500);drawn=await script.exports.pointrows(false);
 assert(drawn.numbers.includes(55)&&drawn.numbers.includes(35),'Subsequent confirmed scores are drawn, not cached');
 if(failure)throw failure;log({event:'PASS',rows:[...new Map(drawn.rows.map(r=>[r.slot,r])).values()],numbers:[...new Set(drawn.numbers)]});
 console.log('PASS original Factory engine: isolated Shift Point rows and numeric renderer show 25/5 then 55/35 from confirmed snapshots.');
}catch(e){log({event:'FAIL',message:String(e)});console.error(e);process.exitCode=1;}
finally{
 if(pid&&!detached)await device.kill(pid).catch(()=>{});
 for(let attempt=0;attempt<30;attempt++){
  try{if(original)fs.writeFileSync(exe,original);else fs.unlinkSync(exe);break;}
  catch(e){if(attempt===29)throw e;await sleep(100);}
 }
}
