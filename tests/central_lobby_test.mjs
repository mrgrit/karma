import assert from 'node:assert/strict';
import net from 'node:net';
import {createCentralPeer} from '../client/Launcher/central-transport.mjs';
const statuses=[],messages=[],gameMessages=[];let wire;
const room={roomId:'current-room',roomName:'학과 친구들과 카르마',code:'123456',mode:'dm',maxPlayers:8,manualStart:true,hostId:'one'};
const lobby={type:'waiting',...room,players:2,canStart:false,members:[{playerId:'one',name:'Host',ready:false},{playerId:'two',name:'Guest',ready:false}]};
const config={map:0,age:0,character:{index:0,camp:0},settings:{build:'karma290-central3'}};
const send=value=>wire.write(JSON.stringify(value)+'\n');
const server=net.createServer(socket=>{wire=socket;let buffer='';socket.on('data',chunk=>{buffer+=chunk;let end;
  while((end=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);messages.push(message);
    if(message.type==='hello'){send({type:'welcome',profile:{playerId:'one'},room});send(lobby);}
  }
});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let i=0;i<100;i++){if(fn())return;await delay(20);}throw Error('Lobby transport timed out');}
let peer;
try {
  peer=await createCentralPeer({role:'host',host:'127.0.0.1',port:server.address().port,secure:false,
    code:room.code,roomName:room.roomName,config,maxPlayers:8,mode:'dm',manualStart:true,killLimit:30,roundWinLimit:10,timeLimitSeconds:1800,identityPath:null,identity:{authToken:'test-token'},onStatus:x=>statuses.push(x),onMessage:x=>gameMessages.push(x)});
  await wait(()=>statuses.some(s=>s.members?.length===2));assert.equal(messages[0].manualStart,true);
  assert.equal(messages[0].roomName,room.roomName);assert.equal(statuses.at(-1).roomName,room.roomName);
  assert.equal(messages[0].killLimit,30);assert.equal(messages[0].roundWinLimit,10);assert.equal(messages[0].timeLimitSeconds,1800);
  assert.equal(peer.connected,false);assert.equal(statuses.at(-1).isHost,true);assert.equal(statuses.at(-1).canStart,false);
  assert.equal(statuses.at(-1).localPlayerId,'one');
  assert.equal(messages[0].lobbyPing,1,'client explicitly advertises latency protocol');
  const probe='0123456789abcdef01234567';send({type:'latency-probe',token:probe});
  await wait(()=>messages.some(m=>m.type==='latency-reply'&&m.token===probe));
  assert.deepEqual(messages.find(m=>m.type==='latency-reply'),{type:'latency-reply',token:probe},'echo no claimed latency or client clock');
  const replyCount=messages.filter(m=>m.type==='latency-reply').length;
  send({type:'latency-probe',token:'malformed'});await delay(30);assert.equal(messages.filter(m=>m.type==='latency-reply').length,replyCount);
  send({...lobby,latencyOnly:true,members:lobby.members.map(m=>({...m,pingMs:23,pingStatus:'ok'}))});
  await wait(()=>statuses.at(-1).latencyOnly===true);assert.equal(statuses.at(-1).members[0].pingMs,23);assert.equal(peer.connected,false);
  assert(peer.sendChat('all','대기실 채팅','chat1'));await wait(()=>messages.some(m=>m.type==='chat-send'&&m.requestId==='chat1'));
  send({type:'chat',roomId:room.roomId,id:'line1',name:'Host',text:'대기실 채팅',channel:'all',senderId:'one'});
  await wait(()=>statuses.at(-1).phase==='chat');assert.equal(gameMessages.length,0,'chat never enters native online handlers');
  send({type:'chat-denied',requestId:'bad',message:'잠시 후 다시 보내세요.'});await wait(()=>statuses.at(-1).phase==='chat-denied');
  assert(peer.updateLobby({requestId:'unready-one',ready:false}));await wait(()=>messages.some(m=>m.requestId==='unready-one'));
  send({type:'lobby-updated',requestId:'unready-one',roomId:room.roomId,ready:false,config,profile:{playerId:'one'}});
  await wait(()=>statuses.at(-1).phase==='lobby-updated');assert.equal(statuses.at(-1).ready,false);
  const changed={...config,inventory:[0,9,1,6,48,24,18],selectedWeapon:1};
  assert(peer.updateLobby({requestId:'gear-one',config:changed}));await wait(()=>messages.some(m=>m.requestId==='gear-one'));
  send({type:'lobby-updated',requestId:'gear-one',roomId:room.roomId,ready:false,config:changed,profile:{playerId:'one'}});
  await wait(()=>statuses.at(-1).requestId==='gear-one');assert.deepEqual(peer.effectiveConfig,changed);
  send({...lobby,map:7,mapName:'Factory',roomRevision:1,roomSettingsEditable:true,members:[{playerId:'one',slot:1,team:1,ready:false},{playerId:'two',slot:0,team:0,ready:false}]});
  await wait(()=>statuses.at(-1).roomRevision===1);assert.equal(peer.effectiveConfig.map,7);assert.equal(peer.slot,1);assert.equal(peer.team,1);
  assert(peer.updateLobby({requestId:'room-edit',roomId:room.roomId,roomRevision:1,roomSettings:{map:4}}));await wait(()=>messages.some(m=>m.requestId==='room-edit'));assert.equal(messages.at(-1).roomSettings.map,4);
  assert(peer.updateLobby({requestId:'ready-one',ready:true}));await wait(()=>messages.some(m=>m.requestId==='ready-one'));
  send({type:'lobby-update-denied',requestId:'ready-one',message:'장비를 확인해 주세요.',lobby});
  await wait(()=>statuses.at(-1).phase==='lobby-update-denied');assert.equal(peer.connected,false);
  send({...lobby,canStart:true,members:lobby.members.map(m=>({...m,ready:true}))});await wait(()=>statuses.at(-1).canStart===true);
  assert.equal(peer.startMatch(),true);await wait(()=>messages.some(m=>m.type==='start-match'));
  assert.equal(messages.at(-1).roomId,room.roomId);
  send({type:'start-denied',message:'人数不足',lobby:{...lobby,players:1,canStart:false}});
  await wait(()=>statuses.at(-1).phase==='start-denied');assert.equal(statuses.at(-1).canStart,false);assert.equal(peer.connected,false);
  send({...lobby,hostId:'two'});await wait(()=>statuses.at(-1).isHost===false);
  send({...lobby,hostId:'one'});await wait(()=>statuses.at(-1).isHost===true);
  send({type:'peer-ready',config,profile:{playerId:'one'},mode:'dm',maxPlayers:8,peers:[{playerId:'two',config}],remoteHello:{playerId:'two',config}});
  await peer.ready;assert.equal(peer.connected,true);assert.equal(peer.startMatch(),false);
  send({type:'latency-probe',token:'abcdef0123456789abcdef01'});await delay(30);assert.equal(messages.filter(m=>m.type==='latency-reply').length,replyCount,'ignore in-flight lobby probe after game starts');
  assert.equal(peer.updateLobby({requestId:'too-late',ready:false}),false);
  assert(peer.sendChat('all','게임 중 채팅','chat2'));await wait(()=>messages.some(m=>m.requestId==='chat2'));
  console.log('PASS central lobby adapter: room name, unready roster, equipment acknowledgement, explicit readiness, nonfatal denial, host transfer, start and post-start guard.');
} finally {peer?.close();wire?.destroy();await new Promise(resolve=>server.close(resolve));}
