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
