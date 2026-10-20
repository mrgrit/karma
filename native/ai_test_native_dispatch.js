// Isolated-test-only dispatch. No input, UI, or runtime production patch.
// Frida suppresses nested Interceptor callbacks for NativeFunction calls made
// inside our tick callback. Execute the queued shot after that callback returns.
const testNativeShotDispatch=(()=>{
 if(Process.mainModule.name.toLowerCase()!=='karmaaiprobe.exe')return null;
 const data=Memory.alloc(0x80),code=Memory.alloc(Process.pageSize);
 data.writeByteArray(new Uint8Array(0x80));
 Memory.protect(code,Process.pageSize,'rwx');
 const bytes=[],u32=value=>{value>>>=0;bytes.push(value&255,(value>>>8)&255,(value>>>16)&255,value>>>24);};
 const emit=(...values)=>bytes.push(...values);
 // Wrapper preserves the native tick's two stack arguments and ret8 contract.
 emit(0xff,0x74,0x24,0x08,0xff,0x74,0x24,0x08,0xb8);u32(0x451380);emit(0xff,0xd0);
 emit(0x9c,0x60,0xbe);u32(data.toUInt32()); // pushfd;pushad;esi=data
 emit(0x83,0x3e,0x01,0x0f,0x85);const skipOffset=bytes.length;u32(0);
 emit(0xc7,0x06);u32(2); // status=executing
 emit(0x8b,0x4e,0x04); // ecx=manager
 emit(0x8b,0x81);u32(0x1064);emit(0x89,0x46,0x08);
 emit(0x8b,0x81);u32(0x1050);emit(0x89,0x46,0x0c);
 for(let i=0;i<5;i++){emit(0x8b,0x81);u32(0x109c+i*4);emit(0x89,0x46,0x10+i*4);}
 emit(0xc7,0x81);u32(0x1064);u32(0);
 emit(0x8b,0x81);u32(0xfcc);emit(0x89,0x81);u32(0x1050);
 for(let i=12;i>=0;i--)emit(0xff,0x76,0x24+i*4);
 emit(0xb8);u32(0x451bd0);emit(0xff,0xd0);
 emit(0x8b,0x4e,0x04);
 emit(0x8b,0x81);u32(0x10ac);emit(0x89,0x46,0x58);
 emit(0x0f,0xb6,0x81);u32(0x10a8);emit(0x89,0x46,0x5c);
 emit(0x8b,0x46,0x08,0x89,0x81);u32(0x1064);
 emit(0x8b,0x46,0x0c,0x89,0x81);u32(0x1050);
 for(let i=0;i<5;i++){emit(0x8b,0x46,0x10+i*4,0x89,0x81);u32(0x109c+i*4);}
 emit(0xc7,0x06);u32(3); // status=complete
 const doneOffset=bytes.length;emit(0x61,0x9d,0xc2,0x08,0x00);
 const delta=doneOffset-(skipOffset+4);
 for(let i=0;i<4;i++)bytes[skipOffset+i]=(delta>>>(i*8))&255;
 code.writeByteArray(bytes);
 const callers=[0x41774b,0x417dd6,0x418a58,0x418da3];
 for(const address of callers){
  const call=P(address),old=new Uint8Array(call.readByteArray(5));
  const displacement=new DataView(old.buffer).getInt32(1,true);
  if(old[0]!==0xe8 || address+5+displacement!==0x451380)throw new Error('Unexpected tick callsite '+call);
 }
 for(const address of callers){
  const relative=(code.toUInt32()-(address+5))|0;
  Memory.patchCode(P(address),5,memory=>memory.writeByteArray([0xe8,relative&255,(relative>>>8)&255,(relative>>>16)&255,relative>>>24]));
  const installed=new Uint8Array(P(address).readByteArray(5));
  const target=(address+5+new DataView(installed.buffer).getInt32(1,true))>>>0;
  if(installed[0]!==0xe8 || target!==code.toUInt32())throw new Error('Dispatcher patch readback mismatch at '+P(address));
 }
 send({event:'test-native-dispatch-ready',code:code.toString(),size:bytes.length,callers:callers.map(a=>P(a).toString())});
 return {
  // Native code pointers referenced only by patched machine code are invisible
  // to the JS collector. Keep both allocations alive for the script's lifetime.
  code,data,
  status(){return data.readU32();},
  queue(manager,arguments13){
   if(data.readU32()!==0)throw new Error('Native test dispatcher is busy');
   if(arguments13.length!==13)throw new Error('Native shot requires13 stack arguments');
   data.add(4).writePointer(manager);
   arguments13.forEach((value,index)=>data.add(0x24+index*4).writeU32(value>>>0));
   data.writeU32(1);
  },
  consume(){
   if(data.readU32()!==3)return null;
   const result={valid:data.add(0x58).readS32(),hit:data.add(0x5c).readU32()};
   data.writeU32(0);return result;
  }
 };
})();
