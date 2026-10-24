const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('client/Launcher/screenshot-window.js','utf8');
// Test production pixel conversion: pitch, row order, padding and color formats.
const conversion=source.slice(source.indexOf('const stride='),source.indexOf('result=malloc'));
function convert(format,width,height,rows,pitch){
 const bits={add(offset){return {readByteArray(n){return Uint8Array.from(rows.slice(offset,offset+n)).buffer;}};}};
 return vm.runInNewContext(conversion+'bytes;',{format,width,height,pitch,bits,pixelBytes:format===20?3:format<23?4:2,Uint8Array,DataView});
}
for(const format of [20,21,22]){
 const rows=Array(16).fill(99);rows.splice(0,3,10,20,30);rows.splice(8,3,40,50,60);
 const dib=convert(format,1,2,rows,8),header=new DataView(dib.buffer);
 assert.equal(header.getUint32(0,true),40);assert.equal(header.getInt32(4,true),1);assert.equal(header.getInt32(8,true),2);assert.equal(header.getUint16(14,true),24);
 assert.deepEqual(Array.from(dib.slice(40)),[40,50,60,0,10,20,30,0]);
}
for(const format of [23,24,25]){
 const red=format===23?0xf800:0x7c00,green=format===23?0x07e0:0x03e0;
 const dib=convert(format,3,1,[31,0,green&255,green>>8,red&255,red>>8],6);
 assert.deepEqual(Array.from(dib.slice(40)),[255,0,0,0,255,0,0,0,255,0,0,0]);
}
assert(!source.includes('BitBlt'),'Do not reintroduce desktop capture');
console.log('PASS screenshot conversion: color formats, pitch, bottom-up rows, padding');
