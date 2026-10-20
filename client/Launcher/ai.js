// Staged single-opponent offline controller. aiReady is managed separately.
// Controlled prototype for an isolated KarmaAIProbe.exe copied from KarmaOffline.exe.
// Inject before process resume; never attach to user's active game.
// This file seeds one additional native actor. Combat AI remains opt-in while researched.
'use strict';
const AI_PROBE = {
 enabled:true,remoteMotion:false,remoteFire:false,playerDamage:true,distance:650,
 think:true,move:true,botFire:true,botDamage:true,respawn:true,
 speed:180,fireMs:1400,aimError:0.035,respawnMs:4500
};
if (!['karmasession.exe','karmaaiprobe.exe'].includes(Process.mainModule.name.toLowerCase())) {
  throw new Error('The offline AI controller requires KarmaSession.exe or its isolated test executable');
}
const P = a => ptr(a);
// Native game callbacks can inherit 24-bit x87 precision. Epoch+delay loses
// tens of seconds in that mode, so AI deadline arithmetic uses a small origin.
const aiClockOrigin=Date.now();
function aiNow(){return Math.max(1,Date.now()-aiClockOrigin);}
const state = {roster: null, main: null, manager: null, player: null, bot: null, spawned: false, localPlaced:false, localPlacedAt:0,firstTickAt:0,lastSpawnWarning:0,nextSpawnAttempt:0,updates:0,botRenderCalls:0,hitHookEntries:0,playerHitHooks:0,lastLog:0,lastShot:0,start:0};
const place = new NativeFunction(P('0x44a4c0'),'void',['pointer','int','int','float','float','float','float','int'],'thiscall');
const setYaw = new NativeFunction(P('0x44afd0'),'void',['pointer','int','float'],'thiscall');
const nativeDamageCall = new NativeFunction(P('0x461ae0'),'int',['pointer','int','int','int','float','float','float','int','int','int'],'thiscall');
function nativeDamage(victim,region,attacker,weapon,...rest){
 const before=victim.add(0x264).readS32()-625;
 const result=nativeDamageCall(victim,region,attacker,weapon,...rest);
 const slot=state.player&&victim.equals(state.player)?0:state.bot&&victim.equals(state.bot)?1:-1;
 if(slot>=0&&typeof recordOfflineCombatDamage==='function')
  recordOfflineCombatDamage(slot,attacker,before,victim.add(0x264).readS32()-625,weapon);
 return result;
}
function copy(dst,src,n){dst.writeByteArray(src.readByteArray(n));}
function vec(p,o){return [p.add(o).readFloat(),p.add(o+4).readFloat(),p.add(o+8).readFloat()];}
function putvec(p,o,v){for(let k=0;k<3;k++)p.add(o+k*4).writeFloat(v[k]);}
function actor(p){return {ptr:p.toString(),type:p.add(0x261).readU8(),team:p.add(0x262).readU8(),hp:p.add(0x264).readS32()-625,active:p.add(0x1e24).readU8(),enabled:p.add(0x19ac).readS32(),spawned:p.add(0x19b0).readS32(),roster:p.add(0x19b4).readS32(),position:vec(p,0x1a40),yaw:p.add(0x19b8).readFloat(),sector:p.add(0x1b44).readS32(),renderSector:p.add(0x1b4c).readS32(),visible:p.add(0x1bb0).readS32(),weapon:p.add(0x290).readU8(),model:p.add(0x1f00).readS32(),modelInstance:p.add(0x158).readPointer().toString(),anim:[p.add(0x1970).readU8(),p.add(0x1971).readU8(),p.add(0x1972).readU8()]};}
function snapshot(event){
 const m=state.manager;
 send({event,pid:Process.id,main:state.main&&state.main.toString(),manager:m&&m.toString(),count:m&&m.add(0x1070).readS32(),player:state.player&&actor(state.player),bot:state.bot&&actor(state.bot),updates:state.updates,botRenderCalls:state.botRenderCalls});
}
Process.setExceptionHandler(d=>{send({event:'native-exception',type:d.type,address:d.address.toString(),memory:d.memory,pc:d.context.pc.toString(),backtrace:Thread.backtrace(d.context,Backtracer.FUZZY).map(a=>a.toString())});return false;});
Interceptor.attach(P('0x420560'),{
 onEnter(){this.s=this.context.ecx;},
 onLeave(ret){
  if(!AI_PROBE.enabled || ret.toInt32()===0 || P('0x548d70').readS32()!==1)return;
  const s=this.s,m=s.add(0xc).readPointer();state.roster=s;
  s.add(0x968+4).writeS32(1); // active slot1
  s.add(0x5c+4).writeS32(1); // distinct player ID; local ID is0
  s.add(0x7c+1).writeU8(1-s.add(0x7c).readU8());
  s.add(0x86+1).writeU8(s.add(0x86).readU8());
  copy(s.add(0x8e+0x14),s.add(0x8e),0x14); // character filename
  copy(m.add(0x1768+0x14),m.add(0x1768),0x14); // model-loader filename array
  copy(s.add(0x12e+7),s.add(0x12e),7); // original native inventory
  s.add(0x166+0x100).writeUtf8String('AI Prototype');
  s.add(0x990+4).writeS32(0); // no clan slot
  // The offline loader initializes only slot0. Online initialization42075f
  // also supplies both0x98-byte profile records, clan data, and target badge.
  // Leaving these uninitialized crashes42be50 when the crosshair sees slot1.
  s.add(0xad0+0x98).writeByteArray(new Uint8Array(0x98));
  s.add(0xf90+0x98).writeByteArray(new Uint8Array(0x98));
  s.add(0xab0+4).writeS32(0);
  s.add(0x9b0+0x20).writeByteArray(new Uint8Array(0x20));
  s.add(0x1450+1).writeU8(0);
  send({event:'roster-seeded',state:s.toString(),model:s.add(0x8e).readUtf8String(),weapons:Array.from(new Uint8Array(s.add(0x12e).readByteArray(7)))});
 }
});
Interceptor.attach(P('0x44fb30'),{
 onEnter(args){this.slot=args[0].toInt32();this.m=this.context.ecx;this.details={slot:this.slot,team:args[1].toInt32(),model:args[2].readUtf8String(),type:args[3].toInt32(),name:args[4].readUtf8String(),loadoutMode:args[6].toInt32()};},
 onLeave(ret){send({event:'native-character-configured',result:ret.toInt32(),...this.details});}
});
Interceptor.attach(P('0x44a4c0'),{
 onEnter(args){this.slot=args[0].toInt32();this.m=this.context.ecx;},
 onLeave(){if(this.slot===0){state.localPlaced=true;state.localPlacedAt=aiNow();state.manager=this.m;}}
});
Interceptor.attach(P('0x451380'),{
 onEnter(args){
  if(globalThis.KARMA_LOCAL_PAUSED===true||!state.localPlaced||!AI_PROBE.enabled)return;
  const now=aiNow();
  const m=this.context.ecx,g=P('0x548d5c').readPointer();
  if(m.add(0x1070).readS32()<2)return;
  const p=m.add(0xfcc).readPointer(),b=m.add(0xfd0).readPointer();
  state.main=g;state.manager=m;state.player=p;state.bot=b;
  if(!state.firstTickAt)state.firstTickAt=now;
  if(!state.spawned && now-state.firstTickAt<1500)return;
  if(!state.spawned){
   if(now<state.nextSpawnAttempt)return;
   state.nextSpawnAttempt=now+500;
   const pos=vec(p,0x1a40),forward=vec(p,0x1c78);let dx=forward[0],dz=forward[2],len=Math.hypot(dx,dz);
   if(!Number.isFinite(len)||len<0.01){dx=0;dz=1;len=1;}
   let bp=[pos[0]+dx/len*AI_PROBE.distance,pos[1],pos[2]+dz/len*AI_PROBE.distance];
   if(typeof chooseBotSpawn==='function'){
    const checked=chooseBotSpawn(pos,[dx/len,0,dz/len],p.add(0x1b44).readS32());
    if(!checked){
     if(now-state.lastSpawnWarning>2000){state.lastSpawnWarning=now;send({event:'bot-awaiting-clear-spawn',player:actor(p)});}
     return;
    }
    bp=checked;
   }
   const yaw=typeof botSpawnYaw==='function'?botSpawnYaw(pos,bp):p.add(0x19b8).readFloat()+Math.PI,sector=p.add(0x1b44).readS32();
   state.spawned=true;state.start=now;
   place(m,1,sector,bp[0],bp[1],bp[2],yaw*180/Math.PI,0);
   b.add(0x1e24).writeU8(1);b.add(0x19b4).writeS32(1);b.add(0x19ac).writeS32(1);b.add(0x19b0).writeS32(1);
   // Type6 consumes synthesized remote state only if its changed flag is set.
   b.add(0x1bd4).writeS32(0);
   copy(b.add(0x1b14),b.add(0x1a40),12);copy(b.add(0x1b20),b.add(0x1a40),12);
   putvec(b,0x1bf8,vec(b,0x1a40));
   snapshot('bot-placed');
  }
  // Local network decoder rebuilds the active bitmask; restore only this bot slot.
  b.add(0x1e24).writeU8(1);
  if(b.add(0x264).readS32()>625)b.add(0x19b0).writeS32(1);
  state.updates++;
  if(AI_PROBE.remoteMotion){
   const pp=vec(p,0x1a40),bp=vec(b,0x1a40);const dx=pp[0]-bp[0],dz=pp[2]-bp[2];
   // Native 0x452c10 rotates the +X basis into [cos(yaw),0,-sin(yaw)].
   const yaw=Math.atan2(-dz,dx);
   setYaw(m,1,yaw);
   b.add(0x1bf0).writeFloat(yaw);b.add(0x1bf4).writeFloat(0);
   b.add(0x1be6).writeU8(b.add(0x1b44).readS32()&255);b.add(0x1be8).writeU16(0);
   putvec(b,0x1bf8,bp);copy(b.add(0x1b20),b.add(0x1a40),12);
   b.add(0x1be4).writeU8(4);b.add(0x1be3).writeU8(0);b.add(0x1be5).writeU8(14);
   b.add(0x1bd9).writeU8(0);b.add(0x1bec).writeS32(0);
   if(AI_PROBE.remoteFire && now-state.lastShot>1200){b.add(0x1bec).writeS32(1);b.add(0x1bd9).writeU8(16);state.lastShot=now;}
   b.add(0x1bd4).writeS32(1);
  }
  thinkBot();
  if(now-state.lastLog>2000){state.lastLog=now;snapshot('tick');}
 }
});
// Original collision produces a wire-format hit report; offline peers need the
// same original receiver-side damage routine. Disabled until spawn is verified.
function applyPlayerHit(m,weapon,direction){
 if([28,29,30].includes(weapon)){
  applyPlayerPelletHits(m,weapon,direction);
  return;
 }
 const valid=m.add(0x10ac).readS32(),hit=m.add(0x10a8).readU8();
 if(!valid)return;
 const slot=hit>>>4,region=(hit&15)-1;
 send({event:'native-player-hit',weapon,slot,region,raw:hit});
 if(!AI_PROBE.playerDamage || slot!==1 || region<0 || state.bot.add(0x264).readS32()<=625)return;
 const b=state.bot,p=state.player,dir=direction,before=b.add(0x264).readS32()-625;
 const dead=nativeDamage(b,region,0,weapon,dir[0],dir[1],dir[2],p.add(0x262).readU8(),m.add(0x1140).readS32(),p.add(0x1f0c).readS32());
 send({event:'bot-native-damage',before,after:b.add(0x264).readS32()-625,dead,region,weapon});
}
Interceptor.attach(P('0x451bd0'),{
 onEnter(args){
  this.m=this.context.ecx;this.weapon=args[1].toInt32();this.shooter=this.m.add(0x1050).readPointer();
  this.shooterSlot=args[0].toInt32();
  if(++state.hitHookEntries<=3)send({event:'native-hit-hook-enter',slot:this.shooterSlot,weapon:this.weapon,manager:this.m.toString(),shooter:this.shooter.toString(),player:state.player&&state.player.toString()});
  // Capture the actual engine-call direction, including a queued test shot.
  // Frida exposes stack float arguments as raw32-bit values in this callback.
  const bits=new DataView(new ArrayBuffer(4));
  this.direction=[5,6,7].map(i=>{bits.setUint32(0,args[i].toInt32()>>>0,true);return bits.getFloat32(0,true);});
 },
 onLeave(){
  const m=this.m;
  if(!state.spawned || !this.shooter.equals(state.player))return;
  state.playerHitHooks++;
  applyPlayerHit(m,this.weapon,this.direction);
 }
});
// Trace death reporting and online access risk, without altering them.
Interceptor.attach(P('0x453fa0'),{onEnter(args){send({event:'native-death-record',args:[0,1,2,3].map(i=>args[i].toInt32())});}});
Interceptor.attach(P('0x425be0'),{onEnter(args){send({event:'score-route',kind:args[0].toInt32(),slot:args[1].toInt32(),online:P('0x561850').readPointer().toString()});}});
// The native renderer calls45f490 after sector-list, spawned, and frustum gates.
Interceptor.attach(P('0x45f490'),{onEnter(){
 if(!state.spawned||!state.bot||!this.context.ecx.equals(state.bot))return;
 if(++state.botRenderCalls===1)send({event:'bot-native-render-called',actor:actor(state.bot)});
}});
send({event:'ai-probe-ready',config:AI_PROBE});

