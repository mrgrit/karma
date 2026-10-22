const fs=require('fs'),vm=require('vm'),assert=require('assert');
const fixture=fs.readFileSync('tests/input_pause_test.cjs','utf8').replace(/\r\n/g,'\n');
const end=fixture.indexOf('\n{\n  const h=harness(),gate=');
assert(end>0);
for(const file of ['input-lan.js','input-menu.js']) {
  const scope={require,Buffer,console,process:{argv:['node','fixture','client/Launcher/'+file]}};
  vm.runInNewContext(fixture.slice(0,end)+'\nglobalThis.makeHarness=harness;',scope);
  const harness=scope.makeHarness;
  for(const key of [0x1b,0x79]) {
    const h=harness();h.s.held.add(key);
    for(let i=0;i<20;i++){h.frame();h.keyboard(key===0x1b?1:0x44,true);}
    assert.equal(h.s.quits,0,file+': held key on first foreground frame cannot quit');
    assert.equal(h.inspect().paused,false,'held startup key cannot open menu');
    h.s.held.clear();h.frame();h.keyboard();
    h.s.held.add(key);h.frame();
    assert.equal(h.inspect().paused,true,'release then fresh press opens menu');
    assert.equal(h.s.quits,0,'Escape must wait for confirmation');
    assert.equal(h.events.find(e=>e.kind==='pause-requested').confirmExit,key===0x1b);
    h.command('resume');h.windowMessage(0x84a1);h.frame();
    assert.equal(h.inspect().paused,false,'cancel remains debounced while held');
  }
  {
    const h=harness();h.frame(); // Async release must not arm first DI sample.
    for(let i=0;i<10;i++){h.keyboard(1,true);h.frame();}
    assert.equal(h.inspect().paused,false,'independent polled sources need their own release');
    h.keyboard();h.keyboard(1,true);
    assert.equal(h.inspect().paused,true);assert.equal(h.s.quits,0);
    h.command('quit');h.windowMessage(0x84a1);
    assert.equal(h.s.quits,1,'explicit confirmation exits once');
  }
  for(const activate of [false,true]) {
    const h=harness();h.frame();h.keyboard();h.s.fg=0x4000;
    if(activate)h.windowMessage(6,0);else h.frame();
    h.s.held.add(0x1b);h.s.fg=0x3000;
    for(let i=0;i<10;i++){h.frame();h.keyboard(1,true);}
    assert.equal(h.inspect().paused,false,'focus return ignores background-held Esc');
    assert.equal(h.s.quits,0);
  }
  {
    const h=harness();h.s.held.add(0x1b);h.windowMessage(0x100,0x79);
    assert.equal(h.inspect().paused,true,'short F10 still works at startup');
    assert.equal(h.events.find(e=>e.kind==='pause-requested').confirmExit,false,
      'F10 message must not import unrelated stale async Esc');
    assert.equal(h.s.quits,0);
  }
  {
    const h=harness();h.windowMessage(0x100,0x1b);
    assert.equal(h.s.deliveredMessage,0,'stock Escape handler cannot receive key');
    assert.equal(h.events.find(e=>e.kind==='pause-requested').confirmExit,true);
    for(let i=0;i<10;i++)h.windowMessage(0x100,0x1b,0x40000000);
    assert.equal(h.events.filter(e=>e.kind==='pause-requested').length,1);
    assert.equal(h.s.quits,0,'held or repeated Esc cannot confirm');
  }
}
console.log('PASS: startup/focus held keys, per-source release guards, fresh Escape confirmation/cancel, F10 isolation, repeat suppression.');

{
  const scope={require,Buffer,console,process:{argv:['node','fixture','client/Launcher/input-lan.js']}};
  vm.runInNewContext(fixture.slice(0,end)+'\nglobalThis.makeHarness=harness;',scope);
  const harness=()=>{const h=scope.makeHarness();h.context.KARMA_LAN_CONFIG={match:{mode:'tdm'}};return h;};
  for(const [vk,scan,channel] of [[0x54,0x14,'all'],[0x59,0x15,'team']]){
    const h=harness();h.s.held.add(vk);
    for(let i=0;i<10;i++){h.frame();h.keyboard(scan,true);}
    assert.equal(h.inspect().paused,false,'Startup held chat key cannot open a window');
    assert.equal(h.bytes.get(0x5040+scan),0,'Startup held key is still removed from native buffers');
    h.s.held.clear();h.frame();h.keyboard();h.s.held.add(vk);h.frame();
    assert.equal(h.events.filter(e=>e.kind==='chat-requested').length,1);
    assert.equal(h.events.find(e=>e.kind==='chat-requested').channel,channel);
    h.command('resume');h.windowMessage(0x84a1);
    for(let i=0;i<10;i++){h.frame();h.keyboard(scan,true);h.windowMessage(0x100,vk,0x40000000);}
    assert.equal(h.inspect().paused,false,'Repeat/held opener cannot reopen resumed chat');
    h.s.held.clear();h.frame();h.keyboard();h.windowMessage(0x101,vk,0xc0000000);
    h.windowMessage(0x100,vk);assert.equal(h.events.filter(e=>e.kind==='chat-requested').length,2,'Fresh subsequent chat press works');
    for(const activate of [false,true]){
      const f=harness();f.frame();f.keyboard();f.s.fg=0x4000;
      if(activate)f.windowMessage(6,0);else f.frame();
      f.s.held.add(vk);f.s.fg=0x3000;
      for(let i=0;i<10;i++){f.frame();f.keyboard(scan,true);}
      assert.equal(f.inspect().paused,false,'Background-held chat key cannot act on focus return');
    }
    const di=harness();di.frame();
    for(let i=0;i<10;i++){di.keyboard(scan,true);di.frame();}
    assert.equal(di.inspect().paused,false,'An async release cannot arm first held DirectInput sample');
    di.keyboard();di.keyboard(scan,true);assert.equal(di.inspect().paused,true);
    const short=harness();short.s.held.add(0x1b);short.windowMessage(0x100,vk);
    assert.equal(short.events.filter(e=>e.kind==='chat-requested').length,1,'Fresh short WM chat press works before first poll');
    assert.equal(short.events.filter(e=>e.kind==='pause-requested').length,0,'WM chat does not import stale Escape');
    const repeat=harness();repeat.windowMessage(0x100,vk,0x40000000);repeat.s.held.add(vk);repeat.frame();repeat.keyboard(scan,true);
    assert.equal(repeat.inspect().paused,false,'Initial auto-repeat is not a fresh chat press');
    const background=harness();background.s.fg=0x4000;background.windowMessage(0x100,vk);
    assert.equal(background.inspect().paused,false);assert.equal(background.s.deliveredMessage,0,'Background targeted chat is consumed without activation');
  }
}
console.log('PASS: T/Y startup held, independent poll arming, focus return, repeat suppression, fresh short presses and subsequent reopen.');
