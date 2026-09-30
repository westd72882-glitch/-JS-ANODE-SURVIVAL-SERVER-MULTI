(function(){
"use strict";
const CFG = OSIL_SETTINGS.all;          // живые настройки (меню → localStorage)
let CULL_K = 1;                          // множитель дальности видимости объектов
let layoutEditing = false, FPS_CAP_MS = 0, FPS_UNLIMITED = false;

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
const sulfurTex  = loadTex(TEXTURES.tex_sulfur, 1, 1);
const metalTex   = loadTex(TEXTURES.tex_metal, 1, 1);
[grassTex,woodTex,barkTex,foliageTex,leafTex,stoneTex,sulfurTex,metalTex].forEach(t=>{ t.anisotropy = maxAniso; });

/* ---------------- Basic setup ---------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec9e8);
scene.fog = new THREE.Fog(0x8ec9e8, 35, 150);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth/window.innerHeight, 0.02, 190);
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

window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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
const _sunDir = SUN_OFFSET.clone().normalize();
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
  return Math.max(-32, wgSample(WG.h, x, z) - beyond*0.18);
}
const isWaterAt  = (x,z)=> heightAt(x,z) < 0.02;
const isLandAt   = (x,z)=> !isWaterAt(x,z);

const BIOME_COLOR = {
  [B.DEEP]:0x1b3b52, [B.SEA]:0x2a5f7d, [B.BEACH]:0xe6d5a2, [B.DESERT]:0xdcc07f,
  [B.PLAIN]:0x7d9a45, [B.FOREST]:0x486b34, [B.SNOW]:0xdce6ea, [B.LAKE]:0x3a7391, [B.ROCK]:0x78746c
};
const groundSeg = 160;
const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, groundSeg, groundSeg);
groundGeo.rotateX(-Math.PI/2);
const posAttr = groundGeo.attributes.position;
const colArr = new Float32Array(posAttr.count*3), flatArr = new Float32Array(posAttr.count);
const FLAT_K = {[B.SNOW]:0.8, [B.DESERT]:0.7, [B.BEACH]:0.6};
const _c = new THREE.Color(), _c2 = new THREE.Color(), _deep = new THREE.Color(0x1b3b52);
/* Мягкая выборка биома: усредняем несколько соседних точек генератора вместо
   ближайшего соседа — это убирает резкую границу «холм упирается в снег/песок». */
function biomeColorSmooth(x, z, out){
  const R = 6.5;         // радиус усреднения в метрах — сглаживает переходы биомов
  let r=0,g=0,b=0,flat=0,wsum=0;
  const offs = [[0,0,1.6],[R,0,1],[-R,0,1],[0,R,1],[0,-R,1],[R*0.7,R*0.7,0.7],[-R*0.7,R*0.7,0.7],[R*0.7,-R*0.7,0.7],[-R*0.7,-R*0.7,0.7]];
  for(const [ox,oz,w] of offs){
    const bm = biomeAt(x+ox, z+oz);
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
  if(yy<0){ _c.setHex(0xe6d5a2).lerp(_deep, Math.min(1,-yy/7)); flatK=0.65; }
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
(function(){
  const g = new THREE.PlaneGeometry(WORLD_SIZE*2, WORLD_SIZE*2, 80, 80); g.rotateX(-Math.PI/2);
  const p = g.attributes.position, col = new Float32Array(p.count*3), idx = g.index.array, keep = [];
  for(let i=0;i<p.count;i++){
    const y = heightAt(p.getX(i), p.getZ(i)); p.setY(i, y);
    _c.setHex(0xe6d5a2).lerp(_deep, Math.min(1,-y/7)); col[i*3]=_c.r; col[i*3+1]=_c.g; col[i*3+2]=_c.b;
  }
  for(let t=0;t<idx.length;t+=3){
    const a=idx[t], b=idx[t+1], c=idx[t+2];
    const cx=(p.getX(a)+p.getX(b)+p.getX(c))/3, cz=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3;
    if(Math.max(Math.abs(cx),Math.abs(cz)) > WORLD_SIZE/2-3) keep.push(a,b,c);
  }
  g.setIndex(keep); g.setAttribute('color', new THREE.BufferAttribute(col,3)); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({vertexColors:true, roughness:1})));
})();

/* море: одна большая плоскость на уровне моря (озёра лежат ниже — видны через неё) */
const seaTex = loadTex(TEXTURES.tex_water, 90, 90);
const seaMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE*3, WORLD_SIZE*3),
  new THREE.MeshStandardMaterial({map:seaTex, color:0x7fa3b8, transparent:true, opacity:0.9, roughness:0.2, metalness:0.05})
);
seaMesh.rotation.x = -Math.PI/2; seaMesh.position.y = SEA_Y; scene.add(seaMesh);
const seaAnim = ()=>{ seaTex.offset.x += 0.00025; seaTex.offset.y += 0.00018; };

/* ---------------- Collidable world objects ---------------- */
const colliders = [];
const harvestables = [];
const buildings = [];

/* owner — объект (harvestable/здание), которому принадлежит коллайдер.
   Когда объект срублен/добыт — removeCollidersOf(owner) убирает коллизию. */
