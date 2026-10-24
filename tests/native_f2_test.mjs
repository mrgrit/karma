import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import os from 'node:os';
// Native engine regression: use an extracted test copy, not the installed game.
if(!process.env.KARMA_GAME_ROOT)throw Error('Set KARMA_GAME_ROOT to an extracted test copy');
const root=path.resolve(process.env.KARMA_GAME_ROOT),game=path.join(root,'App_Executables');
const output=process.env.KARMA_TEST_OUTPUT||path.join(os.tmpdir(),'karma-screenshot-'+Date.now()+'.jsonl');
const support=fileURLToPath(new URL('../client/Launcher/',import.meta.url));
const read=name=>JSON.parse(fs.readFileSync(path.join(support,name==='input-lan.js'&&process.argv.includes('--practice')?'input-menu.js':name),'utf8').replace(/^\uFEFF/,''));
const runtime=read('runtime.json'),maps=read('multiplayer-maps.json').maps,catalog=read('catalog.json'),equipment=read('loadouts.json');
const frida=await import(pathToFileURL(path.join(process.env.KARMA_FRIDA_ROOT||root,'Runtime/node_modules/frida/build/src/frida.js')));
const device=await frida.getLocalDevice(),results=[];
const character=catalog.characters.find(c=>c.age===0&&c.characterIndex===0&&c.camp===0);
const c={id:character.id,index:0,camp:0,model:path.basename(character.model).toLowerCase(),name:'Native map test'};
const selected=[7];const targets=maps.filter(m=>!selected.length||selected.includes(m.mapIndex));
for(const map of targets){
 let pid,session,script,probeExe,previousProbe,crash=null;const errors=[], rendered=[];let menus=0;
 const screenshots=path.join(game,"Data/ScreenShot");const before=new Set(fs.existsSync(screenshots)?fs.readdirSync(screenshots):[]);
 try{
  const template=fs.readFileSync(path.join(support,'session-template.bin'));
  for(const [key,value] of Object.entries({local:1,mode:1,matchType:1,age:0,map:map.mapIndex,character:0,camp:0}))template.writeInt32LE(value,runtime.offsets[key]);
  const exe=path.join(game,'KarmaAIProbe.exe');probeExe=exe;previousProbe=fs.existsSync(exe)?fs.readFileSync(exe):null;if(previousProbe){const normalized=Buffer.from(previousProbe);for(const offset of Object.values(runtime.offsets))template.copy(normalized,offset,offset,offset+4);if(!normalized.equals(template))throw Error('Existing probe differs outside configuration');}fs.writeFileSync(exe,template);
  const local={map:map.mapIndex,age:0,character:c,inventory:equipment.defaultInventory,selectedWeapon:9,settings:{build:'karma290-central6',mode:1}};
  const cfg={central:true,role:'host',slot:0,team:0,localPlayerId:'probe-local',remotePlayerId:'probe-remote',localCharacter:c,remoteCharacter:c,local,remote:local,
    remoteHello:{playerId:'probe-remote',config:local},peers:[{playerId:'probe-remote',team:1,slot:1,config:local}],match:{roomId:'probe-'+map.mapIndex,mode:'dm',maxPlayers:map.maxPlayers||8},
    equipmentCatalog:{weapons:equipment.weapons.filter(w=>w.age===0).map(w=>({id:w.id,name:w.name,cost:w.inventoryCost})),inventoryCapacity:3000}};
  pid=await device.spawn([exe],{cwd:game});session=await device.attach(pid);session.detached.connect((reason,detail)=>{crash=detail?String(detail):reason;});
  let source=fs.readFileSync(new URL('./ai_unattended_shim.js',import.meta.url),'utf8')+'\n'+'globalThis.KARMA_INPUT_SETTINGS={remoteMode:true,sensitivity:0.25};globalThis.KARMA_LAN_CONFIG='+JSON.stringify(cfg)+';\n';
  for(const name of ['startup-diagnostics.js','legacy-controls.js','input-lan.js','native-font.js','offline-death.js','window-size.js','screenshot-window.js','lan-game.js'])source+='\n(()=>{'+fs.readFileSync(path.join(support,name==='input-lan.js'&&process.argv.includes('--practice')?'input-menu.js':name),'utf8').replace("const foreground = api('GetForegroundWindow', 'pointer', []);", "const foreground = () => ptr('0x548d50').readPointer();")+'})();\n';
  source+=`const postScreenshot=new NativeFunction(Process.getModuleByName("user32.dll").getExportByName("PostMessageW"),"int",["pointer","uint","pointer","pointer"],"stdcall");globalThis.F2_TEST=false;Interceptor.attach(ptr('0x4a8330'),{onEnter(args){this.f2=this.returnAddress.equals(ptr('0x419724'));},onLeave(r){if(this.f2&&globalThis.F2_TEST){globalThis.F2_TEST=false;r.replace(1);send({event:'f2-native-key-tested'});}}});rpc.exports.probeCapture=()=>{globalThis.F2_TEST=true;return true;};`;
  source+=`Process.setExceptionHandler(d=>{send({event:'probe-exception',type:d.type,address:String(d.address),memory:d.memory,stack:Thread.backtrace(d.context,Backtracer.ACCURATE).map(String)});return false;});`;script=await session.createScript(source);script.message.connect(m=>{fs.appendFileSync(output,JSON.stringify(m)+'\n');if(m.payload?.event==='legacy-f2-menu')menus++;if(m.payload?.event==='probe-exception')errors.push(JSON.stringify(m.payload));if(m.type==='error')errors.push(m.description);if(m.payload?.event==='screenshot-failed')errors.push(m.payload.message);if(m.payload?.event==='screenshot-rendered')rendered.push(m.payload);});await script.load();await device.resume(pid);
  let state;
  for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,300));if(crash||errors.length)break;state=await script.exports.lanstatus();if(state.ready)break;}
  if(crash||errors.length||!state?.ready)throw Error(errors.join('; ')||crash||'startup timed out');
  console.log('READY',JSON.stringify(state.local));
  await new Promise(r=>setTimeout(r,1500));
  await script.exports.probeCapture();await new Promise(r=>setTimeout(r,4000));
  if(crash||errors.length)throw Error(crash||errors.join('; '));
  await script.exports.menucommand('resume');await new Promise(r=>setTimeout(r,700));
  await script.exports.probeCapture();await new Promise(r=>setTimeout(r,4000));
  if(crash||errors.length)throw Error(crash||errors.join('; '));
  await script.exports.menucommand('resume');await new Promise(r=>setTimeout(r,700));
  if(menus!==2)throw Error('F2 must open safe menu twice; got '+menus);console.log('PASS F2: two native key edges, safe menu, live engine');results.push({ok:true,menus});
 }catch(e){results.push({mapIndex:map.mapIndex,name:map.name,ok:false,error:e.message});console.log('FAIL native map',map.mapIndex,map.name,e.message);}
 finally{if(pid)try{await device.kill(pid);}catch{}if(session)try{await session.detach();}catch{}await new Promise(r=>setTimeout(r,300));if(probeExe){if(previousProbe)fs.writeFileSync(probeExe,previousProbe);else fs.unlinkSync(probeExe);}}
 fs.writeFileSync(output+'.results.json',JSON.stringify(results,null,2));
}
process.exitCode=results.some(r=>!r.ok)?1:0;
