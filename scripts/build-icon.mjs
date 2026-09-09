import fs from 'node:fs';
import zlib from 'node:zlib';
const size=256;
function crc32(buf){let n=0xffffffff;for(const x of buf){n^=x;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(name,data){const label=Buffer.from(name),head=Buffer.alloc(4),crc=Buffer.alloc(4);head.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([head,label,data,crc]);}
const raw=Buffer.alloc((size*4+1)*size);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const inside=x>=12&&x<244&&y>=12&&y<244;
  const stem=x>=70&&x<102&&y>=52&&y<204;
  const top=x>=102&&x<177&&((y>=52&&y<82)||(y>=113&&y<143)||(y>=174&&y<204));
  const edge=x>=170&&x<195&&((y>=72&&y<116)||(y>=135&&y<184));
  const color=stem||top||edge?[255,248,235,255]:inside?[213,41,31,255]:[12,12,12,255];
  const offset=y*(size*4+1)+1+x*4;for(let i=0;i<4;i++)raw[offset+i]=color[i];
}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
fs.mkdirSync('host/ui/assets',{recursive:true});fs.writeFileSync('host/ui/assets/icon.png',png);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
fs.writeFileSync('host/ui/assets/icon.ico',Buffer.concat([ico,png]));
