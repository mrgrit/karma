import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=path.resolve(repo,'../..');
const gameRoot=path.resolve(process.env.KARMA_GAME_ROOT||path.join(workspace,'outputs/Karma'));
const game=path.join(gameRoot,'App_Executables'),support=path.join(repo,'client/Launcher');
const runtime=JSON.parse(fs.readFileSync(path.join(support,'runtime.json'),'utf8').replace(/^\uFEFF/,''));
const template=fs.readFileSync(path.join(support,'session-template.bin'));
assert.equal(crypto.createHash('sha256').update(template).digest('hex'),runtime.sha256);
for(const [key,value]of Object.entries({local:1,mode:1,matchType:1,age:0,map:0,character:0,camp:0}))template.writeInt32LE(value,runtime.offsets[key]);
const probe=path.join(game,'KarmaAIProbe.exe'),original=fs.existsSync(probe)?fs.readFileSync(probe):null;
if(original){const comparable=Buffer.from(original);for(const offset of Object.values(runtime.offsets))template.copy(comparable,offset,offset,offset+4);assert(comparable.equals(template),'Existing fixture has unsupported changes');}
const frida=await import(pathToFileURL(path.join(gameRoot,'Runtime/node_modules/frida/build/src/frida.js')).href);
let source=fs.readFileSync(path.join(workspace,'work/ai_unattended_shim.js'),'utf8')+'\n';
source+=fs.readFileSync(path.join(repo,'tests/manual_pickup_probe.js'),'utf8')
 .replace('/*__PICKUP_MODULE__*/',fs.readFileSync(path.join(repo,'native/lan_loadout_game.js'),'utf8'));
