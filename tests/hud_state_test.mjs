import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeHudHint,createHudStateWriter} from '../client/Launcher/hud-state.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'karma-hud-'));
const file=path.join(dir,'loot-hint.json');
let holder;
try {
  assert(writeHudHint(file,{message:'first'}));
  const writer=createHudStateWriter(file);
  if(process.platform==='win32') {
    // Reproduce File.ReadAllText's FileShare.Read with a real Windows handle.
    holder=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      '$s=[IO.File]::Open($env:KARMA_TEST_HINT,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::WriteLine("locked"); [Console]::ReadLine() | Out-Null } finally { $s.Dispose() }'],
      {windowsHide:true,env:{...process.env,KARMA_TEST_HINT:file},stdio:['pipe','pipe','inherit']});
    await Promise.race([once(holder.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Lock timeout')),10000).unref())]);
    assert.throws(()=>fs.writeFileSync(file,'{}'),/EBUSY|EPERM|EACCES/);
    assert.equal(writeHudHint(file,{message:'G pending'}),false);
    assert.equal(writeHudHint(file,{message:'G approved'}),false);
    assert.equal(writer.write({messages:[{id:'chat-1',text:'hello'}],events:[]}),false,'A shared chat reader cannot throw out of a transport callback');
    assert.equal(writer.write({messages:[{id:'chat-1',text:'hello'}],events:[{id:'death-1'}]}),false,'A death during chat retains the latest complete snapshot');
    assert.equal(writer.pending,true);assert.equal(writer.flush(),false);
    const exited=once(holder,'exit');holder.stdin.end('\n');await exited;holder=null;
    assert.equal(writer.flush(),true,'Timer retries even without another chat/death event');
    assert.equal(writer.pending,false);
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{messages:[{id:'chat-1',text:'hello'}],events:[{id:'death-1'}]},'Latest snapshot includes both chat and kill feed');
  }
  assert(writeHudHint(file,{message:'E nearby'}));
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).message,'E nearby');
  assert.equal(writeHudHint(path.join(dir,'missing','hint.json'),{}),false);
  assert(writer.write({phase:'ended'}));assert(writer.flush());
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).phase,'ended');
  console.log('PASS HUD: real Windows reader lock reproduces chat/death write failure; callbacks stay nonfatal; latest state retries after lock release without new events');
} finally {
  if(holder)holder.kill();
  fs.rmSync(dir,{recursive:true,force:true});
}
