import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeHudHint} from '../client/Launcher/hud-state.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'karma-hud-'));
const file=path.join(dir,'loot-hint.json');
let holder;
try {
  assert(writeHudHint(file,{message:'first'}));
  if(process.platform==='win32') {
    // Reproduce File.ReadAllText's FileShare.Read with a real Windows handle.
    holder=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      '$s=[IO.File]::Open($env:KARMA_TEST_HINT,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::WriteLine("locked"); [Console]::ReadLine() | Out-Null } finally { $s.Dispose() }'],
      {windowsHide:true,env:{...process.env,KARMA_TEST_HINT:file},stdio:['pipe','pipe','inherit']});
    await Promise.race([once(holder.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Lock timeout')),10000).unref())]);
    assert.throws(()=>fs.writeFileSync(file,'{}'),/EBUSY|EPERM|EACCES/);
    assert.equal(writeHudHint(file,{message:'G pending'}),false);
    assert.equal(writeHudHint(file,{message:'G approved'}),false);
    const exited=once(holder,'exit');holder.stdin.end('\n');await exited;holder=null;
  }
  assert(writeHudHint(file,{message:'E nearby'}));
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).message,'E nearby');
  assert.equal(writeHudHint(path.join(dir,'missing','hint.json'),{}),false);
  console.log('PASS HUD: Windows reader lock reproduces old write failure; hint failure is nonfatal; writes recover');
} finally {
  if(holder)holder.kill();
  fs.rmSync(dir,{recursive:true,force:true});
}
