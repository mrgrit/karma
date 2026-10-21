import https from 'node:https';
import fs from 'node:fs';
import {identityPathFor,readIdentity,defaultCa} from './central-transport.mjs';

const host=process.argv[2]||'192.168.12.100',port=Number(process.argv[3]||29020);
try {
  if(!/^[a-zA-Z0-9.:-]{1,253}$/.test(host)||!Number.isInteger(port)||port<1||port>65534)throw Error('서버 주소가 올바르지 않습니다.');
  const identity=readIdentity(identityPathFor(host,port));
  if(!identity.authToken)throw Error('AUTH_REQUIRED: 로그인하면 개설된 방을 볼 수 있습니다.');
  const result=await new Promise((resolve,reject)=>{
    const request=https.get({host,port:port+1,path:'/api/rooms',ca:fs.readFileSync(defaultCa),
      rejectUnauthorized:true,minVersion:'TLSv1.2',headers:{Authorization:'Bearer '+identity.authToken}},response=>{
      let body='';response.setEncoding('utf8');
      response.on('data',part=>{body+=part;if(body.length>256*1024)response.destroy(Error('방 목록 응답이 너무 큽니다.'));});
      response.on('error',reject);
      response.on('end',()=>{try{
        const value=JSON.parse(body);
        if(response.statusCode!==200)throw Error((value.error?.code||'ROOMS_FAILED')+': '+(value.error?.message||'방 목록을 불러올 수 없습니다.'));
        if(!Array.isArray(value.rooms)||value.rooms.length>1000)throw Error('방 목록 형식이 올바르지 않습니다.');
        resolve(value);
      }catch(error){reject(error);}});
    });
    request.setTimeout(8000,()=>request.destroy(Error('방 목록 조회 시간이 초과되었습니다. 서버 연결을 확인하세요.')));
    request.on('error',reject);
  });
  console.log(JSON.stringify({ok:true,...result}));
} catch(error) {
  console.log(JSON.stringify({ok:false,message:error.message}));process.exitCode=1;
}
