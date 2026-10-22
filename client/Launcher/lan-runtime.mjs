import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn as spawnHelper} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createLanPeer} from './lan-transport.mjs';
import {createCentralPeer} from './central-transport.mjs';
import {startCoinHud} from './coin-hud.mjs';
const support=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(support,'..'),game=path.join(root,'App_Executables');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const settingsPath=path.resolve(process.argv[2]||'');
if(path.dirname(settingsPath).toLowerCase()!==support.toLowerCase()||
   !/^lan-config-[a-z0-9-]+\.json$/i.test(path.basename(settingsPath)))throw Error('Invalid LAN configuration path');
const options=readJson(settingsPath),runtime=readJson(path.join(support,'runtime.json'));
const multiplayerMaps=readJson(path.join(support,'multiplayer-maps.json')).maps;
const statusPath=path.join(support,'lan-status.json'),cancelPath=path.join(support,'lan-cancel.json');
const startPath=path.join(support,'lan-start.json');
const lobbyCommandPath=path.join(support,'lan-lobby-command.json'),lobbyResultPath=path.join(support,'lan-lobby-result.json');
const logPath=path.join(support,'last-session.log');
const lootHintPath=path.join(support,'loot-hint.json');
try{fs.unlinkSync(lootHintPath);}catch{}
fs.writeFileSync(logPath,'');
try{fs.unlinkSync(cancelPath);}catch{}
try{fs.unlinkSync(startPath);}catch{}
for(const file of [lobbyCommandPath,lobbyResultPath])try{fs.unlinkSync(file);}catch{}
const log=(kind,details={})=>fs.appendFileSync(logPath,JSON.stringify({time:new Date().toISOString(),kind,...details})+'\n');
const status=(phase,message,details={})=>fs.writeFileSync(statusPath,JSON.stringify({...details,phase,message,time:new Date().toISOString()}));
let peer,device,pid,session,script,ended=false,closing=false,rpcReady=false,connected=false,
  failureReason='',endReason='',startupTimer,validationTimer,pauseChild,pauseTimer,closeCoinHud,accountProfile={};
