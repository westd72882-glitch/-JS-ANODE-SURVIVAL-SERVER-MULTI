(function(){
'use strict';
const KEY='%%KEY%%'; window.__SERVER='%%SERVER%%'; window.__APK=true;
%%CIPHER%%
(async function(){
  const buf=new Uint8Array(await (await fetch('a.dat')).arrayBuffer()), files=unpack(buf,KEY), blobs=new Map(), dec=new TextDecoder();
  const NORM=u=>{ u=String(u==null?'':u); if(/^(blob|data):/.test(u)) return null; u=u.split('#')[0].split('?')[0].replace(location.origin+'/','').replace(/^(\.{0,2}\/)+/,''); return u; };
  const getUrl=k=>{ if(!blobs.has(k)){ const f=files.get(k); blobs.set(k,URL.createObjectURL(new Blob([f.d],{type:f.m}))); } return blobs.get(k); };
  const RES=u=>{ const k=NORM(u); return k&&files.has(k)?getUrl(k):null; };
  const text=k=>dec.decode(files.get(k).d);
  const RX=/(?:\.\.?\/)*(?:assets|1)\/[\w\-.\/]+\.(?:webp|png|jpe?g|gif|svg|mp3|ogg|wav|woff2?|ttf)/g;
  const fix=v=>typeof v==='string'&&v.indexOf('/')>=0?v.replace(RX,m=>RES(m)||m):v;
  const hook=(proto,name,fn)=>{ const d=Object.getOwnPropertyDescriptor(proto,name); if(!d||!d.set) return; Object.defineProperty(proto,name,{get:d.get,set(v){ d.set.call(this,fn(v)); },configurable:true,enumerable:d.enumerable}); };
  const ru=v=>RES(v)||v;
  const rs=v=>RES(v)||(/three\.min\.js/.test(String(v))&&files.has('three.min.js')?getUrl('three.min.js'):v);
  hook(HTMLImageElement.prototype,'src',ru); hook(HTMLMediaElement.prototype,'src',ru); hook(HTMLScriptElement.prototype,'src',rs);
  ['backgroundImage','background','maskImage','webkitMaskImage','borderImage','listStyleImage','content','cssText'].forEach(n=>hook(CSSStyleDeclaration.prototype,n,fix));
  hook(Element.prototype,'innerHTML',fix); hook(Element.prototype,'outerHTML',fix);
  const sp=CSSStyleDeclaration.prototype.setProperty; CSSStyleDeclaration.prototype.setProperty=function(n,v,p){ return sp.call(this,n,fix(v),p); };
  const sa=Element.prototype.setAttribute; Element.prototype.setAttribute=function(n,v){ if(typeof v==='string'&&(n==='src'||n==='style'||n==='href')) v=(this instanceof HTMLScriptElement&&n==='src')?rs(v):fix(v); return sa.call(this,n,v); };
  const iah=Element.prototype.insertAdjacentHTML; Element.prototype.insertAdjacentHTML=function(p,h){ return iah.call(this,p,fix(h)); };
  const of=window.fetch; window.fetch=function(i,o){ if(typeof i==='string'){ const r=RES(i); if(r) return of.call(this,r,o); } return of.call(this,i,o); };
  const xo=XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open=function(m,u){ const a=[].slice.call(arguments); if(typeof u==='string') a[1]=ru(u); return xo.apply(this,a); };
  const OA=window.Audio; window.Audio=function(s){ return s?new OA(ru(s)):new OA(); }; window.Audio.prototype=OA.prototype;
  /* страница */
  const doc=new DOMParser().parseFromString(fix(text('index.html')),'text/html');
  const scripts=[].slice.call(doc.querySelectorAll('script')); scripts.forEach(s=>s.remove());
  [].slice.call(doc.head.children).forEach(e=>{ if(e.tagName==='LINK'||e.tagName==='TITLE'&&false) return; if(e.tagName==='META'&&/viewport/.test(e.name)) return; document.head.appendChild(document.importNode(e,true)); });
  const st=document.createElement('style'); st.textContent=fix(text('css/style.css')); document.head.appendChild(st);
  [].slice.call(doc.body.attributes).forEach(a=>document.body.setAttribute(a.name,a.value));
  [].slice.call(doc.body.childNodes).forEach(n=>document.body.appendChild(document.importNode(n,true)));
  for(const s of scripts){
    const src=s.getAttribute('src'); if(src&&/register-sw/.test(src)) continue;
    await new Promise(res=>{ const n=document.createElement('script'); if(src){ n.onload=n.onerror=()=>res(); n.src=src; document.body.appendChild(n); } else { n.textContent=s.textContent; document.body.appendChild(n); res(); } });
  }
  document.dispatchEvent(new Event('DOMContentLoaded')); window.dispatchEvent(new Event('load'));
})().catch(function(e){ document.body.innerHTML='<pre style="color:#f88;padding:12px">Ошибка запуска: '+(e&&e.message)+'</pre>'; });
})();
