import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {identityPathFor,readIdentity,defaultCa} from './central-transport.mjs';
const host=process.argv[2]||'192.168.12.100',port=Number(process.argv[3]||29020);
const support=path.dirname(fileURLToPath(import.meta.url));
try{
  if(!/^[a-zA-Z0-9.:-]{1,253}$/.test(host)||!Number.isInteger(port)||port<1||port>65534)throw Error('Invalid server address');
  const identity=readIdentity(identityPathFor(host,port));
  if(!identity.authToken)throw Error('AUTH_REQUIRED: 로그인해 주세요.');
  const result=await new Promise((resolve,reject)=>{
    const request=https.get({host,port:port+1,path:'/api/me',ca:fs.readFileSync(defaultCa),minVersion:'TLSv1.2',
      headers:{Authorization:'Bearer '+identity.authToken}},response=>{
      let text='';response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk;if(text.length>2*1024*1024)response.destroy(Error('Invalid profile size'));});
      response.on('error',reject);response.on('end',()=>{try{const value=JSON.parse(text);if(response.statusCode!==200)throw Error((value.error?.code||'PROFILE_FAILED')+': '+(value.error?.message||'서버 조회 실패'));resolve(value);}catch(error){reject(error);}});
    });
    request.setTimeout(12000,()=>request.destroy(Error('서버 계급 정보 조회 시간이 초과되었습니다.')));request.on('error',reject);
  });
  if(typeof result.profile?.playerId!=='string')throw Error('Invalid profile response');
  fs.writeFileSync(path.join(support,'central-profile.json'),JSON.stringify(result.profile));
  console.log('XP '+result.profile.xp);
}catch(error){console.error(error.message);process.exitCode=1;}
