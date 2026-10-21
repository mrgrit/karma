// Karma 290 stores ANSI Korean names in the roster and in each actor separately.
// Self Mode seeds slot zero with "KampGrupe"; replace both before HUD creation.
(() => {
  const cfg = globalThis.KARMA_LAN_CONFIG;
  const convert = new NativeFunction(Process.getModuleByName('kernel32.dll').getExportByName('WideCharToMultiByte'),
    'int', ['uint','uint','pointer','int','pointer','int','pointer','pointer'], 'stdcall');
  const names = new Map();
  function encoded(value) {
    const name = Array.from(String(value || 'Player').replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0,32).join('') || 'Player';
    if (names.has(name)) return names.get(name);
    const wide = Memory.allocUtf16String(name), output = Memory.alloc(256);
    output.writeByteArray(new Uint8Array(256));
    const count = convert(949,0,wide,-1,output,256,ptr(0),ptr(0));
    if (count < 1 || count > 256) throw Error('Cannot encode player name');
    const bytes = output.readByteArray(count);
    names.set(name,bytes);
    return bytes;
  }
  globalThis.KARMA_WRITE_PLAYER_NAME = (target,value) => {
    const bytes = encoded(value);
    target.writeByteArray(new Uint8Array(256));
    target.writeByteArray(bytes);
  };
  Interceptor.attach(ptr('0x420560'), {
    onEnter(){this.gm=this.context.ecx;},
    onLeave(result){
      if (!result.toInt32()) return;
      const gm=this.gm, manager=gm.add(0xc).readPointer();
      const local=cfg?.local?.character?.name || globalThis.KARMA_ACCOUNT_PROFILE?.name || 'Player';
      const roster=[local,...(cfg?.peers || [cfg?.remoteHello]).filter(Boolean).map(p=>p.config?.character?.name || p.config?.name || 'Player')];
      for (let i=0;i<Math.min(8,roster.length);i++) {
        globalThis.KARMA_WRITE_PLAYER_NAME(gm.add(0x166+i*0x100),roster[i]);
        if (!manager.isNull()) {
          const actor=manager.add(0xfcc+i*4).readPointer();
          if (!actor.isNull()) globalThis.KARMA_WRITE_PLAYER_NAME(actor.add(0x160),roster[i]);
        }
      }
      send({event:'account-names-applied',players:roster.length,encoding:'CP949'});
    }
  });
})();