function addCollider(mesh, owner, shrink){
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  if(shrink){ // сужаем бокс по XZ (для деревьев — только ствол)
    const cx=(box.min.x+box.max.x)/2, cz=(box.min.z+box.max.z)/2;
    box.min.x=cx-shrink; box.max.x=cx+shrink; box.min.z=cz-shrink; box.max.z=cz+shrink;
  }
  const c = {mesh, box, owner: owner||mesh};
  colliders.push(c);
  return c;
}
function removeCollidersOf(owner){
  for(let i=colliders.length-1;i>=0;i--){
    if(colliders[i].owner===owner || colliders[i].mesh===owner) colliders.splice(i,1);
  }
}
/* полностью убрать объект из мира: меш, коллизию, запись harvestables */
function destroyHarvestable(target){
  if(window.OSIL_NET) OSIL_NET.onDestroy(target);
  removeCollidersOf(target);
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
const stoneMat   = new THREE.MeshStandardMaterial({map:stoneTex, roughness:1, flatShading:true});
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
  return {group, trunkR:rBase*1.3, height:h+1};
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
  return {group, trunkR:rBase*1.3, height:h+2.4};
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
  const h = {mesh:group, hitMesh:group, type:'wood', health:60, maxHealth:60, giveMin:6, giveMax:10, radius:1.6, extra:[colMesh]};
  addCollider(colMesh, h, trunkR);
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
  const h = {mesh:group, hitMesh:group, type, health:cfg.hp, maxHealth:cfg.hp, giveMin:cfg.min, giveMax:cfg.max, radius:base+0.5};
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
scatter(230, makeTree, 6, [B.FOREST]);                 // густой лес
scatter(60,  makeTree, 9, [B.PLAIN]);                  // редкие деревья на равнине
scatter(55,  makeTree, 8, [B.SNOW]);                   // заснеженные сосны
scatter(70,  makeRock, 6, [B.PLAIN,B.FOREST,B.SNOW,B.ROCK]);
scatter(45,  makeRock, 7, [B.DESERT]);                 // пустыня — россыпь камней
scatter(38,  makeSulfurNode, 12, [B.DESERT,B.ROCK,B.SNOW,B.PLAIN]);
scatter(36,  makeMetalNode,  12, [B.DESERT,B.ROCK,B.SNOW,B.PLAIN]);
scatter(80,  makeBush, 4, [B.PLAIN,B.FOREST]);
scatter(22,  makeBarrel, 25, [B.PLAIN,B.FOREST,B.DESERT,B.SNOW,B.ROCK,B.BEACH]);   // бочки с металлоломом

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
let SHADOW_R2 = (CFG.shadowDist||60)*(CFG.shadowDist||60);
let cullT = 0;
function updateCulling(dt, force){
  cullT -= dt; if(cullT>0 && !force) return; cullT = 0.2;
  const px=player.pos.x, pz=player.pos.z;
  for(let i=0;i<cullables.length;i++){
    const c=cullables[i], dx=c.obj.position.x-px, dz=c.obj.position.z-pz, d2=dx*dx+dz*dz;
    const vis = d2<c.r2;
    if(vis!==c.vis){ c.obj.visible=vis; c.vis=vis; shadowDirty = true; }
    if(!vis) continue;
    const sh = d2<SHADOW_R2;
    if(sh!==c.shadow){ c.shadow=sh; shadowDirty = true; for(let k=0;k<c.meshes.length;k++) c.meshes[k].castShadow = sh && c.meshes[k]._cs; }
  }
}

/* ---------------- Player ---------------- */
const player = {
  pos: new THREE.Vector3(SPAWN.x, heightAt(SPAWN.x,SPAWN.z)+2, SPAWN.z),
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
function updateCameraFromPlayer(){
  const mode = CFG.camMode|0;
  const cy = player.height;
  _eye.set(player.pos.x, player.pos.y + cy, player.pos.z);
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
    bx(0.150,0.16,0.150,skinM,0,-0.22,0,el);                      // предплечье и кисть
    const hold=grp(0,-0.3,0); el.add(hold);
    torso.add(sh); return {sh,el,hold};
  };
  const armL=mkArm(-0.265), armR=mkArm(0.265);
  return {root,torso,head,legL,legR,armL,armR,jacketM:jacket,jacketDM:jacketD,phase:0,amp:0,swing:0,lx:0,lz:0,held:null,heldKind:'none',toolMeshes:{}};
}
const playerModel=(function(){ const m=buildHumanRig(0x4d5b3d); m.lx=player.pos.x; m.lz=player.pos.z; m.root.visible=false; scene.add(m.root); return m; })();
const RIG_TOOLS={axe:1,pickaxe:1,rifle:1,pistol:1,berdanka:1,spear:1};
function setRigTool(m,k){
  if(!RIG_TOOLS[k]) k='none';
  if(k===m.heldKind) return;
  if(m.held){ m.armR.hold.remove(m.held); m.held=null; }
  m.heldKind=k;
  if(k==='none') return;
  let t=m.toolMeshes[k];
  if(!t){
    const src = k==='axe' ? makeAxeModel() : k==='rifle' ? OSIL_TOOLS.makeRifle(false) : k==='pistol' ? OSIL_TOOLS.makePistol(false) : k==='berdanka' ? OSIL_TOOLS.makeBerdanka(false) : k==='spear' ? OSIL_TOOLS.makeSpear() : makePickaxeModel();
    t=new THREE.Group(); t.add(src);
    src.position.set(0,0,0); src.rotation.set(0,0,0); src.scale.setScalar((k==='rifle'||k==='berdanka')?0.85:(k==='pistol'?1.0:(k==='spear'?1.0:1.15)));
    src.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
    t.rotation.set((k==='rifle'||k==='pistol'||k==='berdanka')?-Math.PI/2:(k==='spear'?-1.05:-1.25),0,0);
    if(k==='rifle') src.position.set(0,0.077,-0.077); else if(k==='pistol') src.position.set(0,0.064,0.034); else if(k==='berdanka') src.position.set(0,0.066,-0.046);
    if(k==='rifle'||k==='pistol'||k==='berdanka') m.rifleFlash=src.userData.flash||null;
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
  if(held){       // вторая рука держит рукоять
    m.root.updateMatrixWorld(true);
    if(m.heldKind==='pistol') _gp.set(-0.01,-0.03,0.04); else if(m.heldKind==='berdanka') _gp.set(0,0.06,-0.26); else if(rifle) _gp.set(0,0.07,-0.34); else if(m.heldKind==='spear') _gp.set(0,0.5,0); else _gp.set(0,0.3,0);
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

function makePickaxeModel(){ return OSIL_TOOLS.makePickaxe(); }


/* ---- Штурмовая винтовка: магазин 30, перезарядка, прицеливание, гильзы ---- */
const GUNS = {
  rifle:  {mag:30, ammo:'ammo_rifle',  dmg:20, rate:0.1,  reload:2.1, snd:'ak', rate2:1,   icon:'assets/pack/icons/ak.webp',     name:'ШТУРМОВАЯ ВИНТОВКА'},
  berdanka:{mag:15, ammo:'ammo_rifle', dmg:35, rate:0.32, reload:2.6, snd:'ak', rate2:0.72, icon:'assets/pack/icons/berdanka.webp', name:'ПОЛУАВТОМАТИЧЕСКАЯ ВИНТОВКА', semi:true},
  pistol: {mag:12, ammo:'ammo_pistol', dmg:25, rate:0.2,  reload:1.5, snd:'ak', rate2:1.7, icon:'assets/pack/icons/pistol.webp', name:'ПИСТОЛЕТ'}
};
const isGun = k => k==='rifle' || k==='pistol' || k==='berdanka';
let aimOn = false, aimHeld = false, aimK = 0, reloadT = -1, reloadSlot = null, _noAmmoT = 0, _crossEl = null;
function rifleSlot(){ const s = hotbarSlots[selectedSlot]; return (s && isGun(s.k)) ? s : null; }
/* HUD «в магазине / в запасе» + кнопки прицела и перезарядки видны только с винтовкой */
let _ammoEl = null;
function updateAmmoHud(){
  try{
    if(!_ammoEl){
      _ammoEl = document.createElement('div'); _ammoEl.id = 'ammo-hud';
      _ammoEl.innerHTML = '<div class="ah-ico"><img src="assets/pack/icons/ak.webp" alt="" draggable="false"></div><div class="ah-txt"><div class="ah-name">ШТУРМОВАЯ · АВТО</div><div class="ah-cnt"><span id="ah-mag">0</span><span id="ah-res">/0</span></div></div>';
      document.body.appendChild(_ammoEl);
    }
    const sl = rifleSlot(), on = (isGun(toolKind) && !!sl);
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
  const sl = rifleSlot(); if(!sl || reloadT>=0 || !isGun(toolKind)) return;
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
  if(window.OSIL_NET) OSIL_NET.onShoot();
  OSIL_AUDIO.play(G_.snd,{vol:0.8,rate:G_.rate2});
  const kick = (1 - 0.4*aimK) * (sl.k==='pistol' ? 0.9 : 1);                                          // в прицеливании отдача мягче
  camKick = 0.02*kick;
  const sg = Math.random()<0.5 ? -1 : 1;
  VM.z[1] += 1.1*kick; VM.y[1] += 0.22*kick; VM.rx[1] += 0.9*kick; VM.rz[1] += sg*0.25*kick; VM.x[1] += sg*0.05*kick;
  player.pitch = Math.min(1.4, player.pitch + 0.004*kick);
  const fl = currentToolMesh && currentToolMesh.userData.flash;
  if(fl){ fl.visible = true; fl.rotation.z = Math.random()*6; fl.scale.setScalar(0.8+Math.random()*0.5); clearTimeout(fireGun._h); fireGun._h = setTimeout(()=>{ fl.visible=false; },45); }
  ejectCasing();
  shotImpact();
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
  axe:     { pos:new THREE.Vector3( 0.30,-0.34,-0.52), rot:new THREE.Euler(-0.10,-0.06, 0.03) },
  pickaxe: { pos:new THREE.Vector3( 0.30,-0.34,-0.52), rot:new THREE.Euler(-0.10,-0.06, 0.03) },
  spear:   { pos:new THREE.Vector3( 0.30,-0.36,-0.50), rot:new THREE.Euler(-1.00,-0.10, 0.06) },
  rifle:   { pos:new THREE.Vector3( 0.14,-0.19,-0.36), rot:new THREE.Euler( 0.00, 0.00, 0.00) },
  berdanka:{ pos:new THREE.Vector3( 0.14,-0.20,-0.40), rot:new THREE.Euler( 0.00, 0.00, 0.00) },
  pistol:  { pos:new THREE.Vector3( 0.15,-0.15,-0.40), rot:new THREE.Euler( 0.00, 0.00, 0.00) },
  hand:    { pos:new THREE.Vector3( 0.27,-0.24,-0.45), rot:new THREE.Euler( 0.10,-0.30, 0.10) },
};
let toolKind = 'none';

/* ---- Тайминги (как в Rust: замах → удар → отдача; между ударами — кулдаун) ---- */
const SWING_DUR = 0.88;   // полная длительность удара = кулдаун между ударами, с
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
function triggerSwing(){
  if(window.OSIL_NET) OSIL_NET.onSwing();
  playerModel.swing=1;
  if(swinging) return false;
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
  if(kind==='axe') mesh = toolCache.axe || (toolCache.axe = makeAxeModel());
  else if(kind==='pickaxe') mesh = toolCache.pickaxe || (toolCache.pickaxe = makePickaxeModel());
  else if(kind==='spear') mesh = toolCache.spear || (toolCache.spear = OSIL_TOOLS.makeSpear());
  else if(kind==='berdanka') mesh = toolCache.berdanka || (toolCache.berdanka = OSIL_TOOLS.makeBerdanka(true));
  else if(kind==='pistol') mesh = toolCache.pistol || (toolCache.pistol = OSIL_TOOLS.makePistol(true));
  else if(kind==='rifle') mesh = toolCache.rifle || (toolCache.rifle = OSIL_TOOLS.makeRifle(true));
  else { currentToolMesh = null; updateAmmoHud(); return; }   // пустые руки: модели нет вообще
  const pose = TOOL_POSE[kind] || TOOL_POSE.hand;
  mesh.position.copy(pose.pos);
  mesh.rotation.copy(pose.rot);
  if(equipT < 1) mesh.position.y -= 0.6;      // не мелькает в позе покоя до первого кадра
  mesh.traverse(o=>{ o.frustumCulled = false; });   // оружие у самой камеры не должно пропадать
  viewGroup.add(mesh);
  currentToolMesh = mesh;
  currentArms = mesh.userData.arms || null;
  if(currentArms){ currentArms.forEach(a=>viewGroup.add(a)); OSIL_TOOLS.updateArms(mesh); }
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
  const wantAim = isGun(toolKind) && (aimOn||aimHeld) && reloadT<0 && sprintK<0.4 && equipT>=1;
  aimK += ((wantAim?1:0) - aimK) * Math.min(1, dt*12);
  if(aimK < 0.001) aimK = 0;
  const fovT = CFG.fov*(1 - 0.30*aimK);
  if(Math.abs(camera.fov - fovT) > 0.05){ camera.fov = fovT; camera.updateProjectionMatrix(); }
  if(!_crossEl) _crossEl = document.getElementById('crosshair');
  if(_crossEl) _crossEl.style.opacity = (isGun(toolKind) && aimK>0.3) ? '0' : '';
  const m = currentToolMesh;
  if(!m) return;
  const pose = TOOL_POSE[toolKind] || TOOL_POSE.hand, tS = performance.now()/1000;
  let dx=0, dy=0, dz=0, rx=0, ry=0, rz=0, hitNow = false;

  if(equipT < 1){
    equipT = Math.min(1, equipT + dt/EQUIP_DUR);
    const k = Math.pow(1-equipT, 3);
    dx += 0.16*k; dy += -0.62*k; dz += 0.10*k;
    rx += 1.10*k; rz += 0.55*k; ry += -0.35*k;
  }
  if(swinging){
    const prevT = swingT;
    swingT += dt/SWING_DUR;
    if(swingHitFn && swingT >= HIT_AT){ const f = swingHitFn; swingHitFn = null; f(); }
    if(prevT < HIT_AT && swingT >= HIT_AT) hitNow = true;
    if(swingT >= 1){ swinging = false; swingT = 0; }
    else {
      const s = sampleSwing(swingT);
      if(toolKind==='spear'){ dx+=s[0]*0.4; dy+=s[1]*0.3; dz+=s[2]*3.2; rx+=s[3]*0.25; ry+=s[4]*0.5; rz+=s[5]*0.4; }   // выпад вперёд
      else { dx+=s[0]; dy+=s[1]; dz+=s[2]; rx+=s[3]; ry+=s[4]; rz+=s[5]; }
    }
  }
  // отдача: импульс в пружины → кирка отскакивает, тяжело «оседает» и затухает
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
  if(isGun(toolKind)){
    const sc = m.userData.sightCenter;
    if(aimK > 0){                                   // точка в окне прицела встаёт в центр экрана
      px += (-sc.x - px)*aimK; py += (-sc.y - py)*aimK; pz += (-0.38 - sc.z - pz)*aimK;
      const q = 1 - 0.55*aimK; dx*=q; dy*=q; dz*=q; rx*=q; ry*=q; rz*=q;
    }
    if(reloadT >= 0){                               // анимация перезарядки
      reloadT += dt/GUNS[toolKind].reload;
      const ss = (a,b,x)=>{ x = Math.max(0,Math.min(1,(x-a)/(b-a))); return x*x*(3-2*x); };
      const dn = ss(0.0,0.18,reloadT)*(1-ss(0.82,1.0,reloadT));
      dy -= 0.07*dn; rx += 0.30*dn; rz += 0.42*dn; dx -= 0.03*dn;
      const out = ss(0.18,0.38,reloadT)*(1-ss(0.55,0.72,reloadT));
      const mg = m.userData.mag; if(mg){ mg.position.y = -0.30*out; mg.visible = out < 0.96; }
      if(!m.userData._r1 && reloadT>0.3){ m.userData._r1 = true; OSIL_AUDIO.play('close',{vol:0.5,rate:1.6}); }
      if(!m.userData._r2 && reloadT>0.66){ m.userData._r2 = true; OSIL_AUDIO.play('open',{vol:0.6,rate:1.8}); dz += 0.01; VM.y[1] += 0.12; }
      if(!m.userData._r3 && reloadT>0.86){ m.userData._r3 = true; OSIL_AUDIO.play('empty',{vol:0.6,rate:0.7}); }
      if(reloadT >= 1){ m.userData._r1 = m.userData._r2 = m.userData._r3 = false; if(m.userData.mag){ m.userData.mag.position.y = 0; m.userData.mag.visible = true; } finishReload(); }
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
  door:    {name:'Дверь',         icon:TEXTURES.icon_door,    stack:10, kind:'comp'},
  // --- не стакаются (1) ---
  axe:     {name:'Каменный топор',icon:TEXTURES.icon_axe,     stack:1, kind:'tool', maxDur:150},
  pickaxe: {name:'Каменная кирка',icon:TEXTURES.icon_pickaxe, stack:1, kind:'tool', maxDur:150},
  spear:   {name:'Копьё',         icon:TEXTURES.icon_spear,   stack:1, kind:'tool', maxDur:120},
  rifle:   {name:'Штурмовая винтовка',icon:TEXTURES.icon_rifle, stack:1, kind:'gun', maxDur:400},
  berdanka:{name:'Полуавтоматическая винтовка',icon:TEXTURES.icon_berdanka, stack:1, kind:'gun', maxDur:350},
  pistol:  {name:'Пистолет',icon:TEXTURES.icon_pistol, stack:1, kind:'gun', maxDur:300},
  ammo_pistol:{name:'Пистолетные патроны',icon:TEXTURES.icon_ammo_pistol, stack:120, kind:'comp'},
  ammo_rifle:{name:'Винтовочные патроны',icon:TEXTURES.icon_ammo_rifle, stack:120, kind:'comp'},
  plan:    {name:'План строительства',icon:TEXTURES.icon_plan,stack:1, kind:'plan'},
  bag:     {name:'Спальный мешок',icon:TEXTURES.icon_bag,     stack:1, kind:'gear'},
  helm_rusty:{name:'Ржавый шлем', icon:TEXTURES.icon_helm_rusty, stack:1, kind:'armor', maxDur:100},
  helm_home:{name:'Самодельный шлем',icon:TEXTURES.icon_helm_home,stack:1, kind:'armor', maxDur:140},
  armor:   {name:'Броня',         icon:TEXTURES.icon_armor,   stack:1, kind:'armor', maxDur:180},
  satchel: {name:'Сатчел-заряд',  icon:TEXTURES.icon_satchel, stack:1, kind:'gear'},
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
const EQUIP_ALLOW = {head:['helm_rusty','helm_home'], chest:['armor'], legs:[], feet:[], pack:['backpack']};
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
addItem('axe',1); addItem('pickaxe',1);   // стартовый набор → пояс

/* выдача добычи/крафта с учётом лимита. Излишек не пропадает молча — игрок видит сообщение. */
function giveItem(k, n, dur){
  const got = addItem(k,n,dur);
  if(got<n){ showToast('Нет места: '+(RES_NAMES[k]||k)+' ×'+(n-got)+' пропало'); }
  return got;
}

function makeBuildMat(){ return new THREE.MeshStandardMaterial({map:loadTex(TEXTURES.tex_plank,1,1), roughness:0.95}); }

function createFoundation(){ return new THREE.Mesh(new THREE.BoxGeometry(4,0.3,4), makeBuildMat()); }
function createWall(){ return new THREE.Mesh(new THREE.BoxGeometry(4,3,0.25), makeBuildMat()); }
function createFloor(){ return new THREE.Mesh(new THREE.BoxGeometry(4,0.15,4), makeBuildMat()); }
function createDoorway(){
  const grp = new THREE.Group();
  const mat = makeBuildMat();
  const top = new THREE.Mesh(new THREE.BoxGeometry(4,0.5,0.25), mat);
  top.position.y = 1.35;
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.4,3,0.25), mat);
  left.position.x = -1.8;
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.4,3,0.25), mat);
  right.position.x = 1.8;
  grp.add(top,left,right);
  return grp;
}

const CELL = 4;            // размер клетки, м
const FLOOR_H = 3;         // высота этажа
function createDoor(){
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.6,2.7,0.12), makeBuildMat());
  return m;
}
/* kind: 'cell' — занимает клетку (фундамент/пол), 'edge' — на ребре клетки (стена/проём/дверь).
   cost: что списывается. Часть деталей берётся из готовых предметов крафта (wood_wall, door). */
const BUILD_TYPES = {
  foundation:{ name:'Фундамент', kind:'cell', make:createFoundation, cost:{wood:40},               snapY:0.15,  needGround:true },
  floor:     { name:'Пол',       kind:'cell', make:createFloor,      cost:{wood:20},               snapY:0.075, needBelow:true },
  wall:      { name:'Стена',     kind:'edge', make:createWall,       cost:{wood_wall:1},           snapY:1.5,   needBelow:true },
  doorway:   { name:'Проём',     kind:'edge', make:createDoorway,    cost:{wood:24},               snapY:1.5,   needBelow:true },
  door:      { name:'Дверь',     kind:'edge', make:createDoor,       cost:{door:1},                snapY:1.35,  needDoorway:true },
};
const BUILD_ORDER = ['foundation','wall','doorway','door','floor'];

/* ---------------- Crafting system ---------------- */
const CRAFT_CATS = [
  {id:'all',   name:'ВСЕ'},
  {id:'tools', name:'ИНСТРУМЕНТЫ'},
  {id:'weapons',name:'ОРУЖИЕ'},
  {id:'armor', name:'БРОНЯ'},
  {id:'comp',  name:'КОМПОНЕНТЫ'},
  {id:'build', name:'СТРОЙКА'},
];
/* cost — ресурсы; give — что получаем; wb:1 — нужен верстак рядом (пока: предмет «Верстак» в инвентаре);
   quick:false — не показывать в «быстром создании». */
const CRAFT_RECIPES = [
  // --- инструменты ---
  { id:'axe',     cat:'tools', name:'Каменный топор', desc:'Хорошо рубит деревья. Каждый крафт даёт новый топор.', icon:ITEM_DEFS.axe.icon,     time:5,  cost:{wood:30},            give:{tool:'axe'} },
  { id:'pickaxe', cat:'tools', name:'Каменная кирка', desc:'Добывает камень, серу и металл.',          icon:ITEM_DEFS.pickaxe.icon, time:5,  cost:{wood:20,stone:20},   give:{tool:'pickaxe'} },
  { id:'spear',   cat:'weapons', name:'Копьё',        desc:'Простое оружие ближнего боя.',            icon:ITEM_DEFS.spear.icon,   time:8,  cost:{wood:40,stone:15},   give:{tool:'spear'} },
  { id:'rifle',  cat:'weapons', name:'Штурмовая винтовка', desc:'Автоматическая винтовка. Зажмите «Удар» для стрельбы. Нужны винтовочные патроны.', icon:ITEM_DEFS.rifle.icon, time:25, cost:{metal:120,pipe:2,gear:2,wood:60}, give:{tool:'rifle'} },
  { id:'berdanka', cat:'weapons', name:'Полуавтоматическая винтовка', desc:'Полуавтоматическая винтовка. Магазин 15, винтовочные патроны, урон 35, в голову ×2.', icon:ITEM_DEFS.berdanka.icon, time:30, cost:{metal:150,pipe:3,gear:3,wood:80}, give:{tool:'berdanka'} },
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
  { id:'helm_rusty',cat:'armor', name:'Ржавый шлем',  desc:'Простая защита головы.',                      icon:ITEM_DEFS.helm_rusty.icon, time:12, cost:{metal:25,cloth:10}, give:{item:'helm_rusty'} },
  // --- предметы ---
  // --- стройка ---
  { id:'plan',    cat:'build', name:'План строительства', desc:'Открывает режим строительства. Выберите в поясе и нажмите «Удар».', icon:ITEM_DEFS.plan.icon,  time:6,  cost:{wood:30,cloth:10},   give:{item:'plan'} },
];
/* Прочность хранится в самом слоте (slot.d). Инструмент в руке — hotbar[selectedSlot]. */
function isTool(k){ return ITEM_DEFS[k] && ITEM_DEFS[k].kind==='tool'; }
function durFrac(slot){ return (slot && durable(slot.k) && slot.d!==undefined) ? slot.d/TOOL_MAX_DUR[slot.k] : null; }
/* лучший экземпляр предмета: с максимальной прочностью (для ремонта — с минимальной) */
function findSlots(k){ return allSlotRefs().concat(equipRefs()).filter(r=>{const x=getAt(r);return x&&x.k===k;}); }

let ADMIN_FREE = false;
try{ ADMIN_FREE = localStorage.getItem('osil_admin')==='1'; }catch(e){}
function canCraft(r, qty){
  if(ADMIN_FREE) return true;
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
function craftItem(id, qty){
  qty = qty||1;
  const r = CRAFT_RECIPES.find(x=>x.id===id);
  if(!r) return;
  if(!canCraft(r, qty)){ showToast('Недостаточно ресурсов'); window.OSIL_AUDIO&&OSIL_AUDIO.play('rust-door-denied'); return; }
  const key = r.give.tool || r.give.item;
  const cap = stackOf(key);
  const want = (r.give.amount||1) * qty;
  if(roomFor(key) < want){ showToast('Нет места в инвентаре'); window.OSIL_AUDIO&&OSIL_AUDIO.play('rust-door-denied'); return; }
  if(!ADMIN_FREE) Object.keys(r.cost).forEach(k => removeItem(k, r.cost[k]*qty));
  addItem(key, want);
  showToast('+'+want+' '+r.name);
  window.OSIL_AUDIO&&OSIL_AUDIO.play('build');
  updateResourceUI();
  renderCraftUI();
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
    const n = CRAFT_RECIPES.filter(r=>c.id==='all'||r.cat===c.id).length;
    const el = document.createElement('div');
    el.className = 'cc-item' + (c.id===craftCat?' active':'');
    el.innerHTML = '<span>'+c.name+'</span><b>'+n+'</b>';
    el.addEventListener('click', ()=>{ craftCat=c.id; renderCraftUI(); });
    cats.appendChild(el);
  });
  // сетка
  grid.innerHTML = '';
  const list = CRAFT_RECIPES.filter(r=>craftCat==='all'||r.cat===craftCat);
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
function syncBuildMode(){
  const on = planInHand() && !panelsOpen();
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
  box.innerHTML = '';
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
function maxLevelAt(cx,cz){           // верхний этаж клетки (−1 — пусто)
  let m=-1; for(let l=0;l<6;l++) if(cells.has(cellKey(cx,cz,l))) m=l; return m;
}

/* вычислить позицию/поворот призрака и валидность */
function computePlacement(){
  const bt = BUILD_TYPES[currentBuildType];
  const ap = aimPoint();
  let x, z, rotY=0;
  if(bt.kind==='cell'){ x = snapCell(ap.x); z = snapCell(ap.z); }
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
      // 4 угла клетки: все на суше, перепад высот ≤ 1.2 м
      const hs=[[-2,-2],[2,-2],[-2,2],[2,2]].map(o=>{ const px=x+o[0], pz=z+o[1]; return isWaterAt(px,pz)?null:heightAt(px,pz); });
      if(hs.some(h=>h===null)){ ok=false; why='Нельзя строить на воде'; }
      else if(Math.max(...hs)-Math.min(...hs) > 1.2){ ok=false; why='Слишком неровная земля'; }
      y = hs.every(h=>h!==null) ? Math.max(...hs) : heightAt(x,z);
      level=0;
    } else { // floor — на этаж выше самого верхнего элемента клетки
      const top = maxLevelAt(x,z);
      if(top<0){ ok=false; why='Пол кладётся поверх фундамента'; level=1; }
      else { level=top+1; if(level>4){ ok=false; why='Слишком высоко'; } }
      const base = cells.get(cellKey(x,z,0));
      y = (base?base.y:heightAt(x,z)) + level*FLOOR_H;
      if(cells.has(cellKey(x,z,level))){ ok=false; why='Здесь уже есть пол'; }
    }
  } else {
    // рёберные: этаж = верхний уровень примыкающих клеток
    const adj = edgeCells(x,z,rotY);
    let top=-1; adj.forEach(c=>{ top=Math.max(top,maxLevelAt(c[0],c[1])); });
    if(top<0){ ok=false; why='Стена ставится на фундамент'; level=0; }
    else level=top;
    const base = adj.map(c=>cells.get(cellKey(c[0],c[1],0))).find(Boolean);
    y = (base?base.y:heightAt(x,z)) + level*FLOOR_H;
    const ex = edges.get(edgeKey(x,z,level));
    if(currentBuildType==='door'){
      if(!ex || ex.type!=='doorway'){ ok=false; why='Дверь ставится в проём'; }
      else if(ex.door){ ok=false; why='В проёме уже есть дверь'; }
    } else if(ex){ ok=false; why='Здесь уже есть стена'; }
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

function spawnBuilt(type, x,y,z,rotY,level,base){
  const bt = BUILD_TYPES[type];
  const real = bt.make();
  real.position.set(x,y,z);
  real.rotation.y = rotY;
  real.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  scene.add(real);
  const rec = {type:type, obj:real, y:base};
  if(bt.kind==='cell'){ cells.set(cellKey(x,z,level), rec); }
  else if(type==='door'){
    const ex = edges.get(edgeKey(x,z,level)); if(ex) ex.door = real;     // дверь — не коллайдер: в проём можно пройти
  } else {
    edges.set(edgeKey(x,z,level), rec);
    if(type==='wall') addCollider(real);
    else { // проём: коллайдер только по бокам (проходимая середина)
      addCollider(real.children[1]); addCollider(real.children[2]);
    }
  }
  buildings.push(real);
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
  showToast(p.bt.name+' построен');
  return true;
}

/* ---------------- Input: keyboard ---------------- */
const keys = {};
window.addEventListener('keydown', e=>{
  keys[e.code]=true;
  if(e.code==='Tab'){ e.preventDefault(); toggleInventory(); }
  if(e.code==='KeyC' || e.code==='ControlLeft'){ toggleCrouch(); }
  if(e.code>='Digit1' && e.code<='Digit6'){ selectSlot(parseInt(e.code.slice(-1))-1); }
  if(e.code==='Space'){ jump(); }
  if(e.code==='KeyQ' && buildMode){ cycleBuildType(1); }
  if(e.code==='KeyR' && buildMode){ rotateBuild(); }
  else if(e.code==='KeyR' && isGun(toolKind)){ startReload(); }
  if(e.code==='KeyM'){ toggleMap(); }
});
window.addEventListener('keyup', e=>{ keys[e.code]=false; });

let attackHeld = false;
renderer.domElement.addEventListener('mousedown', e=>{
  if(isMobile() && e.button===0) return;
  if(e.button===2 && isGun(toolKind)){ aimHeld = true; return; }          // ПКМ с винтовкой = прицел
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
  if(player.onGround){ player.velY = 6.2; player.onGround=false; window.OSIL_AUDIO&&OSIL_AUDIO.play('jump',{vol:0.7}); }
}
(function(){
  const ba = document.getElementById('btn-aim'), br = document.getElementById('btn-reload');
  if(ba) ba.addEventListener('pointerdown', e=>{ e.preventDefault(); if(isGun(toolKind)){ aimOn = !aimOn; ba.classList.toggle('active', aimOn); } });
  if(br) br.addEventListener('pointerdown', e=>{ e.preventDefault(); startReload(); });
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
  let g = heightAt(x,z);
  const cx=Math.round(x/CELL), cz=Math.round(z/CELL);
  for(let l=0;l<6;l++){
    const c = cells.get(cx+','+cz+','+l);
    if(!c) continue;
    const top = c.y + l*FLOOR_H + (c.type==='foundation'?0.3:0.15);
    if(feetY >= top-(l===0?1.4:0.6) && top>g) g = top;
  }
  return g;
}
/* в воду можно зайти по колено (мелководье), дальше — слишком глубоко, плавать пока нельзя */
const MAX_WADE_DEPTH = 1.1;
function tooDeep(x,z){ return (SEA_Y - heightAt(x,z)) > MAX_WADE_DEPTH; }
function collidesAt(x,z){
  const r = 0.4;
  for(const c of colliders){
    const b = c.box;
    if(x > b.min.x-r && x < b.max.x+r && z > b.min.z-r && z < b.max.z+r){
      if(player.pos.y < b.max.y && player.pos.y+player.height > b.min.y){
        return true;
      }
    }
  }
  return false;
}

function updateMovement(dt){
  let fwd=0, strafe=0;
  if(keys['KeyW']) fwd+=1;
  if(keys['KeyS']) fwd-=1;
  if(keys['KeyD']) strafe+=1;
  if(keys['KeyA']) strafe-=1;
  if(joyActive){ fwd -= joyVec.y; strafe += joyVec.x; }

  const len = Math.hypot(fwd,strafe);
  if(len>0){ fwd/=len; strafe/=len; }
  if(len>0 && (CFG.camMode|0)===3){ player.yaw = orbit.yaw; player.pitch = 0; }   // «осмотр»: при ходьбе идём относительно камеры

  const running = (keys['ShiftLeft'] || runOn) && player.stamina>1 && !isCrouching;
  const crouchMult = isCrouching ? 0.5 : 1;
  const spd = player.speed * (running?player.runMult:1) * crouchMult * Math.min(len,1);

  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  const moveX = (-sinY*fwd + cosY*strafe) * spd * dt;
  const moveZ = (-cosY*fwd - sinY*strafe) * spd * dt;

  const nx = player.pos.x+moveX, nz = player.pos.z+moveZ;
  /* слишком крутой подъём (> ~50°) не пройти, как скалу в Rust; в прыжке — не мешает */
  const steep = (x1,z1)=>{ if(!player.onGround) return false; const d=Math.hypot(x1-player.pos.x,z1-player.pos.z); return d>1e-6 && (heightAt(x1,z1)-heightAt(player.pos.x,player.pos.z))/d > 1.2; };
  if(!collidesAt(nx, player.pos.z) && !tooDeep(nx, player.pos.z) && !steep(nx, player.pos.z)) player.pos.x = nx;
  if(!collidesAt(player.pos.x, nz) && !tooDeep(player.pos.x, nz) && !steep(player.pos.x, nz)) player.pos.z = nz;

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
function spawnDebris(pos, type, count, power){
  if(!CFG.particles) return;
  const cols = DEBRIS_COLORS[type] || DEBRIS_COLORS.stone;
  const isWood = (type==='wood'||type==='cloth');
  for(let i=0;i<count;i++){
    const m = debrisPool[debrisIdx++ % DEBRIS_MAX], u = m.userData;
    m.material.color.setHex(cols[(Math.random()*cols.length)|0]);
    const sz = 0.018+Math.random()*0.032;
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
  const n = big ? 12 : 9;
  for(let i=0;i<n;i++){
    const m = impPool[impIdx++ % IMP_MAX], u = m.userData, dust = i < 3;
    m.material.color.setHex(dust ? 0xbdb59a : cols[(Math.random()*cols.length)|0]);
    m.material.opacity = dust ? 0.55 : 1;
    u.dust = dust; u.s = (dust ? 0.16 : 0.03+Math.random()*0.03) * k;
    m.scale.setScalar(u.s);
    m.position.copy(pos).add(_ip.set((Math.random()-.5)*0.1, 0.03, (Math.random()-.5)*0.1));
    const sp = (dust ? 0.5 : 1.2+Math.random()*1.6);
    u.v.set((Math.random()-.5)*sp, dust ? 0.5+Math.random()*0.5 : 1.4+Math.random()*2.2, (Math.random()-.5)*sp);
    u.rot.set(Math.random()*10,Math.random()*10,Math.random()*10);
    u.g = dust ? 0.6 : 9;
    u.max = u.life = dust ? 0.9 : 0.6+Math.random()*0.5;
    m.visible = true;
  }
}
function shotImpact(){
  if(!CFG.particles) return;
  if(CFG.camMode|0){
    const cp = Math.cos(player.pitch);
    _io.set(player.pos.x, player.pos.y+player.height, player.pos.z); _id.set(-Math.sin(player.yaw)*cp, Math.sin(player.pitch), -Math.cos(player.yaw)*cp);
  } else { camera.getWorldPosition(_io); camera.getWorldDirection(_id); }
  let best = 400, cols = IMP_GROUND, hitPt = null;
  impRay.set(_io, _id); impRay.far = 400;
  const hits = impRay.intersectObjects(Array.from(harvestHitMap.keys()), false);
  if(hits.length){ best = hits[0].distance; hitPt = hits[0].point.clone(); const h = harvestHitMap.get(hits[0].object); cols = (h && DEBRIS_COLORS[h.type]) || DEBRIS_COLORS.stone; }
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
  if(!hitPt) return;
  lastHitPoint.copy(hitPt);
  impactBurst(hitPt, best, cols, cols !== IMP_GROUND);
}
function updateImpacts(dt){
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
function harvestOnce(target){
  if(target.type==='scrap'){ triggerSwing(); hitBarrel(target); return; }
  triggerSwing();
  window.OSIL_AUDIO&&OSIL_AUDIO.play(target.type==='wood'?'chop':(target.type==='cloth'?'hit_tree':'hit_stone'));
  if(window.OSIL_NET && OSIL_NET.on && target.nid!=null){ spawnDebris(lastHitPoint, target.type, 4, 0.8); OSIL_NET.harvest(target, toolKind, false); return; }
  const mult = toolMultiplier(target);
  const amount = Math.max(1, Math.floor((target.giveMin + Math.random()*(target.giveMax-target.giveMin))*mult));
  const isCrit = Math.random() < 0.2;
  const finalAmount = isCrit ? amount*2 : amount;
  giveItem(target.type, finalAmount);
  target.health -= (isCrit ? 45 : 30) * Math.max(0.6, mult);
  if(isCrit) flashCrit();
  if(window.OSIL_NET) OSIL_NET.onHit(target);
  spawnDebris(lastHitPoint, target.type, isCrit?7:4, 0.8);
  showToast((isCrit?'КРИТ! ':'')+'+'+finalAmount+' '+RES_NAMES[target.type]);
  updateResourceUI();
  if(target.health <= 0){
    debrisAtTarget(target);
    destroyHarvestable(target);
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
  for(let i=0;i<120;i++){
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
  return document.getElementById('inv-panel').classList.contains('show') ||
         document.getElementById('craft-panel').classList.contains('show') ||
         document.getElementById('map-panel').classList.contains('show') ||
         pauseOpen();
}
function pauseOpen(){ return !document.getElementById('pause-menu').classList.contains('hidden'); }
/* Запуск удара. Работает только при кулдауне = 0 и после завершённого доставания.
   Урон/ресурсы применяются НЕ сразу, а в момент попадания внутри анимации (HIT_AT). */
function doHit(fromHold){
  if(panelsOpen()) return;
  if(!fromHold && useConsumable()) return;
  if(buildMode){                                   // план в руке: «Удар» = поставить деталь
    if(!fromHold && hitCooldown<=0){ hitCooldown = 0.35; confirmBuild(); }
    return;
  }
  if(isGun(toolKind)){ if(hitCooldown>0 || equipT<1) return; if(fromHold && GUNS[toolKind].semi) return; fireGun(); return; }
  if(!hasToolInHand()) return;
  if(hitCooldown>0 || swinging || equipT<1) return;
  if(window.OSIL_NET) OSIL_NET.melee();
  hitCooldown = SWING_DUR;
  swingHitFn = applyToolHit;
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
  const target = findTargetInReach();
  if(!target){ OSIL_AUDIO.play('empty',{vol:0.35}); return; }   // промах — прочность не тратится
  if(target.type==='scrap'){ hitBarrel(target); wearTool(kind,1); return; }
  if(window.OSIL_NET && OSIL_NET.on && target.nid!=null){        // онлайн: количество, урон узлу и лут считает сервер
    const mult = toolMultiplier(target);
    OSIL_AUDIO.play(target.type==='wood' ? 'chop' : (target.type==='cloth' ? 'hit_tree' : 'hit_stone'));
    camKick = 0.035; spawnDebris(lastHitPoint, target.type, 4, 0.8);
    OSIL_NET.harvest(target, kind, false);
    wearTool(kind, mult>=1 ? 1 : 2); return;
  }
  const mult = toolMultiplier(target);
  const isCrit = Math.random() < 0.2;
  const base = target.giveMin + Math.random()*(target.giveMax-target.giveMin);
  const amount = Math.max(1, Math.floor(base*mult)) * (isCrit?2:1);
  giveItem(target.type, amount);
  target.health -= (isCrit?30:20) * Math.max(0.6, mult);
  OSIL_AUDIO.play(target.type==='wood' ? 'chop' : (target.type==='cloth' ? 'hit_tree' : 'hit_stone'), target.type==='scrap'?{rate:1.4}:undefined);
  camKick = 0.035;
  spawnDebris(lastHitPoint, target.type, isCrit?7:4, 0.8);
  if(isCrit) flashCrit();
  showToast((isCrit?'КРИТ! ':'')+'+'+amount+' '+RES_NAMES[target.type]);
  if(target.health <= 0){ debrisAtTarget(target); destroyHarvestable(target); }
  wearTool(kind, mult>=1 ? 1 : 2);      // неподходящим инструментом изнашивается вдвое быстрее
}

/* ---------------- UI wiring ---------------- */
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(()=>t.classList.remove('show'), 1200);
}

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
  if(k==='axe' || k==='pickaxe' || k==='rifle' || k==='pistol' || k==='berdanka' || k==='spear') return k;
  return 'none';
}
function hasToolInHand(){ return toolKind==='axe' || toolKind==='pickaxe' || toolKind==='spear'; }
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
  d.innerHTML =
    '<div class="idt-head">'+def.name+'</div>'+
    '<div class="idt-body">'+(icon?'<img src="'+icon+'" alt="">':'')+'<div class="idt-cnt">'+info+'</div></div>'+extra+
    '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'+
      '<button style="flex:1;padding:7px 8px;border-radius:7px;border:1px solid #9db07a;background:rgba(88,86,78,.95);color:#fff;font-size:13px" onclick="window.OSIL_NET&&OSIL_NET.drop(0)">'+((def.stack>1 && sl.n>1)?'Выбросить 1':'Выбросить')+'</button>'+
      ((def.stack>1 && sl.n>1)?'<button style="flex:1;padding:7px 8px;border-radius:7px;border:1px solid #9db07a;background:rgba(88,86,78,.95);color:#fff;font-size:13px" onclick="window.OSIL_NET&&OSIL_NET.drop(1)">Выбросить всё</button>':'')+
    '</div>';
}
function renderQuickCraft(){
  const box = document.getElementById('quick-craft');
  if(!box) return;
  box.innerHTML='';
  CRAFT_RECIPES.filter(r=>r.quick!==false).forEach(r=>{
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
  if(mapOpen) toggleMap(false);
  document.getElementById('craft-panel').classList.remove('show');
  document.getElementById('inv-panel').classList.toggle('show');
  window.OSIL_AUDIO&&OSIL_AUDIO.play(document.getElementById('inv-panel').classList.contains('show')?'inventory_open':'close');
  if(document.getElementById('inv-panel').classList.contains('show')){ markOpened(); updateResourceUI(); }
  updateFpsVisibility();
  syncPointerLock();
}
function toggleCraft(){
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
  if(on === gamePaused) return;
  gamePaused = on;
  document.getElementById('pause-menu').classList.toggle('hidden', !on);
  if(on){
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
const LAYOUT_IDS = ['btn-hit','btn-aim','btn-reload','btn-jump','btn-crouch','btn-inv','btn-craft','btn-map','btn-pause','ammo-hud','hotbar','hud-bars','minimap','fps-counter'];
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
loBar.innerHTML = '<div class="lo-t">Перетащите кнопки и панели на нужные места</div><div class="lo-b"><button id="lo-reset">СБРОСИТЬ</button><button id="lo-done">ГОТОВО</button></div>';
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
function resetLayout(){ layoutData = {}; saveLayout(); applyLayout(); }
document.getElementById('lo-done').addEventListener('click', endLayout);
document.getElementById('lo-reset').addEventListener('click', resetLayout);
window.OSIL_LAYOUT = { start:startLayout, reset:resetLayout };

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
function toggleCrouch(){ setCrouch(!isCrouching); }
document.getElementById('btn-crouch').addEventListener('click', toggleCrouch);
document.getElementById('btn-crouch').addEventListener('touchstart', e=>{ e.preventDefault(); toggleCrouch(); });

selectSlot(0);

/* =========================================================================
   КАРТА (как в Rust): кнопка в HUD открывает большую карту с биомами, озёрами и морем.
   Базовая картинка рисуется ОДИН раз из данных генератора (с затенением по рельефу),
   поверх каждый кадр — сетка, метки, игрок и направление взгляда.
   ========================================================================= */
const MAP_COLORS = {
  [B.DEEP]:[26,52,84], [B.SEA]:[40,92,128], [B.BEACH]:[232,214,160], [B.DESERT]:[242,206,124],
  [B.PLAIN]:[112,148,68], [B.FOREST]:[92,128,58], [B.SNOW]:[250,252,255], [B.LAKE]:[58,118,150], [B.ROCK]:[128,124,116]
};
const BIOME_LABEL = {
  [B.DEEP]:'Глубокое море', [B.SEA]:'Море', [B.BEACH]:'Пляж', [B.DESERT]:'Пустыня',
  [B.PLAIN]:'Равнина', [B.FOREST]:'Лес', [B.SNOW]:'Снежный биом', [B.LAKE]:'Озеро', [B.ROCK]:'Скалы'
};
let mapBase = null;   // offscreen canvas MB×MB: рельеф с затенением, береговая линия чёткая на любом зуме
function buildMapBase(){
  const MB = 768, c = document.createElement('canvas'); c.width = c.height = MB;
  const g = c.getContext('2d'), img = g.createImageData(MB,MB), d = img.data;
  const CR = new Float32Array(WN*WN), CG = new Float32Array(WN*WN), CB = new Float32Array(WN*WN);
  for(let k=0;k<WN*WN;k++){                       // цвет клетки; вода/пляж → цвет пляжа, чтобы у берега не мешалась вода
    const bi = WG.biome[k], col = MAP_COLORS[(bi===B.SEA||bi===B.DEEP||bi===B.LAKE) ? B.BEACH : bi];
    CR[k]=col[0]; CG[k]=col[1]; CB[k]=col[2];
  }
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
      const dx = wgSample(WG.h,x+2.5,z)-wgSample(WG.h,x-2.5,z), dz = wgSample(WG.h,x,z+2.5)-wgSample(WG.h,x,z-2.5);
      const sh = Math.max(0.74, Math.min(1.26, 1 - (dx+dz)*0.09));   // свет с северо-запада
      r=(lr*sh)*land+sr*(1-land); gg=(lg*sh)*land+sg*(1-land); bb=(lb*sh)*land+sb*(1-land);
    } else { r=sr; gg=sg; bb=sb; }
    const o=(j*MB+i)*4; d[o]=r; d[o+1]=gg; d[o+2]=bb; d[o+3]=255;
  }
  g.putImageData(img,0,0);
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

const MAP_SEA_BG = '#1a3a5c';
let mapView = {z:1, x:0, y:0}, mapW = 0, mapH = 0, mapDpr = 1;
const mapSide = ()=> Math.min(mapW, mapH);
function clampMapView(){
  const s = mapSide()*mapView.z;
  mapView.x = s<=mapW ? Math.max(0,Math.min(mapW-s,mapView.x)) : Math.max(mapW-s,Math.min(0,mapView.x));
  mapView.y = s<=mapH ? Math.max(0,Math.min(mapH-s,mapView.y)) : Math.max(mapH-s,Math.min(0,mapView.y));
}
function sizeMapCanvas(){
  mapDpr = Math.min(window.devicePixelRatio||1, 2);
  mapW = window.innerWidth; mapH = window.innerHeight;
  mapCanvas.style.width = mapW+'px'; mapCanvas.style.height = mapH+'px';
  mapCanvas.width = Math.floor(mapW*mapDpr); mapCanvas.height = Math.floor(mapH*mapDpr);
  const s = mapSide()*mapView.z; mapView.x = (mapW-s)/2; mapView.y = (mapH-s)/2; clampMapView();
}
function drawGridAndLabels(g, ox, oy, s){
  // сетка 10×10: буквы A–J по X, цифры 1–10 по Z; подпись (A1, B1…) в каждой клетке
  const n = 10, cell = s/n;
  g.save(); g.strokeStyle='rgba(255,255,255,.14)'; g.lineWidth=1; g.beginPath();
  for(let i=0;i<=n;i++){ const p=Math.round(i*cell)+0.5; g.moveTo(ox+p,oy); g.lineTo(ox+p,oy+s); g.moveTo(ox,oy+p); g.lineTo(ox+s,oy+p); }
  g.stroke();
  g.fillStyle='rgba(255,255,255,.55)'; g.font=Math.max(8,Math.min(13,cell*0.25))+'px Segoe UI,Arial,sans-serif'; g.textBaseline='top';
  for(let j=0;j<n;j++) for(let i=0;i<n;i++) g.fillText(String.fromCharCode(65+i)+(j+1), ox+i*cell+3, oy+j*cell+2);
  g.restore();
}
function gridCellName(x,z){
  const u=Math.max(0,Math.min(0.999,worldToMapU(x))), v=Math.max(0,Math.min(0.999,worldToMapV(z)));
  return String.fromCharCode(65+Math.floor(u*10))+(Math.floor(v*10)+1);
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
  mapMarks.forEach(m=>{
    g.fillStyle='#e0432b'; g.beginPath(); g.arc(ox+worldToMapU(m.x)*s, oy+worldToMapV(m.z)*s, 5, 0, 6.283); g.fill();
    g.strokeStyle='#fff'; g.lineWidth=1.5; g.stroke();
  });
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

/* ---------------- Main loop ---------------- */
let lastTime = performance.now();
let _loopPending = false;
const _mc = new MessageChannel();
_mc.port1.onmessage = ()=>{ _loopPending=false; animate(); };
function scheduleNext(){
  if(FPS_UNLIMITED && !document.hidden){ if(!_loopPending){ _loopPending=true; _mc.port2.postMessage(0); } }   // без привязки к vsync
  else requestAnimationFrame(animate);
}
function animate(){
  scheduleNext();
  const now = performance.now();
  if(FPS_CAP_MS && now-lastTime < FPS_CAP_MS) return;      // свой лимит (30/60/90); «Без лимита» = частота экрана
  const dt = Math.min(0.05, (now-lastTime)/1000);
  lastTime = now;
  updateFPS(now);

  if(!document.getElementById('start-screen').classList.contains('hidden')) {
    renderer.render(scene, camera);
    return;
  }

  if(gamePaused){ renderer.render(scene, camera); return; }

  updateMovement(dt);
  updateHarvest(dt);
  updatePlayerModel(dt);
  updateDebris(dt);
  updateViewmodel(dt);
  if(attackHeld) doHit(true);
  tickSurvival(dt);
  updateWorldPickups(dt);
  updateGhost();
  updateStatsUI();
  updateMinimap(dt);
  if(CFG.water) seaAnim();
  updateCulling(dt);
  followSun(player.pos.x, player.pos.y, player.pos.z);
  // Карта теней (самая дорогая часть кадра) обновляется, только когда сдвинулось солнце-окно,
  // сменился набор объектов или раз в 0.3 с (динамические объекты) — а не каждый кадр.
  shadowTimer += dt;
  if(shadowDirty || shadowTimer > 0.3){ renderer.shadowMap.needsUpdate = true; shadowDirty = false; shadowTimer = 0; }

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
  ['pointerup','touchend','click','keydown'].forEach(e=>document.addEventListener(e,again,true));
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
let mServers = [
  { name:'Одиночная игра', sub:'Survival Island', cur:0, max:1, ping:0, solo:true },
];
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
let mUsedPromos = [];
let mCoins = 0;
document.getElementById('m-promoBtn').addEventListener('click', ()=>{
  const code = document.getElementById('m-promoIn').value.trim().toUpperCase();
  const msg = document.getElementById('m-promoMsg');
  if(!code) return;
  if(code==='ADMIN6737'){
    ADMIN_FREE = true; try{ localStorage.setItem('osil_admin','1'); }catch(e){}
    msg.textContent = 'Админ-режим: крафт бесплатный и бесконечный'; msg.style.color = '#bcd096';
    if(typeof renderCraftUI==='function'){ renderCraftUI(); renderQuickCraft(); }
    return;
  }
  if(mUsedPromos.includes(code)){ msg.textContent='Код уже использован'; msg.style.color='#d08080'; return; }
  if(MENU_PROMOS[code]){
    mCoins += MENU_PROMOS[code];
    mUsedPromos.push(code);
    document.getElementById('m-pCoins').textContent = mCoins;
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
function applySetting(k){
  const all = (k===null||k===undefined), on = n => all || k===n;
  if(on('res')){
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 3) * CFG.res/100);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  if(on('shadows')){
    const lv = CFG.shadows, sz = [1024,1024,2048,4096][lv] || 2048;
    sun.castShadow = lv>0;
    shadowDirty = true;
    if(sun.shadow.mapSize.x !== sz){ sun.shadow.mapSize.set(sz,sz); if(sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; } }
  }
  if(on('shadowDist')){
    const sd = CFG.shadowDist, half = sd*1.25 + 4, cam = sun.shadow.camera;
    cam.left=-half; cam.right=half; cam.top=half; cam.bottom=-half; cam.far = 200 + sd; cam.updateProjectionMatrix();
    SHADOW_R2 = sd*sd; shadowDirty = true; updateCulling(0,true);
  }
  if(on('shadows') || on('shadowDist')){ SHADOW_TEXEL = (sun.shadow.camera.right*2)/sun.shadow.mapSize.x; }
  if(on('fpsCap')){ const v=[30,60,90,0][CFG.fpsCap]; FPS_CAP_MS = v ? 1000/v - 2 : 0; const u=(v===0||v===90); if(u && !FPS_UNLIMITED){ FPS_UNLIMITED=true; } else if(!u){ FPS_UNLIMITED=false; } }
  if(on('dist')){
    const far = CFG.dist;
    scene.fog.near = far*0.23; scene.fog.far = far; camera.far = far+45; camera.updateProjectionMatrix();
    CULL_K = (far/150)*(far/150);
    cullables.forEach(c=>{ c.r2 = c.r2b*CULL_K; });
    updateCulling(0,true);
  }
  if(on('fov')){ camera.fov = CFG.fov; camera.updateProjectionMatrix(); }
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
  const TOOLS = {none:0, axe:1, pickaxe:2, rifle:3, spear:4, pistol:5, berdanka:6}, TOOLN = ['none','axe','pickaxe','rifle','spear','pistol','berdanka'];

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
  const byNid = n => harvestables.find(h => h.nid === n);
  function applyBuild(b){ try{ applying = true; spawnBuilt(b.k, b.x,b.y,b.z,b.r,b.l,b.b); }catch(e){ console.warn('build',e); } finally{ applying = false; } }
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
    const body = new THREE.Mesh(bagGeo, bagMat); body.scale.set(1,0.85,1); body.position.y = 0.2; body.castShadow = true;
    const neck = new THREE.Mesh(neckGeo, knotMat); neck.position.y = 0.44; const top = new THREE.Mesh(topGeo, knotMat); top.position.y = 0.55;
    const lbl = bagLabel((RES_NAMES[b.k] || b.k) + (b.n > 1 ? ' ×' + b.n : '')); lbl.position.y = 0.95;
    g.add(body, neck, top, lbl); g.position.set(b.x, b.y, b.z); scene.add(g);
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
    bags.forEach(o => { o.t += dt; o.g.rotation.y += dt*0.6; o.body.position.y = 0.2 + Math.sin(o.t*2)*0.02;
      const d = Math.hypot(o.x - player.pos.x, o.z - player.pos.z); if(d < bd && Math.abs(o.y - player.pos.y) < 3){ bd = d; best = o; } });
    const playing = document.getElementById('start-screen').classList.contains('hidden');
    nearBag = playing ? best : null;
    if(!pickEl){
      pickEl = document.createElement('div');
      pickEl.style.cssText = 'position:fixed;left:50%;bottom:calc(150px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:16;padding:12px 20px;border-radius:12px;border:1px solid #d9a441;background:rgba(30,28,22,.92);color:#ffe9a8;font:bold 16px sans-serif;display:none;user-select:none;-webkit-user-select:none';
      pickEl.addEventListener('touchstart', e => { e.preventDefault(); pickup(); }, {passive:false}); pickEl.addEventListener('click', pickup);
      document.body.appendChild(pickEl);
      window.addEventListener('keydown', e => { if(e.code === 'KeyE' && nearBag && !/INPUT|TEXTAREA/.test((document.activeElement||{}).tagName || '')) pickup(); });
    }
    if(nearBag){ pickEl.style.display = 'block'; pickEl.textContent = '🎒 Подобрать: ' + (RES_NAMES[nearBag.k] || nearBag.k) + (nearBag.n > 1 ? ' ×' + nearBag.n : '') + '  [E]'; }
    else pickEl.style.display = 'none';
  }
  function profile(){ return {t:'pf', hp:r2(player.hp), hu:r2(player.hunger), th:r2(player.thirst), st:r2(player.stamina), g:gridSlots, h:hotbarSlots, e:equip}; }
  function applyProfile(p){
    try{
      if(Array.isArray(p.g)) for(let i=0;i<gridSlots.length;i++) gridSlots[i] = p.g[i] || null;
      if(Array.isArray(p.h)) for(let i=0;i<hotbarSlots.length;i++) hotbarSlots[i] = p.h[i] || null;
      if(p.e) Object.keys(equip).forEach(k => { equip[k] = p.e[k] || null; });
      if(p.hp > 0) player.hp = p.hp; if(p.hu != null) player.hunger = p.hu; if(p.th != null) player.thirst = p.th; if(p.st != null) player.stamina = p.st;
      if(isFinite(p.x) && isFinite(p.z)){ player.pos.set(p.x, Math.max(p.y || 0, heightAt(p.x, p.z)) + 0.5, p.z); player.velY = 0; }
      renderHotbar(); renderInvGrid();
      toast('Прогресс загружен с сервера');
    }catch(e){ console.warn('profile', e); }
  }
  function onMsg(m){
    switch(m.t){
      case 'w':
        myId = m.id; on = true; try{ const c=new THREE.Color(COLS[myId % COLS.length]); playerModel.jacketM.color.copy(c); playerModel.jacketDM.color.copy(c).multiplyScalar(0.78); }catch(e){} srvName = m.name; if(m.you) setPName(m.you); if(m.me) applyProfile(m.me);
        if(m.ver !== 40) toast('Версия сервера отличается от клиента');
        (m.players||[]).forEach(p=>{ if(!remotes.has(p.id)) remotes.set(p.id, makeAvatar(p.id,p.n)); });
        applying = true;
        try{
          (m.dead||[]).forEach(n=>{ const t = byNid(n); if(t) destroyHarvestable(t); });
          Object.keys(m.hp||{}).forEach(n=>{ const t = byNid(+n); if(t) t.health = Math.min(t.health, m.hp[n]); });
        } finally{ applying = false; }
        (m.builds||[]).forEach(applyBuild); clearBags(true); (m.bags||[]).forEach(addBag);
        toast('Подключено: '+srvName); hud(); chat('', 'Вы на сервере «'+srvName+'». Enter — чат.'); break;
      case 'full': toast('Сервер заполнен'); disconnect(); break;
      case 'auth': { const s = curSrv; if(s) authSet(s, null); disconnect(); if(s) showAuth(s, 'Сессия истекла — войдите заново', () => connect(s)); break; }
      case 'kick': toast(m.m || 'Вы отключены'); disconnect(); break;
      case 'pj': if(!remotes.has(m.id)) remotes.set(m.id, makeAvatar(m.id,m.n)); hud(); break;
      case 'pl': removeRemote(m.id); hud(); break;
      case 'ps': m.p.forEach(a=>{
          if(a[0] === myId) return;
          const r = remotes.get(a[0]); if(!r) return;
          r.tp.set(a[1],a[2],a[3]); r.tyaw = a[4]; r.pitch = a[5]; setHeld(r, TOOLN[a[6]] || 'none');
          r.crouch = (a[7] & 1) ? 1 : 0; r.aim = (a[7] & 2) ? 1 : 0;
        }); break;
      case 'hv': { const t = byNid(m.i); if(t){ applying = true; try{ if(typeof harvestTarget!=='undefined' && harvestTarget===t) stopHarvest();
            spawnDebris(t.mesh.position.clone().setY(t.mesh.position.y+1), t.type, 6, 0.8); destroyHarvestable(t); } finally{ applying = false; } } break; }
      case 'hh': { const t = byNid(m.i); if(t) t.health = m.h; break; }
      case 'bd': applyBuild(m); break;
      case 'bg': addBag(m); break;
      case 'bgx': removeBag(m.id); break;
      case 'got': giveItem(m.k, m.n, m.d); refreshInvUI(); try{ updateResourceUI(); }catch(e){} if(m.srv){ if(m.c) try{ flashCrit(); }catch(e){} toast((m.c ? 'КРИТ! ' : '') + '+' + m.n + ' ' + (RES_NAMES[m.k] || (ITEM_DEFS[m.k] && ITEM_DEFS[m.k].name) || m.k)); } else toast((m.back ? 'Вернулось: ' : 'Получено: ') + (RES_NAMES[m.k] || m.k) + (m.n > 1 ? ' ' + m.n : '')); break;
      case 'sw': { const r = remotes.get(m.id); if(r) r.swing = 1; break; }
      case 'sh': { const r = remotes.get(m.id); if(r){ r.flash = 0.05;
          const d = Math.hypot(r.p.x-player.pos.x, r.p.z-player.pos.z); OSIL_AUDIO.play('ak',{vol:Math.max(0.05, 0.8 - d/90)}); } break; }
      case 'dmg': hurt(m.d, m.from); break;
      case 'c': chat(m.n, m.m); break;
    }
  }

  /* ---------------- бой ---------------- */
  function hurt(d, from){
    player.hp = Math.max(0, player.hp - d); camKick = 0.05;
    try{ OSIL_AUDIO.play('player_scream',{vol:0.5}); }catch(e){}
    if(player.hp <= 0 && !dieSent){
      dieSent = true; send({t:'die', by:from}); toast('Вы погибли');
      setTimeout(()=>{ player.pos.set(SPAWN.x, heightAt(SPAWN.x,SPAWN.z)+2, SPAWN.z); player.velY = 0;
        player.hp = 100; player.hunger = 100; player.thirst = 100; player.stamina = 100; dieSent = false; }, 600);
    }
  }
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function raySphere(o, d, c, r){ const ox = o.x-c.x, oy = o.y-c.y, oz = o.z-c.z, b = ox*d.x+oy*d.y+oz*d.z, cc = ox*ox+oy*oy+oz*oz-r*r, disc = b*b-cc;
    if(disc < 0) return -1; const t = -b - Math.sqrt(disc); return t > 0 ? t : -1; }
  function onShoot(){
    if(!on) return; send({t:'sh'});
    camera.getWorldPosition(_o); camera.getWorldDirection(_d);
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
  let hudEl, chatLog, chatIn, chatBtn;
  function ui(){
    hudEl = document.createElement('div'); hudEl.id = 'net-hud'; hudEl.style.display = 'none'; document.body.appendChild(hudEl);
    chatLog = document.createElement('div'); chatLog.id = 'net-chat'; document.body.appendChild(chatLog);
    chatIn = document.createElement('input'); chatIn.id = 'net-chat-in'; chatIn.maxLength = 120; chatIn.placeholder = 'Сообщение…'; chatIn.style.display = 'none'; document.body.appendChild(chatIn);
    chatBtn = document.createElement('button'); chatBtn.id = 'net-chat-btn'; chatBtn.textContent = '💬'; chatBtn.style.display = 'none'; document.body.appendChild(chatBtn);
    chatIn.addEventListener('keydown', e=>{ e.stopPropagation();
      if(e.key === 'Enter'){ const v = chatIn.value.trim(); if(v) send({t:'c', m:v}); closeChat(); }
      else if(e.key === 'Escape') closeChat(); });
    chatIn.addEventListener('keyup', e=>e.stopPropagation());
    chatBtn.addEventListener('click', openChat);
    window.addEventListener('keydown', e=>{ if(e.key==='Enter' && on && document.activeElement !== chatIn && $('start-screen').style.display==='none'){ e.preventDefault(); openChat(); } });
  }
  function openChat(){ if(!on) return; if(document.exitPointerLock) document.exitPointerLock(); chatIn.style.display = 'block'; chatIn.value = ''; chatIn.focus(); }
  function closeChat(){ chatIn.style.display = 'none'; chatIn.blur();
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
  const authSet = (s, v) => { if(v){ SESS[authKey(s)] = v; try{ localStorage.setItem('anode_lastuser', v.u); }catch(e){} } else delete SESS[authKey(s)]; };
  const lastUser = () => { try{ return localStorage.getItem('anode_lastuser') || ''; }catch(e){ return ''; } };
  const hostPort = s => (s.port==443||s.port==80||!s.port) ? s.host : s.host + ':' + s.port;
  const baseUrl = s => (location.protocol === 'https:' ? 'https://' : 'http://') + hostPort(s);
  function setPName(n){ const e = document.getElementById('m-pName'); if(e && n) e.textContent = n; }
  let curSrv = null;
  function showAuth(s, note, onOk){
    const old = document.getElementById('auth-ov'); if(old) old.remove();
    const ov = document.createElement('div'); ov.id = 'auth-ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;overflow:auto';
    const I = 'width:100%;box-sizing:border-box;padding:12px;margin:6px 0;border-radius:8px;border:1px solid #6b6a5f;background:#1c1b18;color:#fff;font-size:16px;outline:none';
    const B = 'flex:1;padding:12px 6px;border-radius:8px;border:1px solid #9db07a;background:rgba(88,86,78,.95);color:#fff;font-size:15px;font-weight:bold';
    ov.innerHTML = '<div style="width:min(88vw,340px);background:#26251f;border:1px solid #6b6a5f;border-radius:14px;padding:18px;color:#eee;font-family:inherit">' +
      '<div id="au-t" style="font-size:18px;font-weight:bold;margin-bottom:2px"></div><div style="font-size:12px;opacity:.65;margin-bottom:8px">Аккаунт хранится на этом сервере</div>' +
      '<input id="au-u" style="'+I+'" placeholder="Ник (3–16 символов)" maxlength="16" autocapitalize="off" autocomplete="username">' +
      '<input id="au-p" type="password" style="'+I+'" placeholder="Пароль (от 6 символов)" maxlength="64" autocomplete="current-password">' +
      '<div id="au-e" style="color:#ff8a80;font-size:13px;min-height:18px;margin:2px 0 8px"></div>' +
      '<div style="display:flex;gap:8px"><button id="au-l" style="'+B+'">Войти</button><button id="au-r" style="'+B+'">Регистрация</button></div>' +
      '<button id="au-c" style="width:100%;margin-top:8px;padding:10px;background:none;border:none;color:#aaa;font-size:14px">Отмена</button></div>';
    document.body.appendChild(ov);
    const $$ = id => ov.querySelector('#' + id), err = $$('au-e');
    $$('au-t').textContent = 'Сервер «' + (s.name || s.host) + '»'; if(note) err.textContent = note;
    let busy = false;
    const go = async kind => {
      if(busy) return; const u = $$('au-u').value.trim(), p = $$('au-p').value;
      if(!u || !p){ err.textContent = 'Введите ник и пароль'; return; }
      busy = true; err.style.color = '#ccc'; err.textContent = 'Подождите…';
      try{
        const r = await fetch(baseUrl(s) + '/api/' + kind, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({u, p})});
        const d = await r.json();
        if(!r.ok || !d.token){ err.style.color = '#ff8a80'; err.textContent = d.error || 'Ошибка'; busy = false; return; }
        authSet(s, {u:d.u, t:d.token}); ov.remove(); setPName(d.u); (onOk || (() => connect(s)))();
      }catch(e){ err.style.color = '#ff8a80'; err.textContent = 'Сервер недоступен'; busy = false; }
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
  function connect(s){
    disconnect(); if(!s || s.solo) return;
    const au = authAll()[authKey(s)]; if(!au){ showAuth(s); return; } curSrv = s;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + hostPort(s) + '/ws';
    let w; try{ w = new WebSocket(url); }catch(e){ toast('Неверный адрес сервера'); return; }
    ws = w;
    const to = setTimeout(()=>{ if(ws === w && !on){ toast('Сервер не отвечает — одиночная игра'); disconnect(); } }, 6000);
    w.onopen = () => send({t:'join', k:au.t});
    w.onmessage = e => { try{ onMsg(JSON.parse(e.data)); }catch(err){ console.warn(err); } };
    w.onerror = () => { if(ws === w && !on){ toast('Не удалось подключиться — одиночная игра'); } };
    w.onclose = () => { clearTimeout(to); if(ws === w){ if(on) toast('Соединение потеряно'); ws = null; cleanup(); } };
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
    try{ const r = await fetch('http://' + c.host + ':' + c.port + '/api/info', {signal:ac.signal, cache:'no-store'}); const d = await r.json();
      return Object.assign({}, c, {ips:d.ips || [], name:d.name, cur:d.cur, max:d.max, ping:Math.max(1, Math.round(performance.now()-t0)), ok:true}); }
    catch(e){ return Object.assign({}, c, {ok:false}); } finally{ clearTimeout(tm); }
  }
  let refreshing = false;
  async function refresh(){
    if(refreshing) return; refreshing = true;
    const cand = new Map(), add = (host, port, src, name) => { const k = norm(host) + ':' + port; if(!cand.has(k)) cand.set(k, {host, port:+port, src, name}); };
    if(/^https?:$/.test(location.protocol) && location.hostname) add(location.hostname, location.port || (location.protocol === 'https:' ? 443 : 80), 'этот сервер');
    const res = await Promise.all([...cand.values()].map(probe));
    const seen = new Set(), rows = [];
    res.forEach(c => { const key = c.ok ? c.name + '|' + c.port : c.host + ':' + c.port; if(seen.has(key)) return; seen.add(key); rows.push(c); });
    mServers.length = 0;
    mServers.push({name:'Локальная игра', sub:'Одиночная · без сети', cur:0, max:1, ping:0, solo:true});
    rows.forEach(c => mServers.push({name: c.ok ? c.name : (c.name || c.host + ':' + c.port), sub: c.host + ':' + c.port + ' · ' + (c.ok ? c.src : 'нет ответа'),
      cur: c.ok ? c.cur : 0, max: c.ok ? c.max : 0, ping: c.ok ? c.ping : '—', host: c.host, port: c.port, off: !c.ok}));
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
    /* вход в аккаунт — ДО старта игры: перехватываем «ИГРАТЬ», пока не пройден вход */
    const sb = $('start-btn'); let passed = false;
    sb.addEventListener('click', e => {
      const s = mServers[mSelServer];
      if(!s || s.solo){ disconnect(); return; }
      if(passed){ passed = false; connect(s); return; }
      e.stopImmediatePropagation(); e.preventDefault();
      showAuth(s, '', () => { passed = true; sb.click(); });
    }, true);
    $('pm-exit').addEventListener('click', disconnect);
    harvestables.forEach((h,i) => { h.nid = i; });
    mServers.length = 0; mServers.push({name:'Локальная игра', sub:'Одиночная · без сети', cur:0, max:1, ping:0, solo:true}); mSelServer = 0; renderMenuServers();
    refresh(); setInterval(() => { const ss = $('start-screen'); if(ss && ss.style.display !== 'none' && !document.hidden) refresh(); }, 15000);
    setInterval(() => {                                       // отправка своего состояния 10 раз/с
      if(!on) return;
      send({t:'st', s:[r2(player.pos.x), r2(player.pos.y), r2(player.pos.z), r2(player.yaw), r2(player.pitch), TOOLS[toolKind] || 0,
        (isCrouching ? 1 : 0) | (aimK > 0.5 ? 2 : 0)].slice(0,7).concat([])});
    }, 100);
    const saveNow = () => { if(on){ try{ send(profile()); }catch(e){} } };
    setInterval(saveNow, 5000); document.addEventListener('visibilitychange', () => { if(document.hidden) saveNow(); }); window.addEventListener('pagehide', saveNow);
    let last = performance.now();
    (function loop(){ const n = performance.now(), dt = Math.min(0.1, (n-last)/1000); last = n; animRemotes(dt); animBags(dt); requestAnimationFrame(loop); })();
  }
  try{ init(); }catch(e){ alert('Ошибка net.js: ' + e.message); }
  return {harvest, drop: dropSel, connect, disconnect, refresh, onDestroy, onHit, onBuild, onShoot, onSwing, melee, get on(){ return on; }};
})();

})();
