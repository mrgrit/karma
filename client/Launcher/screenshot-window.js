'use strict';
// Original F12 uses a DISPLAY DC with a hardcoded (0,0) source. Limit the
// correction to that capture routine; leave gameplay rendering untouched.
(() => {
  const capture=ptr('0x4e2670'),blitReturn=ptr('0x4e26cd');
  const bytes=Array.from(new Uint8Array(capture.readByteArray(3)));
  if(bytes.join(',')!=='131,236,64')throw Error('Unknown screenshot capture instructions');
  const user=Process.getModuleByName('user32.dll'),gdi=Process.getModuleByName('gdi32.dll');
  const api=(name,ret,args)=>new NativeFunction(user.getExportByName(name),ret,args,'stdcall');
  const clientRect=api('GetClientRect','int',['pointer','pointer']);
  const toScreen=api('ClientToScreen','int',['pointer','pointer']);
  const dpiAddress=user.findExportByName('SetThreadDpiAwarenessContext');
  const setDpi=dpiAddress?new NativeFunction(dpiAddress,'pointer',['pointer'],'stdcall'):null;
  const captures=new Map();
  Interceptor.attach(capture,{
    onEnter(args){
      this.thread=Process.getCurrentThreadId();this.previous=captures.get(this.thread);
      captures.delete(this.thread);
      const hwnd=ptr('0x548d50').readPointer();if(hwnd.isNull())return;
      const rect=Memory.alloc(16),origin=Memory.alloc(8);let previousDpi=null;
      try{
        if(setDpi)previousDpi=setDpi(ptr(-4));
        if(!clientRect(hwnd,rect))return;
        origin.writeS32(0);origin.add(4).writeS32(0);
        if(!toScreen(hwnd,origin))return;
        const width=rect.add(8).readS32()-rect.readS32(),height=rect.add(12).readS32()-rect.add(4).readS32();
        if(width<=0||height<=0||width>16384||height>16384)return;
        const area={x:origin.readS32(),y:origin.add(4).readS32(),width,height};
        args[1]=ptr(width);args[2]=ptr(height);captures.set(this.thread,area);
        send({event:'screenshot-client-area',...area});
      }finally{if(setDpi&&previousDpi&&!previousDpi.isNull())setDpi(previousDpi);}
    },
    onLeave(){if(this.previous)captures.set(this.thread,this.previous);else captures.delete(this.thread);}
  });
  Interceptor.attach(gdi.getExportByName('BitBlt'),{
    onEnter(args){
      if(!this.returnAddress.equals(blitReturn))return;
      const area=captures.get(Process.getCurrentThreadId());if(!area)return;
      args[7]=ptr(area.x);args[8]=ptr(area.y);
    }
  });
  send({event:'screenshot-client-area-ready',version:1});
})();
