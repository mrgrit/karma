import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {identityPathFor,readIdentity,writeIdentity,defaultCa} from './central-transport.mjs';
const support=path.dirname(fileURLToPath(import.meta.url));
const host=process.argv[2]||'192.168.12.100',port=Number(process.argv[3]||29020);
let input='';
for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw Error('Request too large');}
const reply=value=>console.log(JSON.stringify(value));
try{
  if(!/^[a-zA-Z0-9.:-]{1,253}$/.test(host)||!Number.isInteger(port)||port<1||port>65534)throw Error('Invalid server address');
  const request=JSON.parse(input),operation=request.operation;
  const routes={login:'/auth/login',request:'/auth/register/request',verify:'/auth/register/verify',logout:'/auth/logout',rename:'/api/name',rules:'/auth/rules'};
  if(!routes[operation])throw Error('Invalid authentication operation');
  const file=identityPathFor(host,port),identity=readIdentity(file);
  const data=JSON.stringify(operation==='rules'?{rulesAccepted:request.rulesAccepted,rulesVersion:request.rulesVersion}:operation==='rename'?{name:request.displayName}:operation==='logout'?{}:operation==='verify'?
    {email:request.email,code:request.code}:
    {email:request.email,password:request.password,...(operation==='request'?{name:request.displayName,rulesAccepted:request.rulesAccepted,rulesVersion:request.rulesVersion}: {})});
  const result=await new Promise((resolve,reject)=>{
    const req=https.request({host,port:port+1,path:routes[operation],method:'POST',
      ca:fs.readFileSync(defaultCa),rejectUnauthorized:true,timeout:15000,
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),
        ...(identity.authToken?{Authorization:'Bearer '+identity.authToken}:{})}},res=>{
      let body='';res.setEncoding('utf8');
      res.on('data',chunk=>{body+=chunk;if(body.length>65536)res.destroy(Error('Response too large'));});
      res.on('error',reject);res.on('end',()=>{try{resolve(JSON.parse(body));}catch{reject(Error('Invalid authentication response'));}});
    });
    req.on('timeout',()=>req.destroy(Error('서버 응답 시간이 초과되었습니다.')));
    req.on('error',reject);req.end(data);
  });
  if(operation==='logout'){
    for(const target of [file,path.join(support,'central-profile.json')])try{fs.unlinkSync(target);}catch(error){if(error.code!=='ENOENT')throw error;}
    reply({ok:true,message:'로그아웃했습니다.'});
  }else if(result.ok&&['rename','rules'].includes(operation)&&result.profile){
    fs.writeFileSync(path.join(support,'central-profile.json'),JSON.stringify(result.profile));
    reply({ok:true,profile:result.profile});
  }else if(result.ok&&result.authToken&&result.profile){
    writeIdentity(file,{authToken:result.authToken,expiresAt:result.expiresAt,playerId:result.profile.playerId});
    fs.writeFileSync(path.join(support,'central-profile.json'),JSON.stringify(result.profile));
    reply({ok:true,requiresVerification:false,profile:result.profile});
  }else if(result.ok){
    reply({ok:true,requiresVerification:result.requiresVerification!==false,
      approvalRequired:result.approvalRequired===true,approvalStatus:result.approvalStatus,
      expiresIn:result.expiresIn,resendAfter:result.resendAfter,message:result.message});
  }else{
    reply({ok:false,code:result.error?.code||'AUTH_FAILED',message:result.error?.message||'로그인할 수 없습니다.'});
    process.exitCode=1;
  }
}catch(error){
  reply({ok:false,code:'CONNECTION_ERROR',message:error.message});
  process.exitCode=1;
}
