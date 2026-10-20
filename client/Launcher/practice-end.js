// Local practice results remain visible briefly, then return to the launcher.
(() => {
  const exitToLauncher=globalThis.KARMA_LOCAL_REQUEST_EXIT;
  if(typeof exitToLauncher!=='function')throw Error('Practice completion requires input compatibility v7');
  const address=ptr('0x418770'),expected=[0x83,0xec,0x1c,0x53,0x55,0x56];
  const actual=Array.from(new Uint8Array(address.readByteArray(expected.length)));
  if(actual.some((value,index)=>value!==expected[index]))throw Error('Unsupported practice result function');
  const gameClock=new NativeFunction(ptr('0x52c36c').readPointer(),'uint',[],'stdcall');
  let enteredAt=0,finished=false,frames=0;
  Interceptor.attach(address,{
    onEnter(){
      this.practice=ptr('0x548764').readS32()===5;
      if(!this.practice||finished)return;
      if(!enteredAt){
        enteredAt=gameClock();
        send({event:'practice-results-open',returnAfterMs:5000});
      }
      frames++;
    },
    onLeave(){
      if(!this.practice||finished||!enteredAt||((gameClock()-enteredAt)>>>0)<5000)return;
      finished=true;
      send({event:'practice-results-finished',elapsedMs:(gameClock()-enteredAt)>>>0,frames});
      exitToLauncher('practice-complete');
    }
  });
  send({event:'practice-completion-ready',returnAfterMs:5000});
})();
