import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import os from 'node:os';
// Native engine regression: use an extracted test copy, not the installed game.
if(!process.env.KARMA_GAME_ROOT)throw Error('Set KARMA_GAME_ROOT to an extracted test copy');
const root=path.resolve(process.env.KARMA_GAME_ROOT),game=path.join(root,'App_Executables');
const output=process.env.KARMA_TEST_OUTPUT||path.join(os.tmpdir(),'karma-quick-grenade-'+Date.now()+'.jsonl');
const support=fileURLToPath(new URL('../client/Launcher/',import.meta.url));
const read=name=>JSON.parse(fs.readFileSync(path.join(support,name),'utf8').replace(/^\uFEFF/,''));
const runtime=read('runtime.json'),maps=read('multiplayer-maps.json').maps,catalog=read('catalog.json'),equipment=read('loadouts.json');
const frida=await import(pathToFileURL(path.join(process.env.KARMA_FRIDA_ROOT||root,'Runtime/node_modules/frida/build/src/frida.js')));
const device=await frida.getLocalDevice(),results=[];
const character=catalog.characters.find(c=>c.age===0&&c.characterIndex===0&&c.camp===0);
const c={id:character.id,index:0,camp:0,model:path.basename(character.model).toLowerCase(),name:'Native map test'};
const selected=[7];const targets=maps.filter(m=>!selected.length||selected.includes(m.mapIndex));
for(const map of targets){
 let pid,session,script,probeExe,previousProbe,crash=null;const errors=[];
 try{
  const template=fs.readFileSync(path.join(support,'session-template.bin'));
  for(const [key,value] of Object.entries({local:1,mode:1,matchType:1,age:0,map:map.mapIndex,character:0,camp:0}))template.writeInt32LE(value,runtime.offsets[key]);
  const exe=path.join(game,'KarmaAIProbe.exe');probeExe=exe;previousProbe=fs.existsSync(exe)?fs.readFileSync(exe):null;if(previousProbe){const normalized=Buffer.from(previousProbe);for(const offset of Object.values(runtime.offsets))template.copy(normalized,offset,offset,offset+4);if(!normalized.equals(template))throw Error('Existing probe differs outside configuration');}fs.writeFileSync(exe,template);
  const local={map:map.mapIndex,age:0,character:c,inventory:process.argv.includes('--no-grenade')?equipment.defaultInventory.map(w=>w===18?255:w):equipment.defaultInventory,selectedWeapon:9,settings:{build:'karma290-central6',mode:1}};
  const cfg={central:true,role:'host',slot:0,team:0,localPlayerId:'probe-local',remotePlayerId:'probe-remote',localCharacter:c,remoteCharacter:c,local,remote:local,
    remoteHello:{playerId:'probe-remote',config:local},peers:[{playerId:'probe-remote',team:1,slot:1,config:local}],match:{roomId:'probe-'+map.mapIndex,mode:'dm',maxPlayers:map.maxPlayers||8},
    equipmentCatalog:{weapons:equipment.weapons.filter(w=>w.age===0).map(w=>({id:w.id,name:w.name,cost:w.inventoryCost})),inventoryCapacity:3000}};
  pid=await device.spawn([exe],{cwd:game});session=await device.attach(pid);session.detached.connect((reason,detail)=>{crash=detail?String(detail):reason;});
  let source='globalThis.KARMA_INPUT_SETTINGS={remoteMode:true,sensitivity:0.25};globalThis.KARMA_LAN_CONFIG='+JSON.stringify(cfg)+';\n';
  for(const name of ['startup-diagnostics.js','legacy-controls.js','input-lan.js','native-font.js','offline-death.js','window-size.js','screenshot-window.js','lan-game.js'])source+='\n(()=>{'+fs.readFileSync(path.join(support,name),'utf8').replace('const result=nativeMousePoll(input);', 'const result=nativeMousePoll(input);if(globalThis.PROBE_MIDDLE>0){input.add(0x4ee).writeU8(0x80);globalThis.PROBE_MIDDLE--;globalThis.PROBE_COUNT++;}').replace('placeLocal(pos,sector,yaw=0){', 'probeGrenadeAmmo(){return st.p.add(0x2a4+18*56).readS32()+st.p.add(0x29c+18*56).readS32()-253;},probeSectors(names){if(processName!==\'karmaaiprobe.exe\')throw Error(\'test only\');const world=st.m.add(0xc).readPointer();return names.map(n=>nativeSectorByName(world,Memory.allocUtf8String(n)));},placeLocal(pos,sector,yaw=0){')+'})();\n';
  source+=`globalThis.PROBE_MIDDLE=0;globalThis.PROBE_COUNT=0;rpc.exports.probeMiddle=()=>{globalThis.PROBE_MIDDLE=30;return true;};rpc.exports.probeCount=()=>globalThis.PROBE_COUNT;Process.setExceptionHandler(d=>{send({event:'probe-exception',type:d.type,address:String(d.address),memory:d.memory,context:Object.fromEntries(Object.entries(d.context).map(([k,v])=>[k,String(v)])),stack:Thread.backtrace(d.context,Backtracer.ACCURATE).map(String)});return false;});`;script=await session.createScript(source);script.message.connect(m=>{fs.appendFileSync(output,JSON.stringify(m)+'\n');if(m.type==='error')errors.push(m.description);});await script.load();await device.resume(pid);
  let state;
  for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,300));if(crash||errors.length)break;state=await script.exports.lanstatus();if(state.ready)break;}
  if(crash||errors.length||!state?.ready)throw Error(errors.join('; ')||crash||'startup timed out');
  console.log('READY',JSON.stringify(state.local));
  const noGrenade=process.argv.includes('--no-grenade');
  const initialAmmo=await script.exports.probeGrenadeAmmo(),shots=[];
  for(let attempt=0;attempt<4;attempt++){
   await script.exports.probeMiddle();await new Promise(r=>setTimeout(r,3000));
   if(crash)throw Error(crash);
   state=await script.exports.lanstatus();
   const ammo=await script.exports.probeGrenadeAmmo();
   if(state.local.weapon!==9)throw Error('Did not return to rifle');
   if(state.local.shotSequence!==(noGrenade?0:Math.min(attempt+1,initialAmmo)))throw Error('Unexpected grenade count '+JSON.stringify(state.local));
   if(!noGrenade&&ammo!==Math.max(0,initialAmmo-attempt-1))throw Error('Grenade ammo mismatch '+ammo);
   shots.push({attempt:attempt+1,ammo,shotSequence:state.local.shotSequence});
  }
  const count=await script.exports.probeCount();if(count!==120)throw Error('Middle input not fully exercised');
  console.log('PASS middle button',noGrenade?'no grenade':'with grenade',JSON.stringify(shots));
  results.push({mapIndex:map.mapIndex,ok:true,noGrenade,count,initialAmmo,shots});
 }catch(e){results.push({mapIndex:map.mapIndex,name:map.name,ok:false,error:e.message});console.log('FAIL native map',map.mapIndex,map.name,e.message);}
 finally{if(pid)try{await device.kill(pid);}catch{}if(session)try{await session.detach();}catch{}await new Promise(r=>setTimeout(r,300));if(probeExe){if(previousProbe)fs.writeFileSync(probeExe,previousProbe);else fs.unlinkSync(probeExe);}}
 fs.writeFileSync(output+'.results.json',JSON.stringify(results,null,2));
}
process.exitCode=results.some(r=>!r.ok)?1:0;
