import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../native/lan_spectator_game.js',import.meta.url),'utf8')
 .split('// SPECTATOR_STATE_BEGIN')[1].split('// SPECTATOR_STATE_END')[0];
const events=[],clock={value:1000};
const pose={hp:100,pos:[100,200,300],yaw:0,pitch:0,eyeHeight:180,weapon:9,ammo:{9:{magazine:17,reserve:55}}};
const st={ready:true,localDead:true,closed:false};
const peers=[{id:'enemy',index:1,team:1,latest:{...pose}},
 {id:'ally-a',name:'아군 A',index:2,team:0,latest:{...pose}},
 {id:'ally-b',index:3,team:0,config:{character:{name:'Player B'}},latest:{...pose}},
 {id:'dead-ally',index:4,team:0,dead:true,latest:{...pose,hp:0}},
 {id:'left-ally',index:5,team:0,left:true,latest:{...pose}}];
const c=vm.createContext({st,peers,teamMode:true,selfTeam:0,selfId:'self',intermission:false,nextRound:null,
 vector:v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite),
 finite:(v,limit=1e6)=>Number.isFinite(v)&&Math.abs(v)<=limit,
 integer:(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max,
 now:()=>clock.value,send:e=>events.push(e)});
vm.runInContext(source,c);
const run=expr=>vm.runInContext(expr,c),plain=value=>JSON.parse(JSON.stringify(value));
assert.equal(run('spectatorRefresh().id'),'ally-a');
assert.deepEqual(plain(run('spectatorStatus().candidates.map(x=>x.id)')),['ally-a','ally-b']);
assert.equal(run('spectatorStatus().magazine'),17);
assert.equal(run('spectatorStatus().reserve'),55);
assert.equal(run('spectatorStatus().targetName'),'아군 A');
assert(run('spectatorCycle(1).accepted'));
assert.equal(run('spectatorRefresh().id'),'ally-b');
assert.equal(run('spectatorStatus().targetName'),'Player B','Central identity uses character.name');
assert(run('spectatorCycle(1).accepted'));
assert.equal(run('spectatorRefresh().id'),'ally-a','Cycle wraps');
assert(run('spectatorCycle(-1).accepted'));
assert.equal(run('spectatorRefresh().id'),'ally-b','Reverse cycle wraps');
peers[2].dead=true;
assert.equal(run('spectatorRefresh().id'),'ally-a','Target death selects living ally');
peers[1].left=true;
assert.equal(run('spectatorRefresh()'),null);
assert.equal(run('spectatorStatus().active'),false);
assert.equal(run('spectatorStatus().waiting'),true);
assert.equal(events.at(-1).active,false,'Loss of final target emits inactive status');
assert.equal(events.at(-1).targetId,null);
peers[1].left=false;peers[2].dead=false;
run('spectatorRefresh()');st.localDead=false;run('spectatorRefresh()');
assert.equal(run('spectatorStatus().active'),false,'Respawn restores own view');
assert.equal(run('spectatorStatus().waiting'),false);
st.localDead=true;c.intermission=true;run('spectatorRefresh()');
assert.equal(run('spectatorStatus().active'),false,'Round end clears view');
c.intermission=false;c.nextRound={round:2};run('spectatorRefresh()');
assert.equal(run('spectatorStatus().active'),false,'No view during queued respawn');
c.nextRound=null;c.teamMode=false;run('spectatorRefresh()');
assert.equal(run('spectatorStatus().active'),false,'Never spectator in deathmatch');
c.teamMode=true;st.closed=true;run('spectatorRefresh()');
assert.equal(run('spectatorStatus().active'),false,'Closing clears view');
st.closed=false;
const view=plain(run(`spectatorView(${JSON.stringify(pose)})`));
assert.deepEqual(view.eye,[100,380,300]);assert.deepEqual(view.direction,[1,0,0]);
for(const [yaw,pitch,expected] of [[Math.PI/2,0,[0,0,-1]],[0,Math.PI/6,[Math.sqrt(3)/2,.5,0]],[Math.PI,0,[-1,0,0]]]){
 const v=plain(run(`spectatorView(${JSON.stringify({...pose,yaw,pitch,viewFov:.2})})`));
 assert.equal(v.fov,.2,'Scope FOV is retained');
 expected.forEach((e,i)=>assert(Math.abs(v.direction[i]-e)<1e-6));
 v.direction.forEach((e,i)=>assert(Math.abs(v.rotation[i]-e)<1e-6,'Frustum and aim agree'));
}
assert.equal(run('spectatorView(null)'),null);
assert.throws(()=>run('spectatorCycle(0)'),/step/);
run('spectatorRefresh()');const count=events.length;
for(let i=0;i<100;i++)run('spectatorRefresh()');
assert.equal(events.length,count,'Stable spectator status does not flood events');
clock.value+=1001;run('spectatorRefresh()');
assert.equal(events.length,count+1,'Active overlay receives one bounded heartbeat');
peers[1].latest={...pose,hp:64};clock.value+=251;run('spectatorRefresh()');
assert.equal(events.at(-1).hp,64,'Target health updates bounded overlay');
assert.equal(st.localDead,true);assert.deepEqual(pose.pos,[100,200,300]);

