import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {identityPathFor,readIdentity,connectServer} from './central-transport.mjs';
const host=process.argv[2]||'192.168.12.100',port=Number(process.argv[3]||29020);
const support=path.dirname(fileURLToPath(import.meta.url));
if(!/^[a-zA-Z0-9.:-]{1,253}$/.test(host)||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid server address');
const identityPath=identityPathFor(host,port),identity=readIdentity(identityPath);
if(!identity.authToken){console.error('AUTH_REQUIRED: 로그인해 주세요.');process.exit(2);}
const socket=connectServer({host,port});
let buffer='',done=false;
const deadline=setTimeout(()=>finish(Error('서버 계급 정보 조회 시간이 초과되었습니다.')),10000);
function finish(error){
  if(done)return;done=true;clearTimeout(deadline);socket.destroy();
  if(error){console.error(error.message);process.exitCode=1;}
}
socket.once('secureConnect',()=>socket.write(JSON.stringify({type:'hello',version:2,op:'profile',authToken:identity.authToken})+'\n'));
socket.on('data',data=>{
  try{
    buffer+=data.toString('utf8');
    if(Buffer.byteLength(buffer)>65536)throw Error('Invalid profile response');
    const end=buffer.indexOf('\n');if(end<0)return;
    const message=JSON.parse(buffer.slice(0,end));
    if(message.type==='error')throw Error(message.code+': '+message.message);
    if(message.type!=='welcome'||typeof message.profile?.playerId!=='string')throw Error('Invalid profile response');
    fs.writeFileSync(path.join(support,'central-profile.json'),JSON.stringify(message.profile));
    console.log('XP '+message.profile.xp);finish();
  }catch(error){finish(error);}
});
socket.on('error',finish);
socket.on('close',()=>{if(!done)finish(Error('서버가 계급 정보를 보내기 전에 연결을 종료했습니다.'));});