// Local descriptive statistics, not a neural model. No filesystem or network.
// The host may supply a previous numeric profile through KARMA_PLAYSTYLE.
function createKarmaPlaystyle(initial) {
 const limit=(x,a,b)=>Math.max(a,Math.min(b,x));
 const value=(key,fallback,min,max)=>{
  const n=initial&&initial[key];
  return typeof n==='number'&&Number.isFinite(n)?limit(n,min,max):fallback;
 };
 const profile={
  version:1,samples:value('samples',0,0,1000000),
  engagementSamples:value('engagementSamples',0,0,1000000),
  meanPlayerSpeed:value('meanPlayerSpeed',0,0,2400),
  meanEngagementRange:value('meanEngagementRange',1000,250,2400),
  stationaryFraction:value('stationaryFraction',0.5,0,1),
  meanLateralFraction:value('meanLateralFraction',0,0,1),
  strafeBias:value('strafeBias',0,-1,1)
 };
 let previous=null;
 function mean(key,x,n){profile[key]+=(x-profile[key])/Math.min(300,Math.max(1,n));}
 return {
  sample(now,player,bot,sector,engaged) {
   if(!Number.isFinite(now)||![...player,...bot].every(Number.isFinite)){previous=null;return false;}
   const old=previous;previous={now,player:player.slice(),sector};
   if(!old||old.sector!==sector)return false;
   const dt=(now-old.now)/1000;
   if(dt<0.2){previous=old;return false;}
   if(dt>3)return false;
   const vx=(player[0]-old.player[0])/dt,vz=(player[2]-old.player[2])/dt;
   const speed=Math.hypot(vx,vz);
   // Reject respawn/teleport discontinuities instead of learning them as movement.
   if(speed>2400||Math.abs(player[1]-old.player[1])>400)return false;
   profile.samples=Math.min(1000000,profile.samples+1);
   mean('meanPlayerSpeed',speed,profile.samples);
   mean('stationaryFraction',speed<70?1:0,profile.samples);
   const dx=player[0]-bot[0],dz=player[2]-bot[2],range=Math.hypot(dx,dz);
   if(engaged&&range>=250&&range<=2400){
    profile.engagementSamples=Math.min(1000000,profile.engagementSamples+1);
    mean('meanEngagementRange',range,profile.engagementSamples);
    if(speed>70){
     const lateral=(-dz*vx+dx*vz)/(range*speed);
     mean('meanLateralFraction',Math.abs(lateral),profile.engagementSamples);
     mean('strafeBias',lateral,profile.engagementSamples);
    }
   }
   return true;
  },
  resetSample(){previous=null;},
  export(){return {...profile};},
  parameters(){
   const confidence=limit(profile.samples/100,0,1);
   const rangeConfidence=limit(profile.engagementSamples/60,0,1);
   return {
    preferredRange:limit(800+(profile.meanEngagementRange-1000)*0.20*rangeConfidence,650,1100),
    speedScale:limit(1+(profile.meanPlayerSpeed-300)*0.0012*confidence,0.85,1.8),
    strafeWeight:limit(0.50+profile.meanLateralFraction*0.28*rangeConfidence,0.50,0.78),
    pauseChance:limit(0.14+(0.5-profile.stationaryFraction)*0.10*confidence,0.09,0.19),
    // Adapt movement only. Reaction time, aim error and damage do not improve
    // from player performance, so this is not an automatic difficulty ratchet.
    lateralBias:limit(-profile.strafeBias*0.20*rangeConfidence,-0.20,0.20)
   };
  }
 };
}

