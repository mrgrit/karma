// Enlarge this game's window while retaining the original rendering aspect.
(() => {
  const u=Process.getModuleByName('user32.dll');
  const call=(name,result,args)=>new NativeFunction(u.getExportByName(name),result,args,'stdcall');
  const workArea=call('SystemParametersInfoW','int',['uint','uint','pointer','uint']);
  const getClient=call('GetClientRect','int',['pointer','pointer']);
  const getRect=call('GetWindowRect','int',['pointer','pointer']);
  const getClip=call('GetClipCursor','int',['pointer']);
  const position=call('SetWindowPos','int',['pointer','pointer','int','int','int','int','uint']);
  const area=Memory.alloc(16),client=Memory.alloc(16),window=Memory.alloc(16),clipRect=Memory.alloc(16);
  const rect=memory=>[0,4,8,12].map(offset=>memory.add(offset).readS32());
  let applied=false,ready=false;
  Interceptor.attach(ptr('0x4190d0'),{onEnter(){
    if(!ready){ready=true;send({event:'game-frame-ready'});}
    if(applied)return;
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
