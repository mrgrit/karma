import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateLanMessage} from './lan-transport.mjs';

const LIMIT=64*1024, QUEUE_LIMIT=256*1024;
const CONTROL=new Set(['damage-proof','pickup-claim','drop-claim']);
const INBOUND=new Set(['drop','drop-removed','pickup-grant','pickup-denied','drop-grant','drop-denied','death-confirmed']);
export const defaultCa=path.join(path.dirname(fileURLToPath(import.meta.url)),'server-ca.pem');
export function connectServer({host,port,secure=true,caFile=defaultCa}){
  return secure?tls.connect({host,port,ca:fs.readFileSync(caFile),rejectUnauthorized:true,
    ...(net.isIP(host)?{}:{servername:host})}):net.createConnection({host,port});
}
export function identityPathFor(host,port=29020){
  const key=crypto.createHash('sha256').update(host.toLowerCase()+':'+port).digest('hex').slice(0,24);
  return path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'KarmaLAN','servers',key+'.json');
}
export function readIdentity(filename){
  if(!filename||!fs.existsSync(filename))return {};
  const value=JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));
  if(typeof value.authToken!=='string')return {};
  return value;
}
export function writeIdentity(filename,value){
  if(!filename)return;
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const temp=filename+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});
  fs.renameSync(temp,filename);
}
export async function createCentralPeer({
  role,host='192.168.12.100',port=29020,code,config,maxPlayers=2,mode='duel',
  secure=true,caFile=defaultCa,manualStart=false,roomId,roomName,killLimit,roundWinLimit,timeLimitSeconds,
  identityPath=identityPathFor(host,port),identity=readIdentity(identityPath),
  onMessage=()=>{},onStatus=()=>{},onProfile=()=>{},onIdentity=()=>{},
}={}){
  if(!['host','join'].includes(role))throw TypeError('Invalid LAN role');
  if(typeof host!=='string'||!/^[a-zA-Z0-9.:-]{1,253}$/.test(host))throw TypeError('Invalid server address');
  if(!Number.isInteger(port)||port<1||port>65535)throw TypeError('Invalid server port');
  if(!/^\d{6}$/.test(code))throw TypeError('A six-digit room code is required');
  let resolveReady,rejectReady,closed=false,settled=false,connected=false;
  let effectiveConfig=config,ownId=identity.playerId,remoteId,roomCode=code,peers=[],slot=0,team=0,match={};
  let buffer=Buffer.alloc(0),pendingState,lastShotKey,flushTimer,welcomed=false,pendingEquipment,lastInventory=config.inventory;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  // The caller attaches after this asynchronous factory returns.
  ready.catch(()=>{});
  if(!identity.authToken)throw Error('AUTH_REQUIRED: 로그인한 뒤 접속해 주세요.');
  const socket=connectServer({host,port,secure,caFile});
  socket.setNoDelay(true);socket.setKeepAlive(true,10000);
  const report=detail=>onStatus(detail);
  function fail(error){
    if(closed)return;
    closed=true;connected=false;clearTimeout(handshake);clearInterval(flushTimer);
    if(!settled){settled=true;rejectReady(error);}
    report({phase:'disconnected',message:error.message});
    socket.destroy();
  }
  function write(value){
    if(closed||socket.destroyed)return false;
    const line=JSON.stringify(value)+'\n';
    if(Buffer.byteLength(line)>LIMIT)throw Error('LAN message is too large');
    if(socket.writableLength+Buffer.byteLength(line)>QUEUE_LIMIT){fail(Error('LAN 서버 통신 대기열이 가득 찼습니다.'));return false;}
    socket.write(line);return true;
  }
  function flush(){
    if(!pendingState||pendingEquipment)return;
    const message=pendingState;pendingState=null;
    write({type:'game',message});
  }
  function profile(value){
    if(!value||typeof value.playerId!=='string')throw Error('Invalid server profile');
    onProfile(value);
  }
  function receive(message){
    if(message.type==='error')throw Error(message.code+': '+message.message);
    if(message.type==='latency-probe'){
      if(welcomed&&!connected&&typeof message.token==='string'&&/^[a-f0-9]{24}$/.test(message.token))
        write({type:'latency-reply',token:message.token});
      return;
    }
    if(message.type==='welcome'){
      if(welcomed)throw Error('Invalid welcome');
      welcomed=true;clearTimeout(handshake);
      ownId=message.profile?.playerId;
      const credential={...identity,playerId:ownId};
      writeIdentity(identityPath,credential);onIdentity(credential);profile(message.profile);
      roomCode=message.room?.code||code;
      match=message.room||{};slot=message.slot??0;team=message.team??0;
      report({phase:'listening',code:roomCode,server:host,roomId:message.room?.roomId,...match,players:1});
      return;
    }
    if(message.type==='waiting'){match={...match,...message};if(Number.isInteger(message.map))effectiveConfig={...effectiveConfig,map:message.map};const member=message.members?.find(m=>m.playerId===ownId);if(member){if(Number.isInteger(member.slot))slot=member.slot;if(Number.isInteger(member.team))team=member.team;}report({phase:'listening',...message,localPlayerId:ownId,isHost:message.hostId===ownId,server:host});return;}
    if(message.type==='start-denied'){report({phase:'start-denied',...message,...message.lobby,isHost:message.lobby?.hostId===ownId});return;}
    if(message.type==='lobby-updated'){
      if(message.config)effectiveConfig=message.config;
      if(message.profile)profile(message.profile);
      report({phase:'lobby-updated',...message});return;
    }
    if(message.type==='lobby-update-denied'){report({phase:'lobby-update-denied',...message});return;}
    if(message.type==='profile'){profile(message.profile);return;}
    if(message.type==='chat'||message.type==='chat-denied'){
      if(!welcomed)return;
      if(message.type==='chat'&&(message.roomId!==match.roomId||typeof message.id!=='string'||typeof message.name!=='string'||typeof message.text!=='string'||message.text.length>200||!['all','team'].includes(message.channel)))throw Error('Invalid chat message');
      report({phase:message.type,...message});return;
    }
    if(message.type==='peer-ready'){
      if(!welcomed||settled||!Array.isArray(message.peers)||message.peers.length<1||message.peers.length>7||!message.remoteHello)throw Error('잘못된 참가자 목록입니다.');
      peers=message.peers.length===1&&!message.peers[0].playerId?[message.remoteHello]:message.peers;
      if(new Set(peers.map(p=>p.playerId)).size!==peers.length||peers.some(p=>typeof p.playerId!=='string'||p.playerId===ownId))throw Error('중복 참가자입니다.');
      effectiveConfig=message.config;remoteId=message.remoteHello.playerId;slot=message.slot??slot;team=message.team??team;
      match={...match,mode:message.mode??match.mode??'duel',maxPlayers:message.maxPlayers??peers.length+1,killLimit:message.killLimit,timeLimitSeconds:message.timeLimitSeconds,respawnMs:message.respawnMs,roundWinLimit:message.roundWinLimit,lateJoin:message.lateJoin===true,initialLife:message.initialLife??1};
      profile(message.profile);connected=true;settled=true;
      flushTimer=setInterval(flush,50);
      report({phase:'connected',code:roomCode});
      resolveReady(message.remoteHello);return;
    }
    if(message.type==='game'){
      if(!connected||!peers.some(p=>p.playerId===message.senderId))return;
      onMessage({...validateLanMessage(message.message),senderId:message.senderId});return;
    }
    if(message.type==='round-start'||message.type==='round-ended'){report({phase:message.type,...message});onMessage({...message,version:1});return;}
    if(message.type==='death-confirmed'||message.type==='proof-rejected'){
      report({phase:message.type,...message});
      if(message.type==='death-confirmed'&&['karma290-central3','karma290-central4','karma290-central5','karma290-central6'].includes(config.settings?.build))onMessage({...message,version:1});
      return;
    }
    if(INBOUND.has(message.type)){
      const requestId=message.requestId??message.grant?.requestId??message.grant?.id;
      if(pendingEquipment&&requestId===pendingEquipment.requestId&&
        ['drop-grant','drop-denied','pickup-grant','pickup-denied'].includes(message.type)){
        if(message.type==='drop-grant'&&Array.isArray(message.grant?.inventory))pendingEquipment.approvedInventory=message.grant.inventory;
        else if(message.type==='pickup-grant'&&Array.isArray(lastInventory)&&Number.isInteger(message.grant?.replaceSlot)){
          pendingEquipment.approvedInventory=[...lastInventory];pendingEquipment.approvedInventory[message.grant.replaceSlot]=message.grant.weapon;
        }else pendingEquipment=null;
      }
      if(['drop-grant','pickup-grant'].includes(message.type)&&message.grant?.playerId===ownId){
        // A queued pose predates this inventory transaction. The native adapter
        // publishes the updated inventory while applying the grant below.
        pendingState=null;
      }
      onMessage({...message,version:1});
      if(message.type==='drop-denied'||message.type==='pickup-denied')flush();
      return;
    }
    if(message.type==='peer-joined'){
      const p=message.peer;
      if(!connected||match.mode!=='dm'||!['karma290-central5','karma290-central6'].includes(config.settings?.build)||!p||typeof p.playerId!=='string'||p.playerId===ownId||!Number.isInteger(p.slot)||p.slot<0||p.slot>7||![0,1].includes(p.team)||!p.config)throw Error('Invalid joining participant');
      if(peers.some(peer=>peer.playerId===p.playerId))return;
      if(peers.length>=7||peers.some(peer=>peer.slot===p.slot))throw Error('Duplicate participant slot');
      peers=[...peers,p];remoteId=peers[0]?.playerId;
      onMessage({...message,version:1});report({phase:'peer-joined',players:peers.length+1});return;
    }
    if(message.type==='match-snapshot'){
      if(!connected||!Array.isArray(message.players))throw Error('Invalid match snapshot');
      onMessage({...message,version:1});return;
    }
    if(message.type==='peer-left'){
      peers=peers.filter(p=>p.playerId!==message.playerId);remoteId=peers[0]?.playerId;
      onMessage({version:1,type:'peer-left',playerId:message.playerId});return;
    }
    if(message.type==='room-closed'||message.type==='room-ended'||message.type==='match-ended'){
      if(message.type==='match-ended'){
        // The server intentionally closes the finished match connection.
        // Keep the local game/result screen alive until the player leaves.
        closed=true;connected=false;clearTimeout(handshake);clearInterval(flushTimer);pendingState=null;
        report({phase:'match-ended',result:message.result,returnLobby:message.returnLobby});socket.end();return;
      }
      onMessage({version:1,type:'leave',reason:message.reason||'peer-left'});return;
    }
    if(message.type==='pong')return;
    throw Error('Unsupported central server message: '+message.type);
  }
  const handshake=setTimeout(()=>fail(Error('LAN 서버가 응답하지 않습니다. 서버 주소를 확인해 주세요.')),10000);
  socket.once(secure?'secureConnect':'connect',()=>{
    report({phase:'connecting',server:host});
    write({type:'hello',version:2,op:role==='host'?'create':'join',code,
      authToken:identity.authToken,config,clientMaxPlayers:8,lobbyPing:1,maxPlayers,mode,manualStart,returnLobby:true,...(roomId?{roomId}:{}),...(roomName?{roomName}:{}),
      ...(role==='host'?{killLimit,roundWinLimit,timeLimitSeconds}:{})});
  });
  socket.on('data',chunk=>{
    try{
      buffer=Buffer.concat([buffer,chunk]);
      let end;
      while((end=buffer.indexOf(10))>=0){
        if(end>LIMIT)throw Error('LAN server message exceeds limit');
        const line=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+1);
        if(line.trim())receive(JSON.parse(line));
        if(closed)break;
      }
      if(buffer.length>LIMIT)throw Error('LAN server line exceeds limit');
    }catch(error){fail(error);}
  });
  socket.on('error',error=>fail(error));
  socket.on('close',()=>{if(!closed)fail(Error('LAN 서버와의 연결이 끊겼습니다.'));});
  return {
    ready,port,
    startMatch(){return welcomed&&!connected&&!closed?write({type:'start-match',roomId:match.roomId}):false;},
    updateLobby(update){return welcomed&&!connected&&!closed?write({type:'lobby-update',...update}):false;},
    sendChat(channel,text,requestId=crypto.randomUUID()){
      if(!welcomed||closed)return false;
      if(!['all','team'].includes(channel)||typeof text!=='string'||text.length<1||text.length>200)throw Error('채팅은 1~200자로 입력해 주세요.');
      return write({type:'chat-send',requestId,channel,text});
    },
    get connected(){return connected;},get effectiveConfig(){return effectiveConfig;},
    get peers(){return peers;},get slot(){return slot;},get team(){return team;},get match(){return match;},
    get playerId(){return ownId;},get remotePlayerId(){return remoteId;},get code(){return roomCode;},
    send(message){
      if(!connected||closed)return false;
      if(CONTROL.has(message.type)){
        if(['drop-claim','pickup-claim'].includes(message.type)&&pendingEquipment)return false;
        flush();
        if(message.type==='damage-proof'){
          const proof={...(message.proof||message)};
          if(proof.attackerId==='remote')proof.attackerId=remoteId;
          if(proof.attackerId==='self')proof.attackerId=ownId;
          return write({type:'damage-proof',proof});
        }
        if(message.type==='drop-claim'||message.type==='pickup-claim')pendingEquipment={requestId:message.requestId,life:message.life};
        return write(message);
      }
      const validated=validateLanMessage(message);
      const shotKey=validated.shot?validated.shot.life+':'+validated.shot.id:null;
      if(pendingEquipment&&['respawn','state'].includes(validated.type)&&validated.life>pendingEquipment.life){pendingEquipment=null;pendingState=null;}
      if(validated.type==='state'&&pendingEquipment?.approvedInventory){
        // Native grant handling crosses an asynchronous process boundary. Old
        // frames already in that queue may arrive even after the server ACK.
        if(JSON.stringify(validated.inventory)!==JSON.stringify(pendingEquipment.approvedInventory))return true;
        pendingEquipment=null;
      }
      if(Array.isArray(validated.inventory))lastInventory=[...validated.inventory];
      if(validated.type==='state'&&pendingEquipment){
        // A grant can race the next frame. Hold its pre-grant inventory until
        // the result arrives; success discards it, denial flushes it unchanged.
        if(shotKey===lastShotKey)delete validated.shot;
        pendingState=validated;return true;
      }
      if(validated.type==='state'&&(!shotKey||shotKey===lastShotKey)){
        // Native state retains the last shot until the next shot. Only the
        // first occurrence is an event; later poses must not fire it again.
        if(shotKey)delete validated.shot;
        pendingState=validated;return true;
      }
      if(shotKey)lastShotKey=shotKey;
      flush();return write({type:'game',message:validated,...(validated.targetId?{targetId:validated.targetId}:{})});
    },
    close(){
      if(closed)return;
      if(connected){try{flush();write({type:'game',message:{version:1,type:'leave'}});}catch{}}
      closed=true;connected=false;clearTimeout(handshake);clearInterval(flushTimer);
      if(!settled){settled=true;rejectReady(Error('LAN 연결이 취소되었습니다.'));}
      socket.end();const timer=setTimeout(()=>socket.destroy(),250);timer.unref();
    },
  };
}
