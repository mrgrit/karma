import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
export function startCoinHud({root,pid,host,port,log=()=>{}}){
  const support=path.join(root,'Launcher');
  if(!host)try{const saved=JSON.parse(fs.readFileSync(path.join(support,'server-selection.json'),'utf8').replace(/^\uFEFF/,''));host=saved.host;port=saved.port;}catch{}
  host=host||'192.168.12.100';port=port||29020;
  const hud=spawn(path.join(root,'KarmaLauncher.exe'),['--coin-hud',String(pid),String(process.pid)],{cwd:root,stdio:'ignore',windowsHide:true});
  hud.on('error',e=>log('coin-hud-error',{message:e.message}));
  let refresh=null,closed=false;
  const update=()=>{if(closed||refresh)return;refresh=spawn(process.execPath,[path.join(support,'central-profile.mjs'),host,String(port)],{cwd:root,stdio:'ignore',windowsHide:true});
    refresh.on('error',()=>{refresh=null;});refresh.on('exit',()=>{refresh=null;});};
  const timer=setInterval(update,20000);timer.unref();update();
  return ()=>{closed=true;clearInterval(timer);try{hud.kill();}catch{}try{refresh?.kill();}catch{}};
}
