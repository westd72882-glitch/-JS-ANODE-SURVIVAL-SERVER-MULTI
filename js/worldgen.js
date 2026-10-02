/* Детерминированная генерация мира: один seed → одна карта.
   Используется и для 3D-рельефа, и для миникарты/большой карты. */
(function(root){
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function makeNoise(seed){
  const rnd=mulberry32(seed), P=new Uint8Array(512), p=[...Array(256).keys()];
  for(let i=255;i>0;i--){const j=Math.floor(rnd()*(i+1));[p[i],p[j]]=[p[j],p[i]]}
  for(let i=0;i<512;i++)P[i]=p[i&255];
  const G=[];for(let i=0;i<256;i++){const a=rnd()*6.2832;G.push([Math.cos(a),Math.sin(a)])}
  const fade=t=>t*t*t*(t*(t*6-15)+10);
  function perlin(x,y){
    const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,X=xi&255,Y=yi&255;
    const g=(h,dx,dy)=>{const v=G[h&255];return v[0]*dx+v[1]*dy};
    const aa=P[P[X]+Y],ab=P[P[X]+Y+1],ba=P[P[X+1]+Y],bb=P[P[X+1]+Y+1];
    const u=fade(xf),v=fade(yf);
    const x1=g(aa,xf,yf)+u*(g(ba,xf-1,yf)-g(aa,xf,yf));
    const x2=g(ab,xf,yf-1)+u*(g(bb,xf-1,yf-1)-g(ab,xf,yf-1));
    return x1+v*(x2-x1);
  }
  return function fbm(x,y,oct,lac,gain){
    oct=oct||4;lac=lac||2;gain=gain||0.5;let s=0,a=1,f=1,n=0;
    for(let i=0;i<oct;i++){s+=perlin(x*f,y*f)*a;n+=a;a*=gain;f*=lac}
    return s/n;
  };
}
root.WorldGen={mulberry32,makeNoise};
})(typeof window!=='undefined'?window:globalThis);

