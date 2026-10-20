const fs=require('fs'),vm=require('vm'),assert=require('assert');
// Reuse the v8 Windows/Frida/x86 fixture, without running its single-player
// assertions. The LAN behavior deliberately differs from full world pause.
const fixture=fs.readFileSync('tests/input_pause_test.cjs','utf8').replace(/\r\n/g,'\n');
const marker='\n{\n  const h=harness(),gate=';
const end=fixture.indexOf(marker);
assert(end>0,'shared v8 fixture boundary');
const scope={require,Buffer,console,process:{argv:['node','fixture',process.argv[2]||'client/Launcher/input-lan.js']}};
vm.runInNewContext(fixture.slice(0,end)+'\nglobalThis.makeHarness=harness;',scope);
const harness=scope.makeHarness;

{
  const h=harness();h.frame();
  const ready=h.events.find(e=>e.kind==='input-menu-ready');
  assert.equal(ready.mode,'lan');assert.equal(ready.pausesWorld,false);
  assert.equal(h.context.KARMA_LOCAL_PAUSED,false);
  h.windowMessage(0x104,0x79);
  assert.equal(h.inspect().paused,true);
  assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,true);
  assert.equal(h.context.KARMA_LOCAL_PAUSED,false,'LAN controller remains active');
  assert.equal(h.retained.flagPage.readU8(),0,'native world frames keep running');
  assert.equal(h.retained.clockState.readU8(),0,'clock never enters frozen state');
  assert.equal(h.s.cursor,0);
  const pause=h.events.find(e=>e.kind==='pause-requested');
  assert.equal(pause.inputOnly,true);assert.equal(pause.worldContinues,true);
  assert.equal(pause.hwnd,'0x3000');assert.equal(pause.pid,12345);
  assert.equal(h.calls.filter(c=>c[0]==='ai-pause'||c[0]==='practice-pause').length,0,
    'world pause callbacks are not invoked');
  const acquired=h.acquired(),nativeKeys=h.s.keyboardNativeCalls,nativeMouse=h.s.mouseNativeCalls;
  const cursorCalls=h.calls.filter(c=>c[0]==='show').length;
  for(let frame=0;frame<200;frame++){
    h.s.rawTick+=17;
    h.frame();h.keyboard(0x11,true);
    for(let i=0;i<20;i++)h.bytes.set(0x54e0+i,0xff);
    assert.equal(h.mouse(),0);
    assert.equal(h.retained.flagPage.readU8(),0);
    assert.equal(h.bytes.get(0x5051),0);
    assert(Array.from({length:20},(_,i)=>h.bytes.get(0x54e0+i)).every(x=>x===0));
  }
  assert.equal(h.clock(),4400,'native time continues through the menu');
  assert.equal(h.acquired(),acquired,'paused polls cannot retry native Acquire');
  assert.equal(h.s.keyboardNativeCalls,nativeKeys);assert.equal(h.s.mouseNativeCalls,nativeMouse);
  assert.equal(h.calls.filter(c=>c[0]==='show').length,cursorCalls,'no per-frame cursor count drift');
  h.s.fg=0x4000;h.windowMessage(6,0);h.command('resume');h.windowMessage(0x84a1);
  assert.equal(h.inspect().resumePending,true);assert.equal(h.s.cursor,0);
  h.s.rawTick+=600000;h.frame();
  assert.equal(h.clock(),604400,'background menu does not freeze network/world clock');
  assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,true);
  h.s.fg=0x3000;h.frame();
  assert.equal(h.inspect().paused,false);assert.equal(h.s.cursor,-2);
  assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,false);
  assert.equal(h.context.KARMA_LOCAL_PAUSED,false);
  assert.equal(h.clock(),604400,'resume does not subtract menu time');
  assert.equal(h.retained.clockState.add(8).readU32(),0);
}
{
  const h=harness();h.frame();
  h.s.fg=0x4000;h.windowMessage(6,0);
  const acquired=h.acquired(),nativeKeys=h.s.keyboardNativeCalls,nativeMouse=h.s.mouseNativeCalls;
  h.s.held.add(0x11);
  for(let i=0;i<10;i++){h.frame();h.keyboard(0x11,true);h.mouse();}
  assert.equal(h.inspect().paused,false,'focus loss does not open a menu');
  assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,true);
  assert.equal(h.context.KARMA_LOCAL_PAUSED,false);
  assert.equal(h.retained.flagPage.readU8(),0);
  assert.equal(h.s.cursor,0);assert.equal(h.acquired(),acquired);
  assert.equal(h.s.keyboardNativeCalls,nativeKeys);assert.equal(h.s.mouseNativeCalls,nativeMouse);
  assert.equal(h.bytes.get(0x5051),0);
  h.s.fg=0;h.frame();h.keyboard();h.mouse();
  assert.equal(h.s.cursor,0,'unknown foreground cannot capture');
  h.s.fg=0x3000;h.frame();
  assert.equal(h.s.cursor,-2);assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,false);
  h.keyboard();assert.equal(h.bytes.get(0x5051),128,'keyboard fallback works after focus return');
}
{
  const h=harness();h.frame();h.s.fg=0x4000;
  // No WM_ACTIVATE delivery: the next native frame independently releases.
  h.frame();assert.equal(h.s.cursor,0);assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,true);
  h.s.fg=0x3000;h.frame();assert.equal(h.s.cursor,-2);
}
{
  const h=harness();h.windowMessage(0x100,0x79);
  h.windowMessage(0x100,0x79,0x40000000);
  h.s.held.add(0x79);h.frame();h.keyboard(0x44,true);
  assert.equal(h.inspect().paused,true);
  assert.equal(h.events.filter(e=>e.kind==='pause-requested').length,1);
  h.s.held.clear();h.windowMessage(0x101,0x79,0xc0000000);
  h.windowMessage(0x100,0x79);assert.equal(h.inspect().paused,false);
  h.s.held.add(0x79);h.frame();h.keyboard(0x44,true);
  assert.equal(h.inspect().paused,false,'same resume edge cannot reopen menu');
}
for(const origin of ['escape','rpc','native']) {
  const h=harness();h.windowMessage(0x100,0x79);
  if(origin==='escape')h.windowMessage(0x100,0x1b);
  else if(origin==='rpc'){h.command('quit');h.windowMessage(0x84a1);}
  else h.nativeQuit();
  assert.equal(h.s.quits,1);
  assert.equal(h.inspect().exitRequested,true);
  assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,true);
  assert.equal(h.retained.flagPage.readU8(),1,'only exit stops native frames');
  const acquired=h.acquired();h.frame();h.keyboard();h.mouse();h.command('resume');
  assert.equal(h.s.cursor,0);assert.equal(h.acquired(),acquired);
}
assert.throws(()=>harness('gate'),/Unsupported game dispatcher call/);
console.log('PASS: LAN native frame/clock continuity, independent input pause flag, no world-pause callback, zero polling without reacquire, focus-loss release/foreground recovery, stable cursor counts, short F10/Escape handling and permanent exit release.');
