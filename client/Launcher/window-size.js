// Enlarge this game's window while retaining the original rendering aspect.
(() => {
  // Windowed rendering does not require an enumerated fullscreen resolution.
  // RDP and some modern displays omit 800x600 from that list. Use the current
  // desktop format only when the native windowed initialization requests it.
  const windowedInitializers = new Map();
  Interceptor.attach(ptr('0x416fd0'), {
    onEnter(args) { this.tid=Process.getCurrentThreadId();windowedInitializers.set(this.tid,args[2].toInt32()!==0); },
    onLeave() { windowedInitializers.delete(this.tid); }
  });
  Interceptor.attach(ptr('0x415e50'), {
    onEnter() { this.tid=Process.getCurrentThreadId();windowedInitializers.set(this.tid,ptr('0x539f8c').readU32()===0); },
    onLeave() { windowedInitializers.delete(this.tid); }
  });
  Interceptor.attach(ptr('0x4040a0'), {
    onEnter(args) { this.renderer=this.context.ecx;this.width=args[0].toInt32();this.height=args[1].toInt32();this.windowed=windowedInitializers.get(Process.getCurrentThreadId()); },
    onLeave(result) {
      if(!this.windowed||result.toInt32()!==0)return;
      try {
        const d3d=this.renderer.add(0x38).readPointer();if(d3d.isNull())return;
        const mode=Memory.alloc(16);
        const getMode=new NativeFunction(d3d.readPointer().add(8*4).readPointer(),'int',['pointer','uint','pointer'],'stdcall');
        const status=getMode(d3d,0,mode),format=mode.add(12).readU32();
        if(status<0||![21,22,23,24].includes(format))return;
        result.replace(format);
        send({event:'windowed-display-format-fallback',requested:[this.width,this.height],desktop:[mode.readU32(),mode.add(4).readU32()],format});
      } catch(error) { send({event:'windowed-display-format-error',message:String(error)}); }
    }
  });
  const u=Process.getModuleByName('user32.dll');
  const call=(name,result,args)=>new NativeFunction(u.getExportByName(name),result,args,'stdcall');
  const workArea=call('SystemParametersInfoW','int',['uint','uint','pointer','uint']);
  const getClient=call('GetClientRect','int',['pointer','pointer']);
  const getRect=call('GetWindowRect','int',['pointer','pointer']);
  const getClip=call('GetClipCursor','int',['pointer']);
  const position=call('SetWindowPos','int',['pointer','pointer','int','int','int','int','uint']);
  const area=Memory.alloc(16),client=Memory.alloc(16),window=Memory.alloc(16),clipRect=Memory.alloc(16);
  const rect=memory=>[0,4,8,12].map(offset=>memory.add(offset).readS32());
  let remoteSession=false;try{remoteSession=call('GetSystemMetrics','int',['int'])(0x1000)!==0;}catch{}
  const inputOptions=globalThis.KARMA_INPUT_SETTINGS||{};
  const nativeSize=typeof inputOptions.remoteMode==='boolean'?inputOptions.remoteMode:remoteSession;
  let applied=false,ready=false;
  Interceptor.attach(ptr('0x4190d0'),{onEnter(){
    if(!ready){ready=true;send({event:'game-frame-ready'});}
    if(applied)return;
    if(nativeSize){applied=true;send({event:"remote-display-native-size",size:[800,600]});return;}
    const hwnd=ptr('0x548d50').readPointer();
    if(hwnd.isNull()||!workArea(0x30,0,area,0)||!getClient(hwnd,client)||!getRect(hwnd,window))return;
    const cw=client.add(8).readS32(),ch=client.add(12).readS32();
    if(cw<100||ch<100)return;
    const aw=area.add(8).readS32()-area.readS32(),ah=area.add(12).readS32()-area.add(4).readS32();
    const borderW=window.add(8).readS32()-window.readS32()-cw;
    const borderH=window.add(12).readS32()-window.add(4).readS32()-ch;
    const scale=Math.min((aw*0.85-borderW)/cw,(ah*0.85-borderH)/ch);
    if(scale<=1.05){applied=true;return;}
    const width=Math.round(cw*scale)+borderW,height=Math.round(ch*scale)+borderH;
    const left=area.readS32()+Math.round((aw-width)/2),top=area.add(4).readS32()+Math.round((ah-height)/2);
    const ok=position(hwnd,ptr(0),left,top,width,height,0x14);
    applied=ok!==0;
    getClient(hwnd,client);getRect(hwnd,window);getClip(clipRect);
    send({event:'game-window-enlarged',from:[cw,ch],windowSize:[width,height],scale,result:ok,
      clientRect:rect(client),windowRect:rect(window),clipRect:rect(clipRect)});
  }});
})();