(function(root){
const B={SEA:0,DEEP:1,BEACH:2,DESERT:3,PLAIN:4,FOREST:5,SNOW:6,LAKE:7,ROCK:8,ROAD:9};
const SEA_LEVEL=0.0;
/* Один остров (скруглённый квадрат с изрезанным берегом): запад — пустыня, центр — лес/равнина, восток — снег.
   h — высота В МЕТРАХ, море на 0. Берег и дно моря — сплошной пологий склон (~7–8%), без обрывов. */
function generate(seed,N,size){
  N=N||256; size=size||400;
  const nH=WorldGen.makeNoise(seed), nW=WorldGen.makeNoise(seed+101), nT=WorldGen.makeNoise(seed+202), nM=WorldGen.makeNoise(seed+303);
  const rp=WorldGen.mulberry32(seed+909), ponds=[];
  for(let q=0;q<0;q++) ponds.push([0.32+rp()*0.36,0.3+rp()*0.4,0.03+rp()*0.015]);
  const h=new Float32Array(N*N), biome=new Uint8Array(N*N), lake=new Uint8Array(N*N);
  const sm=(a,b,t)=>{t=Math.max(0,Math.min(1,(t-a)/(b-a)));return t*t*(3-2*t)};
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    const k=j*N+i, x=i/(N-1), y=j/(N-1), dx=(x-.5)*2, dy=(y-.5)*2;
    const d=Math.pow(Math.pow(Math.abs(dx),4.5)+Math.pow(Math.abs(dy),4.5),1/4.5);
    const w=nW(x*3,y*3,4,2,.55)*.16+nW(x*9+7,y*9+7,3,2,.5)*.05;
    const cm=(0.62+w-d)*size/2;                       // метры до берега: >0 суша, <0 море
    let e, isLake=false;
    if(cm<0){ const t=-cm; e=Math.max(-32,-(0.35+Math.min(t,200)*0.006+Math.pow(Math.max(0,t-200),2)*0.02)); }
    else{
      const ramp=Math.min(cm,14)*0.07, inl=sm(8,90,cm);
      // крупные холмы + средние бугры + мелкая неровность; на востоке (снег) — высокие горы
      const big=sm(0.1,0.95,nH(x*3.2+5,y*3.2+5,4,2,.5)*1.4+.5), mid=nH(x*7+11,y*7+11,4,2,.5)*.5+.5;
      const amp=22+16*sm(.55,.9,x);
      e=Math.max(0.05, ramp+inl*(big*amp+mid*6+nH(x*16+3,y*16+3,3,2,.5)*1.4));
      if(cm>40) for(const p of ponds){ const dd=Math.hypot(x-p[0],y-p[1])/p[2]; const w=1-sm(0.7,3.4,dd); if(w>0) e=e*(1-w)+(-2.5)*w; }
      if(e<-0.05){ e=Math.max(e,-3); isLake=true; lake[k]=1; }
    }
    h[k]=e;
    let b;
    if(cm<0) b=e<-6?B.DEEP:B.SEA;
    else if(isLake) b=B.LAKE;
    else if(cm<20+nT(x*7+3,y*7+3,3,2,.5)*9&&e<7) b=B.BEACH;
    else{
      const des=0.35+0.08*Math.sin(Math.PI*Math.max(0,Math.min(1,(x-.04)/.9)))+nT(x*3,y*3,3,2,.5)*.04;
      const sno=0.37+nT(x*4+9,y*4+9,3,2,.5)*.06;
      if(y>1-des) b=B.DESERT; else if(y<sno) b=B.SNOW;
      else b=nM(x*3.5,y*3.5,4,2,.5)>-0.02?B.FOREST:B.PLAIN;
    }
    biome[k]=b;
  }
  /* Дорога: плавная синусоида с запада на восток через центр; вдоль неё рельеф сглажен и выровнен.
     Заправка — на центральной площадке (x=0, z=-15 м). */
  const rz=x=>0.5+0.04*Math.sin((x-.5)*7.5), X0=Math.round(0.22*(N-1)), X1=Math.round(0.78*(N-1));
  const cellM=size/(N-1), HW=5.5, rc=new Float32Array(N), rs=new Float32Array(N);
  for(let i=X0;i<=X1;i++){ const j=Math.round(rz(i/(N-1))*(N-1)); rc[i]=Math.max(1.0,h[j*N+i]); }
  for(let i=X0;i<=X1;i++){ let s=0,c=0; for(let d=-16;d<=16;d++){const q=i+d; if(q>=X0&&q<=X1){s+=rc[q];c++;}} rs[i]=s/c; }
  const mid=Math.round(0.5*(N-1)), padH=rs[mid], padJ=(0.5-15/size)*(N-1);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    const k=j*N+i; if(biome[k]<B.BEACH||biome[k]===B.LAKE) continue;
    let e=h[k];
    if(i>=X0&&i<=X1){
      const d=Math.abs(j-rz(i/(N-1))*(N-1))*cellM;
      if(d<HW+9){ const t=d<=HW?1:1-sm(HW,HW+9,d); e=e*(1-t)+rs[i]*t; if(d<=HW&&e>0.3) biome[k]=B.ROAD; }
    }
    const pd=Math.hypot(i-mid,j-padJ)*cellM;
    if(pd<30){ const t=pd<=18?1:1-sm(18,30,pd); e=e*(1-t)+padH*t; }
    const qi=(0.5+78/size)*(N-1), qj=(0.5-74/size)*(N-1), qd=Math.hypot(i-qi,j-qj)*cellM;   // Агропром (снежный угол)
    if(qd<40){ const t=qd<=27?1:1-sm(27,40,qd); e=e*(1-t)+3.5*t; if(qd<=33&&e>0.3) biome[k]=B.SNOW; }
    h[k]=e;
  }
  return {N,seed,size,h,biome,lake};
}
root.WorldGen.generate=generate; root.WorldGen.B=B; root.WorldGen.SEA_LEVEL=SEA_LEVEL;
})(typeof window!=='undefined'?window:globalThis);
