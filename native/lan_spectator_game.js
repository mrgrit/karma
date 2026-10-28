// Included inside lan_game_core's closure. Team spectators borrow only the
// render camera: no local actor is moved, healed, equipped, or made authoritative.
// Native evidence: original Karma.exe SHA256 aa824dda4d48c0304de3e9ab1c6012c542dc280eca93a6d507da9a21c4bbedab.
// 4166d0/416c40 draw after451380/44bfc0;401e90 updates a camera look-at,407780 its
// frustum,406100 its FOV. Only44b6b0 reads1064 for body exclusion/actor drawing.
// The held-weapon renderer46b750 changes live global weapon animation/effects;
// do not call it with a teammate's weapon or swap whole manager/actor objects.

// SPECTATOR_STATE_BEGIN
const spectator={targetId:null,active:false,waiting:false,pendingStep:0,
 leftHeld:false,rightHeld:false,frames:0,lastView:null,lastSentKey:null,
 lastSentAt:0,error:null,render:null,restores:0,renderEntrances:0,lastRenderPath:null,lastSkip:null};
function spectatorCandidates(){
 return peers.filter(p=>p.id!==selfId&&p.team===selfTeam&&!p.left&&!p.dead&&
  p.latest&&p.latest.hp>0&&vector(p.latest.pos)&&finite(p.latest.yaw,1e4)&&
  finite(p.latest.pitch,2)).sort((a,b)=>a.index-b.index);
}
function spectatorEligible(){
 return teamMode&&st.ready&&st.localDead&&!st.closed&&!intermission&&!nextRound&&!spectator.error;
}
function spectatorTarget(){return peers.find(p=>p.id===spectator.targetId)||null;}
function spectatorName(peer){
 return String(peer?.displayName||peer?.name||peer?.config?.displayName||
  peer?.config?.playerName||peer?.config?.name||peer?.config?.character?.name||'팀원').slice(0,96);
}
function spectatorView(pose){
 if(!pose||!vector(pose.pos)||!finite(pose.yaw,1e4)||!finite(pose.pitch,2))return null;
 const pitch=Math.max(-1.55,Math.min(1.55,pose.pitch));
 const cy=Math.cos(pose.yaw),sy=Math.sin(pose.yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 const height=finite(pose.eyeHeight,1000)&&pose.eyeHeight>=30?pose.eyeHeight:300;
 const eye=[pose.pos[0],pose.pos[1]+height,pose.pos[2]],direction=[cy*cp,sp,-sy*cp];
 return {eye,direction,yaw:pose.yaw,pitch,
  fov:finite(pose.viewFov,2.8)&&pose.viewFov>=.03?pose.viewFov:1.3089969389957472,
  // Original rotation order is Rz(pitch) * Ry(yaw); row0 is forward (+X).
  rotation:[cp*cy,sp,-cp*sy,0,-sp*cy,cp,sp*sy,0,sy,0,cy,0,0,0,0,1]};
}
function spectatorStatus(){
 const peer=spectatorTarget(),pose=peer?.latest,weapon=pose?.weapon;
 const ammo=pose?.ammo?.[weapon];
 return {active:spectator.active,targetId:spectator.active?peer?.id??null:null,
  targetName:spectator.active?spectatorName(peer):null,waiting:spectator.waiting,
  hp:spectator.active?pose?.hp??null:null,weapon:spectator.active?weapon??null:null,
  magazine:spectator.active&&integer(ammo?.magazine,0,100000)?ammo.magazine:null,
  reserve:spectator.active&&integer(ammo?.reserve,0,100000)?ammo.reserve:null,
  candidates:spectatorEligible()?spectatorCandidates().map(p=>({id:p.id,name:spectatorName(p)})):[],
  cameraFrames:spectator.frames,cameraRestores:spectator.restores,lastView:spectator.lastView,
  renderEntrances:spectator.renderEntrances,lastRenderPath:spectator.lastRenderPath,lastSkip:spectator.lastSkip,
  heldWeaponMirrored:false,error:spectator.error};
}
function spectatorRefresh(){
 const allowed=spectatorEligible(),options=allowed?spectatorCandidates():[];
 let index=options.findIndex(p=>p.id===spectator.targetId);
 if(index<0)index=0;
 if(options.length&&spectator.pendingStep)index=(index+spectator.pendingStep%options.length+options.length)%options.length;
 spectator.pendingStep=0;
 spectator.targetId=options[index]?.id??null;
 spectator.active=allowed&&!!spectator.targetId;
 spectator.waiting=allowed&&!spectator.active;
 const status=spectatorStatus(),key=JSON.stringify([status.active,status.waiting,status.targetId,
  status.targetName,status.hp,status.weapon,status.magazine,status.reserve,status.error,status.candidates]);
 const changedTarget=spectator.lastSentKey===null||spectator.sentTarget!==status.targetId||
  spectator.sentActive!==status.active||spectator.sentWaiting!==status.waiting;
 const heartbeat=(status.active||status.waiting)&&now()-spectator.lastSentAt>=1000;
 if(heartbeat||key!==spectator.lastSentKey&&(changedTarget||now()-spectator.lastSentAt>=250)){
  spectator.lastSentKey=key;spectator.lastSentAt=now();spectator.sentTarget=status.targetId;
  spectator.sentActive=status.active;spectator.sentWaiting=status.waiting;
  send({event:'lan-spectator',...status});
 }
 return spectatorTarget();
}
function spectatorCycle(step){
 if(step!==-1&&step!==1)throw Error('Spectator step must be -1 or 1');
 if(!spectatorEligible())return {accepted:false,reason:'not-spectating'};
 spectator.pendingStep+=step;return {accepted:true};
}
// SPECTATOR_STATE_END

const spectatorLookAt=new NativeFunction(P(0x401e90),'void',
 ['pointer','pointer','pointer','pointer'],'thiscall');
const spectatorFov=new NativeFunction(P(0x406100),'void',['pointer','float'],'thiscall');
const spectatorProjection=new NativeFunction(P(0x407a70),'void',['pointer','int'],'thiscall');
// Original44b64c sends the camera eye, look-at, frustum, and render sector to
// this portal-visibility walk. It updates world draw lists, not player physics.
const spectatorVisibility=new NativeFunction(P(0x443cd0),'void',
 ['pointer','int','float','float','float','float','float','float','pointer'],'thiscall');
const spectatorForeground=new NativeFunction(Process.getModuleByName('user32.dll').getExportByName('GetForegroundWindow'),
 'pointer',[],'stdcall');
let spectatorSetTransform=null,spectatorSetTransformAddress=null;
function spectatorDevice(camera){return camera.add(4).readPointer().add(0x7dc).readPointer();}
function spectatorTransform(device,type,matrix){
 const address=device.readPointer().add(0x94).readPointer();
 if(!spectatorSetTransformAddress||!address.equals(spectatorSetTransformAddress)){
  spectatorSetTransformAddress=address;
  spectatorSetTransform=new NativeFunction(address,'int',['pointer','uint','pointer'],'stdcall');
 }
 spectatorSetTransform(device,type,matrix);
}
function spectatorKeys(){
 let left=false,right=false,active=false;
 try{
  const app=P(0x548d5c).readPointer(),hwnd=P(0x548d50).readPointer();
  const input=app.isNull()?P(0):app.add(0x120).readPointer();
  if(!input.isNull()){
   // DirectInput DIK_LEFT/RIGHT (0xcb/0xcd), keyboard buffer starts at0x40.
   left=(input.add(0x10b).readU8()&0x80)!==0;
   right=(input.add(0x10d).readU8()&0x80)!==0;
  }
  active=spectatorEligible()&&!globalThis.KARMA_LOCAL_PAUSED&&!globalThis.KARMA_LOCAL_INPUT_PAUSED&&
   !hwnd.isNull()&&spectatorForeground().equals(hwnd);
 }catch(_){}
 // Remember keys while typing/paused, so closing chat cannot replay held arrows.
 if(active){
  if(left&&!spectator.leftHeld&&!right)spectatorCycle(-1);
  if(right&&!spectator.rightHeld&&!left)spectatorCycle(1);
 }
 spectator.leftHeld=left;spectator.rightHeld=right;
}
function spectatorFail(error){
 if(!spectator.error){
  spectator.error=String(error?.message||error).slice(0,240);
  send({event:'lan-spectator-error',message:spectator.error});
 }
 spectatorRefresh();
}
function spectatorRestore(frame){
 if(!frame||frame.restored)return;
 frame.restored=true;
 try{
  // Restore every byte touched by camera projection/view/frustum paths. The
  // range is bounded by original camera fields8..38f, never its device pointer.
  frame.camera.add(8).writeByteArray(frame.bytes);
  if(frame.visibilityChanged)spectatorVisibility(frame.world,frame.originalSector,
   ...vec(frame.camera,0x15c),...vec(frame.camera,0x168),frame.camera.add(0x2ec));
  spectatorTransform(frame.device,2,frame.camera.add(0x44));
  spectatorTransform(frame.device,3,frame.camera.add(0xd4));
  spectatorTransform(frame.device,256,frame.camera.add(0x11c));
  spectator.restores++;
 }finally{if(spectator.render===frame)spectator.render=null;}
}
function spectatorApply(app,peer){
 const camera=app.add(0x124).readPointer(),manager=app.add(0x128).readPointer();
 const skip=reason=>{spectator.lastSkip=reason;return null;};
 if(!st.m||!manager.equals(st.m))return skip('manager-mismatch');
 if(camera.isNull()||!camera.equals(st.m.add(0x1054).readPointer()))return skip('camera-mismatch');
 if(!peer.r||peer.r.isNull()||hp(peer.r)<=0||!integer(peer.index,1,7))return skip('target-actor');
 const view=spectatorView(peer.latest);if(!view)return skip('target-view');
 const world=manager.add(0xc).readPointer();if(world.isNull())return skip('world-unavailable');
 const originalSector=world.add(0x13b38).readS32()>0?world.add(0x13b3c).readS32():st.p.add(0x1b4c).readS32();
 const actorSector=peer.r.add(0x1b4c).readS32();
 const targetSector=safeSector(actorSector)?actorSector:peer.latest.sector;
 if(!safeSector(originalSector)||!safeSector(targetSector))return skip('sector:'+originalSector+'/'+targetSector);
 const frame={camera,manager,world,originalSector,device:spectatorDevice(camera),target:peer.index,
  thread:Process.getCurrentThreadId(),bytes:camera.add(8).readByteArray(0x388),restored:false};
 if(frame.device.isNull())return skip('device-unavailable');
 spectator.render=frame;
 try{
  // World transformation must not inherit a corpse's lean or camera offsets.
  putvec(camera,0x208,[0,0,0]);putvec(camera,0x1b0,[0,0,0]);putvec(camera,0x1bc,[1,1,1]);
  putvec(camera,0x15c,view.eye);putvec(camera,0x168,view.eye.map((v,i)=>v+view.direction[i]));
  putvec(camera,0x174,[0,1,0]);
  view.rotation.forEach((v,i)=>camera.add(0x1c8+i*4).writeFloat(v));
  camera.add(0x264).writeFloat(view.yaw);camera.add(0x268).writeFloat(view.pitch);
  camera.add(0x2e0).writeFloat(view.yaw);camera.add(0x344).writeFloat(peer.latest.eyeHeight||300);
  spectatorLookAt(camera.add(8),camera.add(0x15c),camera.add(0x168),camera.add(0x174));
  spectatorFov(camera,view.fov);spectatorProjection(camera,1);
  spectatorTransform(frame.device,2,camera.add(0x44));
  frame.visibilityChanged=true;
  spectatorVisibility(world,targetSector,...vec(camera,0x15c),...vec(camera,0x168),camera.add(0x2ec));
  spectator.frames++;
  spectator.lastSkip=null;
  spectator.lastView={targetId:peer.id,eye:vec(camera,0x15c),direction:view.direction,
   yaw:view.yaw,pitch:view.pitch,fov:camera.add(0x2c0).readFloat(),sector:targetSector,
   visibleSectors:world.add(0x13b38).readS32(),
   physicalLocalIndex:manager.add(0x1064).readS32(),localHp:hp(st.p),localPos:vec(st.p,0x1a40)};
  return frame;
 }catch(error){spectatorRestore(frame);throw error;}
}
Interceptor.attach(P(0x451380),{
 onLeave(){
  try{spectatorKeys();spectatorRefresh();}catch(error){spectatorFail(error);}
 }
});
for(const renderAddress of [0x4166d0,0x416c40])Interceptor.attach(P(renderAddress),{
 onEnter(){
  this.spectatorFrame=null;
  spectator.renderEntrances++;spectator.lastRenderPath='0x'+renderAddress.toString(16);
  try{
   if(spectator.render)return;
   const peer=spectatorRefresh();
   if(spectator.active&&peer)this.spectatorFrame=spectatorApply(this.context.ecx,peer);
  }catch(error){spectatorFail(error);}
 },
 onLeave(){
  try{spectatorRestore(this.spectatorFrame);}catch(error){spectatorFail(error);}
 }
});
Interceptor.attach(P(0x44b6b0),{
 onEnter(){
  this.spectatorIndex=null;
  const frame=spectator.render;
  if(!frame||frame.restored||frame.thread!==Process.getCurrentThreadId()||!this.context.ecx.equals(frame.manager))return;
  // This function only draws actor bodies. Restore before weapon/HUD drawing
  // and, crucially, before the next simulation/network/input update.
  this.spectatorIndex={manager:frame.manager,index:frame.manager.add(0x1064).readS32()};
  frame.manager.add(0x1064).writeS32(frame.target);
 },
 onLeave(){
  if(this.spectatorIndex)this.spectatorIndex.manager.add(0x1064).writeS32(this.spectatorIndex.index);
 }
});
rpc.exports=Object.assign(rpc.exports||{},{lanspectate:step=>spectatorCycle(step)});
