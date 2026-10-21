const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync(process.argv[2] || 'client/Launcher/input-menu.js', 'utf8');
assert(!source.includes('MessageBox'), 'no game-thread modal UI');
assert(!/new NativeFunction\(.*41a660/.test(source), 'no JS invocation of full dispatcher');
function harness(bad = '') {
  const data = new Map(), bytes = new Map(), hooks = new Map(), replacements = new Map();
  const events = [], calls = [], callbacks = [];
  const s = {cursor: -2, fg: 0x3000, held: new Set(), quits: 0, rawTick: 1000,
    showError: false, keyboardHr: 0, mouseHr: 0, keyboardNativeCalls: 0, mouseNativeCalls: 0};
  class P {
    constructor(n) { this.n = Number(n); }
    add(n) { return new P(this.n + n); }
    isNull() { return this.n === 0; }
    equals(p) { return !!p && this.n === p.n; }
    toInt32() { return this.n | 0; }
    toUInt32() { return this.n >>> 0; }
    toString() { return '0x' + this.n.toString(16); }
    readPointer() { const v = data.get(this.n); return typeof v === 'function' ? v : new P(v || 0); }
    writePointer(value) { data.set(this.n, typeof value === 'function' ? value : value.n); }
    readU8() { return bytes.get(this.n) || 0; }
    writeU8(n) { bytes.set(this.n,n); }
    readU32() { return Buffer.from(new Uint8Array(this.readByteArray(4))).readUInt32LE(); }
    writeU32(n) { const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);this.writeByteArray(b); }
    readByteArray(n) { return Uint8Array.from({length:n}, (_,i)=>this.add(i).readU8()).buffer; }
    writeByteArray(a) { a.forEach((v,i)=>bytes.set(this.n+i,v)); }
    replace(n) { this.n = n; }
  }
  const p = n => new P(typeof n === 'string' ? parseInt(n) : n);
  // Interpret the small uint32 clock stubs directly from their emitted bytes.
  // No game code or real process is executed by this test.
  function runClockAsm(address) {
    let pc=address,eax=0,equal=false;
    for(let step=0;step<30;step++) {
      const op=p(pc).readU8(),next=p(pc+1).readU8();
      if(op===0x80&&next===0x3d) {
        equal=p(p(pc+2).readU32()).readU8()===p(pc+6).readU8();pc+=7;
      } else if(op===0x75) {
        const offset=next<128?next:next-256;pc+=2+(equal?0:offset);
      } else if(op===0xb8) {
        eax=p(pc+1).readU32();pc+=5;
      } else if(op===0xff&&next===0xd0) {
        assert.equal(eax,0xc001,'clock stub calls only original timeGetTime');
        eax=s.rawTick>>>0;pc+=2;
      } else if(op===0x2b&&next===0x05) {
        eax=(eax-p(p(pc+2).readU32()).readU32())>>>0;pc+=6;
      } else if(op===0xa1) {
        eax=p(p(pc+1).readU32()).readU32();pc+=5;
      } else if(op===0xa3) {
        p(p(pc+1).readU32()).writeU32(eax);pc+=5;
      } else if(op===0xc6&&next===0x05) {
        p(p(pc+2).readU32()).writeU8(p(pc+6).readU8());pc+=7;
      } else if(op===0x01&&next===0x05) {
        const dst=p(p(pc+2).readU32());dst.writeU32((dst.readU32()+eax)>>>0);pc+=6;
      } else if(op===0xc3) return eax;
      else throw Error('unexpected clock opcode at '+p(pc)+': '+op.toString(16));
    }
    throw Error('clock stub did not return');
  }
  data.set(0x548d50,0x3000); data.set(0x548d5c,0x4000);
  data.set(0x4120,0x5000); data.set(0x5004,0x6000); data.set(0x5008,0x7000);
  data.set(0x52c36c,0xc001);
  for(const [device,table,base] of [[0x6000,0x8000,0xa000],[0x7000,0x9000,0xb000]]) {
    data.set(device,table); data.set(table+28,base+7); data.set(table+32,base+8);
  }
  p(0x436d01).writeByteArray(bad==='focus' ? [0,0,0,0,0,0,0] : [0x56,0xff,0x15,0x78,0xc2,0x52,0]);
  p(0x437f0c).writeByteArray(bad==='gate' ? [0,0,0,0,0] : [0xe8,0x4f,0x27,0xfe,0xff]);
  const apis = {
    GetForegroundWindow:()=>p(s.fg), GetActiveWindow:()=>p(s.fg),
    GetAsyncKeyState:vk=>s.held.has(vk)?-32768:0,
    MapVirtualKeyExW:(scan,mode)=>{assert.equal(mode,3);return scan;},
    GetKeyboardLayout:()=>p(0x409),
    LoadCursorW:(_,id)=>{assert.equal(id.n,32512);return id;},
    SetCursor:cursor=>{calls.push(['arrow',cursor.n]);return p(0);},
    ShowCursor:show=>{
      assert.equal(typeof show,'number');
      if(s.showError){s.showError=false;throw Error('cursor failure');}
      s.cursor+=show?1:-1;calls.push(['show',show]);return s.cursor;
    },
    ClipCursor:rect=>{assert(rect.isNull());calls.push(['clip']);return 1;},
    PostMessageW:(hwnd,msg,w,l)=>{calls.push(['post',hwnd.n,msg,w.n,l.n]);return 1;},
    PostQuitMessage:()=>{
      const hook=hooks.get('PostQuitMessage');if(hook)hook.onEnter();
      s.quits++;
    }
  };
  let nextAlloc = 0x10000000;
  const context = {
    Process:{
      id:12345,pageSize:4096,pointerSize:4,
      findRangeByAddress:()=>({protection:'r--'}),
      getModuleByName:()=>({getExportByName:n=>n,findExportByName:()=>null})
    },
    NativeFunction:function(address,ret,args,abi) {
      if(typeof address==='string'){assert(apis[address],address);return apis[address];}
      if(address.n===0xc001){assert.equal(ret,'uint');return ()=>s.rawTick>>>0;}
      if(address.n===0x4a81c0){
        assert.equal(abi,'thiscall');
        return input=>{assert.equal(input.n,0x5000);s.keyboardNativeCalls++;return s.keyboardHr;};
      }
      if(address.n===0x4a8220){
        assert.equal(abi,'thiscall');
        return input=>{assert.equal(input.n,0x5000);s.mouseNativeCalls++;return s.mouseHr;};
      }
      if(address.n>=0x10000000) {
        assert.equal(ret,'void');assert.equal(args.length,0);assert.equal(abi,'stdcall');
        return ()=>{runClockAsm(address.n);};
      }
      assert.notEqual(address.n,0x41a660,'full dispatcher is never called from JS');
      return ()=>{calls.push(['device',address.n]);return 0;};
    },
    NativeCallback:function(fn,ret,args,abi){
      assert.equal(ret,'int');assert.deepEqual(Array.from(args),['pointer']);assert.equal(abi,'thiscall');
      callbacks.push(fn);return fn;
    },
    Memory:{
      alloc:n=>{const a=p(nextAlloc);nextAlloc+=n;return a;},
      protect:(a,n,prot)=>{calls.push(['protect',a.n,n,prot]);return true;},
      patchCode:(a,n,fn)=>{assert([5,7].includes(n));fn(a);}
    },
    Interceptor:{
      attach:(a,c)=>{hooks.set(typeof a==='string'?a:a.n,c);return {address:a};},
      replace:(a,c)=>replacements.set(a.n,c)
    },
    rpc:{exports:{existing:()=>1}},
    KARMA_AI_PAUSE_CHANGED:v=>calls.push(['ai-pause',v]),
    KARMA_PRACTICE_PAUSE_CHANGED:v=>calls.push(['practice-pause',v]),
    ptr:p,send:e=>events.push(e)
  };
  vm.runInNewContext(source+
    '\nglobalThis.inspectInput=()=>({exitRequested,paused,resumePending,cursorReleased,cursorIncrements,lastForeground});',
    context);
  const retained=context.KARMA_LOCAL_INPUT_NATIVE;
  function windowMessage(message,param=0,lparam=0,hwnd=0x3000){
    const h=hooks.get(0x436c50),call={},result=p(0);
    const args=[p(hwnd),p(message),p(param),p(lparam)];
    h.onEnter.call(call,args);
    s.deliveredMessage=args[1].toUInt32();
    h.onLeave.call(call,result);return result.n;
  }
  function frame(){hooks.get(retained.gatePage.n).onEnter();}
  function keyboard(scan=-1,down=false,hr=0){
    for(let i=0;i<256;i++)bytes.set(0x5040+i,0);
    if(scan>=0)bytes.set(0x5040+scan,down?128:0);
    s.keyboardHr=hr;return replacements.get(0x4a81c0)(p(0x5000));
  }
  function mouse(){return replacements.get(0x4a8220)(p(0x5000));}
  function acquired(){return calls.filter(c=>c[0]==='device'&&(c[1]===0xa007||c[1]===0xb007)).length;}
  return {s,calls,events,bytes,windowMessage,frame,keyboard,mouse,acquired,p,context,retained,
    requestExit:context.KARMA_LOCAL_REQUEST_EXIT,nativeQuit:apis.PostQuitMessage,
    command:context.rpc.exports.menucommand,
    clock:()=>runClockAsm(data.get(0x52c36c)),inspect:context.inspectInput};
}
{
  const h=harness(),gate=h.retained.gatePage,flag=h.retained.flagPage;
  assert.equal(h.context.rpc.exports.existing(),1,'RPC preserves other helpers');
  const a=Array.from(new Uint8Array(gate.readByteArray(20)));
  assert.deepEqual(a.slice(0,3),[0x9c,0x80,0x3d]);
  assert.equal(Buffer.from(a).readUInt32LE(3),flag.n);
  assert.deepEqual(a.slice(7,12),[0,0x75,6,0x9d,0xe9]);
  assert.equal((gate.n+16+Buffer.from(a).readInt32LE(12))>>>0,0x41a660);
  assert.deepEqual(a.slice(16),[0x9d,0x31,0xc0,0xc3]);
  const call=Buffer.from(new Uint8Array(h.p(0x437f0c).readByteArray(5)));
  assert.equal(call[0],0xe8);
  assert.equal((0x437f11+call.readInt32LE(1))>>>0,gate.n);
  assert.equal(flag.readU8(),0);
  assert(h.retained.clockPage&&h.retained.clockState&&h.retained.pauseClock&&h.retained.resumeClock);
  assert(h.retained.keyboardCallback&&h.retained.mouseCallback);
  assert(h.retained.listeners.length>=3,'all native references retained');
}
{
  const h=harness();h.s.held.add(0x79);h.frame();
  assert.equal(h.inspect().paused,true);assert.equal(h.s.quits,0);
  assert.equal(h.retained.flagPage.readU8(),1);assert.equal(h.context.KARMA_LOCAL_PAUSED,true);
  assert.equal(h.s.cursor,0);
  const event=h.events.find(e=>e.kind==='pause-requested');
  assert.equal(event.hwnd,'0x3000');assert.equal(event.pid,12345);
  assert(h.calls.some(c=>c[0]==='ai-pause'&&c[1]===true));
  assert(h.calls.some(c=>c[0]==='practice-pause'&&c[1]===true));
  const acquired=h.acquired(),keys=h.s.keyboardNativeCalls,mice=h.s.mouseNativeCalls;
  h.keyboard(0x11,true);h.mouse();h.frame();h.frame();
  assert.equal(h.s.keyboardNativeCalls,keys);assert.equal(h.s.mouseNativeCalls,mice);
  assert.equal(h.acquired(),acquired,'pause cannot reacquire');
  assert.equal(h.bytes.get(0x5051),0);
  assert.equal(h.events.filter(e=>e.kind==='pause-requested').length,1,'held F10 does not toggle repeatedly');
  h.s.rawTick=601000;assert.equal(h.clock(),1000,'native game clock frozen for ten minutes');
  h.s.held.clear();h.frame();h.s.held.add(0x79);h.command('resume');h.windowMessage(0x84a1);
  assert.equal(h.inspect().paused,false);assert.equal(h.s.cursor,-2);
  assert.equal(h.retained.flagPage.readU8(),0);
  assert.equal(h.clock(),1000,'resume has no elapsed-time spike');
  h.s.rawTick=601020;assert.equal(h.clock(),1020);
  h.frame();assert.equal(h.inspect().paused,false,'resume key remains debounced');
}
{
  const h=harness();h.keyboard(0x44,true);
  assert.equal(h.inspect().paused,true);assert.equal(h.s.quits,0);
  h.s.fg=0x4000;
  const before=h.calls.length;
  assert.equal(h.command('resume').queued,true);
  assert.equal(h.inspect().resumePending,false,'RPC only enqueues');
  assert.deepEqual(h.calls.slice(before).map(c=>c[0]),['post'],'RPC changes no device or cursor state');
  h.windowMessage(0x84a1);
  assert.equal(h.inspect().paused,true);assert.equal(h.inspect().resumePending,true);
  assert.equal(h.s.cursor,0,'Continue cannot recapture while another app has focus');
  h.s.fg=0;h.frame();assert.equal(h.inspect().paused,true,'unknown foreground cannot resume');
  h.s.fg=0x3000;h.s.rawTick=8000;h.frame();
  assert.equal(h.inspect().paused,false);assert.equal(h.inspect().resumePending,false);
  assert.equal(h.s.cursor,-2);
  assert.equal(h.clock(),1000);
  assert.equal(h.events.filter(e=>e.kind==='pause-resume-pending').length,1);
}
{
  const h=harness();h.s.held.add(0x79);h.frame();
  h.command('quit');assert.equal(h.s.quits,0);h.windowMessage(0x84a1);
  assert.equal(h.s.quits,1);assert.equal(h.inspect().exitRequested,true);
  const acquired=h.acquired();h.command('resume');h.frame();h.keyboard();h.mouse();
  assert.equal(h.acquired(),acquired);assert.equal(h.s.cursor,0);
  assert.equal(h.retained.flagPage.readU8(),1);
}
{
  const h=harness();h.keyboard(1,true);
  assert.equal(h.s.quits,1);assert.equal(h.inspect().paused,false);
  assert.equal(h.inspect().exitRequested,true);
  h.requestExit('duplicate');h.frame();assert.equal(h.s.quits,1);
}
{
  const h=harness();h.s.fg=0x4000;h.s.held.add(0x79);h.frame();h.keyboard(0x44,true);
  assert.equal(h.inspect().paused,false,'background F10 ignored');
  h.s.held.clear();h.s.fg=0x3000;h.frame();h.s.fg=0x4000;
  h.windowMessage(6,0);h.windowMessage(0x1c,0);
  assert.equal(h.s.cursor,0);assert.equal(h.windowMessage(0x20),1);
  h.s.fg=0x3000;h.frame();assert.equal(h.s.cursor,-2,'normal focus return remains balanced');
}
{
  const h=harness();h.command('pause');assert.equal(h.inspect().paused,false);
  h.windowMessage(0x84a1);assert.equal(h.inspect().paused,true);
  h.nativeQuit();assert.equal(h.inspect().exitRequested,true);assert.equal(h.s.quits,1);
  assert.equal(h.s.cursor,0);
}
{
  const h=harness();h.s.showError=true;h.keyboard(1,true);
  assert(h.events.some(e=>e.kind==='exit-release-warning'));assert.equal(h.s.quits,1);
}
{
  const h=harness();h.s.held.add(0x11);h.keyboard();assert.equal(h.bytes.get(0x5051),128);
  h.s.held.clear();h.keyboard();assert.equal(h.bytes.get(0x5051),0);
  h.s.held.add(0x11);h.keyboard(0x39,true);assert.equal(h.bytes.get(0x5051),0);
  assert.equal(h.keyboard(-1,false,-1),-1);h.s.mouseHr=-1;assert.equal(h.mouse(),-1);
}
{
  const h=harness();h.s.rawTick=0xfffffff0;h.command('pause');h.windowMessage(0x84a1);
  h.s.rawTick=0x30;assert.equal(h.clock(),0xfffffff0);
  h.command('resume');h.windowMessage(0x84a1);
  assert.equal(h.clock(),0xfffffff0,'native millisecond wrap handled');
  h.s.rawTick=0x50;assert.equal(h.clock(),0x10);
}
{
  const h=harness();h.s.rawTick=2890537377;
  assert.equal(h.clock(),2890537377,'large odd raw timestamp remains exact');
  h.command('pause');h.windowMessage(0x84a1);
  h.s.rawTick+=349;assert.equal(h.clock(),2890537377);
  h.command('resume');h.windowMessage(0x84a1);
  assert.equal(h.retained.clockState.add(8).readU32(),349,'pause duration has 1ms precision');
  assert.equal(h.clock(),2890537377);
  h.s.rawTick+=1;assert.equal(h.clock(),2890537378,'no 256ms quantization after resume');
  h.command('pause');h.windowMessage(0x84a1);h.s.rawTick+=513;
  h.command('resume');h.windowMessage(0x84a1);
  assert.equal(h.retained.clockState.add(8).readU32(),862);
  assert.equal(h.clock(),2890537378,'multiple pauses accumulate with uint32 precision');
  const event=h.events.find(e=>e.kind==='input-menu-ready');
  assert.equal(event.clockArithmetic,'native-uint32');
}
for(const [down,up] of [[0x100,0x101],[0x104,0x105]]) {
  const h=harness();
  h.windowMessage(down,0x79);
  assert.equal(h.s.deliveredMessage,0,'F10 message consumed before original handler');
  assert.equal(h.inspect().paused,true,'short press works without async key state');
  assert.equal(h.events.find(e=>e.kind==='pause-requested').source,'window-key');
  h.windowMessage(down,0x79,0x40000000);
  assert.equal(h.inspect().paused,true,'autorepeat cannot resume');
  h.s.held.add(0x79);h.frame();
  assert.equal(h.inspect().paused,true,'same async edge cannot resume');
  assert.equal(h.events.filter(e=>e.kind==='pause-requested').length,1);
  h.s.held.clear();h.windowMessage(up,0x79,0xc0000000);
  assert.equal(h.s.deliveredMessage,0,'F10 release consumed');
  h.windowMessage(down,0x79);
  assert.equal(h.inspect().paused,true,'game F10 cannot resume behind the menu');
  h.s.held.add(0x79);h.command('resume');h.windowMessage(0x84a1);
  h.s.held.add(0x79);h.frame();h.keyboard(0x44,true);
  assert.equal(h.inspect().paused,false,'resuming message edge stays latched through async/DI');
  assert.equal(h.events.filter(e=>e.kind==='pause-resumed').length,1);
  h.s.held.clear();h.windowMessage(up,0x79,0xc0000000);h.frame();
  h.windowMessage(down,0x1b);
  assert.equal(h.s.deliveredMessage,0);assert.equal(h.s.quits,1,'short Escape exits immediately');
}
// RDP delivered the window message 15ms after the polled press. A frame
// observing release in between used to resume behind a still-open menu.
{
  const h=harness();h.s.held.add(0x79);h.frame();
  h.s.held.clear();h.frame();h.windowMessage(0x104,0x79);
  assert.equal(h.inspect().paused,true,'delayed window edge keeps menu input released');
  assert.equal(h.s.cursor,0);assert.equal(h.events.filter(e=>e.kind==='pause-resumed').length,0);
  h.keyboard(0x11,true);h.mouse();assert.equal(h.bytes.get(0x5051),0);
  h.command('resume');h.windowMessage(0x84a1);assert.equal(h.inspect().paused,false);
}
for(const origin of ['async','directinput']) {
  const h=harness();h.s.held.add(0x79);
  if(origin==='async')h.frame();else h.keyboard(0x44,true);
  h.windowMessage(0x104,0x79);
  assert.equal(h.inspect().paused,true,'message following '+origin+' cannot double-toggle');
  h.s.held.clear();h.windowMessage(0x105,0x79,0xc0000000);
  h.windowMessage(0x104,0x79,0x40000000);
  assert.equal(h.inspect().paused,true,'repeat alone is never a fresh press');
}
{
  const h=harness();h.s.fg=0x4000;
  h.windowMessage(0x100,0x1b);assert.equal(h.s.quits,0);
  assert.equal(h.s.deliveredMessage,0,'background event cannot enter stock online Escape flow');
  h.windowMessage(0x104,0x79);assert.equal(h.inspect().paused,false);
  h.s.fg=0;h.windowMessage(0x104,0x79);assert.equal(h.inspect().paused,false);
  h.s.fg=0x3000;h.windowMessage(0x104,0x79,0,0x9000);
  assert.equal(h.s.deliveredMessage,0x104);assert.equal(h.inspect().paused,false,'foreign HWND untouched');
  h.windowMessage(0x100,0x57);assert.equal(h.s.deliveredMessage,0x100,'movement keys untouched');
}
assert.throws(()=>harness('focus'),/Unsupported inactive-window focus handler/);
assert.throws(()=>harness('gate'),/Unsupported game dispatcher call/);
console.log('PASS: native gate branch/stack bytes, retained pointers, byte-emulated uint32 clock with large odd timestamps/multiple pauses/wrap, short WM_KEY/SYSKEY edges, autorepeat/async/DI deduplication, foreground/HWND checks, F10 debounce, Escape exit, queued main-thread RPC, both pause notifications, no paused polling/acquire, cursor balance, keyboard fallback and byte guards.');
