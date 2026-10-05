(function(){
"use strict";
const CFG = OSIL_SETTINGS.all;          // живые настройки (меню → localStorage)
let CULL_K = 1;                          // множитель дальности видимости объектов
let layoutEditing = false, FPS_CAP_MS = 0, ultraDyn = 0, ultraLo = 0, ultraHi = 0;

/* ---------------- Texture loader helpers ---------------- */
const texLoader = new THREE.TextureLoader();
function loadTex(dataUrl, repeatX, repeatY){
  const t = texLoader.load(dataUrl);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if(repeatX) t.repeat.set(repeatX, repeatY||repeatX);
  return t;
}
const maxAniso = 8;
const grassTex   = loadTex(TEXTURES.tex_grass, 40, 40);
const woodTex    = loadTex(TEXTURES.tex_wood, 1, 1);
const barkTex    = loadTex(TEXTURES.tex_bark, 1, 2);
const foliageTex = loadTex(TEXTURES.tex_foliage, 2, 2);
const leafTex    = loadTex(TEXTURES.tex_leaf, 2, 2);
const stoneTex   = loadTex(TEXTURES.tex_stone, 1, 1);
const rockOreTex = loadTex(TEXTURES.tex_rockore, 1, 1);
const sulfurTex  = loadTex(TEXTURES.tex_sulfur, 1, 1);
const metalTex   = loadTex(TEXTURES.tex_metal, 1, 1);
[grassTex,woodTex,barkTex,foliageTex,leafTex,stoneTex,rockOreTex,sulfurTex,metalTex].forEach(t=>{ t.anisotropy = maxAniso; });

/* ---------------- Basic setup ---------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec9e8);
const FOG_MAX = 200;
scene.fog = new THREE.Fog(0x8ec9e8, 34, 190);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth/window.innerHeight, 0.02, 200);
const IS_MOBILE = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));   // 100% родного разрешения экрана
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;      // тени перерисовываем только при изменении (см. animate)
let shadowDirty = true, shadowTimer = 0;
document.getElementById('app').prepend(renderer.domElement);
OSIL_TOOLS.init(renderer);

function fitScreen(){
  if(document.activeElement && document.activeElement.id==='net-chat-in') return;   // клавиатура чата не сжимает картинку
  const vv = window.visualViewport, w = Math.round(vv ? vv.width : window.innerWidth), h = Math.round(vv ? vv.height : window.innerHeight);
  camera.aspect = w/h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);                       // под реальный экран устройства, без рамок
  renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
}
window.addEventListener('resize', fitScreen);
window.addEventListener('orientationchange', ()=>setTimeout(fitScreen,200));
if(window.visualViewport) window.visualViewport.addEventListener('resize', fitScreen);
document.addEventListener('fullscreenchange', ()=>setTimeout(fitScreen,100));
setTimeout(fitScreen,0);

/* ---------------- Lighting ---------------- */
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a2f1e, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d0, 1.1);
sun.position.set(60, 90, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-55; sun.shadow.camera.right=55;
sun.shadow.camera.top=55; sun.shadow.camera.bottom=-55;
sun.shadow.camera.far=220;
sun.shadow.bias = -0.0004;        // против «полосок» (shadow acne) на траве
sun.shadow.normalBias = 0.06;
scene.add(sun); scene.add(sun.target);
const SUN_OFFSET = new THREE.Vector3(60,90,30);
let SHADOW_TEXEL = 0.15;   // размер текселя теневой карты в метрах (обновляется в applySetting)
const _nd = new THREE.Vector3(); let _ndInit=false;
const _sunDir = SUN_OFFSET.clone().normalize();   // направление света (обновляется сменой дня/ночи)
const _sRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), _sunDir).normalize();
const _sUp = new THREE.Vector3().crossVectors(_sunDir, _sRight).normalize();
function followSun(px,py,pz){
  // привязываем центр теневой карты к сетке текселей В ПРОСТРАНСТВЕ СВЕТА — тени не «плывут» и не рябят
  const T = SHADOW_TEXEL*16;   // шаг = 16 текселей: кратно сетке (нет мерцания) и карта теней обновляется редко
  const a = Math.round((px*_sRight.x + py*_sRight.y + pz*_sRight.z)/T)*T;
  const b = Math.round((px*_sUp.x + py*_sUp.y + pz*_sUp.z)/T)*T;
  const d = px*_sunDir.x + py*_sunDir.y + pz*_sunDir.z;
  const sx = _sRight.x*a + _sUp.x*b + _sunDir.x*d;
  const sy = _sRight.y*a + _sUp.y*b + _sunDir.y*d;
  const sz = _sRight.z*a + _sUp.z*b + _sunDir.z*d;
  if(Math.abs(sx-sun.target.position.x)>1e-4 || Math.abs(sz-sun.target.position.z)>1e-4 || Math.abs(sy-sun.target.position.y)>1e-4) shadowDirty = true;
  sun.target.position.set(sx,sy,sz);
  sun.position.set(sx+SUN_OFFSET.x, sy+SUN_OFFSET.y, sz+SUN_OFFSET.z);
}

/* ---------------- Небо: смена дня/ночи (1 ч день + 1 ч ночь), солнце, луна, звёзды, облака ---------------- */
const DAY_LEN = 3600, CYCLE_LEN = DAY_LEN*2;
let gameClock = CYCLE_LEN*0.12;          // старт — утро
const skyU = {
  uSunDir:{value:new THREE.Vector3(0,1,0)}, uMoonDir:{value:new THREE.Vector3(0,-1,0)},
  uZenith:{value:new THREE.Color(0x3f8fd6)}, uHorizon:{value:new THREE.Color(0x9fd0ee)},
  uSunCol:{value:new THREE.Color(0xfff2d0)}, uNight:{value:0}, uTime:{value:0}
};
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(50,32,16), new THREE.ShaderMaterial({
  uniforms:skyU, side:THREE.BackSide, depthWrite:false, depthTest:false, fog:false,
  vertexShader:`varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader:`
    varying vec3 vD; uniform vec3 uSunDir,uMoonDir,uZenith,uHorizon,uSunCol; uniform float uNight,uTime;
    float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+vec2(11.7,3.1); a*=.5; } return s; }
    void main(){
      vec3 d = normalize(vD);
      float y = clamp(d.y,-0.2,1.0);
      vec3 col = mix(uHorizon, uZenith, pow(clamp(y,0.,1.), 0.55));
      float sd = max(dot(d,uSunDir),0.);
      float glow = pow(sd,6.)*0.35 + pow(sd,60.)*0.5;
      col += uSunCol*glow*(1.-uNight*0.9);
      float disc = smoothstep(0.9993,0.99965,dot(d,uSunDir));
      col = mix(col, uSunCol*2.2, disc);
      float md = dot(d,uMoonDir);
      col = mix(col, vec3(0.9,0.93,1.0), smoothstep(0.99935,0.9996,md)*uNight);
      col += vec3(0.5,0.6,0.9)*pow(max(md,0.),40.)*0.08*uNight;
      if(uNight>0.05 && d.y>0.){
        vec2 sp = d.xz/(d.y+0.3)*60.; vec2 c = floor(sp); float r = h21(c);
        float star = step(0.985,r)*smoothstep(0.35,0.,length(fract(sp)-0.5))*(0.6+0.4*sin(uTime*2.+r*40.));
        col += vec3(star)*uNight*smoothstep(0.02,0.25,d.y);
      }
      if(d.y>0.){
        vec2 cp = d.xz/(d.y+0.18)*1.6 + vec2(uTime*0.012, uTime*0.005);
        float n = fbm(cp) ;
        float cov = smoothstep(0.48,0.78,n) * smoothstep(0.0,0.22,d.y);
        vec3 lit = mix(vec3(0.62,0.66,0.74), vec3(1.0), 1.-uNight*0.85) * (0.55+0.45*(uSunCol*0.5+0.5));
        vec3 ccol = mix(lit*0.72, lit, smoothstep(0.5,0.95,1.-n*0.6));
        ccol = mix(ccol, uHorizon*1.15, 0.25);
        ccol *= mix(1.0, 0.22, uNight);
        col = mix(col, ccol, cov*0.92);
      }
      gl_FragColor = vec4(col,1.0);
    }`
}));
skyDome.renderOrder = -1000; skyDome.frustumCulled = false;
scene.add(skyDome);
const _cDayZ=new THREE.Color(0x3a86d4), _cNightZ=new THREE.Color(0x02050f), _cDayH=new THREE.Color(0xa6d3ec), _cNightH=new THREE.Color(0x0a1224), _cTw=new THREE.Color(0xff9560);
const _cSunW=new THREE.Color(0xfff2d0), _cSunLow=new THREE.Color(0xff9a50), _cMoon=new THREE.Color(0x8fa6d8), _hemiDaySky=new THREE.Color(0xbfd9ff), _hemiNightSky=new THREE.Color(0x1a2848);
const _sk = new THREE.Vector3(), _ss = (a,b,x)=>{ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };
let skyTimer = 99;
function updateSky(dt){
  gameClock = (gameClock + dt) % CYCLE_LEN;
  skyU.uTime.value = performance.now()/1000;
  skyDome.position.copy(camera.position);
  skyTimer += dt; if(skyTimer < 0.5) return; skyTimer = 0;
  const a = gameClock/CYCLE_LEN*Math.PI*2;
  _sk.set(Math.cos(a), Math.sin(a), 0.32).normalize();          // солнце
  const elev = _sk.y;
  const day = _ss(-0.12,0.22,elev), tw = Math.exp(-Math.pow(elev/0.16,2)), night = 1-day;
  skyU.uSunDir.value.copy(_sk); skyU.uMoonDir.value.copy(_sk).multiplyScalar(-1);
  skyU.uNight.value = night;
  skyU.uZenith.value.copy(_cNightZ).lerp(_cDayZ,day).lerp(_cTw,tw*0.12);
  skyU.uHorizon.value.copy(_cNightH).lerp(_cDayH,day).lerp(_cTw,tw*0.65);
  skyU.uSunCol.value.copy(_cSunLow).lerp(_cSunW,_ss(0.05,0.45,elev));
  scene.fog.color.copy(skyU.uHorizon.value); scene.background.copy(skyU.uHorizon.value);
  // направление света: солнце днём, луна ночью (у горизонта интенсивность ≈ 0 — переключение незаметно)
  const up = elev>=0;
  _nd.copy(up?_sk:_sk.clone().multiplyScalar(-1)); _nd.y = Math.max(_nd.y,0.18); _nd.normalize();
  if(!_ndInit || _sunDir.angleTo(_nd)>0.04){   // направление света (и тени) сдвигаем редкими шагами, чтобы тени стояли на месте
    _ndInit=true; _sunDir.copy(_nd);
    SUN_OFFSET.copy(_sunDir).multiplyScalar(105);
    _sRight.crossVectors(new THREE.Vector3(0,1,0), _sunDir).normalize(); _sUp.crossVectors(_sunDir,_sRight).normalize();
  }
  sun.intensity = up ? 1.1*_ss(0,0.2,elev) : 0.28*_ss(0,0.2,-elev);
  sun.color.copy(up ? skyU.uSunCol.value : _cMoon);
  hemi.intensity = 0.16 + 0.74*day;
  hemi.color.copy(_hemiNightSky).lerp(_hemiDaySky,day);
  if(typeof seaU!=='undefined' && seaU.uSun) seaU.uSun.value.copy(_sunDir);
  shadowDirty = true;
}

/* ---------------- World (генератор: рельеф, биомы, озёра, море) ---------------- */
const WORLD_SEED = 33;
const WORLD_SIZE = 400;            // размер мира в метрах (квадрат)
const WG = WorldGen.generate(WORLD_SEED, 256, WORLD_SIZE);
const B = WorldGen.B;
const WN = WG.N;
const SEA_Y = 0;                   // уровень моря (метры); генератор выдаёт высоту в метрах

/* билинейная выборка поля генератора по мировым координатам */
function wgSample(arr, x, z){
  const u = Math.max(0,Math.min(WN-1,(x/WORLD_SIZE + 0.5)*(WN-1))), v = Math.max(0,Math.min(WN-1,(z/WORLD_SIZE + 0.5)*(WN-1)));
  const i = Math.max(0, Math.min(WN-2, Math.floor(u))), j = Math.max(0, Math.min(WN-2, Math.floor(v)));
  const fu = u-i, fv = v-j;
  const a = arr[j*WN+i], b = arr[j*WN+i+1], c = arr[(j+1)*WN+i], d = arr[(j+1)*WN+i+1];
  return (a*(1-fu)+b*fu)*(1-fv) + (c*(1-fu)+d*fu)*fv;
}
function biomeAt(x,z){
  const i = Math.max(0, Math.min(WN-1, Math.round((x/WORLD_SIZE + 0.5)*(WN-1))));
  const j = Math.max(0, Math.min(WN-1, Math.round((z/WORLD_SIZE + 0.5)*(WN-1))));
  return WG.biome[j*WN+i];
}
/* Высота — прямо из генератора (метры). За краем карты дно продолжает плавно уходить вниз,
   поэтому нигде нет обрыва: берег → пологое дно → глубина, скрытая туманом. */
function heightAt(x,z){
  const hw = WORLD_SIZE/2;
  const beyond = Math.hypot(Math.max(0,Math.abs(x)-hw), Math.max(0,Math.abs(z)-hw));
  return Math.max(-32, wgSample(WG.h, x, z) - beyond*0.006 - Math.pow(Math.max(0,beyond-120),2)*0.02);
}
const isWaterAt  = (x,z)=> heightAt(x,z) < 0.02;
const isLandAt   = (x,z)=> !isWaterAt(x,z);

const BIOME_COLOR = {
  [B.DEEP]:0x1b3b52, [B.SEA]:0x2a5f7d, [B.BEACH]:0xc4b283, [B.DESERT]:0xdcc07f,
  [B.PLAIN]:0x7d9a45, [B.FOREST]:0x486b34, [B.SNOW]:0xdce6ea, [B.LAKE]:0x3a7391, [B.ROCK]:0x78746c, [B.ROAD]:0x667046
};
const groundSeg = 160;
const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, groundSeg, groundSeg);
groundGeo.rotateX(-Math.PI/2);
const posAttr = groundGeo.attributes.position;
const colArr = new Float32Array(posAttr.count*3), flatArr = new Float32Array(posAttr.count);
const FLAT_K = {[B.SNOW]:0.8, [B.DESERT]:0.7, [B.BEACH]:0.9};
const _c = new THREE.Color(), _c2 = new THREE.Color(), _deep = new THREE.Color(0x1b3b52);
/* Мягкая выборка биома: усредняем несколько соседних точек генератора вместо
   ближайшего соседа — это убирает резкую границу «холм упирается в снег/песок». */
function biomeColorSmooth(x, z, out){
  const R = 6.5;         // радиус усреднения в метрах — сглаживает переходы биомов
  let r=0,g=0,b=0,flat=0,wsum=0;
  const offs = [[0,0,1.6],[R,0,1],[-R,0,1],[0,R,1],[0,-R,1],[R*0.7,R*0.7,0.7],[-R*0.7,R*0.7,0.7],[R*0.7,-R*0.7,0.7],[-R*0.7,-R*0.7,0.7]];
  for(const [ox,oz,w] of offs){
    let bm = biomeAt(x+ox, z+oz); if(bm===B.SEA||bm===B.DEEP||bm===B.LAKE) bm=B.BEACH;
    _c2.setHex(BIOME_COLOR[bm] || 0x7d9a45);
    r+=_c2.r*w; g+=_c2.g*w; b+=_c2.b*w; flat+=(FLAT_K[bm]||0)*w; wsum+=w;
  }
  out.setRGB(r/wsum, g/wsum, b/wsum);
  return flat/wsum;
}
for(let i=0;i<posAttr.count;i++){
  const x = posAttr.getX(i), z = posAttr.getZ(i);
  const yy = heightAt(x,z); posAttr.setY(i, yy);
  let flatK;
  if(yy<0){ _c.setHex(0xc4b283).lerp(_deep, Math.min(1,-yy/7)); flatK=0.65; }
  else { flatK = biomeColorSmooth(x, z, _c); }
  flatArr[i] = flatK;
  // лёгкая вариация оттенка, чтобы не было плоской заливки
  const nv = (Math.sin(x*0.31)*Math.cos(z*0.27))*0.5+0.5, n = flatK>0.5 ? 0.97+nv*0.03 : 0.93+nv*0.14;
  colArr[i*3]=_c.r*n; colArr[i*3+1]=_c.g*n; colArr[i*3+2]=_c.b*n;
}
groundGeo.setAttribute('color', new THREE.BufferAttribute(colArr,3));
groundGeo.setAttribute('aFlat', new THREE.BufferAttribute(flatArr,1));
groundGeo.computeVertexNormals();
const groundMat = new THREE.MeshStandardMaterial({ map: grassTex, vertexColors:true, roughness:1 });
/* снег и песок почти не берут зелёную текстуру травы — иначе они серые/грязные */
groundMat.onBeforeCompile = sh=>{
  sh.vertexShader = sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aFlat;\nvarying float vFlat;').replace('#include <begin_vertex>','#include <begin_vertex>\nvFlat = aFlat;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>','#include <common>\nvarying float vFlat;').replace('#include <color_fragment>','#ifdef USE_COLOR\n  diffuseColor.rgb = mix(diffuseColor.rgb*vColor, vColor*(0.9+0.1*diffuseColor.g), vFlat);\n#endif');
};
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);
/* внешнее кольцо дна (грубая сетка 10 м): продолжает морское дно за краем карты */
/* внешнее песчаное кольцо за краем мира убрано: мир обрывается чисто */

/* море: одна большая плоскость на уровне моря (озёра лежат ниже — видны через неё).
   Реалистичная вода: шейдер с волнами (сумма направленных синусоид), Френелем, бликом солнца,
   прозрачностью и цветом по глубине, пеной у берега и круговыми волнами от попаданий пуль. */
const SEA_TIDE = 0.2, SEA_LAND_MIN = 3, SEA_DEPTH_MAX = 10, SEA_TEX_N = 512, SEA_HALF = WORLD_SIZE/2 + 140;
let seaMaskN = null;   // 1 = океан (вода, связанная с краем карты), 0 = озёра и суша: прибой рисуется только у моря
const seaDepthTex = (()=>{
  const N = SEA_TEX_N, d = new Uint8Array(N*N*4), wat = new Uint8Array(N*N);
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const x = ((i+0.5)/N*2-1)*SEA_HALF, z = ((j+0.5)/N*2-1)*SEA_HALF;
    const dep = Math.max(-SEA_LAND_MIN, Math.min(SEA_DEPTH_MAX, SEA_Y - heightAt(x,z)));
    const v = Math.round((dep+SEA_LAND_MIN)/(SEA_DEPTH_MAX+SEA_LAND_MIN)*255), k = (j*N+i)*4;
    d[k]=v; d[k+1]=v; d[k+2]=0; d[k+3]=255; wat[j*N+i] = dep>0 ? 1 : 0;
  }
  const mk = new Uint8Array(N*N), q = new Int32Array(N*N); let qh=0, qt=0;
  const push = c=>{ if(wat[c] && !mk[c]){ mk[c]=1; q[qt++]=c; } };
  for(let t=0;t<N;t++){ push(t); push((N-1)*N+t); push(t*N); push(t*N+N-1); }
  while(qh<qt){ const c=q[qh++], i=c%N, j=(c-i)/N; if(i>0) push(c-1); if(i<N-1) push(c+1); if(j>0) push(c-N); if(j<N-1) push(c+N); }
  seaMaskN = mk;
  for(let c=0;c<N*N;c++) if(mk[c]) d[c*4+2] = 255;
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();
const seaNoiseTex = (()=>{   // тайлящийся value-noise, 256px, решётка 32x32 (мипы гасят мерцание вдали)
  const N = 256, L = 32, r = WorldGen.mulberry32(4242), lat = new Float32Array(L*L), d = new Uint8Array(N*N*4);
  for(let i=0;i<L*L;i++) lat[i] = r();
  const sm = t=>t*t*(3-2*t);
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const u = x/N*L, v = y/N*L, i = Math.floor(u), j = Math.floor(v), fu = sm(u-i), fv = sm(v-j);
    const a = lat[(j%L)*L+(i%L)], b = lat[(j%L)*L+((i+1)%L)], c = lat[((j+1)%L)*L+(i%L)], e = lat[((j+1)%L)*L+((i+1)%L)];
    const val = Math.round(((a*(1-fu)+b*fu)*(1-fv) + (c*(1-fu)+e*fu)*fv)*255), k = (y*N+x)*4;
    d[k]=d[k+1]=d[k+2]=val; d[k+3]=255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
})();
const SEA_TEX_HQ = 1024;
let _seaDepthHQ = null;
function seaBuildDepthHQ(){   // 16 бит глубины (R=старший, G=младший байт), 1024px, фильтрация вручную в шейдере
  if(_seaDepthHQ) return _seaDepthHQ;
  const N = SEA_TEX_HQ, d = new Uint8Array(N*N*4), R = SEA_DEPTH_MAX+SEA_LAND_MIN;
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const x = ((i+0.5)/N*2-1)*SEA_HALF, z = ((j+0.5)/N*2-1)*SEA_HALF;
    const dep = Math.max(-SEA_LAND_MIN, Math.min(SEA_DEPTH_MAX, SEA_Y - heightAt(x,z)));
    const v = Math.round((dep+SEA_LAND_MIN)/R*65535), k = (j*N+i)*4;
    d[k]=v>>8; d[k+1]=v&255; d[k+2]=(seaMaskN && seaMaskN[((j*SEA_TEX_N/N)|0)*SEA_TEX_N + ((i*SEA_TEX_N/N)|0)]) ? 255 : 0; d[k+3]=255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.needsUpdate = true;
  return (_seaDepthHQ = t);
}
const SEA_RIP_N = 12, seaRip = [];
for(let i=0;i<SEA_RIP_N;i++) seaRip.push(new THREE.Vector4(0,0,-100,0));
const seaU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
  uTime:{value:0}, uLvl:{value:0}, uLM:{value:SEA_LAND_MIN}, uRT:{value:0}, uSun:{value:new THREE.Vector3(60,90,30).normalize()},
  uRA:{value:0}, uNoise:{value:seaNoiseTex}, uDepthTex:{value:seaDepthTex}, uHalf:{value:SEA_HALF}, uDMax:{value:SEA_DEPTH_MAX}, uRip:{value:seaRip}, uN:{value:SEA_TEX_HQ}
}]);
const seaMat = new THREE.ShaderMaterial({
  uniforms: seaU, fog:true, transparent:true, depthWrite:false,
  vertexShader: `
    varying vec3 vW;
    #include <fog_pars_vertex>
    void main(){
      vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz;
      vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform float uTime, uRT, uHalf, uDMax, uLvl, uLM, uRA, uN; uniform vec3 uSun; uniform sampler2D uDepthTex, uNoise; uniform vec4 uRip[${SEA_RIP_N}];
    varying vec3 vW; float vDist;
    #ifdef SEA_HQ
    float decD(vec2 t){ vec4 c = texture2D(uDepthTex, t); return (c.r*255.0*256.0 + c.g*255.0)/65535.0; }
    float depthRaw(vec2 uv){   // билинейная фильтрация 16-бит глубины вручную: плавный берег без «ступенек»
      vec2 f = uv*uN - 0.5; vec2 i = floor(f); vec2 w = f - i; vec2 b = (i+0.5)/uN; float h = 1.0/uN;
      float a = decD(b), c = decD(b+vec2(h,0.0)), d = decD(b+vec2(0.0,h)), e = decD(b+vec2(h,h));
      return mix(mix(a,c,w.x), mix(d,e,w.x), w.y);
    }
    #endif
    #include <fog_pars_fragment>
    void addW(inout vec2 g, vec2 p, vec2 d, float k, float sp, float a, float fade){
      float ph = dot(d,p)*k + uTime*sp; float ff = 1.0 - smoothstep(0.5, 1.6, k*vDist*0.006); g += d*k*a*fade*ff*cos(ph);
    }
    float vnoise(vec2 p){ return texture2D(uNoise, p*(1.0/32.0)).r; }
    float nz(vec2 x){ return vnoise(x)*0.7 + vnoise(x*2.3+7.3)*0.3; }
    void main(){
      if(max(abs(vW.x),abs(vW.z)) > ${WORLD_SIZE/2}.0) discard;   // воды за краем мира нет
      vec2 p = vW.xz;
      vec2 uv = clamp((p + uHalf)/(2.0*uHalf), 0.002, 0.998);
      #ifdef SEA_HQ
      float depth = depthRaw(uv)*(uDMax+uLM) - uLM + uLvl;
      #else
      float depth = texture2D(uDepthTex, uv).r*(uDMax+uLM) - uLM + uLvl;
      #endif
      if(depth < 0.0) discard;
      vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam/dist; vDist = dist;
      float fade = 1.0/(1.0 + dist*0.008);
      float fineK = 1.0 - smoothstep(20.0, 80.0, dist), midK = 1.0 - smoothstep(60.0, 190.0, dist);
      vec2 g = vec2(0.0);
      addW(g,p,normalize(vec2( 1.0, 0.30)),0.35,0.90,0.060,1.0);
      addW(g,p,normalize(vec2(-0.6, 1.00)),0.62,1.25,0.040,midK);
      addW(g,p,normalize(vec2( 0.4,-1.00)),1.10,1.70,0.026,fineK);
            
      // мелкая рябь (шум), едва заметно
      vec2 e = vec2(0.12, 0.0);
      vec2 qa = p*0.55 + vec2(uTime*0.07, -uTime*0.05), qb = p*1.6 + vec2(-uTime*0.11, uTime*0.08);
      float wa = 1.0 - smoothstep(40.0, 260.0, dist), wb = 1.0 - smoothstep(12.0, 90.0, dist);
      float na = nz(qa); g += vec2(nz(qa+e.xy)-na, nz(qa+e.yx)-na)*0.22*wa;
      if(wb > 0.01){ float nb = nz(qb); g += vec2(nz(qb+e.xy)-nb, nz(qb+e.yx)-nb)*0.14*wb; }
      
      #ifdef SEA_HQ
      float wc = 1.0 - smoothstep(14.0, 95.0, dist), wd = 1.0 - smoothstep(6.0, 45.0, dist);
      if(wc > 0.01){
        vec2 qc = p*3.1 + vec2(uTime*0.16, uTime*0.12), e2 = vec2(0.12, 0.0);
        float nc = nz(qc); g += vec2(nz(qc+e2.xy)-nc, nz(qc+e2.yx)-nc)*0.85*wc;
        if(wd > 0.01){
          vec2 qd = p*7.3 + vec2(-uTime*0.23, uTime*0.19);
          float nd = nz(qd); g += vec2(nz(qd+e2.xy)-nd, nz(qd+e2.yx)-nd)*0.55*wd;
        }
      }
      #endif
      // круговые волны от пуль
      float foam = 0.0;
      if(uRA > 0.5) for(int i=0;i<${SEA_RIP_N};i++){
        vec4 r = uRip[i]; float age = uRT - r.z;
        if(age < 0.0 || age > 4.5) continue;
        vec2 dv = p - r.xy; float d = length(dv); vec2 dir = dv/max(d,0.001);
        float amp = r.w*exp(-age*0.85)/(1.0+d*0.55);
        float x1 = d - (age*3.2+0.15), env1 = exp(-x1*x1*1.3);
        float x2 = d - (age*2.0+0.10), env2 = exp(-x2*x2*2.4);
        g += dir*(cos(7.5*x1)*7.5*env1*amp*0.11 + cos(11.0*x2)*11.0*env2*amp*0.06);
        foam += env1*amp*0.55*smoothstep(0.0,0.25,age) + exp(-d*d*9.0)*amp*1.1*exp(-age*3.5);
      }
      // едва заметный прибой: мелкие волны бегут к берегу — только в море (не в озёрах), считается лишь рядом с берегом и близко к камере
      float surf = 0.0;
      if(dist < 110.0 && depth < 2.4 && texture2D(uDepthTex, uv).b > 0.5){
        float zone = smoothstep(0.04, 0.35, depth)*(1.0 - smoothstep(1.3, 2.4, depth))*(1.0 - smoothstep(50.0, 110.0, dist));
        float ph = depth*4.2 + uTime*0.9 + nz(p*0.25)*3.0;
        surf = pow(max(sin(ph), 0.0), 3.0)*zone*(0.55 + 0.45*nz(p*0.6));
        g += vec2(0.0, 0.0);
      }
      vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
      #ifdef SEA_HQ
      N = normalize(mix(N, vec3(0.0,1.0,0.0), smoothstep(60.0, 220.0, dist)));
      #else
      N = normalize(mix(N, vec3(0.0,1.0,0.0), smoothstep(25.0, 140.0, dist)));   // вдали поверхность ровная — без «точек»
      #endif
      float ndv = max(dot(N,V),0.0);
      float fres = 0.02 + 0.98*pow(1.0-ndv, 5.0); fres = clamp(fres*0.85 + 0.03, 0.0, 0.55);
      vec3 R = reflect(-V,N); R.y = abs(R.y);
      vec3 skyH = vec3(0.62,0.80,0.92), skyZ = vec3(0.24,0.50,0.80);
      vec3 refl = mix(skyH, skyZ, pow(clamp(R.y,0.0,1.0),0.6));
      float sp = (pow(max(dot(R,uSun),0.0), 380.0)*1.2*fineK + pow(max(dot(R,uSun),0.0), 36.0)*0.16)*0.8;
      // глубина
      float absorb = 1.0 - exp(-depth*0.42);
      vec3 shallow = vec3(0.26,0.52,0.72), deep = vec3(0.14,0.36,0.58);
      vec3 body = mix(shallow, deep, absorb);
      
      #ifdef SEA_HQ
      sp += pow(max(dot(R,uSun),0.0), 10.0)*0.05;
      #endif
      vec3 col = mix(body, refl, fres) + vec3(1.0,0.95,0.8)*sp;
      col += vec3(0.85,0.95,1.0)*surf*0.14;
      col += vec3(0.70,0.88,0.97)*clamp(length(g)*5.0,0.0,1.0)*0.08*(1.0-smoothstep(60.0,300.0,dist));   //  мягкие светлые блики
      // пена у берега
      float sh = smoothstep(0.30, 0.0, depth);   // узкая полоса пены только у самого берега
      float fn = sh > 0.001 ? vnoise(p*2.2 + vec2(uTime*0.4,0.0)) : 0.0;
      float shore = sh*(0.45 + 0.55*sin(depth*9.0 - uTime*1.2 + fn*2.0))*smoothstep(0.15,0.75,fn+sh*0.5);
      float wz = smoothstep(0.08, 0.5, depth)*(1.0 - smoothstep(3.0, 6.5, depth))*(1.0 - smoothstep(70.0, 220.0, dist));
      float wph = depth*11.0 + uTime*1.5 + vnoise(p*0.07)*2.5;      // фаза растёт со временем и падает к берегу: гребни бегут к берегу
      float crest = 0.0;
      if(wz > 0.002) crest = pow(max(sin(wph), 0.0), 2.5)*wz*(0.45 + 0.55*nz(p*0.3 + vec2(uTime*0.05, 0.0)));
      col += vec3(0.55,0.72,0.78)*crest*0.38;
      float f = clamp(foam + shore*0.25*fineK + crest*0.95*(1.0 - smoothstep(1.0, 8.0, depth)*0.5), 0.0, 1.0);
      col = mix(col, vec3(0.80,0.92,0.98), f*0.6);
      float alpha = mix(0.46, 0.58, 1.0-exp(-depth*1.1))*smoothstep(0.0, 0.10, depth);   // вода чуть прозрачнее
      alpha = clamp(max(alpha, fres*0.8) + f*0.25 + surf*0.08, 0.0, 1.0);
      float fogD = smoothstep(uDMax*0.30, uDMax*0.95, depth);   // где дна уже нет — плавно уходим в туман
      col = mix(col, fogColor, fogD); alpha = mix(alpha, 1.0, fogD);
      gl_FragColor = vec4(col, alpha);
      #include <fog_fragment>
    }`
});
const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE*3, WORLD_SIZE*3), seaMat);
seaMesh.rotation.x = -Math.PI/2; seaMesh.position.y = SEA_Y + SEA_TIDE; seaMesh.renderOrder = 1; seaMesh.frustumCulled = false; scene.add(seaMesh);
/* обрыв: вертикальная стенка цвета глубокой воды по периметру мира, дальше — пустота (небо), ни воды, ни песка */
(function(){
  const H = WORLD_SIZE/2, top = SEA_Y + SEA_TIDE, bot = -60, mat = new THREE.MeshBasicMaterial({color:0x1a3d57, side:THREE.DoubleSide, fog:true});
  [[0,-H,0],[0,H,0],[-H,0,Math.PI/2],[H,0,Math.PI/2]].forEach(w=>{
    const m = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, top-bot), mat); m.position.set(w[0], (top+bot)/2, w[1]); m.rotation.y = w[2]; m.frustumCulled = false; scene.add(m); });
})();
let _seaT0 = performance.now(), _seaLast = _seaT0;
const seaAnim = ()=>{   // вызывается каждый кадр: время рябей идёт всегда, волны — только при включённой «Анимации воды»
  const n = performance.now(), dt = Math.min(0.1, (n-_seaLast)/1000); _seaLast = n;
  seaU.uRT.value = (n-_seaT0)/1000;
  seaU.uRA.value = seaRip.some(r=>seaU.uRT.value - r.z < 4.5 && r.z > -50) ? 1 : 0;
  if(CFG.water){ seaU.uTime.value += dt; seaU.uLvl.value = 0.1+0.1*Math.sin(seaU.uTime.value*0.5); }   // прилив/отлив убран: раньше раз в ~14 с мелководье заливало белой пеной
};
let _ripI = 0;
function seaRipple(x, z, amp){ seaRip[_ripI++ % SEA_RIP_N].set(x, z, seaU.uRT.value, amp); }
let _seaHQ = null;
function applySeaQuality(){   // высокое качество воды — на «Средних» и «Высоких» тенях; на низкой графике вода как раньше
  const hq = (CFG.waterQ|0) >= 1;
  if(hq === _seaHQ) return; _seaHQ = hq;
  if(hq){ seaMat.defines = { SEA_HQ:1 }; seaU.uDepthTex.value = seaBuildDepthHQ(); }
  else { delete seaMat.defines.SEA_HQ; seaU.uDepthTex.value = seaDepthTex; }
  seaMat.needsUpdate = true;
}

/* ---------------- Collidable world objects ---------------- */
const colliders = [];
let COL_WALK = false, colVer = 0;   // COL_WALK: статичные объекты локаций — на них можно встать/сесть
const harvestables = [];
const buildings = [];
const parts = new Map(), partMeshes = [], pendingHp = new Map();

/* плоский кожаный рюкзак (лежит на земле): подушка, ремни, пряжка, свободный лямка */
const _pkLeather = new THREE.MeshStandardMaterial({color:0xa8642e, roughness:0.82}), _pkStrap = new THREE.MeshStandardMaterial({color:0x6a3b1a, roughness:0.9}),
      _pkMetal = new THREE.MeshStandardMaterial({color:0xc4c6c8, roughness:0.35, metalness:0.8}), _pkWeb = new THREE.MeshStandardMaterial({color:0xd8d6cc, roughness:0.95});
const _pkG = { body:(()=>{ const g = new THREE.SphereGeometry(1,28,18); return g; })(), band:new THREE.BoxGeometry(0.05,0.215,0.4), flap:new THREE.BoxGeometry(0.26,0.03,0.22), buckle:new THREE.BoxGeometry(0.045,0.012,0.05), web:new THREE.BoxGeometry(0.32,0.012,0.035) };
function makePackMesh(){
  const g = new THREE.Group(), inner = new THREE.Group(); inner.position.y = 0.105; g.add(inner);
  const body = new THREE.Mesh(_pkG.body, _pkLeather); body.scale.set(0.30,0.105,0.21); inner.add(body);
  [-0.09, 0.075].forEach(x=>{ const b = new THREE.Mesh(_pkG.band, _pkStrap); b.position.set(x,0,0); b.scale.set(1,0.9,1); inner.add(b); });
  const flap = new THREE.Mesh(_pkG.flap, _pkStrap); flap.position.set(0.04,0.1,0); inner.add(flap);
  const bk = new THREE.Mesh(_pkG.buckle, _pkMetal); bk.position.set(0.04,0.118,0.07); inner.add(bk);
  const web = new THREE.Mesh(_pkG.web, _pkWeb); web.position.set(-0.3,-0.06,0.1); web.rotation.y = 0.5;   /* белый ремешок убран */
  g.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  g.userData.inner = inner; return g;
}
const storData = new Map(); let storOpenId = null; let kp = null; let quarOpenId = null; let furOpenId = null;

/* owner — объект (harvestable/здание), которому принадлежит коллайдер.
   Когда объект срублен/добыт — removeCollidersOf(owner) убирает коллизию. */
function addCollider(mesh, owner, shrink){
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  if(shrink){ // сужаем бокс по XZ (для деревьев — только ствол)
    const cx=(box.min.x+box.max.x)/2, cz=(box.min.z+box.max.z)/2;
    box.min.x=cx-shrink; box.max.x=cx+shrink; box.min.z=cz-shrink; box.max.z=cz+shrink;
  }
  const c = {mesh, box, owner: owner||mesh, walk: !!(COL_WALK && !shrink && !(owner && owner.type))};
  colliders.push(c); colVer++;
  return c;
}

/* сетка для быстрых запросов коллайдеров + опора сверху */
const _GC = 8, _cg = new Map(), _nc = []; let _cgVer = -1, _cgSt = 0;
function _colGrid(){
  if(_cgVer === colVer) return; _cg.clear(); _cgVer = colVer;
  for(let i=0;i<colliders.length;i++){ const c = colliders[i], b = c.box;
    const x0=Math.floor(b.min.x/_GC), x1=Math.floor(b.max.x/_GC), z0=Math.floor(b.min.z/_GC), z1=Math.floor(b.max.z/_GC);
    for(let a=x0;a<=x1;a++) for(let d=z0;d<=z1;d++){ const k=a*100003+d; let l=_cg.get(k); if(!l){ l=[]; _cg.set(k,l); } l.push(c); } }
}
function colNear(x,z,r){
  _colGrid(); _nc.length = 0; _cgSt++;
  const x0=Math.floor((x-r)/_GC), x1=Math.floor((x+r)/_GC), z0=Math.floor((z-r)/_GC), z1=Math.floor((z+r)/_GC);
  for(let a=x0;a<=x1;a++) for(let d=z0;d<=z1;d++){ const l=_cg.get(a*100003+d); if(!l) continue;
    for(let i=0;i<l.length;i++){ const c=l[i]; if(c._st!==_cgSt){ c._st=_cgSt; _nc.push(c); } } }
  return _nc;
}
/* верх walk-коллайдера под точкой, на который можно встать (стопа не ниже top-0.6) */
function colTopAt(x,z,feetY){
  let g = -1e9; const cs = colNear(x,z,0.5);
  for(let i=0;i<cs.length;i++){ const c=cs[i]; if(!c.walk) continue; const b=c.box;
    if(x>b.min.x-0.1&&x<b.max.x+0.1&&z>b.min.z-0.1&&z<b.max.z+0.1&&feetY>=b.max.y-0.6&&b.max.y>g) g=b.max.y; }
  return g;
}
/* коллизия кроны: нижний широкий ярус + узкая верхушка (ели — особенно) */
function addCrownCollider(built, scale, x, y, z, h){
  const c = built.crown; if(!c) return;
  const parts = c.taper ? [[c.y0, c.y0+(c.y1-c.y0)*0.5, c.r],[c.y0+(c.y1-c.y0)*0.5, c.y1, c.r*0.55]] : [[c.y0, c.y1, c.r]];
  parts.forEach(p=>{ const hw=p[2]*scale, hh=(p[1]-p[0])*scale;
    const m = new THREE.Mesh(new THREE.BoxGeometry(hw*2,hh,hw*2)); m.position.set(x, y+p[0]*scale+hh/2, z); m.visible=false; scene.add(m);
    if(h.extra) h.extra.push(m); addCollider(m, h); });
}
function removeCollidersOf(owner){
  for(let i=colliders.length-1;i>=0;i--){
    if(colliders[i].owner===owner || colliders[i].mesh===owner){ colliders.splice(i,1); colVer++; }
  }
}
/* полностью убрать объект из мира: меш, коллизию, запись harvestables */
const fallingNodes = [];
const _fallAxis = new THREE.Vector3(), _fallQ = new THREE.Quaternion();
function isDepNode(t){ return t.type==='wood'||t.type==='stone'||t.type==='sulfur'||t.type==='metal'; }
/* сколько списать с узла за удар: 3–5, остаток (всего 50) всегда делится без хвоста */
function nodeTake(t){
  const L = Math.round(t.health); if(L<=5) return Math.max(1,L);
  const ok = [3,4,5].filter(t=>L-t>=3);
  return ok[Math.floor(Math.random()*ok.length)];
}
function updateFalling(dt){
  for(let i=fallingNodes.length-1;i>=0;i--){
    const f = fallingNodes[i]; f.t += dt; const m = f.mesh;
    if(f.tree){
      const k = Math.min(1,f.t/1.5), a = k*k*1.52;
      _fallQ.setFromAxisAngle(f.axis, a); m.quaternion.copy(_fallQ).multiply(f.q0);
      if(f.t>1.5) m.position.y = f.y0 - Math.min(1,(f.t-1.5)/1.2)*1.6;
      if(f.t>2.7) f.done = true;
    } else {
      if(!f.fx){ f.fx = 1; const c = m.position.clone(); c.y += 0.5*f.s0; const ty = f.ty || 'stone';
        spawnDebris(c.clone(), ty, 22, 1.2); spawnDebris(c.clone(), 'stone', 10, 0.8);
        if(CFG.particles) for(let q=0;q<5;q++) fxEmit('smoke', c.clone().add(new THREE.Vector3((Math.random()-.5)*0.8,(Math.random()-.5)*0.5,(Math.random()-.5)*0.8)), new THREE.Vector3((Math.random()-.5)*0.6,0.5,(Math.random()-.5)*0.6), 0.9, 0.3, 1.3, 0x8b867d, 0xc9c4ba, {drag:1.2, a:0.5}); }
      const k = Math.min(1,f.t/0.22); m.scale.setScalar(f.s0*(1-k*k*k));     // на месте, без проваливания вниз
      if(f.t>=0.22) f.done = true;
    }
    if(f.done){ scene.remove(m); m.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); fallingNodes.splice(i,1); }
  }
}
function destroyHarvestable(target, anim){
  if(window.OSIL_NET) OSIL_NET.onDestroy(target);
  removeCollidersOf(target);
  if(anim && target.mesh && isDepNode(target)){
    const idx0 = harvestables.indexOf(target); if(idx0>=0) harvestables.splice(idx0,1);
    rebuildHarvestHitMap();
    const m = target.mesh, ang = Math.random()*6.283;
    _fallAxis.set(Math.cos(ang),0,Math.sin(ang));
    fallingNodes.push({mesh:m, t:0, ty:target.type, tree:target.type==='wood', axis:_fallAxis.clone(), q0:m.quaternion.clone(), y0:m.position.y, s0:m.scale.x});
    return;
  }
  scene.remove(target.mesh);
  target.mesh.traverse(o=>{ if(o.geometry) o.geometry.dispose(); });
  const idx = harvestables.indexOf(target);
  if(idx>=0) harvestables.splice(idx,1);
  rebuildHarvestHitMap();
}

/* ---------------- Материалы мира ---------------- */
const barkMat    = new THREE.MeshStandardMaterial({map:barkTex, roughness:1});
const pineMat    = new THREE.MeshStandardMaterial({map:foliageTex, roughness:1, flatShading:true});
const leafMat    = new THREE.MeshStandardMaterial({map:leafTex, roughness:1, flatShading:true});
const stoneMat   = new THREE.MeshStandardMaterial({map:rockOreTex, color:0xd8d4cc, roughness:1, flatShading:true});   // руда — без текстуры
const sulfurMat  = new THREE.MeshStandardMaterial({map:sulfurTex, roughness:0.9, flatShading:true});
const metalMat2  = new THREE.MeshStandardMaterial({map:metalTex, roughness:0.85, flatShading:true});
const bushMat    = new THREE.MeshStandardMaterial({map:leafTex, roughness:1, flatShading:true, color:0xb8d8a0});

/* Небольшая деформация вершин — чтобы шары/конусы не выглядели идеальными */
function jitter(geo, amt){
  const p = geo.attributes.position;
  const seen = new Map();
  for(let i=0;i<p.count;i++){
    const k = p.getX(i).toFixed(3)+'_'+p.getY(i).toFixed(3)+'_'+p.getZ(i).toFixed(3);
    if(!seen.has(k)) seen.set(k,[(Math.random()-0.5)*amt,(Math.random()-0.5)*amt,(Math.random()-0.5)*amt]);
    const o = seen.get(k);
    p.setXYZ(i, p.getX(i)+o[0], p.getY(i)+o[1], p.getZ(i)+o[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---- Дерево: ствол с расширением у корней + корневые «лапы» + ветки + крона ---- */
function buildTrunk(h, rBase, rTop){
  // ствол сужается кверху, внизу расширяется (корни)
  const geo = new THREE.CylinderGeometry(rTop, rBase*1.35, h, 10, 4);
  const pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const y = pos.getY(i);
    const t = (y + h/2)/h;          // 0 низ .. 1 верх
    const flare = Math.pow(1-t, 6) * 0.35;
    const ang = Math.atan2(pos.getZ(i), pos.getX(i));
    const wob = 1 + Math.sin(ang*3 + y*2)*0.04 + flare;
    pos.setX(i, pos.getX(i)*wob);
    pos.setZ(i, pos.getZ(i)*wob);
  }
  geo.computeVertexNormals();
  // UV: кора тянется по высоте
  const uv = geo.attributes.uv;
  for(let i=0;i<uv.count;i++) uv.setY(i, uv.getY(i)*Math.max(1,h/2.2));
  return new THREE.Mesh(geo, barkMat);
}

function addRootFlares(group, rBase, n){
  for(let i=0;i<n;i++){
    const a = (i/n)*Math.PI*2 + Math.random()*0.5;
    const len = rBase*(1.6+Math.random()*0.8);
    const root = new THREE.Mesh(new THREE.ConeGeometry(rBase*0.34, len, 5), barkMat);
    root.position.set(Math.cos(a)*rBase*1.1, 0.12, Math.sin(a)*rBase*1.1);
    root.rotation.z = Math.cos(a)*Math.PI/2.4;
    root.rotation.x = -Math.sin(a)*Math.PI/2.4;
    root.castShadow = true;
    group.add(root);
  }
}

function makePine(x,z){
  const group = new THREE.Group();
  const h = 5.5 + Math.random()*3;
  const rBase = 0.24 + Math.random()*0.08;
  const trunk = buildTrunk(h, rBase, 0.09);
  trunk.position.y = h/2; trunk.castShadow = true;
  group.add(trunk);
  addRootFlares(group, rBase, 5);
  // ярусы хвои: снизу широкие, кверху уже, лёгкий наклон/деформация
  const tiers = 5 + Math.floor(Math.random()*2);
  for(let i=0;i<tiers;i++){
    const t = i/(tiers-1);
    const r = (2.1 - t*1.5) * (0.9+Math.random()*0.2);
    const ch = 1.9 - t*0.5;
    const cone = new THREE.Mesh(jitter(new THREE.ConeGeometry(r, ch, 9, 1), 0.18), pineMat);
    cone.position.y = h*0.30 + t*h*0.62;
    cone.rotation.y = Math.random()*6.28;
    cone.castShadow = true;
    group.add(cone);
  }
  return {group, trunkR:rBase*1.3, height:h+1, crown:{r:1.3, y0:h*0.30-0.9, y1:h+1, taper:true}};
}

function makeOak(x,z){
  const group = new THREE.Group();
  const h = 3.2 + Math.random()*1.4;
  const rBase = 0.3 + Math.random()*0.08;
  const trunk = buildTrunk(h, rBase, 0.17);
  trunk.position.y = h/2; trunk.castShadow = true;
  group.add(trunk);
  addRootFlares(group, rBase, 6);
  // 3 толстые ветки
  for(let i=0;i<3;i++){
    const a = i*2.1 + Math.random();
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.1,1.4,6), barkMat);
    br.position.set(Math.cos(a)*0.5, h*0.85, Math.sin(a)*0.5);
    br.rotation.z = Math.cos(a)*0.9; br.rotation.x = -Math.sin(a)*0.9;
    br.castShadow = true;
    group.add(br);
  }
  // крона из нескольких деформированных «шаров»
  const blobs = 5;
  for(let i=0;i<blobs;i++){
    const a = (i/blobs)*Math.PI*2;
    const r = 1.1 + Math.random()*0.5;
    const blob = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(r, 1), 0.28), leafMat);
    blob.position.set(i===0?0:Math.cos(a)*1.0, h + 0.7 + (i===0?0.7:Math.random()*0.6), i===0?0:Math.sin(a)*1.0);
    blob.castShadow = true;
    group.add(blob);
  }
  return {group, trunkR:rBase*1.3, height:h+2.4, crown:{r:1.6, y0:h-0.2, y1:h+2.4}};
}

function makeTree(x,z){
  const built = Math.random()<0.6 ? makePine(x,z) : makeOak(x,z);
  const group = built.group;
  group.rotation.y = Math.random()*6.28;
  const scale = 0.9 + Math.random()*0.35;
  group.scale.setScalar(scale);
  const y = heightAt(x,z);
  group.position.set(x,y,z);
  scene.add(group);

  // невидимый цилиндр-коллайдер только по стволу (крона не мешает ходить)
  const trunkR = built.trunkR*scale;
  const colMesh = new THREE.Mesh(new THREE.CylinderGeometry(trunkR,trunkR,built.height*scale,8));
  colMesh.position.set(x, y+built.height*scale/2, z);
  colMesh.visible = false;
  scene.add(colMesh);
  const h = {mesh:group, hitMesh:group, type:'wood', health:50, maxHealth:50, giveMin:6, giveMax:10, radius:1.6, extra:[colMesh]};
  addCollider(colMesh, h, trunkR); addCrownCollider(built, scale, x, y, z, h);
  harvestables.push(h);
  return group;
}

/* ---- Камни/руды: несколько сросшихся деформированных глыб ---- */
function makeOreCluster(x,z, mat, type, cfg){
  const group = new THREE.Group();
  const base = cfg.size*(0.85+Math.random()*0.5);
  const main = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(base,1), base*0.32), mat);
  main.scale.set(1, 0.72+Math.random()*0.3, 1);
  main.position.y = base*0.45;
  main.rotation.set(Math.random()*0.5, Math.random()*6.28, Math.random()*0.5);
  main.castShadow = true; main.receiveShadow = true;
  group.add(main);
  const n = 2+Math.floor(Math.random()*2);
  for(let i=0;i<n;i++){
    const a = Math.random()*6.28, d = base*(0.7+Math.random()*0.4);
    const r = base*(0.35+Math.random()*0.3);
    const m = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(r,0), r*0.35), mat);
    m.position.set(Math.cos(a)*d, r*0.35, Math.sin(a)*d);
    m.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  const y = heightAt(x,z);
  group.position.set(x,y,z);
  group.rotation.y = Math.random()*6.28;
  scene.add(group);
  const h = {mesh:group, hitMesh:group, type, health:50, maxHealth:50, giveMin:cfg.min, giveMax:cfg.max, radius:base+0.5};
  addCollider(group, h);
  harvestables.push(h);
  return group;
}
function makeRock(x,z){   return makeOreCluster(x,z, stoneMat,  'stone',  {size:0.9, hp:70, min:8, max:14}); }
function makeSulfurNode(x,z){ return makeOreCluster(x,z, sulfurMat, 'sulfur', {size:0.8, hp:80, min:6, max:10}); }
function makeMetalNode(x,z){  return makeOreCluster(x,z, metalMat2, 'metal',  {size:0.8, hp:80, min:5, max:9}); }

/* Bushes (cloth) */
function makeBush(x,z){
  const group = new THREE.Group();
  for(let i=0;i<4;i++){
    const r = 0.38+Math.random()*0.25;
    const b = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(r,1), 0.16), bushMat);
    b.position.set((Math.random()-0.5)*0.7, r*0.8, (Math.random()-0.5)*0.7);
    b.castShadow = true;
    group.add(b);
  }
  group.position.set(x, heightAt(x,z), z);
  scene.add(group);
  const h = {mesh:group, hitMesh:group, type:'cloth', health:30, maxHealth:30, giveMin:2, giveMax:5, radius:1.2};
  // у кустов коллизии нет — через них можно ходить
  harvestables.push(h);
  return group;
}


/* Бочки с металлоломом: разбиваются, дают 7–14 металлолома */
/* ---- Зимние деревья и кусты (снежный биом) ---- */
const wTrunkMat = new THREE.MeshStandardMaterial({color:0x4a3a2e, roughness:1, flatShading:true});
const wNeedleMat = new THREE.MeshStandardMaterial({color:0x2f4a3c, roughness:0.95, flatShading:true});
const wSnowMat = new THREE.MeshStandardMaterial({color:0xf2f7fb, roughness:0.9, flatShading:true});
const wBirchMat = new THREE.MeshStandardMaterial({color:0xcfc9bf, roughness:0.9, flatShading:true});
const wTwigMat = new THREE.MeshStandardMaterial({color:0x5a4a3c, roughness:1, flatShading:true});
const wBushMat = new THREE.MeshStandardMaterial({color:0x6b5a46, roughness:1, flatShading:true});
function makeWinterSpruce(){
  const g = new THREE.Group(), H = 5.5 + Math.random()*2.5;
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.28,H*0.35,7), wTrunkMat); tr.position.y = H*0.175; tr.castShadow = true; g.add(tr);
  const tiers = 5;
  for(let i=0;i<tiers;i++){
    const t = i/(tiers-1), r = (2.0 - t*1.5)*(0.9+Math.random()*0.2), h = 1.9 - t*0.5, y = H*0.28 + t*H*0.58;
    const c = new THREE.Mesh(jitter(new THREE.ConeGeometry(r,h,9,1), 0.1), wNeedleMat); c.position.y = y; c.rotation.y = Math.random()*6; c.castShadow = true; g.add(c);
    const sc = new THREE.Mesh(jitter(new THREE.ConeGeometry(r*0.8,h*0.5,9,1), 0.08), wSnowMat); sc.position.y = y + h*0.27; sc.rotation.y = c.rotation.y; g.add(sc);   // снежная шапка яруса
  }
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.28,0.9,7), wSnowMat); top.position.y = H*0.28 + H*0.58 + 0.95; g.add(top);
  return {group:g, trunkR:0.3, height:H, crown:{r:1.3, y0:H*0.28-0.95, y1:H+0.5, taper:true}};
}
function makeWinterBare(){      // голое дерево (берёза/клён без листьев), снег на ветках
  const g = new THREE.Group(), H = 4.5 + Math.random()*2;
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.22,H*0.75,7), wBirchMat); tr.position.y = H*0.375; tr.castShadow = true; g.add(tr);
  const n = 7 + Math.floor(Math.random()*4);
  for(let i=0;i<n;i++){
    const t = i/n, len = (1.6 - t*0.8)*(0.8+Math.random()*0.5), a = i*2.4 + Math.random(), y = H*(0.35+t*0.55);
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.06,len,5), wTwigMat);
    br.position.set(Math.cos(a)*len*0.3, y+len*0.25, Math.sin(a)*len*0.3);
    br.rotation.set(Math.sin(a)*0.9, 0, -Math.cos(a)*0.9); br.castShadow = true; g.add(br);
    const sn = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.04,len*0.8), wSnowMat); sn.position.copy(br.position); sn.position.y += 0.05; sn.rotation.copy(br.rotation); g.add(sn);
  }
  return {group:g, trunkR:0.22, height:H};
}
function makeWinterTree(x,z){
  const built = Math.random()<0.7 ? makeWinterSpruce() : makeWinterBare();
  const group = built.group, scale = 0.9 + Math.random()*0.35;
  group.rotation.y = Math.random()*6.28; group.scale.setScalar(scale);
  const y = heightAt(x,z); group.position.set(x,y,z); scene.add(group);
  const trunkR = built.trunkR*scale;
  const colMesh = new THREE.Mesh(new THREE.CylinderGeometry(trunkR,trunkR,built.height*scale,8));
  colMesh.position.set(x, y+built.height*scale/2, z); colMesh.visible = false; scene.add(colMesh);
  const h = {mesh:group, hitMesh:group, type:'wood', health:50, maxHealth:50, giveMin:6, giveMax:10, radius:1.6, extra:[colMesh]};
  addCollider(colMesh, h, trunkR); addCrownCollider(built, scale, x, y, z, h); harvestables.push(h);
  return group;
}
function makeWinterBush(x,z){   // сухой куст в снегу — даёт ткань, как обычный
  const group = new THREE.Group();
  for(let i=0;i<7;i++){
    const a = i*0.9 + Math.random(), len = 0.7 + Math.random()*0.5;
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.035,len,5), wBushMat);
    tw.position.set(Math.cos(a)*0.18, len*0.45, Math.sin(a)*0.18); tw.rotation.set(Math.sin(a)*0.55, 0, -Math.cos(a)*0.55); tw.castShadow = true; group.add(tw);
  }
  for(let i=0;i<3;i++){ const r = 0.25+Math.random()*0.18; const sn = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(r,1), 0.08), wSnowMat); sn.scale.y = 0.55; sn.position.set((Math.random()-0.5)*0.5, 0.18+Math.random()*0.15, (Math.random()-0.5)*0.5); group.add(sn); }
  const sh = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.42,1), 0.12), new THREE.MeshStandardMaterial({color:0x3d5a45, roughness:1, flatShading:true})); sh.scale.y = 0.6; sh.position.y = 0.25; group.add(sh);   // замёрзшая хвоя
  group.position.set(x, heightAt(x,z), z); scene.add(group);
  const h = {mesh:group, hitMesh:group, type:'cloth', health:30, maxHealth:30, giveMin:2, giveMax:5, radius:1.2};
  harvestables.push(h); return group;
}

const barrelBodyMat = new THREE.MeshStandardMaterial({color:0x8a3b2a, roughness:0.8, metalness:0.3, flatShading:true});
const barrelRingMat = new THREE.MeshStandardMaterial({color:0x3a3a3e, roughness:0.6, metalness:0.6, flatShading:true});
function makeBarrel(x,z){
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36,0.36,0.95,14), barrelBodyMat); body.position.y=0.475; body.castShadow=true; group.add(body);
  [0.12,0.475,0.83].forEach(y=>{ const r=new THREE.Mesh(new THREE.CylinderGeometry(0.375,0.375,0.05,14), barrelRingMat); r.position.y=y; group.add(r); });
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.33,0.33,0.03,14), barrelRingMat); lid.position.y=0.96; group.add(lid);
  group.rotation.y = Math.random()*6.28;
  group.position.set(x, heightAt(x,z), z);
  scene.add(group);
  const h = {mesh:group, hitMesh:group, type:'scrap', health:40, maxHealth:40, giveMin:7, giveMax:14, radius:1.0, oneShot:true};
  addCollider(group, h);
  harvestables.push(h);
  return group;
}

/* Найти точку спавна: суша, равнина/лес, не у воды. Детерминированно от seed. */
const SPAWN = (function(){
  const rnd = WorldGen.mulberry32(WORLD_SEED+5);
  let best = null;
  for(let t=0;t<4000;t++){
    const x=(rnd()-0.5)*WORLD_SIZE*0.7, z=(rnd()-0.5)*WORLD_SIZE*0.7;
    const bm = biomeAt(x,z);
    if(bm!==B.PLAIN && bm!==B.FOREST) continue;
    // вокруг в радиусе ~14 м должна быть суша
    let ok=true;
    for(let a=0;a<8&&ok;a++){ if(isWaterAt(x+Math.cos(a*0.785)*14, z+Math.sin(a*0.785)*14)) ok=false; }
    if(ok){ best={x,z}; break; }
  }
  return best || {x:0,z:0};
})();

/* scatter: объекты только на суше нужных биомов. biomes — список допустимых. */
const _rnd = WorldGen.mulberry32(WORLD_SEED+77);
function scatter(n, fn, minDist, biomes){
  let placed = 0, tries = 0;
  const pts = [];
  while(placed<n && tries<n*60){
    tries++;
    const x = (_rnd()-0.5)*WORLD_SIZE*0.96;
    const z = (_rnd()-0.5)*WORLD_SIZE*0.96;
    const bm = biomeAt(x,z);
    if(biomes && !biomes.includes(bm)) continue;
    if(!biomes && isWaterAt(x,z)) continue;
    if(Math.hypot(x-SPAWN.x, z-SPAWN.z) < 6) continue;         // зона спавна
    if(pts.some(p=>Math.hypot(p[0]-x,p[1]-z)<minDist)) continue;
    pts.push([x,z]); fn(x,z); placed++;
  }
}
const __sceneBefore = new Set(scene.children);
const LAND_ALL = [B.PLAIN,B.FOREST,B.DESERT,B.SNOW,B.ROCK,B.BEACH];
scatter(173, makeTree, 6, [B.FOREST]);                 // густой лес
scatter(45,  makeTree, 9, [B.PLAIN]);                  // редкие деревья на равнине
scatter(53,  makeWinterTree, 7, [B.SNOW]);
scatter(60,  makeWinterBush, 5, [B.SNOW]);                   // заснеженные сосны
scatter(53,  makeRock, 6, [B.PLAIN,B.FOREST,B.SNOW,B.ROCK]);
scatter(34,  makeRock, 7, [B.DESERT]);                 // пустыня — россыпь камней
scatter(29,  makeSulfurNode, 12, [B.DESERT,B.ROCK,B.SNOW,B.PLAIN]);
scatter(27,  makeMetalNode,  12, [B.DESERT,B.ROCK,B.SNOW,B.PLAIN]);
scatter(80,  makeBush, 4, [B.PLAIN,B.FOREST]);

/* ---- Отсечение по расстоянию ----
   Деревья/руды/кусты — сотни групп по нескольку мешей. Далеко от игрока их не рисуем,
   а тени отбрасывают только те, что рядом. Обновляется 5 раз в секунду. */
const cullables = [];
function registerCullable(obj){
  const meshes=[]; obj.traverse(o=>{ if(o.isMesh) meshes.push(o); });
  const bb = new THREE.Box3().setFromObject(obj);
  const tall = (bb.max.y - bb.min.y) > 4;          // деревья видны дальше, мелочь — ближе
  const R = tall ? 115 : 70;
  cullables.push({obj, meshes, shadow:true, vis:true, r2b:R*R, r2:R*R*CULL_K});
  meshes.forEach(m=>{ m._cs = m.castShadow; });
}

/* ---- Склейка мешей: у дерева было 10–13 отдельных мешей (ствол, корни, ярусы хвои...),
   каждый — отдельный draw call, да ещё и второй раз в проходе теней. Склеиваем все меши
   объекта с одним материалом в один: геометрия и текстуры те же, картинка не меняется,
   а draw call'ов в 5–6 раз меньше. ---- */
function mergeGroupByMaterial(group){
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map(), old = [];
  group.children.forEach(ch=>{
    if(!ch.isMesh || !ch.geometry || !ch.material || Array.isArray(ch.material)) return;
    let b = buckets.get(ch.material);
    if(!b){ b = {mat:ch.material, geos:[], cs:false, rs:false}; buckets.set(ch.material, b); }
    ch.updateMatrix();
    let g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone();
    g.applyMatrix4(ch.matrix);
    if(!g.attributes.normal) g.computeVertexNormals();
    if(!g.attributes.uv){ g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2)); }
    ['color','uv2','tangent'].forEach(n=>{ if(g.attributes[n]) g.deleteAttribute(n); });
    b.geos.push(g); b.cs = b.cs || ch.castShadow; b.rs = b.rs || ch.receiveShadow;
    old.push(ch);
  });
  buckets.forEach(b=>{
    let n = 0; b.geos.forEach(g=>{ n += g.attributes.position.count; });
    const pos = new Float32Array(n*3), nor = new Float32Array(n*3), uv = new Float32Array(n*2);
    let o = 0;
    b.geos.forEach(g=>{
      pos.set(g.attributes.position.array, o*3); nor.set(g.attributes.normal.array, o*3); uv.set(g.attributes.uv.array, o*2);
      o += g.attributes.position.count; g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(nor,3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(uv,2));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const m = new THREE.Mesh(geo, b.mat); m.castShadow = b.cs; m.receiveShadow = b.rs;
    group.add(m);
  });
  old.forEach(ch=>{ group.remove(ch); if(ch.geometry) ch.geometry.dispose(); });
}
harvestables.forEach(h=>{ if(h.mesh && h.mesh.isGroup) mergeGroupByMaterial(h.mesh); });

scene.children.forEach(o=>{ if(!__sceneBefore.has(o) && o.position && o.children && o.visible !== false) registerCullable(o); });
let SHADOW_R2 = (CFG.shadowDist||60)*1.44*(CFG.shadowDist||60);
let cullT = 0;
function updateCulling(dt, force){
  cullT -= dt; if(cullT>0 && !force) return; cullT = 0.2;
  const px=player.pos.x, pz=player.pos.z;
  for(let i=0;i<cullables.length;i++){
    const c=cullables[i], dx=c.obj.position.x-px, dz=c.obj.position.z-pz, d2=dx*dx+dz*dz;
    const vis = d2<c.r2;
    if(vis!==c.vis){ c.obj.visible=vis; c.vis=vis; shadowDirty = true; }
    if(!vis) continue;
    const sh = c.shadow ? d2<SHADOW_R2*1.12 : d2<SHADOW_R2*0.9;   // гистерезис: тень не мигает на границе
    if(sh!==c.shadow){ c.shadow=sh; shadowDirty = true; for(let k=0;k<c.meshes.length;k++) c.meshes[k].castShadow = sh && c.meshes[k]._cs; }
  }
}

/* случайная точка на пляже: биом BEACH, не вода, без коллизий */
function beachSpawn(){
  const half = WORLD_SIZE/2-6; let fb = null;
  for(let t=0;t<6000;t++){
    const x=(Math.random()*2-1)*half, z=(Math.random()*2-1)*half;
    if(biomeAt(x,z)!==B.BEACH) continue;
    const h = heightAt(x,z); if(h < 0.35 || isWaterAt(x,z)) continue;
    let ok = true; const cs = colNear(x,z,2);
    for(let i=0;i<cs.length&&ok;i++){ const b=cs[i].box; if(x>b.min.x-1&&x<b.max.x+1&&z>b.min.z-1&&z<b.max.z+1) ok=false; }
    if(!ok) continue;
    if(!fb) fb={x,z};
    let dry=true; for(let a=0;a<6&&dry;a++){ if(isWaterAt(x+Math.cos(a*1.047)*2, z+Math.sin(a*1.047)*2)) dry=false; }
    if(dry) return {x,z};
  }
  return fb || SPAWN;
}
/* ---------------- Player ---------------- */
const _bs0 = beachSpawn();
const player = {
  pos: new THREE.Vector3(_bs0.x, heightAt(_bs0.x,_bs0.z)+2, _bs0.z),
  velY: 0,
  onGround: false,
  yaw: Math.PI,
  pitch: -0.05,
  height: 1.7,
  speed: 5.5,
  runMult: 1.6,
  hp:100, hunger:100, thirst:100, stamina:100,
};
camera.rotation.order = 'YXZ';

let camKick = 0;   // короткий «толчок» камеры при попадании
var isCrouching = false;
const orbit = {yaw: Math.PI, pitch: 0.25};
function lookTarget(){ return CFG.camMode===3 ? orbit : player; }
const _eye = new THREE.Vector3();
let _eyeSY = null, _eyeST = 0;
function _smoothEyeY(ty){      // подъём/спуск по рельефу: глаза плавно догоняют высоту, без дёрганья на каждой неровности
  const n = performance.now(), dt = Math.min(0.05, Math.max(0.001, (n-_eyeST)/1000)); _eyeST = n;
  if(_eyeSY===null || Math.abs(ty-_eyeSY) > 1.1) _eyeSY = ty;
  else _eyeSY += (ty-_eyeSY)*(1-Math.exp(-dt*20));
  return _eyeSY;
}
function updateCameraFromPlayer(){
  const mode = CFG.camMode|0;
  const cy = player.height;
  _eye.set(player.pos.x, _smoothEyeY(player.pos.y + cy), player.pos.z);
  if(mode===0){
    camera.position.copy(_eye);
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch + camKick;
  } else if(mode===1){            // 2-е лицо: камера спереди, смотрит на игрока
    const cp=Math.cos(player.pitch);
    camera.position.set(_eye.x - Math.sin(player.yaw)*cp*3, _eye.y + Math.sin(player.pitch)*3 + 0.2, _eye.z - Math.cos(player.yaw)*cp*3);
    camera.lookAt(_eye);
  } else {                        // 3-е лицо = «осмотр», жёстко привязанный к игроку; осмотр — свободная орбита
    const yw = mode===3 ? orbit.yaw : player.yaw, pt = mode===3 ? orbit.pitch : Math.max(-0.6, Math.min(1.0, player.pitch*0.8 + 0.2));
    const d = 3.6, cp=Math.cos(pt);
    camera.position.set(_eye.x + Math.sin(yw)*cp*d, _eye.y - Math.sin(pt)*d + 0.35, _eye.z + Math.cos(yw)*cp*d);
    camera.lookAt(_eye);
  }
  if(mode!==0){ const g=heightAt(camera.position.x,camera.position.z)+0.4; if(camera.position.y<g) camera.position.y=g; }
  viewGroup.visible = (mode===0);
}

/* ---------------- Модель игрока + анимация ходьбы ---------------- */
function buildHumanRig(jc){
  jc = jc||0x4d5b3d;
  const root = new THREE.Group();
  let sd = 7; const rnd = ()=>{ sd = (sd*16807)%2147483647; return sd/2147483647; };
  const pxTex = (w,h,fn)=>{ const c=document.createElement('canvas'); c.width=w; c.height=h; fn(c.getContext('2d'),w,h);
    const t=new THREE.CanvasTexture(c); t.magFilter=THREE.NearestFilter; t.minFilter=THREE.NearestFilter; t.generateMipmaps=false; return t; };
  const fab = pxTex(8,8,(g,w,h)=>{ for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const v=255-Math.floor(rnd()*38); g.fillStyle='rgb('+v+','+v+','+v+')'; g.fillRect(x,y,1,1); } });
  const L = (c,map,extra)=>new THREE.MeshLambertMaterial(Object.assign({color:c,map:map||null},extra||{}));
  const jacket=L(jc,fab), jacketD=L(new THREE.Color(jc).multiplyScalar(0.78).getHex(),fab), pants=L(0x35404f,fab), boot=L(0x2b2119,fab), belt=L(0x2a2018), sole=L(0x0f0f0f), skinM=L(0xd8a77e,fab), zip=L(0xb9bcc0);
  const bx = (w,h,d,m,x,y,z,par)=>{ const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m); o.position.set(x,y,z); o.castShadow=true; par.add(o); return o; };
  const grp = (x,y,z)=>{ const g=new THREE.Group(); g.position.set(x,y,z); return g; };

  /* ---- голова: пиксельное лицо + отдельный слой волос (как «шляпа» в майнкрафте) ---- */
  const SK=['#d9a77c','#d4a176','#dcaa80','#d6a378'], HR=['#3a281a','#46311f','#2f2015','#523a25'];
  const skinPx = (g,n)=>{ for(let y=0;y<n;y++) for(let x=0;x<n;x++){ g.fillStyle=SK[(rnd()*4)|0]; g.fillRect(x,y,1,1); } };
  const hairPx = (g,x,y)=>{ g.fillStyle=HR[(x*7+((rnd()*2)|0))%4]; g.fillRect(x,y,1,1); };   // вертикальные пряди разных тонов
  const px = (g,c,x,y,w,h)=>{ g.fillStyle=c; g.fillRect(x,y,w||1,h||1); };
  const skinTex = pxTex(16,16,g=>skinPx(g,16));
  const face = pxTex(16,16,g=>{ skinPx(g,16);
    px(g,'#b98560',3,7,4,1); px(g,'#b98560',9,7,4,1);                                   // тень век
    px(g,'#3b2a1c',2,6,5,1); px(g,'#3b2a1c',9,6,5,1);                                   // брови
    px(g,'#ffffff',3,8,2,2); px(g,'#3d5f9a',5,8,2,2); px(g,'#141b30',6,8,1,2);          // левый глаз: белок, радужка, зрачок
    px(g,'#3d5f9a',9,8,2,2); px(g,'#141b30',9,8,1,2); px(g,'#ffffff',11,8,2,2);         // правый глаз
    px(g,'#c4926a',7,10,2,2); px(g,'#ae7c58',7,12,2,1);                                 // нос
    px(g,'#9a5f45',5,13,6,1); px(g,'#b27758',6,14,4,1); });                              // рот, нижняя губа
  const sideSk = pxTex(16,16,g=>{ skinPx(g,16); px(g,'#c99670',6,8,4,4); px(g,'#b38058',7,9,2,2); });   // ухо
  const hSide = plus=>pxTex(16,16,g=>{
    for(let y=0;y<6;y++) for(let x=0;x<16;x++) hairPx(g,x,y);                           // над ухом
    for(let i=0;i<7;i++){ const x=plus?i:15-i; for(let y=6;y<12;y++) hairPx(g,x,y); }  // за ухом до затылка
    for(let i=0;i<5;i++){ const x=plus?i:15-i; if(rnd()<0.8) hairPx(g,x,12); if(i<3&&rnd()<0.5) hairPx(g,x,13); }
    for(let i=0;i<2;i++){ const x=plus?15-i:i; for(let y=6;y<9;y++) hairPx(g,x,y); } });  // бакенбарды
  const hTop = pxTex(16,16,g=>{ for(let y=0;y<16;y++) for(let x=0;x<16;x++) hairPx(g,x,y); });
  const hBack = pxTex(16,16,g=>{ for(let y=0;y<12;y++) for(let x=0;x<16;x++) hairPx(g,x,y);
    for(let x=0;x<16;x++){ if(rnd()<0.8) hairPx(g,x,12); if(rnd()<0.6) hairPx(g,x,13); if(x>1&&x<14&&rnd()<0.25) hairPx(g,x,14); } });
  const hFront = pxTex(16,16,g=>{ for(let y=0;y<3;y++) for(let x=0;x<16;x++) hairPx(g,x,y);   // чёлка
    for(let y=3;y<5;y++) for(let x=0;x<16;x++) if(x<6||x>9) hairPx(g,x,y);                  // пробор по центру
    for(let y=5;y<8;y++) for(let x=0;x<16;x++) if(x<2||x>13) hairPx(g,x,y);                 // виски
    if(rnd()<0.7) hairPx(g,6,5); if(rnd()<0.7) hairPx(g,9,5); if(rnd()<0.5) hairPx(g,3,5); if(rnd()<0.5) hairPx(g,12,5); });
  const hNone = pxTex(16,16,()=>{});
  const HL = t=>L(0xffffff,t,{alphaTest:0.5});
  const SL = t=>L(0xffffff,t);
  /* порядок граней BoxGeometry: +x, -x, +y, -y, +z (спина), -z (лицо; вперёд = -z) */
  const torso=grp(0,0.92,0); root.add(torso);
  bx(0.38,0.50,0.21,jacket,0,0.33,0,torso);                       // грудь и плечи
  bx(0.385,0.11,0.215,pants,0,0.025,0,torso);                     // низ корпуса
  bx(0.392,0.05,0.222,belt,0,0.085,0,torso);                      // ремень
  bx(0.05,0.03,0.022,zip,0,0.085,-0.002,torso).position.z=-0.108; // пряжка
  bx(0.012,0.40,0.004,zip,0,0.33,-0.107,torso);                   // молния
  bx(0.085,0.075,0.010,jacketD,-0.11,0.31,-0.106,torso); bx(0.085,0.075,0.010,jacketD,0.11,0.31,-0.106,torso);  // нагрудные карманы
  const head=grp(0,0.58,0); torso.add(head);
  const skull=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.34,0.34),[SL(sideSk),SL(sideSk),SL(skinTex),SL(skinTex),SL(skinTex),SL(face)]);
  skull.position.y=0.17; skull.castShadow=true; head.add(skull);
  const hair=new THREE.Mesh(new THREE.BoxGeometry(0.364,0.364,0.364),[HL(hSide(true)),HL(hSide(false)),HL(hTop),HL(hNone),HL(hBack),HL(hFront)]);
  hair.position.set(0,0.176,0.004); head.add(hair);

  const mkLeg=(x)=>{
    const hip=grp(x,0.92,0);
    bx(0.175,0.45,0.18,pants,0,-0.21,0,hip);
    const knee=grp(0,-0.42,0); hip.add(knee);
    bx(0.172,0.52,0.176,pants,0,-0.24,0,knee);
    bx(0.19,0.13,0.24,boot,0,-0.435,-0.03,knee);                  // ботинок
    bx(0.194,0.03,0.244,sole,0,-0.485,-0.03,knee);                // подошва
    root.add(hip); return {hip,knee};
  };
  const legL=mkLeg(-0.0875), legR=mkLeg(0.0875);
  const mkArm=(x)=>{
    const sh=grp(x,0.47,0);
    bx(0.165,0.39,0.165,jacket,0,-0.11,0,sh);                      // плечо (от уровня верха корпуса)
    const el=grp(0,-0.3,0); sh.add(el);
    bx(0.158,0.17,0.158,jacketD,0,-0.07,0,el);                    // рукав
    bx(0.128,0.15,0.128,skinM,0,-0.225,0,el);                       // предплечье
    bx(0.112,0.075,0.07,skinM,0,-0.318,0,el);                       // ладонь
    for(let i=0;i<4;i++){ const fg=bx(0.025,0.062,0.024,skinM,-0.040+i*0.027,-0.358,-0.032,el); fg.rotation.x=0.55; }   // пальцы
    { const sg=x>0?1:-1, th=bx(0.03,0.055,0.03,skinM,-sg*0.07,-0.326,-0.022,el); th.rotation.z=sg*0.5; }              // большой палец
    const hold=grp(0,-0.3,0); el.add(hold);
    torso.add(sh); return {sh,el,hold};
  };
  const armL=mkArm(-0.265), armR=mkArm(0.265);
  return {root,torso,head,legL,legR,armL,armR,jacketM:jacket,jacketDM:jacketD,phase:0,amp:0,swing:0,lx:0,lz:0,held:null,heldKind:'none',toolMeshes:{}};
}
function setRigSuit(m,on){
  if(!!m.suit===on) return;
  if(!on){ m.suit.forEach(o=>o.parent&&o.parent.remove(o)); m.suit=null; m.head.children.forEach(o=>{ if(o.userData.hid) o.visible=true; }); return; }
  const M=c=>new THREE.MeshLambertMaterial({color:c}), green=M(0x3f5a34), dark=M(0x2b2d2a), plate=M(0x4a4a44), visor=new THREE.MeshLambertMaterial({color:0x0c0d0e}), glove=M(0xb8a020);
  const out=[]; const bx=(w,h,d,mat,x,y,z,par)=>{ const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); o.position.set(x,y,z); o.castShadow=true; par.add(o); out.push(o); return o; };
  bx(0.5,0.6,0.30,green,0,0.30,0,m.torso);            // комбинезон-торс
  bx(0.54,0.50,0.34,dark,0,0.36,-0.01,m.torso);       // тяжёлый бронежилет
  bx(0.30,0.24,0.06,plate,0,0.12,-0.19,m.torso);      // нижний фартук
  bx(0.56,0.10,0.36,dark,0,0.64,0,m.torso);           // воротник
  [m.armL,m.armR].forEach(a=>{ bx(0.22,0.42,0.22,green,0,-0.12,0,a.sh); bx(0.21,0.28,0.21,dark,0,-0.06,0,a.el); bx(0.17,0.12,0.17,glove,0,-0.25,0,a.el); });
  [m.legL,m.legR].forEach(l=>{ bx(0.23,0.46,0.23,green,0,-0.21,0,l.hip); bx(0.225,0.52,0.225,green,0,-0.24,0,l.knee); bx(0.25,0.16,0.26,dark,0,-0.08,0,l.knee); });
  m.head.children.forEach(o=>{ if(!o.userData.hid && o.isMesh){ o.userData.hid=1; o.visible=false; } });
  bx(0.48,0.46,0.48,dark,0,0.19,0,m.head);             // шлем
  bx(0.40,0.20,0.06,visor,0,0.17,-0.25,m.head);        // визор
  bx(0.50,0.08,0.50,plate,0,0.40,0,m.head);
  m.suit=out;
}
const playerModel=(function(){ const m=buildHumanRig(0x4d5b3d); m.lx=player.pos.x; m.lz=player.pos.z; m.root.visible=false; scene.add(m.root); return m; })();
const RIG_TOOLS={rock:1,axe:1,pickaxe:1,rifle:1,pistol:1,berdanka:1,smg:1,spear:1,rpg:1,grenade:1,satchel:1,hammer:1,knife:1};
const ONE_HAND={knife:1,grenade:1,satchel:1,hammer:1};
function setRigTool(m,k){
  if(!RIG_TOOLS[k]) k='none';
  if(k===m.heldKind) return;
  if(m.held){ m.armR.hold.remove(m.held); m.held=null; }
  m.heldKind=k;
  if(k==='none') return;
  let t=m.toolMeshes[k];
  if(!t){
    const src = k==='rock' ? makeRockMesh(0.11) : k==='axe' ? makeAxeModel() : k==='rifle' ? OSIL_TOOLS.makeRifle(false) : k==='pistol' ? OSIL_TOOLS.makePistol(false) : k==='berdanka' ? OSIL_TOOLS.makeBerdanka(false) : k==='smg' ? OSIL_TOOLS.makeSMG(false) : k==='rpg' ? OSIL_TOOLS.makeRPG(false) : k==='knife' ? OSIL_TOOLS.makeKnife() : k==='grenade' ? makeGrenadeMesh() : k==='satchel' ? OSIL_TOOLS.makeSatchel(false) : k==='hammer' ? makeHammerModel() : k==='spear' ? OSIL_TOOLS.makeSpear() : makePickaxeModel();
    t=new THREE.Group(); t.add(src); if(src.userData && src.userData.hands) src.userData.hands.forEach(h=>{ h.visible=false; });
    src.position.set(0,0,0); src.rotation.set(0,0,0); src.scale.setScalar(k==='rock'?1:((k==='rifle'||k==='berdanka'||k==='smg'||k==='rpg')?0.85:(k==='pistol'?1.0:((k==='spear'||k==='knife')?1.0:(k==='grenade'?1.5:(k==='satchel'?0.8:1.15))))));
    src.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
    t.rotation.set((k==='rifle'||k==='pistol'||k==='berdanka'||k==='smg'||k==='rpg')?-Math.PI/2:(k==='spear'?-1.05:(k==='knife'?-1.15:((k==='grenade'||k==='satchel')?0:-1.25))),0,0);
    if(k==='rock') src.position.set(0,0.1,0); else if(k==='rifle') src.position.set(0,0.077,-0.077); else if(k==='pistol') src.position.set(0,0.064,0.034); else if(k==='berdanka') src.position.set(0,0.066,-0.046); else if(k==='smg') src.position.set(0,0.070,-0.060); else if(k==='rpg') src.position.set(0,0.05,-0.02); else if(k==='knife') src.position.set(0,-0.07,0);
    if(k==='rifle'||k==='pistol'||k==='berdanka'||k==='smg') m.rifleFlash=src.userData.flash||null;
    m.toolMeshes[k]=t;
  }
  m.held=t; m.armR.hold.add(t);
}
function refreshHeldTool(){ setRigTool(playerModel, toolKind); }
/* Двухзвенный IK: левая рука хватается за рукоять (точка target в системе торса) */
const _ikS=new THREE.Vector3(), _ikT=new THREE.Vector3(), _ikD=new THREE.Vector3(), _ikP=new THREE.Vector3(), _ikE=new THREE.Vector3(), _ikU=new THREE.Vector3(), _ikQ=new THREE.Quaternion(), _ikDown=new THREE.Vector3(0,-1,0);
function solveArmIK(arm, target){
  const L1=0.3, L2=0.3;
  _ikS.copy(arm.sh.position);
  _ikD.subVectors(target,_ikS); let d=_ikD.length(); _ikD.divideScalar(d||1);
  d=Math.min(L1+L2-0.005, Math.max(0.12, d));
  const a=(L1*L1-L2*L2+d*d)/(2*d), h=Math.sqrt(Math.max(0,L1*L1-a*a));
  _ikP.set(-0.6,-1,0.4);                                   // локоть вниз и наружу
  _ikP.addScaledVector(_ikD,-_ikP.dot(_ikD)).normalize();
  _ikE.copy(_ikS).addScaledVector(_ikD,a).addScaledVector(_ikP,h);
  _ikU.subVectors(_ikE,_ikS).normalize();
  arm.sh.quaternion.setFromUnitVectors(_ikDown,_ikU);
  _ikT.copy(_ikS).addScaledVector(_ikD,d);                 // достижимая точка кисти
  _ikU.subVectors(_ikT,_ikE).normalize().applyQuaternion(_ikQ.copy(arm.sh.quaternion).invert());
  arm.el.quaternion.setFromUnitVectors(_ikDown,_ikU);
}
const _gp=new THREE.Vector3();
/* Общая поза для своей модели (3-е лицо) и для аватаров других игроков — одна и та же модель */
function poseRig(m,dt,sp,onGround,crouch,pitch,aim){
  const target = onGround ? Math.min(1, sp/4) : 0.3;
  m.amp += (target-m.amp)*Math.min(1,dt*10);
  m.phase += dt*(3+sp*1.3);
  const s=Math.sin(m.phase)*m.amp, a=s*0.75;
  m.legL.hip.rotation.x= a+crouch*0.5;  m.legR.hip.rotation.x=-a+crouch*0.5;
  m.legL.knee.rotation.x=-(Math.max(0,-s)*1.0+crouch*1.0); m.legR.knee.rotation.x=-(Math.max(0,s)*1.0+crouch*1.0);
  const held=!!m.held, rifle=isGun(m.heldKind);
  m.armL.sh.rotation.set(-a*0.9,0,0.06); m.armL.el.rotation.set(0.2+Math.max(0,-s)*0.5,0,0);
  if(held){
    let up = rifle ? 1.0+aim*0.25 : 0.95;
    if(m.swing>0){ m.swing-=dt*3.2; if(!rifle) up-=1.9*Math.sin(Math.max(0,m.swing)*Math.PI); }
    m.armR.sh.rotation.set(up,0,-0.06); m.armR.el.rotation.set(0.55,0,0);
  } else {
    m.armR.sh.rotation.set(a*0.9,0,-0.06); m.armR.el.rotation.set(0.2+Math.max(0,s)*0.5,0,0);
    if(m.swing>0){ m.swing-=dt*3.2; m.armR.sh.rotation.x=-1.0-1.3*Math.sin(Math.max(0,m.swing)*Math.PI); }
  }
  m.torso.rotation.set(crouch*0.35, s*0.12, 0);
  m.head.rotation.x = -pitch*0.5 - crouch*0.3;
  if(held && !ONE_HAND[m.heldKind]){ // вторая рука держит рукоять
    m.root.updateMatrixWorld(true);
    if(m.heldKind==='pistol') _gp.set(-0.01,-0.03,0.04); else if(m.heldKind==='berdanka') _gp.set(0,0.06,-0.26); else if(m.heldKind==='smg') _gp.set(0,0.06,-0.20); else if(m.heldKind==='rpg') _gp.set(0,0.0,-0.185); else if(rifle) _gp.set(0,0.07,-0.34); else if(m.heldKind==='spear') _gp.set(0,0.5,0); else _gp.set(0,0.3,0);
    m.held.localToWorld(_gp); m.torso.worldToLocal(_gp);
    solveArmIK(m.armL,_gp);
  }
}
function updatePlayerModel(dt){
  const m=playerModel, vis=(CFG.camMode|0)!==0;
  m.root.visible=vis;
  const dx=player.pos.x-m.lx, dz=player.pos.z-m.lz; m.lx=player.pos.x; m.lz=player.pos.z;
  if(!vis) return;
  refreshHeldTool();
  const sp=Math.min(12, Math.hypot(dx,dz)/Math.max(dt,1e-3));
  const crouch=isCrouching?1:0;
  setRigSuit(m, suitWorn());
  poseRig(m,dt,sp,player.onGround,crouch,player.pitch,aimK);
  const idle=Math.sin(performance.now()/700)*0.004*(1-m.amp);
  m.root.position.set(player.pos.x, player.pos.y - crouch*0.18 + Math.abs(Math.cos(m.phase))*0.035*m.amp + idle, player.pos.z);
  m.root.rotation.y = player.yaw;
}

/* ---------------- Viewmodel: модели инструментов ----------------
   Система координат модели: ось +Y — ВВЕРХ по рукояти (голова инструмента
   вверху, рука снизу). Никаких переворотов на π — голова сверху, как надо.
   Для «поворота в руке» используется только rotation самого viewmodel.   */
const viewGroup = new THREE.Group();
camera.add(viewGroup);
scene.add(camera);
updateCameraFromPlayer();

const handMat  = new THREE.MeshStandardMaterial({color:0xc79a72, roughness:0.8});
const sleeveMat= new THREE.MeshStandardMaterial({color:0x5a4a38, roughness:1});
const shaftMat = new THREE.MeshStandardMaterial({map:woodTex, roughness:0.9});
const metalMat = new THREE.MeshStandardMaterial({color:0x9a9da2, roughness:0.35, metalness:0.7});
const edgeMat  = new THREE.MeshStandardMaterial({color:0xd8dce0, roughness:0.2, metalness:0.85});
const bindMat  = new THREE.MeshStandardMaterial({color:0x3a2c1c, roughness:0.9});

function makeHandle(len){
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017,0.024,len,10), shaftMat);
  shaft.position.y = len/2;              // от 0 (рука) до len (голова)
  g.add(shaft);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.027,0.027,len*0.28,10), bindMat);
  grip.position.y = len*0.14;
  g.add(grip);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03,8,6), bindMat);
  knob.position.y = 0;
  g.add(knob);
  return g;
}
function makeHand(){
  const g = new THREE.Group();
  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.048,10,8), handMat);
  fist.scale.set(1.1,0.9,1.2);
  g.add(fist);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.042,0.05,0.22,8), sleeveMat);
  wrist.position.set(0,-0.03,0.15); wrist.rotation.x = Math.PI/2 - 0.35;
  g.add(wrist);
  return g;
}

function makeAxeModel(){ return OSIL_TOOLS.makeAxe(); }

function makeHammerModel(){
  const g=new THREE.Group(), T=n=>loadTex(n,1,1), OM=(window.OSIL_TOOLS&&OSIL_TOOLS.materials)||{};
  const wm = OM.wood || new THREE.MeshStandardMaterial({map:T(TEXTURES.tex_wood),color:0xb08a5a,roughness:0.95});
  let hm;
  if(OM.wood){ hm=OM.wood.clone(); hm.color.set(0xb89a72); hm.roughness=0.42; hm.envMapIntensity=0.9; }   // лакированная голова: блики как у оружия
  else hm=new THREE.MeshStandardMaterial({map:T(TEXTURES.tex_plank),color:0x8a6a44,roughness:0.95});
  const band = OM.metal || new THREE.MeshStandardMaterial({color:0x3a3a3a,roughness:0.6,metalness:0.5});
  const h=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.022,0.46,10),wm); h.position.y=0.23; g.add(h);
  const hd=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.1,0.1),hm); hd.position.y=0.5; g.add(hd);
  [-0.05,0.05].forEach(x=>{ const b=new THREE.Mesh(new THREE.BoxGeometry(0.014,0.104,0.104),band); b.position.set(x,0.5,0); g.add(b); });
  g.rotation.set(0,Math.PI/2,0); const w=new THREE.Group(); w.add(g); OSIL_TOOLS.addHands(w); return w;
}
function makeRockMesh(r){
  const geo=new THREE.IcosahedronGeometry(r,2), pos=geo.attributes.position;
  for(let i=0;i<pos.count;i++){ const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
    const n=1+0.18*Math.sin(x*61+y*17)*Math.cos(z*53+x*11)+0.06*Math.sin(y*97+z*71);
    pos.setXYZ(i,x*n*1.1,y*n*0.9,z*n); }
  geo.computeVertexNormals();
  const OM=(window.OSIL_TOOLS&&OSIL_TOOLS.materials)||{};
  return new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:rockOreTex,color:0xd8d4cc,roughness:0.95,flatShading:true,envMap:OM.wood?OM.wood.envMap:null,envMapIntensity:0.3}));
}
function makeRockModel(){
  const w=new THREE.Group(), RR=0.115;
  const m=makeRockMesh(RR); m.scale.set(1.4,1.12,1.5); m.position.set(0,0.185,0); w.add(m);   // крупный, широкий и толстый камень
  OSIL_TOOLS.addHands(w);
  const ud=w.userData, hR=ud.hands[0], hL=ud.hands[1];
  hR.position.set(0.126, 0.012, 0.03); hL.position.set(-0.126, 0.012, 0.03);
  hR.rotation.z=-0.08; hL.rotation.z=0.08;
  ud.hOff0=0.045; ud.hOff1=0.045-0.118; ud.hRot0=0.0; ud.hRot1=0.0;
  return w;
}
function makePickaxeModel(){ return OSIL_TOOLS.makePickaxe(); }

/* ---------------- Сатчел-заряд: бросок, прилипание, писк, мигание, взрыв ---------------- */
const SATCHEL_FUSE = 8.7, SATCHEL_DMG = 75, SATCHEL_BEEPS = [0.8,1.8,2.8,3.8,4.8,5.6,6.4,7.0,7.5,8.0];
function makeSatchelMesh(){ return OSIL_TOOLS.makeSatchel(false); }
function makeSatchelModel(){ return OSIL_TOOLS.makeSatchel(true); }
const satchels = [], thrown = [], _sq = new THREE.Quaternion(), _sn = new THREE.Vector3(), _sy = new THREE.Vector3(0,1,0), _sRay = new THREE.Raycaster();
let satchelHideT = 0;
function satchelMats(m){
  const ms = [];
  m.traverse(o=>{ if(o.isMesh){ o.material = o.material.clone(); if(o.material.emissive) ms.push(o.material); } });
  return ms;
}
/* прилепить заряд: точка на детали, нормаль поверхности; нижней стороной к стене, банки смотрят наружу */
function spawnSatchel(pid, p, n, net){
  const m = makeSatchelMesh(); m.scale.setScalar(0.85);
  _sn.set(n[0],n[1],n[2]).normalize(); _sq.setFromUnitVectors(_sy, _sn); m.quaternion.copy(_sq);
  m.position.set(p[0],p[1],p[2]).addScaledVector(_sn, 0.066*0.85);
  scene.add(m);
  satchels.push({m, pid, t:0, bi:0, fl:0, net, ms:satchelMats(m), p:m.position.clone(), n:_sn.clone()});
}
function throwSatchel(){
  const sl = hotbarSlots[selectedSlot]; if(!sl || sl.k!=='satchel') return;
  aimRay(1);
  const o = _bRay.ray.origin.clone(), d = _bRay.ray.direction.clone();
  const sp = o.clone().addScaledVector(d,0.5); sp.y -= 0.12;
  removeItem('satchel',1);                  // расходуется всегда, даже в админ-режиме
  OSIL_AUDIO.play('inventory_open',{vol:0.9});
  // если стена вплотную — заряд прилипает сразу, а не стартует «за» ней
  if(!stickOrLand(o, sp)){
    const m = makeSatchelMesh(); m.scale.setScalar(0.85); m.position.copy(sp); scene.add(m);
    thrown.push({m, v:d.clone().multiplyScalar(11).add(new THREE.Vector3(0,2.4,0)), t:0, spin:new THREE.Vector3(6,2,4)});
    if(window.OSIL_NET) OSIL_NET.fx('sa', sp, d);
  }
  satchelHideT = 0.55;
  if(currentToolMesh){ currentToolMesh.visible = false; if(currentArms) currentArms.forEach(a=>a.visible=false); }
  updateResourceUI(); refreshHeld();
}
/* отрезок a→b против деталей: луч в обе стороны, чтобы не пролетать сквозь тонкую стену с любой стороны */
function stickOrLand(a, b){
  const dir = new THREE.Vector3().subVectors(b,a), len = dir.length(); if(len < 1e-5 || !partMeshes.length) return false;
  dir.multiplyScalar(1/len);
  _sRay.set(a, dir); _sRay.far = len+0.05;
  const h1 = _sRay.intersectObjects(partMeshes, false)[0];
  _sRay.set(b, dir.clone().negate()); _sRay.far = len+0.05;
  const h2 = _sRay.intersectObjects(partMeshes, false)[0];
  let hit = null;
  if(h1 && h2) hit = h1.distance <= (len - h2.distance) ? h1 : h2; else hit = h1 || h2;
  if(!hit) return false;
  const id = hit.object.userData.partId; if(!parts.get(id)) return false;
  const nrm = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
  if(nrm.dot(dir) > 0) nrm.negate();
  const net = !!(window.OSIL_NET && OSIL_NET.on);
  spawnSatchel(id, [hit.point.x,hit.point.y,hit.point.z], [nrm.x,nrm.y,nrm.z], net);
  if(net) OSIL_NET.onBuild({t:'sx', id, p:[hit.point.x,hit.point.y,hit.point.z], q:[nrm.x,nrm.y,nrm.z]});
  OSIL_AUDIO.play('hit_stone',{vol:0.5,rate:1.6});
  return true;
}
function updateThrown(dt){
  for(let i=thrown.length-1;i>=0;i--){
    const th = thrown[i], a = th.m.position.clone();
    th.t += dt; th.v.y -= 18*dt;
    const b = a.clone().addScaledVector(th.v, Math.min(dt, 0.05));
    if(stickOrLand(a, b)){ scene.remove(th.m); thrown.splice(i,1); continue; }
    const gy = heightAt(b.x,b.z) + 0.06;
    if(b.y <= gy || th.t > 4){                                  // упал на землю — лежит без урона и взрывается вхолостую
      b.y = gy; scene.remove(th.m); thrown.splice(i,1);
      spawnSatchel('', [b.x,b.y,b.z], [0,1,0], true); OSIL_AUDIO.play('hit_stone',{vol:0.4,rate:1.2});
      continue;
    }
    th.m.position.copy(b); th.m.rotation.x += th.spin.x*dt; th.m.rotation.y += th.spin.y*dt; th.m.rotation.z += th.spin.z*dt;
  }
  if(satchelHideT > 0){
    satchelHideT -= dt;
    if(satchelHideT <= 0 && currentToolMesh && (toolKind==='satchel' || toolKind==='grenade')){ currentToolMesh.visible = true; if(currentArms) currentArms.forEach(a=>a.visible=true); }
  }
}
/* ---------------- Взрыв: огненный шар, дым, искры, ударная волна, вспышка и свет, копоть на стене ---------------- */
const FXT = (()=>{
  const mk = (S, draw)=>{ const c = document.createElement('canvas'); c.width = c.height = S; draw(c.getContext('2d'), S); const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t; };
  const blob = (g,x,y,r,col,a)=>{ const q = g.createRadialGradient(x,y,0,x,y,r); q.addColorStop(0,'rgba('+col+','+a+')'); q.addColorStop(1,'rgba('+col+',0)'); g.fillStyle = q; g.beginPath(); g.arc(x,y,r,0,7); g.fill(); };
  let sd = 7; const rnd = ()=>{ sd = (sd*16807)%2147483647; return sd/2147483647; };
  return {
    fire: mk(128,(g,S)=>{ blob(g,S/2,S/2,S/2,'255,255,255',1); const r = g.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2); r.addColorStop(0,'rgba(255,255,235,1)'); r.addColorStop(0.3,'rgba(255,200,110,0.85)'); r.addColorStop(0.65,'rgba(255,110,25,0.35)'); r.addColorStop(1,'rgba(200,40,0,0)'); g.globalCompositeOperation='copy'; g.fillStyle = r; g.fillRect(0,0,S,S); }),
    smoke: mk(128,(g,S)=>{ for(let i=0;i<14;i++) blob(g, S/2+(rnd()-0.5)*S*0.36, S/2+(rnd()-0.5)*S*0.36, S*(0.16+rnd()*0.18), '255,255,255', 0.30); }),
    spark: mk(32,(g,S)=>{ const r = g.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2); r.addColorStop(0,'rgba(255,255,255,1)'); r.addColorStop(0.3,'rgba(255,200,90,0.9)'); r.addColorStop(1,'rgba(255,90,0,0)'); g.fillStyle = r; g.fillRect(0,0,S,S); }),
    ring: mk(256,(g,S)=>{ const r = g.createRadialGradient(S/2,S/2,S*0.30,S/2,S/2,S/2); r.addColorStop(0,'rgba(255,255,255,0)'); r.addColorStop(0.72,'rgba(255,235,200,0.85)'); r.addColorStop(0.86,'rgba(255,255,255,0.35)'); r.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0,0,S,S); }),
    soot: mk(128,(g,S)=>{ for(let i=0;i<22;i++){ const a = rnd()*6.28, d = rnd()*S*0.22; blob(g, S/2+Math.cos(a)*d, S/2+Math.sin(a)*d, S*(0.12+rnd()*0.2), '12,10,8', 0.42); } })
  };
})();
const boomLight = new THREE.PointLight(0xff8a3c, 0, 20, 2); boomLight.position.set(0,-50,0); scene.add(boomLight);   // один постоянный свет: число источников не меняется, шейдеры не перекомпилируются
const fxAdd = [], fxNorm = [], fxLive = [], soots = [];
let boomLightT = 0, boomLightK = 0;
function fxSprite(additive, tex){
  const pool = additive ? fxAdd : fxNorm;
  let e = pool.find(x=>!x.on);
  if(!e){
    if(pool.length >= (additive ? 110 : 48)) return null;
    const mat = new THREE.SpriteMaterial({map:tex, transparent:true, depthWrite:false, fog:false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending});
    const spr = new THREE.Sprite(mat); spr.visible = false; spr.frustumCulled = false; scene.add(spr);
    e = {spr, on:false}; pool.push(e);
  }
  e.spr.material.map = tex; e.on = true; e.spr.visible = true; return e;
}
function fxEmit(kind, pos, vel, life, s0, s1, col0, col1, o){
  const e = fxSprite(kind!=='smoke', kind==='smoke' ? FXT.smoke : (kind==='spark' ? FXT.spark : (kind==='ring' ? FXT.ring : FXT.fire)));
  if(!e) return;
  o = o || {};
  e.spr.position.copy(pos); e.spr.material.rotation = Math.random()*6.28;
  fxLive.push({e, kind, vel, life, t:0, s0, s1, c0:new THREE.Color(col0), c1:new THREE.Color(col1), g:o.g||0, drag:o.drag||0, rot:o.rot||0, a:o.a===undefined?1:o.a, rise:o.rise||0});
}
function satchelExplode(s){
  const pos = s.p.clone(), n = s.n ? s.n.clone() : new THREE.Vector3(0,1,0), d = Math.hypot(pos.x-player.pos.x, pos.z-player.pos.z);
  const big = s.big || (s.pid ? 1 : 0.6), lo = CFG.particles ? 1 : 0.35;
  const c = pos.clone().addScaledVector(n, 0.35*big);
  OSIL_AUDIO.boom({vol:Math.max(0.12, 1 - d/80)});
  if(d < 25) camKick = Math.max(camKick||0, 0.07*(1-d/25));
  spawnDebris(pos.clone(), 'wood', 26, 1.6); spawnDebris(pos.clone(), 'stone', 14, 1.3);
  const rv = (sc)=> new THREE.Vector3((Math.random()-0.5),(Math.random()-0.5),(Math.random()-0.5)).normalize().multiplyScalar(sc);
  // вспышка и ударная волна
  fxEmit('fire', c, new THREE.Vector3(), 0.16, 1.5*big, 7.5*big, 0xffffff, 0xffd8a0, {a:1});
  fxEmit('ring', c, new THREE.Vector3(), 0.42, 0.6*big, 10*big, 0xffeedd, 0xffffff, {a:0.65});
  // огненный шар: несколько слоёв, расходятся от стены, белый → жёлтый → оранжевый → красный
  for(let i=0;i<Math.round(16*lo);i++){
    const v = rv((1.2+Math.random()*2.6)*big).addScaledVector(n, (1.4+Math.random()*2.2)*big); v.y += 0.6;
    fxEmit('fire', c.clone().add(rv(0.25*big)), v, 0.55+Math.random()*0.5, (0.7+Math.random()*0.5)*big, (2.4+Math.random()*1.6)*big, 0xfff2c0, 0xc02a00, {drag:2.2, rot:(Math.random()-0.5)*2, a:0.95, rise:1.2});
  }
  // тяжёлый дым: тёмный, медленно поднимается и растёт
  for(let i=0;i<Math.round(18*lo);i++){
    const v = rv((0.6+Math.random()*1.4)*big).addScaledVector(n, (0.8+Math.random()*1.6)*big); v.y += 0.8+Math.random()*1.2;
    fxEmit('smoke', c.clone().add(rv(0.3*big)), v, 1.8+Math.random()*1.4, (0.9+Math.random()*0.6)*big, (3.2+Math.random()*2.2)*big, 0x3a342e, 0x8a8782, {drag:1.3, rot:(Math.random()-0.5)*0.8, a:0.6, rise:0.9});
  }
  // искры и раскалённые частицы с гравитацией
  for(let i=0;i<Math.round(34*lo);i++){
    const v = rv((4+Math.random()*9)*big).addScaledVector(n, (2+Math.random()*4)*big); v.y += 1.5;
    fxEmit('spark', c.clone(), v, 0.6+Math.random()*0.9, 0.11+Math.random()*0.08, 0.02, 0xfff0b0, 0xff4a00, {g:11, drag:0.6, a:1});
  }
  // свет на полсекунды
  boomLight.position.copy(c); boomLightT = 0.55; boomLightK = Math.max(3, 9*big);
  // копоть на стене
  if(s.pid && CFG.particles){
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.7,1.7), new THREE.MeshBasicMaterial({map:FXT.soot, transparent:true, depthWrite:false, opacity:0.95, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4, fog:true}));
    sm.position.copy(pos).addScaledVector(n, 0.03); sm.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), n); sm.rotateZ(Math.random()*6.28);
    scene.add(sm); soots.push({m:sm, t:0});
    if(soots.length > 8){ const o = soots.shift(); scene.remove(o.m); o.m.material.dispose(); o.m.geometry.dispose(); }
  }
  if(!s.net && s.pid) damagePart(s.pid, SATCHEL_DMG);   // в мультиплеере урон считает сервер
  if(s.grenade && !s.net) grenadeHurtParts(pos);
  if(s.rocket) rocketHurt(pos, s.rid, !!s.net);
  if(!s.noHurt) explosionHurt(c, s.dmg || (s.grenade ? GREN_DMG : SATCHEL_DMG), s.R || (s.grenade ? 5 : 5.5));   // игрок и коптер рядом получают урон от любого взрыва
}
function updateFx(dt){
  const col = new THREE.Color();
  for(let i=fxLive.length-1;i>=0;i--){
    const f = fxLive[i]; f.t += dt; const k = f.t/f.life, spr = f.e.spr;
    if(k >= 1){ spr.visible = false; f.e.on = false; fxLive.splice(i,1); continue; }
    if(f.drag) f.vel.multiplyScalar(Math.max(0, 1 - f.drag*dt));
    f.vel.y += (f.rise - f.g)*dt;
    spr.position.addScaledVector(f.vel, dt);
    const e = 1-(1-k)*(1-k);                                   // быстрое начало, плавное затухание
    const sc = f.s0 + (f.s1-f.s0)*(f.kind==='spark' ? k : e); spr.scale.set(sc,sc,1);
    col.copy(f.c0).lerp(f.c1, Math.min(1,k*1.25)); spr.material.color.copy(col);
    let a = f.a*(k<0.08 ? k/0.08 : 1)*(1-Math.pow(k, f.kind==='smoke'?1.6:2.2));
    spr.material.opacity = Math.max(0, a);
    if(f.rot) spr.material.rotation += f.rot*dt;
  }
  if(boomLightT > 0){ boomLightT -= dt; const q = Math.max(0, boomLightT/0.55); boomLight.intensity = boomLightK*q*q; if(boomLightT <= 0){ boomLight.intensity = 0; boomLight.position.y = -50; } }
  for(let i=soots.length-1;i>=0;i--){
    const o = soots[i]; o.t += dt; const k = o.t/30;
    o.m.material.opacity = k < 0.05 ? 0.95*(k/0.05) : Math.max(0, 0.95*(1-(k-0.05)/0.95));
    if(k >= 1){ scene.remove(o.m); o.m.material.dispose(); o.m.geometry.dispose(); soots.splice(i,1); }
  }
}
function updateSatchels(dt){
  updateThrown(dt); updateGrenades(dt); updateRockets(dt);
  for(let i=satchels.length-1;i>=0;i--){
    const s = satchels[i]; s.t += dt;
    if(s.bi < SATCHEL_BEEPS.length && s.t >= SATCHEL_BEEPS[s.bi]){
      s.bi++; s.fl = 0.16;
      const d = Math.hypot(s.p.x-player.pos.x, s.p.z-player.pos.z);
      if(d < 45) OSIL_AUDIO.beep({vol:Math.max(0.1,1-d/45), f:2400});
    }
    if(s.fl > 0){ s.fl -= dt; }
    const on = s.fl > 0;
    const e = on ? 0.7 : 0; s.ms.forEach(mt=> mt.emissive.setRGB(e, e*0.12, e*0.08));
    if(s.t >= SATCHEL_FUSE){ satchelExplode(s); scene.remove(s.m); satchels.splice(i,1); }
  }
  updateFx(dt);
}



/* ---------------- Взрывы: урон игроку и коптеру от ЛЮБОГО взрыва (сатчел, граната, коптер без урона) ---------------- */
function explosionHurt(c, maxDmg, R){
  if(player.hp > 0){
    const px = player.pos.x, py = player.pos.y + (player.height||1.6)*0.5, pz = player.pos.z;
    const d = Math.hypot(c.x-px, c.y-py, c.z-pz);
    if(d < R){
      let dmg = maxDmg*Math.pow(1-d/R, 1.2);
      if(partMeshes.length){                                   // стена между взрывом и игроком гасит урон
        const dir = new THREE.Vector3(px-c.x, py-c.y, pz-c.z), L = dir.length();
        if(L > 0.4){ dir.multiplyScalar(1/L); _sRay.set(c, dir); _sRay.far = L-0.2; if(_sRay.intersectObjects(partMeshes,false)[0]) dmg *= 0.3; }
      }
      if(dmg >= 1){ bzHurtPlayer(dmg); camKick = Math.max(camKick||0, 0.12); }
    }
  }
  if(copter.exists){ const dc = Math.hypot(c.x-copter.x, c.y-(copter.y+1), c.z-copter.z); if(dc < 4) copterDamage(maxDmg*0.8*(1-dc/4), 'взрыв'); }
}

/* ---------------- Граната: бросок по дуге, отскоки, взрыв через 3.5 с. 50 урона каждой детали рядом ---------------- */
const GREN_FUSE = 3.5, GREN_DMG = 50, GREN_R = 3.4;
const grenades = [];
function makeGrenadeMesh(){      // Ф-1: рифлёный овальный корпус, запал, предохранительная чека-кольцо и рычаг; PBR + отражения
  const g = new THREE.Group();
  const OM=(window.OSIL_TOOLS&&OSIL_TOOLS.materials)||{}, env=OM.wood?OM.wood.envMap:null;
  const M = (c,r,m,ei)=> new THREE.MeshStandardMaterial({color:c, roughness:r, metalness:m, envMap:env, envMapIntensity:ei===undefined?0.9:ei});
  const pts=[]; for(let i=0;i<=20;i++){ const t=i/20, y=-0.062+0.124*t; pts.push(new THREE.Vector2(0.004+0.047*Math.pow(Math.sin(Math.PI*Math.min(1,0.06+0.9*t)),0.62),y)); }
  const geo = new THREE.LatheGeometry(pts, 24), pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){ const x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i), r=Math.hypot(x,z); if(r<0.01) continue;
    const a=Math.atan2(z,x), gv=(Math.abs(Math.sin(a*6))>0.9?1:0)+(Math.abs(Math.sin(y*150))>0.93?1:0), k=1-Math.min(1,gv)*0.045;
    pos.setXYZ(i,x*k,y,z*k); }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, M(0x4a5632,0.55,0.62)));                                           // оливковый корпус
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.019,0.026,0.03,14), M(0x7c7e80,0.38,0.9)); neck.position.y=0.074; g.add(neck);   // горловина запала
  const fuze = new THREE.Mesh(new THREE.CylinderGeometry(0.014,0.016,0.024,12), M(0x2b2d30,0.45,0.85)); fuze.position.y=0.098; g.add(fuze);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.012,0.108,0.026), M(0x9a9c9e,0.32,0.95));                                         // рычаг (ложка)
  lever.position.set(0.049,0.036,0); lever.rotation.z=-0.06; g.add(lever);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.01,0.026), M(0x9a9c9e,0.32,0.95)); hook.position.set(0.03,0.092,0); g.add(hook);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.019,0.003,8,18), M(0xc8b054,0.3,1.0)); ring.position.set(-0.028,0.094,0); ring.rotation.y=Math.PI/2; g.add(ring);   // кольцо чеки
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0022,0.0022,0.05,6), M(0xc8b054,0.3,1.0)); pin.position.set(-0.004,0.094,0); pin.rotation.z=Math.PI/2; g.add(pin);
  g.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  return g;
}
function throwGrenade(){
  const sl = hotbarSlots[selectedSlot]; if(!sl || sl.k!=='grenade') return;
  aimRay(1);
  const o = _bRay.ray.origin.clone(), d = _bRay.ray.direction.clone();
  const sp = o.clone().addScaledVector(d, 0.45); sp.y -= 0.1;
  if(partMeshes.length){                                       // стена вплотную: начинаем перед ней, а не за ней
    const dd = sp.clone().sub(o), L = dd.length(); _sRay.set(o, dd.multiplyScalar(1/L)); _sRay.far = L;
    const h = _sRay.intersectObjects(partMeshes,false)[0]; if(h) sp.copy(o).addScaledVector(d, Math.max(0, h.distance-0.12));
  }
  removeItem('grenade', 1);
  OSIL_AUDIO.play('inventory_open', {vol:0.9});
  const m = makeGrenadeMesh(); m.position.copy(sp); scene.add(m);
  grenades.push({m, v:d.clone().multiplyScalar(14).add(new THREE.Vector3(0,3.2,0)), t:0, spin:new THREE.Vector3(9,3,6), rest:false});
  if(window.OSIL_NET) OSIL_NET.fx('gr', sp, d);
  satchelHideT = 0.55;
  if(currentToolMesh){ currentToolMesh.visible = false; if(currentArms) currentArms.forEach(a=>a.visible=false); }
  updateResourceUI(); refreshHeld();
}
function grenadeBoom(g){
  const net = !!(window.OSIL_NET && OSIL_NET.on), p = g.m.position;
  satchelExplode({p:p.clone(), n:new THREE.Vector3(0,1,0), pid:0, net, grenade:true, big:0.85});
  if(net) OSIL_NET.onBuild({t:'gx', p:[+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]});   // в сети урон постройкам считает сервер
}
function grenadeHurtParts(pos){
  const bx = new THREE.Box3(), hits = [];
  parts.forEach(p=>{ bx.setFromObject(p.obj); if(bx.distanceToPoint(pos) <= GREN_R*0.55) hits.push(p.id); });
  hits.forEach(id=>damagePart(id, GREN_DMG));
}
function updateGrenades(dt){
  for(let i=grenades.length-1;i>=0;i--){
    const g = grenades[i]; g.t += dt;
    if(!g.rest){
      g.v.y -= 18*dt;
      const a = g.m.position.clone(), step = g.v.clone().multiplyScalar(Math.min(dt,0.05)), b = a.clone().add(step), len = step.length();
      if(len > 1e-5 && partMeshes.length){
        _sRay.set(a, step.clone().multiplyScalar(1/len)); _sRay.far = len+0.06;
        const h = _sRay.intersectObjects(partMeshes,false)[0];
        if(h){
          const nrm = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0,1,0);
          if(nrm.dot(step) > 0) nrm.negate();
          g.v.reflect(nrm).multiplyScalar(0.38); b.copy(h.point).addScaledVector(nrm, 0.07);
          OSIL_AUDIO.play('hit_stone', {vol:0.35, rate:1.7});
        }
      }
      const gy = heightAt(b.x,b.z) + 0.07;
      if(b.y <= gy){
        b.y = gy; if(g.v.y < -1.5) OSIL_AUDIO.play('hit_stone', {vol:0.3, rate:1.4});
        g.v.y = Math.abs(g.v.y)*0.35; g.v.x *= 0.6; g.v.z *= 0.6;
        if(g.v.length() < 0.8){ g.v.set(0,0,0); g.rest = true; }
      }
      g.m.position.copy(b);
      g.m.rotation.x += g.spin.x*dt; g.m.rotation.y += g.spin.y*dt; g.m.rotation.z += g.spin.z*dt;
      if(g.rest){ g.spin.set(0,0,0); }
    }
    if(g.t >= GREN_FUSE){ grenadeBoom(g); scene.remove(g.m); grenades.splice(i,1); }
  }
}

/* ---------------- РПГ: ракета летит по прямой, взрыв наносит 150 урона любой детали, предмету и коптеру рядом ---------------- */
const RPG_DMG = 150, RPG_R = 3.4, RPG_SPEED = 48, RPG_CD = 2.2;
const rockets = [], _vZero = new THREE.Vector3();
function makeRpgModel(){
  const g = new THREE.Group();
  const M = (c,r,m)=> new THREE.MeshStandardMaterial({color:c, roughness:r, metalness:m, flatShading:true});
  const cyl = (rt,rb,h,mat,z,y,x)=>{ const o = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,16), mat); o.rotation.x = Math.PI/2; o.position.set(x||0,y||0,z); g.add(o); return o; };
  const olive = M(0x4f5440,0.6,0.5), dk = M(0x2a2a28,0.5,0.7), wood = M(0x6b4a2c,0.8,0.05), rk = M(0x5a3a2a,0.55,0.5);
  cyl(0.055,0.055,0.95,olive,-0.40);                         // труба
  cyl(0.088,0.055,0.18,dk,0.13);                             // задний раструб
  cyl(0.06,0.06,0.04,dk,-0.05); cyl(0.06,0.06,0.04,dk,-0.55);  // кольца
  cyl(0.068,0.068,0.22,rk,-0.93);                            // боевая часть ракеты
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.068,0.17,14), dk); nose.rotation.x = -Math.PI/2; nose.position.z = -1.125; g.add(nose);
  const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.15,0.06), wood); g1.position.set(0,-0.1,-0.28); g1.rotation.x = 0.2; g.add(g1);
  const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.13,0.05), wood); g2.position.set(0,-0.095,-0.52); g.add(g2);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.025,0.07,0.16), dk); sight.position.set(-0.04,0.075,-0.35); g.add(sight);
  g.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  return g;
}
function makeRocketMesh(){
  const g = new THREE.Group();
  const M = (c,r,m)=> new THREE.MeshStandardMaterial({color:c, roughness:r, metalness:m, flatShading:true});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,0.5,10), M(0x5a3a2a,0.6,0.5)); body.rotation.x = Math.PI/2; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.045,0.16,10), M(0x3b3b3b,0.5,0.6)); nose.rotation.x = -Math.PI/2; nose.position.z = -0.33; g.add(nose);
  for(let i=0;i<3;i++){ const a = i*Math.PI*2/3, f = new THREE.Mesh(new THREE.BoxGeometry(0.02,0.1,0.12), M(0x2a2a2a,0.6,0.5)); f.position.set(Math.sin(a)*0.07,Math.cos(a)*0.07,0.2); f.rotation.z = -a; g.add(f); }
  return g;
}
let rpgKick = 0;
function fireRocket(){
  if(copter.pilot) return;
  const sl = rifleSlot(); if(!sl || sl.k!=='rpg' || reloadT>=0) return;
  if((sl.m|0) <= 0){
    if(countItem('rocket') > 0){ startReload(); return; }
    hitCooldown = 0.3; OSIL_AUDIO.play('empty'); if(performance.now()-_noAmmoT > 1500){ showToast('Нет ракет'); _noAmmoT = performance.now(); } return; }
  sl.m = 0;
  aimRay(300);
  const o = _bRay.ray.origin.clone(), d = _bRay.ray.direction.clone();
  const sp = o.clone().addScaledVector(d, 0.9); sp.y -= 0.08;
  const m = makeRocketMesh(); m.position.copy(sp); m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1), d); scene.add(m);
  rockets.push({m, v:d.clone().multiplyScalar(RPG_SPEED), t:0, tr:0});
  if(window.OSIL_NET) OSIL_NET.fx('rk', sp, d);
  OSIL_AUDIO.play('ak', {vol:1, rate:0.45}); camKick = Math.max(camKick||0, 0.18);
  { const fl = currentToolMesh && currentToolMesh.userData.flash, rk = currentToolMesh && currentToolMesh.userData.rocket;
    if(fl){ fl.visible = true; setTimeout(()=>{ fl.visible = false; }, 90); }
    if(rk) rk.visible = false;
    rpgKick = 1; }
  fxEmit('fire', sp.clone(), _vZero.clone(), 0.18, 0.4, 1.8, 0xffffff, 0xffd8a0, {a:0.9});
  for(let i=0;i<5;i++) fxEmit('smoke', o.clone().addScaledVector(d,0.4), new THREE.Vector3((Math.random()-.5)*1.2,(Math.random()-.5)*1.2,(Math.random()-.5)*1.2).addScaledVector(d,-2.5), 0.9, 0.3, 1.4, 0x8a857d, 0xcfcac2, {drag:1.8, a:0.55});
  updateResourceUI(); updateAmmoHud(); renderHotbar();
}
function updateRockets(dt){
  for(let i=rockets.length-1;i>=0;i--){
    const r = rockets[i]; r.t += dt;
    const a = r.m.position.clone(), step = r.v.clone().multiplyScalar(dt), len = step.length(), b = a.clone().add(step);
    let hit = null;
    if(len > 1e-5 && partMeshes.length){
      _sRay.set(a, step.clone().multiplyScalar(1/len)); _sRay.far = len+0.1;
      const h = _sRay.intersectObjects(partMeshes,false)[0];
      if(h){ const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0,1,0); if(n.dot(step) > 0) n.negate(); hit = {p:h.point.clone(), n, id:h.object.userData.partId}; }
    }
    if(!hit && copter.exists && !copter.pilot && Math.hypot(b.x-copter.x, b.y-(copter.y+1), b.z-copter.z) < 2.2) hit = {p:b.clone(), n:new THREE.Vector3(0,1,0)};
    if(!hit){ const gy = heightAt(b.x,b.z); if(b.y <= gy+0.05) hit = {p:new THREE.Vector3(b.x,gy+0.05,b.z), n:new THREE.Vector3(0,1,0)}; }
    if(!hit){ for(let k=0;k<colliders.length;k++){ const bb = colliders[k].box; if(b.x>bb.min.x&&b.x<bb.max.x&&b.z>bb.min.z&&b.z<bb.max.z&&b.y>bb.min.y&&b.y<bb.max.y){ hit = {p:b.clone(), n:r.v.clone().normalize().negate()}; break; } } }
    if(hit || r.t > 6){ if(hit) rocketBoom(hit); scene.remove(r.m); rockets.splice(i,1); continue; }
    r.m.position.copy(b);
    r.tr -= dt;
    if(r.tr <= 0){ r.tr = 0.03;
      fxEmit('smoke', a.clone(), new THREE.Vector3((Math.random()-.5)*.5,(Math.random()-.5)*.5+.2,(Math.random()-.5)*.5), 1.0, 0.25, 1.1, 0x8f8a82, 0xd8d4cc, {drag:1.5, a:0.5});
      fxEmit('fire', a.clone(), _vZero.clone(), 0.12, 0.28, 0.08, 0xfff2c0, 0xff7a1a, {a:0.95});
    }
  }
}
function rocketBoom(h){
  const net = !!(window.OSIL_NET && OSIL_NET.on), p = h.p;
  satchelExplode({p:p.clone(), n:h.n, pid:0, net, rocket:true, rid:h.id, big:1.35, dmg:120, R:5});
  if(net) OSIL_NET.onBuild({t:'rx', p:[+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], id:h.id||null});   // в сети урон постройкам считает сервер
}
function rocketHurt(pos, rid, net){
  if(copter.exists && Math.hypot(pos.x-copter.x, pos.y-(copter.y+1), pos.z-copter.z) < RPG_R+1.2) copterDamage(RPG_DMG, 'ракета');
  if(net) return;
  const bx = new THREE.Box3(), hits = [];
  parts.forEach(p=>{ bx.setFromObject(p.obj); if(p.id === rid || bx.distanceToPoint(pos) <= RPG_R*0.6) hits.push(p.id); });
  hits.forEach(id=>damagePart(id, RPG_DMG));
}

/* ---------------- Карьер: кидаешь топливо — он добывает камень, железо и серу ---------------- */
const QUAR_CYC = 5, QUAR_FUEL = 60, QUAR_OUT = {stone:4, metal:2, sulfur:1}, QUAR_CAP = 600, QUAR_MAXF = 40;
const quarState = new Map();      // id → {f: секунд топлива, stone, metal, sulfur, a: накопитель цикла}
function quarSt(id){ let s = quarState.get(id); if(!s){ s = {f:0, stone:0, metal:0, sulfur:0, a:0}; quarState.set(id, s); } return s; }
const quNet = ()=> !!(window.OSIL_NET && OSIL_NET.on);
const quEl = document.createElement('div'); quEl.id = 'quarry-panel';
quEl.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;width:min(94vw,360px);max-height:86vh;overflow:auto;background:rgba(34,33,31,.95);padding:12px;color:#fff;font:600 13px sans-serif';
document.body.appendChild(quEl);
['pointerdown','touchstart','mousedown','click'].forEach(ev=>quEl.addEventListener(ev, e=>e.stopPropagation()));
const quFmt = s=>{ s = Math.max(0, Math.ceil(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
function renderQuarry(){
  if(quarOpenId === null){ quEl.style.display = 'none'; return; }
  quEl.style.display = 'block';
  if(!document.getElementById('qu-css')){ const st = document.createElement('style'); st.id = 'qu-css'; st.textContent =
    '#quarry-panel{background:rgba(34,33,31,.95)!important;border:none;border-radius:0;width:min(96vw,460px)!important;max-height:96vh!important;overflow:hidden!important;padding:0!important;box-sizing:border-box}'
   +'#quarry-panel .qh{display:flex;align-items:center;gap:10px;padding:6px 8px;background:rgba(120,150,60,.55)}'
   +'#quarry-panel .qh img{width:30px;height:30px;object-fit:contain}'
   +'#quarry-panel .qh b{font-size:14px;letter-spacing:1px}#quarry-panel .qh small{display:block;font-size:11px;font-weight:600;color:#cfe6a0;margin-top:1px}'
   +'#quarry-panel #qu-x{margin-left:auto;background:rgba(58,56,52,.9);color:#fff;padding:6px 14px;cursor:pointer}'
   +'#quarry-panel .qb{padding:8px;display:grid;grid-template-columns:1fr;gap:6px}'
   +'#quarry-panel .qc{background:rgba(58,56,52,.7);padding:6px 8px}'
   +'#quarry-panel .qfuel{display:flex;align-items:center;gap:8px}#quarry-panel .qfuel img{width:30px;height:30px;object-fit:contain}'
   +'#quarry-panel .qbar{height:6px;background:rgba(0,0,0,.45);margin-top:5px}#quarry-panel .qbar i{display:block;height:100%;width:0;background:#d9a441;transition:width .3s}'
   +'#quarry-panel .qrow{display:flex;gap:6px}'
   +'#quarry-panel .qbtn{flex:1;padding:9px 6px;border:none;border-radius:0;font:700 12px/1 "Segoe UI",Roboto,Arial,sans-serif;letter-spacing:.5px;color:#fff;background:rgba(58,56,52,.9);display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}'
   +'#quarry-panel .qbtn img{width:16px;height:16px;object-fit:contain}#quarry-panel .qbtn:active{background:rgba(78,80,70,.95)}'
   +'#quarry-panel .qbtn.go{background:rgba(120,150,60,.65)}'
   +'#quarry-panel .qgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}'
   +'#quarry-panel .qres{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;background:rgba(78,80,70,.8)}'
   +'#quarry-panel .qres img{width:30px;height:30px;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}#quarry-panel .qres b{font-size:15px;color:#cfe6a0}#quarry-panel .qres span{font-size:10px;color:#b9b6b0}'
   +'#quarry-panel .qlbl{font-size:11px;letter-spacing:1px;color:#b9b6b0;margin-bottom:4px}'
   +'#quarry-panel .qdot{display:inline-block;width:7px;height:7px;margin-right:5px;background:#777}#quarry-panel .qdot.on{background:#8fc23f}'
   +'@media (orientation:landscape){#quarry-panel .qb{grid-template-columns:1fr 1fr}}';
    document.head.appendChild(st); }
  const ic = k=>ITEM_DEFS[k].icon;
  quEl.innerHTML =
    '<div class="qh"><img src="1/quarry.webp" alt=""><div><b>КАРЬЕР</b><small id="qu-t"></small></div><div id="qu-x">ЗАКРЫТЬ</div></div>'
   +'<div class="qb"><div style="display:flex;flex-direction:column;gap:6px">'
   +'<div class="qc qfuel"><img src="'+ic('fuel')+'" alt=""><div style="flex:1"><div style="display:flex;justify-content:space-between"><span>Топливо</span><span id="qu-fl" style="color:#b9b6b0"></span></div><div class="qbar"><i id="qu-b"></i></div></div></div>'
   +'<div class="qrow"><button id="qu-f1" class="qbtn"><img src="'+ic('fuel')+'" alt="">+1</button><button id="qu-fa" class="qbtn"><img src="'+ic('fuel')+'" alt="">ВСЁ</button></div></div>'
   +'<div style="display:flex;flex-direction:column;gap:6px"><div class="qc"><div class="qlbl">ДОБЫТО</div>'
   +'<div class="qgrid"><div class="qres"><img src="'+ic('stone')+'" alt=""><b id="qu-s">0</b><span>Камень</span></div><div class="qres"><img src="'+ic('metal_ore')+'" alt=""><b id="qu-m">0</b><span>Жел. руда</span></div><div class="qres"><img src="'+ic('sulfur_ore')+'" alt=""><b id="qu-u">0</b><span>Сер. руда</span></div></div></div>'
   +'<button id="qu-take" class="qbtn go">ЗАБРАТЬ ВСЁ</button></div></div>';
  quEl.querySelector('#qu-x').onclick = closeQuarry;
  quEl.querySelector('#qu-f1').onclick = ()=>quFuel(false);
  quEl.querySelector('#qu-fa').onclick = ()=>quFuel(true);
  quEl.querySelector('#qu-take').onclick = quTake;
  updateQuarryText();
}
function updateQuarryText(){
  if(quarOpenId === null) return;
  const st = quarSt(quarOpenId), q = id=>quEl.querySelector(id); if(!q('#qu-t')) return;
  q('#qu-t').innerHTML = '<span class="qdot'+(st.f>0?' on':'')+'"></span>'+(st.f > 0 ? 'Работает · ещё '+quFmt(st.f) : 'Остановлен');
  q('#qu-b').style.width = Math.min(100, st.f/(QUAR_FUEL*QUAR_MAXF)*100)+'%';
  q('#qu-fl').textContent = 'в сумке: '+countItem('fuel');
  q('#qu-s').textContent = Math.floor(st.stone); q('#qu-m').textContent = Math.floor(st.metal); q('#qu-u').textContent = Math.floor(st.sulfur);
}
function openQuarry(id){
  if(!parts.has(id)) return;
  quarOpenId = id; try{ if(document.exitPointerLock) document.exitPointerLock(); }catch(e){}
  if(quNet()) OSIL_NET.onBuild({t:'qo', id});
  renderQuarry(); updateFpsVisibility();
}
function closeQuarry(){
  quarOpenId = null; quEl.style.display = 'none'; updateFpsVisibility();
  try{ if(!('ontouchstart' in window) && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock(); }catch(e){}
}
function quFuel(all){
  const id = quarOpenId; if(id === null) return;
  let n = countItem('fuel'); if(n <= 0){ showToast('Нет топлива в сумке'); return; }
  const st = quarSt(id), room = Math.max(0, QUAR_MAXF - Math.ceil(st.f/QUAR_FUEL));
  n = Math.min(all ? n : 1, room); if(n <= 0){ showToast('Бак карьера полон'); return; }
  removeItem('fuel', n);
  if(quNet()) OSIL_NET.onBuild({t:'qf', id, n}); else st.f += n*QUAR_FUEL;
  OSIL_AUDIO.play('build', {vol:0.5}); fuelFx(id); updateResourceUI(); updateQuarryText();
}
function quTake(){
  const id = quarOpenId; if(id === null) return;
  if(quNet()){ OSIL_NET.onBuild({t:'qt', id}); return; }
  const st = quarSt(id); let left = 0;
  ['stone','metal','sulfur'].forEach(k=>{ const n = Math.floor(st[k]); if(n > 0){ const got = addItem(ORE_ITEM[k]||k, n); st[k] -= got; left += n-got; } });
  if(left > 0) showToast('Нет места в сумке — остаток ждёт в карьере');
  OSIL_AUDIO.play('open', {vol:0.5}); updateResourceUI(); updateQuarryText();
}
let _quT = 0;
const quarObjs = new Set(), quarActive = new Set();      // quarActive — id работающих карьеров в сети (шлёт сервер)
function fuelFx(id){
  const p = parts.get(id); if(!p || !p.obj) return; const b = p.obj.position, R = ()=>Math.random()-.5;
  for(let i=0;i<7;i++) fxEmit('smoke', new THREE.Vector3(b.x+R()*0.8, b.y+1.2+Math.random()*0.6, b.z+R()*0.8), new THREE.Vector3(R()*0.8,0.9+Math.random()*0.8,R()*0.8), 1.4, 0.3, 1.3, 0x8f8a82, 0xd8d4cc, {drag:1.2, a:0.5});
  for(let i=0;i<5;i++) fxEmit('fire', new THREE.Vector3(b.x+R()*0.5, b.y+1.1+Math.random()*0.4, b.z+R()*0.5), new THREE.Vector3(R()*0.4,0.6+Math.random()*0.6,R()*0.4), 0.4, 0.3, 0.06, 0xfff2c0, 0xff7a1a, {a:0.9});
  for(let i=0;i<5;i++) fxEmit('spark', new THREE.Vector3(b.x+R()*0.5, b.y+1.2, b.z+R()*0.5), new THREE.Vector3(R()*2.4,1.2+Math.random()*2,R()*2.4), 0.7, 0.07, 0.02, 0xffd27a, 0xff6a1a, {g:6, a:1});
}
function quarryAnim(dt){
  quarObjs.forEach(id=>{
    const p = parts.get(id); if(!p){ quarObjs.delete(id); return; }
    const sp = p.obj.userData.spin; if(!sp) return;
    if(Math.abs(p.obj.position.x-player.pos.x)+Math.abs(p.obj.position.z-player.pos.z) > 130) return;
    const act = quNet() ? quarActive.has(id) : ((quarState.get(id)||{}).f > 0);
    if(act && CFG.particles && Math.abs(p.obj.position.x-player.pos.x)+Math.abs(p.obj.position.z-player.pos.z) < 60 && Math.hypot(p.obj.position.x-player.pos.x,p.obj.position.z-player.pos.z) > 7){ const u = p.obj.userData; u._sm = (u._sm||0) - dt; if(u._sm <= 0){ u._sm = 0.7; fxEmit('smoke', new THREE.Vector3(p.obj.position.x+0.4, p.obj.position.y+2.8, p.obj.position.z), new THREE.Vector3(0.1,1.0,0.05), 2.2, 0.25, 1.6, 0x6f6a63, 0xb8b3ab, {drag:0.6, a:0.45}); } }
    const v = p.obj.userData.sv || 0, nv = v + ((act?4.2:0)-v)*Math.min(1, dt*(act?1.1:0.7));
    p.obj.userData.sv = nv; if(nv > 0.02) sp.rotation.y += nv*dt;
  });
}
function quarryTick(dt){
  furnaceTick(dt);
  quarryAnim(dt);
  if(quarOpenId !== null){ _quT -= dt; if(_quT <= 0){ _quT = 0.4; updateQuarryText(); } }
  if(quNet()) return;                                          // в сети карьер считает сервер
  quarState.forEach((st, id)=>{
    if(!parts.has(id)){ quarState.delete(id); return; }
    if(st.f <= 0) return;
    st.a += dt;
    while(st.a >= QUAR_CYC && st.f > 0){
      st.a -= QUAR_CYC; st.f = Math.max(0, st.f-QUAR_CYC);
      for(const k in QUAR_OUT) st[k] = Math.min(QUAR_CAP, st[k]+QUAR_OUT[k]);
    }
  });
}
/* если какая-то панель закрылась, а HUD остался скрытым (или наоборот) — синхронизируем */
function hudSafety(){ if(document.body.classList.contains('ui-open') !== !!panelsOpen()) updateFpsVisibility(); }

/* ---------------- Печка: плавит железную и серную руду в железо и серу ---------------- */
const SMELT_T = 2.5, FUEL_BURN = {wood:12, fuel:40}, FUR_IN = {metal_ore:'metal', sulfur_ore:'sulfur'};
const furnState = new Map();     // id → {ore:{metal_ore,sulfur_ore}, fuel:{wood,fuel}, out:{metal,sulfur}, burn, t}
function furSt(id){ let f = furnState.get(id); if(!f){ f = {ore:{metal_ore:0,sulfur_ore:0}, fuel:{wood:0,fuel:0}, out:{metal:0,sulfur:0}, burn:0, t:0}; furnState.set(id, f); } return f; }
function furnaceTick(dt){
  if(!furnState.size) return;
  furnState.forEach((f, id)=>{
    const has = f.ore.metal_ore + f.ore.sulfur_ore > 0;
    if(!has){ f.t = 0; if(f.burn > 0) f.burn = Math.max(0, f.burn - dt); return; }
    if(f.burn <= 0){
      const fk = f.fuel.fuel > 0 ? 'fuel' : f.fuel.wood > 0 ? 'wood' : null;
      if(!fk){ f.t = 0; return; }
      f.fuel[fk]--; f.burn = FUEL_BURN[fk];
    }
    f.burn -= dt; f.t += dt;
    if(CFG.particles){ f._sm = (f._sm||0) - dt; if(f._sm <= 0){ f._sm = 0.3; const pp = parts.get(id);
      if(pp && pp.obj && Math.hypot(pp.obj.position.x-player.pos.x, pp.obj.position.z-player.pos.z) < 50) fxEmit('smoke', pp.obj.position.clone().add(new THREE.Vector3(0,1.7,0)), new THREE.Vector3(0.05,0.9,0.05), 1.8, 0.2, 1.1, 0x6f6a63, 0xb8b3ab, {drag:0.7, a:0.45}); } }
    while(f.t >= SMELT_T){
      const ok = f.ore.metal_ore > 0 ? 'metal_ore' : f.ore.sulfur_ore > 0 ? 'sulfur_ore' : null;
      if(!ok){ f.t = 0; break; }
      f.t -= SMELT_T; f.ore[ok]--; f.out[FUR_IN[ok]]++;
    }
  });
  if(furOpenId !== null) updateFurnaceUI();
}
const furEl = document.createElement('div'); furEl.id = 'fur-panel';
furEl.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;background:rgba(34,33,31,.95);padding:6px 8px;color:#fff;font:600 13px "Segoe UI",Roboto,Arial,sans-serif;overflow:hidden;max-height:98vh;max-width:98vw;box-sizing:border-box';
document.body.appendChild(furEl);
['pointerdown','touchstart','mousedown','click'].forEach(ev=>furEl.addEventListener(ev, e=>e.stopPropagation()));
function furTransfer(ref){          // предмет из сумки → печка (руда / топливо)
  const sl = getAt(ref); if(!sl || furOpenId===null) return false;
  const f = furSt(furOpenId);
  if(FUR_IN[sl.k]){ f.ore[sl.k] += sl.n; setAt(ref, null); }
  else if(FUEL_BURN[sl.k]){ f.fuel[sl.k] += sl.n; setAt(ref, null); fuelFx(furOpenId); }
  else { showToast('Печка принимает руду и топливо'); return false; }
  OSIL_AUDIO.play('build', {vol:0.4}); storRefreshF(); return true;
}
function furTake(k){                // готовый металл/серу → сумка
  if(furOpenId===null) return; const f = furSt(furOpenId), n = Math.floor(f.out[k]); if(n <= 0) return;
  const got = addItem(k, n); if(got <= 0){ showToast('Нет места в инвентаре'); return; }
  f.out[k] -= got; OSIL_AUDIO.play('open', {vol:0.4}); storRefreshF();
}
function furReturn(kind, k){        // руду/топливо обратно в сумку
  if(furOpenId===null) return; const f = furSt(furOpenId), n = f[kind][k]; if(n <= 0) return;
  const got = addItem(k, n); if(got <= 0){ showToast('Нет места в инвентаре'); return; } f[kind][k] -= got; storRefreshF();
}
function storRefreshF(){ try{ renderHotbar(); renderInvGrid(); refreshHeld(); updateResourceUI(); }catch(e){} renderFurnace(); }
function furCell(k, n, label, z, onTap, dragKey){
  const d = ITEM_DEFS[k]||{}, c = document.createElement('div');
  c.className = 'inv-slot'+(n>0?' has-item':''); c.dataset.z = z; if(dragKey) c.dataset.dk = dragKey;
  c.innerHTML = '<img src="'+d.icon+'" style="'+(n>0?'':'opacity:.3')+'"><span class="count">'+(n>0?n:'')+'</span><span class="nm">'+label+'</span>';
  if(onTap) dtap(c, onTap); return c;
}
function renderFurnace(){
  if(furOpenId===null){ furEl.style.display='none'; return; }
  furEl.style.display='block';
  const f = furSt(furOpenId);
  furEl.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><span style="letter-spacing:1px">ПЕЧКА <small id="fu-st" style="color:#cfe6a0;margin-left:8px;font-weight:600"></small></span><button id="fu-x" style="background:rgba(58,56,52,.9);border:none;color:#fff;padding:5px 14px">✖</button></div>'
   +'<div id="fu-body" style="display:flex;gap:14px;align-items:flex-start;justify-content:center;margin-top:4px"><div id="fu-l" class="sp-card"><div class="sp-h"><span>ПЕЧКА</span><b></b></div><div id="fu-grid" style="display:grid;gap:4px;justify-content:center"></div><div style="height:6px;background:rgba(0,0,0,.45);margin-top:5px"><i id="fu-b" style="display:block;height:100%;width:0;background:#d9a441"></i></div><div style="font-size:10px;color:#b9b6b0;margin-top:3px">Двойной тап или перетаскивание. Топливо: дерево, топливо.</div></div>'
   +'<div class="sp-card"><div class="sp-h"><span>ИНВЕНТАРЬ</span><b></b></div><div id="fu-inv" style="display:grid;justify-content:center;gap:4px"></div></div></div>';
  furEl.querySelector('#fu-x').onclick = closeFurnace;
  const G = furEl.querySelector('#fu-grid');
  const hd = t=>{ const e=document.createElement('div'); e.style.cssText='grid-column:1/-1;font-size:10px;letter-spacing:1px;color:#b9b6b0;margin-top:2px'; e.textContent=t; G.appendChild(e); };
  hd('РУДА'); G.appendChild(furCell('metal_ore', f.ore.metal_ore, 'жел.', 'fin', ()=>furReturn('ore','metal_ore'), 'o:metal_ore')); G.appendChild(furCell('sulfur_ore', f.ore.sulfur_ore, 'сер.', 'fin', ()=>furReturn('ore','sulfur_ore'), 'o:sulfur_ore'));
  hd('ТОПЛИВО'); G.appendChild(furCell('wood', f.fuel.wood, 'дер.', 'fin', ()=>furReturn('fuel','wood'), 'f:wood')); G.appendChild(furCell('fuel', f.fuel.fuel, 'топл.', 'fin', ()=>furReturn('fuel','fuel'), 'f:fuel'));
  hd('РЕЗУЛЬТАТ'); G.appendChild(furCell('metal', Math.floor(f.out.metal), 'жел.', 'fout', ()=>furTake('metal'), 'r:metal')); G.appendChild(furCell('sulfur', Math.floor(f.out.sulfur), 'сера', 'fout', ()=>furTake('sulfur'), 'r:sulfur'));
  const I = furEl.querySelector('#fu-inv');
  allSlotRefs().forEach(r=>{ const sl = getAt(r), c = storCell(sl, sl ? ()=>furTransfer(r) : null); c.dataset.z='p'; c.dataset.ref = JSON.stringify(r); I.appendChild(c); });
  furFit(); updateFurnaceUI();
}
function furFit(){
  const W = innerWidth, H = innerHeight, land = W > H*1.15, gap = 3, nB = HOTBAR_N + GRID_N, cB = 5, rB = Math.ceil(nB/cB);
  const availW = W*0.96-24, availH = H*0.94-60;
  let s = land ? Math.min((availW-14)/2/Math.max(cB,2)-gap, availH/Math.max(rB,6)-gap) : Math.min(availW/cB-gap, (availH-130)/rB-gap);
  s = Math.max(26, Math.floor(Math.min(s, 60)));
  const I = furEl.querySelector('#fu-inv'), G = furEl.querySelector('#fu-grid'); if(!I) return;
  I.style.gridTemplateColumns = 'repeat('+cB+','+s+'px)'; I.style.gridAutoRows = s+'px';
  G.style.gridTemplateColumns = 'repeat(2,'+s+'px)'; G.style.gridAutoRows = 'auto';
  G.querySelectorAll('.inv-slot').forEach(c=>{ c.style.width=s+'px'; c.style.height=s+'px'; });
  furEl.querySelector('#fu-body').style.flexDirection = land ? 'row' : 'column';
  furEl.style.width = Math.ceil(land ? (2+cB)*(s+gap)+60 : Math.max(cB*(s+gap), 2*(s+gap))+30)+'px';
  if(!land){ furEl.querySelector('#fu-body').style.alignItems='center'; }
}
addEventListener('resize', ()=>{ try{ if(furOpenId!==null) furFit(); }catch(e){} });
function updateFurnaceUI(){
  if(furOpenId===null) return; const f = furSt(furOpenId), st = furEl.querySelector('#fu-st'), b = furEl.querySelector('#fu-b'); if(!st) return;
  const has = f.ore.metal_ore + f.ore.sulfur_ore > 0, fuelOk = f.burn > 0 || f.fuel.wood + f.fuel.fuel > 0;
  st.textContent = f.burn > 0 && has ? 'плавит…' : !has ? 'нет руды' : !fuelOk ? 'нет топлива' : 'готова';
  b.style.width = (f.burn > 0 && has ? Math.min(100, f.t/SMELT_T*100) : 0)+'%';
  const set = (z, k, n)=>{ const c = furEl.querySelector('[data-dk="'+z+':'+k+'"]'); if(!c) return; const cn = c.querySelector('.count'); if(cn) cn.textContent = n>0?n:''; };
  set('o','metal_ore',f.ore.metal_ore); set('o','sulfur_ore',f.ore.sulfur_ore); set('f','wood',f.fuel.wood); set('f','fuel',f.fuel.fuel); set('r','metal',Math.floor(f.out.metal)); set('r','sulfur',Math.floor(f.out.sulfur));
  furEl.querySelectorAll('[data-dk^="r:"]').forEach(c=>c.classList.toggle('has-item', parseInt(c.querySelector('.count').textContent)>0));
}
function openFurnace(id){
  if(!parts.has(id)) return; furOpenId = id; try{ if(document.exitPointerLock) document.exitPointerLock(); }catch(e){}
  renderFurnace(); updateFpsVisibility();
}
function closeFurnace(){
  furOpenId = null; furEl.style.display = 'none'; updateFpsVisibility();
  try{ if(!('ontouchstart' in window) && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock(); }catch(e){}
}
function closeWorldPanels(){ if(storOpenId !== null) closeStorage(); if(quarOpenId !== null) closeQuarry(); if(furOpenId !== null) closeFurnace(); }

/* ---- Штурмовая винтовка: магазин 30, перезарядка, прицеливание, гильзы ---- */
const GUNS = {
  rifle:  {mag:30, ammo:'ammo_rifle',  dmg:20, rate:0.1,  reload:2.1, snd:'ak', rate2:1,   icon:'1/ak.webp',     name:'ШТУРМОВАЯ ВИНТОВКА'},
  berdanka:{mag:15, ammo:'ammo_rifle', dmg:35, rate:0.32, reload:2.6, snd:'ak', rate2:0.72, icon:'1/berdanka.webp', name:'ПОЛУАВТОМАТИЧЕСКАЯ ВИНТОВКА', semi:true},
  smg:    {mag:20, ammo:'ammo_pistol', dmg:18, rate:0.085, reload:1.9, snd:'ak', rate2:1.45, icon:'1/smg.webp', name:'ПИСТОЛЕТ-ПУЛЕМЁТ'},
  pistol: {mag:10, ammo:'ammo_pistol', dmg:25, rate:0.2,  reload:1.5, snd:'ak', rate2:1.7, icon:'1/pistol.webp', name:'ПИСТОЛЕТ'},
  rpg:    {mag:1,  ammo:'rocket', dmg:150, rate:2.2, reload:3.2, snd:'ak', rate2:0.45, icon:'1/rpg.webp', name:'РПГ · РАКЕТА'}
};
const isGun = k => k==='rifle' || k==='pistol' || k==='berdanka' || k==='smg';
const isMag = k => isGun(k) || k==='rpg';      // оружие с магазином, прицелом и перезарядкой (включая РПГ)
let aimOn = false, aimHeld = false, aimK = 0, reloadT = -1, reloadSlot = null, _noAmmoT = 0, _crossEl = null;
function rifleSlot(){ const s = hotbarSlots[selectedSlot]; return (s && isMag(s.k)) ? s : null; }
/* HUD «в магазине / в запасе» + кнопки прицела и перезарядки видны только с винтовкой */
let _ammoEl = null;
function updateAmmoHud(){
  try{
    if(!_ammoEl){
      _ammoEl = document.createElement('div'); _ammoEl.id = 'ammo-hud';
      _ammoEl.innerHTML = '<div class="ah-ico"><img src="1/ak.webp" alt="" draggable="false"></div><div class="ah-txt"><div class="ah-name">ШТУРМОВАЯ · АВТО</div><div class="ah-cnt"><span id="ah-mag">0</span><span id="ah-res">/0</span></div></div>';
      document.body.appendChild(_ammoEl);
    }
    const sl = rifleSlot(), on = (isMag(toolKind) && !!sl);
    document.body.classList.toggle('has-gun', on);
    if(on){
      const G_ = GUNS[sl.k], mag = sl.m|0, res = countItem(G_.ammo);
      const gi = _ammoEl.querySelector('.ah-ico img'), gn = _ammoEl.querySelector('.ah-name'); if(gi && gi.getAttribute('src')!==G_.icon) gi.src = G_.icon; if(gn) gn.textContent = G_.name;
      const m = _ammoEl.querySelector('#ah-mag'); m.textContent = mag; m.style.color = mag===0?'#ff6a55':'#fff';
      _ammoEl.querySelector('#ah-res').textContent = '/'+res;
    }
    _ammoEl.classList.toggle('on', on);
  }catch(e){}
}
function startReload(){
  const sl = rifleSlot(); if(!sl || reloadT>=0 || !isMag(toolKind)) return;
  const G_ = GUNS[sl.k];
  if((sl.m|0) >= G_.mag){ showToast('Магазин полон'); return; }
  if(countItem(G_.ammo) <= 0){ showToast('Нет патронов'); OSIL_AUDIO.play('empty'); return; }
  reloadT = 0; reloadSlot = sl; aimOn = false; aimHeld = false;
  OSIL_AUDIO.play('open',{vol:0.5,rate:1.4});
}
function finishReload(){
  const sl = reloadSlot; reloadT = -1; reloadSlot = null;
  if(sl && hotbarSlots[selectedSlot]===sl){
    const G_ = GUNS[sl.k], take = Math.min(G_.mag-(sl.m|0), countItem(G_.ammo));
    if(take>0){ removeItem(G_.ammo, take); sl.m = (sl.m|0) + take; }
  }
  updateAmmoHud(); renderHotbar();
}
/* гильзы: маленькие латунные цилиндры вылетают вправо-вверх и падают */
const casings = [];
const casingGeo = new THREE.CylinderGeometry(0.0034,0.0034,0.02,6), casingMat = new THREE.MeshLambertMaterial({color:0xd9a93f, emissive:0x2a1a04});
function ejectCasing(){
  if(!CFG.particles) return;
  const gm = currentToolMesh; if(!gm) return;
  let c = casings.find(x=>!x.m.visible);
  if(!c){ if(casings.length>=10) return; const m = new THREE.Mesh(casingGeo, casingMat); viewGroup.add(m); c = {m, v:new THREE.Vector3(), life:0, spin:new THREE.Vector3()}; casings.push(c); }
  _v3a.set(0.022,0.02,-0.075); gm.localToWorld(_v3a); viewGroup.worldToLocal(_v3a);
  c.m.position.copy(_v3a); c.m.visible = true; c.life = 0.8;
  c.v.set(0.8+Math.random()*0.5, 0.9+Math.random()*0.5, 0.3+Math.random()*0.4);
  c.spin.set(Math.random()*20, Math.random()*20, Math.random()*20);
}
const _v3a = new THREE.Vector3();
function updateCasings(dt){
  for(const c of casings){
    if(!c.m.visible) continue;
    c.life -= dt; if(c.life<=0){ c.m.visible=false; continue; }
    c.v.y -= 6*dt; c.m.position.addScaledVector(c.v, dt);
    c.m.rotation.x += c.spin.x*dt; c.m.rotation.y += c.spin.y*dt; c.m.rotation.z += c.spin.z*dt;
  }
}
function fireGun(){
  if(copter.pilot) return;
  const sl = rifleSlot(); if(!sl || reloadT>=0) return;
  if((sl.m|0) <= 0){
    if(countItem(GUNS[sl.k].ammo) > 0){ startReload(); return; }
    hitCooldown = 0.3; OSIL_AUDIO.play('empty');
    if(performance.now()-_noAmmoT > 1500){ showToast('Нет патронов'); _noAmmoT = performance.now(); }
    return;
  }
  sl.m--;
  const G_ = GUNS[sl.k];
  hitCooldown = G_.rate;
  OSIL_AUDIO.play(G_.snd,{vol:0.8,rate:G_.rate2});
  const kick = (1 - 0.4*aimK) * (sl.k==='pistol' ? 0.9 : (sl.k==='smg' ? 0.7 : 1));                                          // в прицеливании отдача мягче
  camKick = 0.02*kick;
  const sg = Math.random()<0.5 ? -1 : 1;
  VM.z[1] += 1.1*kick; VM.y[1] += 0.22*kick; VM.rx[1] += 0.9*kick; VM.rz[1] += sg*0.25*kick; VM.x[1] += sg*0.05*kick;
  player.pitch = Math.min(1.4, player.pitch + 0.004*kick);
  const fl = currentToolMesh && currentToolMesh.userData.flash;
  if(fl){ fl.visible = true; fl.rotation.z = Math.random()*6; fl.scale.setScalar(0.8+Math.random()*0.5); clearTimeout(fireGun._h); fireGun._h = setTimeout(()=>{ fl.visible=false; },45); }
  ejectCasing();
  shotImpact();
  if(window.OSIL_NET) OSIL_NET.onShoot();
  boarShot(G_.dmg); window.__shotT=performance.now(); botShot(G_.dmg);
  hitBuildingRay(sl.k, 220);
  wearTool(sl.k,1);
  updateAmmoHud();
}

function makeFistModel(){
  const g = new THREE.Group();
  g.add(makeHand());
  return g;
}

let currentToolMesh = null, currentArms = null;
const toolCache = {};
/* позиция/поворот в руке для каждого инструмента: голова смотрит вверх-вперёд,
   лёгкий наклон к центру экрана — как в Rust */
const TOOL_POSE = {
  rock:    { pos:new THREE.Vector3( 0.00,-0.33,-0.62), rot:new THREE.Euler(-0.32, 0.00, 0.00) },
  axe:     { pos:new THREE.Vector3( 0.30,-0.34,-0.52), rot:new THREE.Euler(-0.10,-0.06, 0.03) },
  pickaxe: { pos:new THREE.Vector3( 0.30,-0.34,-0.52), rot:new THREE.Euler(-0.10,-0.06, 0.03) },
  hammer:  { pos:new THREE.Vector3( 0.26,-0.34,-0.55), rot:new THREE.Euler(-0.10, 0.55, 0.00) },   // повёрнута на 90° вправо (крен по часовой)
  spear:   { pos:new THREE.Vector3( 0.30,-0.36,-0.50), rot:new THREE.Euler(-1.00,-0.10, 0.06) },
  knife:   { pos:new THREE.Vector3( 0.14,-0.19,-0.42), rot:new THREE.Euler(-0.98, 0.00,-0.12) },
  rifle:   { pos:new THREE.Vector3( 0.14,-0.19,-0.36), rot:new THREE.Euler( 0.00, 0.00, 0.00) },
  berdanka:{ pos:new THREE.Vector3( 0.14,-0.20,-0.40), rot:new THREE.Euler( 0.00, 0.00, 0.00) },
  smg:     { pos:new THREE.Vector3( 0.14,-0.19,-0.38), rot:new THREE.Euler( 0.00, 0.00, 0.00) },
  satchel: { pos:new THREE.Vector3( 0.00,-0.25,-0.42), rot:new THREE.Euler( 0.38, 0.00, 0.00) },
  grenade: { pos:new THREE.Vector3( 0.20,-0.22,-0.40), rot:new THREE.Euler( 0.25,-0.35, 0.15) },
  rpg:     { pos:new THREE.Vector3( 0.12,-0.17,-0.26), rot:new THREE.Euler( 0.00, 0.00, 0.00) },
  pistol:  { pos:new THREE.Vector3( 0.15,-0.15,-0.40), rot:new THREE.Euler( 0.00, 0.00, 0.00) },
  hand:    { pos:new THREE.Vector3( 0.27,-0.24,-0.45), rot:new THREE.Euler( 0.10,-0.30, 0.10) },
};
let toolKind = 'none';

/* ---- Тайминги (как в Rust: замах → удар → отдача; между ударами — кулдаун) ---- */
const SWING_DUR = 0.88;   // полная длительность удара = кулдаун между ударами, с
const SWING_KNIFE = 0.8;   // нож: удар втрое медленнее прежнего
const curSwingDur = ()=> toolKind==='knife' ? SWING_KNIFE : SWING_DUR;
const HIT_AT    = 0.57;   // на какой доле анимации удар «попадает» в цель
const EQUIP_DUR = 0.60;   // доставание предмета из-за нижнего края экрана
let swingT = 0, swinging = false, swingHitFn = null;
let equipT = 1, hitCooldown = 0, bobT = 0, moveAmt = 0, lastCd = -1;
let vmLastYaw = 0, vmLastPitch = 0, swayX = 0, swayY = 0, sprintK = 0;
const btnHitEl = document.getElementById('btn-hit');

/* ключевые кадры: [время, dx,dy,dz, rx,ry,rz]. Между ними — кубический Эрмит
   (непрерывная скорость, без «остановок» на кадрах): замах → пауза наверху → удар → затухание */
const SWING_KEYS = [
  [0.00,  0.000,  0.000,  0.000,  0.00,  0.00,  0.00],
  [0.18,  0.020, -0.020,  0.035,  0.12,  0.00,  0.07],   // вдох: кирка чуть подтягивается к себе
  [0.40,  0.078,  0.125,  0.115,  0.95, -0.14, -0.44],   // вершина замаха
  [0.49,  0.021,  0.061,  0.036,  0.45, -0.07, -0.20],   // разгон: середина пути, скорость нарастает плавно
  [HIT_AT,-0.150,-0.130, -0.200, -1.05,  0.15,  0.52],   // попадание
  [0.70, -0.120, -0.100, -0.150, -0.85,  0.12,  0.42],   // упор / отскок
  [0.86, -0.040, -0.028, -0.040, -0.26,  0.04,  0.13],   // возврат
  [0.96, -0.006, -0.004, -0.006, -0.04,  0.006, 0.02],   // мягкое «оседание» в конце
  [1.00,  0.000,  0.000,  0.000,  0.00,  0.00,  0.00],
];
function sampleSwing(t){
  const K = SWING_KEYS, n = K.length;
  let i = 0; while(i < n-2 && t >= K[i+1][0]) i++;
  const a = K[i], b = K[i+1], dt = b[0]-a[0], u = Math.max(0,Math.min(1,(t-a[0])/dt));
  const u2 = u*u, u3 = u2*u, h00 = 2*u3-3*u2+1, h10 = u3-2*u2+u, h01 = -2*u3+3*u2, h11 = u3-u2;
  const o = [];
  for(let c=1;c<=6;c++){
    const p = K[i-1], q = K[i+2];
    const m0 = p ? (b[c]-p[c])/(b[0]-p[0]) : 0, m1 = q ? (q[c]-a[c])/(q[0]-a[0]) : 0;
    o.push(h00*a[c] + h10*dt*m0 + h01*b[c] + h11*dt*m1);
  }
  return o;
}
/* ---- осмотр предмета в руках: короткая анимация, кулдаун от спама ---- */
const INSPECT_DUR = 1.7, INSPECT_CD = 2.8;
let inspectT = -1, inspectLock = 0;
function inspectItem(){
  const now = performance.now()/1000;
  if(now < inspectLock || inspectT >= 0 || toolKind==='none' || !currentToolMesh) return;
  if(swinging || equipT < 1 || aimOn || aimHeld || reloadT >= 0 || panelsOpen() || (typeof copter!=='undefined' && copter.pilot)) return;
  inspectT = 0; inspectLock = now + INSPECT_CD;
}
function triggerSwing(){
  if(window.OSIL_NET) OSIL_NET.onSwing();
  playerModel.swing=1;
  if(swinging) return false;
  inspectT = -1;
  swinging = true; swingT = 0;
  return true;
}
function setToolMesh(kind){
  const prevKind = toolKind;
  if(currentToolMesh){ viewGroup.remove(currentToolMesh); if(currentArms) currentArms.forEach(a=>viewGroup.remove(a)); currentToolMesh=null; currentArms=null; }
  toolKind = kind;
  if(kind !== prevKind){          // сменили предмет: сбрасываем удар и играем доставание
    swinging = false; swingT = 0; swingHitFn = null;
    aimOn = false; aimHeld = false; reloadT = -1; reloadSlot = null;
    equipT = 0;
    hitCooldown = Math.max(hitCooldown, EQUIP_DUR*0.8);
  }
  let mesh;
  if(kind==='rock') mesh = toolCache.rock || (toolCache.rock = makeRockModel());
  else if(kind==='axe') mesh = toolCache.axe || (toolCache.axe = makeAxeModel());
  else if(kind==='pickaxe') mesh = toolCache.pickaxe || (toolCache.pickaxe = makePickaxeModel());
  else if(kind==='satchel') mesh = toolCache.satchel || (toolCache.satchel = makeSatchelModel());
  else if(kind==='grenade') mesh = toolCache.grenade || (toolCache.grenade = (()=>{ const m = makeGrenadeMesh(); m.scale.setScalar(1.7); return m; })());
  else if(kind==='rpg') mesh = toolCache.rpg || (toolCache.rpg = OSIL_TOOLS.makeRPG(true));
  else if(kind==='hammer') mesh = toolCache.hammer || (toolCache.hammer = makeHammerModel());
  else if(kind==='spear') mesh = toolCache.spear || (toolCache.spear = OSIL_TOOLS.makeSpear());
  else if(kind==='knife') mesh = toolCache.knife || (toolCache.knife = OSIL_TOOLS.makeKnife());
  else if(kind==='berdanka') mesh = toolCache.berdanka || (toolCache.berdanka = OSIL_TOOLS.makeBerdanka(true));
  else if(kind==='smg') mesh = toolCache.smg || (toolCache.smg = OSIL_TOOLS.makeSMG(true));
  else if(kind==='pistol') mesh = toolCache.pistol || (toolCache.pistol = OSIL_TOOLS.makePistol(true));
  else if(kind==='rifle') mesh = toolCache.rifle || (toolCache.rifle = OSIL_TOOLS.makeRifle(true));
  else { currentToolMesh = null; updateAmmoHud(); return; }   // пустые руки: модели нет вообще
  const pose = TOOL_POSE[kind] || TOOL_POSE.hand;
  mesh.position.copy(pose.pos);
  mesh.rotation.copy(pose.rot);
  if(equipT < 1) mesh.position.y -= 0.6;      // не мелькает в позе покоя до первого кадра
  mesh.traverse(o=>{ o.frustumCulled = false; });   // оружие у самой камеры не должно пропадать
  mesh.visible = true;
  viewGroup.add(mesh);
  currentToolMesh = mesh;
  currentArms = mesh.userData.arms || null;
  if(kind==='rpg' && mesh.userData.rocket) mesh.userData.rocket.visible = countItem('rocket') > 0;
  if(currentArms){ currentArms.forEach(a=>{ a.visible = true; viewGroup.add(a); }); OSIL_TOOLS.updateArms(mesh); }
  updateAmmoHud();
}

/* Пружинная физика viewmodel: [положение, скорость]. Инерция, вес, отдача. */
const VM = {x:[0,0],y:[0,0],z:[0,0],rx:[0,0],ry:[0,0],rz:[0,0]};
let vmStep = 0, slideK = 0, mvS = 0;
const vmSpring = (s, k, c, h)=>{ s[1] += (-s[0]*k - s[1]*c)*h; s[0] += s[1]*h; };
const vmClamp = (v, m)=> Math.max(-m, Math.min(m, v));

/* каждый кадр: кулдаун, доставание, удар, ходьба/бег, дыхание, инерция */
function updateViewmodel(dt){
  hitCooldown = Math.max(0, hitCooldown - dt);
  camKick *= Math.max(0, 1 - dt*14);
  if(btnHitEl){
    const v = Math.min(1, hitCooldown/SWING_DUR);
    if(Math.abs(v-lastCd) > 0.004){ btnHitEl.style.setProperty('--cd', v.toFixed(3)); lastCd = v; }
  }
  updateCasings(dt);
  // прицеливание: плавный переход, FOV сужается; спринт и перезарядка его сбрасывают
  const wantAim = isMag(toolKind) && (aimOn||aimHeld) && reloadT<0 && sprintK<0.4 && equipT>=1;
  aimK += ((wantAim?1:0) - aimK) * Math.min(1, dt*12);
  if(aimK < 0.001) aimK = 0;
  const fovT = CFG.fov*(1 - (toolKind==='rpg' ? 0.50 : ((currentToolMesh && currentToolMesh.userData.holo) ? 0.36 : 0.30))*aimK);
  if(Math.abs(camera.fov - fovT) > 0.05){ camera.fov = fovT; camera.updateProjectionMatrix(); }
  if(!_crossEl) _crossEl = document.getElementById('crosshair');
  if(_crossEl) _crossEl.style.opacity = (isMag(toolKind) && aimK>0.3) ? '0' : '';
  { let r = window._rpgRet;
    if(!r){ r = window._rpgRet = document.createElement('div'); r.id = 'rpg-reticle';
      r.style.cssText = 'position:fixed;inset:0;z-index:9;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 50%,transparent 0,transparent 27vmin,rgba(0,0,0,.72) 31vmin)';
      const c = '#e8ffd0', t = (x1,y1,x2,y2,w)=>'<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+c+'" stroke-width="'+(w||1)+'"/>';
      let svg = '<svg viewBox="-100 -100 200 200" style="position:absolute;left:50%;top:50%;width:62vmin;height:62vmin;transform:translate(-50%,-50%)" stroke-linecap="round">'
        + '<circle r="95" fill="none" stroke="'+c+'" stroke-width="1.4" opacity=".8"/>'
        + t(-95,0,-8,0,1.2)+t(8,0,95,0,1.2)+t(0,8,0,95,1.2)+t(0,-95,0,-8,1.2)+t(-40,0,-40,0,1)
        + '<circle r="1.4" fill="'+c+'"/>';
      for(let i=1;i<=8;i++){ const d = 8+i*10; svg += t(d,-3,d,3,1)+t(-d,-3,-d,3,1)+t(-3,d,3,d,1); }
      for(let i=1;i<=3;i++){ const y = 8+i*18; svg += t(-7,y,7,y,1.2); }
      svg += '<path d="M-12 40 L0 30 L12 40" fill="none" stroke="'+c+'" stroke-width="1" opacity=".8"/></svg>';
      r.innerHTML = svg; document.body.appendChild(r); }
    r.style.opacity = (toolKind==='rpg' && aimK>0.5) ? String(Math.min(1,(aimK-0.5)*2)) : '0'; }
  sightFrame();
  const m = currentToolMesh;
  if(!m) return;
  m.visible = !(toolKind==='rpg' && aimK > 0.85);
  const pose = TOOL_POSE[toolKind] || TOOL_POSE.hand, tS = performance.now()/1000;
  let dx=0, dy=0, dz=0, rx=0, ry=0, rz=0, hitNow = false;

  if(equipT < 1){
    equipT = Math.min(1, equipT + dt/EQUIP_DUR);
    const k = Math.pow(1-equipT, 3);
    if(toolKind==='satchel' || toolKind==='grenade' || toolKind==='rpg'){ dy += -0.55*k; dz -= 0.06*k; rx += 0.35*k; }   // крупный предмет: поднимается снизу, не подлетает к камере
    else { dx += 0.16*k; dy += -0.62*k; dz += 0.10*k;
    rx += 1.10*k; rz += 0.55*k; ry += -0.35*k; }
  }
  if(toolKind==='rpg' && rpgKick > 0){ rpgKick = Math.max(0, rpgKick - dt*3.2); const q = rpgKick*rpgKick; dz += 0.10*q; dy += 0.02*q; rx += 0.20*q; }
  if(swinging){
    const prevT = swingT;
    swingT += dt/curSwingDur();
    if(swingHitFn && swingT >= HIT_AT){ const f = swingHitFn; swingHitFn = null; f(); }
    if(prevT < HIT_AT && swingT >= HIT_AT) hitNow = true;
    if(swingT >= 1){ swinging = false; swingT = 0; }
    else {
      const s = sampleSwing(swingT);
      if(toolKind==='spear'){ dx+=s[0]*0.4; dy+=s[1]*0.3; dz+=s[2]*3.2; rx+=s[3]*0.25; ry+=s[4]*0.5; rz+=s[5]*0.4; }   // выпад вперёд
      else if(toolKind==='knife'){ dx+=s[0]*0.9; dy+=s[1]*0.7; dz+=s[2]*1.7; rx+=s[3]*0.55; ry+=s[4]*1.3; rz+=s[5]*1.6; }
      else if(toolKind==='rock'){ dy+=s[1]*1.8; dz+=s[2]*1.2; rx+=s[3]*1.1; }   // двумя руками: замах над головой по центру и удар сверху вниз
      else { dx+=s[0]; dy+=s[1]; dz+=s[2]; rx+=s[3]; ry+=s[4]; rz+=s[5]; }
    }
  }
  // отдача: импульс в пружины → кирка отскакивает, тяжело «оседает» и затухает
  if(inspectT >= 0){
    if(swinging || equipT < 1 || aimK > 0.05 || reloadT >= 0){ inspectT = -1; }
    else {
      inspectT += dt/INSPECT_DUR; const u = Math.min(1, inspectT);
      if(u >= 1) inspectT = -1;
      else {                                   // один плавный поворот туда-обратно, без движения к камере
        const e = Math.sin(Math.PI*u), kk = isMag(toolKind) ? 0.55 : 1;
        ry += 0.7*e*kk; rz += 0.22*e*kk; rx += -0.12*e; dy += 0.02*e; dx += -0.03*e*kk;
      }
    }
  }
  if(hitNow){
    const sg = Math.random() < 0.5 ? -1 : 1;
    VM.z[1] += 0.9; VM.y[1] += 0.35; VM.rx[1] += 1.4; VM.rz[1] += sg*1.0; VM.ry[1] += -sg*0.5; VM.x[1] += sg*0.15;
  }
  // инерция от поворота камеры: кирка запаздывает за взглядом (тяжёлая → мягкая пружина)
  let dYaw = player.yaw - vmLastYaw, dPitch = player.pitch - vmLastPitch;
  vmLastYaw = player.yaw; vmLastPitch = player.pitch;
  if(Math.abs(dYaw) > 1) dYaw = 0;
  VM.x[1]  += vmClamp( dYaw*3.0, 0.3);  VM.ry[1] += vmClamp( dYaw*7, 0.8);  VM.rz[1] += vmClamp(-dYaw*3, 0.5);
  VM.y[1]  += vmClamp(-dPitch*3.0, 0.3); VM.rx[1] += vmClamp(-dPitch*7, 0.8);
  // бег
  // moveAmt мигает 0/1 на неровностях и спусках (onGround) — сглаживаем с медленным затуханием
  mvS += (moveAmt - mvS) * Math.min(1, dt*(moveAmt > mvS ? 5 : 2.2));
  sprintK += ((mvS > 1.25 ? 1 : 0) - sprintK) * Math.min(1, dt*4);
  dy -= 0.045*sprintK; dz += 0.02*sprintK; rx += 0.34*sprintK; rz += 0.16*sprintK; dx += 0.03*sprintK;
  // ходьба: восьмёрка + толчок веса на каждый шаг
  bobT += dt*(3 + mvS*5);
  const bob = Math.min(1, mvS) * (CFG.bob/100), stp = Math.floor(bobT/Math.PI);
  if(stp !== vmStep){
    vmStep = stp;
    if(bob > 0.3){ VM.y[1] -= 0.075*bob*(1+sprintK*0.5); VM.rx[1] += 0.25*bob; VM.rz[1] += (stp&1 ? 1 : -1)*0.18*bob; }
  }
  dy += Math.sin(bobT*2)*0.0035*bob;
  dx += Math.cos(bobT)*0.003*bob;
  rz += Math.cos(bobT)*0.006*bob + Math.sin(bobT)*0.02*sprintK*bob;
  ry += Math.sin(bobT)*0.004*bob + Math.cos(bobT)*0.013*sprintK*bob;
  // дыхание и лёгкий тремор рук в покое
  dy += Math.sin(tS*1.0)*0.0022; rx += Math.sin(tS*1.0+0.6)*0.003;
  dx += Math.sin(tS*0.43)*0.0016; rz += Math.sin(tS*0.31)*0.004;

  const h = Math.min(dt, 0.033);
  vmSpring(VM.x,60,10,h); vmSpring(VM.y,55,9,h); vmSpring(VM.z,55,9,h);
  vmSpring(VM.rx,50,8.5,h);  vmSpring(VM.ry,50,8.5,h); vmSpring(VM.rz,45,8,h);
  dx += VM.x[0]; dy += VM.y[0]; dz += VM.z[0]; rx += VM.rx[0]; ry += VM.ry[0]; rz += VM.rz[0];

  // хват и плечи: ведущая рука съезжает вниз в ударе, кисти сжимаются на попадании, тело подаётся за замахом
  const st = swinging ? (()=>{ const q = x=>{ x = Math.max(0,Math.min(1,x)); return x*x*(3-2*x); }; return q((swingT-0.15)/0.3)*(1-q((swingT-0.6)/0.35)); })() : 0;
  slideK += (st - slideK) * Math.min(1, dt*14);
  const ud = m.userData;
  ud.slide = slideK; ud.squeeze = Math.min(1, slideK*0.5 + Math.abs(VM.z[1])*0.25);
  if(!ud.shoulderShift) ud.shoulderShift = new THREE.Vector3();
  ud.shoulderShift.set(dx*0.7, dy*0.5 + Math.sin(tS*1.25)*0.002, dz*0.5);

  let px = pose.pos.x, py = pose.pos.y, pz = pose.pos.z;
  if(isMag(toolKind)){
    const sc = (m.userData.holo && m.userData.holoCenter) ? m.userData.holoCenter : m.userData.sightCenter;
    if(aimK > 0){                                   // точка в окне прицела встаёт в центр экрана
      if(toolKind==='rpg'){ px += (0 - px)*aimK; py += (-0.05 - py)*aimK; pz += (0.66 - pz)*aimK; }   // РПГ: смотрим из дула — труба остаётся позади камеры
      else { px += (-sc.x - px)*aimK; py += (-sc.y - py)*aimK; pz += (-((m.userData.holo)?0.23:0.38) - sc.z - pz)*aimK; }
      const q = 1 - 0.55*aimK; dx*=q; dy*=q; dz*=q; rx*=q; ry*=q; rz*=q;
    }
    if(toolKind==='rpg' && reloadT<0 && m.userData.rocket){ const _s = hotbarSlots[selectedSlot]; m.userData.rocket.visible = !!_s && (_s.m|0) > 0; m.userData.rocket.position.z = 0; }
    if(reloadT >= 0){                               // анимация перезарядки
      reloadT += dt/GUNS[toolKind].reload;
      const ss = (a,b,x)=>{ x = Math.max(0,Math.min(1,(x-a)/(b-a))); return x*x*(3-2*x); };
      const dn = ss(0.0,0.18,reloadT)*(1-ss(0.82,1.0,reloadT));
      dy -= 0.07*dn; rx += 0.30*dn; rz += 0.42*dn; dx -= 0.03*dn;
      const out = ss(0.18,0.38,reloadT)*(1-ss(0.55,0.72,reloadT));
      const mg = m.userData.mag; if(mg){ mg.position.y = -0.30*out; mg.visible = out < 0.96; }
      if(toolKind==='rpg' && m.userData.rocket){ const ins = ss(0.30,0.78,reloadT), rk = m.userData.rocket; rk.visible = reloadT > 0.26; rk.position.z = 0.62*(1-ins); dz += 0.03*dn; rx += 0.10*dn; }
      if(!m.userData._r1 && reloadT>0.3){ m.userData._r1 = true; OSIL_AUDIO.play('close',{vol:0.5,rate:1.6}); }
      if(!m.userData._r2 && reloadT>0.66){ m.userData._r2 = true; OSIL_AUDIO.play('open',{vol:0.6,rate:1.8}); dz += 0.01; VM.y[1] += 0.12; }
      if(!m.userData._r3 && reloadT>0.86){ m.userData._r3 = true; OSIL_AUDIO.play('empty',{vol:0.6,rate:0.7}); }
      if(reloadT >= 1){ m.userData._r1 = m.userData._r2 = m.userData._r3 = false; if(m.userData.mag){ m.userData.mag.position.y = 0; m.userData.mag.visible = true; } if(m.userData.rocket){ m.userData.rocket.position.z = 0; m.userData.rocket.visible = true; } finishReload(); }
    }
  }
  m.position.set(px+dx, py+dy, pz+dz);
  m.rotation.set(pose.rot.x+rx, pose.rot.y+ry, pose.rot.z+rz);
  OSIL_TOOLS.updateArms(m);
}

/* =========================================================================
   КАТАЛОГ ПРЕДМЕТОВ И ХРАНИЛИЩЕ
   Один предмет = одна запись каталога. Поле stack — лимит стака:
     ресурсы и еда — 1000, компоненты/боеприпасы/расходники — 10, 1 = не стакается.
   Инвентарь хранится СЛОТАМИ: {k:ключ, n:кол-во, d:прочность|undefined}.
   Одинаковые предметы автоматически сливаются в стак до лимита; остаток уходит
   в следующий стак/свободную ячейку. Если места нет — предмет падает на землю.
   ========================================================================= */
const ITEM_DEFS = {
  // --- ресурсы (до 1000) ---
  wood:    {name:'дерево',  icon:TEXTURES.icon_wood,   stack:1000, kind:'res'},
  stone:   {name:'камень',  icon:TEXTURES.icon_stone,  stack:1000, kind:'res'},
  cloth:   {name:'ткань',   icon:TEXTURES.icon_cloth,  stack:1000, kind:'res'},
  sulfur:  {name:'сера',    icon:TEXTURES.icon_sulfur, stack:1000, kind:'res'},
  metal_ore:{name:'железная руда', icon:'1/metal_ore.webp', stack:1000, kind:'res'},
  sulfur_ore:{name:'серная руда', icon:'assets/images/Sulfur_Ore.webp', stack:1000, kind:'res'},
  metal:   {name:'металл',  icon:TEXTURES.icon_metal,  stack:1000, kind:'res'},
  scrap:   {name:'металлолом', icon:TEXTURES.icon_scrap, stack:1000, kind:'res'},
  fuel:    {name:'топливо', icon:TEXTURES.icon_fuel,   stack:1000, kind:'res'},
  // --- еда (до 1000) ---
  pumpkin: {name:'Тыква',         icon:TEXTURES.icon_pumpkin, stack:1000, kind:'food', eat:{hunger:25,thirst:5,hp:0}},
  meat:    {name:'Жареное мясо',  icon:TEXTURES.icon_meat,    stack:1000, kind:'food', eat:{hunger:30,thirst:0,hp:10}},
  can:     {name:'Консервы',      icon:TEXTURES.icon_can,     stack:1000, kind:'food', eat:{hunger:40,thirst:0,hp:5}},
  // --- компоненты и расходники (до 10) ---
  gunpowder:{name:'Порох',        icon:TEXTURES.icon_gunpowder, stack:10, kind:'comp'},
  nails:   {name:'Гвозди',        icon:TEXTURES.icon_nails,   stack:10, kind:'comp'},
  sheet:   {name:'Листовой металл',icon:TEXTURES.icon_sheet,  stack:10, kind:'comp'},
  gear:    {name:'Шестерня',      icon:TEXTURES.icon_gear,    stack:10, kind:'comp'},
  pipe:    {name:'Труба',         icon:TEXTURES.icon_pipe,    stack:10, kind:'comp'},
  wood_wall:{name:'Деревянная стена',icon:TEXTURES.icon_wall, stack:10, kind:'comp'},
  hammer:  {name:'Киянка',        icon:TEXTURES.icon_hammer,  stack:1,  kind:'gear'},
  mdoor:   {name:'Железная дверь',icon:TEXTURES.icon_mdoor,stack:10,kind:'comp'},
  door:    {name:'Дверь',         icon:TEXTURES.icon_door,    stack:10, kind:'comp'},
  cupboard:{name:'Шкаф',          icon:TEXTURES.icon_cupboard,stack:5,  kind:'comp'},
  copter:  {name:'Миникоптер',    icon:'1/copter.webp', stack:1, kind:'gear'},
  box:     {name:'Ящик',          icon:TEXTURES.icon_box,     stack:10, kind:'comp'},
  // --- не стакаются (1) ---
  rock:    {name:'Камень',   icon:TEXTURES.icon_startrock, stack:1, kind:'tool'},
  axe:     {name:'Каменный топор',icon:TEXTURES.icon_axe,     stack:1, kind:'tool', maxDur:150},
  pickaxe: {name:'Каменная кирка',icon:TEXTURES.icon_pickaxe, stack:1, kind:'tool', maxDur:150},
  spear:   {name:'Копьё',         icon:TEXTURES.icon_spear,   stack:1, kind:'tool', maxDur:120},
  knife:   {name:'Боевой нож', icon:TEXTURES.icon_knife, stack:1, kind:'tool', maxDur:200},
  rifle:   {name:'Штурмовая винтовка',icon:TEXTURES.icon_rifle, stack:1, kind:'gun', maxDur:400},
  berdanka:{name:'Полуавтоматическая винтовка',icon:TEXTURES.icon_berdanka, stack:1, kind:'gun', maxDur:350},
  smg:     {name:'Пистолет-пулемёт',icon:TEXTURES.icon_smg, stack:1, kind:'gun', maxDur:320},
  pistol:  {name:'Пистолет',icon:TEXTURES.icon_pistol, stack:1, kind:'gun', maxDur:300},
  ammo_pistol:{name:'Пистолетные патроны',icon:TEXTURES.icon_ammo_pistol, stack:120, kind:'comp'},
  ammo_rifle:{name:'Винтовочные патроны',icon:TEXTURES.icon_ammo_rifle, stack:120, kind:'comp'},
  plan:    {name:'План строительства',icon:TEXTURES.icon_plan,stack:1, kind:'plan'},
  bag:     {name:'Спальный мешок',icon:TEXTURES.icon_bag,     stack:1, kind:'gear'},
  helm_rusty:{name:'Ржавый шлем', icon:TEXTURES.icon_helm_rusty, stack:1, kind:'armor', maxDur:100},
  helm_home:{name:'Самодельный шлем',icon:TEXTURES.icon_helm_home,stack:1, kind:'armor', maxDur:140},
  armor:   {name:'Броня',         icon:TEXTURES.icon_armor,   stack:1, kind:'armor', maxDur:180},
  eod_suit:{name:'Военная броня', icon:'1/eod_suit.webp', stack:1, kind:'armor', maxDur:600},
  holo_sight:{name:'Голографический прицел', icon:'1/holo_sight.webp', stack:5, kind:'attach'},
  satchel: {name:'Сатчел-заряд',  icon:TEXTURES.icon_satchel, stack:5, kind:'gear'},
  grenade: {name:'Граната',       icon:'1/grenade.webp', stack:6, kind:'gear'},
  rpg:     {name:'РПГ',           icon:'1/rpg.webp', stack:1, kind:'gear'},
  rocket:  {name:'Ракета',        icon:'1/rocket.webp', stack:4, kind:'gear'},
  quarry:  {name:'Карьер',        icon:'1/quarry.webp', stack:1, kind:'gear'},
  furnace: {name:'Печка',          icon:TEXTURES.icon_furnace, stack:1, kind:'gear'},
  backpack:{name:'Рюкзак',        icon:TEXTURES.icon_backpack,stack:1, kind:'gear'},
  chest:   {name:'Ящик',          icon:TEXTURES.icon_chest,   stack:1, kind:'gear'},
  locker:  {name:'Шкаф',          icon:TEXTURES.icon_locker,  stack:1, kind:'gear'},
  workbench:{name:'Верстак',      icon:TEXTURES.icon_workbench,stack:1, kind:'gear'},
};
const RES_KEYS = Object.keys(ITEM_DEFS).filter(k=>ITEM_DEFS[k].kind==='res');
const TOOL_MAX_DUR = {}; Object.keys(ITEM_DEFS).forEach(k=>{ if(ITEM_DEFS[k].maxDur) TOOL_MAX_DUR[k]=ITEM_DEFS[k].maxDur; });
const stackOf = k => (ITEM_DEFS[k] ? ITEM_DEFS[k].stack : 1);
const durable = k => !!TOOL_MAX_DUR[k];

const HOTBAR_N = 6;
const GRID_N = 24;
/* слоты: null | {k, n, d?} */
let gridSlots   = new Array(GRID_N).fill(null);
let hotbarSlots = new Array(HOTBAR_N).fill(null);
let selectedSlot = 0;

const allSlotRefs = ()=>{
  const r=[]; for(let i=0;i<HOTBAR_N;i++) r.push({t:'h',i}); for(let i=0;i<GRID_N;i++) r.push({t:'g',i}); return r;
};
/* экипировка: 4 слота брони + рюкзак; ячейка {t:'e', i:'head'|'chest'|'legs'|'feet'|'pack'} */
const equip = {head:null, chest:null, legs:null, feet:null, pack:null};
const EQUIP_ALLOW = {head:[], chest:['eod_suit','armor'], legs:[], feet:[], pack:['backpack']};
/* военная броня: -75% урона, нельзя бегать, скин виден всем */
const suitWorn = ()=>{ const s=equip.chest; return !!(s && s.n>0 && s.k==='eod_suit'); };
function armorMul(d){
  if(!suitWorn()) return 1;
  const s=equip.chest;
  if(typeof s.d==='number'){ s.d -= Math.max(0.5,d*0.5); if(s.d<=0){ equip.chest=null; try{ showToast('Военная броня разрушена'); }catch(e){} } try{ updateResourceUI(); }catch(e){} }
  return 0.25;
}
function migrateEquip(){ ['head','legs','feet'].forEach(k=>{ const s=equip[k]; if(s){ equip[k]=null; try{ addItem(s.k,s.n||1); }catch(e){} } }); }
const SIGHT_GUNS = ['rifle','berdanka','smg','pistol'];
/* крепление голо-прицела под каждое оружие: z — точка на оружии (локальные координаты модели), k — размер, y — запасная высота, maxY — потолок поиска верха */
const HOLO_CFG = {
  rifle:   {z:-0.050, k:1.00, y:0.061, maxY:0.075},   // АК: на крышке ресивера
  berdanka:{z: 0.040, k:1.00, y:0.090, maxY:0.120},   // над затвором, у заднего целика
  smg:     {z: 0.040, k:0.95, y:0.085, maxY:0.115},   // на кожухе ресивера
  pistol:  {z: 0.000, k:0.80, y:0.064, maxY:0.075}    // на задней части затвора
};
const equipRefs = ()=> Object.keys(equip).map(i=>({t:'e',i}));
function getAt(a){ return a.t==='g' ? gridSlots[a.i] : a.t==='e' ? equip[a.i] : hotbarSlots[a.i]; }
function setAt(a,v){ if(a.t==='g') gridSlots[a.i]=v; else if(a.t==='e') equip[a.i]=v; else hotbarSlots[a.i]=v; }

/* сколько всего предмета k лежит в инвентаре */
function countItem(k){
  let c=0; for(const r of allSlotRefs().concat(equipRefs())){ const s=getAt(r); if(s && s.k===k) c+=s.n; } return c;
}
/* сколько ещё влезет предмета k (докладывание в неполные стаки + свободные ячейки) */
function roomFor(k){
  const cap=stackOf(k); let room=0;
  for(const r of allSlotRefs()){ const s=getAt(r); if(!s) room+=cap; else if(s.k===k) room+=cap-s.n; }
  return room;
}
/* положить n штук. Возвращает сколько РЕАЛЬНО положилось. Сначала добиваем неполные стаки
   (пояс → сетка), затем занимаем свободные ячейки. Прочность у стакающихся не хранится. */
function addItem(k, n, dur){
  const cap=stackOf(k); let left=n;
  if(cap>1){
    for(const r of allSlotRefs()){
      if(left<=0) break;
      const s=getAt(r);
      if(s && s.k===k && s.n<cap){ const add=Math.min(cap-s.n,left); s.n+=add; left-=add; }
    }
  }
  // свободные ячейки: сетка раньше пояса, кроме первого прихода инструмента (он идёт в пояс, если есть место)
  const order = durable(k) ? [...Array(HOTBAR_N).keys()].map(i=>({t:'h',i})).concat([...Array(GRID_N).keys()].map(i=>({t:'g',i})))
                           : [...Array(GRID_N).keys()].map(i=>({t:'g',i})).concat([...Array(HOTBAR_N).keys()].map(i=>({t:'h',i})));
  for(const r of order){
    if(left<=0) break;
    if(!getAt(r)){
      const put=Math.min(cap,left);
      const slot={k,n:put};
      if(durable(k)) slot.d = (dur!==undefined ? dur : TOOL_MAX_DUR[k]);
      setAt(r,slot); left-=put;
    }
  }
  return n-left;
}
/* убрать n штук (сначала из сетки, потом из пояса; из самых неполных стаков). Возвращает сколько убрано. */
function removeItem(k, n){
  if(window.__tester && ITEM_DEFS[k] && /^(res|comp|food)$/.test(ITEM_DEFS[k].kind)) return n;   // TESTER: ресурсы не тратятся
  let left=n;
  const refs=allSlotRefs().filter(r=>{const s=getAt(r);return s&&s.k===k;})
    .sort((a,b)=> getAt(a).n-getAt(b).n || (a.t==='g'?-1:1));
  for(const r of refs){
    if(left<=0) break;
    const s=getAt(r); const take=Math.min(s.n,left); s.n-=take; left-=take;
    if(s.n<=0) setAt(r,null);
  }
  return n-left;
}
/* ---- фасад для старого кода: RESOURCES/ITEMS читаются и пишутся через слоты ---- */
const RESOURCES = new Proxy({}, {
  get:(o,k)=> typeof k==='string' && ITEM_DEFS[k] ? countItem(k) : undefined,
  set:(o,k,v)=>{ const cur=countItem(k); if(v>cur) addItem(k,v-cur); else if(v<cur) removeItem(k,cur-v); return true; },
  has:(o,k)=> !!ITEM_DEFS[k], ownKeys:()=> RES_KEYS, getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true}),
});
const ITEMS = RESOURCES;
const RES_NAMES = {}; Object.keys(ITEM_DEFS).forEach(k=>{ RES_NAMES[k]=ITEM_DEFS[k].name; });
const ICONS = {};     Object.keys(ITEM_DEFS).forEach(k=>{ ICONS[k]=ITEM_DEFS[k].icon; });
addItem('rock',1);   // стартовый набор → пояс
{ const _rr=allSlotRefs().find(r=>{ const s=getAt(r); return s && s.k==='rock'; }); if(_rr){ const _s=getAt(_rr); setAt(_rr,null); if(hotbarSlots[0]) hotbarSlots[1]=hotbarSlots[0]; hotbarSlots[0]=_s; } }   // камень — строго 2-й слот хотбара

/* выдача добычи/крафта с учётом лимита. Излишек не пропадает молча — игрок видит сообщение. */
function giveItem(k, n, dur){
  const got = addItem(k,n,dur);
  if(got<n){ showToast('Нет места: '+(RES_NAMES[k]||k)+' ×'+(n-got)+' пропало'); }
  return got;
}

function makeBuildMat(){ return new THREE.MeshStandardMaterial({map:loadTex(TEXTURES.tex_plank,1,1), roughness:0.95}); }

/* фундамент как в Rust: верх на 0.3 м над землёй, остальные ~1.3 м уходят под землю (скрывают неровности склона) */
function createFoundation(){ return new THREE.Mesh(new THREE.BoxGeometry(4,1.6,4), makeBuildMat()); }
function createWall(){ return new THREE.Mesh(new THREE.BoxGeometry(4,3.5,0.25), makeBuildMat()); }
function createFloor(){ return new THREE.Mesh(new THREE.BoxGeometry(4,0.15,4), makeBuildMat()); }
function createDoorway(){
  const grp = new THREE.Group();
  const mat = makeBuildMat();
  const top = new THREE.Mesh(new THREE.BoxGeometry(4,0.9,0.25), mat);
  top.position.y = 1.3;
  const left = new THREE.Mesh(new THREE.BoxGeometry(1.2,3.5,0.25), mat);
  left.position.x = -1.4;
  const right = new THREE.Mesh(new THREE.BoxGeometry(1.2,3.5,0.25), mat);
  right.position.x = 1.4;
  grp.add(top,left,right);
  return grp;
}

function createShootWall(){
  const g=new THREE.Group(), mat=makeBuildMat();
  const low=new THREE.Mesh(new THREE.BoxGeometry(4,1.1,0.25),mat); low.position.y=-1.2; g.add(low);
  const up=new THREE.Mesh(new THREE.BoxGeometry(4,1.2,0.25),mat); up.position.y=1.15; g.add(up);
  [-1,1].forEach(s=>{ const p=new THREE.Mesh(new THREE.BoxGeometry(1.7,1.2,0.25),mat); p.position.set(s*1.15,-0.05,0); g.add(p); });
  return g;
}
function createParapet(){      // низкая крыша-бруствер с зубцами: стрелять поверх и между зубцами
  const g=new THREE.Group(), mat=makeBuildMat();
  const b=new THREE.Mesh(new THREE.BoxGeometry(4,0.9,0.25),mat); b.position.y=-1.3; g.add(b);
  for(let i=0;i<3;i++){ const m=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.5,0.25),mat); m.position.set(-1.4+i*1.4,-0.6,0); g.add(m); }
  return g;
}
function createStairs(){       // марш на 3.5 м подъёма; поднимается к -Z модели
  const g=new THREE.Group(), mat=makeBuildMat(), N=14, W=2.4;
  for(let i=0;i<N;i++){ const h=FLOOR_H*(i+1)/N, m=new THREE.Mesh(new THREE.BoxGeometry(W,0.18,4/N+0.02),mat); m.position.set(0,h-0.09,2-(i+0.5)*4/N); g.add(m); }
  const stringer=new THREE.Mesh(new THREE.BoxGeometry(W,0.12,Math.hypot(4,FLOOR_H)),mat); stringer.position.set(0,FLOOR_H/2-0.1,0); stringer.rotation.x=Math.atan2(FLOOR_H,4); g.add(stringer);
  return g;
}
const stairsMap = new Map();
const CELL = 4;            // размер клетки, м
const FLOOR_H = 3.5;         // высота этажа
/* кодовая панель на двери: одна плоскость с canvas-текстурой, клавиши нажимаются прицелом + «Удар» */
const PAD_W=256, PAD_H=384, PAD_KEYS=['1','2','3','4','5','6','7','8','9','✖','0','⌫'];
function makePad(){
  const cv=document.createElement('canvas'); cv.width=PAD_W; cv.height=PAD_H;
  const tex=new THREE.CanvasTexture(cv), mat=new THREE.MeshBasicMaterial({map:tex});
  const mk=back=>{ const m=new THREE.Mesh(new THREE.PlaneGeometry(0.34,0.51),mat); m.position.set(1.2,0,back?-0.056:0.056); if(back) m.rotation.y=Math.PI; return m; };
  return {cv,tex,meshes:[mk(false),mk(true)]};
}
function drawPad(pad,text,sub,col){
  const g=pad.cv.getContext('2d');
  g.fillStyle='#1d1c19'; g.fillRect(0,0,PAD_W,PAD_H);
  g.fillStyle='#0b1a0b'; g.fillRect(8,8,PAD_W-16,64);
  g.textAlign='center'; g.textBaseline='middle';
  g.fillStyle=col||'#7dff7d'; g.font='bold 32px monospace'; g.fillText(text||'',PAD_W/2,34);
  g.font='13px monospace'; g.fillStyle='#9db07a'; g.fillText(sub||'',PAD_W/2,60);
  const cw=(PAD_W-16)/3, ch=(PAD_H-88)/4;
  PAD_KEYS.forEach((k,i)=>{ const x=8+(i%3)*cw, y=80+((i/3)|0)*ch;
    g.fillStyle=(k==='✖')?'#6b2a25':'#3b3a34'; g.fillRect(x+3,y+3,cw-6,ch-6);
    g.fillStyle='#fff'; g.font='bold 32px sans-serif'; g.fillText(k,x+cw/2,y+ch/2); });
  pad.tex.needsUpdate=true;
}
/* дверь: пивот на петле, закрытая — коллайдер, открытая — проход. Ширина 1.6 м — ровно проём. */
const isDoorT = t => t==='door' || t==='mdoor';
function createDoor(metal){
  const W=1.6, g = new THREE.Group(), pivot = new THREE.Group(); pivot.position.x = -W/2; g.add(pivot);
  const m = new THREE.Mesh(new THREE.BoxGeometry(W,2.6,0.1), metal ? new THREE.MeshStandardMaterial({map:loadTex(TEXTURES.tex_rustdoor,1,1), color:0xffffff, roughness:0.7, metalness:0.3}) : makeBuildMat()); m.position.x = W/2; pivot.add(m);
  const dark = new THREE.MeshStandardMaterial({color:0x2a2a2a, roughness:0.5, metalness:0.6});
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,0.22), dark); knob.position.set(1.5,-0.25,0); pivot.add(knob);
  const lk = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,0.26), new THREE.MeshStandardMaterial({color:0xb8952a, roughness:0.4, metalness:0.7})); lk.position.set(1.5,0.05,0); lk.visible = false; pivot.add(lk);
  const pad = makePad(); pad.meshes.forEach(p=>{ p.visible=false; pivot.add(p); }); drawPad(pad,'','');
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.4,0.5), new THREE.MeshBasicMaterial({visible:false})); hit.position.set(1.45,-0.1,0); pivot.add(hit); g.userData.hit = hit;
  g.userData.pivot = pivot; g.userData.door = m; g.userData.lock = lk; g.userData.pad = pad;
  return g;
}
function _qMats(){
  if(_qMats.c) return _qMats.c;
  const OM=(window.OSIL_TOOLS&&OSIL_TOOLS.materials)||{}, env=OM.wood?OM.wood.envMap:null;
  const T={plank:loadTex(TEXTURES.tex_plank,1,1), stone:loadTex(TEXTURES.tex_stone,1,1), rock:loadTex(TEXTURES.tex_rockore,1,1)};
  const M=(o,ei)=>{ const d={color:o.color}; if(o.map) d.map=o.map; if(o.flatShading) d.flatShading=true; return new THREE.MeshLambertMaterial(d); };   // дешёвый шейдер: у карьера съедал FPS на заполнении экрана
  return _qMats.c = {
    steel:M({color:0x4d5359,roughness:0.42,metalness:0.92}), dark:M({color:0x1f2226,roughness:0.6,metalness:0.8}),
    rust:M({color:0x8a4b2a,roughness:0.72,metalness:0.55},0.5), red:M({color:0x8f2a1d,roughness:0.5,metalness:0.4}),
    yel:M({color:0xc99a1e,roughness:0.55,metalness:0.35}),
    wood:M({color:0xc8a47a,roughness:0.85,metalness:0,map:T.plank},0.15), woodD:M({color:0x8a6a48,roughness:0.9,metalness:0,map:T.plank},0.1),
    stone:M({color:0xb4b0a8,roughness:0.93,metalness:0,map:T.stone},0.2), rock:M({color:0xa8a49c,roughness:0.95,metalness:0.02,map:T.stone,flatShading:true},0.2),
    ore:[M({color:0x8d8880,roughness:0.95,metalness:0.05,map:T.rock,flatShading:true},0.2), M({color:0xa86a44,roughness:0.9,metalness:0.25,map:T.rock,flatShading:true},0.4), M({color:0xd4bf48,roughness:0.85,metalness:0.05,map:T.rock,flatShading:true},0.2)],
    belt:M({color:0x17181a,roughness:0.9,metalness:0.1},0.3),
    clay:M({color:0xa9643c,roughness:0.9,metalness:0,map:T.rock},0.15),
    fire:new THREE.MeshBasicMaterial({color:0xff9a28}), fire2:new THREE.MeshBasicMaterial({color:0xffe27a})
  };
}
function createQuarry(){      // карьер: каменное основание, дощатая палуба, стальная буровая вышка, навес с дизелем; бур вращается при работе. Начало — на земле.
  const g = new THREE.Group(), stat = new THREE.Group(), spin = new THREE.Group(), Q = _qMats();
  const add = (grp,geo,m,x,y,z,rx,ry,rz)=>{ const o = new THREE.Mesh(geo,m); o.position.set(x,y,z); if(rx||ry||rz) o.rotation.set(rx||0,ry||0,rz||0); grp.add(o); return o; };
  const B = (w,h,d)=> new THREE.BoxGeometry(w,h,d), C = (r,h,sg,r2)=> new THREE.CylinderGeometry(r2===undefined?r:r2,r,h,sg||14);
  let sd = 7; const rnd = ()=>{ sd = (sd*16807)%2147483647; return sd/2147483647; };
  const DX = -0.2;
  add(stat,B(5.0,0.9,3.6),Q.stone, 0,-0.2,0);                                  // каменное основание
  for(let i=0;i<9;i++){ const a=i/9*Math.PI*2, ex=Math.cos(a)*2.6, ez=Math.sin(a)*1.9, r=0.28+rnd()*0.3;   // валуны по периметру
    const o = add(stat,new THREE.DodecahedronGeometry(r,0),Q.rock, ex,0.0+r*0.2,ez, rnd()*3,rnd()*3,rnd()*3); o.scale.set(1,0.7+rnd()*0.3,1); }
  for(let i=0;i<12;i++) add(stat,B(0.38,0.1,3.1),i&1?Q.woodD:Q.wood, -2.2+i*0.4,0.3,0);     // дощатая палуба
  [-1.6,1.6].forEach(z=> add(stat,B(4.8,0.12,0.14),Q.steel, 0,0.38,z));          // стальные кромки
  [-1.2,0,1.2].forEach(x=> add(stat,B(0.16,0.12,3.3),Q.woodD, x*1.8,0.4,0));      // поперечные брусья
  [[-0.7,-0.7],[0.7,-0.7],[-0.7,0.7],[0.7,0.7]].forEach(q=>{ add(stat,B(0.12,4.7,0.12),Q.steel, DX+q[0],2.7,q[1]); add(stat,B(0.17,0.3,0.17),Q.yel, DX+q[0],0.6,q[1]); });   // ноги вышки
  [1.2,2.6,4.0].forEach(y=>{ [-0.7,0.7].forEach(o=>{ add(stat,B(1.4,0.06,0.06),Q.dark, DX,y,o); add(stat,B(0.06,0.06,1.4),Q.dark, DX+o,y,0); }); });
  [-0.7,0.7].forEach(o=>{ add(stat,B(0.05,1.75,0.05),Q.dark, DX,1.9,o, 0,0,0.8); add(stat,B(0.05,1.75,0.05),Q.dark, DX+o,3.3,0, 0.8,0,0); });
  add(stat,B(1.7,0.12,1.7),Q.wood, DX,3.0,0); [[-0.8,-0.8],[0.8,-0.8],[-0.8,0.8],[0.8,0.8]].forEach(q=> add(stat,C(0.04,0.7,8),Q.woodD, DX+q[0],3.35,q[1]));   // деревянная площадка
  add(stat,B(1.8,0.35,1.8),Q.steel, DX,5.1,0); add(stat,C(0.45,0.6,18),Q.dark, DX,5.55,0); add(stat,C(0.2,0.45,12),Q.red, DX+0.55,5.4,0.3);
  add(stat,C(0.32,0.2,16),Q.dark, DX,0.47,0);
  [[-2.35,-1.45],[-1.05,-1.45],[-2.35,0.0],[-1.05,0.0]].forEach(q=> add(stat,C(0.07,2.1,8),Q.woodD, q[0],1.35,q[1]));   // навес над дизелем
  add(stat,B(1.8,0.07,1.8),Q.rust, -1.7,2.45,-0.72, 0,0,0.1);
  add(stat,B(1.1,0.8,0.9),Q.red, -1.7,0.85,-0.8); add(stat,B(0.9,0.2,0.8),Q.dark, -1.7,1.35,-0.8); add(stat,B(0.05,0.55,0.8),Q.dark, -1.14,0.9,-0.8);   // дизель
  add(stat,C(0.3,0.12,16),Q.steel, -1.1,0.9,-0.8, 0,0,Math.PI/2);
  add(stat,C(0.07,2.7,10),Q.steel, -2.1,1.9,-1.1); add(stat,C(0.12,0.07,10),Q.dark, -2.1,3.28,-1.1);
  [[-1.95,1.0],[-1.35,1.25]].forEach(q=>{ add(stat,C(0.28,0.72,16),Q.red, q[0],0.7,q[1]); [0.25,-0.25].forEach(o=> add(stat,C(0.295,0.04,16),Q.dark, q[0],0.7+o,q[1])); });   // бочки
  add(stat,B(0.6,0.5,0.6),Q.wood, -0.7,0.62,1.2, 0,0.3,0); add(stat,B(0.45,0.4,0.45),Q.woodD, -0.65,1.07,1.2, 0,-0.2,0);   // ящики
  add(stat,B(2.0,0.1,0.6),Q.belt, 1.5,0.95,0, 0,0,0.5);                          // конвейер
  [-0.33,0.33].forEach(o=> add(stat,B(2.0,0.08,0.06),Q.steel, 1.5,1.0,o, 0,0,0.5));
  [[0.95,0.55],[1.95,0.95]].forEach(q=> [-0.3,0.3].forEach(o=> add(stat,B(0.08,q[1],0.08),Q.woodD, q[0]+0.25,q[1]/2+0.36,o)));
  [[2.05,0.0,0.55,0],[1.6,0.55,0.4,1],[1.75,-0.55,0.45,2],[1.15,0.2,0.3,0]].forEach(q=>{ const o=add(stat,new THREE.DodecahedronGeometry(q[2],0),Q.ore[q[3]], q[0],0.37+q[2]*0.6,q[1], rnd()*3,rnd()*3,0); o.scale.y=0.7; });   // кучи добычи
  add(stat,B(0.55,0.75,0.32),Q.steel, -0.2,0.75,1.4); add(stat,C(0.05,0.1,8),Q.red, -0.1,1.17,1.4); add(stat,B(0.4,0.2,0.02),Q.dark, -0.2,0.9,1.57);
  add(spin,C(0.1,5.0,12),Q.steel, 0,2.65,0);
  for(let i=0;i<14;i++){ const a = i*0.95; const o = add(spin,B(0.5,0.07,0.16),Q.dark, Math.cos(a)*0.28,0.75+i*0.29,Math.sin(a)*0.28); o.rotation.y = -a; }
  add(spin,B(1.15,0.09,0.13),Q.dark, 0,3.7,0); add(spin,B(0.13,0.09,1.15),Q.steel, 0,3.4,0);
  [-0.55,0.55].forEach(o=>{ add(spin,C(0.1,0.34,10),Q.steel, o,3.7,0); add(spin,C(0.09,0.3,10),Q.rust, 0,3.4,o); });
  spin.position.set(DX,0,0);
  mergeGroupByMaterial(stat); mergeGroupByMaterial(spin);
  g.add(stat); g.add(spin); g.userData.spin = spin;
  g.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  g.traverse(o=>{ if(o.isMesh) o.receiveShadow = false; });
  spin.traverse(o=>{ if(o.isMesh){ o.castShadow = false; o.receiveShadow = false; } });   // вращающийся бур не гоняем через теневой проход: меньше нагрузки рядом с карьером
  return g;
}
function createFurnace(){     // глиняная печь на каменном основании с огнём в устье; перёд — +Z
  const g = new THREE.Group(), Q = _qMats();
  const add = (geo,m,x,y,z,rx,ry,rz)=>{ const o = new THREE.Mesh(geo,m); o.position.set(x,y,z); if(rx||ry||rz) o.rotation.set(rx||0,ry||0,rz||0); g.add(o); return o; };
  add(new THREE.CylinderGeometry(0.66,0.7,0.3,16),Q.stone, 0,0.15,0);
  for(let i=0;i<9;i++){ const a=i/9*Math.PI*2+0.2, o=add(new THREE.DodecahedronGeometry(0.17+(i%3)*0.03,0),Q.rock, Math.cos(a)*0.66,0.2,Math.sin(a)*0.66, i,i*2,0); o.scale.y=0.8; }
  const pts=[[0.5,0.28],[0.52,0.45],[0.5,0.7],[0.42,0.95],[0.3,1.18],[0.2,1.36],[0.2,1.46]].map(p=>new THREE.Vector2(p[0],p[1]));
  add(new THREE.LatheGeometry(pts,20),Q.clay, 0,0,0); add(new THREE.TorusGeometry(0.2,0.035,8,16),Q.dark, 0,1.46,0, Math.PI/2,0,0);
  add(new THREE.BoxGeometry(0.46,0.4,0.2),Q.dark, 0,0.55,0.46);                               // устье
  add(new THREE.BoxGeometry(0.12,0.46,0.2),Q.stone, -0.3,0.55,0.46); add(new THREE.BoxGeometry(0.12,0.46,0.2),Q.stone, 0.3,0.55,0.46); add(new THREE.BoxGeometry(0.72,0.1,0.2),Q.stone, 0,0.82,0.46);
  add(new THREE.PlaneGeometry(0.34,0.26),Q.fire, 0,0.5,0.565); add(new THREE.ConeGeometry(0.1,0.22,6),Q.fire2, 0,0.46,0.55);
  mergeGroupByMaterial(g);
  g.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
function createCupboard(){
  const g=new THREE.Group(), mat=makeBuildMat(); mat.color.set(0xc9a070);
  const body=new THREE.Mesh(new THREE.BoxGeometry(1,1.7,0.6),mat); g.add(body);
  const dm=new THREE.MeshStandardMaterial({color:0x4a3018,roughness:0.9});
  [-0.25,0.25].forEach(x=>{ const p=new THREE.Mesh(new THREE.BoxGeometry(0.42,1.5,0.03),dm); p.position.set(x,0,0.3); g.add(p); const h=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.2,0.05),new THREE.MeshStandardMaterial({color:0xb8952a,metalness:0.7,roughness:0.4})); h.position.set(x*0.35,0,0.34); g.add(h); });
  return g;
}
function createBox(){
  const g=new THREE.Group(), mat=makeBuildMat(); mat.color.set(0xd8b080);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9,0.6,0.6),mat));
  const lid=new THREE.Mesh(new THREE.BoxGeometry(0.96,0.1,0.66),new THREE.MeshStandardMaterial({color:0x6b4423,roughness:0.9})); lid.position.y=0.33; g.add(lid);
  return g;
}
/* kind: 'cell' — занимает клетку (фундамент/пол), 'edge' — на ребре клетки (стена/проём/дверь).
   cost: что списывается. Часть деталей берётся из готовых предметов крафта (wood_wall, door). */
const BUILD_TYPES = {
  foundation:{ name:'Фундамент', kind:'cell', make:createFoundation, cost:{wood:10},               snapY:-0.5,  needGround:true },
  floor:     { name:'Пол',       kind:'cell', make:createFloor,      cost:{wood:8},                snapY:0.075, needBelow:true },
  wall:      { name:'Стена',     kind:'edge', make:createWall,       cost:{wood:10},           snapY:1.75,   needBelow:true },
  doorway:   { name:'Проём',     kind:'edge', make:createDoorway,    cost:{wood:10},               snapY:1.75,   needBelow:true },
  mdoor:     { name:'Железная дверь', kind:'edge', make:()=>createDoor(true), cost:{mdoor:1}, snapY:1.3, needDoorway:true },
  door:      { name:'Дверь',     kind:'edge', make:createDoor,       cost:{door:1},                snapY:1.3,  needDoorway:true },
  shootwall: { name:'Бойница',   kind:'edge', make:createShootWall,  cost:{wood:15},               snapY:1.75,   needBelow:true },
  parapet:   { name:'Бруствер',  kind:'edge', make:createParapet,    cost:{wood:8},                snapY:1.75,   needBelow:true },
  stairs:    { name:'Лестница',  kind:'stair',make:createStairs,     cost:{wood:30},               snapY:0 },
  cupboard:  { name:'Шкаф',      kind:'obj',  make:createCupboard,   cost:{cupboard:1},            snapY:0.85 },
  box:       { name:'Ящик',      kind:'obj',  make:createBox,        cost:{box:1},                 snapY:0.38 },
  quarry:    { name:'Карьер',    kind:'obj',  make:createQuarry,     cost:{quarry:1},              snapY:0 },
  furnace:   { name:'Печка',     kind:'obj',  make:createFurnace,    cost:{furnace:1},            snapY:0 },
};
const BUILD_ORDER = ['foundation','wall','shootwall','doorway','floor','stairs','parapet'];
const PLACE_HELD = {mdoor:1, door:1, cupboard:1, box:1, quarry:1, furnace:1};       // ставятся из рук, а не из меню плана
const PART_MAX = {furnace:150, quarry:300, shootwall:200, parapet:150, stairs:150, foundation:250, floor:200, wall:200, doorway:200, door:200, mdoor:450, cupboard:150, box:150};
const PART_NAME = {furnace:'Печка', quarry:'Карьер', shootwall:'Бойница', parapet:'Бруствер', stairs:'Лестница', foundation:'Фундамент', floor:'Пол', wall:'Стена', doorway:'Проём', door:'Дверь', mdoor:'Железная дверь', cupboard:'Шкаф', box:'Ящик'};
const WEAPON_DMG = {rock:10, rifle:20, pistol:25, berdanka:35, smg:18, axe:15, pickaxe:12, spear:25, knife:28};
const BUILD_DMG_K = 0.1;        // по постройкам оружие бьёт в 10 раз слабее, чем по человеку
const CUP_R = 30, DECAY_MIN = 180;   // шкаф защищает от гниения в радиусе 30 м; без шкафа деталь гниёт целиком за 3 часа

/* ---------------- Crafting system ---------------- */
const CRAFT_CATS = [
  {id:'all',   name:'ВСЕ'},
  {id:'tools', name:'ИНСТРУМЕНТЫ'},
  {id:'weapons',name:'ОРУЖИЕ'},
  {id:'ammo',  name:'БОЕПРИПАСЫ'},
  {id:'armor', name:'БРОНЯ'},
  {id:'comp',  name:'КОМПОНЕНТЫ'},
  {id:'build', name:'ПОСТРОЙКИ'},
  {id:'mech',  name:'МЕХАНИЗМЫ'},
];
/* cost — ресурсы; give — что получаем; wb:1 — нужен верстак рядом (пока: предмет «Верстак» в инвентаре);
   quick:false — не показывать в «быстром создании». */
const CRAFT_RECIPES = [
  // --- инструменты ---
  { id:'axe',     cat:'tools', name:'Каменный топор', desc:'Хорошо рубит деревья. Каждый крафт даёт новый топор.', icon:ITEM_DEFS.axe.icon,     time:5,  cost:{wood:30},            give:{tool:'axe'} },
  { id:'pickaxe', cat:'tools', name:'Каменная кирка', desc:'Добывает камень, железную и серную руду (руду плавят в печке).',          icon:ITEM_DEFS.pickaxe.icon, time:5,  cost:{wood:20,stone:20},   give:{tool:'pickaxe'} },
  { id:'spear',   cat:'weapons', name:'Копьё',        desc:'Простое оружие ближнего боя.',            icon:ITEM_DEFS.spear.icon,   time:8,  cost:{wood:40,stone:15},   give:{tool:'spear'} },
  { id:'knife',   cat:'weapons', name:'Боевой нож',   desc:'Оружие ближнего боя: 28 урона, удары чащее копья.', icon:ITEM_DEFS.knife.icon, time:6, cost:{metal:30,wood:10}, give:{tool:'knife'} },
  { id:'rifle',  cat:'weapons', name:'Штурмовая винтовка', desc:'Автоматическая винтовка. Зажмите «Удар» для стрельбы. Нужны винтовочные патроны.', icon:ITEM_DEFS.rifle.icon, time:25, cost:{metal:120,pipe:2,gear:2,wood:60}, give:{tool:'rifle'} },
  { id:'berdanka', cat:'weapons', name:'Полуавтоматическая винтовка', desc:'Полуавтоматическая винтовка. Магазин 15, винтовочные патроны, урон 35, в голову ×2.', icon:ITEM_DEFS.berdanka.icon, time:30, cost:{metal:150,pipe:3,gear:3,wood:80}, give:{tool:'berdanka'} },
  { id:'satchel', cat:'weapons', name:'Сатчел-заряд', desc:'Бросьте в стену или дверь: прилипнет, 10 писков, затем взрыв — 75 урона детали.', icon:ITEM_DEFS.satchel.icon, time:40, cost:{cloth:80,gunpowder:25,metal:100,pipe:2,gear:1}, give:{item:'satchel', amount:1} },
  { id:'smg', cat:'weapons', name:'Пистолет-пулемёт', desc:'Высокая скорострельность, магазин 20, урон 18, в голову ×2. Пистолетные патроны.', icon:ITEM_DEFS.smg.icon, time:20, cost:{metal:90,pipe:3,gear:2,wood:20}, give:{tool:'smg'} },
  { id:'pistol', cat:'weapons', name:'Пистолет', desc:'Урон 25, в голову ×2. Патроны пистолетные.', icon:ITEM_DEFS.pistol.icon, time:15, cost:{metal:50,pipe:2,gear:1}, give:{tool:'pistol'} },
  { id:'ammo_pistol', cat:'weapons', name:'Пистолетные патроны', desc:'Для пистолета. Стак 120.', icon:ITEM_DEFS.ammo_pistol.icon, time:5, cost:{metal:8,gunpowder:2}, give:{item:'ammo_pistol', amount:24} },
  { id:'ammo_rifle', cat:'weapons', name:'Винтовочные патроны', desc:'Боеприпасы для штурмовой винтовки. Стак до 120.', icon:ITEM_DEFS.ammo_rifle.icon, time:6, cost:{metal:10,gunpowder:2}, give:{item:'ammo_rifle', amount:30} },
  // --- еда ---
  // --- компоненты (стак до 10) ---
  { id:'gunpowder', cat:'comp', name:'Порох',         desc:'Делается из серы и ткани. Пригодится для взрывчатки. Стак до 10.',   icon:ITEM_DEFS.gunpowder.icon, time:10, cost:{sulfur:20,cloth:5}, give:{item:'gunpowder', amount:10} },
  { id:'nails',   cat:'comp', name:'Гвозди',          desc:'Нужны для дверей и построек. Стак до 10.',                           icon:ITEM_DEFS.nails.icon,   time:6,  cost:{metal:8},            give:{item:'nails', amount:10} },
  { id:'sheet',   cat:'comp', name:'Листовой металл', desc:'Металлические листы для брони и дверей. Стак до 10.',                icon:ITEM_DEFS.sheet.icon,   time:8,  cost:{metal:15},           give:{item:'sheet', amount:2} },
  { id:'gear',    cat:'comp', name:'Шестерня',        desc:'Деталь для механизмов. Стак до 10.',                                 icon:ITEM_DEFS.gear.icon,    time:10, cost:{metal:20,scrap:5},   give:{item:'gear', amount:1} },
  { id:'pipe',    cat:'comp', name:'Труба',           desc:'Стальная труба для оружия и механизмов. Стак до 10.',                icon:ITEM_DEFS.pipe.icon,    time:8,  cost:{metal:12},           give:{item:'pipe', amount:1} },
  { id:'fuel',    cat:'comp', name:'Топливо',         desc:'Горючая смесь из ткани и серы (стак до 1000).',                      icon:ITEM_DEFS.fuel.icon,    time:6,  cost:{cloth:10,sulfur:5},  give:{item:'fuel', amount:5} },
  // --- броня ---
  { id:'eod_suit',cat:'armor', name:'Военная броня', desc:'Снижает весь урон на 75%. Видна другим игрокам. В ней нельзя бегать.', icon:ITEM_DEFS.eod_suit.icon, time:60, cost:{metal:250,cloth:100,gear:3}, give:{item:'eod_suit'} },
  { id:'holo_sight',cat:'armor', name:'Голографический прицел', desc:'Крепится на любое оружие: откройте оружие в инвентаре и нажмите «Установить прицел».', icon:ITEM_DEFS.holo_sight.icon, time:20, cost:{metal:60,cloth:20,gear:1}, give:{item:'holo_sight'} },
  // --- предметы ---
  // --- стройка ---
  { id:'hammer',  cat:'tools', name:'Киянка', desc:'Снос и подбор построек, пока с постройки прошло меньше 10 минут. Улучшение стен и пола в камень (×2 прочность).', icon:ITEM_DEFS.hammer.icon, time:6, cost:{wood:60,stone:15}, give:{item:'hammer'} },
  { id:'mdoor',   cat:'build', name:'Железная дверь', desc:'Прочность 450. Возьмите в руки и поставьте в проём.', icon:ITEM_DEFS.mdoor.icon, time:12, cost:{metal:80}, give:{item:'mdoor'} },
  { id:'door',    cat:'build', name:'Дверь', desc:'Возьмите в руки, встаньте у проёма и нажмите «Удар». Кодовый замок ставится прямо на двери.', icon:ITEM_DEFS.door.icon, time:8, cost:{wood:50}, give:{item:'door'} },
  { id:'cupboard',cat:'build', name:'Шкаф', desc:'Постройки в радиусе 30 м не гниют. Ставится на фундамент или пол.', icon:ITEM_DEFS.cupboard.icon, time:10, cost:{wood:100,cloth:10}, give:{item:'cupboard'} },
  { id:'box',     cat:'build', name:'Ящик', desc:'Хранилище на 20 ячеек. Ставится на фундамент или пол.', icon:ITEM_DEFS.box.icon, time:6, cost:{wood:60}, give:{item:'box'} },
  { id:'copter',  cat:'tools', name:'Миникоптер', desc:'Личный коптер: им управляете только вы. Возьмите в руки и нажмите «Удар», чтобы поставить. 100 HP: ломается от оружия, топора, кирки и столкновений.', icon:ITEM_DEFS.copter.icon, time:120, cost:{metal:200,scrap:50,gear:5,sheet:1}, give:{item:'copter'} },
  { id:'grenade', cat:'weapons', name:'Граната', desc:'Бросок по дуге, взрыв через 3.5 с. 50 урона постройкам рядом; игроков рядом тоже ранит.', icon:ITEM_DEFS.grenade.icon, time:4, cost:{metal:30,gunpowder:10,cloth:5}, give:{item:'grenade', amount:1} },
  { id:'rpg',     cat:'weapons', name:'РПГ', desc:'Ракетница. Заряжается ракетами из сумки, по одному выстрелу. Ракета наносит 150 урона любой постройке и предмету в радиусе взрыва.', icon:ITEM_DEFS.rpg.icon, time:40, cost:{metal:200,gear:6,pipe:6,wood:50}, give:{item:'rpg', amount:1} },
  { id:'rocket',  cat:'weapons', name:'Ракета', desc:'Боеприпас для РПГ. 150 урона постройкам, предметам и коптеру, ранит игроков рядом.', icon:ITEM_DEFS.rocket.icon, time:10, cost:{metal:40,gunpowder:50,pipe:2}, give:{item:'rocket', amount:1} },
  { id:'furnace', cat:'build', name:'Печка', desc:'Плавит железную и серную руду в железо и серу. Топливо — дерево или топливо. Ставится на фундамент или пол.', icon:ITEM_DEFS.furnace.icon, time:6, cost:{stone:100,wood:50}, give:{item:'furnace'} },
  { id:'quarry',  cat:'build', name:'Карьер', desc:'Закиньте топливо — карьер сам добывает камень, железную и серную руду. Ставится на ровную землю (не на фундамент); пока работает — бур вращается.', icon:ITEM_DEFS.quarry.icon, time:12, cost:{wood:200,metal:150,gear:4,pipe:4}, give:{item:'quarry'} },
  { id:'plan',    cat:'build', name:'План строительства', desc:'Открывает режим строительства. Выберите в поясе и нажмите «Удар».', icon:ITEM_DEFS.plan.icon,  time:6,  cost:{wood:30,cloth:10},   give:{item:'plan'} },
];
/* Прочность хранится в самом слоте (slot.d). Инструмент в руке — hotbar[selectedSlot]. */
function isTool(k){ return ITEM_DEFS[k] && ITEM_DEFS[k].kind==='tool'; }
function durFrac(slot){ return (slot && durable(slot.k) && slot.d!==undefined) ? slot.d/TOOL_MAX_DUR[slot.k] : null; }
/* лучший экземпляр предмета: с максимальной прочностью (для ремонта — с минимальной) */
function findSlots(k){ return allSlotRefs().concat(equipRefs()).filter(r=>{const x=getAt(r);return x&&x.k===k;}); }

let ADMIN_FREE = false;
try{ ADMIN_FREE = localStorage.getItem('osil_admin')==='1'; }catch(e){}
function adminGrantRes(){ ['wood','stone','metal'].forEach(k=>{ const n=1000-countItem(k); if(n>0) addItem(k,n); }); }   // докидывает до 1000
function adminFree(){ return ADMIN_FREE || !!window.__tester || !!(window.OSIL_ACC && OSIL_ACC.isAdmin && OSIL_ACC.isAdmin()); }   // локальный промокод ИЛИ админ на сервере   // промокод Admin6737: +1000 дерева, камня, железа
if(ADMIN_FREE) adminGrantRes();
window.OSIL_ADMIN = { ok(){ return ADMIN_FREE && !(window.OSIL_NET && OSIL_NET.on); }, setTime(f){ gameClock = ((f%1)+1)%1*CYCLE_LEN; skyTimer = 99; }, getTime(){ return gameClock/CYCLE_LEN; } };
const DONATE_ITEMS = ['copter','quarry','eod_suit'];
function donLocked(id){ if(!(window.OSIL_NET && OSIL_NET.on)) return false; return DONATE_ITEMS.includes(id) && !(window.OSIL_ACC && OSIL_ACC.owns(id)); }   // в одиночной игре донат-предметы доступны
function canCraft(r, qty){
  if(donLocked(r.give && (r.give.item||r.give.tool))) return false;
  if(adminFree()) return true;
  if(!Object.keys(r.cost).every(k => countItem(k) >= r.cost[k]*qty)) return false;
  return true;
}
/* Ремонт вместо дубля: если такой инструмент уже есть — крафт чинит самый изношенный до максимума. */
function repairTarget(itemKey){
  const refs=findSlots(itemKey); if(!refs.length) return null;
  refs.sort((a,b)=>getAt(a).d-getAt(b).d);
  const r=refs[0], sl=getAt(r);
  return sl.d < TOOL_MAX_DUR[itemKey] ? sl : 'full';
}
/* реальное время крафта (секунды на 1 партию), как в Rust */
const CRAFT_CAT_MAP = {axe:'tools',pickaxe:'tools',hammer:'tools',spear:'weapons',knife:'weapons',rifle:'weapons',berdanka:'weapons',smg:'weapons',pistol:'weapons',satchel:'weapons',grenade:'weapons',rpg:'weapons',holo_sight:'weapons',ammo_pistol:'ammo',ammo_rifle:'ammo',rocket:'ammo',gunpowder:'ammo',eod_suit:'armor',nails:'comp',sheet:'comp',gear:'comp',pipe:'comp',fuel:'comp',plan:'build',door:'build',mdoor:'build',cupboard:'build',box:'build',furnace:'mech',quarry:'mech',copter:'mech'};
CRAFT_RECIPES.forEach(r=>{ if(CRAFT_CAT_MAP[r.id]) r.cat = CRAFT_CAT_MAP[r.id]; });
const CRAFT_TIME = {axe:4,pickaxe:4,spear:5,knife:6,rifle:24,berdanka:20,satchel:12,smg:16,pistol:12,ammo_pistol:2,ammo_rifle:3,gunpowder:4,nails:2,sheet:2,gear:6,pipe:3,fuel:2,eod_suit:36,holo_sight:9,hammer:4,mdoor:9,door:4,cupboard:8,box:3,plan:2,copter:24,grenade:4,quarry:12,furnace:6,rpg:40,rocket:10};
CRAFT_RECIPES.forEach(r=>{ if(CRAFT_TIME[r.id]) r.time = CRAFT_TIME[r.id]; });
/* очередь: не больше 3 РАЗНЫХ предметов одновременно; ресурсы списываются при постановке, партии делаются по одной */
const craftQueue = [], CRAFT_Q_MAX = 3;
function craftItem(id, qty){
  qty = qty||1;
  const r = CRAFT_RECIPES.find(x=>x.id===id);
  if(!r) return;
  if(donLocked(r.give && (r.give.item||r.give.tool))){ showToast('Донат-предмет: купите его во вкладке «Донат»'); return; }
  if(!canCraft(r, qty)){ showToast('Недостаточно ресурсов'); window.OSIL_AUDIO&&OSIL_AUDIO.play('rust-door-denied'); return; }
  const ex = craftQueue.find(q=>q.id===id);
  if(!ex && craftQueue.length >= CRAFT_Q_MAX){ showToast('Очередь: не больше '+CRAFT_Q_MAX+' разных предметов'); window.OSIL_AUDIO&&OSIL_AUDIO.play('rust-door-denied'); return; }
  if(adminFree()){                                  // админ: мгновенный крафт, без очереди и ресурсов
    const key = r.give.tool || r.give.item, want = (r.give.amount||1)*qty;
    if(roomFor(key) < want){ showToast('Нет места для: '+r.name); window.OSIL_AUDIO&&OSIL_AUDIO.play('rust-door-denied'); return; }
    addItem(key, want); pushRecent(r.id); showToast('Готово: '+r.name+(want>1?' ×'+want:'')); window.OSIL_AUDIO&&OSIL_AUDIO.play('build');
    updateResourceUI(); renderCraftUI(); return;
  }
  Object.keys(r.cost).forEach(k => removeItem(k, r.cost[k]*qty));
  if(ex) ex.qty += qty; else craftQueue.push({id, qty, t:0});
  showToast('В очереди: '+r.name+' ×'+qty+' ('+Math.round(r.time*qty)+' с)');
  window.OSIL_AUDIO&&OSIL_AUDIO.play('build');
  updateResourceUI(); renderCraftUI(); renderCraftQueue();
}
function craftCancel(i){
  const q = craftQueue[i]; if(!q) return; const r = CRAFT_RECIPES.find(x=>x.id===q.id);
  if(!adminFree()) Object.keys(r.cost).forEach(k=>giveItem(k, r.cost[k]*q.qty));   // возврат ресурсов за неготовые партии
  craftQueue.splice(i,1); renderCraftQueue(); updateResourceUI(); renderCraftUI();
}
const cqEl = document.createElement('div'); cqEl.id='craft-queue';
cqEl.style.cssText='position:fixed;left:8px;top:calc(112px + env(safe-area-inset-top,0px));z-index:14;display:none;flex-direction:column;gap:4px;font:600 11px sans-serif;color:#fff';
document.body.appendChild(cqEl);
function renderCraftQueue(){
  cqEl.style.display = craftQueue.length ? 'flex' : 'none';
  cqEl.innerHTML = craftQueue.map((q,i)=>{ const r=CRAFT_RECIPES.find(x=>x.id===q.id), f=Math.min(1,q.t/r.time), rem=Math.ceil(r.time*q.qty - q.t);
    return '<div data-i="'+i+'" style="position:relative;display:flex;align-items:center;gap:6px;min-width:150px;padding:4px 8px;background:rgba(20,20,18,.8)"><img src="'+r.icon+'" style="width:22px;height:22px"><span>'+r.name+' ×'+q.qty+'</span><span style="margin-left:auto;opacity:.8">'+rem+'с</span><span class="cq-x" style="padding:2px 6px;opacity:.8">✕</span><i style="position:absolute;left:0;bottom:0;height:3px;width:'+(f*100)+'%;background:#8bc34a"></i></div>'; }).join('');
}
cqEl.addEventListener('pointerdown', e=>{ const x=e.target.closest('.cq-x'); if(!x) return; e.preventDefault(); e.stopPropagation(); craftCancel(+x.parentNode.dataset.i); });
let _cqWarn = 0;
let recentCrafts = []; try{ recentCrafts = JSON.parse(localStorage.getItem('osil_recent')||'[]').filter(id=>CRAFT_RECIPES.some(r=>r.id===id)).slice(0,10); }catch(e){}
function pushRecent(id){ recentCrafts = [id].concat(recentCrafts.filter(x=>x!==id)).slice(0,10); try{ localStorage.setItem('osil_recent', JSON.stringify(recentCrafts)); }catch(e){} try{ renderQuickCraft(); }catch(e){} }
function craftQueueTick(dt){
  if(!craftQueue.length) return;
  const q = craftQueue[0], r = CRAFT_RECIPES.find(x=>x.id===q.id), prev = q.t;
  q.t += dt;
  if(q.t >= r.time){
    const key = r.give.tool || r.give.item, want = r.give.amount||1;
    if(roomFor(key) < want){ q.t = r.time; _cqWarn += dt; if(_cqWarn>5){ _cqWarn=0; showToast('Нет места для: '+r.name); } return; }
    addItem(key, want); q.t = 0; q.qty--; pushRecent(r.id); showToast('Готово: '+r.name+(want>1?' ×'+want:''));
    window.OSIL_AUDIO&&OSIL_AUDIO.play('build'); updateResourceUI();
    if(q.qty<=0) craftQueue.shift();
    renderCraftQueue(); if(document.getElementById('craft-panel').classList.contains('show')) renderCraftUI();
    return;
  }
  if(((q.t*2)|0) !== ((prev*2)|0)) renderCraftQueue();
}

/* ---- Крафт в стиле Rust: категории | сетка со скроллом | описание + требования ---- */
let craftCat = 'all', craftSel = null, craftQty = 1;
function renderCraftUI(){
  const cats = document.getElementById('craft-cats');
  const grid = document.getElementById('craft-grid');
  if(!cats || !grid) return;
  // категории
  cats.innerHTML = '';
  CRAFT_CATS.forEach(c=>{
    const n = CRAFT_RECIPES.filter(r=>!donLocked(r.give&&(r.give.item||r.give.tool)) && (c.id==='all'||r.cat===c.id)).length;
    const el = document.createElement('div');
    el.className = 'cc-item' + (c.id===craftCat?' active':'');
    el.innerHTML = '<span>'+c.name+'</span><b>'+n+'</b>';
    el.addEventListener('click', ()=>{ craftCat=c.id; renderCraftUI(); });
    cats.appendChild(el);
  });
  // сетка
  grid.innerHTML = '';
  const list = CRAFT_RECIPES.filter(r=>!donLocked(r.give&&(r.give.item||r.give.tool)) && (craftCat==='all'||r.cat===craftCat));
  list.forEach(r=>{
    const el = document.createElement('div');
    el.className = 'cg-slot' + (craftSel===r.id?' sel':'') + (canCraft(r,1)?'':' lack');
    el.innerHTML = '<img src="'+r.icon+'" alt="">';
    el.addEventListener('click', ()=>{ craftSel=r.id; craftQty=1; renderCraftUI(); });
    grid.appendChild(el);
  });
  for(let i=list.length;i<20;i++){
    const el=document.createElement('div'); el.className='cg-slot empty'; grid.appendChild(el);
  }
  // правая панель
  const info = document.getElementById('craft-info');
  const reqs = document.getElementById('craft-reqs');
  const r = CRAFT_RECIPES.find(x=>x.id===craftSel);
  const doBtn = document.getElementById('craft-do');
  if(!r){
    info.innerHTML = '<div class="cf-empty">Выберите предмет</div>';
    reqs.innerHTML = '';
    doBtn.disabled = true;
    document.getElementById('cq-val').textContent = '1';
    return;
  }
  info.innerHTML =
    '<div class="cf-head"><img src="'+r.icon+'" alt=""><div class="cf-title">'+r.name+' (x'+((r.give&&r.give.amount)||1)*craftQty+')</div>'+
    '<div class="cf-time">'+r.time+' c</div></div>'+
    '<div class="cf-desc">'+r.desc+'</div>';
  let rows = '<div class="rq-head"><span>КОЛ-ВО</span><span>РЕСУРС</span><span>ВСЕГО</span><span>ЕСТЬ</span></div>';
  Object.keys(r.cost).forEach(k=>{
    const need = r.cost[k], total = need*craftQty, have = RESOURCES[k]||0;
    rows += '<div class="rq-row'+(have<total?' lack':'')+'"><span>'+need+'</span><span>'+(RES_NAMES[k]||k)+'</span><span>'+total+'</span><span>'+have+'</span></div>';
  });
  reqs.innerHTML = rows;
  document.getElementById('cq-val').textContent = craftQty;
  doBtn.disabled = !canCraft(r, craftQty);
}
document.getElementById('cq-minus').addEventListener('click', ()=>{ craftQty=Math.max(1,craftQty-1); renderCraftUI(); });
document.getElementById('cq-plus').addEventListener('click', ()=>{ craftQty=Math.min(99,craftQty+1); renderCraftUI(); });
document.getElementById('craft-do').addEventListener('click', ()=>{ if(craftSel) craftItem(craftSel, craftQty); });

/* =========================================================================
   ПЛАН СТРОИТЕЛЬСТВА
   Выберите «План строительства» в поясе → появляется призрак детали. Кнопка «Удар» ставит,
   кнопка «Деталь» (или клавиша Q) переключает тип, «Поворот» (клавиша R) — поворот.
   Детали сидят на сетке 4 м. Фундамент — только на суше и не на склоне >1.2 м.
   ========================================================================= */
let buildMode = false;
let currentBuildType = 'foundation';
let ghostMesh = null;
let ghostValid = false;
let ghostWhy = '';
let buildRot = 0;                      // 0..3 — поворот на 90°, для рёберных деталей: ось ребра
/* Постройки индексируются по ячейкам сетки. cell:  "cx,cz,lvl"  →  {foundation|floor}
   edge:  "x,z,lvl" (середина ребра ×2, чтобы ключи были целыми) → {wall|doorway|door} */
const cells = new Map(), edges = new Map();
const cellKey = (cx,cz,l)=> Math.round(cx/CELL)+','+Math.round(cz/CELL)+','+l;
const edgeKey = (x,z,l)=> Math.round(x*2/CELL)+','+Math.round(z*2/CELL)+','+l;

function planInHand(){ const sl=hotbarSlots[selectedSlot]; return !!(sl && sl.k==='plan'); }
function heldPlace(){ const sl=hotbarSlots[selectedSlot]; if(sl && donLocked(sl.k)){ if(!heldPlace._t || performance.now()-heldPlace._t>3000){ heldPlace._t=performance.now(); showToast('Донат-предмет не куплен'); } return null; } return (sl && PLACE_HELD[sl.k]) ? sl.k : null; }
function syncBuildMode(){
  const held = heldPlace();
  const on = (planInHand() || !!held) && !panelsOpen();
  if(on){
    const want = held || (BUILD_ORDER.includes(currentBuildType) ? currentBuildType : 'foundation');
    if(want!==currentBuildType){ currentBuildType = want; if(buildMode) updateBuildHud(); }
  }
  if(on===buildMode) return;
  buildMode = on;
  if(!on && ghostMesh){ scene.remove(ghostMesh); ghostMesh=null; }
  document.getElementById('build-hud').classList.toggle('show', on);
  if(on) updateBuildHud();
}
function buildCostOk(type){
  const c = BUILD_TYPES[type].cost;
  return Object.keys(c).every(k => countItem(k) >= c[k]);
}
function updateBuildHud(){
  const box = document.getElementById('build-types'); if(!box) return;
  box.innerHTML = ''; box.style.display = heldPlace() ? 'none' : '';
  BUILD_ORDER.forEach(t=>{
    const bt = BUILD_TYPES[t], ok = buildCostOk(t);
    const el = document.createElement('div');
    el.className = 'bt-item'+(t===currentBuildType?' sel':'')+(ok?'':' lack');
    el.dataset.bt = t;
    el.innerHTML = '<b>'+bt.name+'</b><span>'+Object.keys(bt.cost).map(k=>bt.cost[k]+' '+(RES_NAMES[k]||k)).join(', ')+'</span>';
    box.appendChild(el);
  });
}
function cycleBuildType(dir){
  if(heldPlace()) return;
  const i = BUILD_ORDER.indexOf(currentBuildType);
  currentBuildType = BUILD_ORDER[(i+(dir||1)+BUILD_ORDER.length)%BUILD_ORDER.length];
  updateBuildHud();
}
function rotateBuild(){ buildRot = (buildRot+1)%4; }

/* Точка, куда смотрит игрок: земля по лучу вперёд (без raycast по террейну — берём шагами) */
function aimPoint(){
  if(window.__aimOverride) return window.__aimOverride;
  const dir = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  const ox=camera.position.x, oy=camera.position.y, oz=camera.position.z;
  for(let d=1.5; d<=9; d+=0.5){
    const x=ox+dir.x*d, y=oy+dir.y*d, z=oz+dir.z*d;
    if(y <= heightAt(x,z)+0.05) return {x,z};
  }
  return {x:ox+dir.x*6, z:oz+dir.z*6};
}
const snapCell = v => Math.round(v/CELL)*CELL;
const snapEdge = v => Math.floor(v/CELL)*CELL + CELL/2;   // середина между линиями сетки

/* соседние клетки, к которым примыкает ребро (x,z — середина ребра) */
function edgeCells(x,z,rotY){
  if(rotY!==0) return [[x-CELL/2,z],[x+CELL/2,z]];       // ребро вдоль Z — клетки слева/справа
  return [[x,z-CELL/2],[x,z+CELL/2]];                    // ребро вдоль X — клетки спереди/сзади
}
function levelNearPlayer(cx,cz){
  const t=maxLevelAt(cx,cz); if(t<=0) return t;
  const b=cells.get(cellKey(cx,cz,0)), by=b?b.y:heightAt(cx,cz);
  let l=Math.round((player.pos.y-by-0.3)/FLOOR_H); l=Math.max(0,Math.min(t,l));
  while(l>0 && !cells.has(cellKey(cx,cz,l))) l--;
  return l;
}
function maxLevelAt(cx,cz){           // верхний этаж клетки (−1 — пусто)
  let m=-1; for(let l=0;l<6;l++) if(cells.has(cellKey(cx,cz,l))) m=l; return m;
}

/* запрет стройки рядом с дорогой и деревьями */
function nearRoad(x,z,R){
  for(let r=0;r<=R;r+=3){ const n = r===0?1:12; for(let a=0;a<n;a++){ const an = a*Math.PI*2/n; if(biomeAt(x+Math.cos(an)*r, z+Math.sin(an)*r)===B.ROAD) return true; } }
  return false;
}
function nearTree(x,z,R){
  for(let i=0;i<harvestables.length;i++){ const h = harvestables[i]; if(h.type!=='wood' || !h.mesh || !h.mesh.position) continue;
    const dx = h.mesh.position.x-x, dz = h.mesh.position.z-z; if(dx*dx+dz*dz < R*R) return true; }
  return false;
}
/* вычислить позицию/поворот призрака и валидность */
function computePlacement(){
  const bt = BUILD_TYPES[currentBuildType];
  const ap = aimPoint();
  let x, z, rotY=0;
  if(bt.kind==='cell'){ x = snapCell(ap.x); z = snapCell(ap.z); }
  else if(bt.kind==='obj'){ x = ap.x; z = ap.z; rotY = Math.round(player.yaw/(Math.PI/2))*(Math.PI/2); }
  else{
    const cx = snapCell(ap.x), cz = snapCell(ap.z);
    const dx = ap.x-cx, dz = ap.z-cz;
    if(Math.abs(dx)>Math.abs(dz)){ x = cx + (dx>=0?1:-1)*CELL/2; z = cz; rotY = Math.PI/2; }
    else { x = cx; z = cz + (dz>=0?1:-1)*CELL/2; rotY = 0; }
  }
  let level=0, why='', ok=true, y;
  if(bt.kind==='cell'){
    if(currentBuildType==='foundation'){
      if(cells.has(cellKey(x,z,0))){ ok=false; why='Здесь уже есть фундамент'; }
      // 4 угла клетки: все на суше. Рядом уже есть фундамент — берём его высоту (сплошной пол), иначе — по самому высокому углу
      const hs=[[-2,-2],[2,-2],[-2,2],[2,2]].map(o=>{ const px=x+o[0], pz=z+o[1]; return isWaterAt(px,pz)?null:heightAt(px,pz); });
      const nb=[[CELL,0],[-CELL,0],[0,CELL],[0,-CELL]].map(o=>cells.get(cellKey(x+o[0],z+o[1],0))).filter(Boolean);
      if(hs.some(h=>h===null)){ ok=false; why='Нельзя строить на воде'; y=heightAt(x,z); }
      else if(nb.length){
        y = Math.max(...nb.map(n=>n.y));
        if(Math.max(...hs) > y+0.9){ ok=false; why='Земля выше соседнего фундамента'; }
        else if(Math.min(...hs) < y-1.25){ ok=false; why='Слишком глубокий обрыв'; }
      } else {
        y = Math.max(...hs);
        if(Math.max(...hs)-Math.min(...hs) > 1.2){ ok=false; why='Слишком неровная земля'; }
      }
      level=0;
    } else { // floor — на этаж выше самого верхнего элемента клетки
      const top = maxLevelAt(x,z);
      if(top<0){ ok=false; why='Пол кладётся поверх фундамента'; level=1; }
      else { level=top+1; if(level>4){ ok=false; why='Слишком высоко'; } }
      const base = cells.get(cellKey(x,z,0));
      y = (base?base.y:heightAt(x,z)) + level*FLOOR_H;
      if(cells.has(cellKey(x,z,level))){ ok=false; why='Здесь уже есть пол'; }
      else if(level>=1 && stairsMap.has(cellKey(x,z,level-1))){ ok=false; why='Над лестницей перекрытие не ставится'; }
      else if(ok && level>=1){   // крыша/перекрытие держится только на стенах или на соседнем перекрытии
        const h=CELL/2, ll=level-1;
        const wall=[[x-h,z],[x+h,z],[x,z-h],[x,z+h]].some(e=>edges.has(edgeKey(e[0],e[1],ll)));
        const nb=[[CELL,0],[-CELL,0],[0,CELL],[0,-CELL]].some(o=>cells.has(cellKey(x+o[0],z+o[1],level)));
        if(!wall && !nb){ ok=false; why='Перекрытию нужны стены под ним'; }
      }
    }
  } else if(bt.kind==='stair'){
    const cx=snapCell(ap.x), cz=snapCell(ap.z), top=levelNearPlayer(cx,cz);
    x=cx; z=cz; rotY=Math.round(player.yaw/(Math.PI/2))*(Math.PI/2);
    if(top<0){ ok=false; why='Лестница ставится на фундамент или пол'; y=heightAt(x,z); }
    else {
      level=top; const bs=(cells.get(cellKey(cx,cz,0))||{}).y;
      y=(bs!==undefined?bs:heightAt(x,z))+top*FLOOR_H+(top===0?0.3:0.15);
      if(stairsMap.has(cellKey(cx,cz,top))){ ok=false; why='Здесь уже есть лестница'; }
      else if(cells.has(cellKey(cx,cz,top+1))){ ok=false; why='Сверху уже есть перекрытие'; }
      else if(top>=4){ ok=false; why='Слишком высоко'; }
      parts.forEach(p=>{ if((p.type==='box'||p.type==='cupboard'||p.type==='quarry'||p.type==='furnace') && p.level===level && Math.abs(p.x-x)<2 && Math.abs(p.z-z)<2){ ok=false; why='Место занято'; } });
    }
  } else if(currentBuildType==='quarry'){          // карьер: только на земле, не на фундаменте
    level = 0;
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const pts = [[0,0],[-2.3,-1.6],[2.3,-1.6],[-2.3,1.6],[2.3,1.6],[0,-1.6],[0,1.6],[-2.3,0],[2.3,0]].map(o=>[x+o[0]*cs+o[1]*sn, z-o[0]*sn+o[1]*cs]);
    let hmin=1e9, hmax=-1e9, wet=false, onCell=false;
    pts.forEach(q=>{ if(isWaterAt(q[0],q[1])) wet=true; const h=heightAt(q[0],q[1]); hmin=Math.min(hmin,h); hmax=Math.max(hmax,h); if(cells.has(cellKey(snapCell(q[0]),snapCell(q[1]),0))) onCell=true; });
    y = (hmin+hmax)/2;
    if(wet){ ok=false; why='Нельзя ставить на воду'; }
    else if(onCell){ ok=false; why='Карьер ставится на землю, а не на постройку'; }
    else if(hmax-hmin>1.1){ ok=false; why='Слишком неровная земля'; }
    if(ok){ for(const c of colliders){ const b=c.box; if(b.max.y<y-0.3 || b.min.y>y+4) continue; if(x-2.9<b.max.x && x+2.9>b.min.x && z-2.9<b.max.z && z+2.9>b.min.z){ ok=false; why='Рядом что-то мешает'; break; } } }
    if(ok) parts.forEach(p=>{ if((p.type==='box'||p.type==='cupboard'||p.type==='quarry'||p.type==='furnace') && Math.hypot(p.x-x,p.z-z)<(p.type==='quarry'?4.8:3.4)){ ok=false; why='Место занято'; } });
    if(ok && Math.hypot(player.pos.x-x,player.pos.z-z)<2.8 && Math.abs(player.pos.y-y)<2.5){ ok=false; why='Вы стоите на этом месте'; }
  } else if(bt.kind==='obj'){
    const cx=snapCell(x), cz=snapCell(z), top=levelNearPlayer(cx,cz);
    if(top<0){ ok=false; why='Ставится на фундамент или пол'; y=heightAt(x,z); }
    else {
      level=top; const bs=(cells.get(cellKey(cx,cz,0))||{}).y;
      y = (bs!==undefined?bs:heightAt(x,z)) + top*FLOOR_H + (top===0?0.3:0.15);
      if(Math.abs(x-cx)>1.6 || Math.abs(z-cz)>1.6){ ok=false; why='Слишком близко к краю'; }
      parts.forEach(p=>{ if((p.type==='box'||p.type==='cupboard'||p.type==='quarry'||p.type==='furnace') && p.level===level && (p.type==='quarry' ? (Math.abs(p.x-x)<3.4 && Math.abs(p.z-z)<3.4) : Math.hypot(p.x-x,p.z-z)<0.9)){ ok=false; why='Место занято'; } });
    }
  } else {
    // рёберные: этаж = верхний уровень примыкающих клеток
    const adj = edgeCells(x,z,rotY);
    let top=-1; adj.forEach(c=>{ top=Math.max(top, isDoorT(currentBuildType) ? levelNearPlayer(c[0],c[1]) : maxLevelAt(c[0],c[1])); });
    if(top<0){ ok=false; why='Стена ставится на фундамент'; level=0; }
    else {
      level=top;
      if(!isDoorT(currentBuildType)){          // под крышей: берём ближайший к игроку свободный этаж, а не только верхний
        let bestL=-1, bd2=1e9;
        for(let l=0;l<=top;l++){
          if(!adj.some(c=>cells.has(cellKey(c[0],c[1],l))) || edges.has(edgeKey(x,z,l))) continue;
          const b0=adj.map(c=>cells.get(cellKey(c[0],c[1],0))).find(Boolean), yy=(b0?b0.y:heightAt(x,z))+l*FLOOR_H, dd=Math.abs(yy-player.pos.y);
          if(dd<bd2){ bd2=dd; bestL=l; }
        }
        if(bestL>=0) level=bestL;
      }
    }
    const base = adj.map(c=>cells.get(cellKey(c[0],c[1],0))).find(Boolean);
    y = (base?base.y:heightAt(x,z)) + level*FLOOR_H;
    const ex = edges.get(edgeKey(x,z,level));
    if(isDoorT(currentBuildType)){
      if(!ex || ex.type!=='doorway'){ ok=false; why='Дверь ставится в проём'; }
      else if(ex.door){ ok=false; why='В проёме уже есть дверь'; }
    } else if(ex){ ok=false; why='Здесь уже есть стена'; }
  }
  if(ok && (currentBuildType==='foundation' || currentBuildType==='quarry')){
    const q = currentBuildType==='quarry';
    if(nearRoad(x,z,q?11:10)){ ok=false; why='Слишком близко к дороге — здесь строить нельзя'; }
    else if(nearTree(x,z,q?5.2:4.6)){ ok=false; why='Рядом деревья — расчистите место'; }
  }
  if(ok && currentBuildType!=='quarry'){        // зона карьера: бур, дизель, конвейер и кучи руды
    const R = bt.kind==='cell' ? 5.6 : bt.kind==='obj' ? 4.4 : 4.0;
    for(const p of parts.values()){ if(p.type==='quarry' && Math.hypot(p.x-x,p.z-z) < R){ ok=false; why='Слишком близко к карьеру'; break; } }
  }
  if(ok && currentBuildType==='quarry'){
    for(const p of parts.values()){ if(p.type!=='quarry' && Math.hypot(p.x-x,p.z-z) < (p.type==='foundation'||p.type==='floor' ? 5.6 : 4.4)){ ok=false; why='Рядом постройка'; break; } }
  }
  if(ok && !buildCostOk(currentBuildType)){ ok=false; why='Не хватает: '+Object.keys(bt.cost).map(k=>bt.cost[k]+' '+(RES_NAMES[k]||k)).join(', '); }
  // нельзя ставить в игрока
  if(ok && bt.kind==='cell' && Math.hypot(player.pos.x-x,player.pos.z-z)<1.6 && Math.abs(player.pos.y-y)<2){ ok=false; why='Вы стоите на этом месте'; }
  return {x,z,rotY,y:y+bt.snapY,base:y-level*FLOOR_H,level,bt,ok,why};
}

function updateGhost(){
  syncBuildMode();
  if(!buildMode) return;
  if(!ghostMesh || ghostMesh.userData.type !== currentBuildType){
    if(ghostMesh) scene.remove(ghostMesh);
    ghostMesh = BUILD_TYPES[currentBuildType].make();
    ghostMesh.userData.type = currentBuildType;
    ghostMesh.traverse(o=>{ if(o.isMesh){ o.material = o.material.clone(); o.material.transparent = true; }});
    scene.add(ghostMesh);
  }
  const p = computePlacement();
  ghostMesh.position.set(p.x,p.y,p.z);
  ghostMesh.rotation.y = p.rotY;
  ghostValid = p.ok; ghostWhy = p.why; ghostMesh.userData.pl = p;
  const color = p.ok ? 0x66ff66 : 0xff5555;
  ghostMesh.traverse(o=>{ if(o.isMesh){ o.material.color.set(color); o.material.opacity=0.5; }});
  const hint = document.getElementById('build-hint');
  if(hint) hint.textContent = p.ok ? 'Готово к постройке' : p.why;
}

function partId(type,x,z,level){
  if(type==='foundation') return 'F:'+cellKey(x,z,level);
  if(type==='floor') return 'L:'+cellKey(x,z,level);
  if(type==='wall' || type==='shootwall') return 'W:'+edgeKey(x,z,level);
  if(type==='parapet') return 'P:'+edgeKey(x,z,level);
  if(type==='stairs') return 'S:'+cellKey(x,z,level);
  if(type==='doorway') return 'D:'+edgeKey(x,z,level);
  if(isDoorT(type)) return 'O:'+edgeKey(x,z,level);
  return (type==='box'?'B:':type==='quarry'?'Q:':type==='furnace'?'F:':'C:')+Math.round(x*10)+','+Math.round(z*10)+','+level;
}
function spawnBuilt(type, x,y,z,rotY,level,base,tm,up){
  const bt = BUILD_TYPES[type]; if(!bt) return null;
  const pid = partId(type,x,z,level);
  if(parts.has(pid)) return parts.get(pid).obj;              // повторный снимок при переподключении
  if(type==='foundation' && base!==undefined) y = base + bt.snapY;    // старые сохранения: сдвигаем под новую глубину
  const real = bt.make();
  real.position.set(x,y,z);
  real.rotation.y = rotY;
  real.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  scene.add(real);
  const rec = {type:type, obj:real, y:base};
  if(bt.kind==='cell'){ cells.set(cellKey(x,z,level), rec); }
  else if(bt.kind==='stair'){ stairsMap.set(cellKey(x,z,level), {x,z,rotY,y0:y,level}); }
  else if(bt.kind==='obj'){ real.updateMatrixWorld(true); addCollider(real, real); }
  else if(isDoorT(type)){
    const ex = edges.get(edgeKey(x,z,level)); if(ex) ex.door = real;
    real.updateMatrixWorld(true); registerDoor(real, edgeKey(x,z,level), x, z, level);
  } else {
    edges.set(edgeKey(x,z,level), rec);
    if(type==='wall') addCollider(real, real);
    else if(type==='shootwall' || type==='parapet'){ const h=type==='parapet'?1.1:3.5, cm=new THREE.Mesh(new THREE.BoxGeometry(4,h,0.25)); cm.position.set(x,type==='parapet'?y-1.75+h/2:y,z); cm.rotation.y=rotY; addCollider(cm, real); }
    else { real.updateMatrixWorld(true); addCollider(real.children[1], real); addCollider(real.children[2], real); }
  }
  buildings.push(real);
  const p = {id:pid, type, obj:real, hp:PART_MAX[type], max:PART_MAX[type], x, z, y, level, hitT:0, tm:(tm===undefined?Date.now():tm), up:0};
  if(pendingHp.has(pid)){ p.hp = pendingHp.get(pid); pendingHp.delete(pid); }
  parts.set(pid, p); _stabVer++;
  if(type==='quarry') quarObjs.add(pid);
  if(up){ for(let i=1;i<=up;i++) applyUpgrade(pid, true, i); }
  real.traverse(o=>{ if(o.isMesh){ o.userData.partId = pid; partMeshes.push(o); }});
  return real;
}
function confirmBuild(){
  if(!ghostMesh) return false;
  const p = ghostMesh.userData.pl;
  if(!p || !p.ok){ showToast(ghostWhy||'Нельзя построить'); OSIL_AUDIO.play('rust-door-denied'); return false; }
  const cost = p.bt.cost;
  Object.keys(cost).forEach(k => removeItem(k, cost[k]));
  spawnBuilt(currentBuildType, p.x,p.y,p.z,p.rotY,p.level,p.base);
  if(window.OSIL_NET) OSIL_NET.onBuild({t:'bd',k:currentBuildType,x:p.x,y:p.y,z:p.z,r:p.rotY,l:p.level,b:p.base});
  OSIL_AUDIO.play('build');
  updateResourceUI(); updateBuildHud();
  showToast(p.bt.name+' построен'+(currentBuildType==='cupboard'?'. Постройки в радиусе '+CUP_R+' м не гниют':''));
  return true;
}


/* ---------------- Прицельный луч по постройкам ---------------- */
const _bRay = new THREE.Raycaster();
function aimRay(range){
  if(CFG.camMode|0){
    const cp=Math.cos(player.pitch);
    _bRay.set(new THREE.Vector3(player.pos.x,player.pos.y+player.height,player.pos.z), new THREE.Vector3(-Math.sin(player.yaw)*cp, Math.sin(player.pitch), -Math.cos(player.yaw)*cp));
  } else _bRay.setFromCamera({x:0,y:0}, camera);
  _bRay.far = range;
}

/* ---------------- Здоровье деталей, урон, гниение ---------------- */
function setPartHp(id, h){
  const p = parts.get(id);
  if(!p){ pendingHp.set(id, h); return; }
  p.hp = h; p.hitT = performance.now();
  if(h <= 0) removePart(id, true);
}

/* ---------------- Стабильность построек ----------------
   Корень — фундамент. Стена/проём/бойница/бруствер держатся на опорной клетке своего этажа,
   пол (этаж ≥1) — на опорной стене этажом ниже или на соседнем опорном перекрытии,
   лестница и предметы — на опорной клетке под ними. Нет опоры → деталь обрушивается. */
let _stabVer = 0, _stabCache = null, _stabCacheVer = -1, _stabBusy = false;
const _EDGE_T = {wall:1, doorway:1, shootwall:1, parapet:1};
function computeStability(){
  if(_stabCache && _stabCacheVer===_stabVer) return _stabCache;
  const res = new Map();                       // partId -> {d:глубина}
  const cellSup = new Map(), edgeSup = new Map();   // key -> глубина
  const eList = [], cList = [];
  parts.forEach(p=>{
    if(p.type==='foundation'){ cellSup.set(cellKey(p.x,p.z,p.level), 0); res.set(p.id,0); }
    else if(p.type==='floor') cList.push(p);
    else if(_EDGE_T[p.type]) eList.push(p);
  });
  let ch = true, guard = 0;
  while(ch && guard++ < 64){
    ch = false;
    eList.forEach(p=>{
      const k = edgeKey(p.x,p.z,p.level); if(edgeSup.has(k)) return;
      const rot = p.obj ? p.obj.rotation.y : 0;
      let best = Infinity;
      edgeCells(p.x,p.z,rot===0?0:1).forEach(c=>{ const d = cellSup.get(cellKey(c[0],c[1],p.level)); if(d!==undefined && d<best) best = d; });
      if(best<Infinity){ edgeSup.set(k, best+1); res.set(p.id, best+1); ch = true; }
    });
    cList.forEach(p=>{
      const k = cellKey(p.x,p.z,p.level); if(cellSup.has(k)) return;
      const h = CELL/2, ll = p.level-1; let best = Infinity;
      [[p.x-h,p.z],[p.x+h,p.z],[p.x,p.z-h],[p.x,p.z+h]].forEach(e=>{ const d = edgeSup.get(edgeKey(e[0],e[1],ll)); if(d!==undefined && d<best) best = d; });
      [[CELL,0],[-CELL,0],[0,CELL],[0,-CELL]].forEach(o=>{ const d = cellSup.get(cellKey(p.x+o[0],p.z+o[1],p.level)); if(d!==undefined && d+1<best) best = d+1; });
      if(best<Infinity){ cellSup.set(k, best+1); res.set(p.id, best+1); ch = true; }
    });
  }
  parts.forEach(p=>{
    if(res.has(p.id) || p.type==='door' || p.type==='mdoor'){ return; }
    if(p.type==='stairs' || p.type==='box' || p.type==='cupboard' || p.type==='furnace'){
      const d = cellSup.get(cellKey(snapCell(p.x),snapCell(p.z),p.level)); if(d!==undefined) res.set(p.id, d);
      else if(p.level===0 && p.type!=='stairs' && !cells.has(cellKey(snapCell(p.x),snapCell(p.z),0))) res.set(p.id, 0);   // на земле
    } else if(p.type==='quarry') res.set(p.id, 0);
  });
  parts.forEach(p=>{ if((p.type==='door'||p.type==='mdoor')){ const d = edgeSup.get(edgeKey(p.x,p.z,p.level)); if(d!==undefined) res.set(p.id, d); } });
  _stabCache = res; _stabCacheVer = _stabVer; return res;
}
function stabPct(p){ const d = computeStability().get(p.id); return d===undefined ? 0 : Math.max(10, 100 - 8*d); }
function collapseUnsupported(){
  if(_stabBusy || (window.OSIL_NET && OSIL_NET.on)) return;   // в мультиплеере обвал считает сервер
  _stabBusy = true;
  try{
    for(let it=0; it<12; it++){
      _stabVer++; const sup = computeStability(), dead = [];
      parts.forEach(p=>{ if(!sup.has(p.id)) dead.push(p.id); });
      if(!dead.length) break;
      dead.forEach(id=>{ if(parts.has(id)) removePart(id, true); });
    }
  } finally { _stabBusy = false; }
}
function removePart(id, fx){
  const p = parts.get(id); if(!p) return;
  if(p.type==='doorway') removePart('O:'+edgeKey(p.x,p.z,p.level), fx);
  parts.delete(id); _stabVer++;
  if(fx) spawnDebris(new THREE.Vector3(p.obj.position.x, p.obj.position.y, p.obj.position.z), 'wood', 16, 0.7);
  removeCollidersOf(p.obj);
  scene.remove(p.obj);
  p.obj.traverse(o=>{ if(o.isMesh){ const i=partMeshes.indexOf(o); if(i>=0) partMeshes.splice(i,1); } });
  const bi = buildings.indexOf(p.obj); if(bi>=0) buildings.splice(bi,1);
  const t = p.type;
  if(t==='foundation' || t==='floor'){
    cells.delete(cellKey(p.x,p.z,p.level));
    const dep = []; parts.forEach(q=>{ if((q.type==='box'||q.type==='cupboard'||q.type==='furnace') && q.level===p.level && Math.abs(q.x-p.x)<CELL*0.5+0.01 && Math.abs(q.z-p.z)<CELL*0.5+0.01) dep.push(q.id); });
    dep.forEach(id=>{ if(parts.has(id)) removePart(id, true); });     // шкаф/ящик/печка не висят в воздухе: ломаются, лут падает мешком
  }
  else if(t==='wall' || t==='doorway' || t==='shootwall' || t==='parapet') edges.delete(edgeKey(p.x,p.z,p.level));
  else if(t==='stairs') stairsMap.delete(cellKey(p.x,p.z,p.level));
  else if(isDoorT(t)){
    const k = edgeKey(p.x,p.z,p.level); doors.delete(k); authKeys.delete(k);
    const ex = edges.get(k); if(ex) ex.door = null;
    if(kp && kp.d.grp===p.obj) endKeypad();
  }
  else if(t==='box' || t==='cupboard'){ spillStorage(id,p); storData.delete(id); if(storOpenId===id) closeStorage(); }
  else if(t==='quarry'){ quarState.delete(id); if(quarOpenId===id) closeQuarry(); }
  else if(t==='furnace'){ furnState.delete(id); if(furOpenId===id) closeFurnace(); }
  if(!_stabBusy && t!=='door' && t!=='mdoor' && t!=='box' && t!=='cupboard' && t!=='quarry' && t!=='furnace') collapseUnsupported();
}
function damagePart(id, dmg){
  const p = parts.get(id); if(!p) return;
  p.hp = Math.max(0, p.hp - dmg); p.hitT = performance.now();
  if(p.hp <= 0) removePart(id, true);
}
/* удар/выстрел по постройке. В мультиплеере урон считает сервер, в одиночной игре — тут. */
function hitBuildingRay(w, range){
  if(copter.exists && hitCopterRay(w, range)) return true;
  if(!partMeshes.length || !WEAPON_DMG[w]) return false;
  aimRay(range);
  const hit = _bRay.intersectObjects(partMeshes, false)[0]; if(!hit) return false;
  const id = hit.object.userData.partId, p = parts.get(id); if(!p) return false;
  lastHitPoint.copy(hit.point); hitFx(hit.point, 'wood');
  if(range < 10) OSIL_AUDIO.play('chop');
  p.hitT = performance.now();
  if(window.OSIL_NET && OSIL_NET.on) OSIL_NET.onBuild({t:'bh', id, w});
  else damagePart(id, WEAPON_DMG[w]*BUILD_DMG_K);
  return true;
}
const phEl = document.createElement('div'); phEl.id = 'part-hp';
phEl.style.cssText = 'position:fixed;left:50%;top:60%;transform:translateX(-50%);z-index:15;display:none;min-width:150px;padding:6px 12px;background:rgba(20,20,18,.78);color:#fff;font:600 12px sans-serif;text-align:center;pointer-events:none';
phEl.innerHTML = '<div id="ph-t"></div><div style="height:6px;background:#333;margin-top:4px"><div id="ph-b" style="height:100%;width:100%;background:#8bc34a"></div></div>';
document.body.appendChild(phEl);
const phT = phEl.querySelector('#ph-t'), phB = phEl.querySelector('#ph-b');
let _phCd = 0, _phShow = false;
/* здоровье детали видно, когда на неё смотрят и осталось меньше 97% */
function updatePartHud(dt){
  _phCd -= dt; if(_phCd > 0) return; _phCd = 0.1;
  let p = null, cop = null;
  if(!panelsOpen() && !buildMode){
    aimRay(8);
    let hd = Infinity;
    if(partMeshes.length){
      const hit = _bRay.intersectObjects(partMeshes, false)[0];
      if(hit){ p = parts.get(hit.object.userData.partId); hd = hit.distance; }
    }
    if(copter.exists && !copter.pilot){   // коптер — как деталь постройки
      _cRay.ray.copy(_bRay.ray); _cRay.far = 8;
      const ch = _cRay.intersectObject(copter.grp, true)[0];
      if(ch && ch.distance < hd){ cop = copter; p = null; }
    }
  }
  const tgt = cop || p;
  const show = !!tgt && tgt.hp < tgt.max*0.97;
  if(show){
    const f = Math.max(0, tgt.hp/tgt.max);
    phT.textContent = (cop ? 'Миникоптер' : PART_NAME[p.type])+'  '+Math.ceil(tgt.hp)+' / '+tgt.max+(cop ? '' : '  ·  Стабильность '+stabPct(p)+'%');
    phB.style.width = (f*100)+'%'; phB.style.background = f>0.6 ? '#8bc34a' : f>0.3 ? '#ffb300' : '#e53935';
  }
  if(show !== _phShow){ _phShow = show; phEl.style.display = show ? 'block' : 'none'; }
}
/* гниение (одиночная игра; в мультиплеере считает сервер).
   Шкаф раз в игровые сутки (24 мин реального времени) забирает из своего хранилища 10 дерева за каждую деталь в радиусе
   (10 камня для каменной, 10 металла для железной). Если ресурса не хватает — деталь гниёт: теряет max/180 HP в минуту. */
const DAY_MS = 24*60*1000, UPKEEP_PER_PART = 10, UP_RES = ['wood','stone','metal'];
let _decT = 0, _upkT = Date.now();
function cupboardPay(cups, p){
  const res = UP_RES[p.up|0] || 'wood';
  for(const c of cups){
    if(Math.hypot(c.x-p.x, c.z-p.z) > CUP_R) continue;
    const arr = storSlots(c.id); let need = UPKEEP_PER_PART;
    for(let i=0;i<arr.length&&need>0;i++){ const sl=arr[i]; if(sl && sl.k===res){ const t=Math.min(sl.n,need); sl.n-=t; need-=t; if(sl.n<=0) arr[i]=null; } }
    if(need<=0) return true;
  }
  return false;
}
function decayTick(dt){
  if(window.OSIL_NET && OSIL_NET.on) return;
  _decT += dt; if(_decT < 60) return; _decT = 0;
  const cups = []; parts.forEach(p=>{ if(p.type==='cupboard') cups.push(p); });
  const dayPassed = Date.now()-_upkT >= DAY_MS; if(dayPassed) _upkT = Date.now();
  const dead = [];
  parts.forEach(p=>{
    if(p.type==='cupboard' || p.type==='box') { if(cups.some(c=>Math.hypot(c.x-p.x,c.z-p.z)<=CUP_R)) return; }
    const near = cups.some(c=>Math.hypot(c.x-p.x, c.z-p.z) <= CUP_R);
    if(near){
      if(dayPassed){ p.paidUntil = cupboardPay(cups,p) ? Date.now()+DAY_MS : 0; }
      if(p.paidUntil === undefined) p.paidUntil = Date.now()+DAY_MS;   // первые сутки после постройки/шкафа — бесплатно
      if(Date.now() < p.paidUntil) return;
    }
    p.hp -= p.max/DECAY_MIN; if(p.hp <= 0) dead.push(p.id);
  });
  dead.forEach(id=>removePart(id, true));
}

/* ---------------- Двери: открыть/закрыть, кодовый замок с клавиатурой прямо на двери ---------------- */
const doors = new Map();
const authKeys = new Set();          // двери, замок которых игрок уже открыл (в мультиплеере список хранит сервер)
const isAuthed = d => authKeys.has(d.key);
function registerDoor(grp, key, x, z, level){
  const d = {grp, key, x, z, level, open:false, locked:false, code:'', tgt:0};
  doors.set(key, d); grp.userData.hit.userData.door = d; setDoorSolid(d, true); refreshDoorPad(d); return d;
}
function refreshDoorPad(d){
  const pad = d.grp.userData.pad, active = !!(kp && kp.d===d);
  pad.meshes.forEach(m=>{ m.visible = d.locked || active; });
  d.grp.userData.lock.visible = d.locked;
  if(!active) drawPad(pad, d.locked ? 'ЗАПЕРТО' : '', d.locked ? 'E — ввести код' : '', '#ff8a80');
}
function setDoorSolid(d, solid){
  removeCollidersOf(d.grp);
  if(!solid) return;
  const pv = d.grp.userData.pivot, r = pv.rotation.y; pv.rotation.y = 0; d.grp.updateMatrixWorld(true);
  addCollider(d.grp.userData.door, d.grp); pv.rotation.y = r; d.grp.updateMatrixWorld(true);
}
function setDoor(d, open, send){
  if(d.open === open) return;
  if(!open && Math.hypot(player.pos.x-d.grp.position.x, player.pos.z-d.grp.position.z) < 1.0 && Math.abs(player.pos.y-d.grp.position.y) < 2.5){ showToast('Что-то мешает закрыть дверь'); return; }
  d.open = open; d.tgt = open ? -1.5 : 0; setDoorSolid(d, !open);
  OSIL_AUDIO.play(open ? 'open' : 'close');
  if(send && window.OSIL_NET) OSIL_NET.onBuild({t:'dr', x:d.x, z:d.z, l:d.level, o:open?1:0});
}
function updateDoors(dt){
  doors.forEach(d=>{
    const pv = d.grp.userData.pivot, e = d.tgt - pv.rotation.y;
    if(Math.abs(e) > 0.002) pv.rotation.y += e*Math.min(1, dt*8);
  });
}
/* --- клавиатура замка --- */
function kpDraw(msg, col){
  if(!kp) return;
  drawPad(kp.d.grp.userData.pad, kp.buf.padEnd(4,'_').replace(/\d/g,'*'), msg || (kp.mode==='set' ? 'НОВЫЙ КОД' : 'ВВЕДИТЕ КОД'), col);
}
function startKeypad(d, mode){ if(kp) endKeypad(); kp = {d, mode, buf:''}; refreshDoorPad(d); kpDraw(); showToast('Наведите прицел на клавишу и жмите «Удар»'); }
function endKeypad(){ if(!kp) return; const d = kp.d; kp = null; refreshDoorPad(d); }
function kpFail(){ OSIL_AUDIO.play('rust-door-denied'); if(kp){ kp.buf=''; kp.wait=false; kpDraw('НЕВЕРНО', '#ff5555'); } }
function kpOk(d){ authKeys.add(d.key); if(kp && kp.d===d) endKeypad(); setDoor(d, true, true); }
function kpPress(){
  if(!kp || kp.wait) return;
  aimRay(4);
  const hit = _bRay.intersectObjects(kp.d.grp.userData.pad.meshes, false)[0]; if(!hit || !hit.uv) return;
  const px = hit.uv.x*PAD_W, py = (1-hit.uv.y)*PAD_H; if(py < 80) return;
  const cw = (PAD_W-16)/3, ch = (PAD_H-88)/4, c = Math.floor((px-8)/cw), r = Math.floor((py-80)/ch);
  if(c<0 || c>2 || r<0 || r>3) return;
  const key = PAD_KEYS[r*3+c];
  if(key==='✖'){ endKeypad(); return; }
  if(key==='⌫'){ kp.buf = kp.buf.slice(0,-1); kpDraw(); return; }
  if(kp.buf.length >= 4) return;
  kp.buf += key; OSIL_AUDIO.play('open', {vol:0.25, rate:2}); kpDraw();
  if(kp.buf.length === 4) kpSubmit();
}
function kpSubmit(){
  const {d, mode, buf} = kp, net = !!(window.OSIL_NET && OSIL_NET.on);
  if(mode==='set'){
    if(net) OSIL_NET.onBuild({t:'dl', x:d.x, z:d.z, l:d.level, c:buf});
    d.locked = true; d.code = buf; authKeys.add(d.key); showToast('Замок установлен');
    endKeypad(); if(d.open) setDoor(d, false, true);
  } else if(net){
    OSIL_NET.onBuild({t:'du', x:d.x, z:d.z, l:d.level, c:buf}); kp.wait = true; kpDraw('ПРОВЕРКА…', '#ffd54f');
  } else if(buf === d.code) kpOk(d); else kpFail();
}
function doorToggle(d){
  if(d.locked && !isAuthed(d)){ startKeypad(d, 'enter'); return; }
  setDoor(d, !d.open, true);
}
function doorLock(d){
  if(d.locked){
    if(!isAuthed(d)){ showToast('Нужен код замка'); OSIL_AUDIO.play('rust-door-denied'); return; }
    d.locked = false; d.code = ''; authKeys.delete(d.key); showToast('Замок снят');
    if(window.OSIL_NET) OSIL_NET.onBuild({t:'dl', x:d.x, z:d.z, l:d.level, c:''});
    refreshDoorPad(d);
  } else startKeypad(d, 'set');
}
function applyDoorNet(m){
  const d = doors.get(edgeKey(m.x, m.z, m.l)); if(!d) return;
  if(m.t==='dl'){ d.locked = !!m.c; authKeys.delete(d.key); refreshDoorPad(d); }
  else if(m.t==='dok'){ authKeys.add(d.key); if(kp && kp.d===d && kp.mode==='enter') kpOk(d); }
  else if(m.t==='dno'){ if(kp && kp.d===d) kpFail(); else showToast('Нет доступа'); }
  else { const o = !!m.o; if(d.open !== o){ d.open = o; d.tgt = o ? -1.5 : 0; setDoorSolid(d, !o); } }
}


/* ---------------- Киянка: снос / подбор (10 мин после постройки) и улучшение в камень ---------------- */
const DEMOLISH_MS = 600000;
const UP_COST = {foundation:30, floor:15, wall:20, doorway:15, window:20, shootwall:20, roofhatch:15, stairs:20, ceil:15};      // камень (для железа ×1, металл)
const UP_MET = {foundation:50, floor:25, wall:35, doorway:25, window:35, shootwall:35, roofhatch:25, stairs:35, ceil:25};          // железо
function applyUpgrade(id, init, lvl){
  const p = parts.get(id); if(!p) return;
  const target = lvl || ((p.up|0)+1); if(target<=(p.up|0) || target>2) return;
  const base = PART_MAX[p.type];
  const newMax = base*(target===1?2:4);
  if(!init) p.hp += newMax-p.max;
  p.max = newMax; p.up = target;
  const tex = target===1 ? loadTex(TEXTURES.tex_stone,1,1) : loadTex(TEXTURES.tex_metal,1,1);
  p.obj.traverse(o=>{ if(o.isMesh && o.material && !o.userData.noUp && !(o.material.metalness>0.5 && target===1)){
    o.material = o.material.clone(); o.material.map = tex; o.material.color.set(target===2?0xb9bcc4:0xffffff);
    if(target===2){ o.material.metalness=0.55; o.material.roughness=0.5; } o.material.needsUpdate = true; } });
}
function demolishPart(p){
  if(!p.tm || Date.now()-p.tm > DEMOLISH_MS){ showToast('С постройки прошло больше 10 минут'); return; }
  if(window.OSIL_NET && OSIL_NET.on){ OSIL_NET.onBuild({t:'bz', id:p.id}); OSIL_AUDIO.play('chop'); return; }
  const c = BUILD_TYPES[p.type].cost; Object.keys(c).forEach(k=>giveItem(k, c[k]));
  removePart(p.id, true); OSIL_AUDIO.play('chop'); updateResourceUI();
}
function repairCost(p){ return Math.max(1, Math.ceil((1-p.hp/p.max)*20)); }
function repairPart(p){
  if(!p || p.hp >= p.max*0.99) return;
  const res = ['wood','stone','metal'][p.up|0] || 'wood', need = repairCost(p);
  if(countItem(res) < need){ showToast('Не хватает: '+need+' '+({wood:'дерева',stone:'камня',metal:'железа'})[res]); return; }
  removeItem(res, need);
  if(window.OSIL_NET && OSIL_NET.on) OSIL_NET.onBuild({t:'br', id:p.id});
  p.hp = p.max; OSIL_AUDIO.play('build'); updateResourceUI(); showToast(PART_NAME[p.type]+' починено');
}
function upgradePart(p){
  const lv = p.up|0; if(lv>=2) return;
  const res = lv===0 ? 'stone' : 'metal', need = (lv===0?UP_COST:UP_MET)[p.type]; if(!need) return;
  if(countItem(res) < need){ showToast('Не хватает: '+need+(lv===0?' камня':' железа')); return; }
  removeItem(res, need);
  if(window.OSIL_NET && OSIL_NET.on) OSIL_NET.onBuild({t:'bu', id:p.id});
  applyUpgrade(p.id); OSIL_AUDIO.play('build'); updateResourceUI();
  showToast(PART_NAME[p.type]+' улучшен: '+(lv===0?'камень':'железо'));
}
const hmEl = document.createElement('div'); hmEl.id = 'hm-prompt';
hmEl.style.cssText = 'position:fixed;left:50%;bottom:calc(205px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:16;display:none;gap:8px;flex-wrap:wrap;justify-content:center;max-width:94vw';
hmEl.innerHTML = '<button id="hm-dem"></button><button id="hm-up"></button><button id="hm-rep"></button>';
document.body.appendChild(hmEl);
hmEl.querySelectorAll('button').forEach(b=>{ b.style.cssText = 'padding:10px 16px;border:none;font:600 12px/1 sans-serif;letter-spacing:.8px;color:#fff;background:rgba(34,33,31,.85)'; });
let hmTarget = null, _hmCd = 0;
function updateHammerPrompt(dt){
  _hmCd -= dt; if(_hmCd > 0) return; _hmCd = 0.15;
  let p = null;
  if(toolKind==='hammer' && partMeshes.length && !panelsOpen() && !kp && !buildMode){
    aimRay(6); const hit = _bRay.intersectObjects(partMeshes, false)[0];
    if(hit) p = parts.get(hit.object.userData.partId);
  }
  hmTarget = p; hmEl.style.display = p ? 'flex' : 'none';
  if(!p) return;
  const left = p.tm ? Math.max(0, DEMOLISH_MS-(Date.now()-p.tm)) : 0;
  const pick = (p.type==='copterp'||p.type==='door'||p.type==='mdoor'||p.type==='box'||p.type==='cupboard'||p.type==='quarry'||p.type==='furnace');
  const d = document.getElementById('hm-dem'), u = document.getElementById('hm-up');
  d.style.display = left>0 ? '' : 'none';
  d.textContent = (pick?'ПОДОБРАТЬ':'СНЕСТИ')+' ('+Math.floor(left/60000)+':'+String(Math.floor(left/1000)%60).padStart(2,'0')+')';
  const canUp = UP_COST[p.type] && (p.up|0)<2;
  u.style.display = canUp ? '' : 'none';
  if(canUp) u.textContent = (p.up|0)===0 ? 'В КАМЕНЬ ('+UP_COST[p.type]+' камня)' : 'В ЖЕЛЕЗО ('+UP_MET[p.type]+' железа)';
  const rp = document.getElementById('hm-rep'), hurt = p.type!=='copterp' && p.hp < p.max*0.99;
  rp.style.display = hurt ? '' : 'none';
  if(hurt) rp.textContent = 'ЧИНИТЬ ('+repairCost(p)+' '+['дерева','камня','железа'][p.up|0]+')';
  if(left<=0 && !canUp && !hurt) hmEl.style.display = 'none';
}
document.getElementById('hm-dem').addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); if(hmTarget) demolishPart(hmTarget); });
document.getElementById('hm-rep').addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); if(hmTarget) repairPart(hmTarget); });
document.getElementById('hm-up').addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); if(hmTarget) upgradePart(hmTarget); });
window.addEventListener('keydown', e=>{
  if(!hmTarget || toolKind!=='hammer') return;
  if(e.code==='KeyG') demolishPart(hmTarget); else if(e.code==='KeyU') upgradePart(hmTarget); else if(e.code==='KeyR') repairPart(hmTarget);
});

/* ---------------- Ящики ---------------- */
const STOR_N = 20;
const storEl = document.createElement('div'); storEl.id = 'stor-panel';
storEl.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;width:min(94vw,440px);max-height:86vh;overflow:auto;background:rgba(34,33,31,.95);border:none;border-radius:0;padding:12px;color:#fff;font:600 13px sans-serif';
document.body.appendChild(storEl);
['pointerdown','touchstart','mousedown','click'].forEach(ev=>storEl.addEventListener(ev, e=>e.stopPropagation()));

(function(){ const st = document.createElement('style'); st.textContent =
 '#stor-panel,#fur-panel{border:1px solid rgba(255,255,255,.08)!important;box-shadow:0 10px 36px rgba(0,0,0,.55)}'
+'.sp-top{display:flex;justify-content:space-between;align-items:center;padding:2px 2px 6px;letter-spacing:2px;font-size:13px}'
+'.sp-card{background:rgba(18,17,15,.55);padding:6px;border:1px solid rgba(255,255,255,.06)}'
+'.sp-h{display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:1.5px;color:#b9b6b0;padding:0 2px 5px}'
+'.sp-h b{color:#cfe6a0;font-weight:700;letter-spacing:.5px}'
+'.sp-grid{display:grid;justify-content:center}'
+'.sp-hint{font-size:10px;color:#8d8a84;text-align:center;margin-top:5px;letter-spacing:.5px}'
+'#stor-panel .inv-slot,#fur-panel .inv-slot{background:rgba(52,50,46,.75);outline:1px solid rgba(255,255,255,.07);outline-offset:-1px;transition:background .12s}'
+'#stor-panel .inv-slot.has-item,#fur-panel .inv-slot.has-item{background:rgba(84,86,76,.9);outline-color:rgba(207,230,160,.28);cursor:grab}'
+'#stor-panel .inv-slot.has-item:active,#fur-panel .inv-slot.has-item:active{background:rgba(110,114,96,.95)}'
+'#stor-panel .inv-slot .count,#fur-panel .inv-slot .count{font-size:12px;bottom:2px;right:4px}';
 document.head.appendChild(st); })();
function storSlots(id){ let a = storData.get(id); if(!a){ a = Array(STOR_N).fill(null); storData.set(id, a); } return a; }
function dtap(c, fn){ let last = 0; c.addEventListener('click', ()=>{ const n = performance.now(); if(n-last < 380){ last = 0; fn(); } else last = n; }); }
function storCell(sl, fn){
  const c = document.createElement('div');
  c.className = 'inv-slot'+(sl?' has-item':'');
  if(sl){
    const def = ITEM_DEFS[sl.k] || {};
    c.innerHTML = '<img src="'+(def.icon||'')+'"><span class="count">'+(sl.n>1?sl.n:'')+'</span>';
    c.title = def.name || sl.k;
  }
  if(fn) dtap(c, fn);
  return c;
}
function storFit(){
  if(storOpenId===null) return;
  const A=storEl.querySelector('#stor-a'), B=storEl.querySelector('#stor-b'); if(!A||!B) return;
  const W=window.innerWidth, H=window.innerHeight, land=W>H*1.15, gap=4, cols=5, pad=12;
  const rA=Math.ceil(storSlots(storOpenId).length/cols), rB=Math.ceil((HOTBAR_N+GRID_N)/cols);
  const availW=W*0.96-16, availH=H*0.96-70;               // 70 = шапка панели + подсказка
  let s;
  if(land) s=Math.min(((availW-14)/2-pad)/cols-gap, (availH-34)/Math.max(rA,rB)-gap);
  else     s=Math.min((availW-pad)/cols-gap, (availH-2*34-8)/(rA+rB)-gap);
  s=Math.max(26,Math.floor(Math.min(s,64)));
  [A,B].forEach(g=>{ g.style.gridTemplateColumns='repeat('+cols+','+s+'px)'; g.style.gridAutoRows=s+'px'; g.style.gap=gap+'px'; });
  storEl.querySelector('#stor-body').style.flexDirection=land?'row':'column';
  const cw=cols*(s+gap)-gap+pad+2;
  storEl.style.width=(land?cw*2+14:cw)+16+'px';
}
window.addEventListener('resize', ()=>{ try{ storFit(); }catch(e){} });
function cupRent(c){
  const need = {wood:0, stone:0, metal:0}, have = {};
  parts.forEach(p=>{ if(p.type==='cupboard' || p.type==='box') return; if(Math.hypot(c.x-p.x, c.z-p.z) > CUP_R) return; need[UP_RES[p.up|0] || 'wood'] += UPKEEP_PER_PART; });
  storSlots(c.id).forEach(sl=>{ if(sl) have[sl.k] = (have[sl.k]||0) + sl.n; });
  const nm = {wood:'дерева', stone:'камня', metal:'металла'};
  const keys = ['wood'].concat(['stone','metal'].filter(k=>need[k]>0));
  return '<span style="margin-left:10px;letter-spacing:0;font-size:11px;font-weight:600;color:#b9b6b0">аренда 24 ч: '+keys.map(k=>'<b style="color:'+((have[k]||0) < need[k] ? '#ff5a4a' : '#cfe6a0')+'">'+need[k]+' '+nm[k]+'</b>').join(', ')+'</span>';
}
function renderStorage(){
  if(storOpenId===null){ storEl.style.display='none'; return; }
  storEl.style.display = 'block';
  const cp = parts.get(storOpenId), nm = isSackId(storOpenId) ? 'МЕШОК С ЛУТОМ' : cp && cp.type==='cupboard' ? 'ШКАФ' : 'ЯЩИК';
  storEl.style.overflow='hidden'; storEl.style.maxHeight='98vh'; storEl.style.maxWidth='98vw'; storEl.style.padding='6px 8px';
  storEl.innerHTML = '<div class="sp-top"><span>'+nm+(cp && cp.type==='cupboard' ? cupRent(cp) : '')+'</span><button id="stor-x" style="background:rgba(58,56,52,.9);border:none;color:#fff;padding:5px 14px">✖</button></div>'
    +'<div id="stor-body" style="display:flex;gap:14px;align-items:flex-start;justify-content:center">'
    +'<div class="sp-card"><div class="sp-h"><span>СОДЕРЖИМОЕ</span><b id="sp-ca"></b></div><div id="stor-a" class="sp-grid"></div></div>'
    +'<div class="sp-card"><div class="sp-h"><span>ИНВЕНТАРЬ</span><b id="sp-cb"></b></div><div id="stor-b" class="sp-grid"></div></div></div>'
    +'<div class="sp-hint">Двойной тап — переместить · или перетащите предмет</div>';
  storEl.querySelector('#stor-x').onclick = closeStorage;
  const A = storEl.querySelector('#stor-a'), B = storEl.querySelector('#stor-b'), arr = storSlots(storOpenId);
  arr.forEach((sl,i)=>{ const c = storCell(sl, ()=>storTake(i)); c.dataset.z='s'; c.dataset.i=i; A.appendChild(c); });
  let nb = 0;
  allSlotRefs().forEach(r=>{ const sl = getAt(r), c = storCell(sl, sl ? ()=>storPut(r) : null); if(sl) nb++; c.dataset.z='p'; c.dataset.ref = JSON.stringify(r); B.appendChild(c); });
  storEl.querySelector('#sp-ca').textContent = arr.filter(Boolean).length+'/'+arr.length;
  storEl.querySelector('#sp-cb').textContent = nb+'/'+(HOTBAR_N+GRID_N);
  storFit();
}
function storRefresh(){ try{ renderHotbar(); renderInvGrid(); refreshHeld(); updateResourceUI(); }catch(e){}
  if(isSackId(storOpenId) && !(storData.get(storOpenId)||[]).some(Boolean)){ removeSack(storOpenId); return; }
  renderStorage(); }
function openStorage(id){
  if(!parts.has(id)) return;
  if(parts.get(id).type==='quarry'){ openQuarry(id); return; }
  if(parts.get(id).type==='furnace'){ openFurnace(id); return; }
  storOpenId = id; try{ if(document.exitPointerLock) document.exitPointerLock(); }catch(e){}
  if(window.OSIL_NET && OSIL_NET.on) OSIL_NET.onBuild({t:'so', id});
  renderStorage(); updateFpsVisibility();
}
function closeStorage(){
  storOpenId = null; storEl.style.display = 'none'; updateFpsVisibility();
  try{ if(!('ontouchstart' in window) && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock(); }catch(e){}
}

/* ---------------- Drag & Drop для ящика, шкафа, мешка/трупа и печки ---------------- */
(function(){
  let st = null, ghost = null, suppress = false;
  const mk = ()=>{ if(!ghost){ ghost = document.createElement('div'); ghost.style.cssText='position:fixed;left:0;top:0;width:52px;height:52px;z-index:200;pointer-events:none;opacity:.9;display:none'; ghost.innerHTML='<img style="width:100%;height:100%;object-fit:contain">'; document.body.appendChild(ghost); } return ghost; };
  const cellOf = t=> t && t.closest ? t.closest('[data-z]') : null;
  const down = e=>{
    const c = cellOf(e.target); if(!c || !c.querySelector('img') || !c.classList.contains('has-item') || e.button>0) return;
    const root = c.closest('#stor-panel,#fur-panel'); if(!root) return;
    st = {c, root, x:e.clientX, y:e.clientY, on:false, id:e.pointerId};
  };
  const move = e=>{
    if(!st) return; const dx = e.clientX-st.x, dy = e.clientY-st.y;
    if(!st.on){ if(Math.hypot(dx,dy) < 8) return; st.on = true; const g = mk(); g.firstChild.src = st.c.querySelector('img').src; g.style.display='block'; st.c.style.opacity='.4'; }
    ghost.style.transform = 'translate('+(e.clientX-26)+'px,'+(e.clientY-26)+'px)'; e.preventDefault();
  };
  const up = e=>{
    if(!st) return; const s0 = st; st = null;
    if(!s0.on) return;
    suppress = true; setTimeout(()=>suppress=false, 60);
    ghost.style.display='none'; s0.c.style.opacity='';
    const dst = cellOf(document.elementFromPoint(e.clientX, e.clientY));
    const inRoot = s0.root.contains(document.elementFromPoint(e.clientX, e.clientY));
    dropOn(s0.c, dst, inRoot);
  };
  function dropOn(src, dst, inRoot){
    const z = src.dataset.z, dz = dst ? dst.dataset.z : null;
    if(furOpenId !== null){
      if(z==='p'){ const ref = JSON.parse(src.dataset.ref); if(inRoot && dz !== 'p') furTransfer(ref); else if(dz==='p') swapRefs(ref, JSON.parse(dst.dataset.ref), furRerender); }
      else if(dz==='p' || !inRoot){ const [kind,k] = src.dataset.dk.split(':'); if(kind==='r') furTake(k); else furReturn(kind==='o'?'ore':'fuel', k); }
      return;
    }
    if(storOpenId === null) return;
    if(z==='p'){
      const ref = JSON.parse(src.dataset.ref);
      if(dz==='p') swapRefs(ref, JSON.parse(dst.dataset.ref), storRefresh);
      else if(inRoot && (dz==='s' || !dz)) storPutAt(ref, dst && dz==='s' ? parseInt(dst.dataset.i) : -1);
    } else if(z==='s'){
      const i = parseInt(src.dataset.i);
      if(dz==='p' || !inRoot) storTake(i);
      else if(dz==='s') storMove(i, parseInt(dst.dataset.i));
    }
  }
  const furRerender = ()=>{ storRefreshF(); };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, {capture:true, passive:false});
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', ()=>{ if(st && st.on){ ghost.style.display='none'; st.c.style.opacity=''; } st=null; }, true);
  window.addEventListener('click', e=>{ if(suppress && cellOf(e.target)){ e.stopPropagation(); e.preventDefault(); } }, true);
  ['stor-panel','fur-panel'].forEach(id=>{ const el = document.getElementById(id); if(el) el.style.touchAction='none'; });
})();
function swapRefs(a, b, after){
  if(a.t===b.t && a.i===b.i) return;
  if((a.t==='e'||b.t==='e')) return;
  const x = getAt(a), y = getAt(b);
  if(x && y && x.k===y.k && x.d===undefined && y.d===undefined){ const cap = stackOf(x.k), m = Math.min(cap-y.n, x.n); y.n += m; x.n -= m; if(x.n<=0) setAt(a, null); }
  else { setAt(a, y||null); setAt(b, x||null); }
  after && after();
}
function storPutAt(ref, idx){
  const net = window.OSIL_NET && OSIL_NET.on && !isSackId(storOpenId);
  const arr = storSlots(storOpenId), sl = getAt(ref);
  if(!net && sl && idx>=0 && idx<arr.length && !arr[idx]){ arr[idx] = {k:sl.k, n:sl.n}; if(sl.d!==undefined) arr[idx].d = sl.d; setAt(ref, null); storRefresh(); return; }
  storPut(ref);
}
function storMove(i, j){
  if(i===j || (window.OSIL_NET && OSIL_NET.on && !isSackId(storOpenId))) return;
  const arr = storSlots(storOpenId), a = arr[i], b = arr[j];
  if(a && b && a.k===b.k && a.d===undefined && b.d===undefined){ const m = Math.min(stackOf(a.k)-b.n, a.n); b.n += m; a.n -= m; if(a.n<=0) arr[i] = null; }
  else { arr[i] = b||null; arr[j] = a||null; }
  renderStorage();
}
function storPut(ref){
  const sl = getAt(ref); if(!sl || storOpenId===null) return;
  const k = sl.k, n = sl.n, d = sl.d, cap = stackOf(k);
  if(window.OSIL_NET && OSIL_NET.on && !isSackId(storOpenId)){
    setAt(ref, null); OSIL_NET.onBuild({t:'sp', id:storOpenId, k, n, d, cap}); storRefresh(); return;
  }
  const arr = storSlots(storOpenId); let left = n;
  if(d===undefined) for(const x of arr){ if(left>0 && x && x.k===k && x.d===undefined && x.n<cap){ const a=Math.min(cap-x.n,left); x.n+=a; left-=a; } }
  for(let i=0;i<STOR_N && left>0;i++) if(!arr[i]){ const a=Math.min(cap,left); arr[i]={k,n:a}; if(d!==undefined) arr[i].d=d; left-=a; }
  if(left===n){ showToast('Ящик полон'); return; }
  if(left>0) sl.n = left; else setAt(ref, null);
  storRefresh();
}
function storTake(i){
  const arr = storSlots(storOpenId), sl = arr[i]; if(!sl) return;
  if(window.OSIL_NET && OSIL_NET.on && !isSackId(storOpenId)){
    if(roomFor(sl.k) < sl.n){ showToast('Нет места в инвентаре'); return; }
    OSIL_NET.onBuild({t:'sk', id:storOpenId, i}); return;
  }
  const got = addItem(sl.k, sl.n, sl.d);
  if(got<=0){ showToast('Нет места в инвентаре'); return; }
  sl.n -= got; if(sl.n<=0) arr[i] = null;
  storRefresh();
}

/* --- подсказка у двери / ящика --- */
const doorUI = document.createElement('div'); doorUI.id = 'door-prompt';
doorUI.innerHTML = '<button id="dp-open"></button><button id="dp-lock"></button><button id="dp-box">ОТКРЫТЬ ЯЩИК</button>';
document.body.appendChild(doorUI);
let doorTarget = null, boxTarget = null;
const _dpv = new THREE.Vector3();
function updateDoorPrompt(){
  let best = null, bbox = null, bd = 3.4;
  if(kp){
    const p = kp.d.grp.position;
    if(Math.hypot(p.x-player.pos.x, p.z-player.pos.z) > 3.6 || panelsOpen()) endKeypad();
  }
  if(!kp && !buildMode && document.getElementById('pause-menu').classList.contains('hidden') && !layoutEditing && !panelsOpen()){
    camera.getWorldDirection(_dpv);
    const test = (p, y)=>{ const dx = p.x-player.pos.x, dz = p.z-player.pos.z, dist = Math.hypot(dx,dz);
      return dist < bd && Math.abs(y-player.pos.y) < 2.5 && (dx*_dpv.x + dz*_dpv.z)/Math.max(dist,0.01) > 0.15 ? dist : -1; };
    { const hs=[]; doors.forEach(d=>hs.push(d.grp.userData.hit)); aimRay(3.2);
      const h=hs.length ? _bRay.intersectObjects(hs,false)[0] : null;
      if(h){ best = h.object.userData.door; bd = h.distance; bbox = null; } }
    parts.forEach(p=>{ if(p.type!=='box' && p.type!=='cupboard' && p.type!=='quarry' && p.type!=='furnace') return; const dist = test(p, p.y); if(dist>=0){ bd = dist; bbox = p; best = null; } });
  }
  if(best !== doorTarget || bbox !== boxTarget){
    doorTarget = best; boxTarget = bbox; doorUI.classList.toggle('show', !!(best || bbox));
    { const db=document.getElementById('dp-box'); db.style.display = bbox ? '' : 'none'; if(bbox) db.textContent = bbox.type==='box' ? 'ОТКРЫТЬ ЯЩИК' : bbox.type==='quarry' ? 'КАРЬЕР' : bbox.type==='furnace' ? 'ПЕЧКА' : 'ОТКРЫТЬ ШКАФ'; }
    document.getElementById('dp-open').style.display = 'none';
  }
  if(best){
    const o = document.getElementById('dp-open'), l = document.getElementById('dp-lock');
    const locked = best.locked && !isAuthed(best);
    const to = 'ВВЕСТИ КОД'; o.style.display = locked ? '' : 'none';
    const tl = best.locked ? 'СНЯТЬ ЗАМОК' : 'ПОСТАВИТЬ ЗАМОК';
    if(o.textContent !== to) o.textContent = to; if(l.textContent !== tl) l.textContent = tl;
    l.style.display = locked ? 'none' : '';
  } else document.getElementById('dp-lock').style.display = 'none';
}
document.getElementById('dp-open').addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); if(doorTarget) doorToggle(doorTarget); });
document.getElementById('dp-lock').addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); if(doorTarget) doorLock(doorTarget); });
document.getElementById('dp-box').addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); if(boxTarget) openStorage(boxTarget.id); });
window.addEventListener('keydown', e=>{
  if(/INPUT|TEXTAREA/.test((document.activeElement||{}).tagName||'')) return;
  if(e.code==='KeyE'){ if(doorTarget) doorToggle(doorTarget); else if(boxTarget) openStorage(boxTarget.id); }
  else if(e.code==='KeyF' && doorTarget) doorLock(doorTarget);
});

/* ---------------- Input: keyboard ---------------- */
const keys = {};
window.addEventListener('keydown', e=>{
  keys[e.code]=true;
  if(e.code==='Tab'){ e.preventDefault(); toggleInventory(); }
  if(e.code==='KeyC' || e.code==='ControlLeft'){ toggleCrouch(); }
  if(e.code>='Digit1' && e.code<='Digit6'){ selectSlot(parseInt(e.code.slice(-1))-1); }
  if(e.code==='Space'){ jump(); }
  if(e.code==='Escape' && kp) endKeypad();
  if(e.code==='Escape' && storOpenId!==null) closeStorage();
  if(e.code==='KeyQ' && buildMode){ cycleBuildType(1); }
  if(e.code==='KeyR' && buildMode){ rotateBuild(); }
  else if(e.code==='KeyR' && isMag(toolKind)){ startReload(); }
  if(e.code==='KeyM'){ toggleMap(); }
  if(e.code==='KeyY' && !/INPUT|TEXTAREA/.test((document.activeElement||{}).tagName||'')) inspectItem();
});
window.addEventListener('keyup', e=>{ keys[e.code]=false; });

let attackHeld = false;
renderer.domElement.addEventListener('mousedown', e=>{
  if(isMobile() && e.button===0) return;
  if(e.button===2 && isMag(toolKind)){ aimHeld = true; return; }          // ПКМ с винтовкой = прицел
  if(e.button===2 || (e.button===0 && document.pointerLockElement===renderer.domElement)){ attackHeld = true; doHit(false); }
});
window.addEventListener('mouseup', e=>{ attackHeld = false; if(e.button===2) aimHeld = false; });
renderer.domElement.addEventListener('click', ()=>{
  if(isMobile()) return;
  if(document.getElementById('inv-panel').classList.contains('show') ||
     document.getElementById('craft-panel').classList.contains('show')) return;
  renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
});
document.addEventListener('mousemove', e=>{
  if(document.pointerLockElement === renderer.domElement){
    const L = lookTarget();
    L.yaw -= e.movementX * 0.0022 * (CFG.sens/5);
    L.pitch -= e.movementY * 0.0022 * (CFG.sens/5) * (CFG.invertY?-1:1);
    L.pitch = Math.max(-1.3, Math.min(1.3, L.pitch));
  }
});
renderer.domElement.addEventListener('contextmenu', e=>e.preventDefault());

function isMobile(){
  const p = (window.OSIL_SETTINGS && OSIL_SETTINGS.all.platform) | 0;      // 0 авто, 1 ПК, 2 телефон
  if(p===1) return false; if(p===2) return true;
  return 'ontouchstart' in window || navigator.maxTouchPoints>0;
}
function applyPlatform(){ document.body.classList.toggle('plat-pc', !isMobile()); }
applyPlatform();
if(window.OSIL_SETTINGS) OSIL_SETTINGS.onChange((k)=>{ if(k==='platform' || k===null) applyPlatform(); });

/* ---------------- Mobile joystick + look ---------------- */
const joyZone = document.getElementById('joystick-zone');
const lookZone = document.getElementById('look-zone');
const joyBase = document.getElementById('joystick-base');
const joyKnob = document.getElementById('joystick-knob');
let joyActive=false, joyId=null, joyCenter={x:0,y:0}, joyVec={x:0,y:0};
let lookId=null, lookLast={x:0,y:0};

joyZone.addEventListener('touchstart', e=>{
  const t = e.changedTouches[0];
  joyId = t.identifier; joyActive=true;
  joyCenter = {x:t.clientX, y:t.clientY};
  joyBase.style.display='block'; joyKnob.style.display='block';
  const jk = CFG.joySize/100;
  joyBase.style.width = joyBase.style.height = (110*jk)+'px'; joyKnob.style.width = joyKnob.style.height = (52*jk)+'px';
  joyBase.style.left=(t.clientX-55*jk)+'px'; joyBase.style.top=(t.clientY-55*jk)+'px';
  joyKnob.style.left=(t.clientX-26*jk)+'px'; joyKnob.style.top=(t.clientY-26*jk)+'px';
  e.preventDefault();
},{passive:false});

joyZone.addEventListener('touchmove', e=>{
  for(const t of e.changedTouches){
    if(t.identifier===joyId){
      let dx=t.clientX-joyCenter.x, dy=t.clientY-joyCenter.y;
      const jk = CFG.joySize/100, maxD=44*jk;
      const d=Math.hypot(dx,dy);
      if(d>maxD){ dx=dx/d*maxD; dy=dy/d*maxD; }
      joyVec = {x:dx/maxD, y:dy/maxD};
      joyKnob.style.left=(joyCenter.x+dx-26*jk)+'px'; joyKnob.style.top=(joyCenter.y+dy-26*jk)+'px';
    }
  }
  e.preventDefault();
},{passive:false});

function joyEnd(e){
  for(const t of e.changedTouches){
    if(t.identifier===joyId){
      joyActive=false; joyId=null; joyVec={x:0,y:0};
      joyBase.style.display='none'; joyKnob.style.display='none';
    }
  }
}
joyZone.addEventListener('touchend', joyEnd);
joyZone.addEventListener('touchcancel', joyEnd);

lookZone.addEventListener('touchstart', e=>{
  const t=e.changedTouches[0];
  lookId=t.identifier; lookLast={x:t.clientX,y:t.clientY};
  e.preventDefault();
},{passive:false});
lookZone.addEventListener('touchmove', e=>{
  for(const t of e.changedTouches){
    if(t.identifier===lookId){
      const dx=t.clientX-lookLast.x, dy=t.clientY-lookLast.y;
      const L = lookTarget();
      L.yaw -= dx*0.004*(CFG.sens/5);
      L.pitch -= dy*0.004*(CFG.sens/5)*(CFG.invertY?-1:1);
      L.pitch = Math.max(-1.3, Math.min(1.3, L.pitch));
      lookLast={x:t.clientX,y:t.clientY};
    }
  }
  e.preventDefault();
},{passive:false});
function lookEnd(e){
  for(const t of e.changedTouches) if(t.identifier===lookId) lookId=null;
}
lookZone.addEventListener('touchend', lookEnd);
lookZone.addEventListener('touchcancel', lookEnd);

/* ---------------- Jump / movement ---------------- */
function jump(){
  if(copter.pilot){ copter.climbT=0.5; return; }
  if(player.onGround){ player.velY = 6.2; player.onGround=false; window.OSIL_AUDIO&&OSIL_AUDIO.play('jump',{vol:0.7}); }
}
(function(){
  const ba = document.getElementById('btn-aim'), br = document.getElementById('btn-reload');
  if(ba) ba.addEventListener('pointerdown', e=>{ e.preventDefault(); if(isMag(toolKind)){ aimOn = !aimOn; ba.classList.toggle('active', aimOn); } });
  if(br) br.addEventListener('pointerdown', e=>{ e.preventDefault(); startReload(); });
})();
(function(){ const bi = document.getElementById('btn-inspect'); if(!bi) return;
  bi.addEventListener('pointerdown', e=>{ e.preventDefault(); inspectItem(); });
  setInterval(()=>{ const on = toolKind!=='none' && !!currentToolMesh && !buildMode && !(typeof copter!=='undefined' && copter.pilot); bi.style.display = on ? 'flex' : 'none'; bi.classList.toggle('active', inspectT>=0); }, 250);
})();
let runOn = false;
(function(){ const b = document.getElementById('btn-run'); if(!b) return;
  const tg = e=>{ e.preventDefault(); runOn = !runOn; b.classList.toggle('active', runOn); };
  b.addEventListener('touchstart', tg, {passive:false}); b.addEventListener('click', e=>{ if(e.detail) tg(e); }); })();
document.getElementById('btn-jump').addEventListener('click', jump);
document.getElementById('btn-jump').addEventListener('touchstart', e=>{ e.preventDefault(); jump(); });

(function(){
  const b = document.getElementById('btn-hit');
  const up = ()=>{ attackHeld = false; };
  b.addEventListener('touchstart', e=>{ e.preventDefault(); attackHeld = true; doHit(false); }, {passive:false});
  b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
  b.addEventListener('mousedown', ()=>{ attackHeld = true; doHit(false); });
})();

const GRAVITY = -16;

/* Высота опоры под точкой: террейн или верх фундамента/пола, если игрок не ниже его (+0.6 м допуск шага).
   Не даёт «провалиться» сквозь построенный пол и позволяет ходить по этажам. */
function walkHeightAt(x,z,feetY){
  let g = heightAt(x,z); { const ct = colTopAt(x,z,feetY); if(ct > g) g = ct; }
  const cx=Math.round(x/CELL), cz=Math.round(z/CELL);
  for(let l=0;l<6;l++){
    const c = cells.get(cx+','+cz+','+l);
    if(!c) continue;
    const top = c.y + l*FLOOR_H + (c.type==='foundation'?0.3:0.15);
    if(feetY >= top-(l===0?1.4:0.6) && top>g) g = top;
  }
  if(stairsMap.size) for(const st of stairsMap.values()){
    const dx=x-st.x, dz=z-st.z; if(Math.abs(dx)>2.2||Math.abs(dz)>2.2) continue;
    const co=Math.cos(st.rotY), si=Math.sin(st.rotY), lx=dx*co-dz*si, lz=dx*si+dz*co;
    if(Math.abs(lx)>1.2 || lz>2 || lz<-2) continue;
    const h=st.y0+FLOOR_H*(2-lz)/4;
    if(feetY >= h-0.7 && h>g) g = h;
  }
  return g;
}
/* в воду можно зайти по колено (мелководье), дальше — слишком глубоко, плавать пока нельзя */
const MAX_WADE_DIST = 5;   // в воду можно зайти максимум на 5 м от берега, дальше — невидимая стена
const WATER_DIST = (()=>{   // расстояние до ближайшей суши (м), двухпроходный chamfer по сетке генератора
  const N = WN, cell = WORLD_SIZE/(N-1), d = new Float32Array(N*N), D = 1.4142;
  for(let k=0;k<N*N;k++) d[k] = WG.h[k] >= 0.02 ? 0 : 1e6;
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){ const k=j*N+i; let v=d[k];
    if(i>0) v=Math.min(v,d[k-1]+1); if(j>0) v=Math.min(v,d[k-N]+1);
    if(i>0&&j>0) v=Math.min(v,d[k-N-1]+D); if(i<N-1&&j>0) v=Math.min(v,d[k-N+1]+D); d[k]=v; }
  for(let j=N-1;j>=0;j--) for(let i=N-1;i>=0;i--){ const k=j*N+i; let v=d[k];
    if(i<N-1) v=Math.min(v,d[k+1]+1); if(j<N-1) v=Math.min(v,d[k+N]+1);
    if(i<N-1&&j<N-1) v=Math.min(v,d[k+N+1]+D); if(i>0&&j<N-1) v=Math.min(v,d[k+N-1]+D); d[k]=v; }
  for(let k=0;k<N*N;k++) d[k] *= cell;
  return d;
})();
const waterDistAt = (x,z)=> heightAt(x,z) >= 0.02 ? 0 : wgSample(WATER_DIST, x, z);
function tooDeep(x,z){ return waterDistAt(x,z) > MAX_WADE_DIST; }
const wallAt = (x,z)=> tooDeep(x,z) && waterDistAt(x,z) >= waterDistAt(player.pos.x, player.pos.z);
function collidesAt(x,z){
  const r = 0.4, py = player.pos.y, ph = player.height, cs = colNear(x,z,r+0.1);
  for(let i=0;i<cs.length;i++){ const b = cs[i].box;
    if(x > b.min.x-r && x < b.max.x+r && z > b.min.z-r && z < b.max.z+r && py < b.max.y && py+ph > b.min.y){
      if(cs[i].walk && b.max.y-py <= 0.55) continue;   // низкий уступ — заходим на него сверху
      return true;
    }
  }
  return false;
}

function updateMovement(dt){
  if(copter.pilot){ updateCopter(dt); updateCameraFromPlayer(); return; }
  let fwd=0, strafe=0;
  if(keys['KeyW']) fwd+=1;
  if(keys['KeyS']) fwd-=1;
  if(keys['KeyD']) strafe+=1;
  if(keys['KeyA']) strafe-=1;
  if(joyActive){ fwd -= joyVec.y; strafe += joyVec.x; }

  const len = Math.hypot(fwd,strafe);
  if(len>0){ fwd/=len; strafe/=len; }
  if(len>0 && (CFG.camMode|0)===3){ player.yaw = orbit.yaw; player.pitch = 0; }   // «осмотр»: при ходьбе идём относительно камеры

  const running = (keys['ShiftLeft'] || runOn) && player.stamina>1 && !isCrouching && !suitWorn();
  const crouchMult = isCrouching ? 0.5 : 1;
  const spd = player.speed * (running?player.runMult:1) * crouchMult * Math.min(len,1);

  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  const moveX = (-sinY*fwd + cosY*strafe) * spd * dt;
  const moveZ = (-cosY*fwd - sinY*strafe) * spd * dt;

  if(collidesAt(player.pos.x, player.pos.z)){   // застряли в дереве/камне — выталкиваем наружу
    const cs0 = colNear(player.pos.x, player.pos.z, 3);
    for(let i=0;i<cs0.length;i++){ const b = cs0[i].box; if(cs0[i].walk) continue;
      if(player.pos.y < b.max.y && player.pos.y+player.height > b.min.y && player.pos.x>b.min.x-0.4 && player.pos.x<b.max.x+0.4 && player.pos.z>b.min.z-0.4 && player.pos.z<b.max.z+0.4){
        const dl=player.pos.x-(b.min.x-0.45), dr=(b.max.x+0.45)-player.pos.x, dd=player.pos.z-(b.min.z-0.45), du=(b.max.z+0.45)-player.pos.z, m=Math.min(dl,dr,dd,du);
        if(m===dl) player.pos.x=b.min.x-0.45; else if(m===dr) player.pos.x=b.max.x+0.45; else if(m===dd) player.pos.z=b.min.z-0.45; else player.pos.z=b.max.z+0.45; } }
  }
  const nx = player.pos.x+moveX, nz = player.pos.z+moveZ;
  /* слишком крутой подъём (> ~50°) не пройти, как скалу в Rust; в прыжке — не мешает */
  const steep = (x1,z1)=>{ if(!player.onGround) return false; const d=Math.hypot(x1-player.pos.x,z1-player.pos.z); return d>1e-6 && (heightAt(x1,z1)-heightAt(player.pos.x,player.pos.z))/d > 1.2; };
  if(!collidesAt(nx, player.pos.z) && !wallAt(nx, player.pos.z) && !steep(nx, player.pos.z)) player.pos.x = nx;
  if(!collidesAt(player.pos.x, nz) && !wallAt(player.pos.x, nz) && !steep(player.pos.x, nz)) player.pos.z = nz;

  const half = WORLD_SIZE/2-2;
  player.pos.x = Math.max(-half, Math.min(half, player.pos.x));
  player.pos.z = Math.max(-half, Math.min(half, player.pos.z));

  player.velY += GRAVITY*dt;
  player.pos.y += player.velY*dt;
  const groundY = walkHeightAt(player.pos.x, player.pos.z, player.pos.y);
  if(player.pos.y <= groundY){
    player.pos.y = groundY; player.velY=0; player.onGround=true;
  } else player.onGround=false;

  moveAmt = (len>0 && player.onGround) ? (running?1.6:1) : 0;
  if(window.OSIL_AUDIO) OSIL_AUDIO.walk(len>0 && player.onGround, running);
  if(running && len>0){ player.stamina = Math.max(0, player.stamina - dt*14); }
  else { player.stamina = Math.min(100, player.stamina + dt*8); }

  updateCameraFromPlayer();
}

/* ---------------- Harvesting (hold LMB / hold on mobile) ---------------- */
let harvesting=false, harvestTarget=null, harvestProgress=0;
const HARVEST_TIME = 0.9;
const HARVEST_RANGE = 4.5;
const raycaster = new THREE.Raycaster();
raycaster.far = HARVEST_RANGE;

let harvestHitMap = new Map();
function rebuildHarvestHitMap(){
  harvestHitMap = new Map();
  for(const h of harvestables){
    h.mesh.traverse(obj=>{ if(obj.isMesh) harvestHitMap.set(obj, h); });
  }
}
rebuildHarvestHitMap();

function findTargetInReach(){
  if(CFG.camMode|0){
    const cp=Math.cos(player.pitch);
    raycaster.set(new THREE.Vector3(player.pos.x,player.pos.y+player.height,player.pos.z), new THREE.Vector3(-Math.sin(player.yaw)*cp, Math.sin(player.pitch), -Math.cos(player.yaw)*cp));
  } else raycaster.setFromCamera({x:0,y:0}, camera);
  const meshList = Array.from(harvestHitMap.keys());
  const hits = raycaster.intersectObjects(meshList, false);
  if(hits.length === 0) return null;
  lastHitPoint.copy(hits[0].point);
  return harvestHitMap.get(hits[0].object) || null;
}

/* ---------- Частицы обломков (щепки / каменная крошка) как в Rust ---------- */
const lastHitPoint = new THREE.Vector3();
const DEBRIS_COLORS = {
  carcass:[0x7a0b0b,0x9a1313,0x55070a],
  wood:[0x8a5a2b,0x6b4423,0xa9743a,0x5a3a1c],
  cloth:[0x3f7a2a,0x5a9a35,0x2f5e20,0x6b4423],
  stone:[0x8d8d8d,0x6f6f6f,0xa5a5a5,0x555555],
  sulfur:[0xd8ca2a,0xe6d84a,0x8d8d8d,0xb8a820],
  metal:[0xb87a4a,0x8d8d8d,0xd08a50,0x6f6f6f],
  scrap:[0x8a3b2a,0x3a3a3e,0x8d8d8d,0xb8a820]
};
DEBRIS_COLORS.sulfur=[0xd8ca2a,0xe6d84a,0x8d8d8d,0xb8a820];
const DEBRIS_MAX = 120;
const debrisGeo = new THREE.BoxGeometry(1,1,1);
const debrisPool = [];
for(let i=0;i<DEBRIS_MAX;i++){
  const m = new THREE.Mesh(debrisGeo, new THREE.MeshLambertMaterial({color:0x888888}));
  m.visible=false; m.userData={v:new THREE.Vector3(),rot:new THREE.Vector3(),life:0,max:1,g:14};
  scene.add(m); debrisPool.push(m);
}
let debrisIdx = 0;
function hitFx(p, ty){ spawnDebris(p, ty, 9, 0.95); if(window.OSIL_NET && OSIL_NET.on) OSIL_NET.fxHit(p, ty); }
function spawnDebris(pos, type, count, power){
  if(!CFG.particles) return;
  const cols = DEBRIS_COLORS[type] || DEBRIS_COLORS.stone;
  const isWood = (type==='wood'||type==='cloth');
  for(let i=0;i<count;i++){
    const m = debrisPool[debrisIdx++ % DEBRIS_MAX], u = m.userData;
    m.material.color.setHex(cols[(Math.random()*cols.length)|0]);
    const sz = 0.034+Math.random()*0.055;
    if(isWood && type==='wood') m.scale.set(sz*0.5, sz*0.5, sz*(2+Math.random()*2));   // щепки вытянутые
    else if(type==='cloth') m.scale.set(sz*1.6, sz*0.2, sz*1.6);                      // листья
    else m.scale.set(sz, sz*(0.6+Math.random()*0.6), sz);
    m.position.copy(pos).add(new THREE.Vector3((Math.random()-.5)*0.15,(Math.random()-.5)*0.15,(Math.random()-.5)*0.15));
    const sp = (0.8+Math.random()*1.6)*power;
    u.v.set((Math.random()-.5)*sp, 0.8+Math.random()*1.6*power, (Math.random()-.5)*sp);
    u.rot.set(Math.random()*12,Math.random()*12,Math.random()*12);
    u.g = type==='cloth' ? 5 : 14;
    u.max = u.life = 0.7+Math.random()*0.7;
    m.visible = true;
  }
  if(count >= 4){
    const hard = (type==='stone'||type==='metal'||type==='sulfur'||type==='scrap');
    for(let i=0;i<2;i++) fxEmit('smoke', pos.clone(), new THREE.Vector3((Math.random()-.5)*0.7,0.3+Math.random()*0.5,(Math.random()-.5)*0.7), 0.6, 0.12, 0.5, 0xb8ad94, 0xd8d0bd, {drag:1.5, a:0.45});
    if(hard) for(let i=0;i<4;i++) fxEmit('spark', pos.clone(), new THREE.Vector3((Math.random()-.5)*3.2,0.8+Math.random()*2.2,(Math.random()-.5)*3.2), 0.28, 0.07, 0.02, 0xffe08a, 0xff8a30, {g:9, a:1});
  }
}
function updateDebris(dt){
  updateImpacts(dt);
  for(const m of debrisPool){
    if(!m.visible) continue;
    const u = m.userData;
    u.life -= dt;
    if(u.life<=0){ m.visible=false; continue; }
    u.v.y -= u.g*dt;
    m.position.addScaledVector(u.v, dt);
    m.rotation.x += u.rot.x*dt; m.rotation.y += u.rot.y*dt; m.rotation.z += u.rot.z*dt;
    const gy = heightAt(m.position.x, m.position.z)+0.02;
    if(m.position.y < gy){ m.position.y = gy; u.v.set(u.v.x*0.3, Math.abs(u.v.y)*0.25, u.v.z*0.3); u.rot.multiplyScalar(0.4); }
    if(u.life < 0.25){ const k=u.life/0.25; m.scale.multiplyScalar(0.5+0.5*k>0.98?1:0.94); }
  }
}

/* ---------- Следы выстрелов: пыль/земля/трава на поверхности, видны и на большой дистанции ---------- */
const IMP_MAX = 90, impPool = [], impRay = new THREE.Raycaster(), _io = new THREE.Vector3(), _id = new THREE.Vector3(), _ip = new THREE.Vector3();
const IMP_GROUND = [0x5a7a2e,0x6f5a3a,0x4a3a26,0x7c8a3c,0x8a7a55];
for(let i=0;i<IMP_MAX;i++){
  const m = new THREE.Mesh(debrisGeo, new THREE.MeshLambertMaterial({color:0x888888, transparent:true, opacity:1}));
  m.visible = false; m.frustumCulled = false; m.userData = {v:new THREE.Vector3(), rot:new THREE.Vector3(), life:0, max:1, g:9, s:0.05, dust:false};
  scene.add(m); impPool.push(m);
}
let impIdx = 0;
function impactBurst(pos, dist, cols, big){
  const k = 1 + Math.min(dist, 300)*0.02;                    // издалека частицы крупнее, чтобы были заметны
  const n = big ? 17 : 13;
  for(let i=0;i<n;i++){
    const m = impPool[impIdx++ % IMP_MAX], u = m.userData, dust = i < 3;
    m.material.color.setHex(dust ? 0xbdb59a : cols[(Math.random()*cols.length)|0]);
    m.material.opacity = dust ? 0.55 : 1;
    u.dust = dust; u.s = (dust ? 0.30 : 0.055+Math.random()*0.05) * k;
    m.scale.setScalar(u.s);
    m.position.copy(pos).add(_ip.set((Math.random()-.5)*0.1, 0.03, (Math.random()-.5)*0.1));
    const sp = (dust ? 0.5 : 1.2+Math.random()*1.6);
    u.v.set((Math.random()-.5)*sp, dust ? 0.5+Math.random()*0.5 : 1.4+Math.random()*2.2, (Math.random()-.5)*sp);
    u.rot.set(Math.random()*10,Math.random()*10,Math.random()*10);
    u.g = dust ? 0.6 : 9;
    u.max = u.life = dust ? 0.9 : 0.6+Math.random()*0.5;
    m.visible = true;
  }
  fxEmit('smoke', pos.clone(), new THREE.Vector3(0,0.5,0), 0.55, 0.1*k, 0.5*k, 0xb8ad94, 0xd8d0bd, {drag:1.5, a:0.4});
  if(big) for(let i=0;i<3;i++) fxEmit('spark', pos.clone(), new THREE.Vector3((Math.random()-.5)*3,1+Math.random()*2,(Math.random()-.5)*3), 0.25, 0.07*k, 0.02, 0xffe08a, 0xff8a30, {g:9, a:1});
}

/* ---- всплески и пузыри при стрельбе по воде ---- */
const SPL_MAT_D = new THREE.MeshBasicMaterial({color:0xe4f4fb, transparent:true, opacity:0.85, depthWrite:false});
const SPL_MAT_B = new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.6, depthWrite:false});
const SPL_MAT_R = new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.7, depthWrite:false, side:THREE.DoubleSide});
const splGeo = new THREE.SphereGeometry(1, 7, 5), splRingGeo = new THREE.RingGeometry(0.55, 1, 28);
const splDrops = [], splBubbles = [], splRings = [];
for(let i=0;i<48;i++){ const m = new THREE.Mesh(splGeo, SPL_MAT_D.clone()); m.visible=false; m.renderOrder=3; m.userData={v:new THREE.Vector3(),life:0}; scene.add(m); splDrops.push(m); }
for(let i=0;i<70;i++){ const m = new THREE.Mesh(splGeo, SPL_MAT_B.clone()); m.visible=false; m.renderOrder=3; m.userData={v:new THREE.Vector3(),delay:0,life:0,s:0.03,ph:0,pop:0,x0:0,z0:0}; scene.add(m); splBubbles.push(m); }
for(let i=0;i<8;i++){ const m = new THREE.Mesh(splRingGeo, SPL_MAT_R.clone()); m.rotation.x = -Math.PI/2; m.visible=false; m.renderOrder=3; m.userData={life:0,max:0.9,r:1}; scene.add(m); splRings.push(m); }
let _sdI = 0, _sbI = 0, _srI = 0;
function waterSplash(pt, dist){
  const x = pt.x, z = pt.z, y = SEA_Y;
  seaRipple(x, z, 1.0);                                        // круговая волна по воде
  const rg = splRings[_srI++ % splRings.length], ru = rg.userData; ru.life = ru.max = 0.85; ru.r = 0.9; rg.position.set(x, y+0.02, z); rg.scale.setScalar(0.2); rg.material.opacity = 0.7; rg.visible = true;
  const far = Math.max(1, dist/12);                            // издали брызги крупнее, чтобы были видны
  for(let i=0;i<9;i++){                                        // капли-брызги вверх
    const m = splDrops[_sdI++ % splDrops.length], u = m.userData, sz = (0.018+Math.random()*0.03)*Math.min(far,3);
    m.scale.setScalar(sz); m.position.set(x+(Math.random()-.5)*0.15, y+0.03, z+(Math.random()-.5)*0.15);
    const a = Math.random()*6.283, sp = 0.4+Math.random()*1.3;
    u.v.set(Math.cos(a)*sp, 2.4+Math.random()*2.6, Math.sin(a)*sp); u.life = 1.2; m.material.opacity = 0.85; m.visible = true;
  }
  const floor = Math.max(heightAt(x,z)+0.06, y-0.9);            // пузыри поднимаются со дна/из глубины
  for(let i=0;i<16;i++){
    const m = splBubbles[_sbI++ % splBubbles.length], u = m.userData;
    u.s = (0.015+Math.random()*0.04)*Math.min(far,2.5); u.x0 = x+(Math.random()-.5)*0.4; u.z0 = z+(Math.random()-.5)*0.4;
    m.position.set(u.x0, floor+Math.random()*Math.max(0.05, (y-floor)*0.7), u.z0); m.scale.setScalar(u.s);
    u.v.set(0, 0.35+Math.random()*0.5, 0); u.delay = Math.random()*(i<8 ? 0.3 : 1.3); u.ph = Math.random()*6.283; u.pop = 0; u.life = 4;
    m.material.opacity = 0.6; m.visible = false; u.active = true;
  }
}
function updateSplash(dt){
  for(const m of splDrops){
    if(!m.visible) continue; const u = m.userData; u.life -= dt;
    u.v.y -= 12*dt; m.position.addScaledVector(u.v, dt);
    if(m.position.y <= SEA_Y || u.life <= 0){ m.visible = false; continue; }
    m.material.opacity = Math.min(0.85, u.life*1.5);
  }
  for(const m of splBubbles){
    const u = m.userData; if(!u.active) continue;
    if(u.delay > 0){ u.delay -= dt; if(u.delay <= 0) m.visible = true; continue; }
    u.life -= dt; u.ph += dt*6;
    if(u.pop > 0){ u.pop -= dt; const k = Math.max(0, u.pop/0.14); m.material.opacity = 0.6*k; m.scale.setScalar(u.s*(1.9-0.9*k)); if(u.pop <= 0 || u.life <= 0){ m.visible = false; u.active = false; } continue; }
    m.position.y += u.v.y*dt; m.position.x = u.x0 + Math.sin(u.ph)*0.03; m.position.z = u.z0 + Math.cos(u.ph*0.8)*0.03;
    if(m.position.y >= SEA_Y - 0.01){ m.position.y = SEA_Y + 0.005; u.pop = 0.14; }
    if(u.life <= 0){ m.visible = false; u.active = false; }
  }
  for(const m of splRings){
    if(!m.visible) continue; const u = m.userData; u.life -= dt;
    if(u.life <= 0){ m.visible = false; continue; }
    const k = 1 - u.life/u.max; m.scale.setScalar(0.2 + k*u.r*1.6); m.material.opacity = 0.7*(1-k)*(1-k);
  }
}
const _wp = new THREE.Vector3();
function shotImpact(){
  window.__shotEnd = null; window.__shotMat = '';
  if(CFG.camMode|0){
    const cp = Math.cos(player.pitch);
    _io.set(player.pos.x, player.pos.y+player.height, player.pos.z); _id.set(-Math.sin(player.yaw)*cp, Math.sin(player.pitch), -Math.cos(player.yaw)*cp);
  } else { camera.getWorldPosition(_io); camera.getWorldDirection(_id); }
  let best = 400, cols = IMP_GROUND, hitPt = null;
  impRay.set(_io, _id); impRay.far = 400;
  const hits = impRay.intersectObjects(Array.from(harvestHitMap.keys()).concat(partMeshes), false);
  if(hits.length){ best = hits[0].distance; hitPt = hits[0].point.clone(); const h = harvestHitMap.get(hits[0].object); cols = (h && DEBRIS_COLORS[h.type]) || (hits[0].object.userData.partId ? DEBRIS_COLORS.wood : DEBRIS_COLORS.stone); }
  // луч по рельефу
  let t = 1, prev = 0;
  for(; t < best; t += (t < 60 ? 1 : 3)){
    _ip.copy(_io).addScaledVector(_id, t);
    if(_ip.y < heightAt(_ip.x, _ip.z)){
      let a = prev, b = t;
      for(let i=0;i<6;i++){ const c = (a+b)/2; _ip.copy(_io).addScaledVector(_id, c); if(_ip.y < heightAt(_ip.x,_ip.z)) b = c; else a = c; }
      _ip.copy(_io).addScaledVector(_id, b); _ip.y = heightAt(_ip.x,_ip.z);
      hitPt = _ip.clone(); best = b; cols = IMP_GROUND; break;
    }
    prev = t;
  }
  // попадание в воду: луч пересекает уровень моря раньше, чем земля/объект
  if(_io.y > SEA_Y && _id.y < -1e-4){
    const tw = (SEA_Y-_io.y)/_id.y;
    if(tw > 0.3 && tw < best){
      const wx = _io.x+_id.x*tw, wz = _io.z+_id.z*tw;
      if(isWaterAt(wx, wz)){ _wp.set(wx, SEA_Y, wz); lastHitPoint.copy(_wp); window.__shotEnd = _wp.clone(); window.__shotMat = 'x'; if(CFG.particles) waterSplash(_wp, tw); return; }
    }
  }
  if(!hitPt){ window.__shotEnd = _io.clone().addScaledVector(_id, 150); return; }
  lastHitPoint.copy(hitPt);
  window.__shotEnd = hitPt.clone(); window.__shotMat = cols===IMP_GROUND ? 'g' : (Object.keys(DEBRIS_COLORS).find(k=>DEBRIS_COLORS[k]===cols) || 'stone');
  if(CFG.particles) impactBurst(hitPt, best, cols, cols !== IMP_GROUND);
}
function updateImpacts(dt){
  updateSplash(dt);
  for(const m of impPool){
    if(!m.visible) continue;
    const u = m.userData; u.life -= dt;
    if(u.life <= 0){ m.visible = false; continue; }
    u.v.y -= u.g*dt; m.position.addScaledVector(u.v, dt);
    if(!u.dust){ m.rotation.x += u.rot.x*dt; m.rotation.y += u.rot.y*dt; const gy = heightAt(m.position.x,m.position.z)+0.02; if(m.position.y < gy){ m.position.y = gy; u.v.set(u.v.x*0.3, Math.abs(u.v.y)*0.2, u.v.z*0.3); } }
    else { const f = 1 + (1 - u.life/u.max)*1.8; m.scale.setScalar(u.s*f); m.material.opacity = 0.55*(u.life/u.max); }
  }
}
function debrisAtTarget(target, hitPoint){
  const p = new THREE.Vector3();
  if(target.mesh) target.mesh.getWorldPosition(p);
  p.y += (target.type==='wood'?2.2:0.6);
  spawnDebris(p, target.type, target.type==='wood'?14:12, 0.45);
}

function startHarvest(){
  if(copter.pilot) return;
  if(buildMode || !hasToolInHand()) return;
  harvesting = true;
  harvestProgress = 0;
}
function stopHarvest(){
  harvesting=false; harvestTarget=null; harvestProgress=0;
  document.getElementById('harvest-progress').classList.remove('show');
  document.getElementById('harvest-circle').style.strokeDashoffset=113;
}

function flashCrit(){
  try{ OSIL_AUDIO.play('headshot',{vol:1}); }catch(e){}
  const el = document.getElementById('crit-marker');
  el.classList.add('show');
  clearTimeout(flashCrit._h);
  flashCrit._h = setTimeout(()=>el.classList.remove('show'), 180);
}

function toolMultiplier(target){
  if(target.type==='scrap') return 1;
  if(toolKind==='spear') return 0.6;
  const good = (toolKind==='axe' && (target.type==='wood' || target.type==='cloth')) ||
               (toolKind==='pickaxe' && (target.type==='stone' || target.type==='sulfur' || target.type==='metal'));
  if(good) return 1;
  return 0.5;
}
const ORE_ITEM = {metal:'metal_ore', sulfur:'sulfur_ore'};
function rockYield(t){ return (t.type==='sulfur'||t.type==='metal') ? 1 : 2+Math.floor(Math.random()*3); }   // камень в руке: 2–4 за удар
function harvestOnce(target){
  if(target.type==='carcass'){ triggerSwing(); carcassHit(target); return; }
  if(target.type==='scrap'){ triggerSwing(); hitBarrel(target); return; }
  triggerSwing();
  window.OSIL_AUDIO&&OSIL_AUDIO.play(target.type==='wood'?'chop':(target.type==='cloth'?'hit_tree':'hit_stone'));
  if(window.OSIL_NET && OSIL_NET.on && target.nid!=null){ hitFx(lastHitPoint, target.type); OSIL_NET.harvest(target, toolKind, false); return; }
  const mult = toolMultiplier(target), dep = isDepNode(target);
  const take = dep ? nodeTake(target) : 0;
  const finalAmount = dep ? Math.max(1, Math.floor(take*mult)) : Math.max(1, Math.floor((target.giveMin + Math.random()*(target.giveMax-target.giveMin))*mult));
  giveItem(ORE_ITEM[target.type]||target.type, finalAmount); notifyGain(ORE_ITEM[target.type]||target.type, finalAmount);
  target.health -= dep ? take : 30*Math.max(0.6, mult);
  if(window.OSIL_NET) OSIL_NET.onHit(target);
  hitFx(lastHitPoint, target.type);
  updateResourceUI();
  if(target.health <= 0){
    debrisAtTarget(target);
    destroyHarvestable(target, true);
    if(harvestTarget === target) stopHarvest();
  }
}

function updateHarvest(dt){
  const el = document.getElementById('harvest-progress');
  const circle = document.getElementById('harvest-circle');
  if(!harvesting || !hasToolInHand()){ el.classList.remove('show'); return; }

  const target = findTargetInReach();
  if(!target){
    harvestTarget = null;
    harvestProgress = 0;
    el.classList.remove('show');
    return;
  }
  el.classList.add('show');
  if(target !== harvestTarget){
    harvestTarget = target;
    harvestProgress = 0;
  }

  harvestProgress += dt;
  const pct = Math.min(1, harvestProgress/HARVEST_TIME);
  circle.style.strokeDashoffset = 113*(1-pct);

  if(harvestProgress >= HARVEST_TIME){
    harvestOnce(harvestTarget);
    harvestProgress = 0;
  }
}

/* ---- Расходники: тыква (еда), бинт (лечение) ---- */
function useConsumable(){
  const sl = hotbarSlots[selectedSlot];
  if(!sl) return false;
  const def = ITEM_DEFS[sl.k];
  if(!def || !def.eat) return false;
  if(hitCooldown>0) return true;                 // кулдаун между употреблениями
  hitCooldown = 0.9;
  const e = def.eat;
  player.hunger=Math.min(100,player.hunger+e.hunger);
  player.thirst=Math.min(100,player.thirst+(e.thirst||0));
  player.hp=Math.min(100,player.hp+(e.hp||0));
  showToast('Вы съели: '+def.name);
  removeItem(sl.k,1);
  OSIL_AUDIO.play('open');
  updateResourceUI();
  return true;
}
/* тыквы на земле: спрайты из пака, подбираются на ходу */
const pumpkins = [];
(function(){
  const tx = loadTex(TEXTURES.sprite_pumpkin,1,1);
  for(let i=0;i<0;i++){   // тыквы убраны
    const x=(_rnd()-0.5)*WORLD_SIZE*0.9, z=(_rnd()-0.5)*WORLD_SIZE*0.9;
    const pb = biomeAt(x,z);
    if(pb!==B.PLAIN && pb!==B.FOREST) continue;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:tx, transparent:true}));
    sp.scale.set(0.8,0.8,1); sp.position.set(x, heightAt(x,z)+0.4, z);
    scene.add(sp); pumpkins.push(sp);
  }
})();
function updateWorldPickups(dt){
  for(let i=pumpkins.length-1;i>=0;i--){
    const p=pumpkins[i];
    if(Math.hypot(p.position.x-player.pos.x,p.position.z-player.pos.z)<1.6){
      scene.remove(p); pumpkins.splice(i,1);
      if(giveItem('pumpkin',1)<1){ pumpkins.splice(i,0,p); scene.add(p); } else showToast('+1 Тыква'); OSIL_AUDIO.play('open'); updateResourceUI();
    }
  }
  // пруд: стоя в воде — пьём
  if(biomeAt(player.pos.x,player.pos.z)===B.LAKE && player.thirst<100){
    player.thirst=Math.min(100,player.thirst+dt*18);
    if(!updateWorldPickups.t || performance.now()-updateWorldPickups.t>2500){ showToast('Вы пьёте воду'); updateWorldPickups.t=performance.now(); }
  }
  // крик при критическом здоровье
  if(player.hp<25 && (!updateWorldPickups.s || performance.now()-updateWorldPickups.s>8000)){ OSIL_AUDIO.play('player_scream'); updateWorldPickups.s=performance.now(); }
}

/* ---------------- Hit (separate melee action, right-click / fist button) ---------------- */
function panelsOpen(){
  return storOpenId!==null || quarOpenId!==null || furOpenId!==null ||
         document.getElementById('inv-panel').classList.contains('show') ||
         document.getElementById('craft-panel').classList.contains('show') ||
         document.getElementById('map-panel').classList.contains('show') ||
         pauseOpen();
}
function pauseOpen(){ return !document.getElementById('pause-menu').classList.contains('hidden'); }
/* Запуск удара. Работает только при кулдауне = 0 и после завершённого доставания.
   Урон/ресурсы применяются НЕ сразу, а в момент попадания внутри анимации (HIT_AT). */
function doHit(fromHold){
  if(panelsOpen()) return;
  if(kp){ if(!fromHold && hitCooldown<=0){ hitCooldown = 0.2; kpPress(); } return; }
  if(!fromHold && useConsumable()) return;
  if(!fromHold && doorTarget && (toolKind==='none'||toolKind==='rock') && hitCooldown<=0){ hitCooldown = 0.3; doorToggle(doorTarget); return; }
  if(!fromHold && hitCooldown<=0){ const _h=hotbarSlots[selectedSlot]; if(_h && _h.k==='copter'){ hitCooldown=0.6; placeCopter(); return; } }
  if(buildMode){                                   // план в руке: «Удар» = поставить деталь
    if(!fromHold && hitCooldown<=0){ hitCooldown = 0.35; confirmBuild(); }
    return;
  }
  if(toolKind==='satchel'){ if(!fromHold && hitCooldown<=0 && equipT>=1){ hitCooldown = 0.9; throwSatchel(); } return; }
  if(toolKind==='grenade'){ if(!fromHold && hitCooldown<=0 && equipT>=1){ hitCooldown = 0.9; throwGrenade(); } return; }
  if(toolKind==='rpg'){ if(!fromHold && hitCooldown<=0 && equipT>=1){ hitCooldown = RPG_CD; fireRocket(); } return; }
  if(isGun(toolKind)){ if(hitCooldown>0 || equipT<1) return; if(fromHold && GUNS[toolKind].semi) return; fireGun(); return; }
  if(!hasToolInHand()) return;
  if(hitCooldown>0 || swinging || equipT<1) return;
  if(window.OSIL_NET) OSIL_NET.melee();
  const _hk = toolKind;
  hitCooldown = curSwingDur();
  swingHitFn = ()=>{ hitBuildingRay(_hk, 3.3); applyToolHit(); };
  triggerSwing();
}
function wearTool(k, n){
  const sl = hotbarSlots[selectedSlot];
  if(!sl || sl.k!==k || sl.d===undefined) return;
  sl.d = Math.max(0, sl.d-n);
  if(sl.d <= 0){
    hotbarSlots[selectedSlot] = null;
    showToast(itemLabel(k)+' сломан!');
    OSIL_AUDIO.play('hit_stone',{rate:0.6});
    updateResourceUI();
    setToolMesh('none');
  } else { renderHotbar(); }
}

/* бочка: удар любым инструментом, лут 7–14 металлолома выпадает при разбивании */
function hitBarrel(target){
  if(window.OSIL_NET && OSIL_NET.on && target.nid!=null){
    OSIL_AUDIO.play('hit_stone',{rate:1.5}); camKick=0.03; spawnDebris(lastHitPoint,'scrap',5,0.8);
    OSIL_NET.harvest(target, toolKind, false); return;
  }
  OSIL_AUDIO.play('hit_stone',{rate:1.5}); camKick=0.03;
  spawnDebris(lastHitPoint,'scrap',5,0.8);
  target.health -= 20;
  if(target.health<=0){
    const n = 7 + Math.floor(Math.random()*8);
    giveItem('scrap', n);
    showToast('+'+n+' '+RES_NAMES.scrap);
    debrisAtTarget(target); destroyHarvestable(target);
    OSIL_AUDIO.play('close',{vol:0.6,rate:0.7});
  }
  updateResourceUI();
}
function applyToolHit(){
  const kind = toolKind;
  if(kind==='hammer'){ OSIL_AUDIO.play('chop',{vol:0.5,rate:1.3}); return; }
  if(boarMelee(kind)) return;
  const target = findTargetInReach();
  if(!target){ OSIL_AUDIO.play('empty',{vol:0.35}); return; }   // промах — прочность не тратится
  if(target.type==='carcass'){ carcassHit(target); wearTool(kind,1); return; }
  if(target.type==='scrap'){ hitBarrel(target); wearTool(kind,1); return; }
  if(window.OSIL_NET && OSIL_NET.on && target.nid!=null){        // онлайн: количество, урон узлу и лут считает сервер
    const mult = toolMultiplier(target);
    OSIL_AUDIO.play(target.type==='wood' ? 'chop' : (target.type==='cloth' ? 'hit_tree' : 'hit_stone'));
    camKick = 0.035; hitFx(lastHitPoint, target.type);
    OSIL_NET.harvest(target, kind, false);
    wearTool(kind, mult>=1 ? 1 : 2); return;
  }
  const mult = toolMultiplier(target);
  const dep = isDepNode(target), take = dep ? nodeTake(target) : 0;
  const base = target.giveMin + Math.random()*(target.giveMax-target.giveMin);
  const amount = dep ? Math.max(1, Math.floor(take*mult)) : Math.max(1, Math.floor(base*mult));
  giveItem(ORE_ITEM[target.type]||target.type, amount); notifyGain(ORE_ITEM[target.type]||target.type, amount);
  target.health -= dep ? take : 20*Math.max(0.6, mult);
  OSIL_AUDIO.play(target.type==='wood' ? 'chop' : (target.type==='cloth' ? 'hit_tree' : 'hit_stone'), target.type==='scrap'?{rate:1.4}:undefined);
  camKick = 0.035;
  hitFx(lastHitPoint, target.type);
  if(target.health <= 0){ debrisAtTarget(target); destroyHarvestable(target, true); }
  wearTool(kind, mult>=1 ? 1 : 2);      // неподходящим инструментом изнашивается вдвое быстрее
}

/* ---------------- UI wiring ---------------- */
const _nfBox = (()=>{ const d = document.createElement('div'); d.id = 'notif-feed';
  const st = document.createElement('style'); st.textContent = '#notif-feed{position:fixed;z-index:15;display:flex;flex-direction:column;gap:3px;pointer-events:none;overflow:hidden}'
    +'#notif-feed .nf{flex:0 0 auto;height:21px;line-height:21px;padding:0 8px;background:rgba(92,128,40,.88);border-left:3px solid #b6e063;color:#fff;font:600 12px "Segoe UI",Roboto,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:1;transition:opacity .4s}'
    +'#notif-feed .nf.out{opacity:0}body.ui-open #notif-feed,body.layout-edit #notif-feed{display:none}'; document.head.appendChild(st);
  document.body.appendChild(d); return d; })();
function nfPlace(){      // блок стоит прямо под статистикой; если под ней нет места (она у нижнего края) — над ней
  const hb = document.getElementById('hud-bars'); if(!hb) return; const r = hb.getBoundingClientRect(); if(!r.width) return;
  const H = innerHeight, below = H - r.bottom - 4 >= 96;
  _nfBox.style.left = r.left+'px'; _nfBox.style.width = r.width+'px';
  _nfBox.style.flexDirection = 'column';
  if(below){ _nfBox.style.top = (r.bottom+4)+'px'; _nfBox.style.bottom = 'auto'; }
  else { _nfBox.style.bottom = (H - r.top + 4)+'px'; _nfBox.style.top = 'auto'; }
}
setInterval(nfPlace, 500); addEventListener('resize', nfPlace);
function showToast(msg){
  msg = String(msg == null ? '' : msg); if(!msg) return;
  const m = msg.match(/^\+(\d+)\s+(.+)$/), key = (m ? m[2] : msg).toLowerCase();
  let el = [..._nfBox.children].find(e=>e.dataset.k === key && !e.classList.contains('out'));
  if(el){ if(m){ el.dataset.n = (parseInt(el.dataset.n)||0) + parseInt(m[1]); el.textContent = '+'+el.dataset.n+' '+m[2]; } }
  else { el = document.createElement('div'); el.className = 'nf'; el.dataset.k = key; if(m) el.dataset.n = m[1]; el.textContent = msg; _nfBox.appendChild(el); }   // новые — снизу
  while(_nfBox.children.length > 4) _nfBox.firstChild.remove();                                                                                         // лишние — самые старые (сверху)
  nfPlace();
  clearTimeout(el._h); el.classList.remove('out');
  el._h = setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 420); }, 3000);
}
function notifyGain(k, n){ const d = ITEM_DEFS[k]; if(!d || !(n>0)) return; const nm = d.name || k; showToast('+'+n+' '+nm.charAt(0).toUpperCase()+nm.slice(1)); }

const _statCache = {}, _statEls = {};
function updateStatsUI(){
  const set = (id, v)=>{
    const r = Math.round(v); if(_statCache[id] === r) return; _statCache[id] = r;
    const e = _statEls[id] || (_statEls[id] = {f:document.getElementById('bar-'+id), t:document.getElementById('val-'+id)});
    if(e.f) e.f.style.width = Math.max(0,Math.min(100,v))+'%';
    if(e.t) e.t.textContent = r;
  };
  set('hp', player.hp); set('thirst', player.thirst); set('hunger', player.hunger);
}

/* ---------------- FPS counter ---------------- */
const fpsEl = document.getElementById('fps-counter');
let fpsFrames = 0, fpsLast = performance.now();
function updateFPS(now){
  fpsFrames++;
  if(now - fpsLast >= 500){
    const fps = Math.round(fpsFrames*1000/(now-fpsLast));
    if(fpsEl){
      fpsEl.textContent = fps + ' FPS';
    }
    fpsFrames = 0; fpsLast = now;
    if(CFG.ultra && !document.hidden){          // УЛЬТРА: подстраиваем разрешение так, чтобы держать 60 FPS
      if(fps < 55){ ultraLo++; ultraHi = 0; if(ultraLo >= 2 && CFG.res + ultraDyn > 35){ ultraDyn -= 5; ultraLo = 0; applySetting('res'); } }
      else if(fps >= 59){ ultraHi++; ultraLo = 0; if(ultraHi >= 8 && ultraDyn < 0){ ultraDyn += 5; ultraHi = 0; applySetting('res'); } }
      else { ultraLo = ultraHi = 0; }
    }
  }
}

/* ---------------- Inventory model + hotbar (full drag & drop) ---------------- */
// Every item (resource or crafted tool) is represented uniformly so it can be
// dragged between the inventory grid and the 4 hotbar slots.
/* ---------------- Отрисовка инвентаря (слоты со стаками) ---------------- */
function itemIcon(key){ return ITEM_DEFS[key] ? ITEM_DEFS[key].icon : null; }
function itemLabel(key){ return ITEM_DEFS[key] ? ITEM_DEFS[key].name : key; }
function itemCount(key){ return countItem(key); }

function toolKindForItem(slot){
  const k = slot && slot.k;
  if(k==='rock' || k==='axe' || k==='pickaxe' || k==='rifle' || k==='pistol' || k==='berdanka' || k==='smg' || k==='spear' || k==='knife' || k==='hammer' || k==='satchel' || k==='grenade' || k==='rpg') return k;
  return 'none';
}
function hasToolInHand(){ return toolKind==='rock' || toolKind==='axe' || toolKind==='pickaxe' || toolKind==='spear' || toolKind==='knife' || toolKind==='hammer'; }
function heldSlot(){ return hotbarSlots[selectedSlot]; }

/* Перемещение: пустая цель — перенос; тот же предмет и он стакается — слияние до лимита
   (остаток остаётся в источнике); иначе — обмен местами. */
function moveItem(from, to){
  if(from.t===to.t && from.i===to.i) return false;
  const a = getAt(from), b = getAt(to);
  if(!a) return false;
  const okFor = (loc,it)=> !it || loc.t!=='e' || (EQUIP_ALLOW[loc.i]||[]).includes(it.k);
  if(!okFor(to,a) || !okFor(from,b)){ showToast('Сюда это не надеть'); return false; }
  if(b && b.k===a.k && stackOf(a.k)>1){
    const room = stackOf(a.k)-b.n;
    if(room<=0) { setAt(to,a); setAt(from,b); return true; }   // оба полные — обмен
    const mv = Math.min(room, a.n);
    b.n += mv; a.n -= mv;
    if(a.n<=0) setAt(from,null);
    return true;
  }
  setAt(to, a);
  setAt(from, b || null);
  return true;
}

function slotInnerHTML(slot, withKey, idx){
  let html = withKey ? '<span class="key">'+(idx+1)+'</span>' : '';
  if(slot && slot.n>0){
    const icon = itemIcon(slot.k);
    if(icon) html += '<img src="'+icon+'" alt="" draggable="false">';
    else html += '<span class="nm">'+itemLabel(slot.k)+'</span>';
    if(slot.n>1) html += '<span class="count">'+slot.n+'</span>';
    const f = durFrac(slot);      // полоска прочности — только у инструментов и брони
    if(f!==null) html += '<span class="dur"><i style="width:'+Math.round(f*100)+'%;background:'+(f>0.5?'#8ab63a':(f>0.2?'#e0a12a':'#d0432b'))+'"></i></span>';
  }
  return html;
}

function renderHotbar(){
  const paint = sel => document.querySelectorAll(sel).forEach(el=>{
    const i = parseInt(el.dataset.hb);
    const sl = hotbarSlots[i];
    el.innerHTML = slotInnerHTML(sl, false, i);
    el.classList.toggle('has-item', !!(sl && sl.n>0));
    el.classList.toggle('selected', i===selectedSlot);
  });
  paint('#hotbar .hotslot'); paint('#inv-hotbar .hotslot');
}

function selectSlot(i){
  if(i<0||i>=HOTBAR_N) return;
  selectedSlot = i;
  renderHotbar();
  setToolMesh(toolKindForItem(hotbarSlots[i]));
}

let invSelected = null;      // {t,i} выбранная ячейка для панели описания
function sightToggle(){
  const sl = invSelected ? getAt(invSelected) : null; if(!sl || !SIGHT_GUNS.includes(sl.k)) return;
  if(sl.s){ if(roomFor('holo_sight')<1){ showToast('Нет места в инвентаре'); return; } sl.s=0; addItem('holo_sight',1); }
  else { if(countItem('holo_sight')<1){ showToast('Нет прицела в инвентаре'); return; } removeItem('holo_sight',1); sl.s='holo'; }
  updateResourceUI();
}
window.sightToggle = sightToggle;
let _holoEl=null, _suitEl=null;
function sightFrame(){
  const m = currentToolMesh, sl = hotbarSlots[selectedSlot];
  const want = !!(m && sl && sl.s && SIGHT_GUNS.includes(sl.k));
  if(m && !!m.userData.holo !== want){
    const old = m.getObjectByName('holo'); if(old) m.remove(old);
    m.userData.holo = false;
    if(want){
      const cfg = HOLO_CFG[sl.k] || HOLO_CFG.rifle;
      m.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(m.matrixWorld).invert(), mm = new THREE.Matrix4(), bb = new THREE.Box3();
      let top = -1e9;                                 // высота верха оружия в точке крепления
      m.traverse(o=>{ if(o.isMesh && o.geometry && o.name!=='holo'){ o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox).applyMatrix4(mm.multiplyMatrices(inv,o.matrixWorld));
        if(bb.min.z<=cfg.z+0.012 && bb.max.z>=cfg.z-0.012 && bb.min.x<=0.012 && bb.max.x>=-0.012 && bb.max.y<cfg.maxY) top = Math.max(top, bb.max.y); } });
      if(top < -1e8) top = cfg.y;
      const k = cfg.k, s = OSIL_TOOLS.makeHoloSight();
      s.scale.setScalar(k); s.position.set(0, top, cfg.z);
      m.add(s); m.userData.holo = true;
      m.userData.holoCenter = s.userData.windowCenter.clone().multiplyScalar(k).add(s.position);
    }
  }
  if(!_holoEl){ _holoEl=document.createElement('div'); _holoEl.style.cssText='position:fixed;left:50%;top:50%;width:7px;height:7px;margin:-3.5px 0 0 -3.5px;border-radius:50%;background:#ff2a2a;box-shadow:0 0 8px 3px rgba(255,40,40,.7);pointer-events:none;z-index:6;display:none'; document.body.appendChild(_holoEl); }
  _holoEl.style.display = 'none';
  if(!_suitEl){ _suitEl=document.createElement('div'); _suitEl.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:4;display:none;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 52%,rgba(8,10,8,.78) 100%);box-shadow:inset 0 0 0 10px rgba(12,14,12,.9)'; document.body.appendChild(_suitEl); }
  _suitEl.style.display = (suitWorn() && !document.body.classList.contains('ui-open')) ? 'block' : 'none';
}
function renderInvDetail(){
  const d = document.getElementById('inv-detail');
  if(!d) return;
  const sl = invSelected ? getAt(invSelected) : null;
  if(!sl || sl.n<=0){ d.innerHTML = '<div class="idt-empty">Выберите предмет</div>'; return; }
  const def = ITEM_DEFS[sl.k]; const icon = def.icon;
  let info;
  if(durable(sl.k)) info = 'Прочность '+sl.d+'/'+TOOL_MAX_DUR[sl.k];
  else if(def.stack>1) info = sl.n+' / '+def.stack;
  else info = 'x1';
  let extra='';
  if(def.eat) extra = '<div class="idt-sub">+'+def.eat.hunger+' сытость'+(def.eat.hp?', +'+def.eat.hp+' HP':'')+'</div>';
  if(SIGHT_GUNS.includes(sl.k)){
    const has = !!sl.s, can = countItem('holo_sight')>0;
    extra += '<div class="idt-sub">Прицел: '+(has?'голографический':'нет')+'</div>'+
      '<button onclick="sightToggle()" style="margin-top:6px;width:100%;padding:7px 8px;border:1px solid #9db07a;background:'+((has||can)?'rgba(96,130,50,.95)':'rgba(70,68,62,.9)')+';color:#fff;font:600 12px var(--rf,sans-serif);letter-spacing:.8px">'+(has?'СНЯТЬ ПРИЦЕЛ':(can?'УСТАНОВИТЬ ПРИЦЕЛ':'НЕТ ПРИЦЕЛА'))+'</button>';
  }
  if(sl.k==='eod_suit') extra += '<div class="idt-sub">Урон −75% · бег запрещён · описание: тяжёлая сапёрная броня со шлемом</div>';
  if(sl.k==='holo_sight') extra += '<div class="idt-sub">Выберите оружие в инвентаре и нажмите «Установить прицел»</div>';
  d.innerHTML =
    '<div class="idt-head">'+def.name+'</div>'+
    '<div class="idt-body">'+(icon?'<img src="'+icon+'" alt="">':'')+'<div class="idt-cnt">'+info+'</div></div>'+extra+
    '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'+
      '<button style="flex:1;padding:7px 8px;border:1px solid #9db07a;background:rgba(34,33,31,.92);color:#fff;font:600 12px var(--rf,sans-serif);letter-spacing:.8px" onclick="window.OSIL_NET&&OSIL_NET.drop(0)">'+((def.stack>1 && sl.n>1)?'ВЫБРОСИТЬ 1':'ВЫБРОСИТЬ')+'</button>'+
      ((def.stack>1 && sl.n>1)?'<button style="flex:1;padding:7px 8px;border:1px solid #9db07a;background:rgba(34,33,31,.92);color:#fff;font:600 12px var(--rf,sans-serif);letter-spacing:.8px" onclick="window.OSIL_NET&&OSIL_NET.drop(1)">ВЫБРОСИТЬ ВСЁ</button>':'')+
    '</div>';
}
function renderQuickCraft(){
  const box = document.getElementById('quick-craft');
  if(!box) return;
  box.innerHTML='';
  recentCrafts.map(id=>CRAFT_RECIPES.find(r=>r.id===id)).filter(r=>r && r.quick!==false).forEach(r=>{
    const ok = canCraft(r,1);
    const el = document.createElement('div');
    el.className = 'qc-slot' + (ok?'':' lack');
    el.title = r.name;
    el.dataset.recipe = r.id;
    el.innerHTML = '<img src="'+r.icon+'" alt="">' +
      '<span class="qc-cost">'+Object.keys(r.cost).map(k=>r.cost[k]+' '+(RES_NAMES[k]||k)).join(', ')+'</span>';
    box.appendChild(el);
  });
}

/* Состояние перетаскивания — объявлено заранее, им пользуется updateResourceUI */
let dragState = null;
let dragPending = null;

(function(){
  const box = document.getElementById('quick-craft');
  if(!box) return;
  box.addEventListener('click', e=>{
    const el = e.target.closest('.qc-slot');
    if(el && el.dataset.recipe) craftItem(el.dataset.recipe, 1);
  });
})();

function renderInvGrid(){
  const grid = document.getElementById('inv-grid');
  const scrollTop = grid.scrollTop;
  const frag = document.createDocumentFragment();
  for(let i=0;i<GRID_N;i++){
    const sl = gridSlots[i];
    const has = !!(sl && sl.n>0);
    const slot = document.createElement('div');
    const picked = invSelected && invSelected.t==='g' && invSelected.i===i && has;
    slot.className = 'inv-slot' + (has?' has-item':'') + (picked?' picked':'');
    slot.dataset.gi = i;
    slot.innerHTML = has ? slotInnerHTML(sl,false,0) : '';
    frag.appendChild(slot);
  }
  grid.innerHTML='';
  grid.appendChild(frag);
  grid.scrollTop = scrollTop;
}

/* Проверка модели: инструмент в руке мог исчезнуть/измениться после перемещения */
function refreshHeld(){
  const want = toolKindForItem(hotbarSlots[selectedSlot]);
  if(want !== toolKind) setToolMesh(want);
}

function renderEquip(){
  document.querySelectorAll('#inv-paperdoll .eq-slot').forEach(el=>{
    const sl = equip[el.dataset.eq], has = !!(sl && sl.n>0);
    el.classList.toggle('has-item', has);
    el.innerHTML = has ? slotInnerHTML(sl,false,0) : '<span class="eq-name">'+el.dataset.name+'</span>';
  });
}
function updateResourceUI(){
  if(dragState) return;
  renderEquip();
  renderInvGrid();
  renderHotbar();
  renderInvDetail();
  renderQuickCraft();
  refreshHeld();
  updateAmmoHud();
}
updateResourceUI();

/* =========================================================================
   DRAG & DROP (pointer events, мышь + тач)
   — Пояс в игре тоже перетаскивается (как в Rust: перенос между поясом и
     инвентарём, пока открыт инвентарь; вне инвентаря — только тап = выбор слота).
   — Тач: перетаскивание начинается после короткого удержания (или заметного
     сдвига ПО ГОРИЗОНТАЛИ/ВНЕ сетки); быстрый вертикальный свайп по сетке
     прокручивает её.
   — Указатель НЕ захватывается (setPointerCapture убран): он ломал определение
     цели под пальцем и блокировал прокрутку.
   ========================================================================= */
const dragGhost = document.getElementById('drag-ghost');
const dragGhostImg = dragGhost.querySelector('img');
const DRAG_THRESHOLD_MOUSE = 4;
const DRAG_HOLD_MS = 180;         // удержание для начала переноса пальцем
const DRAG_SLOP_TOUCH = 10;       // допуск дрожания пальца при удержании

function invIsOpen(){ return document.getElementById('inv-panel').classList.contains('show'); }

/* слот под точкой → {t,i,el} или null. Ищем только реальные слоты инвентаря/пояса. */
function slotAtPoint(x,y){
  const t = document.elementFromPoint(x,y);
  if(!t || !t.closest) return null;
  const g = t.closest('#inv-grid .inv-slot');
  if(g) return {t:'g', i:parseInt(g.dataset.gi), el:g};
  const h = t.closest('#inv-hotbar .hotslot');
  if(h) return {t:'h', i:parseInt(h.dataset.hb), el:h};
  const q = t.closest('#inv-paperdoll .eq-slot');
  if(q) return {t:'e', i:q.dataset.eq, el:q};
  return null;
}
/* слот-источник под точкой (включая HUD-пояс, если инвентарь открыт — он всё равно под панелью) */
function sourceAtPoint(x,y){
  const t = document.elementFromPoint(x,y);
  if(!t || !t.closest) return null;
  const g = t.closest('#inv-grid .inv-slot');
  if(g){ const i=parseInt(g.dataset.gi); return {t:'g', i, el:g}; }
  const h = t.closest('#inv-hotbar .hotslot');
  if(h){ const i=parseInt(h.dataset.hb); return {t:'h', i, el:h}; }
  const q = t.closest('#inv-paperdoll .eq-slot');
  if(q) return {t:'e', i:q.dataset.eq, el:q};
  return null;
}
function clearDragOver(){
  document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
}
function placeGhost(x,y){
  dragGhost.style.transform = 'translate('+(x-26)+'px,'+(y-26)+'px)';
}

function beginDrag(x,y){
  if(!dragPending) return;
  dragState = dragPending; dragPending = null;
  dragState.el.classList.add('dragging');
  document.body.classList.add('is-dragging');
  dragGhostImg.src = itemIcon(dragState.key) || '';
  dragGhostImg.style.visibility = itemIcon(dragState.key) ? 'visible' : 'hidden';
  dragGhost.style.display = 'block';
  placeGhost(x,y);
}
function cancelPending(){
  if(dragPending){ clearTimeout(dragPending.timer); dragPending = null; }
}

function finishDrag(x,y,cancel){
  cancelPending();
  if(!dragState) return;
  const st = dragState; dragState = null;
  document.body.classList.remove('is-dragging');
  clearDragOver();
  st.el.classList.remove('dragging');
  dragGhost.style.display = 'none';
  if(!cancel){
    const tgt = slotAtPoint(x,y);
    if(tgt){
      if(moveItem(st.from, {t:tgt.t, i:tgt.i})){
        if(tgt.t==='h') showToast(itemLabel(st.key)+' → слот '+(tgt.i+1));
      }
    } else if(st.from.t!=='g'){
      // бросили мимо слотов — возвращаем в первую свободную ячейку сетки
      const free = gridSlots.indexOf(null);
      if(free>=0){ gridSlots[free]=getAt(st.from); setAt(st.from,null); }
    }
  }
  updateResourceUI();
  refreshHeld();
}

document.addEventListener('pointerdown', e=>{
  if(e.pointerType==='mouse' && e.button>0) return;
  if(dragState || dragPending) return;                  // второй палец не мешает переносу
  const src = sourceAtPoint(e.clientX, e.clientY);
  if(!src) return;
  const slot = getAt(src);
  // выбор предмета для панели описания
  if(src.t==='g'){
    invSelected = slot ? {t:'g', i:src.i} : null;
    renderInvDetail();
    document.querySelectorAll('#inv-grid .inv-slot').forEach(x=>x.classList.toggle('picked', x===src.el && !!slot));
  }
  if(!slot || slot.n<=0) return;
  const key = slot.k;
  dragPending = {
    from:{t:src.t, i:src.i}, key, el:src.el,
    x:e.clientX, y:e.clientY, pid:e.pointerId, type:e.pointerType, timer:null
  };
  if(e.pointerType!=='mouse'){
    // палец: перенос стартует после короткого удержания
    dragPending.timer = setTimeout(()=>{
      if(dragPending) beginDrag(dragPending.x, dragPending.y);
    }, DRAG_HOLD_MS);
  }
});

document.addEventListener('pointermove', e=>{
  if(dragPending && e.pointerId===dragPending.pid){
    const dx = e.clientX-dragPending.x, dy = e.clientY-dragPending.y;
    const dist = Math.hypot(dx,dy);
    if(dragPending.type==='mouse'){
      if(dist >= DRAG_THRESHOLD_MOUSE) beginDrag(e.clientX, e.clientY);
    } else if(dist > DRAG_SLOP_TOUCH){
      // палец сдвинулся до срабатывания удержания:
      //  • из пояса — сразу перенос (пояс не скроллится);
      //  • из сетки вертикальный свайп — это прокрутка, отменяем перенос;
      //  • из сетки горизонтальный — перенос.
      if(dragPending.from.t==='h' || Math.abs(dx) > Math.abs(dy)*1.2) beginDrag(e.clientX, e.clientY);
      else cancelPending();
    }
  }
  if(!dragState || e.pointerId!==dragState.pid) return;
  e.preventDefault();
  placeGhost(e.clientX, e.clientY);
  clearDragOver();
  const tgt = slotAtPoint(e.clientX, e.clientY);
  if(tgt) tgt.el.classList.add('drag-over');
}, {passive:false});

document.addEventListener('pointerup', e=>{
  if(dragState){ if(e.pointerId===dragState.pid) finishDrag(e.clientX, e.clientY, false); }
  else cancelPending();
});
document.addEventListener('pointercancel', e=>{
  if(dragState){ if(e.pointerId===dragState.pid) finishDrag(e.clientX, e.clientY, true); }
  else cancelPending();
});
// Пока идёт перенос — гасим прокрутку и жесты браузера
document.addEventListener('touchmove', e=>{
  if(dragState) e.preventDefault();
}, {passive:false});
// Блокируем нативный HTML5 drag картинок и контекстное меню долгого нажатия
document.addEventListener('dragstart', e=>{ if(e.target.closest && e.target.closest('#inv-panel, #hotbar')) e.preventDefault(); });
document.addEventListener('contextmenu', e=>{ if(e.target.closest && e.target.closest('#inv-panel')) e.preventDefault(); });

/* Тап по слоту хотбара (без перетаскивания) выбирает его */
/* click при втором пальце (джойстик зажат) браузер не присылает — берём pointerdown */
let hbTapT = 0;
document.getElementById('hotbar').addEventListener('pointerdown', e=>{
  if(e.pointerType==='mouse' && e.button>0) return;
  const el = e.target.closest('.hotslot');
  if(el){ hbTapT = performance.now(); selectSlot(parseInt(el.dataset.hb)); }
});
document.getElementById('hotbar').addEventListener('click', e=>{
  if(performance.now()-hbTapT < 800) return;
  const el = e.target.closest('.hotslot');
  if(el) selectSlot(parseInt(el.dataset.hb));
});
/* Тап по слоту пояса в инвентаре тоже выбирает его */
document.getElementById('inv-hotbar').addEventListener('click', e=>{
  const el = e.target.closest('.hotslot');
  if(el) selectSlot(parseInt(el.dataset.hb));
});

/* Inventory panel toggle */
/* FPS и остальной HUD прячем, пока открыт инвентарь или крафт */
function updateFpsVisibility(){
  const open = panelsOpen();
  document.body.classList.toggle('ui-open', !!open);      // прячет весь игровой HUD (CSS)
  document.getElementById('fps-counter').style.display = (open || !CFG.fps) ? 'none' : '';
}
/* Защита от случайного закрытия: кнопка открытия и «✕» стоят в одном месте экрана,
   поэтому тап, открывший панель, не должен тут же попасть по «✕». */
let uiOpenedAt = 0, lastPtrTs = 0;
const UI_GUARD_MS = 600;
/* время последнего касания берём по метке самого события (а не по моменту обработки), чтобы
   защита работала и когда кадр тормозит */
document.addEventListener('pointerdown', e=>{ lastPtrTs = e.timeStamp; }, true);
function markOpened(){ uiOpenedAt = (performance.now()-lastPtrTs < 1500 && lastPtrTs) ? lastPtrTs : performance.now(); }
function guardedClose(fn){ return function(e){
  const t = (e && e.timeStamp) ? e.timeStamp : performance.now();
  if(t - uiOpenedAt < UI_GUARD_MS){ if(e&&e.preventDefault) e.preventDefault(); return; }
  fn(e);
}; }
/* ПК: пока открыт инвентарь/крафт, курсор должен быть свободен (иначе clientX/Y
   заморожены в pointer lock и мышь в панели не работает). При закрытии — захватываем снова. */
function syncPointerLock(){
  if(isMobile() || layoutEditing) return;
  const open = panelsOpen();
  if(open){
    if(document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  } else {
    if(renderer.domElement.requestPointerLock && !document.pointerLockElement){
      try{ const r = renderer.domElement.requestPointerLock(); if(r && r.catch) r.catch(()=>{}); }catch(_){}
    }
  }
}
function toggleInventory(){
  closeWorldPanels();
  if(mapOpen) toggleMap(false);
  document.getElementById('craft-panel').classList.remove('show');
  document.getElementById('inv-panel').classList.toggle('show');
  window.OSIL_AUDIO&&OSIL_AUDIO.play(document.getElementById('inv-panel').classList.contains('show')?'inventory_open':'close');
  if(document.getElementById('inv-panel').classList.contains('show')){ markOpened(); updateResourceUI(); }
  updateFpsVisibility();
  syncPointerLock();
}
function toggleCraft(){
  closeWorldPanels();
  if(mapOpen) toggleMap(false);
  document.getElementById('inv-panel').classList.remove('show');
  document.getElementById('craft-panel').classList.toggle('show');
  window.OSIL_AUDIO&&OSIL_AUDIO.play(document.getElementById('craft-panel').classList.contains('show')?'open':'close');
  if(document.getElementById('craft-panel').classList.contains('show')){ markOpened(); renderCraftUI(); }
  updateFpsVisibility();
  syncPointerLock();
}
function fastTap(el, fn){
  let t = 0;
  el.addEventListener('pointerdown', e=>{ if(e.pointerType==='mouse' && e.button>0) return; t = performance.now(); fn(e); });
  el.addEventListener('click', e=>{ if(performance.now()-t < 800) return; fn(e); });
}
fastTap(document.getElementById('btn-inv'), toggleInventory);
fastTap(document.getElementById('btn-craft'), toggleCraft);
document.getElementById('close-inv').addEventListener('click', guardedClose(toggleInventory));
document.getElementById('close-craft').addEventListener('click', guardedClose(toggleCraft));

/* ---------------- Пауза ---------------- */
let gamePaused = false;
function setPause(on){
  const mp = !!(window.OSIL_NET && OSIL_NET.on);
  if(mp){ document.getElementById('pause-menu').classList.toggle('hidden', !on); if(on){ closeWorldPanels(); attackHeld=false; for(const k in keys) keys[k]=false; } updateFpsVisibility(); syncPointerLock(); return; }   // сетевая игра: мир не замирает
  if(on === gamePaused) return;
  gamePaused = on;
  document.getElementById('pause-menu').classList.toggle('hidden', !on);
  if(on){
    closeWorldPanels();
    ['inv-panel','craft-panel'].forEach(id=>document.getElementById(id).classList.remove('show'));
    if(mapOpen) toggleMap(false);
    attackHeld = false; for(const k in keys) keys[k] = false;
  }
  window.OSIL_AUDIO && OSIL_AUDIO.play(on ? 'open' : 'close');
  updateFpsVisibility(); syncPointerLock();
}
fastTap(document.getElementById('btn-pause'), ()=>setPause(true));
document.getElementById('pm-resume').addEventListener('click', ()=>setPause(false));
document.getElementById('pm-map').addEventListener('click', ()=>{ setPause(false); toggleMap(true); });
document.getElementById('pm-settings').addEventListener('click', ()=>OSIL_SETTINGS.open());
document.getElementById('pm-exit').addEventListener('click', ()=>{
  setPause(false);
  const ss = document.getElementById('start-screen');
  ss.classList.remove('hidden'); ss.style.display = '';
  if(document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
});

/* ---------------- Расположение управления (перетаскивание) ---------------- */
const LAYOUT_KEY = 'osil_layout_v1';
const LAYOUT_IDS = ['btn-inspect','btn-hit','btn-aim','btn-reload','btn-jump','btn-run','btn-crouch','btn-inv','btn-craft','btn-map','btn-pause','ammo-hud','hotbar','hud-bars','minimap','fps-counter'];
let layoutData = {};
try{ layoutData = JSON.parse(localStorage.getItem(LAYOUT_KEY)||'{}') || {}; }catch(e){ layoutData = {}; }
function saveLayout(){ try{ localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutData)); }catch(e){} }
/* смещения храним долями экрана и применяем свойством translate — оно не мешает
   исходной привязке элементов (right/bottom/transform) и переживает поворот/ресайз */
function applyLayout(){
  LAYOUT_IDS.forEach(id=>{
    const el = document.getElementById(id); if(!el) return;
    const o = layoutData[id];
    el.style.translate = o ? Math.round(o[0]*window.innerWidth)+'px '+Math.round(o[1]*window.innerHeight)+'px' : '';
  });
}
applyLayout();
window.addEventListener('resize', applyLayout);

const loBar = document.createElement('div');
loBar.id = 'layout-bar'; loBar.className = 'hidden';
loBar.innerHTML = '<div class="lo-t">Перетащите кнопки и панели на нужные места</div><div class="lo-b"><button id="lo-copy">КОПИРОВАТЬ</button><button id="lo-reset">СБРОСИТЬ</button><button id="lo-done">ГОТОВО</button></div>';
document.body.appendChild(loBar);
let loDrag = null;
function layoutTarget(t){ return LAYOUT_IDS.map(id=>document.getElementById(id)).find(el=>el && el.contains(t)) || null; }
function loHandler(e){
  if(!layoutEditing) return;
  if(e.target && e.target.closest && e.target.closest('#layout-bar')) return;   // кнопки самой панели работают
  e.stopPropagation();                                                          // игровые обработчики не должны срабатывать
  if(e.cancelable) e.preventDefault();
  if(e.type==='pointerdown' && !loDrag){
    const el = layoutTarget(e.target); if(!el) return;
    const r = el.getBoundingClientRect(), cur = layoutData[el.id] || [0,0];
    loDrag = {el, pid:e.pointerId, sx:e.clientX, sy:e.clientY, ox:cur[0]*window.innerWidth, oy:cur[1]*window.innerHeight, r};
    try{ el.setPointerCapture(e.pointerId); }catch(_){}
  } else if(e.type==='pointermove' && loDrag && e.pointerId===loDrag.pid){
    const d = loDrag, W = window.innerWidth, H = window.innerHeight;
    const dx = Math.max(-d.r.left, Math.min(W-d.r.right,  e.clientX-d.sx));
    const dy = Math.max(-d.r.top,  Math.min(H-d.r.bottom, e.clientY-d.sy));
    d.el.style.translate = Math.round(d.ox+dx)+'px '+Math.round(d.oy+dy)+'px';
    layoutData[d.el.id] = [(d.ox+dx)/W, (d.oy+dy)/H];
  } else if((e.type==='pointerup' || e.type==='pointercancel') && loDrag && e.pointerId===loDrag.pid){
    try{ loDrag.el.releasePointerCapture(e.pointerId); }catch(_){}
    loDrag = null; saveLayout();
  }
}
['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel','mousedown','mouseup','click','contextmenu']
  .forEach(n=>window.addEventListener(n, loHandler, {capture:true, passive:false}));

function startLayout(){
  if(!document.getElementById('start-screen').classList.contains('hidden')) return false;   // только в игре
  OSIL_SETTINGS.close();
  layoutEditing = true; loDrag = null;
  document.getElementById('pause-menu').classList.add('hidden');
  document.body.classList.add('layout-edit'); loBar.classList.remove('hidden');
  if(document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  updateFpsVisibility();
  return true;
}
function endLayout(){
  layoutEditing = false; loDrag = null; saveLayout();
  document.body.classList.remove('layout-edit'); loBar.classList.add('hidden');
  document.getElementById('pause-menu').classList.remove('hidden');
  updateFpsVisibility();
}
/* раскладка «как на фото»: центры элементов в долях экрана 960×449 */
const PHOTO_LAYOUT = {'btn-pause':[689,40],'btn-map':[766,40],'btn-craft':[843,40],'btn-inv':[920,40],'btn-run':[771,222],'btn-jump':[802,329],'btn-crouch':[876,396],
  'hud-bars':[108,47],'hotbar':[480,413],'fps-counter':[232,14],'minimap':[262,74],'btn-hit':[722,329],'btn-aim':[640,300],'btn-reload':[640,230],'ammo-hud':[737,419]};
function applyPhotoLayout(){
  const W = window.innerWidth, H = window.innerHeight; layoutData = {};
  const hadGun = document.body.classList.contains('has-gun'); document.body.classList.add('has-gun');
  const ah = document.getElementById('ammo-hud'), ahd = ah ? ah.style.display : ''; if(ah) ah.style.display = 'flex';
  LAYOUT_IDS.forEach(id=>{ const el = document.getElementById(id); if(el) el.style.translate = ''; });
  Object.keys(PHOTO_LAYOUT).forEach(id=>{
    const el = document.getElementById(id); if(!el) return; const r = el.getBoundingClientRect(); if(!r.width) return;
    const tx = PHOTO_LAYOUT[id][0]/960*W, ty = PHOTO_LAYOUT[id][1]/449*H;
    layoutData[id] = [(tx-(r.left+r.width/2))/W, (ty-(r.top+r.height/2))/H];
  });
  if(!hadGun) document.body.classList.remove('has-gun'); if(ah) ah.style.display = ahd;
  saveLayout(); applyLayout();
}
function resetLayout(){ applyPhotoLayout(); }
try{ if(!localStorage.getItem(LAYOUT_KEY)) setTimeout(applyPhotoLayout, 300); }catch(e){}
document.getElementById('lo-done').addEventListener('click', endLayout);
document.getElementById('lo-reset').addEventListener('click', resetLayout);

/* копирование координат всех элементов управления и HUD, что сейчас видны на экране */
const COPY_IDS = LAYOUT_IDS.concat(['btn-run','crosshair','joystick-base','joystick-knob','joystick-zone','look-zone','hud-bars','toast']);
function collectCoords(){
  const W = window.innerWidth, H = window.innerHeight, out = {screen:{w:W,h:H,dpr:window.devicePixelRatio||1}, elements:{}};
  const seen = new Set();
  COPY_IDS.forEach(id=>{
    if(seen.has(id)) return; seen.add(id);
    const el = document.getElementById(id); if(!el) return;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if(cs.display==='none' || cs.visibility==='hidden' || (r.width===0 && r.height===0)) return;
    const o = layoutData[id];
    out.elements[id] = {
      x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height),
      right:Math.round(W-r.right), bottom:Math.round(H-r.bottom),
      cx:Math.round(r.left+r.width/2), cy:Math.round(r.top+r.height/2),
      pct:{x:+(r.left/W*100).toFixed(2), y:+(r.top/H*100).toFixed(2), w:+(r.width/W*100).toFixed(2), h:+(r.height/H*100).toFixed(2)},
      shift:o ? {x:Math.round(o[0]*W), y:Math.round(o[1]*H)} : {x:0,y:0}
    };
  });
  return out;
}
function copyCoords(){
  const txt = JSON.stringify(collectCoords(), null, 2);
  const done = ok=>{ try{ showToast(ok ? 'Координаты скопированы' : 'Не удалось скопировать'); }catch(e){} };
  const fallback = ()=>{
    try{ const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select(); const ok = document.execCommand('copy'); ta.remove(); done(ok); }catch(e){ done(false); }
  };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(()=>done(true), fallback); else fallback();
  return txt;
}
{ const _lc = document.getElementById('lo-copy'); if(_lc) _lc.addEventListener('click', copyCoords); }
window.OSIL_LAYOUT = { start:startLayout, reset:resetLayout, copy:copyCoords };

window.addEventListener('keydown', e=>{
  if(e.code==='Escape' && layoutEditing){ endLayout(); return; }
  if(e.code==='Escape' && document.getElementById('start-screen').classList.contains('hidden')){
    if(panelsOpen() && !pauseOpen()){ /* панели закрываются своими кнопками */ }
    else setPause(!gamePaused);
  }
});


/* HUD плана: тап по детали выбирает тип */
document.getElementById('build-types').addEventListener('click', e=>{
  const el = e.target.closest('.bt-item'); if(!el) return;
  currentBuildType = el.dataset.bt; updateBuildHud();
});
document.getElementById('build-next').addEventListener('click', ()=>cycleBuildType(1));

/* Crouch toggle */
const STAND_HEIGHT = player.height;
const CROUCH_HEIGHT = STAND_HEIGHT * 0.6;
function setCrouch(state){
  isCrouching = state;
  player.height = isCrouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  document.getElementById('btn-crouch').classList.toggle('active', isCrouching);
}
function toggleCrouch(){ if(copter.pilot) return; setCrouch(!isCrouching); }
document.getElementById('btn-crouch').addEventListener('click', toggleCrouch);
document.getElementById('btn-crouch').addEventListener('touchstart', e=>{ e.preventDefault(); toggleCrouch(); });

selectSlot(1);

/* =========================================================================
   КАРТА (как в Rust): кнопка в HUD открывает большую карту с биомами, озёрами и морем.
   Базовая картинка рисуется ОДИН раз из данных генератора (с затенением по рельефу),
   поверх каждый кадр — сетка, метки, игрок и направление взгляда.
   ========================================================================= */
const MAP_COLORS = {
  [B.DEEP]:[26,52,84], [B.SEA]:[40,92,128], [B.BEACH]:[196,178,131], [B.DESERT]:[242,206,124],
  [B.PLAIN]:[112,148,68], [B.FOREST]:[92,128,58], [B.SNOW]:[250,252,255], [B.LAKE]:[58,118,150], [B.ROCK]:[128,124,116], [B.ROAD]:[62,62,66]
};
const BIOME_LABEL = {
  [B.DEEP]:'Глубокое море', [B.SEA]:'Море', [B.BEACH]:'Пляж', [B.DESERT]:'Пустыня',
  [B.PLAIN]:'Равнина', [B.FOREST]:'Лес', [B.SNOW]:'Снежный биом', [B.LAKE]:'Озеро', [B.ROCK]:'Скалы', [B.ROAD]:'Дорога'
};
let mapBase = null;   // offscreen canvas MB×MB: рельеф с затенением, береговая линия чёткая на любом зуме
function buildMapBase(){
  const MB = 1536, c = document.createElement('canvas'); c.width = c.height = MB;
  const g = c.getContext('2d'), img = g.createImageData(MB,MB), d = img.data;
  const CR = new Float32Array(WN*WN), CG = new Float32Array(WN*WN), CB = new Float32Array(WN*WN);
  for(let k=0;k<WN*WN;k++){                       // цвет клетки; вода/пляж → цвет пляжа, чтобы у берега не мешалась вода
    const bi = WG.biome[k], col = MAP_COLORS[(bi===B.SEA||bi===B.DEEP||bi===B.LAKE) ? B.BEACH : bi];
    CR[k]=col[0]; CG[k]=col[1]; CB[k]=col[2];
  }
  for(let pass=0;pass<4;pass++) for(const A of [CR,CG,CB]){ const T=A.slice(); for(let j=1;j<WN-1;j++) for(let i=1;i<WN-1;i++){ let s=0; for(let dj=-1;dj<=1;dj++) for(let di=-1;di<=1;di++) s+=T[(j+dj)*WN+i+di]; A[j*WN+i]=s/9; } }   // мягкие границы биомов
  const sm = (a,b,t)=>{ t=Math.max(0,Math.min(1,(t-a)/(b-a))); return t*t*(3-2*t); };
  const bc = MAP_COLORS[B.BEACH];
  for(let j=0;j<MB;j++) for(let i=0;i<MB;i++){
    const x=(i/(MB-1)-0.5)*WORLD_SIZE, z=(j/(MB-1)-0.5)*WORLD_SIZE, e=wgSample(WG.h,x,z);
    let r,gg,bb;
    const land = sm(-0.12,0.12,e);
    const t = Math.min(1,Math.max(0,-e/6));           // море: мелко светлее, глубже темнее
    const sr=58+(26-58)*t, sg=118+(52-118)*t, sb=150+(84-150)*t;
    if(land>0){
      let lr=wgSample(CR,x,z), lg=wgSample(CG,x,z), lb=wgSample(CB,x,z);
      const beach = 1-sm(0.5,1.1,e);                  // светлая полоса берега
      lr+= (bc[0]-lr)*beach; lg+=(bc[1]-lg)*beach; lb+=(bc[2]-lb)*beach;
      const dx = wgSample(WG.h,x+7,z)-wgSample(WG.h,x-7,z), dz = wgSample(WG.h,x,z+7)-wgSample(WG.h,x,z-7);
      const sh = Math.max(0.74, Math.min(1.26, 1 - (dx+dz)*0.05));   // свет с северо-запада
      lr*=sh; lg*=sh; lb*=sh;
      if(e>0.6){                                                       // изолинии рельефа каждые 4 м
        const gm = Math.max(0.03, Math.hypot(dx,dz)/14), dist = Math.abs(((e/4)%1+1)%1-0.5), dm = (0.5-dist)*4/gm/(WORLD_SIZE/MB);
        const ca = (1-sm(0.35,1.0,dm))*0.16; lr*=1-ca; lg*=1-ca; lb*=1-ca;
      }
      r=lr*land+sr*(1-land); gg=lg*land+sg*(1-land); bb=lb*land+sb*(1-land);
      const sho = 1-sm(0.02,0.16,Math.abs(e)); if(sho>0){ r+=(30-r)*sho*0.55; gg+=(62-gg)*sho*0.55; bb+=(74-bb)*sho*0.55; }   // тёмная кромка берега
    } else { r=sr; gg=sg; bb=sb; }
    const o=(j*MB+i)*4; d[o]=r; d[o+1]=gg; d[o+2]=bb; d[o+3]=255;
  }
  g.putImageData(img,0,0);
  { const px=x=>(x/WORLD_SIZE+0.5)*MB, pz=z=>(z/WORLD_SIZE+0.5)*MB;
    for(const [wd,col] of [[19,'#2a2a2c'],[13,'#cfc6b4']]){ g.strokeStyle=col; g.lineWidth=wd; g.lineCap='round'; g.lineJoin='round'; g.beginPath();
      for(let x=-108;x<=108;x+=3){ const X=px(x), Z=pz(roadZ(x)); x===-108?g.moveTo(X,Z):g.lineTo(X,Z); } g.stroke(); } }
  mapBase = c;
}

const mapPanel = document.getElementById('map-panel');
const mapCanvas = document.getElementById('map-canvas');
const mapCtx = mapCanvas.getContext('2d');
const miniCanvas = document.getElementById('minimap');
const miniCtx = miniCanvas.getContext('2d');
const worldToMapU = (x)=> (x/WORLD_SIZE + 0.5);
const worldToMapV = (z)=> (z/WORLD_SIZE + 0.5);
let mapOpen = false;
const mapMarks = [];      // пользовательские метки {x,z}
let lastDeath = null; try{ localStorage.removeItem('latest_lastDeath'); }catch(e){}   // старые смерти не хранятся
function deathAlive(){ if(lastDeath && ((lastDeath.sid && !sacks.has(lastDeath.sid)) || Date.now()-lastDeath.t > 900000)) lastDeath = null; return !!lastDeath; }   // метка исчезает, когда мешок забрали/он пропал

const MAP_SEA_BG = '#1a3a5c';
let mapView = {z:1, x:0, y:0}, mapW = 0, mapH = 0, mapDpr = 1;
const mapSide = ()=> Math.min(mapW, mapH);
function clampMapView(){
  const s = mapSide()*mapView.z;
  mapView.x = s<=mapW ? Math.max(0,Math.min(mapW-s,mapView.x)) : Math.max(mapW-s,Math.min(0,mapView.x));
  mapView.y = s<=mapH ? Math.max(0,Math.min(mapH-s,mapView.y)) : Math.max(mapH-s,Math.min(0,mapView.y));
}
function sizeMapCanvas(){
  mapDpr = Math.min(window.devicePixelRatio||1, 3);
  mapW = window.innerWidth; mapH = window.innerHeight;
  mapCanvas.style.width = mapW+'px'; mapCanvas.style.height = mapH+'px';
  mapCanvas.width = Math.floor(mapW*mapDpr); mapCanvas.height = Math.floor(mapH*mapDpr);
  const s = mapSide()*mapView.z; mapView.x = (mapW-s)/2; mapView.y = (mapH-s)/2; clampMapView();
}
function drawGridAndLabels(g, ox, oy, s){
  // сетка 10×10: буквы A–J по X, цифры 1–10 по Z; подпись (A1, B1…) в каждой клетке
  const n = 10, cell = s/n;
  g.save();   // линии сетки убраны, остались только подписи клеток
  g.fillStyle='rgba(255,255,255,.55)'; g.font=Math.max(8,Math.min(13,cell*0.25))+'px Segoe UI,Arial,sans-serif'; g.textBaseline='top';
  for(let j=0;j<n;j++) for(let i=0;i<n;i++) g.fillText(String.fromCharCode(65+i)+(j+1), ox+i*cell+3, oy+j*cell+2);
  g.restore();
}
function gridCellName(x,z){
  const u=Math.max(0,Math.min(0.999,worldToMapU(x))), v=Math.max(0,Math.min(0.999,worldToMapV(z)));
  return String.fromCharCode(65+Math.floor(u*10))+(Math.floor(v*10)+1);
}
function drawDeathMark(g, X, Y, r){
  g.save(); g.lineCap='round';
  g.fillStyle='rgba(20,20,20,.9)'; g.strokeStyle='#ff3b30'; g.lineWidth=Math.max(1.5,r*0.28);
  g.beginPath(); g.arc(X,Y,r,0,6.283); g.fill(); g.stroke();
  g.strokeStyle='#fff'; g.lineWidth=Math.max(1.5,r*0.26); const k=r*0.5;
  g.beginPath(); g.moveTo(X-k,Y-k); g.lineTo(X+k,Y+k); g.moveTo(X+k,Y-k); g.lineTo(X-k,Y+k); g.stroke();
  g.restore();
}
function drawPlayerMarker(g, px, py, size){
  // стрелка по направлению взгляда: yaw=0 смотрит на -Z (вверх карты)
  g.save(); g.translate(px,py); g.rotate(-player.yaw);
  g.fillStyle='#fff'; g.strokeStyle='rgba(0,0,0,.85)'; g.lineWidth=Math.max(1.5,size*0.14);
  g.beginPath(); g.moveTo(0,-size); g.lineTo(size*0.68,size*0.78); g.lineTo(0,size*0.36); g.lineTo(-size*0.68,size*0.78); g.closePath();
  g.stroke(); g.fill();
  g.restore();
}
function drawMap(){
  if(!mapBase) buildMapBase();
  const g = mapCtx, s = mapSide()*mapView.z, ox = mapView.x, oy = mapView.y;
  g.setTransform(mapDpr,0,0,mapDpr,0,0);
  g.fillStyle = MAP_SEA_BG; g.fillRect(0,0,mapW,mapH);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(mapBase, ox, oy, s, s);
  drawGridAndLabels(g, ox, oy, s);
  const sx=ox+worldToMapU(SPAWN.x)*s, sy=oy+worldToMapV(SPAWN.z)*s;
  g.fillStyle='rgba(255,210,80,.95)'; g.beginPath(); g.arc(sx,sy,4,0,6.283); g.fill();
  g.strokeStyle='rgba(0,0,0,.6)'; g.lineWidth=1.5; g.stroke();
  POIS.forEach(p=>{ const X=ox+worldToMapU(p.x)*s, Y=oy+worldToMapV(p.z)*s;
    g.fillStyle=p.col; g.strokeStyle='#000'; g.lineWidth=2; g.beginPath(); g.rect(X-6,Y-6,12,12); g.fill(); g.stroke();
    g.font='bold 13px sans-serif'; g.textAlign='center'; g.lineWidth=3; g.strokeText(p.name,X,Y-11); g.fillStyle='#fff'; g.fillText(p.name,X,Y-11); g.textAlign='start'; });
  mapMarks.forEach(m=>{
    g.fillStyle='#e0432b'; g.beginPath(); g.arc(ox+worldToMapU(m.x)*s, oy+worldToMapV(m.z)*s, 5, 0, 6.283); g.fill();
    g.strokeStyle='#fff'; g.lineWidth=1.5; g.stroke();
  });
  if(deathAlive()){ const X=ox+worldToMapU(lastDeath.x)*s, Y=oy+worldToMapV(lastDeath.z)*s; drawDeathMark(g,X,Y,9);
    g.font='bold 11px sans-serif'; g.textAlign='center'; g.lineWidth=3; g.strokeStyle='#000'; g.strokeText('Смерть',X,Y-14); g.fillStyle='#ff6b5e'; g.fillText('Смерть',X,Y-14); g.textAlign='start'; }
  drawPlayerMarker(g, ox+worldToMapU(player.pos.x)*s, oy+worldToMapV(player.pos.z)*s, 8);
  document.getElementById('map-hud').textContent = gridCellName(player.pos.x,player.pos.z)+'   X '+Math.round(player.pos.x+WORLD_SIZE/2)+'  Z '+Math.round(player.pos.z+WORLD_SIZE/2)+'   x'+mapView.z.toFixed(1);
}
function drawMini(){
  if(!mapBase) buildMapBase();
  const S = miniCanvas.width, g = miniCtx;
  // окно ±60 м вокруг игрока, карта не вращается (север сверху)
  const R = 60, u=worldToMapU(player.pos.x), v=worldToMapV(player.pos.z);
  const MB = mapBase.width, w = (R*2/WORLD_SIZE)*MB;
  g.clearRect(0,0,S,S);
  g.save(); g.beginPath(); g.arc(S/2,S/2,S/2-1,0,6.283); g.clip();
  g.fillStyle='#1a3446'; g.fillRect(0,0,S,S);
  g.imageSmoothingEnabled=true;
  g.drawImage(mapBase, u*MB-w/2, v*MB-w/2, w, w, 0,0,S,S);
  POIS.forEach(p=>{ const X=S/2+(p.x-player.pos.x)/(R*2)*S, Y=S/2+(p.z-player.pos.z)/(R*2)*S, dd=Math.hypot(X-S/2,Y-S/2), mx=S/2-9;
    let qx=X,qy=Y; if(dd>mx){ qx=S/2+(X-S/2)*mx/dd; qy=S/2+(Y-S/2)*mx/dd; }
    g.fillStyle=p.col; g.strokeStyle='#000'; g.lineWidth=1.5; g.beginPath(); g.rect(qx-5,qy-5,10,10); g.fill(); g.stroke(); });
  if(deathAlive()){ const X=S/2+(lastDeath.x-player.pos.x)/(R*2)*S, Y=S/2+(lastDeath.z-player.pos.z)/(R*2)*S, dd=Math.hypot(X-S/2,Y-S/2), mx=S/2-9;
    let qx=X,qy=Y; if(dd>mx){ qx=S/2+(X-S/2)*mx/dd; qy=S/2+(Y-S/2)*mx/dd; } drawDeathMark(g,qx,qy,6); }
  g.restore();
  g.strokeStyle='rgba(255,255,255,.55)'; g.lineWidth=2; g.beginPath(); g.arc(S/2,S/2,S/2-1,0,6.283); g.stroke();
  drawPlayerMarker(g,S/2,S/2,7);
}
let miniT = 0;
function updateMinimap(dt){
  miniT += dt; if(miniT < 0.1) return; miniT = 0;
  if(mapOpen) return;
  drawMini();
}
function toggleMap(force){
  const want = (force===undefined) ? !mapOpen : force;
  if(want===mapOpen) return;
  mapOpen = want;
  if(want){
    closeWorldPanels();
    document.getElementById('inv-panel').classList.remove('show');
    document.getElementById('craft-panel').classList.remove('show');
    mapPanel.classList.add('show');
    markOpened();
    mapView.z = 1; sizeMapCanvas(); drawMap();
    OSIL_AUDIO.play('open');
  } else {
    mapPanel.classList.remove('show');
    OSIL_AUDIO.play('close');
  }
  miniCanvas.style.display = (want || !CFG.minimap) ? 'none' : '';
  updateFpsVisibility(); syncPointerLock();
}
fastTap(document.getElementById('btn-map'), ()=>toggleMap());
document.getElementById('close-map').addEventListener('click', guardedClose(()=>toggleMap(false)));
miniCanvas.addEventListener('click', ()=>toggleMap(true));
/* жесты: щипок двумя пальцами — масштаб, перетаскивание — сдвиг, короткий тап — метка */
const mapPtrs = new Map(); let mapMoved = false, mapPinch = 0;
function zoomMapAt(px, py, nz){
  nz = Math.max(1, Math.min(6, nz));
  const k = nz/mapView.z;
  mapView.x = px-(px-mapView.x)*k; mapView.y = py-(py-mapView.y)*k; mapView.z = nz; clampMapView();
}
mapCanvas.addEventListener('pointerdown', e=>{
  mapCanvas.setPointerCapture(e.pointerId);
  mapPtrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(mapPtrs.size===1) mapMoved = false;
  if(mapPtrs.size===2){ const [a,b]=[...mapPtrs.values()]; mapPinch = Math.hypot(a.x-b.x,a.y-b.y); mapMoved = true; }
});
mapCanvas.addEventListener('pointermove', e=>{
  const p = mapPtrs.get(e.pointerId); if(!p) return;
  const dx=e.clientX-p.x, dy=e.clientY-p.y;
  if(mapPtrs.size===2){
    p.x=e.clientX; p.y=e.clientY;
    const [a,b]=[...mapPtrs.values()], dist=Math.hypot(a.x-b.x,a.y-b.y);
    if(mapPinch>0) zoomMapAt((a.x+b.x)/2,(a.y+b.y)/2, mapView.z*dist/mapPinch);
    mapPinch = dist;
  } else {
    if(!mapMoved && Math.hypot(dx,dy)<6) return;
    mapMoved = true; p.x=e.clientX; p.y=e.clientY;
    mapView.x+=dx; mapView.y+=dy; clampMapView();
  }
  drawMap();
});
function mapPtrEnd(e){
  const had = mapPtrs.delete(e.pointerId);
  if(had && !mapMoved && mapPtrs.size===0 && e.type==='pointerup'){
    const s=mapSide()*mapView.z, u=(e.clientX-mapView.x)/s, v=(e.clientY-mapView.y)/s;
    if(u>=0&&u<=1&&v>=0&&v<=1){
      const wx=(u-0.5)*WORLD_SIZE, wz=(v-0.5)*WORLD_SIZE;
      const near = mapMarks.findIndex(m=>Math.hypot(m.x-wx,m.z-wz) < WORLD_SIZE*0.02/mapView.z);
      if(near>=0) mapMarks.splice(near,1); else if(mapMarks.length<8) mapMarks.push({x:wx,z:wz}); else showToast('Максимум 8 меток');
      drawMap();
    }
  }
  if(mapPtrs.size<2) mapPinch = 0;
}
mapCanvas.addEventListener('pointerup', mapPtrEnd);
mapCanvas.addEventListener('pointercancel', mapPtrEnd);
mapCanvas.addEventListener('wheel', e=>{ e.preventDefault(); zoomMapAt(e.clientX,e.clientY,mapView.z*(e.deltaY<0?1.15:1/1.15)); drawMap(); },{passive:false});
window.addEventListener('resize', ()=>{ if(mapOpen){ sizeMapCanvas(); drawMap(); } });

/* ---------------- Survival stats tick ---------------- */
function tickSurvival(dt){
  player.hunger = Math.max(0, player.hunger - dt*0.15);
  player.thirst = Math.max(0, player.thirst - dt*0.2);
  if(player.hunger<=0 || player.thirst<=0){
    player.hp = Math.max(0, player.hp - dt*1.5);
  } else if(player.hp<100){
    player.hp = Math.min(100, player.hp + dt*0.5);
  }
}

/* ================= КАБАНЫ (биом «лес») =================
   Процедурная модель (7 мешей на зверя), ИИ: пасётся → предупреждает → атакует, если подойти близко,
   100 HP, кровь при попадании, после смерти — туша на боку: 5 ударов любым инструментом = ткань, исчезает через 5 минут. */
const BOAR = {FLEE_HP:30, COUNT_W:8, HP:100, WALK:1.3, RUN:5.4, AGGRO:8, DMG:[12,18], ATK_CD:1.1, CORPSE_T:300, HITS:5, COUNT:10};
const boars = [];
const bzC = (v,a,b)=>Math.max(a,Math.min(b,v)), bzL = (a,b,t)=>a+(b-a)*t;
const _bzTex = {}, _bzGeo = {};

function bzTexture(v){
  if(_bzTex[v]) return _bzTex[v];
  const W=128, H=256, FH=224, cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const c=cv.getContext('2d'), win=v==='w';
  /* жёсткая короткая щетина: тёмная основа + тонкие вертикальные штрихи (не кудри, иначе выглядит как шерсть овцы) */
  const base=win?'#8d877b':'#30271f';
  const pal=win?['#d9d4c8','#bdb7a9','#a19b8d','#7f796d','#5d584f','#ece8de','#4a463f']:['#120e0c','#1e1814','#2b221b','#3a2e24','#4d3c2d','#61503c','#0b0908'];
  c.fillStyle=base; c.fillRect(0,0,W,FH);
  let s=12345; const r=()=>{ s=(s*1664525+1013904223)>>>0; return s/4294967296; };
  for(let i=0;i<4200;i++){
    const x=r()*W, y=r()*FH, l=2.5+r()*4.5, sl=(r()-.5)*0.7;
    c.strokeStyle=pal[(r()*pal.length)|0]; c.globalAlpha=.45+r()*.45; c.lineWidth=.5+r()*.6;
    c.beginPath(); c.moveTo(x,y); c.lineTo(x+sl,y+l); c.stroke();
  }
  c.strokeStyle=win?'#f4f1e8':'#8a775c';                           // светлые кончики щетины (седина)
  for(let i=0;i<520;i++){ const x=r()*W, y=r()*FH; c.globalAlpha=.25+r()*.25; c.lineWidth=.5; c.beginPath(); c.moveTo(x,y); c.lineTo(x+(r()-.5)*.6,y+2+r()*2.5); c.stroke(); }
  c.globalAlpha=1; c.fillStyle='#fff'; c.fillRect(0,FH,W,H-FH);
  const t=new THREE.CanvasTexture(cv);
  t.wrapS=THREE.RepeatWrapping; t.repeat.set(2,1);
  t.minFilter=THREE.LinearFilter; t.generateMipmaps=false;
  try{ if(renderer.outputEncoding===THREE.sRGBEncoding) t.encoding=THREE.sRGBEncoding; }catch(e){}
  return (_bzTex[v]=t);
}

/* ---- сборка геометрии ---- */
function bzSmooth(g){                       // усредняем нормали на швах сферы после деформации
  g.computeVertexNormals();
  const p=g.attributes.position, n=g.attributes.normal, m=new Map();
  for(let i=0;i<p.count;i++){ const k=Math.round(p.getX(i)*1e4)+','+Math.round(p.getY(i)*1e4)+','+Math.round(p.getZ(i)*1e4); let e=m.get(k); if(!e){e=[0,0,0,[]];m.set(k,e);} e[0]+=n.getX(i);e[1]+=n.getY(i);e[2]+=n.getZ(i);e[3].push(i); }
  m.forEach(e=>{ const l=Math.hypot(e[0],e[1],e[2])||1; e[3].forEach(i=>n.setXYZ(i,e[0]/l,e[1]/l,e[2]/l)); });
}
function bzPart(g, o){
  if(o.def){ o.def(g); bzSmooth(g); }
  const m=new THREE.Matrix4().compose(new THREE.Vector3(...(o.p||[0,0,0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r||[0,0,0]))), new THREE.Vector3(...(o.s||[1,1,1])));
  g.applyMatrix4(m);
  const pos=g.attributes.position, uv=g.attributes.uv, n=pos.count, col=new Float32Array(n*3), base=new THREE.Color(o.c!==undefined?o.c:0xffffff);
  for(let i=0;i<n;i++){
    let rgb=o.cf ? o.cf(pos.getX(i),pos.getY(i),pos.getZ(i)) : [base.r,base.g,base.b];
    const k=o.k||1; col[i*3]=rgb[0]*k; col[i*3+1]=rgb[1]*k; col[i*3+2]=rgb[2]*k;
    if(o.fur) uv.setY(i, 0.125+uv.getY(i)*0.875); else uv.setXY(i, 0.5, 0.06);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col,3));
  return g;
}
function bzMerge(list){
  let n=0, ni=0; list.forEach(g=>{ n+=g.attributes.position.count; ni+=g.index.count; });
  const P=new Float32Array(n*3), N=new Float32Array(n*3), U=new Float32Array(n*2), C=new Float32Array(n*3), I=new Uint16Array(ni);
  let o=0, oi=0;
  list.forEach(g=>{
    const c=g.attributes.position.count;
    P.set(g.attributes.position.array,o*3); N.set(g.attributes.normal.array,o*3); U.set(g.attributes.uv.array,o*2); C.set(g.attributes.color.array,o*3);
    const ix=g.index.array; for(let i=0;i<ix.length;i++) I[oi+i]=ix[i]+o;
    o+=c; oi+=ix.length; g.dispose();
  });
  const m=new THREE.BufferGeometry();
  m.setAttribute('position',new THREE.BufferAttribute(P,3)); m.setAttribute('normal',new THREE.BufferAttribute(N,3));
  m.setAttribute('uv',new THREE.BufferAttribute(U,2)); m.setAttribute('color',new THREE.BufferAttribute(C,3)); m.setIndex(new THREE.BufferAttribute(I,1));
  return m;
}
function bzBuildGeos(v){
  const win=v==='w', PI=Math.PI, S=(w,h)=>new THREE.SphereGeometry(1,w||12,h||9), C=(a,b,h,s)=>new THREE.CylinderGeometry(a,b,h,s||7), K=(r,h,s)=>new THREE.ConeGeometry(r,h,s||5);
  const BONE=0xd6cdb0, CREST=win?0x8a857b:0x2a211b, TAILC=win?0x6a655c:0x1a1512;
  /* ТЕЛО (клин, как у настоящего кабана): высокая мощная холка, узкий опущенный зад, подтянутое брюхо */
  const bodyDef=g=>{ const p=g.attributes.position; for(let i=0;i<p.count;i++){ let x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const hump=Math.exp(-((z-0.38)*(z-0.38))/0.14);
    if(y>0) y*=1+0.22*hump; else y*=0.78;
    if(z<0){ y-=0.18*(-z); if(y<0) y*=1-0.25*(-z); x*=1-0.24*(-z); } else x*=1+0.06*z;
    p.setXYZ(i,x,y,z); } };
  const bodyCf=(x,y,z)=>{ const t=bzC((y-0.34)/0.72,0,1), k=1.06-0.34*t; return [k,k*0.96,k*0.9]; };
  const bp=[
    bzPart(S(16,12),{def:bodyDef,p:[0,0.64,0],s:[0.36,0.40,0.70],fur:1,cf:bodyCf}),
    bzPart(S(12,9),{p:[0,0.58,-0.42],s:[0.27,0.27,0.27],fur:1,cf:bodyCf}),                   // небольшой окорок
    bzPart(S(12,9),{p:[0,0.72,0.40],s:[0.35,0.40,0.36],fur:1,cf:(x,y,z)=>[0.7,0.67,0.63]}),   // плечи
    bzPart(S(12,9),{p:[0,0.76,0.55],s:[0.23,0.24,0.26],fur:1,k:0.7})                          // толстая шея
  ];
  for(let k=0;k<10;k++){                                                                      // гребень щетины вдоль хребта
    const zn=0.66-k*0.135, u=zn/0.70, hm=Math.exp(-((u-0.38)*(u-0.38))/0.14);
    const bt=0.64+0.40*(1+0.22*hm)*Math.sqrt(Math.max(0.05,1-u*u))-(u<0?0.072*(-u):0);
    const st=0.72+0.40*Math.sqrt(Math.max(0,1-((zn-0.40)/0.36)*((zn-0.40)/0.36)));
    const nt=0.76+0.24*Math.sqrt(Math.max(0,1-((zn-0.55)/0.26)*((zn-0.55)/0.26)));
    const top=Math.max(bt,st,nt), len=k<5?0.27-0.02*k:0.14;
    bp.push(bzPart(K(0.05,len,4),{p:[0,top-0.02,zn],r:[-1.0,0,0],c:CREST}));
  }
  const body=bzMerge(bp);
  /* ГОЛОВА: клиновидная, длинное рыло с пятачком, светлые щёки, клыки, уши, выразительные глаза */
  const hp=[
    bzPart(S(12,9),{p:[0,0,0.1],s:[0.20,0.21,0.26],fur:1,k:0.85}),
    bzPart(S(9,7),{p:[0.12,-0.05,0.12],s:[0.11,0.11,0.14],fur:1,k:1.5}),
    bzPart(S(9,7),{p:[-0.12,-0.05,0.12],s:[0.11,0.11,0.14],fur:1,k:1.5}),
    bzPart(C(0.075,0.14,0.36,8),{p:[0,-0.06,0.38],r:[PI/2,0,0],fur:1,k:0.6}),
    bzPart(S(9,6),{p:[0,-0.12,0.3],s:[0.075,0.04,0.17],fur:1,k:0.5}),
    bzPart(C(0.092,0.092,0.05,10),{p:[0,-0.06,0.565],r:[PI/2,0,0],c:0x4a3432}),
    bzPart(S(6,4),{p:[0.035,-0.055,0.594],s:[0.016,0.016,0.012],c:0x050404}),
    bzPart(S(6,4),{p:[-0.035,-0.055,0.594],s:[0.016,0.016,0.012],c:0x050404}),
    bzPart(K(0.02,0.13,5),{p:[0.078,-0.1,0.46],r:[0.65,0,-0.35],c:BONE}),
    bzPart(K(0.02,0.13,5),{p:[-0.078,-0.1,0.46],r:[0.65,0,0.35],c:BONE}),
    bzPart(K(0.075,0.2,4),{p:[0.13,0.2,0.0],r:[-0.3,0,-0.6],s:[1,1,0.45],fur:1,k:0.6}),
    bzPart(K(0.075,0.2,4),{p:[-0.13,0.2,0.0],r:[-0.3,0,0.6],s:[1,1,0.45],fur:1,k:0.6})
  ];
  for(const sx of [1,-1]){                                                                    // ГЛАЗА: веко, янтарная радужка, зрачок, блик, тёмная бровь
    hp.push(bzPart(S(8,6),{p:[0.186*sx,0.062,0.15],s:[0.04,0.034,0.04],c:0x1a120e}));
    hp.push(bzPart(S(8,6),{p:[0.198*sx,0.062,0.152],s:[0.028,0.027,0.028],c:0xb57a25}));
    hp.push(bzPart(S(7,5),{p:[0.214*sx,0.062,0.156],s:[0.016,0.019,0.016],c:0x030202}));
    hp.push(bzPart(S(5,4),{p:[0.222*sx,0.07,0.162],s:[0.006,0.006,0.006],c:0xffffff}));
    hp.push(bzPart(S(8,5),{p:[0.17*sx,0.1,0.15],s:[0.05,0.016,0.06],r:[0,0,-0.35*sx],fur:1,k:0.35}));
  }
  for(let k=0;k<3;k++) hp.push(bzPart(K(0.04,0.11,4),{p:[0,0.2-k*0.02,0.0+k*0.1],r:[-0.7,0,0],c:CREST}));   // чёлка
  const head=bzMerge(hp);
  const leg=bzMerge([
    bzPart(C(0.085,0.055,0.30,7),{p:[0,-0.15,0],fur:1,k:0.42}),
    bzPart(C(0.052,0.040,0.28,6),{p:[0,-0.44,0],fur:1,k:0.36}),
    bzPart(C(0.042,0.046,0.07,6),{p:[0,-0.61,0],c:0x0d0b0a})
  ]);
  const tail=bzMerge([
    bzPart(C(0.012,0.02,0.26,5),{p:[0,-0.13,0],fur:1,k:0.5}),
    bzPart(K(0.03,0.09,5),{p:[0,-0.3,0],r:[PI,0,0],c:TAILC})
  ]);
  return {body,head,leg,tail};
}

/* ---- создание зверя ---- */
const bzLegPos=[[-0.19,0.60,0.40],[0.19,0.60,0.40],[-0.19,0.60,-0.41],[0.19,0.60,-0.41]];   // ПЛ, ПП, ЗЛ, ЗП
function spawnBoar(x,z,v){
  v=v||'f'; if(!_bzGeo[v]) _bzGeo[v]=bzBuildGeos(v);
  const G=_bzGeo[v], mat=new THREE.MeshStandardMaterial({map:bzTexture(v), vertexColors:true, roughness:0.96, metalness:0, emissive:0x000000});
  const root=new THREE.Group(), rig=new THREE.Group(), meshes=[];
  root.rotation.order='YXZ'; root.add(rig);
  const mk=(g,par)=>{ const m=new THREE.Mesh(g,mat); m.castShadow=true; par.add(m); meshes.push(m); return m; };
  const body=mk(G.body,rig);
  const head=new THREE.Group(); head.position.set(0,0.80,0.60); rig.add(head); mk(G.head,head);
  const legs=bzLegPos.map(p=>{ const l=new THREE.Group(); l.position.set(p[0],p[1],p[2]); rig.add(l); mk(G.leg,l); return l; });
  const tail=new THREE.Group(); tail.position.set(0,0.83,-0.68); tail.rotation.x=0.5; rig.add(tail); mk(G.tail,tail);
  const sc=(0.82+Math.random()*0.16)*(v==='w'?1.07:1);
  root.scale.setScalar(sc);
  const y=heightAt(x,z);
  root.position.set(x,y,z);
  scene.add(root);
  const b={v,bm:v==='w'?B.SNOW:B.FOREST,scared:false,root,rig,body,head,legs,tail,mat,meshes,sc,x,z,y,yaw:Math.random()*6.283,pit:0,rol:0,hp:BOAR.HP,
    state:'idle',sub:'graze',t:1+Math.random()*3,hx:x,hz:z,tx:x,tz:z,cyc:Math.random()*6,sp:0,headP:0.9,headY:0,
    atk:0,atkDone:false,atkCd:0,flash:0,recoil:0,aggro:false,alertT:0,dead:false,deadT:0,side:1,hits:BOAR.HITS,
    tt:Math.random()*50,shT:0,jig:0,pool:null,hv:null,legSnap:null,tailP:0.5};
  boars.push(b);
  return b;
}

/* ---- кровь ---- */
const BZ_BN=90, bloodPool=[], bloodMist=[], bzBN={i:0,m:0};
const bloodMats=[0x7a0b0b,0x9a1313,0x55070a].map(c=>new THREE.MeshBasicMaterial({color:c}));
(function(){
  const g=new THREE.BoxGeometry(1,1,1), sg=new THREE.SphereGeometry(1,6,5);
  for(let i=0;i<BZ_BN;i++){ const m=new THREE.Mesh(g,bloodMats[0]); m.visible=false; m.frustumCulled=false; m.userData={v:new THREE.Vector3(),s:0.03,rest:false,life:0}; scene.add(m); bloodPool.push(m); }
  for(let i=0;i<14;i++){ const m=new THREE.Mesh(sg,new THREE.MeshBasicMaterial({color:0x8a0f0f,transparent:true,opacity:0,depthWrite:false})); m.visible=false; m.frustumCulled=false; m.userData={v:new THREE.Vector3(),life:0,max:0.4,s:0.2}; scene.add(m); bloodMist.push(m); }
})();
function bloodBurst(px,py,pz,dx,dy,dz,n,pw){
  if(!CFG.particles) n=Math.ceil(n*0.4);
  for(let i=0;i<n;i++){
    const p=bloodPool[bzBN.i++%BZ_BN], u=p.userData;
    p.material=bloodMats[(Math.random()*3)|0]; p.position.set(px,py,pz);
    const sp=pw*(0.4+Math.random());
    u.v.set(dx*sp+(Math.random()-.5)*pw*.9, dy*sp+Math.random()*pw*.8+0.6, dz*sp+(Math.random()-.5)*pw*.9);
    u.s=0.022+Math.random()*0.04; u.rest=false; p.scale.setScalar(u.s); p.rotation.set(Math.random()*6,Math.random()*6,0); p.visible=true;
  }
  const mc=n>20?3:2;
  for(let i=0;i<mc;i++){
    const m=bloodMist[bzBN.m++%bloodMist.length], u=m.userData;
    m.position.set(px,py,pz); u.v.set(dx*1.2+(Math.random()-.5)*.6, 0.3+Math.random()*.5, dz*1.2+(Math.random()-.5)*.6);
    u.life=u.max=0.3+Math.random()*0.2; u.s=0.1+Math.random()*0.06; m.scale.setScalar(u.s); m.material.opacity=0.5; m.visible=true;
  }
}
function updateBlood(dt){
  for(const p of bloodPool){
    if(!p.visible) continue; const u=p.userData;
    if(u.rest){ u.life-=dt; if(u.life<=0) p.visible=false; continue; }
    u.v.y-=11*dt; p.position.addScaledVector(u.v,dt); p.rotation.x+=dt*8;
    const gy=heightAt(p.position.x,p.position.z)+0.012;
    if(p.position.y<=gy){ p.position.y=gy; u.rest=true; u.life=8+Math.random()*6; p.rotation.set(0,Math.random()*6,0); p.scale.set(u.s*(1.6+Math.random()),u.s*0.22,u.s*(1.6+Math.random())); }
  }
  for(const m of bloodMist){
    if(!m.visible) continue; const u=m.userData; u.life-=dt;
    if(u.life<=0){ m.visible=false; continue; }
    const k=1-u.life/u.max; m.position.addScaledVector(u.v,dt); m.scale.setScalar(u.s*(1+k*2.6)); m.material.opacity=0.5*(1-k)*(1-k);
  }
}

/* ---- попадания ---- */
const _bo=new THREE.Vector3(), _bd=new THREE.Vector3(), _brc=new THREE.Raycaster();
function bzAim(){
  if(CFG.camMode|0){ const cp=Math.cos(player.pitch); _bo.set(player.pos.x,player.pos.y+player.height,player.pos.z); _bd.set(-Math.sin(player.yaw)*cp,Math.sin(player.pitch),-Math.cos(player.yaw)*cp); }
  else { camera.getWorldPosition(_bo); camera.getWorldDirection(_bd); }
}
function bzRaySph(o,d,c,r){ const ox=o.x-c[0],oy=o.y-c[1],oz=o.z-c[2],b=ox*d.x+oy*d.y+oz*d.z,cc=ox*ox+oy*oy+oz*oz-r*r,disc=b*b-cc; if(disc<0) return -1; const t=-b-Math.sqrt(disc); return t>0?t:(cc<0?0.01:-1); }
function bzSpheres(b){
  const s=b.sc, fx=Math.sin(b.yaw), fz=Math.cos(b.yaw), hp=b.headP, hd=0.6+0.42*Math.cos(hp), hy=0.80-0.42*Math.sin(hp);
  const L=(d,h)=>[b.x+fx*d*s, b.y+h*s, b.z+fz*d*s];
  return [{c:L(0.32,0.68),r:0.46*s,head:false},{c:L(-0.30,0.64),r:0.44*s,head:false},{c:L(hd+0.1,hy),r:0.23*s,head:true}];
}
function boarTrace(o,d,maxT){
  let best=null, bt=maxT;
  for(const b of boars){
    if(b.dead) continue;
    const dx=b.x-o.x, dz=b.z-o.z; if(dx*dx+dz*dz>(maxT+3)*(maxT+3)) continue;
    for(const s of bzSpheres(b)){ const t=bzRaySph(o,d,s.c,s.r); if(t>=0&&t<bt){ bt=t; best={b,head:s.head,t}; } }
  }
  return best;
}
function bzBlocked(t){                                        // деревья/скалы/рельеф между стрелком и зверем
  if(t<1) return false;
  _brc.set(_bo,_bd); _brc.far=t-0.2;
  if(_brc.intersectObjects(Array.from(harvestHitMap.keys()),false).length) return true;
  for(let s=2;s<t;s+=2){ if(_bo.y+_bd.y*s < heightAt(_bo.x+_bd.x*s,_bo.z+_bd.z*s)) return true; }
  const hp=_bzHit, lim=t-0.2;
  for(let i=0;i<colliders.length;i++){ const bb=colliders[i].box; if(bb.containsPoint(_bo)) continue;
    if(_brc.ray.intersectBox(bb,hp) && hp.distanceTo(_bo)<lim) return true; }
  return false;
}
const _bzHit=new THREE.Vector3();
function bzSnd(name,b,vol,rate){
  const d=Math.hypot(b.x-player.pos.x,b.z-player.pos.z), v=bzC(1-d/45,0,1)*vol;
  if(v>0.03) try{ OSIL_AUDIO.play(name,{vol:v,rate}); }catch(e){}
}
function boarDamage(b,dmg){
  if(b.dead) return;
  if(window.__BOAR_GUEST && window.__BOAR_GUEST() && window.OSIL_NET && OSIL_NET.boarHit){ const bi=boars.indexOf(b); if(bi>=0) OSIL_NET.boarHit(bi,dmg); }
  b.hp-=dmg; b.flash=1; b.recoil=0.25; b.aggro=true; b.jig=1;
  if(b.hp<=0){ killBoar(b); return; }
  bzSnd('player_scream',b,0.5,0.55+Math.random()*0.15);
  if(b.hp<=BOAR.FLEE_HP){ if(b.state!=='flee'){ b.state='flee'; b.scared=true; b.atk=0; b.atkCd=0; bzSnd('player_scream',b,0.6,0.8); } }
  else if(b.state!=='charge'&&!b.scared){ b.state='charge'; b.atk=0; }
}
function boarHit(b,dmg,px,py,pz,dir,head){
  bloodBurst(px,py,pz,dir.x,dir.y*0.3,dir.z,head?22:14,head?3.6:2.8);
  if(head) flashCrit();
  boarDamage(b,dmg);
}
function boarShot(dmg){
  if(!boars.length) return;
  bzAim(); const h=boarTrace(_bo,_bd,150); if(!h||bzBlocked(h.t)) return;
  boarHit(h.b, h.head?dmg*2:dmg, _bo.x+_bd.x*h.t, _bo.y+_bd.y*h.t, _bo.z+_bd.z*h.t, _bd, h.head);
}
function boarMelee(kind){
  if(!boars.length) return false;
  bzAim(); const h=boarTrace(_bo,_bd,3.4); if(!h) return false;
  const D={axe:34,pickaxe:26,spear:46,knife:30,rock:15}, d=D[kind]||18;
  try{ OSIL_AUDIO.play('hit_tree',{rate:0.55}); }catch(e){}
  camKick=0.04;
  boarHit(h.b, h.head?d*1.5:d, _bo.x+_bd.x*h.t, _bo.y+_bd.y*h.t, _bo.z+_bd.z*h.t, _bd, h.head);
  wearTool(kind,1);
  return true;
}

/* ---- смерть, туша, разделка ---- */
function killBoar(b){
  b.dead=true; b.state='dead'; b.deadT=0; b.side=Math.random()<0.5?-1:1; b.atk=0; b.hp=0;
  b.legSnap=b.legs.map(l=>l.rotation.x);
  const pool=new THREE.Mesh(new THREE.CircleGeometry(0.85,16), new THREE.MeshBasicMaterial({color:0x4d0909,transparent:true,opacity:0.88,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  pool.rotation.x=-Math.PI/2; pool.position.set(b.x,b.y+0.05,b.z); pool.scale.setScalar(0.1); scene.add(pool); b.pool=pool;
  bloodBurst(b.x,b.y+0.8*b.sc,b.z,0,0.4,0,36,3.4);
  bzSnd('player_scream',b,0.6,0.42);
  b.hv={mesh:b.root,hitMesh:b.root,type:'carcass',health:BOAR.HITS,maxHealth:BOAR.HITS,giveMin:1,giveMax:1,radius:1.3,boar:b};
  harvestables.push(b.hv); rebuildHarvestHitMap();
}
function carcassHit(t){
  const b=t.boar; if(!b||b.hits<=0) return;
  b.hits--; t.health=b.hits; b.jig=1;
  const n=4+((Math.random()*3)|0);
  giveItem('cloth',n); showToast('+'+n+' '+(RES_NAMES.cloth||'ткань'));
  try{ OSIL_AUDIO.play('hit_tree',{rate:0.7}); }catch(e){}
  camKick=0.03;
  bloodBurst(lastHitPoint.x,lastHitPoint.y,lastHitPoint.z,0,1,0,8,2.2);
  updateResourceUI();
  if(b.hits<=0) removeBoar(b,true);
}
function removeBoar(b,burst){
  if(b.hv){ if(harvestTarget===b.hv) stopHarvest(); const i=harvestables.indexOf(b.hv); if(i>=0) harvestables.splice(i,1); b.hv=null; rebuildHarvestHitMap(); }
  if(burst) bloodBurst(b.x,b.y+0.4,b.z,0,1,0,18,2.6);
  scene.remove(b.root); b.mat.dispose();
  if(b.pool){ scene.remove(b.pool); b.pool.geometry.dispose(); b.pool.material.dispose(); b.pool=null; }
  const i=boars.indexOf(b); if(i>=0) boars.splice(i,1);
}
function updateCorpse(b,dt){
  b.deadT+=dt;
  const k=Math.min(1,b.deadT/0.8), e=1-Math.pow(1-k,3), ang=e*(Math.PI/2)*(1+0.05*Math.sin(k*Math.PI)), s=b.side, r=b.rig;
  r.rotation.set(0,0,s*ang); r.position.set(0.64*s*Math.sin(ang), 0.36*Math.sin(ang), 0);
  const tw=Math.max(0,1-b.deadT/1.6), pose=[-0.6,0.45,0.55,-0.35];
  b.legs.forEach((l,i)=>{ l.rotation.x=bzL(b.legSnap[i],pose[i],e)+Math.sin(b.deadT*26+i*1.7)*0.18*tw; });
  b.headP=bzL(b.headP,0.55,Math.min(1,dt*3)); b.head.rotation.x=b.headP; b.head.rotation.y=0.3*s*e; b.head.position.set(0,0.78,0.62);
  b.tailP=bzL(b.tailP,0.95,Math.min(1,dt*2)); b.tail.rotation.x=b.tailP;
  if(b.jig>0){ b.jig=Math.max(0,b.jig-dt*4); r.position.y+=0.025*Math.sin(b.jig*28)*b.jig; }
  b.mat.emissive.setRGB(b.flash*0.5,0.02*b.flash,0); b.flash=Math.max(0,b.flash-dt*3);
  b.root.position.set(b.x,b.y,b.z); b.root.rotation.set(b.pit,b.yaw,0);
  if(b.pool){ const g=Math.min(1,b.deadT/7); b.pool.scale.setScalar((0.1+0.95*g)*b.sc*1.1); if(b.deadT>BOAR.CORPSE_T-4) b.pool.material.opacity=0.88*Math.max(0,(BOAR.CORPSE_T-b.deadT)/4); }
  if(b.deadT>BOAR.CORPSE_T-4) b.root.position.y=b.y-0.9*Math.min(1,(b.deadT-(BOAR.CORPSE_T-4))/4);      // оседает в землю
  if(b.deadT>=BOAR.CORPSE_T) removeBoar(b,false);
}

/* ---- ИИ ---- */
function bzOk(b,x,z,step){
  if(Math.abs(x)>WORLD_SIZE/2-6||Math.abs(z)>WORLD_SIZE/2-6||isWaterAt(x,z)) return false;
  if(heightAt(x,z)-b.y>step*1.1+0.03) return false;
  const y=b.y;
  for(let i=0;i<colliders.length;i++){ const bx=colliders[i].box; if(x>bx.min.x-0.5&&x<bx.max.x+0.5&&z>bx.min.z-0.5&&z<bx.max.z+0.5&&bx.max.y>y+0.3&&bx.min.y<y+0.9) return false; }
  return true;
}
function bzMove(b,sp,dt){
  if(sp<=0) return true;
  const st=sp*dt, nx=b.x+Math.sin(b.yaw)*st, nz=b.z+Math.cos(b.yaw)*st;
  if(bzOk(b,nx,nz,st)){ b.x=nx; b.z=nz; return true; }
  if(bzOk(b,nx,b.z,st)){ b.x=nx; return true; }
  if(bzOk(b,b.x,nz,st)){ b.z=nz; return true; }
  return false;
}
function bzIdle(b,t){ b.state='idle'; b.t=t||3+Math.random()*5; b.sub=['graze','graze','sniff','look'][(Math.random()*4)|0]; }
function bzPickWalk(b){
  for(let k=0;k<8;k++){
    const a=Math.random()*6.283, r=4+Math.random()*16, x=b.hx+Math.sin(a)*r, z=b.hz+Math.cos(a)*r;
    if(isWaterAt(x,z)||biomeAt(x,z)!==b.bm||Math.abs(x)>WORLD_SIZE/2-8||Math.abs(z)>WORLD_SIZE/2-8) continue;
    b.tx=x; b.tz=z; b.state='walk'; b.t=14; return;
  }
  bzIdle(b,2);
}
function bzHurtPlayer(d){ if(window.OSIL_NET&&OSIL_NET.hurt) OSIL_NET.hurt(d,'boar'); else { player.hp=Math.max(0,player.hp-d*armorMul(d)); camKick=0.05; } }
function bzAI(b,dt,dx,dz,dist){
  b.atkCd=Math.max(0,b.atkCd-dt); b.t-=dt; b.tt+=dt; b.flash=Math.max(0,b.flash-dt*3); b.recoil=Math.max(0,b.recoil-dt*1.2); b.jig=Math.max(0,b.jig-dt*4);
  const pAlive=player.hp>0, angP=Math.atan2(dx,dz);
  let speed=0, want=b.yaw, turn=3.2, moved=true;
  switch(b.state){
    case 'idle':
      if(b.scared){ if(pAlive&&dist<16) b.state='flee'; }
      else if(pAlive&&dist<BOAR.AGGRO){ b.state='alert'; b.alertT=0.7; bzSnd('player_scream',b,0.3,0.35); break; }
      if(b.t<=0){ if(Math.random()<0.65) bzPickWalk(b); else bzIdle(b); }
      break;
    case 'walk':
      if(b.scared){ if(pAlive&&dist<16) b.state='flee'; }
      else if(pAlive&&dist<BOAR.AGGRO){ b.state='alert'; b.alertT=0.7; bzSnd('player_scream',b,0.3,0.35); break; }
      want=Math.atan2(b.tx-b.x,b.tz-b.z); speed=BOAR.WALK;
      if(Math.hypot(b.tx-b.x,b.tz-b.z)<0.9||b.t<=0){ bzIdle(b); speed=0; }
      break;
    case 'alert':                                   // предупреждение: замер, смотрит на игрока
      want=angP; turn=6;
      if(!pAlive||dist>BOAR.AGGRO+5){ bzIdle(b,2); break; }
      b.alertT-=dt; if(b.alertT<=0){ b.state='charge'; b.atk=0; bzSnd('player_scream',b,0.45,0.4); }
      break;
    case 'charge': {
      const leash=b.aggro?42:24, home=Math.hypot(b.x-b.hx,b.z-b.hz);
      if(!pAlive||dist>leash||home>70){ b.state='return'; b.aggro=false; b.atk=0; break; }
      want=angP; turn=7;
      if(b.atk>0){
        b.atk+=dt;
        if(!b.atkDone&&b.atk>=0.34){ b.atkDone=true; if(dist<2.4&&Math.abs(player.pos.y-b.y)<2.4){ bzHurtPlayer(BOAR.DMG[0]+Math.random()*(BOAR.DMG[1]-BOAR.DMG[0])); camKick=0.07; } }
        if(b.atk>=0.85){ b.atk=0; b.atkCd=BOAR.ATK_CD; }
      } else {
        speed=BOAR.RUN; if(dist<1.35) speed=0;
        let da=angP-b.yaw; da=Math.atan2(Math.sin(da),Math.cos(da));
        if(dist<1.8&&b.atkCd<=0&&Math.abs(da)<0.9){ b.atk=0.0001; b.atkDone=false; }
      }
      break; }
    case 'flee':                                    // ранен: убегает от игрока, хромая мордой вниз
      want=angP+Math.PI; turn=6.5; speed=BOAR.RUN*1.12;
      if(!pAlive||dist>48){ b.hx=b.x; b.hz=b.z; bzIdle(b,5); speed=0; }
      break;
    case 'return':
      want=Math.atan2(b.hx-b.x,b.hz-b.z); speed=BOAR.WALK*1.5;
      if(pAlive&&dist<BOAR.AGGRO&&!b.scared){ b.state='alert'; b.alertT=0.5; break; }
      if(Math.hypot(b.hx-b.x,b.hz-b.z)<2) bzIdle(b);
      break;
  }
  let da=want-b.yaw; da=Math.atan2(Math.sin(da),Math.cos(da));
  const st=turn*dt; b.yaw+=bzC(da,-st,st);
  if(speed>0) speed*= Math.abs(da)<1.0?1:0.3;
  if(speed>0) moved=bzMove(b,speed,dt);
  if(!moved&&b.state==='walk') bzIdle(b,1.5);
  if(!moved&&b.state==='flee') b.yaw+=(Math.random()<.5?-1:1)*1.3;
  b.sp+=(speed-b.sp)*Math.min(1,dt*6);
  b.y+=(heightAt(b.x,b.z)-b.y)*Math.min(1,dt*14);
}
function bzAnim(b,dt){
  const sp=b.sp, run=bzC((sp-2.2)/2.6,0,1), mv=bzC(sp/1.0,0,1);
  if(sp>0.05) b.cyc+=dt*(3.2+sp*1.75);
  const c=b.cyc, amp=(0.38+0.5*run)*mv, PI=Math.PI, tt=b.tt;
  const ph=[c, c+bzL(PI,0.25,run), c+bzL(PI,2.6,run), c+bzL(0,2.85,run)];
  for(let i=0;i<4;i++) b.legs[i].rotation.x=Math.sin(ph[i])*amp;
  // атака: замах (голова вниз) → выпад клыками вверх → возврат
  let headT, lunge=0, gz;
  const a=b.atk;
  if(b.state==='idle'){ headT= b.sub==='graze' ? 1.22+0.07*Math.sin(tt*9)*Math.max(0,Math.sin(tt*0.8)) : b.sub==='sniff' ? 0.75+0.08*Math.sin(tt*6) : 0.2; }
  else if(b.state==='alert'){ headT=-0.02+0.05*Math.sin(tt*24); }
  else if(b.state==='charge'){ headT=0.65+0.06*Math.sin(c*2); }
  else if(b.state==='flee'){ headT=0.5+0.06*Math.sin(c*2); }
  else headT=0.32+0.05*Math.sin(c*2);
  if(a>0){ if(a<0.3){ headT=bzL(0.65,1.15,a/0.3); lunge=-0.08*(a/0.3); } else if(a<0.5){ const q=(a-0.3)/0.2; headT=bzL(1.15,-0.4,q); lunge=bzL(-0.08,0.38,q); } else { const q=Math.min(1,(a-0.5)/0.35); headT=bzL(-0.4,0.65,q); lunge=bzL(0.38,0,q); } }
  b.headP+=(headT-b.headP)*Math.min(1,dt*(a>0?20:7));
  gz=bzC(b.headP/1.2,0,1);
  b.head.rotation.x=b.headP;
  const lookT=b.state==='idle'&&b.sub==='look'?Math.sin(tt*0.6)*0.6:0;
  b.headY+=(lookT-b.headY)*Math.min(1,dt*3); b.head.rotation.y=b.headY;
  b.head.position.set(0,0.80-0.13*gz,0.60+0.26*gz);
  b.body.scale.y=1+0.012*Math.sin(tt*2.2);
  b.rig.position.set(0, Math.abs(Math.sin(c))*0.035*run+Math.sin(c*2)*0.012*mv*(1-run), lunge-b.recoil*0.5);
  b.rig.rotation.set(Math.sin(c)*0.03*run, 0, Math.sin(c)*0.025*mv);
  const tUp=b.state==='charge'?-0.9:(b.state==='flee'?-0.6:0.5); b.tailP+=(tUp-b.tailP)*Math.min(1,dt*5);
  b.tail.rotation.x=b.tailP; b.tail.rotation.z=Math.sin(tt*(2+8*run))*0.25*(0.4+run);
  b.mat.emissive.setRGB(b.flash*0.55,0.02*b.flash,0);
  // посадка по рельефу
  const fx=Math.sin(b.yaw), fz=Math.cos(b.yaw);
  const tp=-Math.atan2(heightAt(b.x+fx*0.55,b.z+fz*0.55)-heightAt(b.x-fx*0.55,b.z-fz*0.55),1.1);
  const tr=Math.atan2(heightAt(b.x+fz*0.3,b.z-fx*0.3)-heightAt(b.x-fz*0.3,b.z+fx*0.3),0.6);
  b.pit+=(tp-b.pit)*Math.min(1,dt*8); b.rol+=(tr-b.rol)*Math.min(1,dt*8);
  b.root.position.set(b.x,b.y,b.z); b.root.rotation.set(b.pit,b.yaw,b.rol);
}
function updateBoars(dt){
  if(!boars.length) return;
  updateBlood(dt);
  const px=player.pos.x, pz=player.pos.z;
  for(let i=boars.length-1;i>=0;i--){
    const b=boars[i], dx=px-b.x, dz=pz-b.z, d2=dx*dx+dz*dz;
    b.root.visible=d2<105*105;
    if(b.dead){ updateCorpse(b,dt); continue; }
    if(d2>130*130) continue;
    const dist=Math.sqrt(d2);
    if(window.__BOAR_GUEST && window.__BOAR_GUEST()){
      if(b._nx!==undefined){ const k=Math.min(1,dt*8), ox=b.x, oz=b.z; b.x+=(b._nx-b.x)*k; b.z+=(b._nz-b.z)*k; b.y=heightAt(b.x,b.z);
        let dy=b._ny-b.yaw; dy=Math.atan2(Math.sin(dy),Math.cos(dy)); b.yaw+=dy*k; b.sp=Math.hypot(b.x-ox,b.z-oz)/Math.max(dt,1e-3); b.state=b._ns||b.state; }
    } else bzAI(b,dt,dx,dz,dist);
    bzAnim(b,dt);
    b.shT-=dt; if(b.shT<=0){ b.shT=0.5; const sh=d2<40*40; for(const m of b.meshes) m.castShadow=sh; }
  }
}
(function(){
  const nearSpawn=(x,z)=>Math.hypot(x-SPAWN.x,z-SPAWN.z)<30;
  scatter(BOAR.COUNT, (x,z)=>{ if(!nearSpawn(x,z)) spawnBoar(x,z,'f'); }, 28, [B.FOREST]);
  scatter(BOAR.COUNT_W, (x,z)=>{ if(!nearSpawn(x,z)) spawnBoar(x,z,'w'); }, 28, [B.SNOW]);
})();

/* ---------------- Main loop ---------------- */
let lastTime = performance.now();     // «идеальное» время последнего кадра (для лимитера)
let _lastRenderTs = 0;                // реальное время последнего отрисованного кадра
let _refreshMs = 1000/60;             // измеренный период обновления экрана
let _prevRafTs = 0, _rafDeltas = [];
let _shN = 0;                         // счётчик кадров для равномерного обновления теней
/* Пейсинг строго по vsync: ВСЕГДА requestAnimationFrame (браузер отдаёт кадр на границе обновления экрана → нет разрывов).
   Лимит FPS — это пропуск целого числа vsync-тиков (аккумулятор + допуск полтика), а не таймеры setTimeout/MessageChannel,
   которые сдвигали кадр относительно развёртки и давали разрывы/рывки. */
function measureRefresh(ts){
  if(_prevRafTs){
    const d = ts - _prevRafTs;
    if(d > 3 && d < 40){
      _rafDeltas.push(d); if(_rafDeltas.length > 40) _rafDeltas.shift();
      if(_rafDeltas.length >= 12){ const a = _rafDeltas.slice().sort((x,y)=>x-y); _refreshMs = a[a.length>>1]; }
    }
  }
  _prevRafTs = ts;
}
document.addEventListener('visibilitychange', ()=>{ _prevRafTs = 0; _rafDeltas.length = 0; });

/* ================= Дорога, бочки, заправка, Агропром, боты ================= */
function roadZ(x){ return 0.04*WORLD_SIZE*Math.sin(x/WORLD_SIZE*7.5); }
const GS = {x:0, z:-15}, AG = {x:78, z:-74};
const POIS = [{x:GS.x,z:GS.z,name:'Заправка',col:'#ff9d2e'},{x:AG.x,z:AG.z,name:'Агропром',col:'#e0432b'}];
const roadBarrels = [], crates = [], bots = [], botTr = [], _trPool = [];
const botTrMat = new THREE.LineBasicMaterial({color:0xffd27a});
const _lm = c=>new THREE.MeshStandardMaterial({color:c,roughness:0.85,flatShading:true});

function makeRoadMesh(){
  const x0=-108, x1=108, st=1.0, n=Math.round((x1-x0)/st), W=5.4, C=12, pos=[], uv=[], idx=[];
  for(let i=0;i<=n;i++){ const x=x0+i*st, zc=roadZ(x), v=i*st/(W*2);
    for(let c=0;c<=C;c++){ const t=c/C, z=zc+(t*2-1)*W; pos.push(x,heightAt(x,z)+0.16,z); uv.push(t,v); }   // высота по рельефу в каждой точке поперёк дороги
    if(i<n) for(let c=0;c<C;c++){ const a=i*(C+1)+c, b=a+1, d=a+C+1, e=d+1; idx.push(a,b,d,b,e,d); }
  }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(idx); g.computeVertexNormals();
  const tex=new THREE.TextureLoader().load(window.ROAD_TEX); tex.wrapS=THREE.ClampToEdgeWrapping; tex.wrapT=THREE.RepeatWrapping; tex.anisotropy=8;
  // мягкая рваная кромка: непрозрачный центр, по краям трава/земля «заползает» на дорогу
  const cv=document.createElement('canvas'); cv.width=128; cv.height=256; const cx=cv.getContext('2d'), im=cx.createImageData(128,256);
  const hash=(a,b)=>{ const s=Math.sin(a*127.1+b*311.7)*43758.5453; return s-Math.floor(s); };
  for(let y=0;y<256;y++) for(let x=0;x<128;x++){
    const u=x/127, e=Math.min(u,1-u)*2, nz=0.55*hash(Math.floor(x/3),Math.floor(y/3))+0.45*hash(Math.floor(x/9)+7,Math.floor(y/11)+3);
    let a=Math.max(0,Math.min(1,(e-0.12-nz*0.32)/0.34)); a=a*a*(3-2*a);
    const k=(y*128+x)*4; im.data[k]=im.data[k+1]=im.data[k+2]=a*255; im.data[k+3]=255; }
  cx.putImageData(im,0,0);
  const am=new THREE.CanvasTexture(cv); am.wrapS=THREE.ClampToEdgeWrapping; am.wrapT=THREE.RepeatWrapping;
  const mat=new THREE.MeshLambertMaterial({map:tex,color:0x8a8d78,alphaMap:am,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
  const m=new THREE.Mesh(g,mat);
  m.receiveShadow=true; m.userData.road=true; m.renderOrder=0; scene.add(m);
}
function boxAt(cx,cz,w,h,d,mat,x,y,z,col,y0){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); m.position.set(cx+x,y0+y+h/2,cz+z); m.castShadow=m.receiveShadow=true; scene.add(m); if(col) addCollider(m); return m; }
function makeCrate(x,z,y0,kind){
  const cr=new THREE.Group(), mat=_lm(kind==='mil'?0x4b5320:0x6b5a3a), cb=new THREE.Mesh(new THREE.BoxGeometry(1.1,0.7,0.75),mat); cb.position.y=0.35;
  const lid=new THREE.Mesh(new THREE.BoxGeometry(1.14,0.14,0.79),new THREE.MeshStandardMaterial({color:0x555a60,roughness:0.5,flatShading:true})); lid.position.y=0.77; cr.add(cb,lid);
  cr.position.set(x,y0,z); cr.rotation.y=Math.random()*6; cr.traverse(o=>{o.castShadow=true}); scene.add(cr); addCollider(cr);
  crates.push({mesh:cr,lid,ready:true,t:0,kind});
}
function makeBot(x,z){
  const m=buildHumanRig(0x4d5b3d); setRigSuit(m,true); m.root.rotation.order='YXZ';
  m.armR.sh.rotation.x=-1.45; m.armL.sh.rotation.x=-1.3; m.armL.sh.rotation.y=0.35;
  const gm=_lm(0x1b1b1d), gun=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.12,0.75),gm); gun.position.set(-0.04,-0.3,-0.25); m.armR.hold.add(gun);
  const gy=heightAt(x,z); m.root.position.set(x,gy,z); scene.add(m.root);
  const b={rig:m,hp:60,dead:false,deadT:0,yaw:Math.PI,cd:0.6,burst:0,los:false,losT:0,aggroT:0,x,z,hx:x,hz:z,wt:Math.random()*3,wk:false,ph:0,sd:Math.random()<0.5?1:-1};
  bots.push(b); return b;
}
/* Агропром — сотни отдельных мешей (каждый draw call + проход теней). Склеиваем всё статичное по материалам в несколько мешей. */
function agMerge(before, X, Y, Z){
  const keep = new Set(); crates.forEach(c=>keep.add(c.mesh)); roadBarrels.forEach(r=>{ if(r.grp) keep.add(r.grp); }); bots.forEach(b=>keep.add(b.rig.root));
  const bk = new Map(), dead = [];
  scene.children.slice().forEach(o=>{
    if(before.has(o) || keep.has(o) || (o.userData && o.userData.road)) return;
    let ok = true; const ms = [];
    o.traverse(n=>{ if(n.isMesh){ if(!n.geometry || !n.material || Array.isArray(n.material)) ok = false; else ms.push(n); } else if(!n.isGroup && n.type!=='Object3D') ok = false; });
    if(!ok || !ms.length) return;
    o.updateMatrixWorld(true);
    ms.forEach(n=>{
      const mt = n.material, key = [mt.type, mt.color?mt.color.getHex():0, mt.map?mt.map.uuid:0, mt.side, mt.transparent?mt.opacity:1, mt.roughness, mt.metalness, mt.flatShading, n.castShadow?1:0].join('|');
      let b = bk.get(key); if(!b){ b = {mat:mt, geos:[], cs:n.castShadow}; bk.set(key,b); }
      const g = n.geometry.index ? n.geometry.toNonIndexed() : n.geometry.clone();
      g.applyMatrix4(n.matrixWorld); g.translate(-X,-Y,-Z);
      if(!g.attributes.normal) g.computeVertexNormals();
      if(!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
      ['color','uv2','tangent'].forEach(a=>{ if(g.attributes[a]) g.deleteAttribute(a); });
      b.geos.push(g);
    });
    dead.push(o);
  });
  const grp = new THREE.Group(); grp.position.set(X,Y,Z);
  bk.forEach(b=>{
    let n = 0; b.geos.forEach(g=>{ n += g.attributes.position.count; });
    const pos = new Float32Array(n*3), nor = new Float32Array(n*3), uv = new Float32Array(n*2); let o = 0;
    b.geos.forEach(g=>{ pos.set(g.attributes.position.array,o*3); nor.set(g.attributes.normal.array,o*3); uv.set(g.attributes.uv.array,o*2); o += g.attributes.position.count; g.dispose(); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); geo.setAttribute('normal',new THREE.BufferAttribute(nor,3)); geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const m = new THREE.Mesh(geo,b.mat); m.castShadow = b.cs; m.receiveShadow = true; grp.add(m);
  });
  dead.forEach(o=>{ scene.remove(o); o.traverse(n=>{ if(n.isMesh && n.geometry) n.geometry.dispose(); }); });
  scene.add(grp);
}
function initRoadWorld(){ COL_WALK = true; try{ _initRoadWorld(); } finally{ COL_WALK = false; } }
function _initRoadWorld(){
  const __before=new Set(scene.children);
  const inFence=(p,c,hx,hz)=>Math.abs(p.x-c.x)<hx&&Math.abs(p.z-c.z)<hz;
  harvestables.slice().forEach(h=>{ const p=h.mesh.position; if(h.type==='carcass') return;
    if(Math.abs(p.z-roadZ(p.x))<(h.type==='scrap'?5:8)&&Math.abs(p.x)<115 || Math.hypot(p.x-GS.x,p.z-GS.z)<24 || inFence(p,AG,26,22)) destroyHarvestable(h); });
  makeRoadMesh();
  for(let x=-105,n=0;x<=105;x+=30,n++){   // бочки на обочинах
    const side=n%2?1:-1, bx=x+(Math.random()-0.5)*8, bz=roadZ(bx)+side*(6.4+Math.random()*1.0);
    if(Math.hypot(bx-GS.x,bz-GS.z)<14||isWaterAt(bx,bz)) continue;
    roadBarrels.push({x:bx,z:bz,grp:makeBarrel(bx,bz),t:0});
  }
  /* --- заправка --- */
  { /* ===== ЗАПРАВКА ===== */
    const X=GS.x, Z=GS.z, y0=heightAt(X,Z);
    const mkTex=(w,h,fn,rx,ry)=>{ const cv=document.createElement('canvas'); cv.width=w; cv.height=h; fn(cv.getContext('2d'),w,h); const t=new THREE.CanvasTexture(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; if(rx) t.repeat.set(rx,ry||rx); t.anisotropy=4; return t; };
    const noise=(x,w,h,n,col)=>{ for(let i=0;i<n;i++){ x.fillStyle=col(); x.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*4,1+Math.random()*4); } };
    const asphaltT=mkTex(256,256,(x,w,h)=>{ x.fillStyle='#3c3d40'; x.fillRect(0,0,w,h); noise(x,w,h,2200,()=>'rgba('+(50+Math.random()*50|0)+','+(50+Math.random()*50|0)+','+(52+Math.random()*50|0)+',.5)');
      x.strokeStyle='rgba(15,15,15,.55)'; x.lineWidth=1.5; for(let i=0;i<5;i++){ x.beginPath(); let px=Math.random()*w,py=Math.random()*h; x.moveTo(px,py); for(let k=0;k<6;k++){ px+=Math.random()*40-20; py+=Math.random()*40-10; x.lineTo(px,py);} x.stroke(); } },3,3);
    const plasterT=mkTex(256,256,(x,w,h)=>{ x.fillStyle='#b8b3a6'; x.fillRect(0,0,w,h); noise(x,w,h,1500,()=>'rgba('+(120+Math.random()*60|0)+','+(115+Math.random()*55|0)+',100,.25)');
      for(let i=0;i<14;i++){ x.fillStyle='rgba(60,50,40,'+(0.05+Math.random()*0.12)+')'; x.fillRect(Math.random()*w,0,4+Math.random()*10,h*(0.3+Math.random()*0.7)); } x.fillStyle='rgba(90,40,25,.35)'; for(let i=0;i<8;i++){ x.fillRect(Math.random()*w,Math.random()*h,18+Math.random()*30,6+Math.random()*14);} },2,1);
    const corrT=(c1)=>mkTex(128,128,(x,w,h)=>{ x.fillStyle=c1; x.fillRect(0,0,w,h); for(let i=0;i<w;i+=8){ x.fillStyle='rgba(0,0,0,.28)'; x.fillRect(i,0,3,h); x.fillStyle='rgba(255,255,255,.1)'; x.fillRect(i+3,0,2,h);} noise(x,w,h,500,()=>'rgba(110,55,30,'+(Math.random()*0.3)+')'); for(let i=0;i<6;i++){ x.fillStyle='rgba(90,45,20,.25)'; x.fillRect(Math.random()*w,h*0.4+Math.random()*h*0.6,3,20+Math.random()*50);} },3,2);
    const M=(c,r,m,map)=>new THREE.MeshStandardMaterial({color:c,roughness:r===undefined?0.85:r,metalness:m||0,map:map||null,flatShading:!map});
    const asphalt=M(0xffffff,1,0,asphaltT), plaster=M(0xffffff,0.95,0,plasterT), red=M(0xb03a2e,0.6,0.2), white=M(0xe4e4e0,0.6,0.1), dark=M(0x2c2e31,0.6,0.4), glass=new THREE.MeshStandardMaterial({color:0x7aa6b8,roughness:0.1,metalness:0.3,transparent:true,opacity:0.5}), yellow=M(0xd6b320,0.6,0.1), tireM=M(0x111112,0.95), steel=M(0x6a6e72,0.45,0.8), glow=new THREE.MeshBasicMaterial({color:0xfff2c4});
    const bx=(w,h,d,m,x,y,z,c)=>boxAt(X,Z,w,h,d,m,x,y,z,c,y0);
    const cy=(r,h,m,x,y,z,c,seg,rz)=>{ const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,seg||14),m); o.position.set(X+x,y0+y+h/2,Z+z); if(rz) o.rotation.z=Math.PI/2; o.castShadow=o.receiveShadow=true; scene.add(o); if(c) addCollider(o); return o; };
    // асфальт площадки с разметкой и бордюрами
    bx(26,0.12,22,asphalt,0,0,0,false); bx(26.4,0.2,0.4,white,0,0,-11,false); bx(26.4,0.2,0.4,white,0,0,11,false);
    for(let i=-4;i<=4;i+=2) bx(0.12,0.02,3.4,yellow,i*2.4,0.12,8,false);
    // навес: красная кромка, белая крыша, светильники, 6 колонн
    bx(15,0.5,9,white,0,4.4,0,false); bx(15.2,0.6,9.2,red,0,4.0,0,true); bx(15.4,0.1,9.4,dark,0,4.95,0,false);
    for(let i=-6;i<=6;i+=3) bx(0.9,0.06,0.9,glow,i,3.95,0,false);
    [[-6.5,-3.5],[6.5,-3.5],[-6.5,3.5],[6.5,3.5],[0,-3.5],[0,3.5]].forEach(p=>bx(0.5,4.0,0.5,white,p[0],0.12,p[1],true));
    // 4 колонки с шлангами, дисплеями
    [[-4,-1],[-4,1],[4,-1],[4,1]].forEach(p=>{ bx(0.9,1.6,0.6,red,p[0],0.12,p[1],true); bx(0.6,0.4,0.62,dark,p[0],1.0,p[1],false); bx(0.5,0.16,0.64,glow,p[0],1.34,p[1],false); bx(0.2,0.5,0.1,dark,p[0]+0.35,0.6,p[1],false); });
    // магазин с остеклением, дверью и козырьком
    bx(11,3.6,6,plaster,0,0.12,-9.5,true); bx(11.6,0.4,6.6,dark,0,3.72,-9.5,false); bx(11.8,0.18,6.8,red,0,4.1,-9.5,false);
    bx(7,1.8,0.12,glass,-1.5,1.0,-6.46,true); bx(1.4,2.3,0.14,dark,3.6,0.12,-6.46,true); bx(8,0.5,0.9,red,-1,3.0,-6.2,false);
    bx(2.2,0.8,0.1,glow,-1,3.1,-5.72,false);
    // высокая стела с ценами
    bx(0.4,7,0.4,steel,-11,0.12,6,true); bx(2.4,3,0.35,white,-11,5.0,6,false); bx(2.2,0.9,0.4,red,-11,7.0,6,false);
    [4.2,5.2,6.2].forEach(y=>bx(1.8,0.5,0.4,glow,-11,y,6,false));
    // подземные цистерны (люки) и ёмкость
    cy(1.3,2.8,M(0x8a8d90,0.5,0.6),9,0.12,-8,true,18,true); bx(1.0,0.12,1.0,steel,3,0.12,-3.3,true);
    // фонари
    [[-10,-10],[10,-10],[-10,9],[10,9]].forEach(p=>{ bx(0.18,6,0.18,dark,p[0],0.12,p[1],true); bx(1.1,0.14,0.4,dark,p[0],6.1,p[1],false); bx(0.9,0.06,0.3,glow,p[0],6.0,p[1],false); });
    // мусор, покрышки, бочки, брошенная машина
    for(let i=0;i<3;i++) cy(0.42,0.22,tireM,10.5,0.12+i*0.22,-3.5,i===0,12);
    bx(1.8,1.2,1.0,M(0x2f5a3a,0.8),11,0.12,3,true);        // контейнер
    const car=new THREE.Group(); const cb=M(0x6a2a24,0.7,0.3);
    [[3.8,0.8,1.7,0,0.45,0],[2.0,0.7,1.6,-0.2,1.05,0]].forEach(a=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(a[0],a[1],a[2]),a[4]>1?glass:cb); m.position.set(a[3],a[4],a[5]); m.castShadow=true; car.add(m); });
    [[-1.3,0.28,0.85],[1.3,0.28,0.85],[-1.3,0.28,-0.85],[1.3,0.28,-0.85]].forEach(p=>{ const w=new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.32,0.22,12),tireM); w.rotation.x=Math.PI/2; w.position.set(p[0],p[1],p[2]); car.add(w); });
    car.position.set(X-9,y0+0.12,Z+7); car.rotation.y=0.5; car.rotation.z=0.03; scene.add(car); addCollider(car);
    makeCrate(X+5,Z-5.2,y0+0.12,'gas'); makeCrate(X-8,Z-9,y0+0.12,'gas');
  }
  { /* ===== АГРОПРОМ ===== */
    const __ag0=new Set(scene.children);
    const X=AG.x, Z=AG.z, y0=heightAt(X,Z);
    const mkTex=(w,h,fn,rx,ry)=>{ const cv=document.createElement('canvas'); cv.width=w; cv.height=h; fn(cv.getContext('2d'),w,h); const t=new THREE.CanvasTexture(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; if(rx) t.repeat.set(rx,ry||rx); t.anisotropy=4; return t; };
    const speck=(x,w,h,n,col,s)=>{ for(let i=0;i<n;i++){ x.fillStyle=col(); x.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*(s||4),1+Math.random()*(s||4)); } };
    const concT=mkTex(256,256,(x,w,h)=>{ x.fillStyle='#8d8e89'; x.fillRect(0,0,w,h); speck(x,w,h,2500,()=>'rgba('+(70+Math.random()*90|0)+','+(70+Math.random()*90|0)+','+(66+Math.random()*80|0)+',.35)'); x.strokeStyle='rgba(30,30,28,.5)'; x.lineWidth=1.5; for(let i=1;i<4;i++){ x.beginPath(); x.moveTo(0,i*h/4); x.lineTo(w,i*h/4); x.stroke(); } for(let i=0;i<10;i++){ x.fillStyle='rgba(45,40,30,'+(0.06+Math.random()*0.14)+')'; x.fillRect(Math.random()*w,0,5+Math.random()*12,h*(0.3+Math.random()*0.7)); } },3,2);
    const brickT=mkTex(256,256,(x,w,h)=>{ x.fillStyle='#6a3b2c'; x.fillRect(0,0,w,h); for(let r=0;r<16;r++) for(let c=0;c<8;c++){ const off=r%2?16:0; x.fillStyle='rgb('+(100+Math.random()*40|0)+','+(48+Math.random()*24|0)+','+(34+Math.random()*18|0)+')'; x.fillRect(c*32+off+1,r*16+1,30,14); } speck(x,w,h,300,()=>'rgba(210,205,190,.15)',3); },3,2);
    const corrT=(c1)=>mkTex(128,128,(x,w,h)=>{ x.fillStyle=c1; x.fillRect(0,0,w,h); for(let i=0;i<w;i+=8){ x.fillStyle='rgba(0,0,0,.3)'; x.fillRect(i,0,3,h); x.fillStyle='rgba(255,255,255,.1)'; x.fillRect(i+3,0,2,h);} speck(x,w,h,500,()=>'rgba(115,55,28,'+(Math.random()*0.32)+')',4); for(let i=0;i<7;i++){ x.fillStyle='rgba(95,45,20,.28)'; x.fillRect(Math.random()*w,h*0.4+Math.random()*h*0.6,3,20+Math.random()*50);} },4,2);
    const M=(c,r,m,map)=>new THREE.MeshStandardMaterial({color:c,roughness:r===undefined?0.85:r,metalness:m||0,map:map||null,flatShading:!map});
    const concrete=M(0xffffff,0.95,0,concT), brick=M(0xffffff,0.95,0,brickT), tin=M(0xffffff,0.6,0.5,corrT('#7b8083')), tinR=M(0xffffff,0.65,0.5,corrT('#6b3b2a')), tinG=M(0xffffff,0.65,0.4,corrT('#4c5a45'));
    const dark=M(0x2c2e31,0.6,0.4), yel=M(0xc9a227,0.7,0.2), rust=M(0x7a4a2e,0.8,0.4), hay=M(0xb7a046,1), tireM=M(0x111112,0.95), glass=new THREE.MeshStandardMaterial({color:0x6d8794,roughness:0.15,metalness:0.2,transparent:true,opacity:0.45}), fenceM=M(0x6d6f70,0.7,0.5), dirt=M(0x6b5a40,1);
    const bx=(w,h,d,m,x,y,z,c,ry)=>{ const o=boxAt(X,Z,w,h,d,m,x,y,z,false,y0); if(ry) o.rotation.y=ry; if(c) addCollider(o); return o; };
    const cy=(r,h,m,x,y,z,c,seg,r2)=>{ const o=new THREE.Mesh(new THREE.CylinderGeometry(r2===undefined?r:r2,r,h,seg||18),m); o.position.set(X+x,y0+y+h/2,Z+z); o.castShadow=o.receiveShadow=true; scene.add(o); if(c) addCollider(o); return o; };
    bx(40,0.1,34,dirt,0,0,0,false); bx(30,0.12,26,concrete,0,0,0,false);                       // грунтовая и бетонная площадки
    // забор из сетки на столбах, ворота с проходом, колючка, вышки
    const fenceRun=(x0,z0,x1,z1)=>{ const L=Math.hypot(x1-x0,z1-z0), a=Math.atan2(z1-z0,x1-x0), n=Math.round(L/4); for(let i=0;i<=n;i++) bx(0.25,3.2,0.25,dark,x0+(x1-x0)*i/n,0,z0+(z1-z0)*i/n,false); const vert=Math.abs(x1-x0)<0.01; bx(vert?0.3:L,2.6,vert?L:0.3,fenceM,(x0+x1)/2,0,(z0+z1)/2,true); bx(vert?0.2:L,0.12,vert?L:0.2,dark,(x0+x1)/2,3.0,(z0+z1)/2,false); };
    fenceRun(-17,-14,17,-14); fenceRun(-17,-14,-17,14); fenceRun(17,-14,17,14); fenceRun(-17,14,-5,14); fenceRun(5,14,17,14);
    bx(0.5,4.2,0.5,brick,-5,0,14,true); bx(0.5,4.2,0.5,brick,5,0,14,true); bx(10.6,0.5,0.6,yel,0,4.0,14,true);       // арка ворот
    // главный цех: кирпичный низ, рифлёный верх, окна, раздвижные ворота, двускатная крыша
    bx(20,4.2,11,brick,-3,0,-7,true); bx(20.4,3.4,11.4,tin,-3,4.2,-7,true);
    for(let i=0;i<5;i++) bx(1.6,1.0,0.12,glass,-10.5+i*3.6,2.2,-1.45,false);
    bx(4.6,3.6,0.2,dark,-3,0,-1.4,false); bx(0.2,3.6,0.22,yel,-5.3,0,-1.35,false); bx(0.2,3.6,0.22,yel,-0.7,0,-1.35,false);
    for(const s of [-1,1]){ const r=bx(11.4,0.3,6.4,tinR,-3,8.6,-7+s*2.9,false); r.rotation.x=s*0.42; }
    { const rc=new THREE.Mesh(new THREE.BoxGeometry(20.4,2.6,11.4)); rc.position.set(X-3,y0+8.6,Z-7); addCollider(rc); }   // крыша цеха
    // ангар поменьше: арочная крыша
    bx(8,4.5,14,tinG,-12,0,6,true); const arc=new THREE.Mesh(new THREE.CylinderGeometry(4.0,4.0,14.2,16,1,true,Math.PI/2,Math.PI),tin); arc.material=tin.clone(); arc.material.side=THREE.DoubleSide; arc.rotation.x=Math.PI/2; arc.position.set(X-12,y0+4.5,Z+6); arc.castShadow=true; scene.add(arc); addCollider(arc);
    // силосные башни: 3 цилиндра с кольцами, конусные крыши и галереей
    [[9,-9],[13,-9],[11,-4.8]].forEach((p,i)=>{ cy(2.0,10+i*1.2,tin,p[0],0,p[1],true,22); cy(2.12,0.3,dark,p[0],3,p[1],false,22); cy(2.12,0.3,dark,p[0],7,p[1],false,22); cy(0.1,2.2,dark,p[0],10+i*1.2,p[1],false,8,2.2); });
    bx(8,0.2,0.9,dark,11,10.4,-9,false); bx(0.5,11,0.5,rust,6.4,0,-9,false);
    // водонапорная башня
    cy(0.2,8,rust,-14,0,-10,true,8); cy(2,2.2,tinR,-14,8,-10,true,16); cy(2.1,0.25,dark,-14,10.2,-10,false,16); cy(0.1,1.4,dark,-14,10.4,-10,false,6,2.2);
    // контейнеры стопкой, паллеты, ящики
    const cont=[M(0x8a2d22,0.7,0.3),M(0x2d4d6a,0.7,0.3),M(0x6b6b2a,0.7,0.3)];
    bx(6,2.5,2.4,cont[0],11,0,6,true,0.15); bx(6,2.5,2.4,cont[1],11.2,2.5,6,false,0.12); bx(6,2.5,2.4,cont[2],10,0,9.6,true,-0.08);
    // техника: трактор с прицепом
    const tr=new THREE.Group(), tb=M(0x3c6b2c,0.6,0.3);
    const tp=(w,h,d,m,x,y,z)=>{ const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m); o.position.set(x,y,z); o.castShadow=true; tr.add(o); return o; };
    tp(1.6,1.0,2.6,tb,0,1.3,-0.8); tp(1.5,1.6,1.4,glass,0,2.3,0.5); tp(1.7,0.1,1.6,tb,0,3.15,0.5); tp(0.2,0.8,0.2,dark,0.5,2.0,-2.0);
    [[-0.9,0.8,0.9,0.8],[0.9,0.8,0.9,0.8],[-0.8,0.5,-1.6,0.5],[0.8,0.5,-1.6,0.5]].forEach(a=>{ const w=new THREE.Mesh(new THREE.CylinderGeometry(a[3],a[3],a[3]>0.6?0.5:0.35,16),tireM); w.rotation.z=Math.PI/2; w.position.set(a[0],a[1],a[2]); w.castShadow=true; tr.add(w); });
    tr.position.set(X+3,y0+0.1,Z+7); tr.rotation.y=-0.6; scene.add(tr); addCollider(tr);
    const tl=new THREE.Group(); const tlb=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.9,4),rust); tlb.position.y=1.0; tl.add(tlb); [[-1.1,-1.3],[1.1,-1.3],[-1.1,1.3],[1.1,1.3]].forEach(p=>{ const w=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,0.3,14),tireM); w.rotation.z=Math.PI/2; w.position.set(p[0],0.5,p[1]); tl.add(w); }); tl.position.set(X-2,y0+0.1,Z+9.5); tl.rotation.y=0.3; tl.traverse(o=>{o.castShadow=true}); scene.add(tl); addCollider(tl);
    // тюки сена, бочки, штабель труб
    for(const p of [[-8,11],[-6.4,11.4],[-7.2,11.1,1.1]]){ const b=new THREE.Mesh(new THREE.CylinderGeometry(0.75,0.75,1.3,16),hay); b.rotation.z=Math.PI/2; b.position.set(X+p[0],y0+(p[2]||0)+0.78,Z+p[1]); b.castShadow=true; scene.add(b); addCollider(b); }
    for(let i=0;i<4;i++) cy(0.2,5,dark,0,0,0,false,8).position.set(X+14+((i%2)*0.45),y0+0.2+(i>1?0.4:0),Z+1+i*0.0);
    // прожекторы на мачтах
    [[-15,-12],[15,-12],[15,12],[-15,12]].forEach(p=>{ bx(0.25,8,0.25,dark,p[0],0,p[1],false); bx(1.4,0.6,0.5,dark,p[0],8,p[1],false); bx(1.2,0.4,0.1,new THREE.MeshBasicMaterial({color:0xfff2c4}),p[0],8.1,p[1]+0.28,false); });
    // сторожка у ворот
    bx(3.2,2.6,3.2,concrete,-9,0,11,true); bx(3.6,0.3,3.6,tinR,-9,2.6,11,false); bx(1.4,1.0,0.1,glass,-9,1.2,9.35,false);
    for(const p of [[-12,9],[-8,10],[11,9]]) roadBarrels.push({x:X+p[0]+(p[0]>8?4:0),z:Z+p[1]+2,grp:makeBarrel(X+p[0]+(p[0]>8?4:0),Z+p[1]+2),t:0});
    makeCrate(X-4,Z-1.6,y0+0.12,'mil'); makeCrate(X+8,Z+2,y0+0.12,'mil'); makeCrate(X-10,Z+1.5,y0+0.12,'mil'); makeCrate(X+14,Z-2,y0+0.12,'mil');
    [[-8,0],[6,-4],[0,8],[12,-6]].forEach(p=>{ const b=makeBot(X+p[0],Z+p[1]); b.yaw=Math.random()*6; });
    agMerge(__ag0, X, y0, Z); }

  rebuildHarvestHitMap();
  scene.children.forEach(o=>{ if(!__before.has(o)&&!o.userData.road&&!bots.some(b=>b.rig.root===o)) registerCullable(o); });
  updateCulling(0,true);
}
function segBlocked(ox,oy,oz,tx,ty,tz){   // отрезок задевает коллайдер или рельеф?
  const dx=tx-ox, dy=ty-oy, dz=tz-oz, L=Math.hypot(dx,dy,dz); if(L<0.5) return false;
  const x0=Math.min(ox,tx)-0.1, x1=Math.max(ox,tx)+0.1, z0=Math.min(oz,tz)-0.1, z1=Math.max(oz,tz)+0.1;
  const tMin=0.02/L, tMax=1-0.12/L;
  for(let i=0;i<colliders.length;i++){ const c=colliders[i].box; if(c.max.x<x0||c.min.x>x1||c.max.z<z0||c.min.z>z1) continue;
    let t0=0, t1=1, ok=true;
    const ax=[[ox,dx,c.min.x,c.max.x],[oy,dy,c.min.y,c.max.y],[oz,dz,c.min.z,c.max.z]];
    for(let k=0;k<3 && ok;k++){ const o=ax[k][0], d=ax[k][1], mn=ax[k][2], mx=ax[k][3];
      if(Math.abs(d)<1e-9){ if(o<mn||o>mx) ok=false; }
      else { let ta=(mn-o)/d, tb=(mx-o)/d; if(ta>tb){ const q=ta; ta=tb; tb=q; } if(ta>t0) t0=ta; if(tb<t1) t1=tb; if(t0>t1) ok=false; } }
    if(ok && t0>tMin && t0<tMax) return true; }
  for(let sd=0.75; sd<L-0.5; sd+=0.75){ const x=ox+dx/L*sd, y=oy+dy/L*sd, z=oz+dz/L*sd; if(y<heightAt(x,z)) return true; }
  return false;
}
function botSee(b){   // прямая видимость: рельеф + коллайдеры (точный луч), глаза и грудь
  const gy=heightAt(b.x,b.z);
  return !segBlocked(b.x, gy+1.5, b.z, player.pos.x, player.pos.y+1.2, player.pos.z) && !segBlocked(b.x, gy+1.0, b.z, player.pos.x, player.pos.y+1.0, player.pos.z);
}
function botShot(dmg){
  if(!bots.length) return;
  bzAim(); let bt=150, hd=false, hb=null;
  for(const b of bots){ if(b.dead) continue; const y=heightAt(b.x,b.z);
    for(const s of [{c:[b.x,y+1.0,b.z],r:0.5,head:false},{c:[b.x,y+1.62,b.z],r:0.25,head:true}]){ const t=bzRaySph(_bo,_bd,s.c,s.r); if(t>=0&&t<bt){ bt=t; hd=s.head; hb=b; } } }
  if(!hb||bzBlocked(bt)) return;
  bloodBurst(_bo.x+_bd.x*bt,_bo.y+_bd.y*bt,_bo.z+_bd.z*bt,_bd.x,_bd.y*0.3,_bd.z,hd?22:14,hd?3.6:2.8);
  if(hd) flashCrit();
  hb.hp-=hd?dmg*2:dmg; hb.aggroT=20;
  bots.forEach(o=>{ if(Math.hypot(o.x-hb.x,o.z-hb.z)<40) o.aggroT=Math.max(o.aggroT,12); });   // соседи тоже в курсе
  if(hb.hp<=0){ hb.dead=true; hb.deadT=0; }
}
function botFire(b){
  const y=heightAt(b.x,b.z), ox=b.x-Math.sin(b.yaw+Math.PI)*0.6, oy=y+1.35, oz=b.z-Math.cos(b.yaw+Math.PI)*0.6;
  const tx=player.pos.x, ty=player.pos.y+1.1, tz=player.pos.z, dx=tx-ox, dy=ty-oy, dz=tz-oz, L=Math.hypot(dx,dy,dz), hl=Math.max(0.01,Math.hypot(dx,dz));
  const sp=0.11, ex=(Math.random()*2-1)*sp*L, ey=(Math.random()*2-1)*sp*L, px=-dz/hl, pz=dx/hl;
  const ax=tx+px*ex, ay=ty+ey, az=tz+pz*ex;
  const clear = !segBlocked(b.x,y+1.4,b.z,ox,oy,oz) && !segBlocked(ox,oy,oz,ax,ay,az) && !segBlocked(b.x,y+1.0,b.z,tx,ty,tz);
  if(!clear) return;   // стена на пути — не стреляет (ни урона, ни трассера)
  if(Math.hypot(ex,ey)<0.42){ bzHurtPlayer(2+Math.random()*2); camKick=0.05; }
  let ln=_trPool.pop();
  if(!ln){ ln=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),botTrMat); ln.frustumCulled=false; }
  const pa=ln.geometry.attributes.position; pa.setXYZ(0,ox,oy,oz); pa.setXYZ(1,ox+(ax-ox)*1.15,oy+(ay-oy)*1.15,oz+(az-oz)*1.15); pa.needsUpdate=true;
  scene.add(ln); botTr.push({ln,t:0.06});
  bzSnd('ak',{x:b.x,z:b.z},0.7,0.95+Math.random()*0.1);
}
let lootNear = null;
function updateRoadWorld(dt){
  if(!bots.length) return;
  for(const r of roadBarrels){   // бочки: респавн 3 мин
    if(r.grp && !harvestables.some(h=>h.mesh===r.grp)){ r.grp=null; r.t=180; }
    else if(!r.grp){ r.t-=dt; if(r.t<=0){ r.grp=makeBarrel(r.x,r.z); rebuildHarvestHitMap(); } } }
  let near=null, nd=2.8;
  for(const c of crates){   // ящики: респавн 10 мин
    if(!c.ready){ c.t-=dt; if(c.t<=0){ c.ready=true; c.lid.material.color.set(0x555a60); } continue; }
    const d=Math.hypot(player.pos.x-c.mesh.position.x,player.pos.z-c.mesh.position.z); if(d<nd&&player.hp>0&&!panelsOpen()){ nd=d; near=c; } }
  if(near!==lootNear){ lootNear=near;
    if(near){ doorUI.classList.add('show'); const db=document.getElementById('dp-box'); db.style.display=''; db.textContent='ЗАБРАТЬ ЛУТ'; document.getElementById('dp-open').style.display='none'; document.getElementById('dp-lock').style.display='none'; }
    else if(!doorTarget&&!boxTarget) doorUI.classList.remove('show'); }
  for(let i=botTr.length-1;i>=0;i--){ const t=botTr[i]; t.t-=dt; if(t.t<=0){ scene.remove(t.ln); _trPool.push(t.ln); botTr.splice(i,1); } }
  for(const b of bots){
    const m=b.rig, gy=heightAt(b.x,b.z);
    if(!b.dead&&Math.abs(b.x-player.pos.x)+Math.abs(b.z-player.pos.z)>140){ m.root.visible=false; continue; } m.root.visible=true;
    { const far=Math.abs(b.x-player.pos.x)+Math.abs(b.z-player.pos.z)>70; if(far!==b._far){ b._far=far; m.root.traverse(o=>{ if(o.isMesh) o.castShadow=!far; }); shadowDirty=true; } }
    if(b.dead){ b.deadT+=dt; const k=Math.min(1,b.deadT/0.5); m.root.rotation.x=-1.5*k; m.root.position.y=gy+0.15*k;
      if(b.deadT>60){ b.dead=false; b.hp=60; b.x=b.hx; b.z=b.hz; m.root.rotation.x=0; b.aggroT=0; m.root.position.y=gy; } continue; }
    b.aggroT=Math.max(0,b.aggroT-dt);
    const dx=player.pos.x-b.x, dz=player.pos.z-b.z, dist=Math.hypot(dx,dz), alive=player.hp>0;
    const prov=b.aggroT>0||(performance.now()-(window.__shotT||0)<6000&&dist<50);
    const range=prov?22:14;                                        // далеко — не стреляет
    b.losT-=dt; if(b.losT<=0){ b.losT=0.2+Math.random()*0.1; b.los=alive&&dist<range&&botSee(b); }
    const engaged=alive&&b.los&&dist<range; let mvx=0,mvz=0,spd=0;
    if(engaged){ if(dist>13){ mvx=dx/dist; mvz=dz/dist; spd=1.7; } else if(dist<7){ mvx=-dx/dist; mvz=-dz/dist; spd=1.4; } else { if(Math.random()<dt*0.25) b.sd=-b.sd; mvx=-dz/dist*b.sd; mvz=dx/dist*b.sd; spd=1.0; } }
    else if(prov&&alive&&dist<45&&dist>9){ mvx=dx/dist; mvz=dz/dist; spd=1.9; }
    else { b.wt-=dt;
      if(b.wt<=0){ if(b.wk){ b.wk=false; b.wt=2+Math.random()*4; } else { const a=Math.random()*6.283, r=3+Math.random()*11; b.tx=b.hx+Math.cos(a)*r; b.tz=b.hz+Math.sin(a)*r; b.wk=true; b.wt=9; } }
      if(b.wk){ const ex=b.tx-b.x, ez=b.tz-b.z, d2=Math.hypot(ex,ez); if(d2<0.7){ b.wk=false; b.wt=2+Math.random()*4; } else { mvx=ex/d2; mvz=ez/d2; spd=1.25; } } }
    if(spd>0){ const nx=b.x+mvx*spd*dt, nz=b.z+mvz*spd*dt, h0=heightAt(nx,nz);
      if(!isWaterAt(nx,nz) && Math.abs(h0-gy)<0.6 && Math.hypot(nx-b.hx,nz-b.hz)<48 && !segBlocked(b.x,gy+0.6,b.z,nx+mvx*0.6,gy+0.6,nz+mvz*0.6)){ b.x=nx; b.z=nz; }
      else { spd=0; if(!engaged){ b.wk=false; b.wt=0.6; } } }
    const gy2=heightAt(b.x,b.z);
    let want=b.yaw; if(engaged||(alive&&prov&&dist<range)) want=Math.atan2(dx,dz); else if(spd>0) want=Math.atan2(mvx,mvz);
    let da=want-b.yaw; da=Math.atan2(Math.sin(da),Math.cos(da)); b.yaw+=bzC(da,-dt*6,dt*6);
    b.ph+=dt*spd*3.4; { const sw=Math.sin(b.ph)*Math.min(1,spd/1.3)*0.75; m.legL.hip.rotation.x=sw; m.legR.hip.rotation.x=-sw; m.legL.knee.rotation.x=-Math.max(0,-sw)*0.9; m.legR.knee.rotation.x=-Math.max(0,sw)*0.9; }
    m.root.rotation.y=b.yaw+Math.PI; m.root.position.set(b.x,gy2+Math.sin(performance.now()/700+b.hx)*0.004,b.z);
    if(b.los&&!b._seen){ b._seen=true; b.cd=Math.max(b.cd,1.0+Math.random()*0.6); } else if(!b.los) b._seen=false;
    b.cd-=dt;
    if(b.mag===undefined){ b.mag=15; b.rl=0; }
    if(b.rl>0){ b.rl-=dt; if(b.rl<=0) b.mag=15; }
    else if(b.los&&dist<range&&Math.abs(da)<0.2&&b.cd<=0){ botFire(b); b.mag--; b.burst++; if(b.mag<=0){ b.rl=5; b.burst=0; b.cd=0.8; } else if(b.burst>=2){ b.burst=0; b.cd=1.7+Math.random()*1.3; } else b.cd=0.4; }
  }
}
function takeLoot(){
  const c=lootNear; if(!c||!c.ready) return false;
  const pool=c.kind==='mil'?[['ammo_rifle',30,70],['ammo_pistol',20,40],['metal',60,150],['scrap',30,80],['gunpowder',10,30],['cloth',20,50],['fuel',10,25],['sulfur',15,40]]
                           :[['scrap',20,50],['metal',30,80],['ammo_rifle',20,45],['ammo_pistol',12,30],['wood',40,120],['cloth',10,30],['fuel',5,15],['sulfur',10,30]];
  pool.sort(()=>Math.random()-0.5).slice(0,4).forEach(p=>{ const n=p[1]+Math.floor(Math.random()*(p[2]-p[1]+1)); if(!ITEM_DEFS[p[0]]) return; giveItem(p[0],n); showToast('+'+n+' '+(RES_NAMES[p[0]]||ITEM_DEFS[p[0]].name)); });
  if(c.kind==='mil'&&Math.random()<0.08){ giveItem('eod_suit',1,600); showToast('+ Военная броня'); }
  c.ready=false; c.t=600; c.lid.material.color.set(0x222222);
  lootNear=null; doorUI.classList.remove('show'); try{ OSIL_AUDIO.play('close',{vol:0.6}); }catch(e){}
  updateResourceUI(); return true;
}
document.getElementById('dp-box').addEventListener('pointerdown',()=>{ if(lootNear) takeLoot(); });
window.addEventListener('keydown',e=>{ if(e.code==='KeyE'&&lootNear&&!/INPUT|TEXTAREA/.test((document.activeElement||{}).tagName||'')) takeLoot(); });
initRoadWorld();

/* ================= Коптер (автожир) + звук моря ================= */
const copter={exists:false,hp:100,max:100,hitT:0,owner:'me',pilot:false,x:0,z:0,y:0,yaw:Math.PI*0.5,vx:0,vz:0,vy:0,spool:0,climbT:0,rot:0,grp:null,blades:null,near:false,thr:0,col:0,startT:0,hdg:Math.PI*0.5};
(function(){
  const g=new THREE.Group();
  const R=(a,b)=>a+Math.random()*(b-a);
  const mk=(w,h,fn)=>{ const cv=document.createElement('canvas'); cv.width=w; cv.height=h; fn(cv.getContext('2d'),w,h); const t=new THREE.CanvasTexture(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=4; return t; };
  // ржавый потёртый металл: основа, сколы, подтёки, царапины, заклёпки
  const rt=mk(256,256,(x,w,h)=>{
    x.fillStyle='#4a3a30'; x.fillRect(0,0,w,h);
    for(let i=0;i<900;i++){ x.fillStyle='rgba('+(70+R(0,80)|0)+','+(40+R(0,32)|0)+',25,'+R(.12,.4)+')'; x.fillRect(R(0,w),R(0,h),R(1,6),R(1,3)); }
    for(let i=0;i<28;i++){ x.fillStyle='rgba(20,14,10,'+R(.1,.3)+')'; x.fillRect(R(0,w),R(0,h*.5),R(1,3),R(20,90)); }
    x.strokeStyle='rgba(190,175,160,.35)'; for(let i=0;i<60;i++){ x.lineWidth=R(.4,1.1); const px=R(0,w),py=R(0,h); x.beginPath(); x.moveTo(px,py); x.lineTo(px+R(-22,22),py+R(-6,6)); x.stroke(); }
    x.fillStyle='rgba(15,12,10,.6)'; for(let i=0;i<70;i++){ x.beginPath(); x.arc(R(0,w),R(0,h),1.1,0,7); x.fill(); } });
  const bump=mk(128,128,(x,w,h)=>{ x.fillStyle='#808080'; x.fillRect(0,0,w,h); for(let i=0;i<400;i++){ const v=R(40,220)|0; x.fillStyle='rgba('+v+','+v+','+v+',.35)'; x.fillRect(R(0,w),R(0,h),R(1,4),R(1,4)); } });
  // протектор шины
  const tread=mk(128,64,(x,w,h)=>{ x.fillStyle='#161617'; x.fillRect(0,0,w,h); x.fillStyle='#0b0b0c'; for(let i=0;i<w;i+=8) x.fillRect(i,0,4,h); for(let i=0;i<300;i++){ x.fillStyle='rgba(90,85,78,'+R(.05,.16)+')'; x.fillRect(R(0,w),R(0,h),2,2); } });
  const M=(c,r,m,map,bm)=>new THREE.MeshStandardMaterial({color:c,roughness:r===undefined?0.75:r,metalness:m===undefined?0.35:m,map:map||null,bumpMap:bm||null,bumpScale:0.5});
  const steel=M(0x6a4a3a,0.7,0.4,rt,bump), steelD=M(0x2b2b2e,0.55,0.6), red=M(0xb3301f,0.55,0.25,rt,bump), tire=M(0xffffff,0.95,0,tread), rim=M(0x7b4a2c,0.65,0.55,rt), blk=M(0x101012,0.7,0.2), seatM=M(0x33353a,0.9,0.15,rt), chrome=M(0x9a9a9a,0.3,0.9);
  const add=(o)=>{ o.castShadow=true; o.receiveShadow=true; g.add(o); return o; };
  const UP=new THREE.Vector3(0,1,0);
  const tube=(p,q,r,mat)=>{ const a=new THREE.Vector3(...p), b=new THREE.Vector3(...q), d=b.clone().sub(a), L=d.length(); const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,L,14),mat); m.position.copy(a).addScaledVector(d,0.5); m.quaternion.setFromUnitVectors(UP,d.normalize()); return add(m); };
  const joint=(p,r,mat)=>{ const m=new THREE.Mesh(new THREE.SphereGeometry(r*1.35,10,8),mat||steelD); m.position.set(...p); return add(m); };   // муфты на стыках трубок
  const box=(w,h,d,mat,x,y,z,rx,ry,rz)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); m.position.set(x,y,z); m.rotation.set(rx||0,ry||0,rz||0); return add(m); };
  const cyl=(r1,r2,h,mat,x,y,z,rx,rz,seg)=>{ const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,seg||18),mat); m.position.set(x,y,z); m.rotation.set(rx||0,0,rz||0); return add(m); };
  // --- колёса: шина с протектором, обод, болты ступицы
  const wheel=(x,y,z,Rr,w)=>{ const wg=new THREE.Group(); wg.position.set(x,y,z);
    const t=new THREE.Mesh(new THREE.TorusGeometry(Rr*0.78,Rr*0.27,16,32),tire); t.rotation.y=Math.PI/2; t.scale.set(w,1,1); wg.add(t);
    const h=new THREE.Mesh(new THREE.CylinderGeometry(Rr*0.56,Rr*0.56,w*Rr*0.9,24),rim); h.rotation.z=Math.PI/2; wg.add(h);
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(Rr*0.16,Rr*0.16,w*Rr*1.15,12),steelD); cap.rotation.z=Math.PI/2; wg.add(cap);
    for(let i=0;i<6;i++){ const a=i*Math.PI/3, b=new THREE.Mesh(new THREE.CylinderGeometry(Rr*0.035,Rr*0.035,w*Rr*1.0,6),chrome); b.rotation.z=Math.PI/2; b.position.set(0,Math.cos(a)*Rr*0.34,Math.sin(a)*Rr*0.34); wg.add(b); }
    wg.traverse(o=>{o.castShadow=true}); g.add(wg); };
  wheel(-0.88,0.3,0.4,0.3,0.9); wheel(0.88,0.3,0.4,0.3,0.9); wheel(0,0.2,-2.05,0.2,0.8);
  tube([-0.88,0.3,0.4],[0.88,0.3,0.4],0.03,steelD);
  tube([-0.8,0.32,0.4],[0,0.62,-1.2],0.04,steel); tube([0.8,0.32,0.4],[0,0.62,-1.2],0.04,steel);
  tube([-0.8,0.32,0.4],[0,0.62,0.7],0.035,steel); tube([0.8,0.32,0.4],[0,0.62,0.7],0.035,steel);
  tube([0,0.62,-2.05],[0,0.62,1.2],0.055,steel);
  tube([0,0.62,-2.05],[0,0.22,-2.05],0.035,steelD);
  tube([0,0.62,1.2],[0,0.95,2.35],0.04,steel);
  [[-0.8,0.32,0.4],[0.8,0.32,0.4],[0,0.62,-1.2],[0,0.62,0.7],[0,0.62,-2.05],[0,0.62,1.2],[0,0.95,2.35]].forEach(p=>joint(p,0.04));
  // --- хвостовое оперение: киль с рёбрами жёсткости и знак «GO»
  box(0.04,0.55,0.5,steel,0,1.2,2.4); box(0.05,0.14,0.28,steelD,0,0.93,2.3);
  box(0.06,0.03,0.52,steelD,0,1.48,2.4); box(0.06,0.52,0.03,steelD,0,1.2,2.16);
  const cv=document.createElement('canvas'); cv.width=cv.height=128; const cx=cv.getContext('2d'); cx.fillStyle='#b3301f'; cx.beginPath(); for(let i=0;i<8;i++){ const a=Math.PI/8+i*Math.PI/4; cx.lineTo(64+60*Math.cos(a),64+60*Math.sin(a)); } cx.closePath(); cx.fill(); cx.lineWidth=5; cx.strokeStyle='#fff'; cx.stroke(); cx.fillStyle='#fff'; cx.font='bold 54px sans-serif'; cx.textAlign='center'; cx.fillText('GO',64,82);
  const gm=new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(cv),transparent:true,side:THREE.DoubleSide,roughness:0.7});
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(0.5,0.5),gm); sign.rotation.y=Math.PI/2; sign.position.set(0.03,1.3,2.15); g.add(sign);
  // --- кресло пилота: подушка, спинка, подголовник, ремень
  box(0.46,0.06,0.44,seatM,0,0.7,-0.5); box(0.46,0.5,0.06,seatM,0,0.98,-0.27,-0.12);
  box(0.22,0.14,0.07,seatM,0,1.28,-0.24,-0.12);
  tube([-0.22,0.62,-0.4],[-0.22,0.95,-0.25],0.022,steel); tube([0.22,0.62,-0.4],[0.22,0.95,-0.25],0.022,steel);
  box(0.06,0.5,0.015,M(0x3b3f2a,0.9,0),-0.1,0.96,-0.31,-0.12,0,0.5); box(0.06,0.5,0.015,M(0x3b3f2a,0.9,0),0.1,0.96,-0.31,-0.12,0,-0.5);
  // --- двигатель, ребристые цилиндры, бак «FUEL», выхлоп
  box(0.42,0.32,0.4,steelD,0,0.9,0.5); for(let i=0;i<4;i++) box(0.46,0.02,0.34,steel,0,0.8+i*0.07,0.5);
  cyl(0.035,0.035,0.34,steelD,0.12,0.88,0.72,Math.PI/2,0,10); cyl(0.035,0.035,0.34,steelD,-0.12,0.88,0.72,Math.PI/2,0,10);
  const fc=mk(128,64,(x,w,h)=>{ x.fillStyle='#b3301f'; x.fillRect(0,0,w,h); for(let i=0;i<120;i++){ x.fillStyle='rgba(30,10,5,'+R(.05,.2)+')'; x.fillRect(R(0,w),R(0,h),R(1,5),R(1,3)); } x.fillStyle='#f2f2f2'; x.font='bold 30px sans-serif'; x.textAlign='center'; x.fillText('FUEL',64,44); });
  box(0.42,0.3,0.36,M(0xffffff,0.55,0.15,fc),0,1.22,0.45); cyl(0.04,0.045,0.07,chrome,0.1,1.39,0.45,0,0,12);
  tube([0.15,0.82,0.62],[0.3,0.74,1.0],0.03,steelD); tube([0.3,0.74,1.0],[0.34,0.7,1.2],0.04,steelD);
  // --- управление пилота: ручка, педали (без приборной панели)
  tube([0,0.64,-0.98],[0,1.08,-0.82],0.02,steelD); box(0.05,0.1,0.05,blk,0,1.12,-0.8,0.3);
  box(0.12,0.03,0.09,steelD,-0.15,0.52,-0.98,0.3); box(0.12,0.03,0.09,steelD,0.15,0.52,-0.98,0.3);
  tube([-0.15,0.62,-1.02],[-0.15,0.52,-0.98],0.012,steelD); tube([0.15,0.62,-1.02],[0.15,0.52,-0.98],0.012,steelD);
  tube([0,0.62,-1.15],[0,1.1,-1.1],0.022,steel);
  // --- руль направления и хвостовой костыль
  box(0.03,0.36,0.2,steelD,0,1.2,2.66); tube([0,0.95,2.35],[0,0.55,2.5],0.02,steelD);
  tube([0,0.95,2.35],[0.0,1.2,2.62],0.012,blk);
  // --- мачта и головка винта
  tube([-0.12,0.9,0.3],[0,2.45,-0.05],0.035,steel); tube([0.12,0.9,0.3],[0,2.45,-0.05],0.035,steel); tube([0,0.95,0.15],[0,2.5,-0.05],0.05,steelD);
  cyl(0.09,0.12,0.22,steelD,0,2.5,-0.05,0,0,18); joint([0,2.5,-0.05],0.06,steelD);
  // --- ротор: 2 лопасти со сужением и закруткой, чёрные законцовки, болты крепления
  const hub=new THREE.Group(); hub.position.set(0,2.66,-0.05); g.add(hub);
  hub.add(new THREE.Mesh(new THREE.BoxGeometry(0.34,0.1,0.14),steelD));
  const wmat=M(0x3a2c24,0.55,0.25,rt,bump);
  for(const s of [-1,1]){
    const bl=new THREE.Group(); bl.rotation.z=s*0.05; hub.add(bl);
    const seg=[[0.17,0.17,0.26],[0.57,0.9,0.23],[1.37,0.7,0.2]];
    let off=0.17; seg.forEach((sg,i)=>{ const len=sg[1], m=new THREE.Mesh(new THREE.BoxGeometry(len,0.032,sg[2]),wmat); m.position.x=s*(off+len/2); m.rotation.x=s*(0.14-i*0.04); m.castShadow=true; bl.add(m); off+=len; });
    for(let i=0;i<3;i++){ const st=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.036,0.2),blk); st.position.x=s*(off+0.085+i*0.17); st.rotation.x=s*0.06; bl.add(st); }
    for(let k=0;k<2;k++){ const bt=new THREE.Mesh(new THREE.CylinderGeometry(0.014,0.014,0.05,6),chrome); bt.position.set(s*(0.26+k*0.1),0.03,0); bl.add(bt); }
  }
  const disc=new THREE.Mesh(new THREE.CircleGeometry(2.7,28),new THREE.MeshBasicMaterial({color:0xbbbbbb,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide})); disc.rotation.x=-Math.PI/2; disc.position.set(0,2.66,-0.05); disc.raycast=()=>{}; g.add(disc);
  g.rotation.order='YXZ'; g.visible=false; scene.add(g);
  copter.grp=g; copter.blades=hub; hub.userData.isHub=true; copter.disc=disc;
})();
let copterGhost = null;
function updateCopterGhost(){
  const sl = hotbarSlots[selectedSlot];
  const on = sl && sl.k==='copter' && !copter.exists && !copter.pilot && copter.grp && !panelsOpen();
  if(!on){ if(copterGhost){ scene.remove(copterGhost); copterGhost = null; } return; }
  if(!copterGhost){
    copterGhost = copter.grp.clone(true); copterGhost.visible = true;
    copterGhost.traverse(o=>{ if(o.isMesh){ o.material = Array.isArray(o.material) ? o.material.map(m=>m.clone()) : o.material.clone(); (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ m.transparent = true; m.opacity = 0.5; m.depthWrite = false; }); o.castShadow = false; } });
    scene.add(copterGhost);
  }
  const x = player.pos.x - Math.sin(player.yaw)*6, z = player.pos.z - Math.cos(player.yaw)*6, y = heightAt(x,z);
  copterGhost.position.set(x,y,z); copterGhost.rotation.set(0,player.yaw,0);
  const bad = isWaterAt(x,z) || copterBlockedAt(x,y,z), col = bad ? 0xff5555 : 0x66ff66;
  copterGhost.traverse(o=>{ if(o.isMesh) (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ if(m.color) m.color.set(col); if(m.emissive) m.emissive.set(0); }); });
}
function placeCopter(){
  if(donLocked('copter')){ showToast('Миникоптер — донат-предмет: купите его во вкладке «Донат»'); return; }
  if(copter.exists){ showToast('Ваш коптер уже стоит в мире. Разбейте его, чтобы поставить новый'); return; }
  const d=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw)), x=player.pos.x+d.x*6, z=player.pos.z+d.z*6;
  if(isWaterAt(x,z)){ showToast('Нельзя поставить на воду'); return; }
  if(copterBlockedAt(x,heightAt(x,z),z)){ showToast('Здесь тесно — отойдите от построек'); return; }
  const sl=hotbarSlots[selectedSlot]; if(!sl||sl.k!=='copter') return;
  removeItem('copter',1);
  Object.assign(copter,{exists:true,hp:100,max:100,hitT:0,x:x,z:z,y:heightAt(x,z),vx:0,vz:0,vy:0,spool:0,col:0,thr:0,pilot:false,hdg:player.yaw,yaw:player.yaw});
  copter.grp.visible=true; copter.grp.position.set(x,copter.y,z); copter.grp.rotation.set(0,player.yaw,0);
  syncBuildMode&&syncBuildMode(); updateResourceUI(); showToast('Миникоптер поставлен — он только ваш');
}
function copterDamage(n, why){
  const c=copter; if(!c.exists||n<=0) return;
  c.hp=Math.max(0,c.hp-n); c.hitT=performance.now();
  if(c.hp<=0){ copterDestroy(); return; }
  if(why) showToast('Коптер: '+Math.ceil(c.hp)+' / '+c.max+' ('+why+')');   // при ударах/выстрелах хп видно на экране, как у построек; тост — только при аварии (пилот не может целиться)
}
function copterDestroy(){
  const c=copter; if(!c.exists) return;
  satchelExplode({p:new THREE.Vector3(c.x,c.y+1,c.z), n:new THREE.Vector3(0,1,0), pid:1, noHurt:true});
  spawnDebris(new THREE.Vector3(c.x,c.y+1,c.z),'scrap',30,1.6);
  if(c.pilot){ c.pilot=false; copterAudio(false); player.pos.set(c.x,Math.max(heightAt(c.x,c.z),c.y-0.3),c.z); player.velY=0; if(typeof damagePlayer==='function') damagePlayer(35); else player.hp=Math.max(1,player.hp-35); }
  c.exists=false; c.grp.visible=false; c.spool=0; c.near=false; if(c.btn) c.btn.style.display='none';
  showToast('Коптер уничтожен');
}
const _cRay=new THREE.Raycaster();
function hitCopterRay(w, range){
  const c=copter; if(!c.exists||c.pilot||!WEAPON_DMG[w]) return false;
  aimRay(range); _cRay.ray.copy(_bRay.ray); _cRay.far=range;
  const hit=_cRay.intersectObject(c.grp,true)[0]; if(!hit) return false;
  spawnDebris(hit.point,'scrap',5,0.7); if(range<10) OSIL_AUDIO.play('chop');
  copterDamage(WEAPON_DMG[w]*BUILD_DMG_K,'');   // урон оружия по коптеру как по постройкам
  return true;
}
const copterHold={up:false,down:false};
(function(){ const bind=(id,k)=>{ const el=document.getElementById(id); if(!el) return; const on=()=>{ copterHold[k]=true; }, off=()=>{ copterHold[k]=false; };
  ['touchstart','pointerdown','mousedown'].forEach(e=>el.addEventListener(e,on,{passive:true})); ['touchend','touchcancel','pointerup','pointercancel','mouseup','mouseleave'].forEach(e=>el.addEventListener(e,off,{passive:true})); };
  bind('btn-jump','up'); bind('btn-crouch','down'); })();
const CAud={ctx:null,n:null};
function audioCtx(){ const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return null; if(!CAud.ctx) CAud.ctx=new AC(); if(CAud.ctx.state==='suspended') CAud.ctx.resume(); return CAud.ctx; }
function pulseWave(c,k){ const N=24, re=new Float32Array(N), im=new Float32Array(N); for(let i=1;i<N;i++){ re[i]=1/Math.pow(i,k); } return c.createPeriodicWave(re,im); }
const HELI={buf:{},n:null,loading:false};
async function heliLoad2(){ if(HELI.loading) return; HELI.loading=true; const c=audioCtx(); if(!c) return;
  for(const k of ['slow','run']){ try{ const r=await fetch('assets/sounds/heli_'+k+'.mp3'), ab=await r.arrayBuffer(); HELI.buf[k]=await new Promise((res,rej)=>c.decodeAudioData(ab,res,rej)); }catch(e){} } }
function copterAudio(on){
  if(on&&!HELI.n){
    const c=audioCtx(); if(!c) return; heliLoad2();
    const out=c.createGain(); out.gain.value=0; out.connect(c.destination); HELI.n={c,out,src:{},gain:{}};
  } else if(!on&&HELI.n){ const n=HELI.n; for(const k in n.src){ try{ n.src[k].stop(); }catch(e){} } try{ n.out.disconnect(); }catch(e){} HELI.n=null; }
}
function heliTick(spool,thr,pilot,dist){
  const n=HELI.n; if(!n) return; const c=n.c, t=c.currentTime;
  for(const k of ['slow','run']){ if(!n.src[k]&&HELI.buf[k]){ const s=c.createBufferSource(); s.buffer=HELI.buf[k]; s.loop=true; const gn=c.createGain(); gn.gain.value=0; s.connect(gn); gn.connect(n.out); s.start(0,Math.random()*2); n.src[k]=s; n.gain[k]=gn; } }
  const vol=(CFG.volSfx/10)*(CFG.volMaster/10), hear=pilot?1:Math.max(0,1-dist/90);
  if(n.src.slow){ n.src.slow.playbackRate.setTargetAtTime(0.55+spool*0.5+thr*0.12,t,0.2); n.gain.slow.gain.setTargetAtTime(Math.min(1,spool*1.4)*(1-Math.min(1,thr*1.6))*0.9,t,0.25); }
  if(n.src.run){ n.src.run.playbackRate.setTargetAtTime(0.8+spool*0.15+thr*0.2,t,0.25); n.gain.run.gain.setTargetAtTime(Math.pow(spool,2)*Math.min(1,thr*1.6)*0.95,t,0.3); }
  n.out.gain.setTargetAtTime(vol*hear,t,0.15);
}
function copterTake(){
  if(copter.pilot){   // слезть: только невысоко над землёй
    copter.pilot=false; copter.engOffT=performance.now(); const sx=Math.cos(copter.yaw)*2.2, sz=-Math.sin(copter.yaw)*2.2;
    const _gy=heightAt(copter.x+sx,copter.z+sz), _air=copter.y>_gy+1.5;   // слезть можно в любой момент, в том числе в воздухе
    player.pos.set(copter.x+sx,_air?Math.max(_gy,copter.y-1.2):_gy,copter.z+sz); player.velY=_air?Math.min(0,copter.vy||0):0; return;
  }
  if(!copter.exists||!copter.near||player.hp<=0) return;
  if(isCrouching) setCrouch(false); copter.pilot=true; copter.hdg=player.yaw; copter.vx=copter.vz=copter.vy=0; copter.col=0; copter.startT=0; copterAudio(true);
}
/* плиты построек (фундамент/пол/лестница): коптер садится на них, бьётся об них и не проваливается сквозь них.
   fn(top, bot, inner): inner — коптер целиком над плитой (±0.3 м), иначе он только задел её краем */
function copterSlabs(x, z, fn, m){
  m = m===undefined ? 0.4 : m;
  cells.forEach(rec=>{ const o = rec.obj; if(!o) return;
    const ax = Math.abs(x-o.position.x), az = Math.abs(z-o.position.z); if(ax > 2+m || az > 2+m) return;
    const h = rec.type==='foundation' ? 1.6 : 0.15; fn(o.position.y+h/2, o.position.y-h/2, ax<2.3 && az<2.3); });
  stairsMap.forEach(s=>{ const dx = x-s.x, dz = z-s.z; if(Math.abs(dx) > 3.6 || Math.abs(dz) > 3.6) return;
    const c = Math.cos(s.rotY), sn = Math.sin(s.rotY), lx = dx*c-dz*sn, lz = dx*sn+dz*c;
    if(Math.abs(lx) > 1.2+m || Math.abs(lz) > 2+m) return;
    fn(s.y0+Math.max(0, Math.min(FLOOR_H, FLOOR_H*(2-lz)/4)), s.y0-0.2, Math.abs(lx)<1.5 && Math.abs(lz)<2.3); });
}
/* опора под коптером: земля или верх плиты постройки, которая ниже него */
function copterGround(x, z, y){ let g = heightAt(x,z); { const cs = colNear(x,z,1.3); for(let i=0;i<cs.length;i++){ const k=cs[i]; if(!k.walk) continue; const b=k.box; if(x>b.min.x-0.9&&x<b.max.x+0.9&&z>b.min.z-0.9&&z<b.max.z+0.9&&b.max.y<=y+0.25&&b.max.y>g) g=b.max.y; } } copterSlabs(x, z, top=>{ if(top <= y+0.25 && top > g) g = top; }); return g; }
function copterBlockedAt(x, y, z){
  for(const k of colliders){ const b = k.box; if(x>b.min.x-1.2 && x<b.max.x+1.2 && z>b.min.z-1.2 && z<b.max.z+1.2 && y+2.9>b.min.y && y<b.max.y-0.1) return true; }
  let hit = false; copterSlabs(x, z, (top,bot)=>{ if(y < top && y+2.9 > bot) hit = true; }, 1.1);
  return hit;
}
function updateCopter(dt){
  const c=copter; if(player.hp<=0){ c.pilot=false; return; }
  let fwd=0,str=0; if(keys['KeyW']) fwd+=1; if(keys['KeyS']) fwd-=1; if(keys['KeyD']) str+=1; if(keys['KeyA']) str-=1;
  if(joyActive){ fwd-=joyVec.y; str+=joyVec.x; } const l=Math.hypot(fwd,str); if(l>1){ fwd/=l; str/=l; }
  const lift=Math.max(0,Math.min(1,(c.spool-0.45)/0.4));          // тяга винта появляется только после раскрутки
  const gy=copterGround(c.x,c.z,c.y), air=c.y-gy>0.35;
  let up=0; if(keys['Space']||copterHold.up||c.climbT>0) up=1; if(keys['ControlLeft']||keys['KeyC']||copterHold.down) up=-1; c.climbT=Math.max(0,c.climbT-dt);
  // «шаг» винта: растёт медленно, спадает быстрее — взлёт плавный и с задержкой
  c.col+=((up>0?1:0)-c.col)*Math.min(1,dt*(up>0?0.8:1.6));
  let ty = up>0 ? c.col*5.2*lift : (up<0 ? -4.5 : (air ? -1.1 : 0));
  if(!air && ty<0) ty=0;
  c.vy+=(ty-c.vy)*Math.min(1,dt*(ty>c.vy?0.9:1.8));
  let dh=player.yaw-c.hdg; dh=Math.atan2(Math.sin(dh),Math.cos(dh)); c.hdg+=Math.max(-dt*0.8,Math.min(dt*0.8,dh));   // поворот плавный, не мгновенный
  const sY=Math.sin(c.hdg), cY=Math.cos(c.hdg), sp=air?19:2.5, k=lift>0.3?1:0;
  const tx=(-sY*fwd+cY*str)*sp*k, tz=(-cY*fwd-sY*str)*sp*k, a=Math.min(1,dt*(air?0.7:1.5));
  c.vx+=(tx-c.vx)*a; c.vz+=(tz-c.vz)*a;
  const _px=c.x,_pz=c.z,_py=c.y,_vy0=c.vy;
  const half=WORLD_SIZE/2-2; c.x=Math.max(-half,Math.min(half,c.x+c.vx*dt)); c.z=Math.max(-half,Math.min(half,c.z+c.vz*dt)); c.y=Math.min(130,c.y+c.vy*dt);
  let g2=heightAt(c.x,c.z), hitSlab=false;
  copterSlabs(c.x,c.z,(top,bot,inner)=>{
    if(!(c.y<top-0.02 && c.y+2.9>bot)) return;
    if(inner && _py>=top-0.25) g2=Math.max(g2,top);                                       // сверху — садимся на плиту
    else if(inner && _py+2.9<=bot+0.25){ c.y=Math.min(c.y,bot-2.9); if(c.vy>0) c.vy=0; } // снизу — упёрлись винтом в потолок
    else if(!(_py>=top-0.25) && !(_py+2.9<=bot+0.25)) hitSlab=true;                       // сбоку — как стена
  },1.1);
  { const cs = colNear(c.x,c.z,1.3); for(let i=0;i<cs.length;i++){ const k=cs[i]; if(!k.walk) continue; const b=k.box; if(c.x>b.min.x-0.9&&c.x<b.max.x+0.9&&c.z>b.min.z-0.9&&c.z<b.max.z+0.9&&_py>=b.max.y-0.25&&b.max.y>g2) g2=b.max.y; } }   // садимся на крыши/контейнеры/технику
  if(c.y<g2){ if(_vy0<-5){ copterDamage((-_vy0-4)*9,'жёсткая посадка'); if(!c.exists) return; } c.y=g2; if(c.vy<0) c.vy=0; }
  { const sp=Math.hypot(c.vx,c.vz); let blocked=hitSlab;
    if(!blocked) for(const k of colliders){ const b=k.box;
      if(c.x>b.min.x-1.2&&c.x<b.max.x+1.2&&c.z>b.min.z-1.2&&c.z<b.max.z+1.2&&c.y+2.9>b.min.y&&c.y<b.max.y-0.1){ blocked=true; break; } }
    if(blocked){ c.x=_px; c.z=_pz; c.y=Math.max(c.y,_py); const hv=Math.max(sp,Math.abs(c.vy)); c.vx*=-0.25; c.vz*=-0.25;
      if(hv>2.5) copterDamage(hv*3.2,'столкновение'); if(!c.exists) return; } }
  c.thr=Math.min(1,c.col*lift*0.7+Math.hypot(c.vx,c.vz)/19*0.5+(up<0?0.1:0));
  const g=c.grp; g.position.set(c.x,c.y,c.z); g.rotation.y=c.hdg;
  const pitch=-fwd*0.16*Math.min(1,Math.hypot(c.vx,c.vz)/6+0.2)*(air?1:0), roll=-str*0.18*(air?1:0);
  g.rotation.x+=(pitch-g.rotation.x)*Math.min(1,dt*2.2); g.rotation.z+=(roll-g.rotation.z)*Math.min(1,dt*2.2);
  // игрок сидит в кресле: ближе к носу и ниже
  const fx=-Math.sin(c.hdg)*0.5, fz=-Math.cos(c.hdg)*0.5;
  player.pos.set(c.x+fx,c.y-0.45,c.z+fz); player.velY=0; player.onGround=false;
  try{ OSIL_AUDIO.walk(false,false); }catch(e){}
}
function updateCopterFX(dt){
  const c=copter; if(!c.grp) return;
  if(!c.exists){ c.near=false; if(c.btn) c.btn.style.display='none'; return; }
  if(c.pilot){ c.startT+=dt; c.spool=Math.max(0,Math.min(1,c.spool+dt/2.6)); }   // 1.2 с стартёр, потом ~4.5 с раскрутка
  else { c.spool=Math.max(0,c.spool-dt/6); c.vx*=0.97; c.vz*=0.97; const gy=copterGround(c.x,c.z,c.y); if(c.y>gy+0.02){ c.vy=Math.max(c.vy-4*dt,-6); c.y=Math.max(gy,c.y+c.vy*dt); c.grp.position.y=c.y; if(c.y<=gy) c.vy=0; } c.thr=0; c.col=0; }
  c.rot+=dt*c.spool*(20+c.thr*10); c.blades.rotation.y=c.rot; if(c.tail) c.tail.rotation.x=c.rot*1.7; if(c.disc) c.disc.material.opacity=Math.pow(c.spool,2)*0.13;
  if(HELI.n){ heliTick(c.spool,c.thr,c.pilot,Math.hypot(player.pos.x-c.x,player.pos.z-c.z)); if(!c.pilot&&c.spool<=0.01) copterAudio(false); }
  const near=!c.pilot&&player.hp>0&&Math.hypot(player.pos.x-c.x,player.pos.z-c.z)<3.4&&Math.abs(player.pos.y-c.y)<3&&!panelsOpen();
  c.near=near;
  if(!c.btn){ const bt=document.createElement('button'); bt.id='copter-btn'; bt.style.cssText='position:fixed;z-index:9;display:none;padding:10px 16px;border:none;border-radius:0;background:rgba(34,33,31,.82);color:#fff;font:600 12px/1 var(--rf,sans-serif);letter-spacing:.8px;text-transform:uppercase;transform:translate(-50%,-100%);touch-action:manipulation';
    ['pointerdown'].forEach(ev=>bt.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); copterTake(); })); document.body.appendChild(bt); c.btn=bt; }
  const show=(near||c.pilot)&&!document.body.classList.contains('ui-open');
  if(show){ const hb=document.getElementById('hotbar'), r=hb?hb.getBoundingClientRect():{right:window.innerWidth*0.7,top:window.innerHeight-70};
    c.btn.style.left=Math.round(r.right-24)+'px'; c.btn.style.top=Math.round(r.top-10)+'px'; c.btn.textContent=c.pilot?'СЛЕЗТЬ':'СЕСТЬ В КОПТЕР'; }
  c.btn.style.display=show?'':'none';
}
window.addEventListener('keydown',e=>{ if(e.code==='KeyE'&&(copter.near||copter.pilot)&&!/INPUT|TEXTAREA/.test((document.activeElement||{}).tagName||'')) copterTake(); });

const SEA={g:null,started:false,vol:0,t:0};
async function seaStart(){
  if(SEA.started) return; SEA.started=true;
  const c=audioCtx(); if(!c){ SEA.started=false; return; }
  const gn=c.createGain(); gn.gain.value=0; gn.connect(c.destination); SEA.g=gn;
  let ok=false;
  try{ const r=await fetch('assets/sounds/sea.mp3'); const ab=await r.arrayBuffer(); const buf=await new Promise((res,rej)=>c.decodeAudioData(ab,res,rej));
    const s=c.createBufferSource(); s.buffer=buf; s.loop=true; s.connect(gn); s.start(); ok=true; }catch(e){}
  if(!ok){   // запасной вариант: шум прибоя с медленными волнами
    const nb=c.createBuffer(1,c.sampleRate*4,c.sampleRate), d=nb.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    const s=c.createBufferSource(); s.buffer=nb; s.loop=true; const lp=c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=700;
    const sw=c.createGain(); sw.gain.value=0.5; const lfo=c.createOscillator(); lfo.frequency.value=0.11; const lg=c.createGain(); lg.gain.value=0.4; lfo.connect(lg); lg.connect(sw.gain);
    s.connect(lp); lp.connect(sw); sw.connect(gn); s.start(); lfo.start(); }
}
['pointerdown','keydown','touchstart','click'].forEach(ev=>window.addEventListener(ev,()=>{ seaStart(); if(CAud.ctx&&CAud.ctx.state==='suspended') CAud.ctx.resume(); },{passive:true}));
function updateSeaSound(dt){
  if(!SEA.g) return;
  SEA.t-=dt; if(SEA.t<=0){ SEA.t=0.4;
    let dm=999; const px=player.pos.x, pz=player.pos.z;
    if(heightAt(px,pz)<0.3) dm=0; else for(let a=0;a<16&&dm>0;a++){ const cx=Math.cos(a*0.3927), cz=Math.sin(a*0.3927); for(const r of [6,12,22,36,55,80,110,150]){ if(r>=dm) break; if(heightAt(px+cx*r,pz+cz*r)<0.2){ dm=r; break; } } }
    SEA.vol=Math.max(0.12,Math.pow(Math.max(0,1-dm/150),1.2))*(copter.pilot?0.4:1);
  }
  const target=SEA.vol*0.9*(CFG.volMusic/10)*(CFG.volMaster/10), t=SEA.g.context.currentTime; SEA.g.gain.setTargetAtTime(target,t,0.6);
}

function animate(ts){
  requestAnimationFrame(animate);                       // строго по vsync
  const now = ts || performance.now();                  // rAF-метка = момент vsync (стабильнее performance.now())
  measureRefresh(now);
  const el = now - lastTime;
  // лимит: рисуем, когда накопился интервал минус пол-тика экрана (допуск на джиттер). 60 на 120 Гц = ровно каждый 2-й vsync
  if(FPS_CAP_MS && el < FPS_CAP_MS - _refreshMs*0.5) return;
  lastTime = (FPS_CAP_MS && el < FPS_CAP_MS*2) ? lastTime + FPS_CAP_MS : now;   // без дрейфа
  // dt = реальное время между показанными кадрами, прилипшее к целому числу vsync (убирает джиттер таймстампов → плавное движение)
  let rd = _lastRenderTs ? now - _lastRenderTs : _refreshMs; _lastRenderTs = now;
  const nT = Math.max(1, Math.round(rd/_refreshMs));
  if(Math.abs(rd - nT*_refreshMs) < _refreshMs*0.3) rd = nT*_refreshMs;
  const dt = Math.min(0.05, rd/1000);
  updateFPS(now);

  if(!document.getElementById('start-screen').classList.contains('hidden')) {
    renderer.render(scene, camera);
    return;
  }

  if(gamePaused){ renderer.render(scene, camera); return; }

  updateMovement(dt);
  updateHarvest(dt); updateFalling(dt);
  updateBoars(dt); updateRoadWorld(dt); updateCopterFX(dt); updateSeaSound(dt);
  updatePlayerModel(dt);
  updateDebris(dt);
  updateDoors(dt); updateDoorPrompt(); updateHammerPrompt(dt); updatePartHud(dt); updateSatchels(dt); decayTick(dt); craftQueueTick(dt); quarryTick(dt); deathTick(); sackTick(dt); hudSafety();
  updateViewmodel(dt);
  if(attackHeld) doHit(true);
  tickSurvival(dt);
  updateWorldPickups(dt);
  updateGhost(); updateCopterGhost();
  updateStatsUI();
  updateMinimap(dt);
  seaAnim();
  updateCulling(dt);
  updateSky(dt);
  followSun(player.pos.x, player.pos.y, player.pos.z);
  // Карта теней (самая дорогая часть кадра) обновляется, только когда сдвинулось солнце-окно,
  // сменился набор объектов или раз в 0.3 с (динамические объекты) — а не каждый кадр.
  shadowTimer += dt;
  const _fly=copter.pilot;
  _shN++;
  const _frameMs = (FPS_CAP_MS && FPS_CAP_MS > _refreshMs) ? FPS_CAP_MS : _refreshMs;
  const _shEvery = Math.max(1, Math.round(33.3/_frameMs));   // ~30 Гц теней, строго через N кадров: ровная нагрузка, без «то 4 мс, то 12 мс»
  if((CFG.lighting===1&&!_fly) || ((shadowDirty || _shN >= _shEvery) && (!_fly || shadowTimer > 0.05))){ renderer.shadowMap.needsUpdate = true; shadowDirty = false; shadowTimer = 0; _shN = 0; }

  renderer.render(scene, camera);
}
animate();

/* ---------------- Fullscreen + orientation lock ---------------- */
function enterFullscreen(){
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if(req){
    try{ const r = req.call(el); if(r && r.catch) r.catch(()=>{}); }catch(e){}
  }
  if(screen.orientation && screen.orientation.lock){
    screen.orientation.lock('landscape').catch(()=>{});
  }
}

// Полный экран всегда: браузер разрешает его только по жесту, поэтому при КАЖДОМ жесте
// (меню, загрузка, игра), пока мы не в полноэкранном режиме, повторяем запрос.
// Слушатели постоянные — выход из fullscreen (свайп, Esc, сворачивание) возвращает его на следующем касании.
(function(){
  const isFS = ()=> !!(document.fullscreenElement || document.webkitFullscreenElement) || window.matchMedia('(display-mode: fullscreen)').matches;
  function again(){ if(!isFS()) enterFullscreen(); }
  ['pointerdown','touchstart','mousedown','pointerup','touchend','click','keydown'].forEach(e=>document.addEventListener(e,again,true));
  window.addEventListener('load', ()=>setTimeout(again,0)); setTimeout(again,300);
  document.addEventListener('fullscreenchange', ()=>{ if(!isFS()) setTimeout(again,0); });
  document.addEventListener('webkitfullscreenchange', ()=>{ if(!isFS()) setTimeout(again,0); });
})();

// Re-request fullscreen whenever the tab regains focus/visibility.
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible' && !document.fullscreenElement){
    enterFullscreen();
  }
});

/* ---------------- Start screen ---------------- */
document.getElementById('start-btn').addEventListener('click', ()=>{
  OSIL_AUDIO.unlock(); enterFullscreen();   // жест пользователя: разблокируем звук и полный экран
  OSIL_LOADER.enter(()=>{
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('start-screen').style.display='none';
    OSIL_AUDIO.music('ambient');
    if(!isMobile()){ renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock(); }
    showToast('Добро пожаловать на остров');
  });
});

/* ---------------- Menu: servers / top / promo / settings ---------------- */
let mServers = [];
let mSelServer = 0;

function renderMenuServers(){
  const list = document.getElementById('m-servList');
  list.innerHTML = '';
  mServers.forEach((s,i)=>{
    const row = document.createElement('div');
    row.className = 'm-srow' + (i===mSelServer ? ' sel' : '');
    row.innerHTML = '<div class="m-ico"></div><div class="m-nm"><b>'+s.name+'</b><span>'+s.sub+'</span></div><div class="m-pl">'+s.cur+'/'+s.max+'</div><div class="m-pg">'+s.ping+'</div>';
    row.addEventListener('click', ()=>{ mSelServer = i; renderMenuServers(); });
    list.appendChild(row);
  });
  const totalPlayers = mServers.reduce((a,s)=>a+s.cur,0);
  document.getElementById('m-tabSubServ').textContent = mServers.length + ' сервер(ов), ' + totalPlayers + ' игрок(ов)';
}
renderMenuServers();

function renderMenuTop(){
  const base = [['MaFiA_',1523],['Druid',1187],['xX_Les_Xx',964],['Bombardir',730],['Krot',412],['Игрок (вы)',0]];
  base.sort((a,b)=>b[1]-a[1]);
  document.getElementById('m-topList').innerHTML =
    '<div class="m-shead"><span>игрок</span><span>добыча</span><span></span></div>' +
    base.map((r,i)=>'<div class="m-srow"><div class="m-nm"><b>'+(i+1)+'. '+r[0]+'</b></div><div class="m-pl">'+r[1]+'</div><div class="m-pg"></div></div>').join('');
}

document.querySelectorAll('.m-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.m-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    document.getElementById('m-paneServers').classList.toggle('hidden', which!=='servers');
    document.getElementById('m-paneTop').classList.toggle('hidden', which!=='top');
    document.getElementById('m-panePromo').classList.toggle('hidden', which!=='promo');
    document.getElementById('m-paneDonate').classList.toggle('hidden', which!=='donate');
    if(which==='donate'||which==='promo'){ OSIL_ACC.refresh().then(renderDonate); renderDonate(); }
    if(which==='top') renderMenuTop();
  });
});

document.getElementById('m-addServ').addEventListener('click', ()=>{
  const n = prompt('Название сервера:');
  if(n && n.trim()){
    mServers.push({ name:n.trim().slice(0,22), sub:'Custom', cur:0, max:50, ping:20+Math.floor(Math.random()*130) });
    renderMenuServers();
  }
});
document.getElementById('m-refServ').addEventListener('click', ()=>{
  mServers.forEach(s=>{
    if(!s.solo){ s.ping = Math.max(8, s.ping + Math.floor(Math.random()*40-20)); s.cur = Math.floor(Math.random()*(s.max/10)); }
  });
  renderMenuServers();
  showToast('Список обновлён');
});

const MENU_PROMOS = { OSIL2026:100, RUSTLIKE:50, TESTER:25 };
const ADMIN_COINS = 1000;   // монеты за промокод АДМИН6737 / ADMIN6737 (один раз)
let mUsedPromos = []; try{ mUsedPromos = JSON.parse(localStorage.getItem('osil_promos')||'[]'); }catch(e){}
let mCoins = 0; try{ mCoins = +localStorage.getItem('osil_coins')||0; }catch(e){}
function saveCoins(){ try{ localStorage.setItem('osil_coins', String(mCoins)); localStorage.setItem('osil_promos', JSON.stringify(mUsedPromos)); }catch(e){} document.getElementById('m-pCoins').textContent = mCoins; }
setTimeout(saveCoins, 0);
document.getElementById('m-promoBtn').addEventListener('click', ()=>{
  const code = document.getElementById('m-promoIn').value.trim().toUpperCase().replace(/^АДМИН/, 'ADMIN');
  const msg = document.getElementById('m-promoMsg');
  if(!code) return;
  if(window.OSIL_ACC && OSIL_ACC.sess()){
    OSIL_ACC.call('/api/promo', {code}).then(d=>{
      if(d.error){ msg.textContent=d.error; msg.style.color='#d08080'; return; }
      OSIL_ACC.me = d; mCoins = d.coins; document.getElementById('m-pCoins').textContent = d.coins; document.getElementById('m-pLvl').textContent = d.level;
      msg.textContent = d.msg; msg.style.color = '#bcd096'; renderDonate();
    });
    return;
  }
  if(code==='ADMIN6737'){
    ADMIN_FREE = true; try{ localStorage.setItem('osil_admin','1'); }catch(e){}
    adminGrantRes();
    let _cm = '';
    if(!mUsedPromos.includes(code)){ mUsedPromos.push(code); mCoins += ADMIN_COINS; saveCoins(); _cm = ', +'+ADMIN_COINS+' монет'; }
    msg.textContent = 'Админ-режим: бесплатный крафт, +1000 дерева, камня и железа' + _cm; msg.style.color = '#bcd096';
    if(typeof renderCraftUI==='function'){ renderCraftUI(); renderQuickCraft(); }
    return;
  }
  if(mUsedPromos.includes(code)){ msg.textContent='Код уже использован'; msg.style.color='#d08080'; return; }
  if(MENU_PROMOS[code]){
    mCoins += MENU_PROMOS[code];
    mUsedPromos.push(code);
    saveCoins();
    msg.textContent = '+'+MENU_PROMOS[code]+' монет!';
    msg.style.color = '#bcd096';
  } else {
    msg.textContent = 'Неверный код';
    msg.style.color = '#d08080';
  }
});

/* окно настроек — js/settings.js */



/* ---------------- Применение настроек ---------------- */
const hotbarEl = document.getElementById('hotbar'), crossEl = document.getElementById('crosshair');
const _texList=[grassTex,woodTex,barkTex,foliageTex,leafTex,stoneTex,rockOreTex,sulfurTex,metalTex];
const MAX_AN = (renderer.capabilities.getMaxAnisotropy && renderer.capabilities.getMaxAnisotropy()) || 8;
let _texSc=1, _shF=1;
function applyTextures(){
  const sc=[0.25,0.5,0.5,0.75,1][CFG.texQ|0], an=Math.min(MAX_AN,[1,2,4,8,16][CFG.aniso|0]);
  if(sc!==_texSc && _texList.some(t=>!t.image||!t.image.width)){ setTimeout(applyTextures,400); }
  _texList.forEach(t=>{
    t.anisotropy=an; const img=t.image, ok=img&&img.width;
    if(ok && sc!==_texSc){
      if(!t.userData.orig) t.userData.orig=img;
      const o=t.userData.orig;
      if(sc<1){ const c=document.createElement('canvas'); c.width=Math.max(16,Math.round(o.width*sc)); c.height=Math.max(16,Math.round(o.height*sc)); c.getContext('2d').drawImage(o,0,0,c.width,c.height); t.image=c; } else t.image=o;
    }
    if(ok) t.needsUpdate=true;
  });
  if(!_texList.some(t=>!t.image||!t.image.width)) _texSc=sc;
}
function applyShadowFilter(){
  const f=CFG.shadowFilter|0; if(f===_shF) return; _shF=f;
  renderer.shadowMap.type = f ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  scene.traverse(o=>{ if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ m.needsUpdate=true; }); } });
  shadowDirty=true;
}
function applySetting(k){
  const all = (k===null||k===undefined), on = n => all || k===n;
  if(on('res')){
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 3) * Math.max(35, CFG.res + (CFG.ultra ? ultraDyn : 0))/100);
    fitScreen();
  }
  if(on('ultra')){ ultraDyn = 0; ultraLo = ultraHi = 0; if(!all) applySetting('res'); }
  if(on('texQ')||on('aniso')) applyTextures();
  if(on('shadowFilter')) applyShadowFilter();
  if(on('waterQ')) applySeaQuality();
  if(on('shadows')){
    applySeaQuality();
    const lv = CFG.shadows, sz = [1024,1024,2048,2048][lv] || 2048;
    sun.castShadow = lv>0;
    shadowDirty = true;
    if(sun.shadow.mapSize.x !== sz){ sun.shadow.mapSize.set(sz,sz); if(sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; } }
  }
  if(on('shadowDist')){
    const sd = CFG.shadowDist, half = sd*1.25 + 4, cam = sun.shadow.camera;
    cam.left=-half; cam.right=half; cam.top=half; cam.bottom=-half; cam.far = 200 + sd; cam.updateProjectionMatrix();
    SHADOW_R2 = (sd*1.2)*(sd*1.2); shadowDirty = true; updateCulling(0,true);
  }
  if(on('shadows') || on('shadowDist')){ SHADOW_TEXEL = (sun.shadow.camera.right*2)/sun.shadow.mapSize.x; }
  if(on('fpsCap')){ const v=[30,60,90,0][CFG.fpsCap]; FPS_CAP_MS = v ? 1000/v : 0; lastTime = performance.now(); }
  if(on('dist')){
    const far = Math.min(CFG.dist, FOG_MAX);   // туман гарантированно закрывает всё дальше FOG_MAX: ни ряби, ни пустоты под миром
    scene.fog.near = far*0.18; scene.fog.far = far; camera.far = far+10; camera.updateProjectionMatrix();
    CULL_K = (far/150)*(far/150);
    cullables.forEach(c=>{ c.r2 = c.r2b*CULL_K; });
    updateCulling(0,true);
  }
  if(on('fov')){ camera.fov = CFG.fov; camera.updateProjectionMatrix(); }
  if(on('hudOn')) document.body.classList.toggle('hud-off', !CFG.hudOn);
  if(on('fps')) updateFpsVisibility();
  if(on('crosshair') && crossEl) crossEl.style.display = CFG.crosshair ? '' : 'none';
  if(on('minimap') || on('miniSize')){
    miniCanvas.style.display = (CFG.minimap && !mapOpen) ? '' : 'none';
    const px = Math.round(96*CFG.miniSize/100); miniCanvas.style.width = px+'px'; miniCanvas.style.height = px+'px';
  }
  if(on('hotbarSize')){ hotbarEl.style.transform = 'translateX(-50%) scale('+(CFG.hotbarSize/100)+')'; hotbarEl.style.transformOrigin = '50% 100%'; }
  if(on('btnSize')) document.documentElement.style.setProperty('--btn-k', CFG.btnSize/100);
  if(on('volMaster')||on('volSfx')||on('volMusic')||on('volSteps')){
    OSIL_AUDIO.setVolumes({master:CFG.volMaster/10, sfx:CFG.volSfx/10, music:CFG.volMusic/10, steps:CFG.volSteps/10});
  }
}
OSIL_SETTINGS.onChange(applySetting);
applySetting(null);

/* ===== мультиплеер (встроен, чтобы видеть переменные игры) ===== */
/* Мультиплеер: клиент WebSocket, аватары игроков, синхронизация ресурсов/построек/боя, чат,
   список серверов (локальная игра / сохранённые / автопоиск в сети). Грузится после game.js
   и использует его глобальные переменные (player, scene, camera, harvestables, ...). */
window.OSIL_NET = (function(){
  const $ = id => document.getElementById(id);
  const LS_SRV = 'anode_servers', LS_NAME = 'anode_name';
  const TOK = (()=>{ try{ let t = localStorage.getItem('anode_tok'); if(!t){ t = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('anode_tok', t); } return t; }catch(e){ return 'anon' + Math.random().toString(36).slice(2); } })();
  let ws = null, on = false, myId = 0, srvName = '', applying = false, sendT = 0, meleeT = 0, dieSent = false;
  const remotes = new Map();
  const TOOLS = {rock:7, none:0, axe:1, pickaxe:2, rifle:3, spear:4, pistol:5, berdanka:6, smg:8, rpg:9, grenade:10, satchel:11, knife:12, hammer:13}, TOOLN = ['none','axe','pickaxe','rifle','spear','pistol','berdanka','rock','smg','rpg','grenade','satchel','knife','hammer'];

  const toast = m => { try{ showToast(m); }catch(e){} };
  const send = o => { if(ws && ws.readyState===1) ws.send(JSON.stringify(o)); };
  const r2 = v => Math.round(v*100)/100;

  /* ---------------- аватар удалённого игрока ---------------- */
  const COLS = [0x4d5b3d,0x7a3b32,0x33506e,0x6b5a2e,0x5a3d6b,0x2f6b5c,0x8a5a2a,0x555a60];
  function makeAvatar(id, name){
    const rig = buildHumanRig(COLS[id % COLS.length]), root = rig.root;   // та же модель, что видит игрок в 3-м лице
    const c = document.createElement('canvas'); c.width = 256; c.height = 56; const g = c.getContext('2d');
    g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)'; g.fillStyle = '#fff';
    g.strokeText(name,128,38); g.fillText(name,128,38);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c), transparent:true, depthWrite:false}));
    sp.scale.set(1.3,0.284,1); sp.position.y = 2.15; root.add(sp);
    scene.add(root);
    return Object.assign(rig, {id, name, p:new THREE.Vector3(), tp:new THREE.Vector3(), yaw:0, tyaw:0, pitch:0, crouch:0, aim:0, flash:0, fresh:true});
  }
  function setHeld(r, kind){ setRigTool(r, kind); }
  function angDiff(a,b){ let d = (b-a) % (Math.PI*2); if(d > Math.PI) d -= Math.PI*2; if(d < -Math.PI) d += Math.PI*2; return d; }
  function animRemotes(dt){
    remotes.forEach(r=>{
      const ox = r.p.x, oz = r.p.z;
      if(r.fresh){ r.p.copy(r.tp); r.yaw = r.tyaw; r.fresh = false; }
      const k = Math.min(1, dt*12);
      r.p.lerp(r.tp, k); r.yaw += angDiff(r.yaw, r.tyaw)*k;
      const sp = Math.min(12, Math.hypot(r.p.x-ox, r.p.z-oz)/Math.max(dt,1e-3));
      poseRig(r, dt, sp, true, r.crouch, r.pitch, r.aim);
      r.root.position.set(r.p.x, r.p.y - r.crouch*0.18 + Math.abs(Math.cos(r.phase))*0.035*r.amp, r.p.z);
      r.root.rotation.y = r.yaw;
      if(r.flash > 0){ r.flash -= dt; if(r.rifleFlash){ r.rifleFlash.visible = r.flash > 0; r.rifleFlash.rotation.z = Math.random()*6; } }
    });
  }

  /* ---------------- сообщения сервера ---------------- */
  const byNid = n => { const t = (window.__NIDL||[])[n]; if(t && harvestables.indexOf(t)>=0) return t; return harvestables.find(h => h.nid === n); };
  function applyBuild(b){ try{ applying = true; if(b.t==='dr' || b.t==='dl' || b.t==='dok' || b.t==='dno') applyDoorNet(b); else spawnBuilt(b.k, b.x,b.y,b.z,b.r,b.l,b.b,b.tm||0,b.u); }catch(e){ console.warn('build',e); } finally{ applying = false; } }
  function removeRemote(id){ const r = remotes.get(id); if(!r) return; scene.remove(r.root); remotes.delete(id); }
  /* ---------------- мешочки с предметами ---------------- */
  const bags = new Map(); let localBagId = -1, nearBag = null, pickEl = null;
  const bagMat = new THREE.MeshLambertMaterial({color:0x8a6a3b}), knotMat = new THREE.MeshLambertMaterial({color:0x5b4426});
  const bagGeo = new THREE.SphereGeometry(0.24,12,9), neckGeo = new THREE.CylinderGeometry(0.05,0.09,0.12,8), topGeo = new THREE.ConeGeometry(0.08,0.14,8);
  function bagLabel(text){
    const c = document.createElement('canvas'); c.width = 256; c.height = 56; const x = c.getContext('2d');
    x.font = 'bold 28px sans-serif'; x.textAlign = 'center'; x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.75)'; x.fillStyle = '#ffe9a8';
    x.strokeText(text,128,38); x.fillText(text,128,38);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c), transparent:true, depthWrite:false}));
    sp.scale.set(1.1,0.24,1); return sp;
  }
  function addBag(b){
    if(bags.has(b.id)) return;
    const g = new THREE.Group();
    const body = makePackMesh(); body.position.y = 0.03;
    const lbl = bagLabel((RES_NAMES[b.k] || b.k) + (b.n > 1 ? ' ×' + b.n : '')); lbl.position.y = 0.6;
    g.add(body, lbl); g.position.set(b.x, b.y, b.z); scene.add(g);
    bags.set(b.id, Object.assign({}, b, {g, body, lbl, t:Math.random()*6}));
  }
  function removeBag(id){
    const o = bags.get(id); if(!o) return; scene.remove(o.g);
    o.lbl.material.map.dispose(); o.lbl.material.dispose(); bags.delete(id);
  }
  function clearBags(onlyNet){ [...bags.keys()].forEach(id => { if(!onlyNet || id > 0) removeBag(id); }); }
  function refreshInvUI(){
    try{ renderHotbar(); }catch(e){} try{ refreshHeld(); }catch(e){} try{ updateResourceUI(); }catch(e){} try{ renderInvDetail(); }catch(e){}
  }
  function dropSel(all){
    const a = invSelected; if(!a || dragState) return; const sl = getAt(a); if(!sl || sl.n <= 0) return;
    const n = (all || durable(sl.k)) ? sl.n : 1, item = {k:sl.k, n, d:sl.d};
    if(n >= sl.n) setAt(a, null); else sl.n -= n;
    const x = player.pos.x - Math.sin(player.yaw)*1.3, z = player.pos.z - Math.cos(player.yaw)*1.3;
    const y = (player.onGround && player.pos.y - heightAt(player.pos.x, player.pos.z) > 0.6) ? player.pos.y : heightAt(x, z);
    const b = Object.assign({id:0}, item, {x:r2(x), y:r2(y + 0.02), z:r2(z)});
    if(on) send(Object.assign({t:'drop'}, item, {x:b.x, y:b.y, z:b.z})); else { b.id = localBagId--; addBag(b); }
    if(!getAt(a)) invSelected = null;
    refreshInvUI(); toast('Выброшено: ' + (RES_NAMES[item.k] || item.k) + (n > 1 ? ' ×' + n : ''));
  }
  function pickup(){
    const o = nearBag; if(!o || o.busy) return;
    if(roomFor(o.k) < o.n){ toast('Нет места в инвентаре'); return; }
    if(o.id > 0 && on){ o.busy = true; setTimeout(() => { o.busy = false; }, 800); send({t:'pk', id:o.id}); }
    else if(o.id < 0){ removeBag(o.id); giveItem(o.k, o.n, o.d); refreshInvUI(); }
  }
  function animBags(dt){
    let best = null, bd = 2.6;
    bags.forEach(o => { o.t += dt; o.body.position.y = 0.03 + Math.sin(o.t*2)*0.012;
      const d = Math.hypot(o.x - player.pos.x, o.z - player.pos.z); if(d < bd && Math.abs(o.y - player.pos.y) < 3){ bd = d; best = o; } });
    const playing = document.getElementById('start-screen').classList.contains('hidden');
    nearBag = playing ? best : null;
    if(!pickEl){
      pickEl = document.createElement('div');
      pickEl.style.cssText = 'position:fixed;left:50%;bottom:calc(150px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:16;padding:10px 16px;border:none;background:rgba(34,33,31,.86);color:#fff;font:600 12px/1 var(--rf,sans-serif);letter-spacing:.8px;display:none;user-select:none;cursor:pointer';
      pickEl.addEventListener('touchstart', e => { e.preventDefault(); pickup(); }, {passive:false}); pickEl.addEventListener('click', pickup);
      document.body.appendChild(pickEl);
      window.addEventListener('keydown', e => { if(e.code === 'KeyE' && nearBag && !/INPUT|TEXTAREA/.test((document.activeElement||{}).tagName || '')) pickup(); });
    }
    if(nearBag){ pickEl.style.display = 'block'; pickEl.textContent = 'ПОДОБРАТЬ: ' + String(RES_NAMES[nearBag.k] || nearBag.k).toUpperCase() + (nearBag.n > 1 ? ' ×' + nearBag.n : ''); }
    else pickEl.style.display = 'none';
  }
  function profile(){ return {t:'pf', hp:r2(player.hp), hu:r2(player.hunger), th:r2(player.thirst), st:r2(player.stamina), g:gridSlots, h:hotbarSlots, e:equip}; }
  function applyProfile(p){
    try{
      if(Array.isArray(p.g)) for(let i=0;i<gridSlots.length;i++) gridSlots[i] = p.g[i] || null;
      if(Array.isArray(p.h)) for(let i=0;i<hotbarSlots.length;i++) hotbarSlots[i] = p.h[i] || null;
      if(p.e) Object.keys(equip).forEach(k => { equip[k] = p.e[k] || null; }); migrateEquip();
      if(p.hp > 0) player.hp = p.hp; if(p.hu != null) player.hunger = p.hu; if(p.th != null) player.thirst = p.th; if(p.st != null) player.stamina = p.st;
      if(isFinite(p.x) && isFinite(p.z)){ player.pos.set(p.x, Math.max(p.y || 0, heightAt(p.x, p.z)) + 0.5, p.z); player.velY = 0; }
      renderHotbar(); renderInvGrid();
      toast('Прогресс загружен с сервера');
    }catch(e){ console.warn('profile', e); }
  }
  function onMsg(m){
    switch(m.t){
      case 'w':
        myId = m.id; on = true; try{ const c=new THREE.Color(COLS[myId % COLS.length]); playerModel.jacketM.color.copy(c); playerModel.jacketDM.color.copy(c).multiplyScalar(0.78); }catch(e){} srvName = String(m.name||'').replace(/localhost/ig,'server'); if(m.you) setPName(m.you); if(m.me) applyProfile(m.me);
        if(m.ver !== 40) toast('Версия сервера отличается от клиента');
        (m.players||[]).forEach(p=>{ if(!remotes.has(p.id)) remotes.set(p.id, makeAvatar(p.id,p.n)); });
        applying = true;
        try{
          (m.dead||[]).forEach(n=>{ const t = byNid(n); if(t) destroyHarvestable(t); });
          Object.keys(m.hp||{}).forEach(n=>{ const t = byNid(+n); if(t) t.health = Math.min(t.health, m.hp[n]); });
        } finally{ applying = false; }
        (m.builds||[]).forEach(applyBuild);
        Object.keys(m.bhp||{}).forEach(id=>setPartHp(id, m.bhp[id]));
        authKeys.clear(); (m.auth||[]).forEach(k=>authKeys.add(k));
        (m.locks||[]).forEach(k=>{ const d=doors.get(k); if(d){ d.locked=true; refreshDoorPad(d); } });
        clearBags(true); (m.bags||[]).forEach(addBag);
        Object.keys(m.cops||{}).forEach(un=>{ const c = m.cops[un];     // коптеры хранятся на сервере: свой возвращается в мир, чужие стоят на месте
          if(un === m.you){ if(copter.grp && !copter.exists){ Object.assign(copter,{exists:true,hp:100,hitT:0,x:c.x,z:c.z,y:c.y,vx:0,vz:0,vy:0,spool:0,col:0,thr:0,pilot:false,hdg:c.r,yaw:c.r}); copter.grp.visible = true; copter.grp.position.set(c.x,c.y,c.z); copter.grp.rotation.set(0,c.r,0); } }
          else if(copter.grp){ const key = 'u:'+un; if(!rcops.has(key)){ const g2 = copter.grp.clone(true); g2.visible = true; let hub = null; g2.traverse(o => { if(o.userData && o.userData.isHub) hub = o; }); scene.add(g2); g2.position.set(c.x,c.y,c.z); g2.rotation.y = c.r; rcops.set(key,{g:g2,hub,t:performance.now(),st:true,tx:c.x,ty:c.y,tz:c.z,tr:c.r,tq:0,tw:0,p:0}); } } });
        toast('Подключено: '+srvName); hud(); chat('', 'Вы на сервере «'+srvName+'». Enter — чат.'); break;
      case 'full': toast('Сервер заполнен'); disconnect(); break;
      case 'auth': { const s = curSrv; if(s) authSet(s, null); disconnect(); if(s) showAuth(s, 'Сессия истекла — войдите заново', () => connect(s)); break; }
      case 'kick': toast(m.m || 'Вы отключены'); disconnect(); break;
      case 'pj': if(!remotes.has(m.id)) remotes.set(m.id, makeAvatar(m.id,m.n)); { const sc = rcops.get('u:'+m.n); if(sc){ scene.remove(sc.g); rcops.delete('u:'+m.n); } } hud(); break;
      case 'pl': removeRemote(m.id); { const rc = rcops.get(m.id); if(rc){ scene.remove(rc.g); rcops.delete(m.id); } } hud(); break;
      case 'bs': boarSnap(m.b); break;
      case 'zd': if(!window.__BOAR_GUEST()){ const bb = boars[m.i]; if(bb) boarDamage(bb, m.d); } break;
      case 'cs': if(copter.grp) copterNet(m); break;
      case 'ps': m.p.forEach(a=>{
          if(a[0] === myId) return;
          const r = remotes.get(a[0]); if(!r) return;
          r.tp.set(a[1],a[2],a[3]); r.tyaw = a[4]; r.pitch = a[5]; setHeld(r, TOOLN[a[6]] || 'none');
          r.crouch = (a[7] & 1) ? 1 : 0; r.aim = (a[7] & 2) ? 1 : 0; setRigSuit(r, !!(a[7] & 4));
        }); break;
      case 'hv': { const t = byNid(m.i); if(t){ applying = true; try{ if(typeof harvestTarget!=='undefined' && harvestTarget===t) stopHarvest();
            spawnDebris(t.mesh.position.clone().setY(t.mesh.position.y+1), t.type, 6, 0.8); destroyHarvestable(t, true); } finally{ applying = false; } } break; }
      case 'hh': { const t = byNid(m.i); if(t) t.health = m.h; break; }
      case 'bd': case 'dr': case 'dl': case 'dok': case 'dno': applyBuild(m); break;
      case 'sxp': dropProj('sa', new THREE.Vector3(m.p[0],m.p[1],m.p[2])); spawnSatchel(m.id, m.p, m.q, true); break;
      case 'rxp': dropProj('rk', new THREE.Vector3(m.p[0],m.p[1],m.p[2])); satchelExplode({p:new THREE.Vector3(m.p[0],m.p[1],m.p[2]), n:new THREE.Vector3(0,1,0), pid:0, net:true, rocket:true, big:1.35, dmg:120, R:5}); break;
      case 'gxp': dropProj('gr', new THREE.Vector3(m.p[0],m.p[1],m.p[2])); satchelExplode({p:new THREE.Vector3(m.p[0],m.p[1],m.p[2]), n:new THREE.Vector3(0,1,0), pid:0, net:true, grenade:true, big:0.85}); break;
      case 'qa': quarActive.clear(); (m.ids||[]).forEach(i=>quarActive.add(i)); break;
      case 'qs': { const q = quarSt(m.id); q.f = m.f||0; q.stone = m.s||0; q.metal = m.m||0; q.sulfur = m.u||0; if(quarOpenId===m.id) updateQuarryText(); break; }
      case 'bhp': setPartHp(m.id, m.h); break;
      case 'bhb': (m.l||[]).forEach(a=>setPartHp(a[0], a[1])); break;
      case 'bx': removePart(m.id, true); break;
      case 'bu': applyUpgrade(m.id); break;
      case 'sc': storData.set(m.id, m.s || []); if(storOpenId===m.id) renderStorage(); break;
      case 'bg': addBag(m); break;
      case 'bgx': removeBag(m.id); break;
      case 'got': giveItem(m.k, m.n, m.d); refreshInvUI(); try{ updateResourceUI(); }catch(e){} if(m.srv){ if(m.c) try{ flashCrit(); }catch(e){} toast((m.c ? 'КРИТ! ' : '') + '+' + m.n + ' ' + (RES_NAMES[m.k] || (ITEM_DEFS[m.k] && ITEM_DEFS[m.k].name) || m.k)); } else toast((m.back ? 'Вернулось: ' : 'Получено: ') + (RES_NAMES[m.k] || m.k) + (m.n > 1 ? ' ' + m.n : '')); break;
      case 'sw': { const r = remotes.get(m.id); if(r) r.swing = 1; break; }
      case 'sh': { const r = remotes.get(m.id); if(r){ r.flash = 0.05;
          const d = Math.hypot(r.p.x-player.pos.x, r.p.z-player.pos.z); OSIL_AUDIO.play('ak',{vol:Math.max(0.05, 0.8 - d/90)}); if(m.p) remoteShot(r, m.p, m.m); } break; }
      case 'dmg': hurt(m.d, m.from); break;
      case 'c': chat(m.n, m.m); break;
      case 'fx': remoteFx(m); break;
    }
  }

  /* ---------------- чужие выстрелы, ракеты, гранаты, частицы ---------------- */
  const rtr = [], rproj = [], _vY = new THREE.Vector3(0,1,0);
  const trGeo = new THREE.CylinderGeometry(0.014,0.014,1,5), trMat0 = new THREE.MeshBasicMaterial({color:0xfff0b0, transparent:true, opacity:0.8, depthWrite:false, fog:false});
  function fx(k, o, d){ if(!on) return; send({t:'fx', k, o:[r2(o.x),r2(o.y),r2(o.z)], d:[r2(d.x),r2(d.y),r2(d.z)]}); }
  let hpT = 0;
  function fxHit(p, ty){ if(!on) return; const n = performance.now(); if(n-hpT < 120) return; hpT = n; send({t:'fx', k:'hp', o:[r2(p.x),r2(p.y),r2(p.z)], m:ty}); }
  function remoteShot(r, p, mat){
    const e = new THREE.Vector3(p[0],p[1],p[2]), s0 = new THREE.Vector3(r.p.x, r.p.y+1.4, r.p.z);
    const dv = e.clone().sub(s0), L = dv.length(); if(!(L > 1) || L > 500) return; dv.multiplyScalar(1/L);
    s0.addScaledVector(dv, 0.8);
    const dl = Math.min(L-0.8, 90);
    if(dl > 0.5){
      const m = new THREE.Mesh(trGeo, trMat0.clone()); m.frustumCulled = false;
      m.position.copy(s0).addScaledVector(dv, dl/2); m.quaternion.setFromUnitVectors(_vY, dv); m.scale.set(1, dl, 1); scene.add(m); rtr.push({m, t:0.07});
    }
    if(CFG.particles){
      const dist = Math.max(1, Math.hypot(e.x-player.pos.x, e.z-player.pos.z));
      if(mat === 'x') waterSplash(e, dist);
      else { const g = !mat || mat === 'g'; impactBurst(e, dist, g ? IMP_GROUND : (DEBRIS_COLORS[mat] || DEBRIS_COLORS.stone), !g); }
    }
  }
  function remoteFx(m){
    if(!m || !m.o) return;
    const o = new THREE.Vector3(m.o[0],m.o[1],m.o[2]), dist = Math.hypot(o.x-player.pos.x, o.z-player.pos.z);
    if(m.k === 'hp'){ if(CFG.particles && DEBRIS_COLORS[m.m]) spawnDebris(o, m.m, 7, 0.9); return; }
    if(!m.d) return;
    const d = new THREE.Vector3(m.d[0],m.d[1],m.d[2]); if(d.lengthSq() < 1e-6) return; d.normalize();
    if(m.k === 'rk'){
      const mesh = makeRocketMesh(); mesh.position.copy(o); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1), d); scene.add(mesh);
      rproj.push({k:'rk', m:mesh, v:d.clone().multiplyScalar(RPG_SPEED), t:0, tr:0});
      try{ OSIL_AUDIO.play('ak', {vol:Math.max(0.1, 1-dist/120), rate:0.45}); }catch(e){}
      fxEmit('fire', o.clone(), _vZero.clone(), 0.18, 0.4, 1.8, 0xffffff, 0xffd8a0, {a:0.9});
      for(let i=0;i<5;i++) fxEmit('smoke', o.clone().addScaledVector(d,-0.4), new THREE.Vector3((Math.random()-.5)*1.2,(Math.random()-.5)*1.2,(Math.random()-.5)*1.2).addScaledVector(d,-2.5), 0.9, 0.3, 1.4, 0x8a857d, 0xcfcac2, {drag:1.8, a:0.55});
    } else if(m.k === 'gr'){
      const mesh = makeGrenadeMesh(); mesh.position.copy(o); scene.add(mesh);
      rproj.push({k:'gr', m:mesh, v:d.clone().multiplyScalar(14).add(new THREE.Vector3(0,3.2,0)), t:0, spin:new THREE.Vector3(9,3,6)});
    } else if(m.k === 'sa'){
      const mesh = makeSatchelMesh(); mesh.scale.setScalar(0.85); mesh.position.copy(o); scene.add(mesh);
      rproj.push({k:'sa', m:mesh, v:d.clone().multiplyScalar(11).add(new THREE.Vector3(0,2.4,0)), t:0, spin:new THREE.Vector3(6,2,4)});
    }
  }
  function dropProj(k, p){
    let bi = -1, bd = 30; rproj.forEach((r,i)=>{ if(r.k !== k) return; const dd = r.m.position.distanceTo(p); if(dd < bd){ bd = dd; bi = i; } });
    if(bi >= 0){ scene.remove(rproj[bi].m); rproj.splice(bi,1); }
  }
  function animFx(dt){
    for(let i=rtr.length-1;i>=0;i--){ const t = rtr[i]; t.t -= dt; if(t.t <= 0){ scene.remove(t.m); t.m.material.dispose(); rtr.splice(i,1); } else t.m.material.opacity = 0.8*(t.t/0.07); }
    for(let i=rproj.length-1;i>=0;i--){
      const r = rproj[i]; r.t += dt; const p = r.m.position;
      if(r.k === 'rk'){
        p.addScaledVector(r.v, dt);
        r.tr -= dt; if(r.tr <= 0){ r.tr = 0.04;
          fxEmit('smoke', p.clone(), new THREE.Vector3((Math.random()-.5)*.5,(Math.random()-.5)*.5+.2,(Math.random()-.5)*.5), 1.0, 0.25, 1.1, 0x8f8a82, 0xd8d4cc, {drag:1.5, a:0.5});
          fxEmit('fire', p.clone(), _vZero.clone(), 0.12, 0.28, 0.08, 0xfff2c0, 0xff7a1a, {a:0.95}); }
        if(r.t > 6 || p.y < heightAt(p.x,p.z)){ scene.remove(r.m); rproj.splice(i,1); }
      } else {
        r.v.y -= 9.8*dt; p.addScaledVector(r.v, dt);
        r.m.rotation.x += r.spin.x*dt; r.m.rotation.y += r.spin.y*dt; r.m.rotation.z += r.spin.z*dt;
        const gy = heightAt(p.x,p.z)+0.06;
        if(p.y < gy){ p.y = gy; if(r.k === 'sa' || r.v.length() < 1.5){ r.v.set(0,0,0); r.spin.set(0,0,0); } else { r.v.y = Math.abs(r.v.y)*0.35; r.v.x *= 0.5; r.v.z *= 0.5; r.spin.multiplyScalar(0.5); } }
        if(r.t > (r.k === 'gr' ? 6 : 4)){ scene.remove(r.m); rproj.splice(i,1); }
      }
    }
  }

  /* ---------------- бой ---------------- */
  function hurt(d, from){
    d *= armorMul(d); player.hp = Math.max(0, player.hp - d); camKick = 0.05;
    try{ OSIL_AUDIO.play('player_scream',{vol:0.5}); }catch(e){}
    if(player.hp <= 0 && !dieSent){
      dieSent = true; send({t:'die', by:from}); toast('Вы погибли');
      try{ window.__deathBy = (remotes.get(from)||{}).name || null; }catch(e){}
    }
  }
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function raySphere(o, d, c, r){ const ox = o.x-c.x, oy = o.y-c.y, oz = o.z-c.z, b = ox*d.x+oy*d.y+oz*d.z, cc = ox*ox+oy*oy+oz*oz-r*r, disc = b*b-cc;
    if(disc < 0) return -1; const t = -b - Math.sqrt(disc); return t > 0 ? t : -1; }
  function onShoot(){
    if(!on) return;
    camera.getWorldPosition(_o); camera.getWorldDirection(_d);
    { const e = window.__shotEnd || new THREE.Vector3().copy(_o).addScaledVector(_d,150); send({t:'sh', p:[r2(e.x),r2(e.y),r2(e.z)], m:window.__shotMat||''}); }
    let best = null, bt = 90;
    remotes.forEach(r=>{
      const c = new THREE.Vector3();
      [[1.62,0.17,true],[1.15,0.33,false],[0.55,0.32,false]].forEach(s=>{
        c.set(r.p.x, r.p.y+s[0], r.p.z); const t = raySphere(_o,_d,c,s[1]);
        if(t > 0 && t < bt){ bt = t; best = {r, head:s[2]}; }
      });
    });
    if(best){ send({t:'hit', to:best.r.id, w:toolKind, hd: best.head ? 1 : 0}); if(best.head){ try{ flashCrit(); }catch(e){} } }
  }
  function melee(){
    if(!on || performance.now()-meleeT < 550) return; meleeT = performance.now();
    camera.getWorldDirection(_d); 
    remotes.forEach(r=>{
      const dx = r.p.x-player.pos.x, dz = r.p.z-player.pos.z, dist = Math.hypot(dx,dz);
      if(dist < (toolKind==='spear' ? 3.2 : 2.3) && (dx*_d.x + dz*_d.z)/Math.max(dist,1e-3) > 0.5) send({t:'hit', to:r.id, w:toolKind});
    });
  }

  /* ---------------- HUD и чат ---------------- */
  let hudEl, chatLog, chatIn, chatBtn, chatX;
  function ui(){
    hudEl = document.createElement('div'); hudEl.id = 'net-hud'; hudEl.style.display = 'none'; document.body.appendChild(hudEl);
    chatLog = document.createElement('div'); chatLog.id = 'net-chat'; document.body.appendChild(chatLog);
    chatIn = document.createElement('input'); chatIn.id = 'net-chat-in'; chatIn.maxLength = 120; chatIn.placeholder = 'Сообщение…'; chatIn.style.display = 'none'; document.body.appendChild(chatIn);
    chatBtn = document.createElement('button'); chatBtn.id = 'net-chat-btn'; chatBtn.textContent = '💬'; chatBtn.style.display = 'none'; document.body.appendChild(chatBtn);
    chatIn.addEventListener('keydown', e=>{ e.stopPropagation();
      if(e.key === 'Enter'){ const v = chatIn.value.trim(); if(v) send({t:'c', m:v}); closeChat(); }
      else if(e.key === 'Escape') closeChat(); });
    chatIn.addEventListener('keyup', e=>e.stopPropagation());
    chatX = document.createElement('button'); chatX.id = 'net-chat-x'; chatX.textContent = '✖'; chatX.style.display = 'none'; document.body.appendChild(chatX);
    const _cx = e=>{ e.preventDefault(); e.stopPropagation(); closeChat(); };
    chatX.addEventListener('click', _cx); chatX.addEventListener('touchend', _cx);
    chatBtn.addEventListener('click', ()=>{ if(chatIn.style.display==='block') closeChat(); else openChat(); });
    document.addEventListener('pointerdown', e=>{ if(chatIn.style.display==='block' && e.target!==chatIn && e.target!==chatX && e.target!==chatBtn && !chatIn.value.trim()) closeChat(); }, true);
    window.addEventListener('keydown', e=>{ if(e.key==='Enter' && on && document.activeElement !== chatIn && $('start-screen').style.display==='none'){ e.preventDefault(); openChat(); } });
  }
  function openChat(){ if(!on) return; if(document.exitPointerLock) document.exitPointerLock(); chatIn.style.display = 'block'; chatX.style.display = 'block'; chatIn.value = ''; chatIn.focus(); }
  function closeChat(){ chatIn.style.display = 'none'; if(chatX) chatX.style.display = 'none'; chatIn.blur(); setTimeout(fitScreen,150);
    try{ if(!isMobile() && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock(); }catch(e){} }
  function chat(n, m){
    const d = document.createElement('div'); d.className = 'nc-l' + (n ? '' : ' sys');
    d.textContent = (n ? n + ': ' : '') + m; chatLog.appendChild(d);
    while(chatLog.children.length > 7) chatLog.removeChild(chatLog.firstChild);
    setTimeout(()=>{ d.style.opacity = 0; setTimeout(()=>d.remove(), 800); }, 9000);
  }
  function hud(){
    if(!hudEl) return;
    hudEl.style.display = on ? 'block' : 'none'; chatBtn.style.display = on ? 'block' : 'none';
    hudEl.textContent = '🌐 ' + srvName + ' · игроков: ' + (remotes.size + 1);
  }

  /* ---------------- подключение ---------------- */
  /* ---------------- аккаунты ---------------- */
  const LS_AUTH = 'anode_auth', authKey = s => s.host + ':' + s.port;
  const SESS = {};   /* сессии только в памяти: при каждом запуске игры вход нужно пройти заново */
  const authAll = () => SESS;
  const authSet = (s, v) => { if(v){ SESS[authKey(s)] = v; try{ localStorage.setItem('anode_lastuser', v.u); }catch(e){} curSrv = s; setTimeout(()=>window.OSIL_ACC.refresh(), 50); } else delete SESS[authKey(s)]; };
  /* серверный аккаунт: монеты, уровень, админ-права и админ-запросы — всё хранится в БД сервера */
  window.OSIL_ACC = {
    me:null,
    sess(){ const s = curSrv || mServers[mSelServer]; if(!s || s.solo) return null; const a = authAll()[authKey(s)]; return a ? {url:baseUrl(s), tok:a.t} : null; },
    async call(path, body){ const c = this.sess(); if(!c) return {error:'Нет входа на сервер'};
      let r; try{ r = await fetch(c.url+path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.assign({token:c.tok}, body||{}))}); }
      catch(e){ return {error:'Сервер недоступен ('+c.url+')'}; }
      try{ return await r.json(); }catch(e){ return {error: r.status===404 ? 'Сервер не обновлён: загрузите новый server.py и перезапустите' : 'Ошибка ответа сервера ('+r.status+')'}; } },
    async refresh(){ const d = await this.call('/api/me'); if(d && d.u){ this.me = d; mCoins = d.coins; window.__tester = !!d.tester; const c = document.getElementById('m-pCoins'), l = document.getElementById('m-pLvl'); if(c) c.textContent = d.coins; if(l){ l.textContent = d.level; const sp = Math.max(1, (d.xpmax||1) - (d.xpmin||0)); l.style.setProperty('--p', Math.max(0, Math.min(100, ((d.xp||0) - (d.xpmin||0)) / sp * 100))); } if(d.tester && !this._tg){ this._tg = 1; setInterval(()=>{ try{ ['wood','stone','metal','scrap','fuel','sulfur'].forEach(k=>{ const n=1000-countItem(k); if(n>0) addItem(k,n); }); updateResourceUI(); }catch(e){} }, 4000); }
      if(d.admin && !this._ag){ this._ag = 1; try{ adminGrantRes(); updateResourceUI(); renderCraftUI(); }catch(e){} } } return d; },
    isAdmin(){ return !!(this.me && this.me.admin); },
    owns(id){ return !!(this.me && (this.me.items||[]).includes(id)); }
  };
  setInterval(()=>{ if(OSIL_ACC.sess()) OSIL_ACC.refresh().then(()=>{ const p=document.getElementById('m-paneDonate'); if(p && !p.classList.contains('hidden')) renderDonate(); }); }, 6000);
  const DON = {copter:{n:'Миникоптер', d:'Личный вертолёт: после покупки можно крафтить и ставить', icon:'1/copter.webp'}, quarry:{n:'Карьер', d:'Сам добывает камень, железо и серу: можно крафтить и ставить', icon:'1/quarry.webp'}, eod_suit:{n:'Военная броня', d:'Снижает урон на 75%', icon:'1/eod_suit.webp'}};
  const COIN_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><radialGradient id='g' cx='35%25' cy='30%25' r='80%25'><stop offset='0' stop-color='%23fff3a0'/><stop offset='.55' stop-color='%23f2b705'/><stop offset='1' stop-color='%23b36b00'/></radialGradient></defs><circle cx='32' cy='32' r='30' fill='%238a5200'/><circle cx='32' cy='32' r='27' fill='url(%23g)'/><circle cx='32' cy='32' r='21' fill='none' stroke='%23b8780a' stroke-width='3'/><path d='M32 17v30M25 24h10a5 5 0 0 1 0 10h-8a5 5 0 0 0 0 10h12' fill='none' stroke='%238a5200' stroke-width='4' stroke-linecap='round'/></svg>";
  document.documentElement.style.setProperty('--coin', 'url("'+COIN_IMG+'")');
  window.renderDonate = function(){
    const el = document.getElementById('m-donate'); if(!el) return; const me = OSIL_ACC.me, ok = !!OSIL_ACC.sess();
    let h = '<div class="sh-top"><div class="sh-title">МАГАЗИН ПРЕДМЕТОВ</div><div class="sh-coins"><span>'+(me?me.coins:mCoins)+'</span><img class="coin-i" alt=""></div></div><div class="sh-grid">';
    Object.keys(DON).forEach(k=>{ const price = (me&&me.shop&&me.shop[k]) || ({copter:420,quarry:1200,eod_suit:350}[k]||1200), have = OSIL_ACC.owns(k);
      h += '<div class="sh-card'+(have?' own':'')+'" data-k="'+k+'"><div class="sh-price">'+(have?'КУПЛЕНО':price)+(have?'':'<img class="coin-i" alt="">')+'</div><img class="sh-img" src="'+DON[k].icon+'" alt=""><div class="sh-name">'+DON[k].n.toUpperCase()+'</div></div>'; });
    h += '</div><div id="dn-msg" class="sh-msg">'+(ok?'':'Войдите на сервер, чтобы покупать предметы')+'</div>'+
      '<div class="sh-bar"><div class="sh-info"><i>i</i>Купленные вещи из меню крафта остаются на бесконечный срок</div><button id="dn-get">ПОЛУЧИТЬ ДОНАТ<br><small>КУПИТЬ МОНЕТЫ</small></button></div>';
    el.innerHTML = h; el.querySelectorAll('.coin-i').forEach(i=>i.src = COIN_IMG);
    el.querySelectorAll('.sh-card:not(.own)').forEach(b=>b.addEventListener('click', async()=>{
      if(!confirm('Купить: '+DON[b.dataset.k].n+'?')) return;
      const d = await OSIL_ACC.call('/api/shop', {item:b.dataset.k});
      if(d.u){ OSIL_ACC.me = d; mCoins = d.coins; document.getElementById('m-pCoins').textContent = d.coins; }
      renderDonate(); const m2 = document.getElementById('dn-msg'); m2.textContent = d.error || d.msg; m2.style.color = d.error ? '#e08a80' : '#bcd096'; }));
    document.getElementById('dn-get').addEventListener('click', ()=>window.open('https://t.me/AnodeStudioOxide','_blank'));
  };

  const lastUser = () => { try{ return localStorage.getItem('anode_lastuser') || ''; }catch(e){ return ''; } };
  const hostPort = s => (s.port==443||s.port==80||!s.port) ? s.host : s.host + ':' + s.port;
  const baseUrl = s => ((location.protocol === 'https:' && !/^(127\.|localhost)/.test(s.host)) ? 'https://' : 'http://') + hostPort(s);
  function setPName(n){ const e = document.getElementById('m-pName'); if(e && n) e.textContent = n; }
  let curSrv = null;
  function showAuth(s, note, onOk, force){
    const old = document.getElementById('auth-ov'); if(old) old.remove();
    const ov = document.createElement('div'); ov.id = 'auth-ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);box-sizing:border-box;font-family:"Roboto Condensed","Arial Narrow",Arial,sans-serif;background:linear-gradient(rgba(8,12,20,.72),rgba(8,12,20,.82)),url(1/menu-bg-update.webp) center/cover no-repeat,#10131a';
    const I = 'width:100%;box-sizing:border-box;padding:clamp(7px,1.6vh,12px) 14px;margin:clamp(3px,.6vh,5px) 0;border:1px solid #3a423d;background:rgba(14,18,16,.92);color:#fff;font-size:16px;letter-spacing:.5px;outline:none;border-radius:0';
    const B = 'flex:1;padding:clamp(8px,1.8vh,14px) 6px;border:0;border-radius:0;background:#1b231f;color:#f3ece6;font-size:clamp(13px,2.2vh,17px);font-weight:700;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;border-bottom:3px solid #4c6a58';
    ov.innerHTML = '<div style="display:flex;align-items:center;gap:14px;margin-bottom:clamp(6px,2vh,16px)"><img src="1/icon-192.png" style="width:clamp(40px,10vh,74px);height:clamp(40px,10vh,74px);box-shadow:0 4px 14px rgba(0,0,0,.6)" alt=""><div style="line-height:.95"><div style="font-size:clamp(30px,8.5vh,54px);font-weight:900;color:#f6ece4;letter-spacing:2px">ANODE</div><div style="background:#f6ece4;color:#111;font-weight:900;font-size:clamp(11px,2.4vh,17px);letter-spacing:1px;padding:2px 8px;display:inline-block">SURVIVAL ISLAND</div></div></div>' +
      '<div style="width:min(90vw,360px);background:rgba(20,26,23,.9);padding:clamp(8px,1.6vh,14px) 16px;color:#eee;box-shadow:0 8px 30px rgba(0,0,0,.6)">' +
      '<div id="au-t" style="font-size:15px;font-weight:700;letter-spacing:1px;color:#cfe6d6;margin-bottom:6px;text-transform:uppercase"></div>' +
      '<input id="au-u" style="'+I+'" placeholder="НИК (3–16 символов)" maxlength="16" autocapitalize="off" autocomplete="username">' +
      '<input id="au-p" type="password" style="'+I+'" placeholder="ПАРОЛЬ (от 6 символов)" maxlength="64" autocomplete="current-password">' +
      '<div id="au-e" style="color:#ff8a80;font-size:13px;min-height:clamp(12px,2vh,18px);margin:2px 0 clamp(3px,1vh,8px)"></div>' +
      '<div style="display:flex;gap:8px"><button id="au-l" style="'+B+'">Войти</button><button id="au-r" style="'+B+'">Регистрация</button></div>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:clamp(5px,1.4vh,12px);font-size:12px;color:#c9c4bd"><input id="au-ok" type="checkbox" checked style="width:18px;height:18px"><span>Я прочитал и согласился с <span style="color:#4fd1c5">политикой конфиденциальности</span> и <span style="color:#4fd1c5">условиями использования</span></span></label>' +
      '<button id="au-c" style="width:100%;margin-top:clamp(2px,.8vh,8px);padding:clamp(4px,1vh,10px);background:none;border:none;color:#9a968f;font-size:14px;'+(force?'display:none':'')+'">Отмена</button></div>';
    document.body.appendChild(ov);
    const $$ = id => ov.querySelector('#' + id), err = $$('au-e');
    $$('au-t').textContent = 'Сервер «' + String(s.name || s.host).replace(/localhost/ig,'server') + '»'; if(note) err.textContent = note;
    let busy = false;
    const go = async kind => {
      if(busy) return; const u = $$('au-u').value.trim(), p = $$('au-p').value;
      if(!u || !p){ err.textContent = 'Введите ник и пароль'; return; }
      if(!$$('au-ok').checked){ err.textContent = 'Нужно согласие с условиями'; return; }
      busy = true; err.style.color = '#ccc'; err.textContent = 'Подождите…';
      try{
        const r = await fetch(baseUrl(s) + '/api/' + kind, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({u, p})});
        const d = await r.json();
        if(!r.ok || !d.token){ err.style.color = '#ff8a80'; err.textContent = d.error || 'Ошибка'; busy = false; return; }
        authSet(s, {u:d.u, t:d.token}); ov.remove(); setPName(d.u); (onOk || (() => connect(s)))();
      }catch(e){ err.style.color = '#ff8a80'; err.textContent = 'Сервер недоступен (на бесплатном Render он просыпается до минуты) — нажмите ещё раз'; busy = false;
        }
    };
    $$('au-l').onclick = () => go('login'); $$('au-r').onclick = () => go('register'); $$('au-c').onclick = () => ov.remove();
    ov.addEventListener('keydown', e => { if(e.key === 'Enter') go('login'); e.stopPropagation(); }); ov.addEventListener('keyup', e => e.stopPropagation());
    const lu = lastUser(); if(lu) $$('au-u').value = lu; setTimeout(() => $$(lu ? 'au-p' : 'au-u').focus(), 50);
  }
  function getName(){
    let n = ''; try{ n = localStorage.getItem(LS_NAME) || ''; }catch(e){}
    if(!n){ n = (prompt('Ваш ник для мультиплеера:', 'Игрок' + (100 + Math.floor(Math.random()*900))) || '').trim().slice(0,16) || 'Игрок';
      try{ localStorage.setItem(LS_NAME, n); }catch(e){} }
    return n;
  }
  function cleanup(){ clearBags(true); on = false; myId = 0; remotes.forEach(r=>scene.remove(r.root)); remotes.clear(); hud(); }
  function disconnect(){ const w = ws; ws = null; if(w){ w.onclose = null; try{ w.close(); }catch(e){} } cleanup(); }
  function backToMenu(){ try{ setPause(false); const ss = document.getElementById('start-screen'); ss.classList.remove('hidden'); ss.style.display = ''; if(document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); }catch(e){} }
  function connect(s){
    disconnect(); if(!s || s.solo) return;
    const au = authAll()[authKey(s)]; if(!au){ toast('Сначала войдите в аккаунт'); return; } curSrv = s;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + hostPort(s) + '/ws';
    let w; try{ w = new WebSocket(url); }catch(e){ toast('Неверный адрес сервера'); return; }
    ws = w;
    const to = setTimeout(()=>{ if(ws === w && !on){ toast('Сервер не отвечает'); disconnect(); backToMenu(); } }, 6000);
    w.onopen = () => send({t:'join', k:au.t});
    w.onmessage = e => { try{ onMsg(JSON.parse(e.data)); }catch(err){ console.warn(err); } };
    w.onerror = () => { if(ws === w && !on){ toast('Не удалось подключиться'); backToMenu(); } };
    w.onclose = () => { clearTimeout(to); if(ws === w){ if(on){ toast('Соединение потеряно'); backToMenu(); } ws = null; cleanup(); } };
  }

  /* ---------------- события игры ---------------- */
  function onDestroy(t){}          // узлы ломает только сервер
  function onHit(t){}
  function harvest(t, kind, crit){ if(on && t.nid != null) send({t:'hr', i:t.nid, ty:t.type, k:kind}); }
  function onBuild(b){ if(on && !applying) send(b); }
  function onSwing(){ if(on) send({t:'sw'}); }

  /* ---------------- список серверов ---------------- */
  const saved = () => { try{ return JSON.parse(localStorage.getItem(LS_SRV) || '[]'); }catch(e){ return []; } };
  const saveList = l => { try{ localStorage.setItem(LS_SRV, JSON.stringify(l)); }catch(e){} };
  const norm = h => (h === 'localhost' ? '127.0.0.1' : h);
  async function probe(c){
    const ac = new AbortController(), tm = setTimeout(()=>ac.abort(), 3500), t0 = performance.now();
    try{ const r = await fetch(baseUrl(c) + '/api/info', {signal:ac.signal, cache:'no-store'}); const d = await r.json();
      return Object.assign({}, c, {ips:d.ips || [], name:c.name || d.name, cur:d.cur, max:d.max, ping:Math.max(1, Math.round(performance.now()-t0)), ok:true}); }
    catch(e){ return Object.assign({}, c, {ok:false}); } finally{ clearTimeout(tm); }
  }
  let refreshing = false;
  async function refresh(){
    if(refreshing) return; refreshing = true;
    const cand = new Map(), add = (host, port, src, name) => { const k = norm(host) + ':' + port; if(!cand.has(k)) cand.set(k, {host, port:+port, src, name}); };
    if(window.__SERVER){ try{ const u = new URL(window.__SERVER); add(u.hostname, u.port || (u.protocol === 'https:' ? 443 : 80), 'сервер игры'); }catch(e){} }
    else if(/^https?:$/.test(location.protocol) && location.hostname) add(location.hostname, location.port || (location.protocol === 'https:' ? 443 : 80), 'этот сервер');
    try{ saved().forEach(x => x && x.host && add(x.host, x.port || 8000, 'сохранённый', x.name)); }catch(e){}
    const res = await Promise.all([...cand.values()].map(probe));
    const seen = new Set(), rows = [];
    res.forEach(c => { const key = c.ok ? c.name + '|' + c.port : c.host + ':' + c.port; if(seen.has(key)) return; seen.add(key); rows.push(c); });
    mServers.length = 0; mServers.push({name:'Одиночная игра', sub:'Без сервера', cur:1, max:1, ping:0, host:'', port:0, solo:true});
    rows.forEach(c => mServers.push({name: c.name || (c.ok ? c.name : 'server anode 1'), sub: c.ok ? 'Онлайн' : 'нет ответа',
      cur: c.ok ? c.cur : 0, max: c.ok ? c.max : 0, ping: c.ok ? c.ping : '—', host: c.host, port: c.port, off: !c.ok}));
    if(!refresh._sel){ mSelServer = 0; refresh._sel = true; }   // в APK по умолчанию выбран сервер игры
    if(mSelServer >= mServers.length) mSelServer = 0;
    renderMenuServers(); refreshing = false;
  }
  function addServer(){
    const v = (prompt('IP сервера (например 192.168.1.5):') || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if(v) location.href = 'http://' + (v.includes(':') ? v : v + ':8000') + '/';
  }

  function init(){
    ui();
    setPName(lastUser());
    const rebind = (id, fn) => { const b = $(id); if(!b) return; const n = b.cloneNode(true); b.replaceWith(n); n.addEventListener('click', fn); };
    rebind('m-addServ', addServer); rebind('m-refServ', () => { toast('Поиск серверов…'); refresh().then(()=>toast('Список обновлён')); });
    /* вход в аккаунт теперь показывается сразу при открытии меню; при заходе на сервер окно не появляется */
    const sb = $('start-btn');
    sb.addEventListener('click', e => {
      const s = mServers[mSelServer];
      if(!s){ e.stopImmediatePropagation(); e.preventDefault(); toast('Выберите режим'); return; }
      if(s.solo){ disconnect(); return; }   // одиночная игра: сервер не нужен
      if(!authAll()[authKey(s)]){ e.stopImmediatePropagation(); e.preventDefault(); showAuth(s, '', () => { connect(s); sb.click(); }, true); return; }
      connect(s);
    }, true);
    $('pm-exit').addEventListener('click', disconnect);
    window.__NIDL = harvestables.slice(); harvestables.forEach((h,i) => { h.nid = i; });
    mServers.length = 0; mSelServer = 0; mServers.push({name:'Одиночная игра', sub:'Без сервера', cur:1, max:1, ping:0, host:'', port:0, solo:true}); renderMenuServers();
    {   // регистрация/вход сразу при открытии меню (закрыть нельзя)
      let u0 = null;
      try{ if(window.__SERVER){ const u = new URL(window.__SERVER); u0 = {host:u.hostname, port:+(u.port || (u.protocol === 'https:' ? 443 : 80))}; }
        else if(/^https?:$/.test(location.protocol) && location.hostname) u0 = {host:location.hostname, port:+(location.port || (location.protocol === 'https:' ? 443 : 80))}; }catch(e){}
      if(u0){ u0.name = 'ANODE'; showAuth(u0, null, () => { refresh(); }, false); }
    }
    refresh(); setInterval(() => { const ss = $('start-screen'); if(ss && ss.style.display !== 'none' && !document.hidden) refresh(); }, 15000);
    setInterval(() => {                                       // отправка своего состояния 10 раз/с
      if(!on) return;
      send({t:'st', s:[r2(player.pos.x), r2(player.pos.y), r2(player.pos.z), r2(player.yaw), r2(player.pitch), TOOLS[toolKind] || 0,
        (isCrouching ? 1 : 0) | (aimK > 0.5 ? 2 : 0) | (suitWorn() ? 4 : 0)].slice(0,7).concat([])});
    }, 50);   // 20 раз/с
    const saveNow = () => { if(on){ try{ send(profile()); }catch(e){} } };
    setInterval(saveNow, 2000); document.addEventListener('visibilitychange', () => { if(document.hidden) saveNow(); }); window.addEventListener('pagehide', saveNow);
    let last = performance.now();
    (function loop(){ const n = performance.now(), dt = Math.min(0.1, (n-last)/1000); last = n; animRemotes(dt); animFx(dt); animBags(dt); requestAnimationFrame(loop); })();
  }
  try{ init(); }catch(e){ alert('Ошибка net.js: ' + e.message); }
  /* ---- синхронизация кабанов (хост = клиент с наименьшим id) и коптеров ---- */
  const BST = ['idle','graze','charge','flee','wander','dead','attack','alert'];
  let lastBs = 0; window.__BOAR_GUEST = () => on && performance.now() - lastBs < 2500;
  setInterval(() => { if(!on || window.__BOAR_GUEST()) return;
    send({t:'bs', b: boars.map(b => [r2(b.x), r2(b.z), r2(b.yaw), Math.round(b.hp), b.dead ? 1 : 0, Math.max(0, BST.indexOf(b.state))])}); }, 200);
  function boarSnap(a){ lastBs = performance.now();
    a.forEach((v, i) => { const b = boars[i]; if(!b) return;
      if(v[4]){ if(!b.dead) killBoar(b); return; }
      b._nx = v[0]; b._nz = v[1]; b._ny = v[2]; b._ns = BST[v[5]] || 'idle'; if(!b.dead) b.hp = v[3];
      if(Math.hypot(b.x - v[0], b.z - v[1]) > 15){ b.x = v[0]; b.z = v[1]; } }); }
  const rcops = new Map(); let sentCop = false;
  setInterval(() => { if(!on) return;
    if(copter.exists && copter.grp){ sentCop = true; const g = copter.grp;
      send({t:'cs', e:1, x:r2(g.position.x), y:r2(g.position.y), z:r2(g.position.z), r:r2(g.rotation.y), q:r2(g.rotation.x), w:r2(g.rotation.z), p:copter.pilot ? 1 : 0}); }
    else if(sentCop){ sentCop = false; send({t:'cs', e:0, x:0}); } }, 100);
  function copterNet(m){
    let rc = rcops.get(m.id);
    if(!m.e){ if(rc){ scene.remove(rc.g); rcops.delete(m.id); } return; }
    if(!rc){ const g = copter.grp.clone(true); g.visible = true; let hub = null; g.traverse(o => { if(o.userData && o.userData.isHub) hub = o; });
      scene.add(g); g.position.set(m.x, m.y, m.z); rc = {g, hub, t:performance.now()}; rcops.set(m.id, rc); }
    rc.tx = m.x; rc.ty = m.y; rc.tz = m.z; rc.tr = m.r; rc.tq = m.q || 0; rc.tw = m.w || 0; rc.p = m.p; rc.t = performance.now(); rc.st = false; }
  setInterval(() => { const now = performance.now(); rcops.forEach((rc, id) => {
    if((!rc.st && now - rc.t > 5000) || !on){ scene.remove(rc.g); rcops.delete(id); return; }
    const g = rc.g, k = 0.3; g.position.x += (rc.tx - g.position.x) * k; g.position.y += (rc.ty - g.position.y) * k; g.position.z += (rc.tz - g.position.z) * k;
    let d = rc.tr - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * k; g.rotation.x = rc.tq; g.rotation.z = rc.tw;
    if(rc.hub && rc.p) rc.hub.rotation.y += 0.9; }); }, 33);
  return {boarHit(i, d){ send({t:'zd', i, d}); }, fx, fxHit, harvest, drop: dropSel, connect, disconnect, refresh, onDestroy, onHit, onBuild, onShoot, onSwing, melee, hurt, resetDie(){ dieSent = false; }, get on(){ return on; }};
})();


/* ===== Мешки с лутом, смерть и респавн ===== */
var sacks = new Map(), _sackN = 0, _sackNear = null, _isDead = false, _bornAt = Date.now();
const isSackId = id => typeof id==='string' && id.charAt(0)==='S';
const _sackM = new THREE.MeshStandardMaterial({color:0x7a5a34, roughness:0.95}), _sackK = new THREE.MeshStandardMaterial({color:0x4d3a22, roughness:0.95});
const _sackG = [new THREE.SphereGeometry(0.26,12,9), new THREE.CylinderGeometry(0.05,0.1,0.14,8), new THREE.ConeGeometry(0.09,0.15,8)];
function spawnSack(x, y, z, items, ttl){
  const id = 'S'+(++_sackN), grp = new THREE.Group();
  const b = makePackMesh(); b.position.y = 0.02; b.rotation.y = Math.random()*6.28; b.scale.setScalar(1.25);
  grp.add(b); grp.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  grp.position.set(x, y, z); scene.add(grp);
  sacks.set(id, {id, g:grp, x, y, z, born:Date.now(), ttl:ttl||600000});
  storData.set(id, items);
  return id;
}
function removeSack(id){
  const s = sacks.get(id); if(!s) return;
  scene.remove(s.g); sacks.delete(id); storData.delete(id);
  if(storOpenId===id) closeStorage();
}
function spillStorage(id, p){
  try{
    const a = storData.get(id); if(!a) return;
    const items = a.filter(s=>s && s.n>0).map(s=>({k:s.k, n:s.n, ...(s.d!==undefined?{d:s.d}:{})}));
    if(items.length) spawnSack(p.obj.position.x, p.obj.position.y-0.3, p.obj.position.z, items, 600000);
  }catch(e){}
}
const sackEl = document.createElement('button'); sackEl.id = 'sack-prompt'; sackEl.textContent = 'ЗАБРАТЬ ЛУТ';
sackEl.style.cssText = 'position:fixed;left:50%;bottom:calc(250px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:16;display:none;padding:12px 20px;border:none;font:700 13px/1 sans-serif;letter-spacing:1px;color:#fff;background:rgba(111,154,52,.92)';
document.body.appendChild(sackEl);
function openSack(id){
  if(!sacks.has(id)) return;
  storOpenId = id; try{ if(document.exitPointerLock) document.exitPointerLock(); }catch(e){}
  renderStorage(); updateFpsVisibility();
}
sackEl.addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); if(_sackNear) openSack(_sackNear); });
window.addEventListener('keydown', e=>{ if(e.code==='KeyE' && _sackNear && storOpenId===null && !_isDead) openSack(_sackNear); });
function sackTick(dt){
  const now = Date.now(); let near = null, nd = 2.3;
  sacks.forEach(s=>{
    if(now - s.born > s.ttl && storOpenId!==s.id){ removeSack(s.id); return; }
    
    const d = Math.hypot(s.x-player.pos.x, s.z-player.pos.z);
    if(d<nd && Math.abs(s.y-player.pos.y)<2.5){ nd = d; near = s.id; }
  });
  if(_isDead || panelsOpen()) near = null;
  _sackNear = near; const sh = near ? 'block' : 'none'; if(sackEl.style.display !== sh) sackEl.style.display = sh;
}
/* --- смерть --- */
const deathEl = document.createElement('div'); deathEl.id = 'death-screen';
deathEl.style.cssText = 'position:fixed;inset:0;z-index:200;display:none;background:rgba(10,10,10,.92);color:#fff;font:700 14px sans-serif;padding:24px;box-sizing:border-box;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center';
deathEl.innerHTML = '<div style="font-size:44px;letter-spacing:3px">МЁРТВ</div>'
  +'<div style="display:flex;gap:12px;width:min(92vw,460px)"><div style="flex:1"><div style="font-size:11px;opacity:.7;text-align:left">ПОГИБ ОТ</div><div id="dth-by" style="background:#a63a2a;padding:10px 6px;margin-top:4px">—</div></div>'
  +'<div style="flex:1"><div style="font-size:11px;opacity:.7;text-align:left">ПРОЖИТО</div><div id="dth-t" style="background:#5c7a2a;padding:10px 6px;margin-top:4px">0s</div></div></div>'
  +'<div style="font-size:18px;margin-top:10px">Выберите точку возрождения</div>'
  +'<div style="width:min(92vw,460px);box-sizing:border-box;padding:14px;background:#2f2f2f;border:2px solid #e0b030;font-size:18px">⟳ &nbsp;Случайная точка</div>'
  +'<div style="font-size:12px;opacity:.65">Ваш лут остался в мешке на месте гибели. Со старта — только камень.</div>'
  +'<button id="dth-go" style="margin-top:6px;padding:16px 38px;border:none;background:#4f6e22;color:#fff;font:800 20px sans-serif;letter-spacing:1px">ВОЗРОДИТЬСЯ</button>';
document.body.appendChild(deathEl);
function deathTick(){
  if(_isDead){ player.hp = 0; return; }
  if(player.hp > 0) return;
  _isDead = true;
  if(copter.pilot){ copter.pilot=false; copter.engOffT=performance.now(); copter.vx=copter.vz=copter.vy=0; }   // умер за штурвалом — вылетаем из коптера
  lastDeath = {x:player.pos.x, z:player.pos.z, sid:null, t:Date.now()};
  try{ closeWorldPanels(); }catch(e){}
  const loot = [];
  allSlotRefs().concat(equipRefs()).forEach(r=>{ const s = getAt(r); if(s && s.n>0){ loot.push({k:s.k, n:s.n, ...(s.d!==undefined?{d:s.d}:{})}); setAt(r,null); } });
  if(loot.length) lastDeath.sid = spawnSack(player.pos.x, player.pos.y, player.pos.z, loot, 900000);
  let by = window.__deathBy; window.__deathBy = null;
  if(!by){ by = (player.thirst<=0 ? 'Жажда' : player.hunger<=0 ? 'Голод' : (bots.some(b=>!b.dead && Math.hypot(b.x-player.pos.x,b.z-player.pos.z)<60) ? 'Охранник' : 'Неизвестно')); }
  document.getElementById('dth-by').textContent = by;
  const sec = Math.floor((Date.now()-_bornAt)/1000); document.getElementById('dth-t').textContent = sec>=60 ? Math.floor(sec/60)+'m '+(sec%60)+'s' : sec+'s';
  try{ renderHotbar(); renderInvGrid(); refreshHeld(); updateResourceUI(); }catch(e){}
  try{ if(document.exitPointerLock) document.exitPointerLock(); }catch(e){}
  deathEl.style.display = 'flex';
}
document.getElementById('dth-go').addEventListener('click', ()=>{
  if(!_isDead) return;
  if(copter.pilot){ copter.pilot=false; copter.vx=copter.vz=copter.vy=0; }
  const _bs = beachSpawn(), x = _bs.x, z = _bs.z;
  player.pos.set(x, heightAt(x,z)+2, z); player.velY = 0;
  player.hp = 100; player.hunger = 100; player.thirst = 100; player.stamina = 100;
  hotbarSlots[0] = {k:'rock', n:1}; selectedSlot = 0;
  _isDead = false; _bornAt = Date.now(); deathEl.style.display = 'none';
  if(window.OSIL_NET && OSIL_NET.resetDie) OSIL_NET.resetDie();
  try{ renderHotbar(); renderInvGrid(); refreshHeld(); updateResourceUI(); }catch(e){}
  try{ if(!('ontouchstart' in window) && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock(); }catch(e){}
});

})();
