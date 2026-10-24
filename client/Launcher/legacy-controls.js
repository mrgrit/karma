// The original T shortcut reads the retired online backend at 0x561850.
// LAN/practice have no such backend. Take its normal key-up cleanup path
// instead, without changing DirectInput, movement, mouse, Esc or F10.
(() => {
  const address = ptr('0x419808');
  const original = Array.from(new Uint8Array(address.readByteArray(2)));
  if (original[0] !== 0x74 || original[1] !== 0x40)
    throw Error('Unknown legacy T shortcut instructions');
  Memory.patchCode(address, 2, code => code.writeByteArray([0xeb, 0x40]));
  send({event:'legacy-shortcut-guard-ready',key:'T',version:1});
})();

// Quick grenade (MOUSE3 / configurable GENERADE action) checks the retired
// online account's feature flag before the native inventory/ammo checks.
// That account pointer is null in LAN/practice. Skip only the online flag;
// keep the original cooldown, grenade selection, ammo and throw animation.
(() => {
  const address = ptr('0x419b4c');
  const expected = [0xa1,0x50,0x18,0x56,0x00,0x8a,0x88,0x3e,0x11,0x00,0x00,0x84,0xc9,0x74,0x52];
  const original = Array.from(new Uint8Array(address.readByteArray(expected.length)));
  if (!original.every((value,index)=>value===expected[index]))
    throw Error('Unknown legacy quick-grenade instructions');
  Memory.patchCode(address, expected.length, code => code.writeByteArray(Array(expected.length).fill(0x90)));
  send({event:'legacy-shortcut-guard-ready',key:'quick-grenade',version:1});
})();

// The original F2 panel has missing texture objects in LAN/practice.
// Bypass that panel and route its key edge to the supported external menu.
(() => {
  const at=ptr('0x419726'),bytes=new Uint8Array(at.readByteArray(2));
  if(bytes[0]!==0x74||bytes[1]!==0x46)throw Error('Unknown F2 panel branch');
  Memory.patchCode(at,2,p=>p.writeByteArray([0xeb,0x46]));
  let held=false;
  Interceptor.attach(at,{onEnter(){
    const down=(this.context.eax.toUInt32()&255)!==0;
    if(down&&!held&&typeof globalThis.KARMA_LOCAL_MENU_COMMAND==='function'){
      globalThis.KARMA_LOCAL_MENU_COMMAND('pause');send({event:'legacy-f2-menu'});
    }
    held=down;
  }});
  send({event:'legacy-shortcut-guard-ready',key:'F2',version:1});
})();