// Use the production edge detector with only OS/window and key memory mocked.
// It must never replay a held chat-cursor key after the chat window closes.
const allSource=fs.readFileSync(new URL('../native/lan_spectator_game.js',import.meta.url),'utf8');
const keySource=allSource.slice(allSource.indexOf('function spectatorKeys(){'),allSource.indexOf('function spectatorFail('));
const keys={left:false,right:false,foreground:true};
const hwnd={isNull:()=>false,equals:other=>other===hwnd},otherWindow={equals:()=>false};
const input={isNull:()=>false,add:o=>({readU8:()=>((o===0x10b?keys.left:keys.right)?0x80:0)})};
const app={isNull:()=>false,add:o=>{assert.equal(o,0x120);return {readPointer:()=>input};}};
c.P=address=>({readPointer:()=>address===0x548d5c?app:hwnd});
c.spectatorForeground=()=>keys.foreground?hwnd:otherWindow;
vm.runInContext(keySource,c);
run('spectator.pendingStep=0; spectator.leftHeld=false; spectator.rightHeld=false');
c.KARMA_LOCAL_INPUT_PAUSED=true;keys.left=true;run('spectatorKeys()');
assert.equal(run('spectator.pendingStep'),0,'Arrow while chat open is ignored');
c.KARMA_LOCAL_INPUT_PAUSED=false;run('spectatorKeys()');
assert.equal(run('spectator.pendingStep'),0,'Closing chat does not replay held cursor key');
keys.left=false;run('spectatorKeys()');keys.left=true;run('spectatorKeys()');
assert.equal(run('spectator.pendingStep'),-1,'Fresh arrow edge switches teammate');
run('spectatorKeys()');assert.equal(run('spectator.pendingStep'),-1,'Held arrow does not repeat');
keys.left=false;keys.foreground=false;keys.right=true;run('spectatorKeys()');
assert.equal(run('spectator.pendingStep'),-1,'Background game does not switch');
keys.foreground=true;run('spectatorKeys()');
assert.equal(run('spectator.pendingStep'),-1,'Refocus does not replay held key');
keys.right=false;run('spectatorKeys()');keys.right=true;run('spectatorKeys()');
assert.equal(run('spectator.pendingStep'),0,'Fresh right edge switches forward');
keys.right=false;c.KARMA_LOCAL_PAUSED=true;run('spectatorKeys()');keys.left=true;run('spectatorKeys()');
assert.equal(run('spectator.pendingStep'),0,'Menu pause ignores key');
c.KARMA_LOCAL_PAUSED=false;st.localDead=false;keys.left=false;run('spectatorKeys()');keys.left=true;run('spectatorKeys()');
assert.equal(run('spectator.pendingStep'),0,'Living player cannot cycle spectator');
console.log('PASS spectator team/lifecycle/camera/FOV/status and chat/focus-safe arrow rules.');
