import fs from 'node:fs';
import path from 'node:path';
import {spawn as spawnHelper} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const support=path.dirname(fileURLToPath(import.meta.url));
const game=path.resolve(support,'../App_Executables');
const config=JSON.parse(fs.readFileSync(path.join(support,'runtime.json'),'utf8').replace(/^\uFEFF/,''));
const exe=path.resolve(process.argv[2]||path.join(game,'KarmaSession.exe'));
if(path.dirname(exe).toLowerCase()!==game.toLowerCase())throw new Error('Invalid game directory');
const ai=process.argv.includes('--ai');
const logPath=path.join(support,'last-session.log');
fs.writeFileSync(logPath,'');
const log=(kind,details={})=>fs.appendFileSync(logPath,JSON.stringify({time:new Date().toISOString(),kind,...details})+'\n');
let device,pid,session,pauseHelper,pausePoll,pauseCommand,startupTimer,validationTimer;
const cleanPause=()=>{
  if(pausePoll){clearInterval(pausePoll);pausePoll=null;}
  if(pauseHelper){try{pauseHelper.kill();}catch{}pauseHelper=null;}
  if(pauseCommand){try{fs.unlinkSync(pauseCommand);}catch{}pauseCommand=null;}
};
// Keep the compatibility script attached for the entire game session.
// A pending Promise alone does not keep Node's event loop alive.
const lifetime=setInterval(()=>{},1000);
try {
  const bundledFrida=path.resolve(support,'../Runtime/node_modules/frida/build/src/frida.js');
  const frida=await import(pathToFileURL(fs.existsSync(bundledFrida)?bundledFrida:path.resolve(support,'..',config.fridaModule)).href);
  device=await frida.getLocalDevice();
  pid=await device.spawn([exe],{cwd:game});
  startupTimer=setTimeout(()=>{
    log('launch-error',{message:'게임 초기화가 30초 안에 완료되지 않아 종료했습니다. 다시 시작해 주세요.'});
    device.kill(pid).catch(()=>{});
  },30000);
  if(config.validationSeconds>0&&config.validationSeconds<=120){
    validationTimer=setTimeout(()=>{
      log('validation-time-limit',{seconds:config.validationSeconds});
      device.kill(pid).catch(()=>{});
    },config.validationSeconds*1000);
  }
  session=await device.attach(pid);
  let profile={};
  try{
    const saved=JSON.parse(fs.readFileSync(path.join(support,'playstyle.json'),'utf8').replace(/^\uFEFF/,''));
    profile=Object.fromEntries(Object.entries(saved).filter(([key,value])=>key.length<40&&typeof value==='number'&&Number.isFinite(value)));
  }catch{}
  const moduleSource=file=>'\n(()=>{\n'+fs.readFileSync(path.join(support,file),'utf8')+'\n})();\n';
  let source='globalThis.KARMA_PLAYSTYLE='+JSON.stringify(profile)+';\n'+moduleSource('startup-diagnostics.js')+moduleSource('input-menu.js');
  source+=moduleSource('offline-death.js');
  source+=moduleSource('practice-end.js');
  source+=moduleSource('window-size.js');
  if(ai){
    if(!config.aiReady)throw new Error('AI mode is not available');
    source+=moduleSource('ai.js');
  }
  // An uncaught initialization error in a Frida script is reported as a
  // message, not necessarily a rejected load(). Reach this marker before
  // allowing the suspended game to run without its input compatibility code.
  source+='\nrpc.exports.compatibilitystatus = () => ({ inputReady: true });';
  const script=await session.createScript(source);
  const menuCommand=async action=>{
    try{await script.exports.menucommand(action);}
    catch(error){log('pause-command-error',{message:String(error)});}
  };
  const openPause=message=>{
    if(pauseHelper)return;
    if(!/^0x[0-9a-f]+$/i.test(message.hwnd||''))return;
    pauseCommand=path.join(support,'pause-'+pid+'-'+Date.now()+'.json');
    const commandFile=pauseCommand;
    const helper=spawnHelper(path.join(support,'../KarmaLauncher.exe'),
      ['--pause',commandFile,message.hwnd,String(pid)],{cwd:path.resolve(support,'..'),windowsHide:false,stdio:'ignore'});
    pauseHelper=helper;
    let exited=false,exitTime=0;
    helper.on('exit',()=>{exited=true;exitTime=Date.now();});
    helper.on('error',error=>{log('pause-helper-error',{message:String(error)});exited=true;exitTime=Date.now()-1000;});
    pausePoll=setInterval(async()=>{
      let action;
      try{action=JSON.parse(fs.readFileSync(commandFile,'utf8').replace(/^\uFEFF/,'')).action;}catch{}
      if(action!=='resume'&&action!=='quit'){
        if(!exited||Date.now()-exitTime<400)return;
        action='resume';
      }
      clearInterval(pausePoll);pausePoll=null;pauseHelper=null;
      try{fs.unlinkSync(commandFile);}catch{}
      if(pauseCommand===commandFile)pauseCommand=null;
      await menuCommand(action);
    },100);
  };
  script.message.connect(message=>{
    if(message.type==='send'){
      log('agent',message.payload);
      if(message.payload.event==='game-frame-ready'){clearTimeout(startupTimer);startupTimer=null;}
      if(message.payload.kind==='pause-requested')openPause(message.payload);
      if(message.payload.event==='playstyle-profile'&&message.payload.profile){
        const numeric=Object.fromEntries(Object.entries(message.payload.profile).filter(([key,value])=>key.length<40&&typeof value==='number'&&Number.isFinite(value)));
        fs.writeFileSync(path.join(support,'playstyle.json'),JSON.stringify(numeric,null,2));
      }
    }
    else if(message.type==='error'){
      log('script-error',{message:message.description,stack:message.stack});
      // An incomplete compatibility layer must never leave the game holding input.
      if(device&&pid)device.kill(pid).catch(error=>log('kill-error',{message:String(error)}));
    }
  });
  const ended=new Promise(resolve=>session.detached.connect((reason,crash)=>{
    clearTimeout(startupTimer);clearTimeout(validationTimer);
    cleanPause();log('game-ended',{reason,crash:crash?String(crash):null});resolve();
  }));
  await script.load();
  const compatibility=await script.exports.compatibilitystatus();
  if(compatibility.inputReady!==true)throw new Error('Input compatibility initialization failed');
  await device.resume(pid);log('game-started',{pid,exe,ai});
  await ended;
  clearInterval(lifetime);
  process.exit(0);
} catch(error) {
  clearTimeout(startupTimer);clearTimeout(validationTimer);
  cleanPause();
  log('launch-error',{message:String(error)});
  if(device&&pid)try{await device.kill(pid);}catch{}
  clearInterval(lifetime);
  process.exitCode=1;
}