const checkClosing=()=>{if(closing)throw Error('LAN 대전이 취소되었습니다.');};
const cleanMenu=()=>{
  clearInterval(pauseTimer);pauseTimer=null;
  if(pauseChild){try{pauseChild.kill();}catch{}pauseChild=null;}
};
const stop=async(reason,error=false)=>{
  if(closing)return;closing=true;
  endReason=reason;
  if(error)failureReason=reason;
  try{fs.unlinkSync(lootHintPath);}catch{}
  status(error?'error':'ended',reason);
  if(error)log('launch-error',{message:reason});else log('lan-ended',{message:reason});
  try{peer?.close();}catch{}
  if(device&&pid){
    setTimeout(()=>{if(!ended)device.kill(pid).catch(()=>{});},1000);
  }else{ended=true;}
  if(rpcReady){try{await script.exports.menucommand('quit');}catch{}}
};
const keepAlive=setInterval(()=>{
  if(ended){clearInterval(keepAlive);return;}
  if(fs.existsSync(cancelPath))stop('LAN 대전을 종료했습니다.');
  if(!closing&&fs.existsSync(startPath)){
    try{const command=readJson(startPath);fs.unlinkSync(startPath);
      if(!connected&&command.roomId===peer?.match?.roomId)peer.startMatch?.();
    }catch(error){log('start-command-error',{message:String(error)});}
  }
  if(!closing&&fs.existsSync(lobbyCommandPath)){
    let command;
    try{
      command=readJson(lobbyCommandPath);fs.unlinkSync(lobbyCommandPath);
      if(!/^[a-f0-9]{32}$/i.test(command.requestId||''))throw Error('잘못된 대기실 요청입니다.');
      const update={requestId:command.requestId};
      if(typeof command.ready==='boolean')update.ready=command.ready;
      if(command.config)update.config={...command.config,character:characterConfig(command.config.character),settings:{build:'karma290-central5',mode:1}};
      if(connected||command.roomId!==peer?.match?.roomId||!peer.updateLobby?.(update))throw Error('이미 대전이 시작됐거나 대기실 연결이 종료되었습니다.');
    }catch(error){
      fs.writeFileSync(lobbyResultPath,JSON.stringify({requestId:command?.requestId,ok:false,message:error.message}));
      log('lobby-command-error',{message:String(error)});
    }
  }
},200);
const openMenu=message=>{
  if(pauseChild||!/^0x[0-9a-f]+$/i.test(message.hwnd||''))return;
  const commandFile=path.join(support,'pause-lan-'+pid+'-'+Date.now()+'.json');
  const child=spawnHelper(path.join(root,'KarmaLauncher.exe'),
    ['--pause',commandFile,message.hwnd,String(pid),'--lan',...(message.confirmExit?['--confirm-exit']:[])],
    {cwd:root,stdio:'ignore',windowsHide:false});
  pauseChild=child;
  let childExited=false;
  child.on('exit',()=>{childExited=true;});
  child.on('error',error=>{log('pause-helper-error',{message:String(error)});childExited=true;});
  pauseTimer=setInterval(async()=>{
    let action;
    try{action=readJson(commandFile).action;}catch{}
    if(!['resume','quit'].includes(action)){if(!childExited)return;action='resume';}
    clearInterval(pauseTimer);pauseTimer=null;pauseChild=null;
    try{fs.unlinkSync(commandFile);}catch{}
    try{await script.exports.menucommand(action);}catch(error){log('pause-command-error',{message:String(error)});}
  },100);
};
const queued=[];
const queuedShotKeys=new Map();
const characterConfig=value=>{
  if(!value||!Number.isInteger(value.index)||!Number.isInteger(value.camp))throw Error('상대 캐릭터 설정이 올바르지 않습니다.');
  const catalog=readJson(path.join(support,'catalog.json'));
  const item=catalog.characters.find(x=>x.age===0&&x.characterIndex===value.index&&x.camp===value.camp);
  if(!item)throw Error('지원하지 않는 캐릭터입니다.');
  return {id:item.id,index:item.characterIndex,camp:item.camp,model:path.basename(item.model).toLowerCase(),
    name:String(value.name||item.enName||'Player').slice(0,24)};
};
try{
  if(!['host','join'].includes(options.role)||!/^\d{6}$/.test(String(options.code)))throw Error('LAN 역할 또는 6자리 방 코드를 확인해 주세요.');
  const localCharacter=characterConfig(options.config?.character);
  const central=options.transport==='central';
  let config={map:central?(options.config?.map??0):0,age:0,character:localCharacter,
    ...(central?{inventory:options.config.inventory,selectedWeapon:options.config.selectedWeapon}:{}),
    settings:{build:central?'karma290-central5':'karma290-lan1',mode:1}};
  if(!multiplayerMaps.some(map=>map.mapIndex===config.map))throw Error('멀티플레이 지원 전장을 선택하세요.');
  status('connecting',options.role==='host'?'방을 준비하고 있습니다.':'방에 접속하고 있습니다.');
  peer=await (central?createCentralPeer:createLanPeer)({
    role:options.role,host:options.host,port:options.port||29020,code:String(options.code),config,
    maxPlayers:options.maxPlayers||2,mode:options.matchMode||'duel',manualStart:central,roomId:options.roomId,roomName:options.roomName,
    onStatus:detail=>{
      log('lan-status',detail);
      const phase=detail.phase||detail.type||detail.status;
      if(phase==='lobby-updated'||phase==='lobby-update-denied'){
        fs.writeFileSync(lobbyResultPath,JSON.stringify({requestId:detail.requestId,ok:phase==='lobby-updated',message:detail.message||'',ready:detail.ready,config:detail.config}));
      }
      if(phase==='listening'||phase==='start-denied')status('waiting',phase==='start-denied'?detail.message:
        '코드 '+(detail.code||options.code)+' · '+(detail.players||1)+' / '+(detail.maxPlayers||options.maxPlayers||2)+'명 · '+
        (detail.manualStart?'장비 설정 후 준비 완료를 누르세요.':'정원이 모이면 자동 시작합니다.'),
        {roomId:detail.roomId,roomName:detail.roomName||options.roomName,localPlayerId:detail.localPlayerId||peer?.playerId,code:detail.code||options.code,players:detail.players||1,maxPlayers:detail.maxPlayers||options.maxPlayers||2,
          mode:detail.mode||options.matchMode,hostId:detail.hostId,isHost:detail.isHost??(options.role==='host'),manualStart:detail.manualStart===true,
          canStart:detail.canStart===true,startReason:detail.startReason||'',members:detail.members||[],gameFee:detail.gameFee||0});
      if(phase==='round-ended')status('playing','라운드 '+detail.round+' 종료 · '+detail.roundWins.join(' : ')+' · 다음 라운드 준비');
      if(phase==='round-start')status('playing','라운드 '+detail.round+' · 한 팀 전멸 시 종료 · F10 메뉴');
      if(phase==='match-ended'){
        const result=detail.result||{},winner=result.winnerIds?.includes(peer?.playerId);
        const label=result.draw?'무승부':winner?'승리':'패배';
        const score=result.scores?.[peer?.playerId]??0,other=result.scores?.[peer?.remotePlayerId]??0;
        const scoreText=result.mode==='tdm'?'라운드 '+(result.roundWins||result.teamScores).join(' : '):'내 킬 '+score;
        stop('대전 종료 · '+label+' · '+scoreText+' · 전적을 저장했습니다.');
      }
      if(phase==='disconnected'&&connected&&!closing)stop('상대와의 연결이 끊겨 대전을 종료했습니다.',true);
    },
    onProfile:profile=>{
      accountProfile=profile;
      fs.writeFileSync(path.join(support,'central-profile.json'),JSON.stringify(profile));
      if(rpcReady&&!closing&&profile.rank)script.exports.accountrank(profile.rank).catch(error=>{
        if(!ended&&!closing)log('rank-update-warning',{message:String(error)});
      });
    },
    onMessage:message=>{
      if(closing)return;
      if(message.type==='leave'){stop('상대가 방을 나갔습니다.');return;}
      if(rpcReady)script.exports.lanreceive(message).catch(error=>stop(String(error),true));
      else {
        if(message.type==='state'&&message.shot){
          const key=message.shot.life+':'+message.shot.id;
          if(key===queuedShotKeys.get(message.senderId)){message={...message};delete message.shot;}else queuedShotKeys.set(message.senderId,key);
        }
        if(message.type==='state'&&!message.shot){
          const older=queued.findIndex(x=>x.type==='state'&&x.senderId===message.senderId&&!x.shot);
          if(older>=0)queued.splice(older,1);
        }
        if(queued.length>=256){stop('게임 로딩 중 통신 대기열이 가득 찼습니다.',true);return;}
        queued.push(message);
      }
    }
  });
  if(closing){peer.close();checkClosing();}
  const remoteHello=await peer.ready;
  checkClosing();connected=true;
  if(central)config={...peer.effectiveConfig,rank:accountProfile.rank};
  if(remoteHello.config.map!==config.map||remoteHello.config.age!==0||!multiplayerMaps.some(map=>map.mapIndex===config.map)||
     remoteHello.config.settings?.build!==config.settings.build)throw Error('서로 같은 LAN 수정본과 전장을 사용해야 합니다.');
  const remoteCharacter=characterConfig(remoteHello.config.character);
  status('loading','상대 연결 완료 · 게임을 불러오고 있습니다.');
  const template=fs.readFileSync(path.join(support,'session-template.bin'));
  if(crypto.createHash('sha256').update(template).digest('hex')!==runtime.sha256)throw Error('게임 템플릿을 확인할 수 없습니다.');
  const values={local:1,mode:1,matchType:1,age:0,map:config.map,character:localCharacter.index,camp:localCharacter.camp};
  for(const [key,value] of Object.entries(values))template.writeInt32LE(value,runtime.offsets[key]);
  const exe=path.join(game,'KarmaSession.exe');fs.writeFileSync(exe,template);
  const bundled=path.join(root,'Runtime/node_modules/frida/build/src/frida.js');
  const frida=await import(pathToFileURL(fs.existsSync(bundled)?bundled:path.resolve(root,runtime.fridaModule)).href);
  checkClosing();device=await frida.getLocalDevice();checkClosing();
  pid=await device.spawn([exe],{cwd:game});checkClosing();
  startupTimer=setTimeout(()=>stop('게임 초기화가 30초 안에 완료되지 않았습니다.',true),30000);
  if(runtime.validationSeconds>0&&runtime.validationSeconds<=120)
    validationTimer=setTimeout(()=>stop('테스트 제한 시간이 끝났습니다.'),runtime.validationSeconds*1000);
  session=await device.attach(pid);checkClosing();
  const equipment=readJson(path.join(support,'loadouts.json'));
  const equipmentCatalog={weapons:equipment.weapons.filter(w=>w.age===0).map(w=>({id:w.id,name:w.name,cost:w.inventoryCost})),inventoryCapacity:(equipment.characters[localCharacter.id]?.inventoryCapacity||0)+(config.rank?.budgetBonus||0)};
  const lanConfig={equipmentCatalog,role:options.role,localCharacter,remoteCharacter,local:config,remote:remoteHello.config,remoteHello,
    central,localPlayerId:peer.playerId,remotePlayerId:peer.remotePlayerId,
    peers:central?peer.peers:undefined,slot:peer.slot,team:peer.team,match:peer.match};
  let source='globalThis.KARMA_LAN_CONFIG='+JSON.stringify(lanConfig)+';\n';
  for(const file of ['startup-diagnostics.js','legacy-controls.js','input-lan.js','native-font.js','offline-death.js','window-size.js','lan-game.js','rank-display.js','player-names.js'])
    source+='\n(()=>{\n'+fs.readFileSync(path.join(support,file),'utf8')+'\n})();\n';
  source+='\nrpc.exports.compatibilitystatus=()=>({ready:true});';
  script=await session.createScript(source);checkClosing();
  script.message.connect(message=>{
    if(message.type==='error'){stop(message.description,true);return;}
    if(message.type!=='send')return;
    const payload=message.payload;
    if(payload.event==='lan-outbound'){try{peer.send(payload.message);}catch(error){stop(String(error),true);}return;}
    if(payload.event==='lan-damage-proof'){
      if(central)try{peer.send({type:'damage-proof',proof:payload.proof});}catch(error){stop(String(error),true);}
      return;
    }
    if(payload.event==='lan-loot-hint'&&typeof payload.message==='string'){
      fs.writeFileSync(lootHintPath,JSON.stringify({gamePid:pid,expiresAt:Date.now()+Math.max(500,Math.min(10000,Number(payload.ttlMs)||3000)),message:payload.message.slice(0,200)}));
    }
    log('agent',payload);
    if(payload.event==='offline-player-death')status('playing',peer.match?.mode==='tdm'?'전사 · 팀전은 다음 라운드에 다시 등장합니다.':peer.match?.mode==='dm'?'전사 · 10초 후 랜덤 위치에서 다시 등장합니다.':'전사 · 잠시 후 다시 등장합니다.');
    if(payload.event==='lan-local-respawn')status('playing','재등장 · Tab 점수판 · F10 메뉴 · Esc 종료 확인');
    if(payload.kind==='exit-requested')stop('LAN 대전을 종료했습니다.');
    if(payload.event==='game-frame-ready'){clearTimeout(startupTimer);if(!closeCoinHud)closeCoinHud=startCoinHud({root,pid,host:options.host,port:options.port,log});status('playing',(peer.match?.mode==='tdm'?'팀 '+(peer.team===0?'RED':'BLUE')+' · 팀전 · 라운드 중 부활 없음':peer.match?.mode==='dm'?'개인 데스매치':'1:1 대전')+' · Tab 점수 · F10 메뉴 · Esc 종료 확인');}
    if(payload.kind==='pause-requested')openMenu(payload);
  });
  const done=new Promise(resolve=>session.detached.connect((reason,crash)=>{
    ended=true;closing=true;clearTimeout(startupTimer);clearTimeout(validationTimer);
    cleanMenu();peer.close();log('game-ended',{reason,crash:crash?String(crash):null});
    status(failureReason||crash?'error':'ended',failureReason||(crash?'게임이 예기치 않게 종료되었습니다.':endReason||'대전이 종료되었습니다.'));
    resolve();
  }));
  await script.load();checkClosing();await script.exports.compatibilitystatus();checkClosing();
  while(queued.length){await script.exports.lanreceive(queued.shift());checkClosing();}
  rpcReady=true;
  checkClosing();await device.resume(pid);log('game-started',{pid,exe,lan:true,role:options.role});
  await done;
}catch(error){
  const wasClosing=closing;
  if(!closing){status('error',String(error.message||error));log('launch-error',{message:String(error.message||error)});}
  closing=true;ended=true;try{peer?.close();}catch{}
  if(device&&pid)try{await device.kill(pid);}catch{}
  if(!wasClosing)process.exitCode=1;
}finally{
  clearTimeout(startupTimer);clearTimeout(validationTimer);clearInterval(keepAlive);cleanMenu();
  closeCoinHud?.();
  try{fs.unlinkSync(lootHintPath);}catch{}
  try{fs.unlinkSync(settingsPath);}catch{}
}
