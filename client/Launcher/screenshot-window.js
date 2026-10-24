'use strict';
// Read the completed Direct3D frame at Present, never the desktop GDI DC.
(() => {
  const P=ptr,saveAddress=P('0x4e2890'),captureAddress=P('0x4e2670');
  function check(at,expected){const actual=new Uint8Array(at.readByteArray(expected.length));if(expected.some((b,i)=>actual[i]!==b))throw Error('Unknown screenshot instructions at '+at);}
  check(saveAddress,[0x6a,0xff,0x68,0x9b,0xb9,0x52,0x00]);check(captureAddress,[0x83,0xec,0x40]);
  const malloc=new NativeFunction(P('0x51e3b1'),'pointer',['uint'],'mscdecl');
  const free=new NativeFunction(P('0x51e463'),'void',['pointer'],'mscdecl');
  const saveOriginal=new NativeFunction(saveAddress,'void',['pointer','int','int','int','pointer'],{abi:'thiscall',traps:'all'});
  const com=(object,index,ret,args)=>new NativeFunction(object.readPointer().add(index*4).readPointer(),ret,['pointer',...args],'stdcall');
  const release=object=>{if(object&&!object.isNull())com(object,2,'uint',[])(object);};
  const verify=(hr,operation)=>{if(hr<0)throw Error(operation+' failed: 0x'+(hr>>>0).toString(16));};
  let pending=null,prepared=null,saving=false;const hooks=new Set(),retained=[];
  function copyPath(value){const bytes=[];for(let i=0;i<32768;i++){const b=value.add(i).readU8();bytes.push(b);if(!b){const copy=Memory.alloc(bytes.length);copy.writeByteArray(bytes);return copy;}}throw Error('Screenshot path too long');}
  function readFrame(device){
    let back=null,surface=null,locked=false,result=null;
    try{
      const output=Memory.alloc(4);output.writePointer(P(0));
      verify(com(device,16,'int',['uint','uint','pointer'])(device,0,0,output),'GetBackBuffer');back=output.readPointer();
      const desc=Memory.alloc(32);verify(com(back,8,'int',['pointer'])(back,desc),'GetDesc');
      const format=desc.readU32(),width=desc.add(24).readU32(),height=desc.add(28).readU32();
      if(width<1||height<1||width>8192||height>8192||![20,21,22,23,24,25].includes(format))throw Error('Unsupported render surface '+format+' '+width+'x'+height);
      output.writePointer(P(0));verify(com(device,27,'int',['uint','uint','uint','pointer'])(device,width,height,format,output),'CreateImageSurface');surface=output.readPointer();
      verify(com(device,28,'int',['pointer','pointer','uint','pointer','pointer'])(device,back,P(0),0,surface,P(0)),'CopyRects');
      const lock=Memory.alloc(8);verify(com(surface,9,'int',['pointer','pointer','uint'])(surface,lock,P(0),0x10),'LockRect');locked=true;
      const pitch=lock.readS32(),bits=lock.add(4).readPointer(),pixelBytes=format===20?3:format===21||format===22?4:2;
      const stride=(width*3+3)&~3,size=stride*height,bytes=new Uint8Array(40+size),view=new DataView(bytes.buffer);
      view.setUint32(0,40,true);view.setInt32(4,width,true);view.setInt32(8,height,true);view.setUint16(12,1,true);view.setUint16(14,24,true);view.setUint32(20,size,true);
      for(let y=0;y<height;y++){
        const row=new Uint8Array(bits.add(y*pitch).readByteArray(width*pixelBytes));let out=40+(height-1-y)*stride;
        for(let x=0;x<width;x++,out+=3){const i=x*pixelBytes;
          if(pixelBytes>=3){bytes[out]=row[i];bytes[out+1]=row[i+1];bytes[out+2]=row[i+2];}
          else{const v=row[i]|row[i+1]<<8,b=v&31,g=(v>>5)&(format===23?63:31),r=(v>>(format===23?11:10))&31;bytes[out]=(b<<3)|(b>>2);bytes[out+1]=format===23?(g<<2)|(g>>4):(g<<3)|(g>>2);bytes[out+2]=(r<<3)|(r>>2);}
        }
      }
      result=malloc(bytes.length);if(result.isNull())throw Error('Screenshot allocation failed');result.writeByteArray(bytes);
      return {dib:result,width,height,format};
    }catch(error){if(result&&!result.isNull())free(result);throw error;}
    finally{if(locked)com(surface,10,'int',[])(surface);release(surface);release(back);}
  }
  retained.push(new NativeCallback((self,mode,width,height,path)=>{
    if(!pending&&!saving)try{pending={self,mode,path:copyPath(path)};send({event:'screenshot-requested',source:'F12'});}catch(error){send({event:'screenshot-failed',message:String(error)});}
  },'void',['pointer','int','int','int','pointer'],'thiscall'));
  Interceptor.replace(saveAddress,retained[0]);
  retained.push(new NativeCallback(()=>{const data=prepared;prepared=null;return data||P(0);},'pointer',['pointer','int','int','int'],'thiscall'));
  // The encoder is invoked from a render hook. A direct call target avoids
  // Frida's nested-hook suppression accidentally invoking the old GDI path.
  const captureCall=P('0x4e28df');check(captureCall,[0xe8,0x8c,0xfd,0xff,0xff]);
  const displacement=retained[1].toUInt32()-(captureCall.toUInt32()+5);
  Memory.patchCode(captureCall,5,code=>code.writeByteArray([0xe8,displacement&255,(displacement>>>8)&255,(displacement>>>16)&255,(displacement>>>24)&255]));
  function bindDevice(device){
    const present=device.readPointer().add(15*4).readPointer(),key=String(present);if(hooks.has(key))return;hooks.add(key);
    retained.push(Interceptor.attach(present,{onEnter(args){
      if(!pending||saving)return;const request=pending;pending=null;saving=true;
      try{const frame=readFrame(args[0]);prepared=frame.dib;saveOriginal(request.self,request.mode,frame.width,frame.height,request.path);send({event:'screenshot-rendered',width:frame.width,height:frame.height,format:frame.format});}
      catch(error){send({event:'screenshot-failed',message:String(error)});}
      finally{if(prepared){free(prepared);prepared=null;}saving=false;}
    }}));
    send({event:'screenshot-device-ready',api:'Direct3D8'});
  }
  retained.push(Process.attachModuleObserver({onAdded(module){
    if(module.name.toLowerCase()!=='d3d8.dll')return;const factory=module.getExportByName('Direct3DCreate8');
    retained.push(Interceptor.attach(factory,{onLeave(object){
      if(object.isNull())return;const at=object.readPointer().add(15*4).readPointer(),key=String(at);if(hooks.has(key))return;hooks.add(key);
      retained.push(Interceptor.attach(at,{onEnter(args){this.output=args[6];},onLeave(hr){if(hr.toInt32()>=0)bindDevice(this.output.readPointer());}}));
    }}));
  }}));
  send({event:'screenshot-backbuffer-ready',version:2});
})();
