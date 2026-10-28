import fs from 'node:fs';

// HUD hints are disposable. A reader/antivirus holding the Windows file must
// never terminate the game transport from a Frida message callback.
export function writeHudHint(file, value) {
  try { fs.writeFileSync(file, JSON.stringify(value)); return true; }
  catch { return false; }
}

// Shared UI readers may briefly deny writes on Windows. Keep only the newest
// complete snapshot and retry from the runtime's existing timer; a display file
// is never allowed to throw through a network or native-event callback.
export function createHudStateWriter(file) {
  let pending=null;
  const flush=()=>{
    if(pending===null)return true;
    try { fs.writeFileSync(file,pending);pending=null;return true; }
    catch { return false; }
  };
  return {
    write(value){try{pending=JSON.stringify(value);}catch{return false;}return flush();},
    flush,
    get pending(){return pending!==null;},
  };
}
