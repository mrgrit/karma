import fs from 'node:fs';

// HUD hints are disposable. A reader/antivirus holding the Windows file must
// never terminate the game transport from a Frida message callback.
export function writeHudHint(file, value) {
  try { fs.writeFileSync(file, JSON.stringify(value)); return true; }
  catch { return false; }
}