// Controller additions for the isolated test process. The builder combines
// these with ai_probe.js; every engine call occurs on the native game thread.
const nativeReset = new NativeFunction(P('0x45e3a0'),'void',['pointer'],'thiscall');
const nativeInventory = new NativeFunction(P('0x44fd00'),'void',['pointer','int','int','pointer','int'],'thiscall');
const nativeStance = new NativeFunction(P('0x463dd0'),'void',['pointer','int'],'thiscall');
const nativeBodyAction = new NativeFunction(P('0x463100'),'void',['pointer','int'],'thiscall');
const nativeWeaponAction = new NativeFunction(P('0x462560'),'void',['pointer','int'],'thiscall');
const nativeRefreshModel = new NativeFunction(P('0x45e6c0'),'void',['pointer'],'thiscall');
const nativeRefreshPosition = new NativeFunction(P('0x45ec00'),'void',['pointer'],'thiscall');
const nativePlayerRespawn = new NativeFunction(P('0x450020'),'void',['pointer','int','float','float','float','float'],'thiscall');
const nativeHitscan = new NativeFunction(P('0x451bd0'),'void',['pointer','int','int','float','float','float','float','float','float','int','int','float','float','uint'],{abi:'thiscall',scheduling:'cooperative',traps:'all'});
const nativeFireEffects = new NativeFunction(P('0x461150'),'void',['pointer'],'thiscall');
// This old MSVC function returns its float in x87ST0. On the observed x86
// Frida build, declaring a float return read stale EAX bits (0x17923921).
// A cdecl void bridge explicitly consumes ST0 into memory, preserving x87 depth.
const groundBridgeCode=Memory.alloc(Process.pageSize),groundResult=Memory.alloc(4);
Memory.protect(groundBridgeCode,Process.pageSize,'rwx');
groundBridgeCode.writeByteArray([
 0x55,0x89,0xe5,             // push ebp;mov ebp,esp
 0x8b,0x4d,0x08,            // mov ecx,[ebp+8] world
 0xff,0x75,0x18,            // push zBits
 0xff,0x75,0x14,            // push yBits
 0xff,0x75,0x10,            // push xBits
 0xff,0x75,0x0c,            // push sector
 0xb8,0x30,0x3c,0x44,0x00,  // mov eax,0x443c30
 0xff,0xd0,                 // call eax;native pops16 argument bytes
 0x8b,0x55,0x1c,            // mov edx,[ebp+28] output pointer
 0xd9,0x1a,                 // fstp dword[edx]
 0x89,0xec,0x5d,0xc3        // mov esp,ebp;pop ebp;ret
]);
const groundBridge=new NativeFunction(groundBridgeCode,'void',['pointer','int','uint','uint','uint','pointer'],'mscdecl');
// NativeFunction need not retain the allocation owning its machine code. Keep
// both buffers alive even when the combined AI module is wrapped in an IIFE.
globalThis.KARMA_AI_NATIVE=Object.assign(globalThis.KARMA_AI_NATIVE||{},{groundBridgeCode,groundResult,groundBridge});
const groundFloatBits=new DataView(new ArrayBuffer(4));
function floatBits(value){groundFloatBits.setFloat32(0,value,true);return groundFloatBits.getUint32(0,true);}
function nativeGround(world,sector,x,y,z){
 groundBridge(world,sector,floatBits(x),floatBits(y),floatBits(z),groundResult);
 return groundResult.readFloat();
}
const nativeGroundPolygon = new NativeFunction(P('0x4412c0'),'int',['pointer','int','float','float','float'],'thiscall');
const nativeWorldRay = new NativeFunction(P('0x4d9840'),'int',['pointer','int','int','float','float','float','float','float','float'],'thiscall');
const nativeSectorByName = new NativeFunction(P('0x444ac0'),'int',['pointer','pointer'],'thiscall');
// aiNow() comes from ai_probe.js and uses relative milliseconds to avoid the
// native thread's observed 32-bit-float rounding of absolute epoch deadlines.
const brain = {lastThink:0,lastFire:0,botDeadAt:0,playerDeadAt:0,spawn:null,playerSpawn:null,queuedShot:null,shots:0,kills:0,deaths:0,respawns:0,moveBlocked:0,moveChecks:0,queuedPlayerShot:null,playerTestRequests:0,playerTestShots:0,
 nextFireAt:0,reactionUntil:0,visible:false,lastSeenAt:0,lastSeenPosition:null,lastSeenSector:-1,
 behavior:null,aimYaw:null,aimPitch:0,pauseSince:0,lastProfileAt:0,lastPerceptionAt:0,lastSpawnAttempt:0,lastSpawn:null,spawnSerial:0,startedAt:0};
