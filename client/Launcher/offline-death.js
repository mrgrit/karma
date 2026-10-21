// Offline-only death reporting guard and native respawn. Include before AI.
// Runtime evidence: KarmaAIProbe PID39916, 2026-10-20T06:50:22.970Z:
// access violation at0x422cb4 writing0xb8, online client [0x561850]=0.
(()=>{
 'use strict';
 const name=Process.mainModule.name.toLowerCase();
 if(!['karmaaiprobe.exe','karmasession.exe','karmaoffline.exe','karmapractice.exe'].includes(name))
  throw new Error('Offline death helper refuses this process: '+name);
 const q=a=>ptr(a),off={spawn:null,deadAt:0,count:0,failed:false};
 const gameClock=new NativeFunction(q('0x52c36c').readPointer(),'uint',[],'stdcall');
 function patch(at,expected,replacement){
  const address=q(at),got=Array.from(new Uint8Array(address.readByteArray(expected.length)));
  if(got.every((x,i)=>x===replacement[i]))return;
  if(!got.every((x,i)=>x===expected[i]))throw new Error('Unexpected native bytes at '+address+': '+got);
  Memory.patchCode(address,replacement.length,code=>code.writeByteArray(replacement));
 }
 // Death-packet sender only: native health/death animation has already run.
 patch('0x422c50',[0x83,0xec,0x14],[0xc2,0x10,0x00]);
 // Server-dependent respawn chooser is replaced by the main-thread respawn below.
 patch('0x421b50',[0x83,0xec,0x14],[0x31,0xc0,0xc3]);
 // Offline score calculations have no online premium-profile flag.
 patch('0x425c09',[0x8b,0x0d,0x50,0x18,0x56,0x00],[0xe9,0x0b,0x00,0x00,0x00,0x90]);
 globalThis.KARMA_OFFLINE_DEATH_HELPER=true;
 const respawn=new NativeFunction(q('0x450020'),'void',['pointer','int','float','float','float','float'],'thiscall');
 function position(a){return [a.add(0x1a40).readFloat(),a.add(0x1a44).readFloat(),a.add(0x1a48).readFloat()];}
 Interceptor.attach(q('0x44a4c0'),{
  onEnter(args){this.local=args[0].toInt32()===0;this.manager=this.context.ecx;},
  onLeave(){
   if(!this.local||off.spawn)return;
   const a=this.manager.add(0xfcc).readPointer(),pos=position(a);
   if(!pos.every(Number.isFinite))return;
   off.spawn={position:pos,sector:a.add(0x1b44).readS32(),yaw:a.add(0x19b8).readFloat()};
   send({event:'offline-respawn-point',...off.spawn});
  }
 });
 Interceptor.attach(q('0x451380'),{
  onEnter(){
   if(off.failed||!off.spawn||q('0x548d70').readS32()!==1||!q('0x561850').readPointer().isNull())return;
   const m=this.context.ecx,index=m.add(0x1064).readS32();
   if(index<0||index>7)return;
   const a=m.add(0xfcc+index*4).readPointer(),health=a.add(0x264).readS32()-625;
   if(health>0){off.deadAt=0;return;}
   const now=gameClock(),respawnDelay=globalThis.KARMA_LAN_CONFIG?.match?.mode==='dm'?10000:4500;
   if(!off.deadAt){off.deadAt=now;send({event:'offline-player-death',hp:health,respawnInMs:globalThis.KARMA_LAN_CONFIG?.match?.mode==='tdm'?null:respawnDelay});return;}
   if(((now-off.deadAt)>>>0)<respawnDelay)return;
   const selected=globalThis.KARMA_LAN_RESPAWN?.(m);if(selected===false)return;
   const prior=m.add(0x1050).readPointer(),s=selected||off.spawn;
   try{
    m.add(0x1050).writePointer(a);
    respawn(m,s.sector,s.position[0],s.position[1],s.position[2],s.yaw*180/Math.PI);
    m.add(0xfb4).writeS32(0);m.add(0x114c).writeS32(0);
    off.deadAt=0;off.count++;
    send({event:'offline-player-respawned',hp:a.add(0x264).readS32()-625,position:position(a),count:off.count});
   }catch(error){
    off.failed=true;
    send({event:'offline-respawn-error',error:String(error),stack:error.stack});
   }finally{m.add(0x1050).writePointer(prior);}
  }
 });
 send({event:'offline-death-helper-ready',respawnDelayMs:4500,patches:['death-report','server-respawn','premium-score-flag']});
})();
