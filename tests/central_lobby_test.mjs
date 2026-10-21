import assert from 'node:assert/strict';
import net from 'node:net';
import {createCentralPeer} from '../client/Launcher/central-transport.mjs';
const statuses=[],messages=[];let wire;
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
    code:room.code,roomName:room.roomName,config,maxPlayers:8,mode:'dm',manualStart:true,identityPath:null,identity:{authToken:'test-token'},onStatus:x=>statuses.push(x)});
  await wait(()=>statuses.some(s=>s.members?.length===2));assert.equal(messages[0].manualStart,true);
  assert.equal(messages[0].roomName,room.roomName);assert.equal(statuses.at(-1).roomName,room.roomName);
  assert.equal(peer.connected,false);assert.equal(statuses.at(-1).isHost,true);assert.equal(statuses.at(-1).canStart,false);
  assert.equal(statuses.at(-1).localPlayerId,'one');
  assert(peer.updateLobby({requestId:'unready-one',ready:false}));await wait(()=>messages.some(m=>m.requestId==='unready-one'));
  send({type:'lobby-updated',requestId:'unready-one',roomId:room.roomId,ready:false,config,profile:{playerId:'one'}});
  await wait(()=>statuses.at(-1).phase==='lobby-updated');assert.equal(statuses.at(-1).ready,false);
  const changed={...config,inventory:[0,9,1,6,48,24,18],selectedWeapon:1};
  assert(peer.updateLobby({requestId:'gear-one',config:changed}));await wait(()=>messages.some(m=>m.requestId==='gear-one'));
  send({type:'lobby-updated',requestId:'gear-one',roomId:room.roomId,ready:false,config:changed,profile:{playerId:'one'}});
  await wait(()=>statuses.at(-1).requestId==='gear-one');assert.deepEqual(peer.effectiveConfig,changed);
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
  assert.equal(peer.updateLobby({requestId:'too-late',ready:false}),false);
  console.log('PASS central lobby adapter: room name, unready roster, equipment acknowledgement, explicit readiness, nonfatal denial, host transfer, start and post-start guard.');
} finally {peer?.close();wire?.destroy();await new Promise(resolve=>server.close(resolve));}