let playstyle=null;
function learning(){
 if(!playstyle&&typeof createKarmaPlaystyle==='function')playstyle=createKarmaPlaystyle(globalThis.KARMA_PLAYSTYLE);
 return playstyle;
}
function profileEvent(force=false){
 const model=learning(),now=aiNow();
 if(model&&(force||now-brain.lastProfileAt>=15000)){
  brain.lastProfileAt=now;
  send({event:'playstyle-profile',profile:model.export(),parameters:model.parameters()});
 }
}
function aiPauseChanged(paused){
 const now=aiNow();
 if(paused){
  if(!brain.pauseSince)brain.pauseSince=now;
  brain.queuedShot=null;
  return;
 }
 if(!brain.pauseSince)return;
 const elapsed=Math.max(0,now-brain.pauseSince);
 for(const key of ['lastThink','lastFire','nextFireAt','reactionUntil','botDeadAt','playerDeadAt','lastSeenAt','lastSpawnAttempt','lastProfileAt','lastPerceptionAt','startedAt']){
  if(brain[key]>0)brain[key]+=elapsed;
 }
 if(brain.behavior)brain.behavior.until+=elapsed;
 for(const key of ['localPlacedAt','firstTickAt','lastSpawnWarning','nextSpawnAttempt','lastLog','lastShot','start']){
  if(state[key]>0)state[key]+=elapsed;
 }
 brain.pauseSince=0;brain.lastThink=now;brain.nextFireAt=Math.max(brain.nextFireAt,now+900);
 brain.queuedShot=null;
 if(learning())learning().resetSample();
 send({event:'bot-resume-grace',pauseMs:elapsed,until:brain.nextFireAt});
}
const previousPauseHandler=globalThis.KARMA_AI_PAUSE_CHANGED;
globalThis.KARMA_AI_PAUSE_CHANGED=paused=>{
 if(typeof previousPauseHandler==='function')previousPauseHandler(paused);
 aiPauseChanged(paused);
};
function hp(p){return p.add(0x264).readS32()-625;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function random(min,max){return min+Math.random()*(max-min);}
function angleDelta(to,from){return Math.atan2(Math.sin(to-from),Math.cos(to-from));}
function turnToward(from,to,maxStep){return from+clamp(angleDelta(to,from),-maxStep,maxStep);}
function shotDirection(yaw,pitch){const c=Math.cos(pitch);return [c*Math.cos(yaw),Math.sin(pitch),-c*Math.sin(yaw)];}
function eyeHeight(){
 const p=state.player,dy=p.add(0x1c88).readFloat()-p.add(0x1a44).readFloat();
 // Native standing camera height is300 in the observed player model. The
 // remote packet carries this height as an unsigned16-bit value.
 if(Number.isFinite(dy)&&dy>30&&dy<1000)return dy;
 const camera=state.manager.add(0x1054).readPointer(),height=camera.add(0x344).readFloat();
 return Number.isFinite(height)&&height>30&&height<1000?height:300;
}
function rememberSpawn(){
 if(brain.spawn)return;
 const b=state.bot,p=state.player;
 brain.startedAt=aiNow();
 brain.spawn={pos:vec(b,0x1a40),sector:b.add(0x1b44).readS32(),yaw:b.add(0x19b8).readFloat()};
 brain.playerSpawn={pos:vec(p,0x1a40),sector:p.add(0x1b44).readS32(),yaw:p.add(0x19b8).readFloat()};
}
function respawnBot(){
 if(globalThis.KARMA_LOCAL_PAUSED===true)return;
 const now=aiNow();
 if(now-brain.lastSpawnAttempt<650)return;
 brain.lastSpawnAttempt=now;
 const m=state.manager,b=state.bot,p=state.player,pp=vec(p,0x1a40),yaw=p.add(0x19b8).readFloat();
 const sector=p.add(0x1b44).readS32();
 const chosen=chooseSpawnPoint(pp,[Math.cos(yaw),0,-Math.sin(yaw)],sector,vec(b,0x1a40));
 if(!chosen){send({event:'bot-respawn-waiting',sector,reason:'no-safe-nearby-landing'});return;}
 const s={pos:chosen.position,sector:chosen.sector,yaw:Math.atan2(-(pp[2]-chosen.position[2]),pp[0]-chosen.position[0])};
 nativeReset(b);
 nativeInventory(m,1,b.add(0x262).readU8(),state.roster.add(0x135),0);
 for(const o of [0x1974,0x1978,0x1980,0x1984])b.add(o).writeS32(14);
 nativeStance(b,0);nativeBodyAction(b,4);nativeWeaponAction(b,13);
 place(m,1,s.sector,s.pos[0],s.pos[1],s.pos[2],s.yaw*180/Math.PI,0);
 nativeRefreshModel(b);nativeRefreshPosition(b);
 b.add(0x1e24).writeU8(1);b.add(0x1bd4).writeS32(0);
 copy(b.add(0x1b14),b.add(0x1a40),12);copy(b.add(0x1b20),b.add(0x1a40),12);
 brain.spawn=s;brain.lastSpawn=s.pos.slice();brain.aimYaw=s.yaw;brain.aimPitch=0;
 brain.visible=false;brain.lastSeenAt=0;brain.lastSeenPosition=null;brain.behavior=null;
 brain.botDeadAt=0;brain.respawns++;brain.lastFire=now;brain.nextFireAt=now+1800;brain.reactionUntil=now+900;
 brain.queuedShot=null;
 send({event:'bot-respawned',actor:actor(b),count:brain.respawns});
 profileEvent(true);
}
function respawnPlayer(){
 if(globalThis.KARMA_LOCAL_PAUSED===true)return;
 const m=state.manager,p=state.player,s=brain.playerSpawn,old=m.add(0x1050).readPointer();
 try{
  m.add(0x1050).writePointer(p);
  nativePlayerRespawn(m,s.sector,s.pos[0],s.pos[1],s.pos[2],s.yaw*180/Math.PI);
 }finally{m.add(0x1050).writePointer(old);}
 brain.playerDeadAt=0;brain.lastFire=aiNow();brain.nextFireAt=aiNow()+2000;brain.queuedShot=null;
 if(learning())learning().resetSample();
 send({event:'player-respawned',actor:actor(p)});
}
function confirmedGround(world,sector,x,referenceY,z,maxDelta){
 // Native443c30 -> 43f180 searches only within +/-100 of its input Y.
 // If no floor matches, 43f34f returns that input Y unchanged. One query
 // therefore cannot distinguish a floor from an echo fallback. Two distinct
 // probe heights must converge on the same surface before we accept it.
 const low=nativeGround(world,sector,x,referenceY-24,z);
 const high=nativeGround(world,sector,x,referenceY+24,z);
 if(!Number.isFinite(low)||!Number.isFinite(high)||Math.abs(low-high)>.5)return null;
 const y=(low+high)*.5;
 return Math.abs(y-referenceY)<=maxDelta?y:null;
}
function validStep(from,to,sector){
 const m=state.manager,w=m.add(0xc).readPointer(),c=m.add(0x14).readPointer();
 const trace=++brain.moveChecks<=3;
 if(trace)send({event:'native-ground-check-enter',sector,from,to,world:w.toString(),collision:c.toString()});
 // Reject a candidate outside the sector's collision tree before scanning its
 // floor triangles. Ground and the final polygon/clearance checks still apply.
 const worldData=w.add(0x1399c).readPointer();
 if(sector<0||![...from,...to].every(Number.isFinite)||nativeGroundPolygon(worldData,sector,to[0],from[1]+5,to[2])===0)return null;
 const ground=confirmedGround(w,sector,to[0],from[1],to[2],50);
 if(trace)send({event:'native-ground-check-return',ground});
 if(ground===null)return null;
 const result=[to[0],ground,to[2]];
 const poly=nativeGroundPolygon(worldData,sector,result[0],result[1]+5,result[2]);
 if(trace)send({event:'native-polygon-check-return',poly});
 if(poly===0)return null;
 for(const height of [35,Math.round(eyeHeight()*0.8)]){
  const hit=nativeWorldRay(c,sector,sector,from[0],from[1]+height,from[2],result[0],result[1]+height,result[2]);
  if(trace)send({event:'native-world-ray-return',height,hit});
  // Native0x4da850/0x4da8c0:0 reaches the endpoint,2 hits a wall;
  // 1 also covers an invalid start polygon or leaving the known polygon.
  if(hit!==0)return null;
 }
 return result;
}
// Exact original Mass of Winter spawn coordinates, grounded against its shipped
// collision triangles. Native landing checks still run before every placement.
const originalSpawnPoints=[
 ['personal-0','1',[-3846,400,-7446]],['personal-1','1',[5315,400,-8272]],
 ['personal-2','1',[5037,400,-16531]],['personal-3','1',[-5837,400,-18965]],
 ['personal-4','5',[-3650,1400,-13551]],['personal-5','6',[-147,1400,-8212]],
 ['personal-6','2',[-908,400,-8500]],['personal-7','3',[2192,1200,-1314]],
 ['personal-8','3',[1635,2120,1912]],['axis-0','1',[-10306,400,-22556]],
 ['axis-1','1',[-10717,400,-22174]],['axis-2','1',[-10133,400,-22298]],
 ['axis-3','1',[-9537,400,-22387]],['axis-4','1',[-9775,400,-21576]],
 ['allies-0','3',[3401,1200,-2473]],['allies-1','3',[2916,1200,-1252]],
 ['allies-2','3',[5321,2120,-13]],['allies-3','3',[4325,2120,896]],
 ['allies-4','3',[2283,1200,-819]]
];
const sectorNameStrings={};
function originalSector(name){
 if(!sectorNameStrings[name])sectorNameStrings[name]=Memory.allocUtf8String(name);
 return nativeSectorByName(state.manager.add(0xc).readPointer(),sectorNameStrings[name]);
}
function landingPoint(candidate,sector){
 const w=state.manager.add(0xc).readPointer(),c=state.manager.add(0x14).readPointer();
 const worldData=w.add(0x1399c).readPointer();
 if(sector<0||![...candidate].every(Number.isFinite)||nativeGroundPolygon(worldData,sector,candidate[0],candidate[1]+5,candidate[2])===0)return null;
 // Same-level placement keeps the bot within its local walking height range.
 // An airborne player or a different platform can temporarily yield no spawn.
 const y=confirmedGround(w,sector,candidate[0],candidate[1],candidate[2],50);
 if(y===null)return null;
 const p=[candidate[0],y,candidate[2]];
 if(nativeGroundPolygon(worldData,sector,p[0],p[1]+5,p[2])===0)return null;
 // Check body clearance locally, not a ray from the previous spawn through cover.
 for(const h of [35,240])for(const offset of [[65,0],[-65,0],[0,65],[0,-65]]){
  if(nativeWorldRay(c,sector,sector,p[0],p[1]+h,p[2],p[0]+offset[0],p[1]+h,p[2]+offset[1])!==0)return null;
 }
 return p;
}
function sight(from,to,fromSector,toSector,height){
 if(fromSector<0||toSector<0)return false;
 const c=state.manager.add(0x14).readPointer();
 return nativeWorldRay(c,fromSector,toSector,from[0],from[1]+height,from[2],to[0],to[1]+height*.65,to[2])===0;
}
function chooseSpawnPoint(origin,forward,sector,previous){
 const candidates=[],forwardLength=Math.hypot(forward[0],forward[2])||1;
 const fx=forward[0]/forwardLength,fz=forward[2]/forwardLength;
 // Keep encounters local until cross-sector navigation is actually implemented.
 if(P('0x5487d8').readS32()===0&&P('0x5488e8').readS32()===0){
  for(const [id,name,pos] of originalSpawnPoints){
   const distance=Math.hypot(pos[0]-origin[0],pos[2]-origin[2]);
   if(distance>=650&&distance<=1800&&Math.abs(pos[1]-origin[1])<180&&originalSector(name)===sector)
    candidates.push({id,position:pos.slice(),sector,original:true});
  }
 }
 const phase=random(-Math.PI/12,Math.PI/12),radii=[random(650,850),random(950,1250),random(1400,1800)];
 for(let i=0;i<12;i++){
  const angle=phase+i*Math.PI/6,c=Math.cos(angle),s=Math.sin(angle),dx=fx*c-fz*s,dz=fx*s+fz*c;
  for(const radius of radii)candidates.push({id:'radial-'+i+'-'+Math.round(radius),position:[origin[0]+dx*radius,origin[1],origin[2]+dz*radius],sector,original:false});
 }
 const safe=[];let rejected=0;
 // Randomized processing avoids always choosing the first direction.
 for(let i=candidates.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
 for(const candidate of candidates){
  const dx=candidate.position[0]-origin[0],dz=candidate.position[2]-origin[2],distance=Math.hypot(dx,dz);
  const dot=(dx*fx+dz*fz)/distance;
  const repeatDistance=previous?Math.hypot(candidate.position[0]-previous[0],candidate.position[2]-previous[2]):Infinity;
  if(repeatDistance<350){rejected++;continue;}
  const pos=landingPoint(candidate.position,sector);if(!pos){rejected++;continue;}
  const visible=sight(origin,pos,sector,sector,eyeHeight());
  if(dot>.45&&visible){rejected++;continue;}
  // A clear route supports prompt re-engagement. If covered, native local
  // steering may still be blocked; we do not claim these are navigable paths.
  const score=(visible?0:1.2)+(dot<-.2?1:0)+(candidate.original?0.25:0)+random(0,.8)-Math.abs(distance-1100)/1800;
  safe.push({...candidate,position:pos,distance,viewDot:dot,playerLineOfSight:visible,repeatDistance,score});
  if(safe.length>=8)break;
 }
 if(!safe.length){send({event:'bot-spawn-selection-failed',sector,candidates:candidates.length,rejected});return null;}
 safe.sort((a,b)=>b.score-a.score);
 const selected=safe[Math.floor(Math.random()*Math.min(3,safe.length))];
 brain.spawnSerial++;
 send({event:'bot-spawn-selected',selection:brain.spawnSerial,id:selected.id,original:selected.original,sector,
  position:selected.position,distance:selected.distance,viewDot:selected.viewDot,playerLineOfSight:selected.playerLineOfSight,
  previousDistance:Number.isFinite(selected.repeatDistance)?selected.repeatDistance:null,validCandidates:safe.length,rejected});
 return selected;
}
function chooseBotSpawn(origin,forward,sector){
 if(globalThis.KARMA_LOCAL_PAUSED===true)return null;
 const selected=chooseSpawnPoint(origin,forward,sector,brain.lastSpawn);
 if(!selected)return null;
 brain.lastSpawn=selected.position.slice();
 send({event:'bot-spawn-candidate',position:selected.position,sector,distance:selected.distance});
 return selected.position;
}
function botSpawnYaw(origin,position){return Math.atan2(-(origin[2]-position[2]),origin[0]-position[0]);}
function publishBotFrame(position,yaw,pitch,moving){
 const b=state.bot,height=Math.round(eyeHeight());
 // Wire pitch is radians; actor model pitch is degrees with the original
 // 0.175-radian model bias (0x451353..0x451368).
 setYaw(state.manager,1,yaw);b.add(0x19bc).writeFloat((pitch+0.175)*180/Math.PI);
 b.add(0x1bf0).writeFloat(yaw);b.add(0x1bf4).writeFloat(pitch);
 b.add(0x1bd8).writeU8(b.add(0x290).readU8());
 b.add(0x1bd9).writeU8(0x80);
 b.add(0x1bda).writeByteArray([0,0,0,0,0,0]);
 b.add(0x1be3).writeU8(0);b.add(0x1be4).writeU8(moving?5:4);
 b.add(0x1be5).writeU8(b.add(0x1972).readU8());
 b.add(0x1be6).writeU8(b.add(0x1b44).readS32()&255);b.add(0x1be8).writeU16(height);
 copy(b.add(0x1b20),b.add(0x1a40),12);
 putvec(b,0x1bf8,[position[0],position[1]+height,position[2]]);
 b.add(0x1bec).writeS32(0);
 const action=moving?5:4;
 if(b.add(0x1971).readU8()!==action)nativeBodyAction(b,action);
 b.add(0x1bd4).writeS32(1);
}
function movementParameters(){
 return learning()?learning().parameters():{preferredRange:800,speedScale:1,strafeWeight:.5,pauseChance:.14,lateralBias:0};
}
function chooseBehavior(now,range,visible,parameters){
 const side=Math.random()<.5+parameters.lateralBias?-1:1;
 const pause=visible&&Math.random()<parameters.pauseChance;
 let forward=visible?(range>parameters.preferredRange+170?1:range<parameters.preferredRange-150?-0.8:random(-.18,.18)):0.85;
 let strafe=visible?side*parameters.strafeWeight:side*random(.15,.65);
 if(pause){forward=0;strafe=0;}
 const behavior={until:now+random(pause?250:650,pause?650:1700),forward,strafe,searchOffset:random(-1.4,1.4),kind:pause?'pause':forward<-.3?'retreat':forward>.6?'approach':'strafe'};
 send({event:'bot-behavior',kind:behavior.kind,durationMs:Math.round(behavior.until-now),forward,strafe,visible,preferredRange:Math.round(parameters.preferredRange)});
 return behavior;
}
function thinkBot(){
 if(globalThis.KARMA_LOCAL_PAUSED===true){aiPauseChanged(true);return;}
 aiPauseChanged(false);
 if(!AI_PROBE.think || !state.spawned)return;
 rememberSpawn();
 const now=aiNow(),m=state.manager,b=state.bot,p=state.player;
 if(hp(b)<=0){
  brain.queuedShot=null;
  if(!brain.botDeadAt){brain.botDeadAt=now;brain.kills++;send({event:'bot-dead',kills:brain.kills});}
  if(AI_PROBE.respawn && now-brain.botDeadAt>AI_PROBE.respawnMs)respawnBot();
  if(learning())learning().resetSample();
  return;
 }
 if(hp(p)<=0){
  brain.queuedShot=null;brain.visible=false;brain.lastSeenPosition=null;
  if(!brain.playerDeadAt){brain.playerDeadAt=now;brain.deaths++;send({event:'player-dead',deaths:brain.deaths});}
  if(AI_PROBE.respawn && !globalThis.KARMA_OFFLINE_DEATH_HELPER && now-brain.playerDeadAt>AI_PROBE.respawnMs)respawnPlayer();
  if(learning())learning().resetSample();
  return;
 }
 if(brain.playerDeadAt){
  brain.lastFire=now;brain.nextFireAt=now+1800;brain.reactionUntil=now+900;
  brain.queuedShot=null;
  if(learning())learning().resetSample();
  send({event:'player-respawn-grace',until:brain.nextFireAt,minimumMs:1800});
 }
 brain.playerDeadAt=0;
 if(now-brain.lastThink<100)return;
 const dt=clamp((now-brain.lastThink)/1000,0,0.15);brain.lastThink=now;
 const pp=vec(p,0x1a40),bp=vec(b,0x1a40),dx=pp[0]-bp[0],dz=pp[2]-bp[2],range=Math.hypot(dx,dz),height=eyeHeight();
 const sector=b.add(0x1b44).readS32(),playerSector=p.add(0x1b44).readS32();
 if(![...pp,...bp,range,height].every(Number.isFinite))return;
 if(brain.aimYaw===null)brain.aimYaw=b.add(0x19b8).readFloat();
 const targetYaw=Math.atan2(-dz,dx),facing=Math.abs(angleDelta(targetYaw,brain.aimYaw))<Math.PI*.56;
 // Perception is constrained by the original wall trace and a forward view.
 // Close contact is noticed from either side; hidden positions are not chased.
 const visible=range<6500&&(facing||range<350)&&sight(bp,pp,sector,playerSector,height);
 if(visible){
  if(!brain.visible){
   brain.reactionUntil=now+random(350,800);brain.behavior=null;
   send({event:'bot-target-acquired',range:Math.round(range),reactionMs:Math.round(brain.reactionUntil-now)});
  }
  brain.lastSeenAt=now;brain.lastSeenPosition=pp.slice();brain.lastSeenSector=playerSector;
 }else if(brain.visible){
  brain.queuedShot=null;brain.behavior=null;
  send({event:'bot-target-lost',range:Math.round(range)});
 }
 brain.visible=visible;
 const recent=brain.lastSeenPosition&&now-brain.lastSeenAt<3500;
 const target=visible?pp:recent?brain.lastSeenPosition:null;
 const model=learning();
 if(model)model.sample(now,pp,bp,playerSector,visible&&range<=2400);
 profileEvent();
 const parameters=movementParameters();
 if(!brain.behavior||brain.behavior.until<=now)brain.behavior=chooseBehavior(now,range,visible,parameters);
 const behavior=brain.behavior;
 let position=bp,moving=false;
 if(AI_PROBE.move){
  const chaseYaw=target?Math.atan2(-(target[2]-bp[2]),target[0]-bp[0]):brain.aimYaw+behavior.searchOffset;
  const ux=Math.cos(chaseYaw),uz=-Math.sin(chaseYaw);
  // Short choices, pauses and spacing replace the previous periodic orbit.
  // Local collision-checked steering is not a map-wide route planner.
  const vx=ux*behavior.forward-uz*behavior.strafe,vz=uz*behavior.forward+ux*behavior.strafe;
  const length=Math.hypot(vx,vz),scale=clamp(AI_PROBE.speed,0,600)*parameters.speedScale*dt*(target?1:.55);
  if(length>.05&&scale>0){
   const desired=Math.atan2(vz,vx),side=behavior.strafe<0?-1:1;
   for(const offset of [0,side*Math.PI/4,-side*Math.PI/4,side*Math.PI/2]){
    const heading=desired+offset,step=validStep(bp,[bp[0]+Math.cos(heading)*scale,bp[1],bp[2]+Math.sin(heading)*scale],sector);
    if(step){position=step;moving=true;break;}
   }
   if(!moving){brain.moveBlocked++;behavior.until=Math.min(behavior.until,now+200);}
  }
 }
 let desiredYaw=brain.aimYaw+behavior.searchOffset*.5,desiredPitch=0;
 if(target){
  const tx=target[0]-position[0],tz=target[2]-position[2],ty=target[1]+height*.65-(position[1]+height);
  desiredYaw=Math.atan2(-tz,tx);desiredPitch=Math.atan2(ty,Math.max(1,Math.hypot(tx,tz)));
 }
 brain.aimYaw=turnToward(brain.aimYaw,desiredYaw,2.8*dt);
 brain.aimPitch+=clamp(clamp(desiredPitch,-.7,.7)-brain.aimPitch,-1.6*dt,1.6*dt);
 publishBotFrame(position,brain.aimYaw,brain.aimPitch,moving);
 const aligned=Math.abs(angleDelta(desiredYaw,brain.aimYaw))<.10&&Math.abs(desiredPitch-brain.aimPitch)<.10;
 if(AI_PROBE.botFire&&visible&&aligned&&now>=brain.reactionUntil&&now>=brain.nextFireAt&&now-brain.lastFire>=AI_PROBE.fireMs&&now-brain.startedAt>3000&&range<2400){
  brain.lastFire=now;brain.nextFireAt=now+Math.max(350,AI_PROBE.fireMs*random(.9,1.3));
  // Bounded random aim error preserves an opportunity to evade. The original
  // collision routine, including wall occlusion, still decides the bullet hit.
  const error=clamp(AI_PROBE.aimError,0,.3);
  brain.queuedShot={yaw:brain.aimYaw+random(-error,error),pitch:brain.aimPitch+random(-error*.5,error*.5),height,createdAt:now};
 }
}
function fireBot(){
 if(globalThis.KARMA_LOCAL_PAUSED===true){aiPauseChanged(true);return;}
 const shot=brain.queuedShot;brain.queuedShot=null;
 if(!shot||!AI_PROBE.botFire||!state.spawned||hp(state.bot)<=0||hp(state.player)<=0||aiNow()-shot.createdAt>500)return;
 const m=state.manager,b=state.bot,p=state.player,weapon=b.add(0x290).readU8(),pos=vec(b,0x1a40),dir=shotDirection(shot.yaw,shot.pitch);
 // Recheck visibility immediately before invoking the native shot, since the
 // player can move between the tick's decision and this onLeave callback.
 if(!sight(pos,vec(p,0x1a40),b.add(0x1b44).readS32(),p.add(0x1b44).readS32(),shot.height))return;
 const oldIndex=m.add(0x1064).readS32(),oldActor=m.add(0x1050).readPointer(),saved=m.add(0x109c).readByteArray(20);
 let valid=0,hit=0;
 try{
  m.add(0x1064).writeS32(1);m.add(0x1050).writePointer(b);
  // 50 is the native muzzle offset at 0x52c664 used by the original player.
  nativeHitscan(m,1,weapon,pos[0]+dir[0]*50,pos[1]+shot.height+dir[1]*50,pos[2]+dir[2]*50,dir[0],dir[1],dir[2],b.add(0x1b44).readS32(),b.add(0x1b4c).readS32(),shot.yaw,shot.pitch*180/Math.PI,m.add(0x1760).readU32());
  valid=m.add(0x10ac).readS32();hit=m.add(0x10a8).readU8();
  nativeWeaponAction(b,15);nativeFireEffects(b);
 }finally{
  m.add(0x1064).writeS32(oldIndex);m.add(0x1050).writePointer(oldActor);m.add(0x109c).writeByteArray(saved);
 }
 brain.shots++;
 let after=hp(p),before=after,dead=0;
 if(AI_PROBE.botDamage && valid && (hit>>>4)===0 && (hit&15)>0 && after>0){
  dead=nativeDamage(p,(hit&15)-1,1,weapon,dir[0],dir[1],dir[2],b.add(0x262).readU8(),m.add(0x1140).readS32(),b.add(0x1f0c).readS32());
  after=hp(p);
 }
 send({event:'bot-shot',weapon,shot:brain.shots,valid,hit,playerHpBefore:before,playerHpAfter:after,dead});
}
function fireQueuedPlayerShot(){
 if(globalThis.KARMA_LOCAL_PAUSED===true)return;
 if(brain.nativePlayerShot){
  const result=testNativeShotDispatch.consume();
  if(result){
   const pending=brain.nativePlayerShot;brain.nativePlayerShot=null;
   brain.playerTestShots++;
   send({event:'test-player-shot',...pending,...result,shot:brain.playerTestShots,botHpAfter:hp(state.bot),playerDamageEnabled:AI_PROBE.playerDamage,hookObserved:state.playerHitHooks>pending.hookBefore,hitHookEntries:state.hitHookEntries,dispatch:'native-after-tick'});
  }
  return;
 }
 const request=brain.queuedPlayerShot;brain.queuedPlayerShot=null;
 if(!request)return;
 if(!state.spawned||!state.manager||!state.player||!state.bot){
  send({event:'test-player-shot-skipped',id:request.id,reason:'actors-not-spawned'});return;
 }
 const m=state.manager,p=state.player,b=state.bot;
 if(hp(p)<=0||hp(b)<=0){
  send({event:'test-player-shot-skipped',id:request.id,reason:'actor-dead',playerHp:hp(p),botHp:hp(b)});return;
 }
 const height=eyeHeight(),pp=vec(p,0x1a40),bp=vec(b,0x1a40);
 const eye=[pp[0],pp[1]+height,pp[2]],target=[bp[0],bp[1]+height*0.65,bp[2]];
 const delta=target.map((v,i)=>v-eye[i]),length=Math.hypot(...delta);
 if(!Number.isFinite(length)||length<1){
  send({event:'test-player-shot-skipped',id:request.id,reason:'invalid-distance'});return;
 }
 const dir=delta.map(v=>v/length),origin=eye.map((v,i)=>v+dir[i]*50);
 const yaw=Math.atan2(-dir[2],dir[0]),pitch=Math.atan2(dir[1],Math.hypot(dir[0],dir[2]));
 const weapon=p.add(0x290).readU8(),before=hp(b),hookBefore=state.playerHitHooks;
 if(testNativeShotDispatch){
  brain.nativePlayerShot={id:request.id,weapon,origin,target,direction:dir,botHpBefore:before,hookBefore};
  testNativeShotDispatch.queue(m,[0,weapon,...origin.map(floatBits),...dir.map(floatBits),p.add(0x1b44).readS32(),p.add(0x1b4c).readS32(),floatBits(yaw),floatBits(pitch*180/Math.PI),m.add(0x1760).readU32()]);
  return;
 }
 const oldIndex=m.add(0x1064).readS32(),oldActor=m.add(0x1050).readPointer(),saved=m.add(0x109c).readByteArray(20);
 let valid=0,hit=0;
 try{
  m.add(0x1064).writeS32(0);m.add(0x1050).writePointer(p);
  // Exercises original collision and the same receiver-side damage bridge
  // as an actual player shot. No input, aim, weapon, or camera state is changed.
  nativeHitscan(m,0,weapon,origin[0],origin[1],origin[2],dir[0],dir[1],dir[2],p.add(0x1b44).readS32(),p.add(0x1b4c).readS32(),yaw,pitch*180/Math.PI,m.add(0x1760).readU32());
  valid=m.add(0x10ac).readS32();hit=m.add(0x10a8).readU8();
 }finally{
  m.add(0x1064).writeS32(oldIndex);m.add(0x1050).writePointer(oldActor);m.add(0x109c).writeByteArray(saved);
 }
 brain.playerTestShots++;
 send({event:'test-player-shot',id:request.id,shot:brain.playerTestShots,weapon,origin,target,direction:dir,valid,hit,botHpBefore:before,botHpAfter:hp(b),playerDamageEnabled:AI_PROBE.playerDamage,hookObserved:state.playerHitHooks>hookBefore,hitHookEntries:state.hitHookEntries});
}
Interceptor.attach(P('0x451380'),{onLeave(){if(globalThis.KARMA_LOCAL_PAUSED===true)return;if(AI_PROBE.think)fireBot();fireQueuedPlayerShot();}});
rpc.exports = Object.assign(rpc.exports||{},{
 configure(options){
  for(const key of ['think','move','botFire','botDamage','playerDamage','respawn'])if(typeof options[key]==='boolean')AI_PROBE[key]=options[key];
  for(const key of ['speed','fireMs','aimError','respawnMs'])if(typeof options[key]==='number'&&Number.isFinite(options[key]))AI_PROBE[key]=options[key];
  send({event:'controller-configured',config:AI_PROBE});return AI_PROBE;
 },
 queuePlayerShot(){
  if(Process.mainModule.name.toLowerCase()!=='karmaaiprobe.exe')throw new Error('Synthetic native shots are test-process-only');
  if(brain.queuedPlayerShot||brain.nativePlayerShot)return {accepted:false,reason:'request-already-pending',id:(brain.queuedPlayerShot||brain.nativePlayerShot).id};
  const id=++brain.playerTestRequests;
  brain.queuedPlayerShot={id,requestedAt:Date.now()};
  send({event:'test-player-shot-queued',id});
  return {accepted:true,id};
 },
 status(){return {config:AI_PROBE,brain,player:state.player&&actor(state.player),bot:state.bot&&actor(state.bot)};}
});

// Isolated-test-only dispatch. No input, UI, or runtime production patch.
// Frida suppresses nested Interceptor callbacks for NativeFunction calls made
// inside our tick callback. Execute the queued shot after that callback returns.
const testNativeShotDispatch=(()=>{
 if(Process.mainModule.name.toLowerCase()!=='karmaaiprobe.exe')return null;
 const data=Memory.alloc(0x80),code=Memory.alloc(Process.pageSize);
 data.writeByteArray(new Uint8Array(0x80));
 Memory.protect(code,Process.pageSize,'rwx');
 const bytes=[],u32=value=>{value>>>=0;bytes.push(value&255,(value>>>8)&255,(value>>>16)&255,value>>>24);};
 const emit=(...values)=>bytes.push(...values);
 // Wrapper preserves the native tick's two stack arguments and ret8 contract.
 emit(0xff,0x74,0x24,0x08,0xff,0x74,0x24,0x08,0xb8);u32(0x451380);emit(0xff,0xd0);
 emit(0x9c,0x60,0xbe);u32(data.toUInt32()); // pushfd;pushad;esi=data
 emit(0x83,0x3e,0x01,0x0f,0x85);const skipOffset=bytes.length;u32(0);
 emit(0xc7,0x06);u32(2); // status=executing
 emit(0x8b,0x4e,0x04); // ecx=manager
 emit(0x8b,0x81);u32(0x1064);emit(0x89,0x46,0x08);
 emit(0x8b,0x81);u32(0x1050);emit(0x89,0x46,0x0c);
 for(let i=0;i<5;i++){emit(0x8b,0x81);u32(0x109c+i*4);emit(0x89,0x46,0x10+i*4);}
 emit(0xc7,0x81);u32(0x1064);u32(0);
 emit(0x8b,0x81);u32(0xfcc);emit(0x89,0x81);u32(0x1050);
 for(let i=12;i>=0;i--)emit(0xff,0x76,0x24+i*4);
 emit(0xb8);u32(0x451bd0);emit(0xff,0xd0);
 emit(0x8b,0x4e,0x04);
 emit(0x8b,0x81);u32(0x10ac);emit(0x89,0x46,0x58);
 emit(0x0f,0xb6,0x81);u32(0x10a8);emit(0x89,0x46,0x5c);
 emit(0x8b,0x46,0x08,0x89,0x81);u32(0x1064);
 emit(0x8b,0x46,0x0c,0x89,0x81);u32(0x1050);
 for(let i=0;i<5;i++){emit(0x8b,0x46,0x10+i*4,0x89,0x81);u32(0x109c+i*4);}
 emit(0xc7,0x06);u32(3); // status=complete
 const doneOffset=bytes.length;emit(0x61,0x9d,0xc2,0x08,0x00);
 const delta=doneOffset-(skipOffset+4);
 for(let i=0;i<4;i++)bytes[skipOffset+i]=(delta>>>(i*8))&255;
 code.writeByteArray(bytes);
 const callers=[0x41774b,0x417dd6,0x418a58,0x418da3];
 for(const address of callers){
  const call=P(address),old=new Uint8Array(call.readByteArray(5));
  const displacement=new DataView(old.buffer).getInt32(1,true);
  if(old[0]!==0xe8 || address+5+displacement!==0x451380)throw new Error('Unexpected tick callsite '+call);
 }
 for(const address of callers){
  const relative=(code.toUInt32()-(address+5))|0;
  Memory.patchCode(P(address),5,memory=>memory.writeByteArray([0xe8,relative&255,(relative>>>8)&255,(relative>>>16)&255,relative>>>24]));
  const installed=new Uint8Array(P(address).readByteArray(5));
  const target=(address+5+new DataView(installed.buffer).getInt32(1,true))>>>0;
  if(installed[0]!==0xe8 || target!==code.toUInt32())throw new Error('Dispatcher patch readback mismatch at '+P(address));
 }
 send({event:'test-native-dispatch-ready',code:code.toString(),size:bytes.length,callers:callers.map(a=>P(a).toString())});
 return {
  // Native code pointers referenced only by patched machine code are invisible
  // to the JS collector. Keep both allocations alive for the script's lifetime.
  code,data,
  status(){return data.readU32();},
  queue(manager,arguments13){
   if(data.readU32()!==0)throw new Error('Native test dispatcher is busy');
   if(arguments13.length!==13)throw new Error('Native shot requires13 stack arguments');
   data.add(4).writePointer(manager);
   arguments13.forEach((value,index)=>data.add(0x24+index*4).writeU32(value>>>0));
   data.writeU32(1);
  },
  consume(){
   if(data.readU32()!==3)return null;
   const result={valid:data.add(0x58).readS32(),hit:data.add(0x5c).readU32()};
   data.writeU32(0);return result;
  }
 };
})();

// Original non-hitscan weapons for the one-actor offline controller.
// 461d50 receives shotgun pellet counts; 4570e0 performs original explosion
// radius/occlusion/falloff, then calls461e50. No HP subtraction is implemented here.
const nativePelletDamage=new NativeFunction(P('0x461d50'),'int',
 ['pointer','int','int','int','float','float','float','int','int'],'thiscall');
const nativeBlastActor=new NativeFunction(P('0x4570e0'),'int',['pointer','int','int'],'thiscall');
const nativeBlastFrames=[];
const extendedDamageStats={pelletHits:0,blastChecks:0,blastHits:0};
function applyPlayerPelletHits(m,weapon,direction){
 if(!m.add(0x10a4).readS32())return;
 const count=m.add(0x109c+1).readU8();
 if(!count)return;
 send({event:'native-player-pellets',weapon,slot:1,count});
 if(!AI_PROBE.playerDamage||hp(state.bot)<=0)return;
 const before=hp(state.bot),p=state.player;
 const dead=nativePelletDamage(state.bot,0,count,weapon,direction[0],direction[1],direction[2],
  p.add(0x262).readU8(),m.add(0x1140).readS32());
 extendedDamageStats.pelletHits++;
 if(typeof recordOfflineCombatDamage==='function')recordOfflineCombatDamage(1,0,before,hp(state.bot),weapon);
 send({event:'bot-native-pellet-damage',weapon,count,before,after:hp(state.bot),dead});
}
function applyOfflineBlast(frame){
 if(!AI_PROBE.playerDamage||!state.spawned||!state.bot||hp(state.bot)<=0||frame.botChecked)return;
 if(!frame.collision.equals(state.manager.add(0x30).readPointer()))return;
 const projectiles=frame.collision.add(4).readPointer();
 const record=projectiles.add(frame.projectile*0xa8);
 const weapon=record.add(0x8950).readU8(),owner=record.add(0x8951).readU8();
 if(owner!==0)return; // only actual player-owned explosions
 const position=vec(record,0x892c),before=hp(state.bot);
 // cc..e3 are shared local-player impulse scratch, not victim actor fields.
 // Keep the player's original explosion reaction while checking this bot.
 const impulse=frame.collision.add(0xcc).readByteArray(24);
 let accepted=0;
 try{accepted=nativeBlastActor(frame.collision,1,frame.projectile);}
 finally{frame.collision.add(0xcc).writeByteArray(impulse);}
 extendedDamageStats.blastChecks++;
 const after=hp(state.bot);
 if(typeof recordOfflineCombatDamage==='function')recordOfflineCombatDamage(1,owner,before,after,weapon);
 if(after<before)extendedDamageStats.blastHits++;
 send({event:'bot-native-blast',weapon,owner,projectile:frame.projectile,position,
  botPosition:vec(state.bot,0x1a40),accepted,before,after,dead:after<=0});
}
Interceptor.attach(P('0x456ff0'),{
 onEnter(args){
  this.frame={collision:this.context.ecx,projectile:args[0].toInt32(),mode:args[1].toInt32(),botChecked:false};
  nativeBlastFrames.push(this.frame);
 },
 onLeave(){
  const frame=this.frame,index=nativeBlastFrames.lastIndexOf(frame);
  if(index>=0)nativeBlastFrames.splice(index,1);
  applyOfflineBlast(frame);
 }
});
// Avoid a second application if a native sector-wide explosion already visited
// slot1. This also records natural native execution independently of our bridge.
Interceptor.attach(P('0x4570e0'),{
 onEnter(args){
  const slot=args[0].toInt32(),projectile=args[1].toInt32();
  if(slot!==1)return;
  for(const frame of nativeBlastFrames)
   if(frame.projectile===projectile&&frame.collision.equals(this.context.ecx))frame.botChecked=true;
 }
});

// Test-only shot selection uses the existing verified native-after-tick
// dispatcher. It does not equip a weapon or inject keyboard/mouse input.
const weaponShotTest={queued:null,pending:null,sequence:0};
rpc.exports.queueWeaponShot=(weapon=6)=>{
 if(Process.mainModule.name.toLowerCase()!=='karmaaiprobe.exe')throw new Error('Weapon shots are test-process-only');
 if(![4,6,18,19,20,21,22,28,29,30,37,38].includes(weapon))throw new Error('Unsupported test weapon');
 if(weaponShotTest.queued||weaponShotTest.pending||brain.queuedPlayerShot||brain.nativePlayerShot||testNativeShotDispatch.status()!==0)
  return {accepted:false,reason:'request-already-pending'};
 const id=++weaponShotTest.sequence;weaponShotTest.queued={id,weapon};
 return {accepted:true,id,weapon};
};
rpc.exports.extendedDamageStatus=()=>({...extendedDamageStats,weaponShotTest});
Interceptor.attach(P('0x451380'),{onLeave(){
 if(Process.mainModule.name.toLowerCase()!=='karmaaiprobe.exe')return;
 if(weaponShotTest.pending){
  const result=testNativeShotDispatch.consume();
  if(result){
   const pending=weaponShotTest.pending;weaponShotTest.pending=null;
   send({event:'test-native-weapon-shot',...pending,...result,botHpAfter:hp(state.bot),
    hookObserved:state.playerHitHooks>pending.hookBefore,dispatch:'native-after-tick'});
  }
  return;
 }
 if(!weaponShotTest.queued||!state.spawned||hp(state.player)<=0||hp(state.bot)<=0)return;
 const request=weaponShotTest.queued;weaponShotTest.queued=null;
 const m=state.manager,p=state.player,b=state.bot,pp=vec(p,0x1a40),bp=vec(b,0x1a40);
 const height=eyeHeight(),eye=[pp[0],pp[1]+height,pp[2]],pellets=[28,29,30].includes(request.weapon);
 // Rocket/grenade tests aim near the bot's feet so original collision can
 // detonate against the floor. Shotgun tests aim at the torso.
 const target=[bp[0],bp[1]+(pellets?height*0.65:20),bp[2]];
 const delta=target.map((v,i)=>v-eye[i]),length=Math.hypot(...delta);
 if(!Number.isFinite(length)||length<1){send({event:'test-native-weapon-shot-skipped',...request,reason:'invalid-distance'});return;}
 const direction=delta.map(v=>v/length),origin=eye.map((v,i)=>v+direction[i]*50);
 const yaw=Math.atan2(-direction[2],direction[0]),pitch=Math.atan2(direction[1],Math.hypot(direction[0],direction[2]));
 weaponShotTest.pending={...request,origin,target,direction,botHpBefore:hp(b),hookBefore:state.playerHitHooks};
 testNativeShotDispatch.queue(m,[0,request.weapon,...origin.map(floatBits),...direction.map(floatBits),
  p.add(0x1b44).readS32(),p.add(0x1b4c).readS32(),floatBits(yaw),floatBits(pitch*180/Math.PI),m.add(0x1760).readU32()]);
}});
send({event:'extended-native-damage-ready',shotguns:[28,29,30],blastRoutine:'0x4570e0'});

// Original match counters: GM1458+16*slot (kill32), GM1460+16*slot (death16).
// 422e00 consumes a six-byte death report and updates the original scoreboard.
// It does not send packets. Its4220d0 killfeed call returns immediately offline.
const nativeKDReceive=new NativeFunction(P('0x422e00'),'void',['pointer','pointer'],'thiscall');
const nativeKDSort=new NativeFunction(P('0x423980'),'void',['pointer'],'thiscall');
const offlineScore={dead:[false,false],events:0,packet:Memory.alloc(6),lastRows:{}};
function readOfflineScore(){
 if(!state.roster)return null;
 return [0,1].map(slot=>({slot,kills:state.roster.add(0x1458+slot*16).readS32(),
  deaths:state.roster.add(0x1460+slot*16).readU16()}));
}
function countOfflineDeath(victim,attacker,weapon,source){
 if(!state.spawned||!state.roster||victim<0||victim>1||offlineScore.dead[victim])return;
 if(P('0x548d70').readS32()!==1)return;
 const gm=state.roster,m=state.manager,validAttacker=(attacker===0||attacker===1)&&attacker!==victim;
 const before=readOfflineScore(),backend=m.add(0x104c).readPointer();
 let route='native-receiver';
 if(validAttacker&&!backend.isNull()){
  const flags=backend.add(0x36d).readByteArray(2);
  offlineScore.packet.writeByteArray([1,1,attacker,victim,0,weapon&255]);
  // The server receiver also marks the victim's network roster dead. Preserve
  // the offline actor controller's existing roster lifecycle.
  try{nativeKDReceive(gm,offlineScore.packet);}
  finally{backend.add(0x36d).writeByteArray(flags);}
 }else{
  // Environmental/self deaths do not award a kill to the opponent. The
  // receiver's suicide message subtracts kills but omits deaths, so update
  // the exact native display field for this offline-practice case.
  route='offline-death-counter';
  const deaths=gm.add(0x1460+victim*16);
  deaths.writeU16((deaths.readU16()+1)&65535);
  if(validAttacker){
   const kills=gm.add(0x1458+attacker*16);kills.writeS32(kills.readS32()+1);
   route='offline-counters-no-network-roster';
  }
  if(gm.add(0x18bc).readU8()===1)nativeKDSort(gm);
 }
 offlineScore.dead[victim]=true;offlineScore.events++;
 send({event:'offline-score-updated',victim,attacker:validAttacker?attacker:null,weapon,source,route,
  before,after:readOfflineScore(),events:offlineScore.events});
}
function recordOfflineCombatDamage(victim,attacker,before,after,weapon){
 if(before>0&&after<=0)countOfflineDeath(victim,attacker,weapon,'native-combat-damage');
}
// This sees natural engine explosions/environmental damage to the player;
// JS-invoked bot damage is explicitly reported by the shared damage wrappers.
Interceptor.attach(P('0x461e50'),{
 onEnter(args){
  const actor=this.context.ecx;
  this.slot=state.player&&actor.equals(state.player)?0:state.bot&&actor.equals(state.bot)?1:-1;
  if(this.slot<0)return;
  this.actor=actor;this.before=hp(actor);
  const weapon=args[2].toInt32()&255;this.weapon=weapon===255?-1:weapon;
  this.attacker=this.weapon>=0?actor.add(0x1b70).readU8():-1;
 },
 onLeave(){
  if(this.slot>=0)recordOfflineCombatDamage(this.slot,this.attacker,this.before,hp(this.actor),this.weapon);
 }
});
function armOfflineAlive(){
 if(!state.spawned||!state.player||!state.bot)return;
 for(const slot of [0,1])if(hp(slot===0?state.player:state.bot)>0)offlineScore.dead[slot]=false;
}
Interceptor.attach(P('0x451380'),{onEnter(){armOfflineAlive();},onLeave(){
 if(!state.spawned||!state.player||!state.bot)return;
 for(const slot of [0,1]){
  const actor=slot===0?state.player:state.bot;
  if(hp(actor)>0)offlineScore.dead[slot]=false;
  else countOfflineDeath(slot,-1,actor.add(0x1c29).readU8(),'native-frame-death');
 }
}});
// Native scoreboard rows receive level,name,kills,deaths,...,slot. Log only
// changed rows when the original game actually renders that table.
Interceptor.attach(P('0x42f7d0'),{onEnter(args){
 const slot=args[6].toInt32();
 if(slot!==0&&slot!==1)return;
 const kills=args[2].toInt32(),deaths=args[3].toInt32()&65535,key=kills+':'+deaths;
 if(offlineScore.lastRows[slot]===key)return;
 offlineScore.lastRows[slot]=key;
 send({event:'native-scoreboard-row',slot,kills,deaths});
}});
rpc.exports.offlineScoreStatus=()=>({scores:readOfflineScore(),events:offlineScore.events,dead:offlineScore.dead});
send({event:'offline-score-ready',nativeReceiver:'0x422e00',killsOffset:'0x1458',deathsOffset:'0x1460'});
