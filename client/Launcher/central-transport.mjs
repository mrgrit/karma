import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateLanMessage} from './lan-transport.mjs';

const LIMIT=64*1024, QUEUE_LIMIT=256*1024;
const CONTROL=new Set(['damage-proof','pickup-claim']);
const INBOUND=new Set(['drop','drop-removed','pickup-grant','pickup-denied','death-confirmed']);
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
  role,host='192.168.12.100',port=29020,code,config,
  secure=true,caFile=defaultCa,
  identityPath=identityPathFor(host,port),identity=readIdentity(identityPath),
  onMessage=()=>{},onStatus=()=>{},onProfile=()=>{},onIdentity=()=>{},
}={}){
  if(!['host','join'].includes(role))throw TypeError('Invalid LAN role');
  if(typeof host!=='string'||!/^[a-zA-Z0-9.:-]{1,253}$/.test(host))throw TypeError('Invalid server address');
  if(!Number.isInteger(port)||port<1||port>65535)throw TypeError('Invalid server port');
  if(!/^\d{6}$/.test(code))throw TypeError('A six-digit room code is required');
  let resolveReady,rejectReady,closed=false,settled=false,connected=false;
  let effectiveConfig=config,ownId=identity.playerId,remoteId,roomCode=code;
  let buffer=Buffer.alloc(0),pendingState,lastShotKey,flushTimer,welcomed=false;
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
    if(!pendingState)return;
    const message=pendingState;pendingState=null;
    write({type:'game',message});
  }
  function profile(value){
    if(!value||typeof value.playerId!=='string')throw Error('Invalid server profile');
    onProfile(value);
  }
  function receive(message){
    if(message.type==='error')throw Error(message.code+': '+message.message);
    if(message.type==='welcome'){
      if(welcomed)throw Error('Invalid welcome');
      welcomed=true;clearTimeout(handshake);
      ownId=message.profile?.playerId;
      const credential={...identity,playerId:ownId};
      writeIdentity(identityPath,credential);onIdentity(credential);profile(message.profile);
      roomCode=message.room?.code||code;
      report({phase:'listening',code:roomCode,server:host,roomId:message.room?.roomId});
      return;
    }
    if(message.type==='waiting'){report({phase:'listening',code:message.code,server:host});return;}
    if(message.type==='profile'){profile(message.profile);return;}
    if(message.type==='peer-ready'){
      if(!welcomed||settled||message.peers?.length!==1||!message.remoteHello)throw Error('이 클라이언트는 2인 방을 지원합니다.');
      effectiveConfig=message.config;remoteId=message.remoteHello.playerId;
      profile(message.profile);connected=true;settled=true;
      flushTimer=setInterval(flush,50);
      report({phase:'connected',code:roomCode});
      resolveReady(message.remoteHello);return;
    }
    if(message.type==='game'){
      if(!connected||message.senderId!==remoteId)return;
      onMessage(validateLanMessage(message.message));return;
    }
    if(message.type==='death-confirmed'||message.type==='proof-rejected'){
      report({phase:message.type,...message});return;
    }
    if(INBOUND.has(message.type)){onMessage({...message,version:1});return;}
    if(message.type==='peer-left'||message.type==='room-closed'||message.type==='room-ended'||message.type==='match-ended'){
      if(message.type==='match-ended')report({phase:'match-ended',result:message.result});
      onMessage({version:1,type:'leave',reason:message.reason||'peer-left'});return;
    }
    if(message.type==='pong')return;
    throw Error('Unsupported central server message: '+message.type);
  }
  const handshake=setTimeout(()=>fail(Error('LAN 서버가 응답하지 않습니다. 서버 주소를 확인해 주세요.')),10000);
  socket.once(secure?'secureConnect':'connect',()=>{
    report({phase:'connecting',server:host});
    write({type:'hello',version:2,op:role==='host'?'create':'join',code,
      authToken:identity.authToken,config,clientMaxPlayers:2,maxPlayers:2});
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
    get connected(){return connected;},get effectiveConfig(){return effectiveConfig;},
    get playerId(){return ownId;},get remotePlayerId(){return remoteId;},get code(){return roomCode;},
    send(message){
      if(!connected||closed)return false;
      if(CONTROL.has(message.type)){
        flush();
        if(message.type==='damage-proof'){
          const proof={...(message.proof||message)};
          if(proof.attackerId==='remote')proof.attackerId=remoteId;
          if(proof.attackerId==='self')proof.attackerId=ownId;
          return write({type:'damage-proof',proof});
        }
        return write(message);
      }
      const validated=validateLanMessage(message);
      const shotKey=validated.shot?validated.shot.life+':'+validated.shot.id:null;
      if(validated.type==='state'&&(!shotKey||shotKey===lastShotKey)){
        pendingState=validated;return true;
      }
      if(shotKey)lastShotKey=shotKey;
      flush();return write({type:'game',message:validated});
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
