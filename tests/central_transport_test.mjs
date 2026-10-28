import net from 'node:net';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createCentralPeer} from '../client/Launcher/central-transport.mjs';
const messages=[],inbound=[],statuses=[],profiles=[];
let wire;
const server=net.createServer(socket=>{
  wire=socket;let buffer='';
  socket.on('data',chunk=>{
    buffer+=chunk;
    let end;
    while((end=buffer.indexOf('\n'))>=0){
      const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);messages.push(message);
      if(message.type==='hello'){
        assert.equal(message.authToken,'test-only-token');
        assert.equal(message.playerId,undefined);
        const config=message.config;
        socket.write(JSON.stringify({type:'welcome',profile:{playerId:'one',xp:0},room:{code:'123456'}})+'\n');
        socket.write(JSON.stringify({type:'peer-ready',config,profile:{playerId:'one',xp:0},
          peers:[{}],remoteHello:{playerId:'two',config}})+'\n');
      }
    }
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const config={map:0,age:0,character:{index:0,camp:0,model:'cpom_050.chr',name:'Test'},
  inventory:[50,9,1,6,48,24,18],selectedWeapon:9,settings:{build:'karma290-central2'}};
let peer;
try{
  await assert.rejects(createCentralPeer({role:'host',host:'127.0.0.1',port:server.address().port,
    code:'123456',config,secure:false,identityPath:null}),/AUTH_REQUIRED/);
  peer=await createCentralPeer({role:'host',host:'127.0.0.1',port:server.address().port,
    code:'123456',config,secure:false,identityPath:null,identity:{authToken:'test-only-token'},
    onMessage:x=>inbound.push(x),onStatus:x=>statuses.push(x),onProfile:x=>profiles.push(x)});
  const other=await peer.ready;
  assert.equal(other.playerId,'two');assert.equal(peer.playerId,'one');
  const state={version:1,type:'state',life:1,seq:1,pos:[0,0,0],yaw:0,pitch:0,sector:4,weapon:9,hp:100};
  for(let seq=1;seq<=10;seq++)peer.send({...state,seq});
  peer.send({type:'damage-proof',proof:{id:1,attackerId:'remote'}});
  peer.send({version:1,type:'death',life:1,seq:11,killer:'remote',weapon:9,hpAfter:0,damageId:1});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(messages.filter(x=>x.message?.type==='state').length,1);
  assert.equal(messages[1].message.seq,10);
  assert.equal(messages[2].proof.attackerId,'two');
  assert.equal(messages[3].message.type,'death');
  for(const value of [{type:'death-confirmed',version:2,receipt:{id:'r'}},
    {type:'proof-rejected',version:2,reason:'test'},
    {type:'drop',version:2,drop:{id:'d'}}])
    wire.write(JSON.stringify(value)+'\n');
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(inbound.length,1);assert.equal(inbound[0].version,1);
  assert(statuses.some(x=>x.phase==='death-confirmed'));
  assert.equal(profiles.length,2);
  const shot={id:1,life:1,weapon:9,origin:[0,0,0],direction:[1,0,0],sector:4,renderSector:4,yaw:0,pitch:0};
  peer.send({...state,seq:12,shot});peer.send({...state,seq:13,shot});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(messages.filter(x=>x.message?.shot?.id===1).length,1,'Repeated native poses never replay the same shot');
  assert.equal(messages.find(x=>x.message?.seq===13).message.shot,undefined);
  peer.send({type:'drop-claim',requestId:'g',life:1,weapon:9,magazine:11,reserve:22});
  peer.send({...state,seq:14,inventory:config.inventory,selectedWeapon:9,shot});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert(!messages.some(x=>x.message?.seq===14),'Pre-grant poses are held while server inventory changes');
  wire.write(JSON.stringify({type:'drop-grant',version:2,grant:{id:'g',playerId:'one',life:1,weapon:9,inventory:[50,255,1,6,48,24,18],selectedWeapon:1}})+'\n');
  await new Promise(resolve=>setTimeout(resolve,80));
  assert(!messages.some(x=>x.message?.seq===14),'A grant discards the queued pose with the pre-drop inventory');
  peer.send({...state,seq:140,inventory:config.inventory,selectedWeapon:9,shot});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert(!messages.some(x=>x.message?.seq===140),'Old native IPC frames arriving after ACK are also discarded');
  peer.send({...state,seq:15,weapon:1,selectedWeapon:1,inventory:[50,255,1,6,48,24,18],shot});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(messages.find(x=>x.message?.seq===15).message.shot,undefined,'Old dropped-gun shot is absent from new pistol pose');
  assert.equal(peer.connected,true);
  peer.send({type:'pickup-claim',requestId:'denied-pickup',life:1,dropId:'d'});
  peer.send({...state,seq:16,weapon:1,selectedWeapon:1,inventory:[50,255,1,6,48,24,18]});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert(!messages.some(x=>x.message?.seq===16));
  wire.write(JSON.stringify({type:'pickup-denied',version:2,requestId:'denied-pickup',dropId:'d',reason:'out-of-range'})+'\n');
  await new Promise(resolve=>setTimeout(resolve,80));
  assert(messages.some(x=>x.message?.seq===16),'Denied pickup releases the still-valid pose');
  assert.equal(peer.connected,true);
  wire.write(JSON.stringify({type:'game',version:2,senderId:'two',message:{version:1,type:'leave'}})+'\n');
  await new Promise(resolve=>setTimeout(resolve,30));
  assert(!inbound.some(x=>x.type==='leave'),'Legacy per-player leave cannot close the local match');
  assert.equal(peer.connected,true,'Wait for authoritative departure or match result');
  wire.write(JSON.stringify({type:'peer-left',version:2,playerId:'two'})+'\n');
  await new Promise(resolve=>setTimeout(resolve,30));
  assert(inbound.some(x=>x.type==='peer-left'&&x.playerId==='two'));
  assert.equal(peer.connected,true,'Peer departure alone leaves match continuation to server');
  wire.write(JSON.stringify({type:'match-ended',version:2,result:{winnerIds:['one'],draw:false,scores:{one:10,two:3}}})+'\n');
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(statuses.find(x=>x.phase==='match-ended').result.scores.one,10);
  assert(!inbound.some(x=>x.type==='leave'),'finished match must not immediately close the local game');
  assert.equal(peer.connected,false);
  assert(!statuses.some(x=>x.phase==='disconnected'),'normal server shutdown is not a disconnect error');
  peer.close();if(!wire.destroyed)await once(wire,'close');
  console.log('PASS central adapter: auth required, state coalescing, ordered damage/death, server control conversion, clean close');
}finally{
  peer?.close();wire?.destroy();await new Promise(resolve=>server.close(resolve));
}
