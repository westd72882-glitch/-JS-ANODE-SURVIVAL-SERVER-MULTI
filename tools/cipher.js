/* Потоковый шифр (xoshiro128**) + распаковка архива a.dat. Один и тот же код — в сборщике (Node) и в загрузчике (WebView). */
function xs(buf, key, idx){
  var h=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35], s=key+':'+idx, i, j, k;
  for(i=0;i<s.length;i++){ var c=s.charCodeAt(i); for(j=0;j<4;j++){ h[j]=Math.imul(h[j]^(c+j*31),16777619); h[j]^=h[j]>>>13; } }
  var a=h[0]|0,b=h[1]|0,c2=h[2]|0,d=h[3]|0; if(!(a|b|c2|d)) a=1;
  function rotl(x,n){ return (x<<n)|(x>>>(32-n)); }
  for(i=0;i<buf.length;i+=4){
    var r=Math.imul(rotl(Math.imul(b,5),7),9)>>>0, t=b<<9;
    c2^=a; d^=b; b^=c2; a^=d; c2^=t; d=rotl(d,11);
    for(k=0;k<4&&i+k<buf.length;k++) buf[i+k]^=(r>>>(8*k))&255;
  }
  return buf;
}
function unpack(buf, key){
  var il=(buf[0]|(buf[1]<<8)|(buf[2]<<16)|(buf[3]<<24))>>>0;
  var idx=JSON.parse(new TextDecoder().decode(xs(buf.slice(4,4+il),key,-1))), base=4+il, out=new Map();
  Object.keys(idx).forEach(function(p){ var e=idx[p]; var o={m:e[2]}, c=null; Object.defineProperty(o,'d',{get:function(){ if(!c) c=xs(buf.slice(base+e[0],base+e[0]+e[1]),key,e[3]); return c; }}); out.set(p,o); });
  return out;
}
if(typeof module!=='undefined') module.exports={xs:xs,unpack:unpack};
