// Test-only app mode: invisible window, no input devices, no desktop capture.
// Never concatenate this file into the user's normal launcher.
(() => {
  if (Process.mainModule.name.toLowerCase() !== 'karmaaiprobe.exe') {
    throw Error('Unattended test is restricted to KarmaAIProbe.exe');
  }
  const u = Process.getModuleByName('user32.dll'), retained = [];
  const isolatedMutex=Memory.allocUtf8String('KarmaAIProbe-unattended-'+Process.id);
  Interceptor.attach(Process.getModuleByName('kernel32.dll').getExportByName('CreateMutexA'),{
    onEnter(args){
      if(this.returnAddress.equals(ptr('0x43817c')))args[2]=isolatedMutex;
    }
  });
  const replacement = (name, result, args, fn) => {
    const address=u.getExportByName(name);
    const callback=new NativeCallback(fn,result,args,'stdcall');
    retained.push(callback);Interceptor.replace(address,callback);
  };
  replacement('SetFocus','pointer',['pointer'],()=>ptr(0));
  replacement('SetActiveWindow','pointer',['pointer'],()=>ptr(0));
  replacement('SetForegroundWindow','int',['pointer'],()=>0);
  replacement('BringWindowToTop','int',['pointer'],()=>1);
  replacement('ShowCursor','int',['int'],()=>0);
  replacement('ClipCursor','int',['pointer'],()=>1);
  replacement('SetCursor','pointer',['pointer'],()=>ptr(0));
  replacement('SetCapture','pointer',['pointer'],()=>ptr(0));
  replacement('ReleaseCapture','int',[],()=>1);
  for(const name of ['CreateWindowExA','CreateWindowExW']) {
    Interceptor.attach(u.getExportByName(name),{onEnter(a){
      a[0]=ptr(a[0].toUInt32()|0x08000080); // NOACTIVATE | TOOLWINDOW
      a[3]=ptr(a[3].toUInt32()&~0x10000000); // no WS_VISIBLE
    }});
  }
  Interceptor.attach(u.getExportByName('ShowWindow'),{onEnter(a){a[1]=ptr(0);}});
  Interceptor.attach(u.getExportByName('SetWindowPos'),{onEnter(a){
    a[6]=ptr((a[6].toUInt32()|0x94)&~0x40); // HIDEWINDOW | NOACTIVATE | NOZORDER
  }});
  for(const name of ['SetWindowLongA','SetWindowLongW']) {
    Interceptor.attach(u.getExportByName(name),{onEnter(a){
      if(a[1].toInt32()===-20)a[2]=ptr(a[2].toUInt32()|0x08000080);
      if(a[1].toInt32()===-16)a[2]=ptr(a[2].toUInt32()&~0x10000000);
    }});
  }
  for(const [address,offset,size] of [['0x4a7f80',0x40,256],['0x4a80a0',0x4e0,20]]) {
    const expected=[0x83,0xec,0x14,0x53,0x56];
    const actual=Array.from(new Uint8Array(ptr(address).readByteArray(5)));
    if(actual.some((x,i)=>x!==expected[i]))throw Error('Unknown input initializer '+address);
    const callback=new NativeCallback(function(input){
      input.add(address==='0x4a7f80'?4:8).writePointer(ptr(0));
      input.add(offset).writeByteArray(new Uint8Array(size));
      return 0;
    },'int',['pointer','uint','uint'],'thiscall');
    retained.push(callback);Interceptor.replace(ptr(address),callback);
  }
  // Windowed mode avoids the original global hotkey/system-parameter path.
  ptr('0x539f8c').writeS32(0);
  const foreground=new NativeFunction(u.getExportByName('GetForegroundWindow'),'pointer',[],'stdcall');
  const visible=new NativeFunction(u.getExportByName('IsWindowVisible'),'int',['pointer'],'stdcall');
  let emitted=false;
  setInterval(()=>{
    const hwnd=ptr('0x548d50').readPointer(),g=ptr('0x548d5c').readPointer();
    if(hwnd.isNull()||g.isNull())return;
    const input=g.add(0x120).readPointer();
    if(input.isNull())return;
    const keyboard=input.add(4).readPointer(),mouse=input.add(8).readPointer();
    const result={windowVisible:visible(hwnd)!==0,foreground:foreground().equals(hwnd),
      keyboardDevice:keyboard.toString(),mouseDevice:mouse.toString()};
    if(result.windowVisible||result.foreground||!keyboard.isNull()||!mouse.isNull()){
      send({event:'unattended-safety-violation',...result});
    }else if(!emitted){emitted=true;send({event:'unattended-isolation-verified',...result});}
  },500);
  globalThis.KARMA_UNATTENDED_CALLBACKS=retained;
  send({event:'unattended-shim-ready'});
})();
