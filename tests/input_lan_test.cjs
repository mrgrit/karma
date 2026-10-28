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

// A finished match is the only LAN menu that freezes simulation. It cannot
// resume through focus changes, queued Continue, Esc, F10 or duplicate results.
for(const alreadyPaused of [false,true]){
  const h=harness();h.frame();if(alreadyPaused){h.command('pause');h.windowMessage(0x84a1);}
  h.command('results');h.windowMessage(0x84a1);
  assert.equal(h.retained.flagPage.readU8(),1);assert.equal(h.retained.clockState.readU8(),1);
  assert.equal(h.context.KARMA_LOCAL_PAUSED,true);assert.equal(h.s.cursor,0);assert.equal(h.s.quits,0);
  const clock=h.clock(),acquired=h.acquired();
  h.command('resume');h.command('results');h.windowMessage(0x84a1);
  h.s.rawTick+=1800000;h.s.held.add(0x1b);h.frame();h.windowMessage(0x100,0x79);
  h.s.fg=0x4000;h.frame();h.s.fg=0x3000;h.frame();h.keyboard(0x11,true);h.mouse();
  assert.equal(h.clock(),clock);assert.equal(h.acquired(),acquired);assert.equal(h.s.cursor,0);
  assert.equal(h.events.filter(x=>x.kind==='results-ready').length,1);assert.equal(h.s.quits,0);
  h.command('quit');h.windowMessage(0x84a1);assert.equal(h.s.quits,1);
}

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
  h.windowMessage(0x100,0x79);assert.equal(h.inspect().paused,true);
  h.s.held.add(0x79);h.command('resume');h.windowMessage(0x84a1);
  h.s.held.add(0x79);h.frame();h.keyboard(0x44,true);
  assert.equal(h.inspect().paused,false,'same resume edge cannot reopen menu');
}
// RDP delivered the window message 15ms after the polled press. A frame
// observing release in between used to resume behind a still-open menu.
{
  const h=harness();h.frame();h.keyboard();h.s.held.add(0x79);h.frame();
  h.s.held.clear();h.frame();h.windowMessage(0x104,0x79);
  assert.equal(h.inspect().paused,true,'delayed window edge keeps menu input released');
  assert.equal(h.s.cursor,0);assert.equal(h.events.filter(e=>e.kind==='pause-resumed').length,0);
  h.keyboard(0x11,true);h.mouse();assert.equal(h.bytes.get(0x5051),0);
  h.command('resume');h.windowMessage(0x84a1);assert.equal(h.inspect().paused,false);
}
for(const origin of ['escape','rpc','native']) {
  const h=harness();h.windowMessage(0x100,0x79);
  if(origin==='escape'){h.command('resume');h.windowMessage(0x84a1);h.windowMessage(0x100,0x1b);
    assert.equal(h.s.quits,0);assert.equal(h.events.filter(e=>e.kind==='pause-requested').at(-1).confirmExit,true);
    h.command('quit');h.windowMessage(0x84a1);}
  else if(origin==='rpc'){h.command('quit');h.windowMessage(0x84a1);}
  else h.nativeQuit();
  assert.equal(h.s.quits,1);
  assert.equal(h.inspect().exitRequested,true);
  assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,true);
  assert.equal(h.retained.flagPage.readU8(),1,'only exit stops native frames');
  const acquired=h.acquired();h.frame();h.keyboard();h.mouse();h.command('resume');
  assert.equal(h.s.cursor,0);assert.equal(h.acquired(),acquired);
}
{
  const h=harness();h.context.KARMA_LAN_CONFIG={match:{mode:'tdm'}};
  h.windowMessage(0x100,0x59);
  h.windowMessage(0x414,7); // Original native termination notification.
  h.windowMessage(0x102,0xac00); // Chat text must never enter exit diagnostics.
  h.nativeQuit(0,0x4379ae);
  const event=h.events.find(e=>e.kind==='exit-requested');
  assert.equal(event.source,'native-quit');assert.equal(event.confirmation,false);
  assert.equal(event.inputState.paused,true);assert.equal(event.inputState.matchFinished,false);
  assert.equal(event.nativeOrigin.caller,'0x4379ae');
  assert.equal(event.nativeOrigin.windowMessage.message,0x414);
  assert.equal(event.nativeOrigin.windowMessage.param,7);
  assert(!JSON.stringify(event).includes('44032'),'diagnostics contain no typed chat characters');
  assert.equal(h.s.quits,1);
}
{
  const h=harness();h.command('quit');h.windowMessage(0x84a1);
  const exits=h.events.filter(e=>e.kind==='exit-requested');
  assert.equal(exits.length,1,'native PostQuitMessage cannot overwrite the explicit exit origin');
  assert.equal(exits[0].source,'external-menu');assert.equal(exits[0].nativeOrigin,null);
}
assert.throws(()=>harness('gate'),/Unsupported game dispatcher call/);
console.log('PASS: LAN native frame/clock continuity, independent input pause flag, no world-pause callback, zero polling without reacquire, focus-loss release/foreground recovery, stable cursor counts, short F10/Escape handling and permanent exit release.');

