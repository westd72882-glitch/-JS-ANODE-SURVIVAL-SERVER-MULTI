/* node tools/pack.js <src_dir> <out_dir>: шифрует ресурсы и код в один файл a.dat, кладёт загрузчик b.js и пустую оболочку index.html */
const fs=require('fs'), path=require('path'), crypto=require('crypto'), {xs}=require('./cipher.js');
const src=process.argv[2], out=process.argv[3], SERVER=(process.env.SERVER_URL||'').replace(/\/+$/,'');
const KEY=crypto.randomBytes(24).toString('hex');
const MIME={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav'};
const list=[]; (function walk(d){ for(const f of fs.readdirSync(d)){ const p=path.join(d,f), r=path.relative(src,p).split(path.sep).join('/');
  if(fs.statSync(p).isDirectory()){ walk(p); continue; }
  if(/^(manifest\.json|sw\.js|js\/register-sw\.js)$/.test(r)||!MIME[path.extname(f).toLowerCase()]) continue; list.push(r); } })(src);
for(let i=list.length-1;i>0;i--){ const j=crypto.randomInt(i+1); [list[i],list[j]]=[list[j],list[i]]; }   // порядок файлов случайный
const idx={}, chunks=[]; let off=0;
list.forEach((r,n)=>{ const d=Buffer.from(xs(new Uint8Array(fs.readFileSync(path.join(src,r))),KEY,n)); idx[r]=[off,d.length,MIME[path.extname(r).toLowerCase()],n]; chunks.push(d); off+=d.length; });
const ib=Buffer.from(xs(new Uint8Array(Buffer.from(JSON.stringify(idx))),KEY,-1)), hd=Buffer.alloc(4); hd.writeUInt32LE(ib.length);
fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(path.join(out,'a.dat'),Buffer.concat([hd,ib,...chunks]));
const tpl=fs.readFileSync(path.join(__dirname,'loader.tpl.js'),'utf8').replace('%%CIPHER%%',()=>fs.readFileSync(path.join(__dirname,'cipher.js'),'utf8').replace(/if\(typeof module[^\n]*\n?/,'')).replace('%%KEY%%',KEY).replace('%%SERVER%%',SERVER);
fs.writeFileSync(path.join(out,'b.js'),tpl);
const vp=(fs.readFileSync(path.join(src,'index.html'),'utf8').match(/<meta name="viewport"[^>]*>/)||[''])[0];
fs.writeFileSync(path.join(out,'index.html'),`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">${vp}<title>ANODE SURVIVAL</title><style>html,body{margin:0;background:#0a1224}</style></head><body><script src="b.js"></script></body></html>`);
console.log('упаковано файлов:',list.length,'размер a.dat:',off);