source+='\nProcess.setExceptionHandler(details=>{send({event:"native-exception",details});return false;});';
const logPath=path.join(repo,'tests/native-manual-pickup.jsonl');fs.writeFileSync(logPath,'');
const log=value=>fs.appendFileSync(logPath,JSON.stringify({time:new Date().toISOString(),...value})+'\n');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hold=setInterval(()=>{},1000);let device,pid,session,script,timer,failed=null,stopping=false,isolated=false;
const check=(value,label,detail)=>{log({event:'pickup-assert',label,ok:Boolean(value),detail});assert(value,label);};
try{
 fs.writeFileSync(probe,template);device=await frida.getLocalDevice();pid=await device.spawn([probe],{cwd:game});session=await device.attach(pid);
 script=await session.createScript(source);
 script.message.connect(m=>{const p=m.type==='send'?m.payload:{event:'script-error',description:m.description,stack:m.stack};log(p);
  if(p.event==='unattended-isolation-verified')isolated=true;
  if(['script-error','native-exception','unattended-safety-violation'].includes(p.event)){failed=Error(p.event);device.kill(pid).catch(()=>{});}});
 session.detached.connect(reason=>{if(!stopping)failed=Error('Unexpected detach '+reason);});
 await script.load();timer=setTimeout(()=>{failed=Error('45-second bound');device.kill(pid).catch(()=>{});},45000);
 log({event:'pickup-artifacts',pid,exeSha256:crypto.createHash('sha256').update(template).digest('hex'),scriptSha256:crypto.createHash('sha256').update(source).digest('hex')});
 await device.resume(pid);
 const wait=async(label,predicate,timeout=12000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){if(failed)throw failed;const r=await predicate();if(r)return r;await delay(50);}throw Error('Timeout '+label);};
 const status=()=>script.exports.pickupProbeStatus();
 await wait('ready',async()=>isolated&&(await status()).ready);
 const run=async c=>{const id=await script.exports.pickupProbeQueue(c);const r=await wait('command',()=>script.exports.pickupProbeResult(id));if(!r.ok)throw Error(r.error);return r;};
 const claims=(s,t)=>s.events.filter(e=>e.type===t);
 check(isolated,'hidden-no-input-ready');
 await run({action:'ammo',weapon:9,magazine:3,reserve:7});
 await run({action:'key',scan:0x22,held:true});
 let s=await wait('G claim',async()=>{const x=await status();return claims(x,'drop-claim').length&&x;});
 const request=claims(s,'drop-claim')[0];
 check(request.weapon===9&&request.magazine===3&&request.reserve===7,'G-exact-ammo',request);
 check(s.inventory.owned.includes(9),'G-does-not-remove-before-authority');
 await delay(300);check(claims(await status(),'drop-claim').length===1,'held-G-is-single-request');
 const ownDrop={id:'own-drop',weapon:9,magazine:3,reserve:7,pos:s.pos,sector:s.sector};
 const grant={id:request.requestId,playerId:'probe-player',life:1,weapon:9,removeSlot:1,selectedWeapon:1,inventory:[0,255,1,6,48,24,18],drop:ownDrop};
 s=await run({action:'message',message:{type:'drop-grant',grant}});
 check(!s.inventory.owned.includes(9)&&s.inventory.selectedWeapon===1,'G-ack-removes-and-equips-remaining');
 await run({action:'key',scan:0x22,held:false});
 await wait('native ground proximity',async()=>{const x=await status();return x.physical.some(d=>d.nearbyAt>0)&&x;});
 await delay(300);s=await status();check(claims(s,'pickup-claim').length===0&&s.physical[0].active===1,'native-proximity-never-auto-picks',s.physical);
 await run({action:'key',scan:0x12,held:true});
 s=await wait('E claim',async()=>{const x=await status();return claims(x,'pickup-claim').length&&x;});
 check(claims(s,'pickup-claim').length===1&&!s.inventory.owned.includes(9),'E-claim-before-authority');
 s=await run({action:'message',message:{type:'pickup-grant',grant:{id:'manual-pickup',dropId:ownDrop.id,playerId:'probe-player',life:1,weapon:9,magazine:3,reserve:7,replaceSlot:1,replacedWeapon:255}}});
 const ammunition=s.inventory.ammo.find(r=>r.weapon===9);
 check(s.inventory.selectedWeapon===9&&ammunition.magazine===3&&ammunition.reserve===7&&s.physical.length===0,'E-native-exact-ammo-and-drop-removal',ammunition);
 await run({action:'key',scan:0x12,held:false});
 await run({action:'inventory',inventory:[50,9,255,255,255,255,255],selectedWeapon:9});
 await run({action:'key',scan:0x22,held:true});
 s=await wait('last gun claim',async()=>{const x=await status();return claims(x,'drop-claim').length===2&&x;});
 const last=claims(s,'drop-claim')[1];
 s=await run({action:'message',message:{type:'drop-grant',grant:{id:last.requestId,playerId:'probe-player',life:1,weapon:9,removeSlot:1,selectedWeapon:0,inventory:[50,0,255,255,255,255,255],drop:{...ownDrop,id:'last-gun',pos:s.pos,sector:s.sector,magazine:last.magazine,reserve:last.reserve}}}});
 check(s.inventory.selectedWeapon===0&&s.inventory.owned.includes(0)&&!s.inventory.owned.includes(9),'last-gun-grant-equips-native-knife');
 log({event:'native-manual-pickup-pass'});
}catch(error){failed=error;log({event:'native-manual-pickup-fail',error:String(error)});process.exitCode=1;}
finally{
 stopping=true;if(device&&pid)try{await device.kill(pid);}catch{}
 if(timer)clearTimeout(timer);clearInterval(hold);
 // TerminateProcess may return just before Windows releases the executable.
 for(let attempt=0;attempt<20;attempt++){
  try{if(original)fs.writeFileSync(probe,original);else if(fs.existsSync(probe))fs.unlinkSync(probe);break;}
  catch(error){if(attempt===19)throw error;await delay(100);}
 }
}
console.log(JSON.stringify({passed:!failed,logPath,error:failed?String(failed):undefined}));