for(const mode of ['duel','dm','tdm'])for(const [vk,scan,channel] of [[0x54,0x14,'all'],[0x0d,0x1c,'all'],[0x59,0x15,'team']])for(const source of ['window','async','directinput']){
  const h=harness();h.context.KARMA_LAN_CONFIG={match:{mode}};h.frame();h.keyboard();
  if(source==='window')h.windowMessage(0x100,vk);
  else if(source==='async'){h.s.held.add(vk);h.frame();}
  else h.keyboard(scan,true);
  const allowed=channel==='all'||mode==='tdm';
  assert.equal(h.inspect().paused,allowed,mode+'/'+channel+'/'+source);
  assert.equal(h.events.filter(e=>e.kind==='pause-requested').length,0,'Chat does not open the pause dialog');
  assert.equal(h.events.filter(e=>e.kind==='chat-requested').length,allowed?1:0);
  assert.equal(h.s.quits,0);
  if(source==='window')assert.equal(h.s.deliveredMessage,0,'Native WM chat shortcut is consumed');
  if(source==='directinput')assert.equal(h.bytes.get(0x5040+scan),0,'Native DI chat shortcut is consumed even for disabled team chat');
  h.windowMessage(0x102,vk+32);assert.equal(h.s.deliveredMessage,0,'Already-translated chat character is consumed');
  if(!allowed)continue;
  const event=h.events.find(e=>e.kind==='chat-requested');
  assert.equal(event.channel,channel);assert.equal(event.hwnd,'0x3000');assert.equal(event.pid,12345);
  assert.equal(event.inputOnly,true);assert.equal(event.worldContinues,true);
  assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,true);assert.equal(h.context.KARMA_LOCAL_PAUSED,false);
  assert.equal(h.retained.flagPage.readU8(),0);assert.equal(h.retained.clockState.readU8(),0);
  const acquired=h.acquired(),keyboardCalls=h.s.keyboardNativeCalls;
  for(let i=0;i<10;i++){
    h.s.rawTick+=100;h.frame();h.keyboard(0x11,true);h.mouse();
    h.windowMessage(0x100,0x57);assert.equal(h.s.deliveredMessage,0,'Queued movement key stays out of original WndProc');
    h.windowMessage(0x102,0x77);assert.equal(h.s.deliveredMessage,0,'Queued typed character stays out of original WndProc');
  }
  assert.equal(h.clock(),2000,'World clock continues while chat is open');
  assert.equal(h.acquired(),acquired);assert.equal(h.s.keyboardNativeCalls,keyboardCalls);
  assert.equal(h.bytes.get(0x5051),0);assert.equal(h.s.cursor,0);
  // Cancel/send uses the same asynchronous, foreground-safe resume contract.
  h.s.fg=0x4000;h.command('resume');h.windowMessage(0x84a1);
  assert.equal(h.inspect().resumePending,true);assert.equal(h.s.cursor,0);
  h.s.fg=0x3000;h.frame();assert.equal(h.inspect().paused,false);
  assert.equal(h.context.KARMA_LOCAL_INPUT_PAUSED,false);assert.equal(h.s.cursor,-2);
  h.frame();h.keyboard(scan,true);assert.equal(h.events.filter(e=>e.kind==='chat-requested').length,1,'Held opener cannot reopen on resume');
}
{
  const h=harness();h.context.KARMA_LAN_CONFIG={match:{mode:'tdm'}};h.frame();h.keyboard();
  h.s.held.add(0x54);h.frame();h.s.held.clear();h.frame();
  h.windowMessage(0x100,0x54);h.windowMessage(0x100,0x59);h.windowMessage(0x104,0x79);
  assert.equal(h.events.filter(e=>e.kind==='chat-requested').length,1,'Delayed/mixed WM edges cannot spawn another window');
  assert.equal(h.events.filter(e=>e.kind==='pause-requested').length,0);
  assert.equal(h.inspect().paused,true);assert.equal(h.s.cursor,0);
  h.command('results');h.windowMessage(0x84a1);
  const clock=h.clock();h.command('resume');h.windowMessage(0x84a1);h.s.rawTick+=10000;
  for(const key of [0x54,0x59,0x1b,0x79]){h.windowMessage(0x101,key);h.windowMessage(0x100,key);}
  assert.equal(h.events.filter(e=>e.kind==='chat-requested').length,1,'Results cannot reopen chat');
  assert.equal(h.retained.flagPage.readU8(),1);assert.equal(h.clock(),clock);assert.equal(h.s.cursor,0);
}
console.log('PASS: T all/Y team chat routing across WM/async/DI, disabled Y absorption, isolated typing, continuing world clock, foreground-safe resume, duplicate requests and terminal results.');

{
 const h=harness('',{remoteMode:true,sensitivity:.25});h.frame();
 h.p(0x54e0).writeS32(800);h.mouse();assert.equal(h.p(0x54e0).readS32(),0,'first reacquire delta discarded');
 h.p(0x54e0).writeS32(100);h.p(0x54e4).writeS32(-100);h.mouse();
 assert.equal(h.p(0x54e0).readS32(),25);assert.equal(h.p(0x54e4).readS32(),-25);
 h.p(0x54e0).writeS32(5000);h.mouse();assert.equal(h.p(0x54e0).readS32(),0,'remote absolute-position spike discarded');
 let sum=0;for(let i=0;i<4;i++){h.p(0x54e0).writeS32(1);h.mouse();sum+=h.p(0x54e0).readS32();}assert.equal(sum,1,'subpixel input preserved');
}
console.log('PASS remote mouse: per-PC scaling, focus reacquire, outlier rejection and fractional input preservation');
