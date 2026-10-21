// Observe startup failures without changing native API results or game behavior.
(() => {
  const k = Process.getModuleByName('kernel32.dll');
  const missing = [], hooked = new Set();
  let ready = false;
  const emit = data => send({event:'native-startup-diagnostic',...data});
  emit({api:'diagnostics-ready',version:4});
  const stack = context => {
    try { return Thread.backtrace(context, Backtracer.ACCURATE).slice(0,12).map(String); }
    catch { return []; }
  };
  Interceptor.attach(ptr('0x4190d0'), {onEnter(){ ready=true; }});
  for (const name of ['CreateFileA','CreateFileW']) {
    const at=k.findExportByName(name); if(!at)continue;
    Interceptor.attach(at, {
      onEnter(args){
        if(ready)return;
        try { this.file=name.endsWith('W')?args[0].readUtf16String():args[0].readCString(); } catch {}
      },
      onLeave(result){
        if(this.file&&result.equals(ptr(-1))) {
          missing.push({path:this.file.slice(0,260),error:this.lastError});
          if(missing.length>24)missing.shift();
        }
      }
    });
  }
  for (const name of ['ExitProcess','TerminateProcess']) {
    const at=k.findExportByName(name); if(!at)continue;
    Interceptor.attach(at, {onEnter(args){
      if(!ready)emit({api:name,code:args[name==='ExitProcess'?0:1].toUInt32(),stack:stack(this.context),missing});
    }});
  }
  const nt=Process.getModuleByName('ntdll.dll');
  for(const name of ['RtlExitUserProcess','NtTerminateProcess']) {
    const at=nt.findExportByName(name);if(!at)continue;
    Interceptor.attach(at,{onEnter(args){
      if(!ready)emit({api:name,code:args[name==='RtlExitUserProcess'?0:1].toUInt32(),stack:stack(this.context),missing});
    }});
  }
  const box=Process.getModuleByName('user32.dll').findExportByName('MessageBoxA');
  if(box)Interceptor.attach(box,{onEnter(args){
    if(!ready)try{emit({api:'MessageBoxA',text:args[1].readCString(),caption:args[2].readCString()});}catch{}
  }});
  const watchD3d = module => {
    if(!/^d3d[89]\.dll$/i.test(module.name))return;
    const factory=module.findExportByName(module.name.toLowerCase()==='d3d8.dll'?'Direct3DCreate8':'Direct3DCreate9');
    if(!factory||hooked.has(String(factory)))return;hooked.add(String(factory));
    Interceptor.attach(factory,{onLeave(object){
      if(object.isNull()){emit({api:'Direct3DCreate',result:'null'});return;}
      const version=module.name.toLowerCase()==='d3d8.dll'?8:9;
      const create=object.readPointer().add((version===8?15:16)*Process.pointerSize).readPointer();
      if(hooked.has(String(create)))return;hooked.add(String(create));
      Interceptor.attach(create,{
        onEnter(args){ this.adapter=args[1].toUInt32();this.deviceType=args[2].toUInt32(); },
        onLeave(result){ emit({api:'CreateDevice',version,adapter:this.adapter,deviceType:this.deviceType,hresult:String(result)}); }
      });
    }});
  };
  Process.attachModuleObserver({onAdded:watchD3d});
})();
