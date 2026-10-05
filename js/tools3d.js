/* =====================================================================
   TOOLS3D v2 — процедурные PBR-модели кирки и рук от первого лица.
   Всё генерируется кодом (canvas → albedo / normal / roughness+metal),
   внешних файлов нет. Ось инструмента: +Y вдоль рукояти, 0 — торец.
   API (не изменился):
     OSIL_TOOLS.init(renderer) / makePickaxe() / addHands(g) / updateArms(mesh)
   Динамика хвата задаётся через mesh.userData:
     slide (0..1) — ведущая рука съезжает вниз при ударе
     squeeze (0..1) — сжатие хвата
     shoulderShift (Vector3) — смещение плеч (тело подаётся за ударом)
   ===================================================================== */
window.OSIL_TOOLS = (function(){
  const T = THREE, PI = Math.PI, deg = PI/180;
  function rng(seed){ let s = seed>>>0; return function(){ s = (s*1664525 + 1013904223)>>>0; return s/4294967296; }; }
  function cnv(w,h){ const c = document.createElement('canvas'); c.width=w; c.height=h; return c; }
  function mk(c, rx, ry){
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    if(rx) t.repeat.set(rx, ry||rx);
    t.anisotropy = 8;
    return t;
  }
  /* карта нормалей из яркости canvas (Sobel, с заворачиванием краёв) */
  function nrm(src, k, rx, ry){
    const w = src.width, h = src.height, d = src.getContext('2d').getImageData(0,0,w,h).data;
    const out = cnv(w,h), og = out.getContext('2d'), o = og.createImageData(w,h);
    const H = (x,y)=>{ const i = (((y+h)%h)*w + ((x+w)%w))*4; return (d[i]*0.3 + d[i+1]*0.59 + d[i+2]*0.11)/255; };
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      let nx = -(H(x+1,y)-H(x-1,y))*k, ny = (H(x,y+1)-H(x,y-1))*k, nz = 1;
      const l = Math.hypot(nx,ny,nz), i = (y*w+x)*4;
      o.data[i] = (nx/l*0.5+0.5)*255; o.data[i+1] = (ny/l*0.5+0.5)*255; o.data[i+2] = (nz/l*0.5+0.5)*255; o.data[i+3] = 255;
    }
    og.putImageData(o,0,0);
    return mk(out, rx, ry);
  }

  /* ---------------- Процедурные текстуры ---------------- */
  function woodCanvas(){
    const c = cnv(256,512), g = c.getContext('2d'), r = rng(11);
    const grd = g.createLinearGradient(0,0,256,0);
    grd.addColorStop(0,'#7a4e2a'); grd.addColorStop(0.5,'#93602f'); grd.addColorStop(1,'#77492a');
    g.fillStyle = grd; g.fillRect(0,0,256,512);
    for(let i=0;i<320;i++){
      const x0 = r()*256, w = 1.2 + r()*5.5, dark = r()<0.55;
      g.strokeStyle = dark ? 'rgba(52,28,12,'+(0.05+r()*0.16)+')' : 'rgba(190,140,86,'+(0.05+r()*0.12)+')';
      g.lineWidth = w; g.beginPath(); g.moveTo(x0,0);
      let x = x0;
      for(let y=0;y<=512;y+=32){ x += (r()-0.5)*3.2; g.lineTo(x,y); }
      g.stroke();
    }
    for(let k=0;k<5;k++){
      const kx = r()*256, ky = 60 + r()*400, kr = 5 + r()*7;
      const rg = g.createRadialGradient(kx,ky,1,kx,ky,kr*2.4);
      rg.addColorStop(0,'rgba(35,16,6,0.9)'); rg.addColorStop(0.45,'rgba(70,36,14,0.55)'); rg.addColorStop(1,'rgba(70,36,14,0)');
      g.fillStyle = rg; g.beginPath(); g.ellipse(kx,ky,kr*1.1,kr*2.6,0,0,7); g.fill();
    }
    for(let i=0;i<1400;i++){ g.fillStyle = 'rgba(0,0,0,'+r()*0.08+')'; g.fillRect(r()*256,r()*512,1,1+r()*4); }
    for(let i=0;i<26;i++){                         // глубокие царапины и вмятины от ударов
      const x = r()*256, y = r()*512, l = 8 + r()*40;
      g.strokeStyle = 'rgba(30,14,5,'+(0.25+r()*0.3)+')'; g.lineWidth = 0.8 + r()*1.2;
      g.beginPath(); g.moveTo(x,y); g.lineTo(x+(r()-0.5)*8,y+l); g.stroke();
    }
    return c;
  }
  function endGrainCanvas(){
    const c = cnv(128,128), g = c.getContext('2d');
    g.fillStyle = '#a4703c'; g.fillRect(0,0,128,128);
    for(let i=1;i<14;i++){
      g.strokeStyle = 'rgba(60,30,10,'+(0.25+(i%3)*0.12)+')'; g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(64+Math.sin(i)*1.6,64,i*4.4,i*4.2,0,0,7); g.stroke();
    }
    return c;
  }
  function ropeCanvas(){
    const c = cnv(128,128), g = c.getContext('2d'), r = rng(5);
    g.fillStyle = '#6e5230'; g.fillRect(0,0,128,128);
    for(let i=-8;i<24;i++){
      const x = i*8;
      g.strokeStyle = 'rgba(48,30,12,0.75)'; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(x,0); g.lineTo(x+64,128); g.stroke();
      g.strokeStyle = 'rgba(184,148,96,0.5)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x+3.5,0); g.lineTo(x+67.5,128); g.stroke();
    }
    for(let i=0;i<700;i++){ g.fillStyle = 'rgba('+(r()<0.5?'20,10,0':'230,200,140')+','+r()*0.18+')'; g.fillRect(r()*128,r()*128,1,1+r()*2); }
    return c;
  }
  /* металл: albedo + ORM (G = шероховатость, B = металличность) */
  function metalCanvases(){
    const c = cnv(512,512), g = c.getContext('2d'), o = cnv(512,512), og = o.getContext('2d'), r = rng(23);
    const grd = g.createLinearGradient(0,0,512,512);
    grd.addColorStop(0,'#4a4e55'); grd.addColorStop(0.5,'#5d626a'); grd.addColorStop(1,'#43474d');
    g.fillStyle = grd; g.fillRect(0,0,512,512);
    og.fillStyle = 'rgb(0,118,238)'; og.fillRect(0,0,512,512);
    for(let i=0;i<14000;i++){                                     // ковка, зерно
      const v = 55+r()*80|0, x = r()*512, y = r()*512, w = 1+r()*3;
      g.fillStyle = 'rgba('+v+','+v+','+(v+6)+','+(0.10+r()*0.24)+')'; g.fillRect(x,y,w,1);
      og.fillStyle = 'rgba(0,'+(80+r()*110|0)+',238,0.35)'; og.fillRect(x,y,w,1);
    }
    for(let i=0;i<40;i++){                                         // вмятины от ударов
      const x = r()*512, y = r()*512, rr = 6 + r()*18, dk = r()<0.6;
      const rg = g.createRadialGradient(x,y,0,x,y,rr);
      rg.addColorStop(0, dk?'rgba(15,16,20,0.5)':'rgba(170,175,185,0.35)'); rg.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(x-rr,y-rr,rr*2,rr*2);
    }
    for(let i=0;i<260;i++){                                        // царапины (блестящие — материал зачищен)
      const x = r()*512, y = r()*512, l = 14 + r()*120, a = (r()-0.5)*0.7, sh = r()<0.5;
      const x2 = x+Math.cos(a)*l, y2 = y+Math.sin(a)*l;
      g.strokeStyle = sh ? 'rgba(165,170,178,'+(0.10+r()*0.22)+')' : 'rgba(18,20,24,'+(0.10+r()*0.2)+')';
      g.lineWidth = 0.6 + r()*1.0; g.beginPath(); g.moveTo(x,y); g.lineTo(x2,y2); g.stroke();
      og.strokeStyle = sh ? 'rgba(0,55,238,0.7)' : 'rgba(0,190,238,0.5)';
      og.lineWidth = 0.8; og.beginPath(); og.moveTo(x,y); og.lineTo(x2,y2); og.stroke();
    }
    for(let i=0;i<26;i++){                                         // ржавчина: шершаво и не металл
      const x = r()*512, y = r()*512, rr = 10 + r()*44, a = 0.30+r()*0.32;
      const rg = g.createRadialGradient(x,y,1,x,y,rr);
      rg.addColorStop(0,'rgba(132,66,26,'+a+')'); rg.addColorStop(1,'rgba(132,66,26,0)');
      g.fillStyle = rg; g.fillRect(x-rr,y-rr,rr*2,rr*2);
      const rg2 = og.createRadialGradient(x,y,1,x,y,rr);
      rg2.addColorStop(0,'rgba(0,238,70,'+Math.min(1,a*2)+')'); rg2.addColorStop(1,'rgba(0,238,70,0)');
      og.fillStyle = rg2; og.fillRect(x-rr,y-rr,rr*2,rr*2);
    }
    for(let i=0;i<500;i++){ g.fillStyle = 'rgba(10,10,12,'+(0.2+r()*0.3)+')'; g.fillRect(r()*512,r()*512,1,1); }
    return {c:c, o:o};
  }
  function skinCanvas(){
    const c = cnv(256,256), g = c.getContext('2d'), r = rng(31);
    g.fillStyle = '#bf8a62'; g.fillRect(0,0,256,256);
    for(let i=0;i<40;i++){                                         // неравномерный тон: румянец / желтизна
      const x = r()*256, y = r()*256, rr = 20+r()*50, red = r()<0.5;
      const rg = g.createRadialGradient(x,y,1,x,y,rr);
      rg.addColorStop(0, red?'rgba(190,90,70,0.16)':'rgba(215,170,110,0.14)'); rg.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(x-rr,y-rr,rr*2,rr*2);
    }
    g.strokeStyle = 'rgba(80,90,130,0.06)'; g.lineWidth = 5;      // вены
    for(let i=0;i<5;i++){ g.beginPath(); let x = r()*256, y = 0; g.moveTo(x,y); for(let k=0;k<8;k++){ x += (r()-0.5)*26; y += 34; g.lineTo(x,y); } g.stroke(); }
    for(let i=0;i<3600;i++){ g.fillStyle = 'rgba(70,32,20,'+(0.08+r()*0.16)+')'; g.fillRect(r()*256,r()*256,1,1); }   // поры
    g.lineWidth = 1;                                               // микроморщины-«ромбы»
    for(let i=0;i<180;i++){
      const x = r()*256, y = r()*256, l = 6+r()*14, a = r()<0.5 ? 0.6 : -0.6;
      g.strokeStyle = 'rgba(95,48,32,'+(0.06+r()*0.10)+')';
      g.beginPath(); g.moveTo(x,y); g.lineTo(x+Math.cos(a)*l, y+Math.sin(a)*l); g.stroke();
    }
    for(let i=0;i<34;i++){ g.fillStyle = 'rgba(120,70,40,'+(0.15+r()*0.2)+')'; g.beginPath(); g.arc(r()*256,r()*256,0.8+r()*1.4,0,7); g.fill(); }   // веснушки
    g.lineWidth = 0.6;                                             // волоски
    for(let i=0;i<260;i++){ const x = r()*256, y = r()*256; g.strokeStyle = 'rgba(40,24,14,'+(0.18+r()*0.25)+')'; g.beginPath(); g.moveTo(x,y); g.lineTo(x+(r()-0.5)*2, y+2+r()*3); g.stroke(); }
    return c;
  }
  function clothCanvas(){
    const c = cnv(128,128), g = c.getContext('2d'), r = rng(47);
    g.fillStyle = '#56603f'; g.fillRect(0,0,128,128);
    for(let i=0;i<128;i+=2){ g.fillStyle = 'rgba(20,26,10,'+(0.16+r()*0.10)+')'; g.fillRect(i,0,1,128); g.fillRect(0,i,128,1); }
    for(let i=0;i<9;i++){ const y = r()*128; g.fillStyle = 'rgba(0,0,0,0.11)'; g.fillRect(0,y,128,3+r()*6); }
    for(let i=0;i<20;i++){ g.fillStyle = 'rgba(70,52,30,'+(0.1+r()*0.15)+')'; g.beginPath(); g.arc(r()*128,r()*128,2+r()*7,0,7); g.fill(); }   // пятна грязи
    for(let i=0;i<500;i++){ g.fillStyle = 'rgba(190,190,150,'+r()*0.08+')'; g.fillRect(r()*128,r()*128,1,1); }
    return c;
  }

  /* ---------------- Материалы и окружение ---------------- */
  const M = {};
  function makeEnv(renderer){
    const s = new T.Scene(), geo = new T.SphereGeometry(10,32,16), p = geo.attributes.position, col = new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){
      const y = p.getY(i)/10, up = Math.max(0,y), dn = Math.max(0,-y);
      let rr = 0.95*(1-up) + 0.50*up, gg = 0.86*(1-up) + 0.72*up, bb = 0.72*(1-up) + 0.95*up;
      rr = rr*(1-dn) + 0.18*dn; gg = gg*(1-dn) + 0.15*dn; bb = bb*(1-dn) + 0.11*dn;
      col[i*3]=rr; col[i*3+1]=gg; col[i*3+2]=bb;
    }
    geo.setAttribute('color', new T.BufferAttribute(col,3));
    s.add(new T.Mesh(geo, new T.MeshBasicMaterial({vertexColors:true, side:T.BackSide})));
    const sun = new T.Mesh(new T.SphereGeometry(1.4,12,8), new T.MeshBasicMaterial({color:new T.Color(0xfff0cc).multiplyScalar(5)}));
    sun.position.set(6,7,3); s.add(sun);
    const pm = new T.PMREMGenerator(renderer);
    const rt = pm.fromScene(s, 0.03); pm.dispose();
    return rt.texture;
  }
  let ready = false;
  function init(renderer){
    if(ready) return; ready = true;
    const env = makeEnv(renderer);
    G.env = env;
    const wc = woodCanvas(), sc = skinCanvas(), cc = clothCanvas(), rc = ropeCanvas(), mc = metalCanvases();
    const wood = mk(wc), skin = mk(sc,2,2), cloth = mk(cc,3,4), rope = mk(rc,2,4), metal = mk(mc.c,4,4), orm = mk(mc.o,4,4), end = mk(endGrainCanvas());
    const wN = nrm(wc, 3.2), sN = nrm(sc, 2.2, 2, 2), cN = nrm(cc, 3.5, 3, 4), rN = nrm(rc, 4, 2, 4), mN = nrm(mc.c, 2.4, 4, 4);
    const nS = v => new T.Vector2(v,v);
    M.wood  = new T.MeshStandardMaterial({map:wood, normalMap:wN, normalScale:nS(0.7), roughness:0.82, envMap:env, envMapIntensity:0.28});
    M.end   = new T.MeshStandardMaterial({map:end, roughness:0.9});
    M.rope  = new T.MeshStandardMaterial({map:rope, normalMap:rN, normalScale:nS(1.1), roughness:0.95, envMap:env, envMapIntensity:0.15});
    M.metal = new T.MeshStandardMaterial({map:metal, normalMap:mN, normalScale:nS(0.9), roughnessMap:orm, metalnessMap:orm, color:0xe4e8ee, roughness:1, metalness:1, envMap:env, envMapIntensity:1.0});
    M.dark  = new T.MeshStandardMaterial({map:metal, normalMap:mN, normalScale:nS(0.9), roughnessMap:orm, metalnessMap:orm, color:0x8b8f96, roughness:1, metalness:1, envMap:env, envMapIntensity:0.9});
    M.skin  = new T.MeshPhysicalMaterial({map:skin, normalMap:sN, normalScale:nS(0.5), roughness:0.55, emissive:0x2a0f08, clearcoat:0.14, clearcoatRoughness:0.55, sheen:new T.Color(0x7a3f2c), envMap:env, envMapIntensity:0.18});
    M.crease= new T.MeshStandardMaterial({color:0x8d5439, roughness:0.85});
    M.cloth = new T.MeshStandardMaterial({map:cloth, normalMap:cN, normalScale:nS(0.9), roughness:1});
    M.nail  = new T.MeshStandardMaterial({color:0xe4b9a6, roughness:0.22, envMap:env, envMapIntensity:0.7});
    M.rubber= new T.MeshStandardMaterial({color:0x1b1b1c, roughness:0.72, metalness:0.12, envMap:env, envMapIntensity:0.35});
    initGun(env);
  }

  /* склеиваем статичные меши группы по материалу */
  function bake(g){
    const buckets = new Map(), kids = g.children.slice();
    kids.forEach(m=>{
      if(!m.isMesh) return;
      m.updateMatrix();
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      geo.applyMatrix4(m.matrix);
      if(!buckets.has(m.material)) buckets.set(m.material, []);
      buckets.get(m.material).push(geo);
      g.remove(m); m.geometry.dispose();
    });
    buckets.forEach((geos, mat)=>{
      let n = 0; geos.forEach(x=>{ n += x.attributes.position.count; });
      const pos = new Float32Array(n*3), nor = new Float32Array(n*3), uv = new Float32Array(n*2); let o = 0;
      geos.forEach(x=>{
        pos.set(x.attributes.position.array, o*3); nor.set(x.attributes.normal.array, o*3);
        if(x.attributes.uv) uv.set(x.attributes.uv.array, o*2);
        o += x.attributes.position.count; x.dispose();
      });
      const mg = new T.BufferGeometry();
      mg.setAttribute('position', new T.BufferAttribute(pos,3));
      mg.setAttribute('normal', new T.BufferAttribute(nor,3));
      mg.setAttribute('uv', new T.BufferAttribute(uv,2));
      g.add(new T.Mesh(mg, mat));
    });
    return g;
  }

  /* ---------------- Рукоять ---------------- */
  function handleRadius(y, len){
    const smooth = (a,b,x)=>{ const t = Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
    return 0.0212 + 0.006*Math.exp(-y/0.03) + 0.0055*smooth(len*0.68,len,y) + 0.0007*Math.sin(y*38);
  }
  function makeHandle(len){
    const g = new T.Group(), pts = [];
    for(let i=0;i<=64;i++){ const y = len*i/64; pts.push(new T.Vector2(handleRadius(y,len), y)); }
    g.add(new T.Mesh(new T.LatheGeometry(pts,32), M.wood));
    const cap = new T.Mesh(new T.CircleGeometry(handleRadius(0,len),28), M.end);
    cap.rotation.x = Math.PI/2; cap.position.y = -0.0005; g.add(cap);
    const ropeLen = 0.27, ry0 = 0.05;                              // обмотка под ладони
    const wrap = new T.Mesh(new T.CylinderGeometry(0.0272,0.0272,ropeLen,32,1,true), M.rope);
    wrap.position.y = ry0 + ropeLen/2; g.add(wrap);
    for(const yy of [ry0, ry0+ropeLen]){
      const ring = new T.Mesh(new T.TorusGeometry(0.0272,0.0048,8,28), M.rope);
      ring.rotation.x = Math.PI/2; ring.position.y = yy; g.add(ring);
    }
    for(let i=0;i<3;i++){                                          // стяжка под головой
      const ring = new T.Mesh(new T.TorusGeometry(0.0275,0.0036,7,24), M.rope);
      ring.rotation.x = Math.PI/2; ring.position.y = len - 0.075 - i*0.0075; g.add(ring);
    }
    return bake(g);
  }

  /* ---------------- Головка кирки: кованый серп ---------------- */
  function makeHead(){
    const L = 0.25, drop = 0.115, N = 96;
    const cy = x => -drop*(x/L)*(x/L);
    const hw = x => 0.0016 + 0.037*Math.pow(1 - Math.min(1,Math.abs(x)/L), 0.8);
    const sh = new T.Shape(), up = [], lo = [];
    for(let i=0;i<=N;i++){ const x = -L + 2*L*i/N; up.push([x, cy(x)+hw(x)]); lo.push([x, cy(x)-hw(x)]); }
    sh.moveTo(up[0][0], up[0][1]);
    for(let i=1;i<up.length;i++) sh.lineTo(up[i][0], up[i][1]);
    for(let i=lo.length-1;i>=0;i--) sh.lineTo(lo[i][0], lo[i][1]);
    sh.closePath();
    const depth = 0.040;
    const geo = new T.ExtrudeGeometry(sh, {depth, steps:1, bevelEnabled:true, bevelThickness:0.0075, bevelSize:0.0042, bevelSegments:5, curveSegments:6});
    geo.translate(0,0,-depth/2);
    const pos = geo.attributes.position;
    for(let i=0;i<pos.count;i++){                                  // клиновидное сужение к остриям
      const t = Math.min(1, Math.abs(pos.getX(i))/L);
      pos.setZ(i, pos.getZ(i) * (0.24 + 0.76*Math.pow(1-t, 0.6)));
    }
    geo.computeVertexNormals();
    const g = new T.Group();
    g.add(new T.Mesh(geo, M.metal));
    const collar = new T.Mesh(new T.CylinderGeometry(0.0335,0.0365,0.074,28), M.dark);   // втулка
    g.add(collar);
    for(const yy of [-0.037, 0.037]){
      const ring = new T.Mesh(new T.TorusGeometry(0.0355,0.0055,8,28), M.metal);
      ring.rotation.x = Math.PI/2; ring.position.y = yy; g.add(ring);
    }
    for(const sx of [-1,1]) for(const sz of [-1,1]){               // заклёпки
      const rv = new T.Mesh(new T.SphereGeometry(0.0058,10,8), M.dark);
      rv.scale.set(1,1,0.55); rv.position.set(sx*0.066, cy(sx*0.066)+0.004, sz*0.0215); g.add(rv);
    }
    const top = new T.Mesh(new T.CylinderGeometry(0.0195,0.0225,0.03,20), M.wood);
    top.position.y = 0.05; g.add(top);
    const wedge = new T.Mesh(new T.BoxGeometry(0.006,0.014,0.030), M.dark);
    wedge.position.y = 0.062; g.add(wedge);
    return bake(g);
  }

  /* ---------------- Руки ---------------- */
  const _u = new T.Vector3(0,1,0), _z = new T.Vector3(0,0,1);
  function limb(a, b, r0, r1, mat, parent){
    const d = new T.Vector3().subVectors(b, a), len = d.length();
    const m = new T.Mesh(new T.CylinderGeometry(r1, r0, len, 14, 1), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(_u, d.normalize());
    parent.add(m);
    return m;
  }
  function ball(p, r, mat, parent, sx, sy, sz){
    const m = new T.Mesh(new T.SphereGeometry(r, 18, 14), mat);
    m.position.copy(p); if(sx) m.scale.set(sx, sy, sz); parent.add(m); return m;
  }
  /* гладкая трубка вдоль кривой с переменным радиусом (палец). Сечение чуть приплюснуто к рукояти */
  function tube(curve, rfn, N, seg, mat, parent){
    const pos = [], nor = [], uv = [], idx = [], V = T.Vector3;
    for(let i=0;i<=N;i++){
      const t = i/N, p = curve.getPoint(t), tg = curve.getTangent(t);
      const n = new V(p.x,0,p.z); if(n.lengthSq() < 1e-8) n.set(1,0,0); n.normalize();
      n.addScaledVector(tg, -n.dot(tg)).normalize();
      const b = new V().crossVectors(tg, n), r = rfn(t);
      for(let j=0;j<=seg;j++){
        const a = j/seg*2*PI, cx = Math.cos(a), sx = Math.sin(a);
        const dir = new V().addScaledVector(n, cx*0.9).addScaledVector(b, sx);
        pos.push(p.x+dir.x*r, p.y+dir.y*r, p.z+dir.z*r);
        const nn = new V().addScaledVector(n, cx/0.9).addScaledVector(b, sx).normalize();
        nor.push(nn.x,nn.y,nn.z); uv.push(j/seg, t*1.5);
      }
    }
    for(let i=0;i<N;i++) for(let j=0;j<seg;j++){
      const a = i*(seg+1)+j, b = a+seg+1;
      idx.push(a,a+1,b, b,a+1,b+1);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(nor,3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv,2));
    geo.setIndex(idx);
    parent.add(new T.Mesh(geo, mat));
  }
  const _q1 = new T.Quaternion(), _q2 = new T.Quaternion(), _m4 = new T.Matrix4();
  /* дуга-складка кожи вокруг пальца, центр дуги смотрит по n */
  function crease(p, tg, n, rad, arc, parent){ return;   // линии-складки на пальцах убраны
    const m = new T.Mesh(new T.TorusGeometry(rad, 0.00085, 5, 10, arc), M.crease);
    _q1.setFromUnitVectors(_z, tg);
    const c = new T.Vector3(Math.cos(arc/2), Math.sin(arc/2), 0).applyQuaternion(_q1);
    const ang = Math.atan2(new T.Vector3().crossVectors(c, n).dot(tg), c.dot(n));
    _q2.setFromAxisAngle(tg, ang);
    m.quaternion.copy(_q2.multiply(_q1)); m.position.copy(p); parent.add(m);
  }
  const gauss = (t,c,w) => Math.exp(-((t-c)*(t-c))/(2*w*w));
  /* один палец: 3 фаланги, суставные утолщения, складки, ноготь */
  function finger(pts, fr, joints, parent, tipT){
    const curve = new T.CatmullRomCurve3(pts, false, 'centripetal');
    const rfn = t => fr*(1.05 - 0.26*t) * (1 + joints.reduce((s,j)=> s + 0.075*gauss(t,j,0.045), 0));
    tube(curve, rfn, 28, 14, M.skin, parent);
    ball(pts[0], fr*1.13, M.skin, parent, 1, 1, 0.95);                    // костяшка (MCP)
    const pe = curve.getPoint(1); ball(pe, rfn(1)*0.98, M.skin, parent, 1, 0.95, 1);
    joints.forEach(j=>{
      const p = curve.getPoint(j), tg = curve.getTangent(j);
      const n = new T.Vector3(p.x,0,p.z).normalize(); n.addScaledVector(tg, -n.dot(tg)).normalize();
      crease(p.clone().addScaledVector(tg,-0.0022), tg, n, rfn(j)*0.97, 2.3, parent);
      crease(p.clone().addScaledVector(tg, 0.0022), tg, n, rfn(j)*0.97, 2.0, parent);
      crease(p, tg, n.clone().negate(), rfn(j)*0.96, 2.4, parent);        // сгибательная складка
    });
  }

  /* кисть в хвате вокруг вертикальной рукояти. s = +1 правая, -1 левая; yBase — высота нижнего пальца */
  function makeHand(s, yBase){
    const g = new T.Group(), R = 0.0295, r = rng(s>0 ? 7 : 19), V = T.Vector3;
    const at = (a, y, rr) => new V(s*(rr||R)*Math.cos(a), y, -(rr||R)*Math.sin(a));
    const gap = 0.0205, yTop = yBase + gap*3;
    // индивидуальный хват: разная длина, радиус и лёгкий «перекос» каждого пальца
    const F = [ {end:206, fr:0.0119, j:[0.46,0.76]}, {end:214, fr:0.0115, j:[0.47,0.77]},
                {end:205, fr:0.0108, j:[0.46,0.76]}, {end:188, fr:0.0098, j:[0.45,0.75]} ];
    for(let k=0;k<4;k++){
      const f = F[k], y0 = yTop - k*gap + (r()-0.5)*0.0012, a0 = (38 + (r()-0.5)*5)*deg, a1 = (f.end + (r()-0.5)*8)*deg;
      const drift = 0.0011 + r()*0.0007, pts = [];
      for(let j=0;j<=4;j++){
        const u = j/4, a = a0 + (a1-a0)*u;
        pts.push(at(a, y0 - drift*j*j*0.6, R + 0.0022 + 0.0012*Math.sin(u*PI)));
      }
      finger(pts, f.fr, f.j, g, 0.9);
    }
    // ладонь: тыльная сторона, бугры большого пальца и мизинца, запястье
    const yMid = yBase + gap*1.5, palmC = new V(s*0.056, yMid, 0.004);
    ball(palmC, 0.031, M.skin, g, 0.95, 1.62, 1.12);
    ball(new V(s*0.046, yMid, -0.004), 0.028, M.skin, g, 0.9, 1.5, 1.0);
    ball(new V(s*0.062, yBase+0.000, -0.002), 0.0215, M.skin, g, 0.95, 1.25, 1.0);       // бугор мизинца
    ball(new V(s*0.050, yTop+0.006, 0.016), 0.0235, M.skin, g, 1.0, 1.3, 1.0);            // бугор большого
    // большой палец: 2 фаланги + пястная, идёт поверх пальцев
    const th = [[-8, yTop+0.030],[-64, yTop+0.030],[-122, yTop+0.026],[-166, yTop+0.020]].map(v=>at(v[0]*deg, v[1], R+0.001));
    const tp = new V(s*0.050, yTop+0.020, 0.012);
    ball(tp, 0.0175, M.skin, g, 1, 1.1, 1);
    finger([tp, th[0], th[1], th[2], th[3]], 0.0138, [0.55,0.83], g, 0.93);
    const wr0 = palmC.clone();
    const dir = new V(s*0.52, -0.52, 0.68).normalize();
    const wrist = wr0.clone().addScaledVector(dir, 0.052);
    limb(wr0, wrist, 0.030, 0.027, M.skin, g); ball(wrist, 0.0285, M.skin, g);
    ball(wrist.clone().add(new V(s*0.017, 0.006, 0.004)), 0.0085, M.skin, g);           // косточка запястья
    bake(g);
    g.userData.wrist = wrist; g.userData.dir = dir;
    return g;
  }

  /* рука целиком: предплечье (голое) + закатанный рукав + плечо. Расставляется 2-костным IK */
  const L1 = 0.30, L2 = 0.40;
  function makeArm(s){
    const g = new T.Group(), V2 = T.Vector2;
    const fore = new T.Group();
    const sp = [];
    for(let i=0;i<=20;i++){ const y = 0.17*i/20, k = Math.min(1,y/0.16), sm = k*k*(3-2*k); sp.push(new V2(0.0255 + 0.012*sm + 0.0035*Math.sin(PI*k) + 0.0032*Math.sin(PI*Math.min(1,y/0.17)), y)); }
    const skin = new T.Mesh(new T.LatheGeometry(sp, 24), M.skin); skin.scale.set(1.12,1,0.88); fore.add(skin);
    const cuff = new T.Mesh(new T.TorusGeometry(0.044,0.0105,10,24), M.cloth); cuff.rotation.x = PI/2; cuff.position.y = 0.168; fore.add(cuff);
    const cuff2 = new T.Mesh(new T.TorusGeometry(0.047,0.0085,10,24), M.cloth); cuff2.rotation.x = PI/2; cuff2.position.y = 0.186; fore.add(cuff2);
    const rp = [];
    for(let i=0;i<=16;i++){ const y = 0.19 + (L1-0.19)*i/16; rp.push(new V2(0.048 + 0.006*(i/16) + 0.0028*Math.sin(i*1.9), y)); }
    fore.add(new T.Mesh(new T.LatheGeometry(rp, 22), M.cloth));
    g.add(fore);
    const up = new T.Mesh(new T.CylinderGeometry(0.056,0.052,1,18,1,true), M.cloth); g.add(up);
    const elbow = new T.Mesh(new T.SphereGeometry(0.054,14,10), M.cloth); g.add(elbow);
    g.userData.fore = fore; g.userData.upper = up; g.userData.elbow = elbow;
    g.userData.shoulder = new T.Vector3(s*0.30, -0.55, 0.10);
    g.userData.side = s;
    return g;
  }

  function addHands(tool){
    const hR = makeHand(1, 0.072), hL = makeHand(-1, 0.190);
    tool.add(hR); tool.add(hL);
    const aR = makeArm(1), aL = makeArm(-1);
    aR.userData.wristLocal = hR.userData.wrist.clone(); aR.userData.hand = hR;
    aL.userData.wristLocal = hL.userData.wrist.clone(); aL.userData.hand = hL;
    tool.userData.arms = [aR, aL]; tool.userData.hands = [hR, hL];
    tool.userData.slide = 0; tool.userData.squeeze = 0; tool.userData.shoulderShift = new T.Vector3();
    return tool.userData.arms;
  }

  /* каждый кадр: микро-подстройка хвата + IK рук (запястье → локоть → плечо) */
  const _W = new T.Vector3(), _S = new T.Vector3(), _D = new T.Vector3(), _E = new T.Vector3(), _P = new T.Vector3(), _X = new T.Vector3();
  const _iv = new T.Vector3(), _im = new T.Matrix4();
  function updateArms(tool){
    const ud = tool && tool.userData; if(!ud || !ud.arms) return;
    if(ud.gun){                                   // оружие: плечи закреплены в системе камеры
      tool.updateMatrix(); _im.copy(tool.matrix).invert();
      ud.arms.forEach(a=>{ a.userData.shoulder.copy(a.userData.camShoulder).applyMatrix4(_im); });
    }
    const t = performance.now()/1000, sl = ud.slide||0, sq = ud.squeeze||0, sh = ud.shoulderShift;
    const hs = ud.gun ? null : ud.hands;
    if(hs){
      if(hs[1]) hs[1].position.y = (ud.hOff1||0) - 0.024*sl + 0.0012*Math.sin(t*0.55);          // ведущая рука съезжает при ударе
      hs[0].position.y = (ud.hOff0||0) + 0.004*sl + 0.0010*Math.sin(t*0.47+1.3);
      if(hs[1]) hs[1].rotation.y = (ud.hRot1||0) - 0.035*sl + 0.012*Math.sin(t*0.41+0.7);       // проворот кисти на рукояти
      hs[0].rotation.y = (ud.hRot0||0) + 0.050*sl + 0.010*Math.sin(t*0.36);
      const k = 1 - 0.035*sq;                                          // сжатие хвата
      hs[0].scale.set(k,1,k); if(hs[1]) hs[1].scale.set(k,1,k);
    }
    tool.updateMatrix();
    for(const a of ud.arms){
      const u = a.userData, h = u.hand, s = u.side;
      h.updateMatrix();
      _W.copy(u.wristLocal).applyMatrix4(h.matrix).applyMatrix4(tool.matrix);
      _S.copy(u.shoulder); if(sh) _S.add(sh);
      _D.subVectors(_S, _W);
      let dist = _D.length(); _D.multiplyScalar(1/dist);
      dist = Math.min(dist, (L1+L2)*0.995);
      const A = (L1*L1 - L2*L2 + dist*dist)/(2*dist), H = Math.sqrt(Math.max(0, L1*L1 - A*A));
      _P.set(s*0.55, -1, 0.25); _P.addScaledVector(_D, -_P.dot(_D)).normalize();       // локоть уходит вниз-наружу
      _E.copy(_W).addScaledVector(_D, A).addScaledVector(_P, H);
      _X.subVectors(_E, _W).normalize();
      u.fore.position.copy(_W); u.fore.quaternion.setFromUnitVectors(_u, _X);
      const up = u.upper; _X.subVectors(_S, _E); const ul = _X.length();
      up.position.copy(_E).addScaledVector(_X, 0.5);
      up.quaternion.setFromUnitVectors(_u, _X.multiplyScalar(1/ul)); up.scale.y = ul;
      u.elbow.position.copy(_E);
    }
  }


  /* ================= ШТУРМОВАЯ ВИНТОВКА (PBR) ================= */
  function gunSteelCanvases(dark){
    const c = cnv(512,512), g = c.getContext('2d'), o = cnv(512,512), og = o.getContext('2d'), r = rng(dark?71:83);
    g.fillStyle = dark?'#14161a':'#26292e'; g.fillRect(0,0,512,512);
    og.fillStyle = 'rgb(0,'+(dark?96:84)+',245)'; og.fillRect(0,0,512,512);
    for(let i=0;i<22000;i++){                                       // шлифовка вдоль ствола
      const v = 30+r()*60|0, x = r()*512, y = r()*512, w = 2+r()*9;
      g.fillStyle = 'rgba('+v+','+v+','+(v+5)+','+(0.08+r()*0.18)+')'; g.fillRect(x,y,w,1);
      og.fillStyle = 'rgba(0,'+(70+r()*70|0)+',245,0.3)'; og.fillRect(x,y,w,1);
    }
    for(let i=0;i<220;i++){                                          // потёртости до светлой стали на кромках
      const x = r()*512, y = r()*512, l = 6+r()*40, a = r()*6.28;
      g.strokeStyle = 'rgba(150,154,162,'+(0.10+r()*0.25)+')'; g.lineWidth = 0.6+r()*1.6;
      g.beginPath(); g.moveTo(x,y); g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l); g.stroke();
      og.strokeStyle = 'rgba(0,50,245,0.75)'; og.lineWidth = 1; og.beginPath(); og.moveTo(x,y); og.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l); og.stroke();
    }
    for(let i=0;i<14;i++){                                           // масляные разводы (глянец)
      const x = r()*512, y = r()*512, rr = 20+r()*60, rg = og.createRadialGradient(x,y,1,x,y,rr);
      rg.addColorStop(0,'rgba(0,30,245,0.6)'); rg.addColorStop(1,'rgba(0,30,245,0)'); og.fillStyle = rg; og.fillRect(x-rr,y-rr,rr*2,rr*2);
    }
    for(let i=0;i<10;i++){                                           // лёгкая ржавчина
      const x = r()*512, y = r()*512, rr = 8+r()*22, rg = g.createRadialGradient(x,y,1,x,y,rr);
      rg.addColorStop(0,'rgba(110,56,24,0.35)'); rg.addColorStop(1,'rgba(110,56,24,0)'); g.fillStyle = rg; g.fillRect(x-rr,y-rr,rr*2,rr*2);
    }
    return {c:c, o:o};
  }
  function polymerCanvas(){
    const c = cnv(256,256), g = c.getContext('2d'), r = rng(97);
    g.fillStyle = '#1b1c1e'; g.fillRect(0,0,256,256);
    for(let y=0;y<256;y+=6) for(let x=0;x<256;x+=6){ const v = 22+r()*22|0; g.fillStyle = 'rgb('+v+','+v+','+(v+2)+')'; g.beginPath(); g.arc(x+(y%12?3:0),y,1.9,0,7); g.fill(); }   // насечка-«пупырышки»
    for(let i=0;i<1200;i++){ g.fillStyle = 'rgba(120,120,125,'+r()*0.07+')'; g.fillRect(r()*256,r()*256,1,1); }
    return c;
  }
  function lacquerWoodCanvas(){
    const c = woodCanvas(), g = c.getContext('2d');
    g.fillStyle = 'rgba(58,20,6,0.62)'; g.fillRect(0,0,256,512);            // тёмный лак (орех)
    return c;
  }
  /* ---------- ровные «чистые» текстуры: только мелкое зерно, без пятен ---------- */
  function grainCanvas(r0,g0,b0,amp,seed,streak){
    const S = 256, c = cnv(S,S), g = c.getContext('2d'), r = rng(seed);
    g.fillStyle = 'rgb('+r0+','+g0+','+b0+')'; g.fillRect(0,0,S,S);
    for(let i=0;i<7000;i++){ const d = (r()-0.5)*2*amp|0; g.fillStyle = 'rgba('+(d>0?255:0)+','+(d>0?255:0)+','+(d>0?255:0)+','+(Math.abs(d)/255).toFixed(3)+')'; g.fillRect(r()*S,r()*S,1+r()*2,1+r()*(streak?1:2)); }
    if(streak){ for(let y=0;y<S;y+=2){ g.fillStyle = 'rgba(255,255,255,'+(r()*0.05).toFixed(3)+')'; g.fillRect(0,y,S,1); } }
    return c;
  }
  function tubeBetween(ax,ay,az,bx,by,bz,rad,mat,seg){
    const a = new T.Vector3(ax,ay,az), b = new T.Vector3(bx,by,bz), d = new T.Vector3().subVectors(b,a), L = d.length();
    const m = new T.Mesh(new T.CylinderGeometry(rad,rad,L,seg||8), mat);
    m.position.copy(a).addScaledVector(d,0.5); m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), d.normalize()); return m;
  }
  function helixMesh(p0,p1,R,turns,tr,mat){
    const a = new T.Vector3().subVectors(p1,p0), ax = a.clone().normalize(), e1 = new T.Vector3(1,0,0);
    if(Math.abs(ax.x)>0.9) e1.set(0,1,0);
    e1.addScaledVector(ax,-e1.dot(ax)).normalize(); const e2 = new T.Vector3().crossVectors(ax,e1), pts = [], N = Math.round(turns*10);
    for(let i=0;i<=N;i++){ const t = i/N, th = t*turns*6.2832; pts.push(p0.clone().addScaledVector(a,t).addScaledVector(e1,Math.cos(th)*R).addScaledVector(e2,Math.sin(th)*R)); }
    return new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), N*3, tr, 6), mat);
  }

  const G = {};
  /* ржавая сталь: светлая потёртая сталь (глянец, блики) + пятна ржавчины (матовые, оранжевые) */
  function rustSteelCanvases(seed, k){
    const c = cnv(512,512), g = c.getContext('2d'), o = cnv(512,512), og = o.getContext('2d'), r = rng(seed);
    g.fillStyle = 'rgb('+(92*k|0)+','+(88*k|0)+','+(86*k|0)+')'; g.fillRect(0,0,512,512);
    og.fillStyle = 'rgb(0,105,245)'; og.fillRect(0,0,512,512);
    for(let i=0;i<26;i++){                                             // крупные зоны: где-то глянец, где-то матово
      const x = r()*512, y = r()*512, rr = 50+r()*110, gl = r()<0.5, rg = og.createRadialGradient(x,y,1,x,y,rr);
      rg.addColorStop(0, gl ? 'rgba(0,30,250,0.75)' : 'rgba(0,185,230,0.7)'); rg.addColorStop(1, gl ? 'rgba(0,30,250,0)' : 'rgba(0,185,230,0)');
      og.fillStyle = rg; og.fillRect(x-rr,y-rr,rr*2,rr*2);
    }
    for(let i=0;i<16000;i++){                                          // продольная шлифовка
      const v = 60+r()*90|0, x = r()*512, y = r()*512, w = 3+r()*14;
      g.fillStyle = 'rgba('+v+','+v+','+(v+4)+','+(0.08+r()*0.2)+')'; g.fillRect(x,y,w,1);
      og.fillStyle = 'rgba(0,'+(50+r()*60|0)+',245,0.35)'; og.fillRect(x,y,w,1);
    }
    for(let i=0;i<16;i++){                                             // пятна ржавчины
      const x = r()*512, y = r()*512, rr = 10+r()*34, a = 0.5+r()*0.4;
      const rg = g.createRadialGradient(x,y,1,x,y,rr);
      rg.addColorStop(0,'rgba('+(150*k|0)+','+(66*k|0)+','+(32*k|0)+','+a+')'); rg.addColorStop(0.6,'rgba('+(120*k|0)+','+(52*k|0)+','+(28*k|0)+','+(a*0.6)+')'); rg.addColorStop(1,'rgba(120,52,28,0)');
      g.fillStyle = rg; g.fillRect(x-rr,y-rr,rr*2,rr*2);
      const og2 = og.createRadialGradient(x,y,1,x,y,rr);
      og2.addColorStop(0,'rgba(0,150,150,'+a+')'); og2.addColorStop(0.6,'rgba(0,140,160,'+(a*0.6)+')'); og2.addColorStop(1,'rgba(0,140,160,0)');
      og.fillStyle = og2; og.fillRect(x-rr,y-rr,rr*2,rr*2);
    }
    for(let i=0;i<1200;i++){                                           // мелкая ржавая крапа
      const x = r()*512, y = r()*512, w = 1+r()*3;
      g.fillStyle = 'rgba('+(170*k|0)+','+(80*k|0)+','+(36*k|0)+','+(0.25+r()*0.4)+')'; g.fillRect(x,y,w,w);
      og.fillStyle = 'rgba(0,150,150,0.6)'; og.fillRect(x,y,w,w);
    }
    for(let i=0;i<160;i++){                                            // стёртые светлые царапины
      const x = r()*512, y = r()*512, l = 8+r()*40;
      g.strokeStyle = 'rgba(170,172,178,'+(0.15+r()*0.25)+')'; g.lineWidth = 0.6+r()*1.2;
      g.beginPath(); g.moveTo(x,y); g.lineTo(x+l,y+(r()-0.5)*3); g.stroke();
      og.strokeStyle = 'rgba(0,40,250,0.8)'; og.lineWidth = 1; og.beginPath(); og.moveTo(x,y); og.lineTo(x+l,y); og.stroke();
    }
    return {c:c, o:o};
  }
  function initGun(env){
    const nS = v => new T.Vector2(v,v);
    const sd = gunSteelCanvases(true), sl = gunSteelCanvases(false), pc = polymerCanvas(), wc = lacquerWoodCanvas();
    // UV у экструзий в метрах → большое повторение; у боксов/цилиндров UV 0..1 → малое
    const mkSteel = (cv, rep, col, ei)=> new T.MeshStandardMaterial({map:mk(cv.c,rep,rep), normalMap:nrm(cv.c,1.6,rep,rep), normalScale:nS(0.6), roughnessMap:mk(cv.o,rep,rep), metalnessMap:mk(cv.o,rep,rep), color:col, roughness:1, metalness:1, envMap:env, envMapIntensity:ei});
    G.steelX = mkSteel(sd, 9, 0xb8bcc4, 0.9);     // экструзии
    G.steelB = mkSteel(sd, 1.2, 0xb8bcc4, 0.9);   // простые примитивы
    G.steelLX= mkSteel(sl, 9, 0xc4c8d0, 0.9);
    G.steelLB= mkSteel(sl, 1.2, 0xc4c8d0, 0.9);
    G.polyX  = new T.MeshStandardMaterial({map:mk(pc,14,14), normalMap:nrm(pc,3.0,14,14), normalScale:nS(0.9), roughness:0.72, metalness:0.05, envMap:env, envMapIntensity:0.35});
    G.polyB  = new T.MeshStandardMaterial({map:mk(pc,2,2), normalMap:nrm(pc,3.0,2,2), normalScale:nS(0.9), roughness:0.72, metalness:0.05, envMap:env, envMapIntensity:0.35});
    G.woodX  = new T.MeshStandardMaterial({map:mk(wc,4,6), normalMap:nrm(wc,3.2,4,6), normalScale:nS(0.7), roughness:0.38, metalness:0.0, envMap:env, envMapIntensity:0.5});
    G.woodB  = new T.MeshStandardMaterial({map:mk(wc,1,1), normalMap:nrm(wc,3.2,1,1), normalScale:nS(0.7), roughness:0.42, metalness:0.0, envMap:env, envMapIntensity:0.55});
    G.brass  = new T.MeshStandardMaterial({color:0xc79a3c, roughness:0.28, metalness:1, envMap:env, envMapIntensity:1.6});
    G.black  = new T.MeshStandardMaterial({color:0x08090a, roughness:0.9, metalness:0.2});
    G.glass  = new T.MeshStandardMaterial({color:0x8fc8ff, roughness:0.04, metalness:0.0, transparent:true, opacity:0.16, envMap:env, envMapIntensity:2.4, depthWrite:false});
    G.red    = new T.MeshBasicMaterial({color:0xff2a1a, toneMapped:false, transparent:true, opacity:0.95, depthWrite:false});
    G.redRing= new T.MeshBasicMaterial({color:0xff2a1a, toneMapped:false, transparent:true, opacity:0.7, depthWrite:false, side:T.DoubleSide});
    const fc = cnv(128,128), fg = fc.getContext('2d');                 // текстура вспышки
    const rgd = fg.createRadialGradient(64,64,2,64,64,62); rgd.addColorStop(0,'rgba(255,255,230,1)'); rgd.addColorStop(0.25,'rgba(255,205,90,0.85)'); rgd.addColorStop(1,'rgba(255,120,20,0)');
    fg.fillStyle = rgd; fg.fillRect(0,0,128,128);
    fg.strokeStyle = 'rgba(255,225,140,0.9)'; fg.lineWidth = 3;
    for(let i=0;i<8;i++){ const a = i*PI/4+0.2; fg.beginPath(); fg.moveTo(64,64); fg.lineTo(64+Math.cos(a)*62,64+Math.sin(a)*62); fg.stroke(); }
    G.flash = new T.MeshBasicMaterial({map:new T.CanvasTexture(fc), transparent:true, blending:T.AdditiveBlending, depthWrite:false, side:T.DoubleSide, toneMapped:false});
    /* --- материалы берданки / пистолета: однотонные, цвета с иконок --- */
    const mkGrain = (col, amp, seed, rep, rough, met, ei, nk, streak)=>{
      const cv = grainCanvas(col[0],col[1],col[2],amp,seed,streak);
      const m = new T.MeshStandardMaterial({map:mk(cv,rep,rep), normalMap:nrm(cv,nk||1.4,rep,rep), normalScale:nS(0.5), roughness:rough, metalness:met, envMap:env, envMapIntensity:ei});
      m.userData.pv = (col[0]<<16)|(col[1]<<8)|col[2]; return m;
    };
    { const rs = rustSteelCanvases(11,1), rd = rustSteelCanvases(12,0.75);
      const mkR = (cv,rep,col,ei)=>{ const m = new T.MeshPhysicalMaterial({clearcoat:(ei>1.5?0.3:0.15), clearcoatRoughness:0.35, map:mk(cv.c,rep,rep), normalMap:nrm(cv.c,2.0,rep,rep), normalScale:nS(0.7), roughnessMap:mk(cv.o,rep,rep), metalnessMap:mk(cv.o,rep,rep), color:col, roughness:1, metalness:1, envMap:env, envMapIntensity:ei}); m.userData.pv = col; return m; };
      G.rustX = mkR(rs,9,0xffffff,1.6); G.rustB = mkR(rs,1.2,0xffffff,1.6); G.rustDk = mkR(rd,1.2,0xe0d8d4,1.0); }
    G.tapeBlue = new T.MeshStandardMaterial({color:0x2a64ad, roughness:0.38, metalness:0.0, envMap:env, envMapIntensity:0.8}); G.tapeBlue.userData.pv = 0x2a64ad;
    G.creamX = mkGrain([206,188,148], 12, 13, 10, 1.0, 0.0, 0.12, 2.0); G.creamB = mkGrain([206,188,148], 12, 13, 1.6, 1.0, 0.0, 0.12, 2.0);
    G.creamDk= mkGrain([168,148,110], 12, 14, 1.6, 1.0, 0.0, 0.10, 2.0);
    G.olive  = mkGrain([172,170,136], 10, 15, 1.6, 1.0, 0.0, 0.14, 2.0); G.oliveDk = mkGrain([150,148,114], 10, 16, 1.6, 1.0, 0.0, 0.10, 2.0);
    G.bandB = G.creamB; G.bandDk = G.creamDk;                        // АК использует те же бинты
    G.slideX = mkGrain([190,194,198], 10, 17, 9, 0.30, 1.0, 1.25, 0.8, true); G.slideB = mkGrain([190,194,198], 10, 17, 1.2, 0.30, 1.0, 1.25, 0.8, true);
    G.frameX = mkGrain([62,62,64], 8, 18, 9, 0.50, 0.85, 0.7, 0.8);  G.frameB = mkGrain([62,62,64], 8, 18, 1.2, 0.50, 0.85, 0.7, 0.8);
    G.gunSl  = mkGrain([52,54,58], 8, 31, 9, 0.38, 0.95, 1.0, 0.8, true); G.gunSlB = mkGrain([52,54,58], 8, 31, 1.2, 0.38, 0.95, 1.0, 0.8, true);
    G.gunFr  = mkGrain([30,31,33], 7, 32, 9, 0.55, 0.8, 0.6, 0.8);      G.gunFrB = mkGrain([30,31,33], 7, 32, 1.2, 0.55, 0.8, 0.6, 0.8);
    G.gunGrip= mkGrain([36,36,38], 8, 33, 1.6, 0.95, 0.0, 0.1, 2.0);    G.gunGripDk = mkGrain([24,24,26], 8, 34, 1.6, 0.95, 0.0, 0.08, 2.0);
    G.bkX = mkGrain([40,40,42], 9, 35, 10, 0.6, 0.7, 0.5);  G.bkB = mkGrain([40,40,42], 9, 35, 1.2, 0.6, 0.7, 0.5);  G.bkDk = mkGrain([26,26,28], 8, 36, 1.2, 0.7, 0.6, 0.4);
    G.clX = mkGrain([54,54,52], 8, 37, 10, 0.68, 0.0, 0.45, 2.0); G.clB = mkGrain([54,54,52], 8, 37, 1.6, 0.62, 0.0, 0.55, 2.0); G.clDk = mkGrain([38,38,37], 8, 38, 1.6, 0.8, 0.0, 0.3, 2.0);
    G.tapeDk = new T.MeshStandardMaterial({color:0x2a3240, roughness:0.5, metalness:0}); G.tapeDk.userData.pv = 0x2a3240;
    G.edgeRust = mkGrain([170,84,44], 10, 19, 1.2, 0.6, 0.6, 0.5);
    G.bronze = new T.MeshStandardMaterial({color:0x9c6b2c, roughness:0.38, metalness:1, envMap:env, envMapIntensity:1.2}); G.bronze.userData.pv = 0x9c6b2c;
    G.rope   = new T.MeshStandardMaterial({color:0x17140f, roughness:0.95, metalness:0}); G.rope.userData.pv = 0x17140f;
    G.tapeLt = new T.MeshStandardMaterial({color:0x6da5d9, roughness:0.45, metalness:0, envMap:env, envMapIntensity:0.5}); G.tapeLt.userData.pv = 0x6da5d9;
    G.tape   = new T.MeshStandardMaterial({color:0x2a64ad, roughness:0.40, metalness:0.0, envMap:env, envMapIntensity:0.55}); G.tape.userData.pv = 0x2a64ad;
    G.tapeR  = new T.MeshStandardMaterial({color:0xb3261c, roughness:0.42, metalness:0.0, envMap:env, envMapIntensity:0.55}); G.tapeR.userData.pv = 0xb3261c;
    G.orange = new T.MeshStandardMaterial({color:0xd9711f, roughness:0.5, metalness:0.0}); G.orange.userData.pv = 0xd9711f;
    G.yellow = new T.MeshStandardMaterial({color:0xe9b924, roughness:0.45, metalness:0.0}); G.yellow.userData.pv = 0xe9b924;
  }

  /* профиль (u вперёд, v вверх) → экструзия шириной w по X. Ось ствола вдоль −Z */
  function prof(pts, w, mat, bevel){
    const sh = new T.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for(let i=1;i<pts.length;i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath();
    const b = bevel===undefined ? 0.0016 : bevel;
    const geo = new T.ExtrudeGeometry(sh, {depth:w-b*2, bevelEnabled:b>0, bevelThickness:b, bevelSize:b, bevelSegments:2, curveSegments:6});
    geo.applyMatrix4(new T.Matrix4().set(0,0,1,-(w-b*2)/2, 0,1,0,0, -1,0,0,0, 0,0,0,1));
    return new T.Mesh(geo, mat);
  }
  function makeRifle(withHands){
    const g = new T.Group(); g.userData.gun = true;
    const add = (m)=>{ g.add(m); return m; };
    const box = (w,h,d,mat,x,y,u)=>{ const m = new T.Mesh(new T.BoxGeometry(w,h,d), mat); m.position.set(x,y,-u); return add(m); };
    const cyl = (r0,r1,len,mat,x,y,u,seg)=>{ const m = new T.Mesh(new T.CylinderGeometry(r0,r1,len,seg||16), mat); m.rotation.x = PI/2; m.position.set(x,y,-u); return add(m); };
    const sph = (r,mat,x,y,u)=>{ const m = new T.Mesh(new T.SphereGeometry(r,10,8), mat); m.position.set(x,y,-u); return add(m); };
    const P = (pts,w,mat,x,b)=>{ const m = prof(pts,w,mat,b); if(x) m.position.x = x; return add(m); };

    /* --- ресивер: нижняя часть + крышка с рёбрами --- */
    P([[-0.13,-0.046],[0.215,-0.046],[0.215,0.032],[-0.13,0.032]], 0.036, G.steelX);
    P([[-0.135,0.030],[0.215,0.030],[0.215,0.052],[0.10,0.061],[-0.02,0.061],[-0.135,0.045]], 0.034, G.steelLX);   // крышка ресивера
    for(let i=0;i<6;i++){ box(0.0355,0.0022,0.02,G.steelB,0,0.0475,0.03+i*0.028); }                                     // поперечные рёбра жёсткости
    box(0.0365,0.02,0.07,G.black,0,0.016,0.075);                                                                   // окно выброса (правое)
    /* --- магазинное окно + защёлка --- */
    box(0.041,0.03,0.05,G.steelB,0,-0.05,0.07);
    /* --- рукоять + спусковая скоба --- */
    P([[-0.07,-0.030],[-0.045,-0.030],[-0.062,-0.155],[-0.108,-0.152],[-0.098,-0.10]], 0.04, G.woodX, 0, 0.004);
    const tg = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(0,-0.043,0.026), new T.Vector3(0,-0.086,0.03), new T.Vector3(0,-0.092,-0.02), new T.Vector3(0,-0.064,-0.05), new T.Vector3(0,-0.043,-0.052)]), 24, 0.0034, 8), G.steelB); add(tg);
    const trig = P([[-0.004,-0.043],[0.008,-0.043],[0.002,-0.078],[-0.006,-0.078]], 0.006, G.steelLX, 0, 0); 
    /* --- приклад: цельный деревянный (АК-47) + стальной затылок --- */
    P([[-0.125,0.040],[-0.28,0.034],[-0.385,0.026],[-0.395,-0.130],[-0.34,-0.115],[-0.25,-0.062],[-0.125,-0.046]], 0.034, G.woodX, 0, 0.004);
    P([[-0.392,0.030],[-0.402,0.028],[-0.412,-0.134],[-0.402,-0.136],[-0.392,-0.132]], 0.036, G.steelX, 0, 0.002);   // затылок
    box(0.0355,0.006,0.03,G.steelB,0,0.037,-0.140);                                                                 // задний крепёж ресивера
    /* --- цевьё (нижнее и верхнее), газовая трубка, газоотвод --- */
    P([[0.215,-0.034],[0.48,-0.026],[0.48,0.020],[0.215,0.030]], 0.05, G.woodX, 0, 0.004);
    for(let i=0;i<6;i++) for(let j=0;j<2;j++) box(0.0512,0.007,0.012,G.black,0,-0.012+j*0.017,0.245+i*0.038);   // решётка охлаждения
    P([[0.235,0.030],[0.44,0.026],[0.44,0.052],[0.235,0.058]], 0.036, G.woodX, 0, 0.003);
    cyl(0.0105,0.0105,0.2,G.steelLB,0,0.0665,0.335,14);                                                              // кожух газовой трубки
    box(0.03,0.038,0.03,G.steelB,0,0.03,0.465);                                                                     // газовый блок
    cyl(0.0087,0.0087,0.44,G.steelLB,0,0.006,0.44,16);                                                              // ствол
    cyl(0.0102,0.0102,0.02,G.steelB,0,0.006,0.50,16);
    /* --- мушка с кольцом-защитой --- */
    box(0.006,0.05,0.012,G.steelB,0,0.06,0.505);
    /* --- дульный тормоз с прорезями --- */
    cyl(0.0125,0.0125,0.07,G.steelB,0,0.006,0.565,18);
    for(let i=0;i<3;i++){ box(0.028,0.0035,0.008,G.black,0,0.006,0.545+i*0.018); }
    cyl(0.0082,0.0082,0.002,G.black,0,0.006,0.6,14);
    /* --- шомпол под стволом, антабки --- */
    cyl(0.0035,0.0035,0.2,G.steelB,0,-0.038,0.34,8);
    const sw = new T.Mesh(new T.TorusGeometry(0.008,0.0018,6,14), G.steelB); sw.position.set(0,-0.037,-0.475); sw.rotation.y = PI/2; add(sw);
    const sw2 = sw.clone(); sw2.position.set(0,-0.075,0.385); add(sw2);
    /* --- открытый прицел: целик на крышке ресивера --- */
    box(0.024,0.012,0.05,G.steelB,0,0.067,0.15);
    box(0.004,0.02,0.012,G.steelB,-0.008,0.081,0.15); box(0.004,0.02,0.012,G.steelB,0.008,0.081,0.15);
    g.userData.sightCenter = new T.Vector3(0,0.09,-0.15);
    /* --- механика: рычаг переводчика, затвор, заклёпки --- */
    box(0.003,0.05,0.008,G.steelLB,0.0195,0.0,-0.03);
    box(0.012,0.008,0.03,G.steelLB,0.021,0.036,0.03);
    sph(0.007,G.steelB,0.024,0.036,0.044);
    for(let i=0;i<5;i++) sph(0.0032,G.steelLB,0.0195,-0.02+i*0.0,0.0+i*0.04-0.06);
    sph(0.0032,G.steelLB,0.0195,-0.03,0.13);
    /* --- бинты, синяя/красная изолента, катушка, детали (по иконке АК) --- */
    for(let i=0;i<3;i++){ box(0.0525,0.072,0.020,G.bandB,0,-0.002,0.300+i*0.058); const s = box(0.0540,0.074,0.008,G.bandDk,0,-0.002,0.300+i*0.058); s.rotation.x = 0.45; }   // цевьё
    box(0.0385,0.100,0.024,G.bandB,0,-0.009,0.190); { const s = box(0.0400,0.104,0.008,G.bandDk,0,-0.009,0.190); s.rotation.x = 0.45; }                                    // шейка приклада
    box(0.0390,0.060,0.050,G.bandB,0,-0.082,-0.004); box(0.0405,0.014,0.052,G.bandDk,0,-0.070,-0.004).rotation.x = -0.3;               // рукоять
    box(0.0385,0.120,0.016,G.tape,0,-0.028,0.310); box(0.0385,0.145,0.014,G.tapeR,0,-0.045,0.365);                                   // изолента на прикладе
    cyl(0.0112,0.0112,0.018,G.tape,0,0.0665,0.262,14); cyl(0.0112,0.0112,0.018,G.tape,0,0.0665,0.415,14);                             // изолента на газовой трубке
    for(let i=0;i<9;i++) cyl(0.0118,0.0118,0.006,(i%2?G.orange:G.black),0,0.0665,0.292+i*0.0115,14);                                   // витки катушки
    box(0.002,0.012,0.012,G.yellow,-0.0195,0.012,-0.020);                                                                              // жёлтая метка на ресивере
    for(let i=0;i<6;i++) sph(0.0032,G.steelLB,-0.0195,-0.03,-0.11+i*0.05);                                                             // заклёпки слева
    box(0.014,0.004,0.030,G.steelLB,0,0.074,0.17); box(0.050,0.010,0.012,G.steelB,0,0.040,0.22);                                      // ползунок целика, хомут
    { const s = box(0.004,0.05,0.016,G.bandB,0.022,-0.06,-0.40); s.rotation.z = -0.25; const s2 = box(0.004,0.04,0.014,G.bandDk,-0.022,-0.05,0.34); s2.rotation.z = 0.3; }   // болтающиеся концы бинта
    /* --- запечь статику --- */
    bake(g);

    /* --- магазин (отдельно — анимируется при перезарядке) --- */
    const mag = new T.Group();
    const cv = new T.CatmullRomCurve3([[0.06,-0.035],[0.072,-0.11],[0.108,-0.19],[0.17,-0.245]].map(p=>new T.Vector3(0,p[1],-p[0])));
    const magMat = new T.MeshStandardMaterial({map:G.steelLB.map, normalMap:G.steelLB.normalMap, roughnessMap:G.steelLB.roughnessMap, metalnessMap:G.steelLB.metalnessMap, color:0xb8bcc4, roughness:1, metalness:1, envMap:G.env, envMapIntensity:0.9});
    const NS = 10, up = new T.Vector3(0,1,0);
    for(let i=0;i<NS;i++){
      const a0 = cv.getPoint(i/NS), a1 = cv.getPoint((i+1)/NS), d = new T.Vector3().subVectors(a1,a0), len = d.length();
      const seg = new T.Mesh(new T.BoxGeometry(0.036,len*1.04,0.05), magMat);
      seg.position.copy(a0).addScaledVector(d,0.5); seg.quaternion.setFromUnitVectors(up, d.normalize()); mag.add(seg);
      if(i%2===0){ const rb = new T.Mesh(new T.BoxGeometry(0.0375,0.0035,0.045), G.steelB); rb.position.copy(seg.position); rb.quaternion.copy(seg.quaternion); mag.add(rb); }
      if(i===3||i===7){ const tp = new T.Mesh(new T.BoxGeometry(0.0385,len*0.55,0.0525), G.tape); tp.position.copy(seg.position); tp.quaternion.copy(seg.quaternion); mag.add(tp); }
    }
    const cap = new T.Mesh(new T.BoxGeometry(0.038,0.008,0.05), G.steelB); const pe = cv.getPoint(1); cap.position.set(0,pe.y-0.004,pe.z); mag.add(cap);
    const bullet = new T.Mesh(new T.CylinderGeometry(0.0028,0.0028,0.02,8), G.brass); bullet.position.set(0,-0.03,-0.08); mag.add(bullet);
    g.add(mag); g.userData.mag = mag;

    /* --- вспышка выстрела: два скрещённых билборда + ядро --- */
    const fl = new T.Group(); fl.position.set(0,0.006,-0.63);
    for(let i=0;i<2;i++){ const q = new T.Mesh(new T.PlaneGeometry(0.16,0.16), G.flash); q.rotation.z = i*PI/4; fl.add(q); }
    const side = new T.Mesh(new T.PlaneGeometry(0.22,0.09), G.flash); side.rotation.y = PI/2; side.position.z = -0.05; fl.add(side);
    fl.visible = false; g.add(fl); g.userData.flash = fl;

    if(withHands){
      /* руки: те же makeHand/makeArm, что у топора и кирки */
      const hR = makeHand(1, 0.072), hL = makeHand(-1, 0.190);
      const V = T.Vector3, q = new T.Quaternion(), qx = new T.Quaternion(), qz = new T.Quaternion();
      // правая: на пистолетной рукояти, ось хвата вдоль рукояти (наклон вперёд)
      const tilt = -0.36, axR = new V(0, Math.cos(tilt), Math.sin(tilt));
      hR.quaternion.setFromAxisAngle(new V(1,0,0), tilt);
      hR.position.set(0.004,-0.092,0.088).addScaledVector(axR, -(0.072+0.03));
      // левая: под цевьём, ось хвата вдоль ствола (−Z)
      qx.setFromAxisAngle(new V(1,0,0), -PI/2); qz.setFromAxisAngle(new V(0,0,1), PI*0.47);
      hL.quaternion.copy(qz).multiply(qx);
      hL.position.set(-0.004,-0.004,-0.30).addScaledVector(new V(0,0,-1), -(0.19+0.03));
      g.add(hR); g.add(hL);
      const aR = makeArm(1), aL = makeArm(-1);
      aR.userData.wristLocal = hR.userData.wrist.clone(); aR.userData.hand = hR;
      aL.userData.wristLocal = hL.userData.wrist.clone(); aL.userData.hand = hL;
      aR.userData.camShoulder = new V( 0.30,-0.62, 0.02); aL.userData.camShoulder = new V(-0.34,-0.55,-0.02);
      g.userData.arms = [aR, aL]; g.userData.hands = [hR, hL]; g.userData.slide = 0; g.userData.squeeze = 0; g.userData.shoulderShift = new V();
    }
    return g;
  }

  /* ================= ПИСТОЛЕТ (по иконке: полированный светлый затвор, тёмная рамка, бронзовый спуск, пружина, магазин в ткани) ================= */
  function makePistol(withHands){
    const g = new T.Group(); g.userData.gun = true;
    const add = m=>{ g.add(m); return m; };
    const box = (w,h,d,mat,x,y,u)=>{ const m = new T.Mesh(new T.BoxGeometry(w,h,d), mat); m.position.set(x,y,-u); return add(m); };
    const cyl = (r0,r1,len,mat,x,y,u,seg)=>{ const m = new T.Mesh(new T.CylinderGeometry(r0,r1,len,seg||20), mat); m.rotation.x = PI/2; m.position.set(x,y,-u); return add(m); };
    const P = (pts,w,mat,b)=>add(prof(pts,w,mat,b));
    const white = new T.MeshBasicMaterial({color:0xe8e8e4});
    /* затвор: тёмная сталь, цельный корпус без торчащих деталей */
    P([[-0.056,0.012],[-0.056,0.052],[-0.046,0.058],[0.040,0.058],[0.040,0.012]], 0.030, G.gunSl, 0.003);
    P([[0.036,0.012],[0.036,0.064],[0.180,0.064],[0.192,0.056],[0.196,0.044],[0.196,0.012]], 0.030, G.gunSl, 0.003);
    /* прицел: целик и мушка с белыми точками */
    box(0.0035,0.010,0.008,G.black,-0.0075,0.0655,-0.046); box(0.0035,0.010,0.008,G.black,0.0075,0.0655,-0.046);
    box(0.0015,0.004,0.0015,white,-0.0075,0.0715,-0.046); box(0.0015,0.004,0.0015,white,0.0075,0.0715,-0.046);
    box(0.005,0.011,0.008,G.black,0,0.0695,0.184); box(0.0015,0.0015,0.0015,white,0,0.0755,0.184);
    /* насечки затвора сзади (врезаны вровень) и окно выброса */
    for(let i=0;i<5;i++) for(const sx of [-1,1]) box(0.0010,0.030,0.0030,G.black, sx*0.0152,0.034,-0.046+i*0.0075);
    box(0.0010,0.014,0.038,G.black,0.0152,0.052,0.070);
    /* ствол (дульный срез) */
    cyl(0.0090,0.0090,0.012,G.gunFrB,0,0.036,0.200); cyl(0.0056,0.0056,0.014,G.black,0,0.036,0.203);
    /* рамка: тёмная, с рельсом впереди, без внешних пружин и болтов */
    P([[-0.060,0.014],[0.050,0.014],[0.050,-0.012],[0.026,-0.024],[-0.060,-0.024]], 0.028, G.gunFr, 0.002);
    P([[0.040,0.014],[0.130,0.014],[0.130,-0.006],[0.040,-0.006]], 0.026, G.gunFr, 0.0016);
    box(0.027,0.003,0.078,G.gunSlB,0,-0.0075,0.086);                                                   // рельс снизу
    /* спусковая скоба и спуск по центру */
    { const cv = new T.CatmullRomCurve3([new T.Vector3(0,-0.020,-0.020), new T.Vector3(0,-0.038,-0.026), new T.Vector3(0,-0.041,-0.046), new T.Vector3(0,-0.030,-0.060), new T.Vector3(0,-0.008,-0.064)]);
      add(new T.Mesh(new T.TubeGeometry(cv, 18, 0.0042, 8), G.gunFrB)); }
    box(0.006,0.020,0.006,G.black,0,-0.026,-0.040).rotation.x = 0.3;
    box(0.007,0.012,0.010,G.gunSlB,0,0.048,-0.060).rotation.x = 0.4;                                   // курок
    g.userData.sightCenter = new T.Vector3(0,0.0745,0.046);
    bake(g);
    /* рукоять-магазин: тёмный полимер с рёбрами, пятка */
    const mag = new T.Group(), th = -0.32, L = 0.106, topU = -0.030, topY = -0.014;
    const at = (t,dy)=>{ const y = topY - t*L*Math.cos(th), u = topU + t*L*Math.sin(th); return [y, u]; };
    const [cy,cu] = at(0.5,0);
    const mb = new T.Mesh(new T.BoxGeometry(0.0335,L,0.056), G.gunGrip); mb.position.set(0,cy,-cu); mb.rotation.x = th; mag.add(mb);
    for(let i=0;i<5;i++){ const [yy,uu] = at(0.12+i*0.19,0), s = new T.Mesh(new T.BoxGeometry(0.0345,0.008,0.058), G.gunGripDk); s.position.set(0,yy,-uu); s.rotation.x = th + (i%2?0.22:-0.22); mag.add(s); }
    const [by_,bu_] = at(1.0,0), bp = new T.Mesh(new T.BoxGeometry(0.036,0.009,0.064), G.gunFrB); bp.position.set(0,by_-0.003,-bu_); bp.rotation.x = th; mag.add(bp);
    g.add(mag); g.userData.mag = mag;
    const fl = new T.Group(); fl.position.set(0,0.036,-0.235);
    for(let i=0;i<2;i++){ const q = new T.Mesh(new T.PlaneGeometry(0.12,0.12), G.flash); q.rotation.z = i*PI/4; fl.add(q); }
    fl.visible = false; g.add(fl); g.userData.flash = fl;
    if(withHands){
      const hR = makeHand(1, 0.072), V = T.Vector3;
      const tilt = th, axR = new V(0, Math.cos(tilt), Math.sin(tilt));
      const qy = new T.Quaternion().setFromAxisAngle(new V(0,1,0), -0.55), qt = new T.Quaternion().setFromAxisAngle(new V(1,0,0), tilt);
      hR.quaternion.copy(qt).multiply(qy);                                   // ладонь на тыльной стороне рукояти, пальцы обхватывают спереди
      const tg = 0.74, gy = topY - tg*L*Math.cos(th), gu = topU + tg*L*Math.sin(th);
      hR.scale.set(1,0.85,1);                                                // пальцы плотнее: указательный ниже скобы
      hR.position.set(0,gy,-gu).addScaledVector(axR, -0.103*0.85);                // центр хвата на оси рукояти
      g.add(hR);
      const aR = makeArm(1);
      aR.userData.wristLocal = hR.userData.wrist.clone(); aR.userData.hand = hR;
      aR.userData.camShoulder = new V(0.30,-0.62,0.02);
      g.userData.arms = [aR]; g.userData.hands = [hR]; g.userData.slide = 0; g.userData.squeeze = 0; g.userData.shoulderShift = new V();
    }
    return g;
  }

  /* ================= БЕРДАНКА (по иконке: ржавый ствол, кремовая обмотка, синяя лента, чёрные верёвки, проволочный приклад) ================= */
  function makeBerdanka(withHands){
    const g = new T.Group(); g.userData.gun = true;
    const add = m=>{ g.add(m); return m; };
    const box = (w,h,d,mat,x,y,u)=>{ const m = new T.Mesh(new T.BoxGeometry(w,h,d), mat); m.position.set(x,y,-u); return add(m); };
    const cylT = (r0,r1,len,mat,x,y,u,seg)=>{ const m = new T.Mesh(new T.CylinderGeometry(r0,r1,len,seg||18), mat); m.rotation.x = PI/2; m.position.set(x,y,-u); return add(m); };
    const sph = (r,mat,x,y,u)=>{ const m = new T.Mesh(new T.SphereGeometry(r,12,9), mat); m.position.set(x,y,-u); return add(m); };
    const P = (pts,w,mat,b)=>add(prof(pts,w,mat,b));
    const wire = (x0,y0,u0,x1,y1,u1,r,mat)=> add(tubeBetween(x0,y0,-u0,x1,y1,-u1,r||0.0038,mat||G.rustDk,8));
    const BY = 0.040;
    /* --- ствол: ржавый PBR; цевьё из обмотки с хомутами, ровное дуло с мушкой --- */
    cylT(0.0150,0.0150,0.400,G.rustB,0,BY,0.320,24);
    cylT(0.0215,0.0215,0.034,G.rustDk,0,BY,0.150,24); cylT(0.0185,0.0185,0.012,G.rustDk,0,BY,0.176,24);
    for(let i=0;i<5;i++) cylT(0.0190,0.0190,0.030,(i%2?G.clDk:G.clB),0,BY,0.205+i*0.030,24);
    cylT(0.0205,0.0205,0.010,G.rustDk,0,BY,0.192,24); cylT(0.0205,0.0205,0.010,G.rustDk,0,BY,0.358,24);
    cylT(0.0200,0.0200,0.030,G.tapeDk,0,BY,0.395,24);
    { const t1 = cylT(0.0176,0.0176,0.030,G.tapeBlue,0,BY,0.432,28); t1.rotation.x = PI/2+0.07;
      const t2 = cylT(0.0176,0.0176,0.034,G.tapeBlue,0,BY,0.471,28); t2.rotation.x = PI/2-0.07;
      box(0.012,0.0025,0.020,G.tapeBlue,0.004,BY-0.0180,0.452); }                                      // изолента на дуле + хвостик
    cylT(0.0185,0.0185,0.022,G.rustDk,0,BY,0.508,24);                                                   // дульный срез
    cylT(0.0100,0.0100,0.003,G.black,0,BY,0.5195,16);                                                   // канал ствола
    box(0.010,0.008,0.028,G.rustDk,0,BY+0.0185,0.478); box(0.004,0.020,0.005,G.rustDk,0,BY+0.030,0.480);  // мушка
    /* --- ресивер: кремовый «мягкий» блок + складки, ржавый нижний блок --- */
    P([[-0.140,0.000],[0.130,0.000],[0.130,0.068],[-0.140,0.074]], 0.054, G.rustX, 0.007);
    for(let i=0;i<4;i++){ const s = box(0.0560,0.010,0.085,G.rustDk,0,0.022+i*0.014,-0.085+i*0.060); s.rotation.x = 0.30*(i%2?1:-1); }
    box(0.0575,0.070,0.008,G.rustDk,0,0.034,0.128);                                                    // передняя кромка
    P([[-0.120,-0.068],[0.060,-0.068],[0.060,0.002],[-0.120,0.002]], 0.046, G.rustX, 0.003);
    box(0.0475,0.010,0.180,G.rustDk,0,-0.060,0.030);
    /* --- чёрные верёвки вокруг ресивера + свисающий шнур --- */
    for(const u of [0.098,0.116]){
      box(0.0580,0.0045,0.006,G.rope,0,0.0735,u); box(0.0580,0.0045,0.006,G.rope,0,-0.0015,u);
      box(0.0045,0.076,0.006,G.rope,0.0285,0.036,u); box(0.0045,0.076,0.006,G.rope,-0.0285,0.036,u);
    }
    wire(-0.0295,0.020,0.098, -0.0305,-0.060,0.088, 0.0028,G.rope); sph(0.0055,G.rope,-0.0305,-0.062,0.088);
    /* --- прицельная стойка сзади (целик) --- */
    box(0.020,0.008,0.030,G.rustDk,0,0.076,-0.050);
    box(0.0042,0.022,0.010,G.rustDk,-0.0075,0.092,-0.050); box(0.0042,0.022,0.010,G.rustDk,0.0075,0.092,-0.050);
    /* --- магазин ржавый (перед ним спуск) --- */
    /* --- спусковая скоба + спуск --- */
    { const tg = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(0,-0.066,-0.004), new T.Vector3(0,-0.092,-0.020), new T.Vector3(0,-0.094,-0.055), new T.Vector3(0,-0.070,-0.072)]), 20, 0.0036, 8), G.rustDk); add(tg); }
    box(0.008,0.028,0.007,G.black,0,-0.070,0.032).rotation.x = 0.25;
    /* --- рукоять в ткани (сзади, наклон назад) --- */
    { const gr = box(0.040,0.150,0.050,G.clB,0,-0.078,-0.148); gr.rotation.x = -0.26;
      for(let i=0;i<5;i++){ const t = 0.10+i*0.20, y = -0.002-t*0.145*Math.cos(0.26), u = -0.140 - t*0.145*Math.sin(0.26); const s = box(0.0415,0.011,0.052,G.clDk,0,y,u); s.rotation.x = -0.26 + (i%2?0.32:-0.32); }
      box(0.042,0.008,0.054,G.rustDk,0,-0.152,-0.184).rotation.x = -0.26; }
    /* --- проволочный складной приклад: штанга + А-образная рамка --- */
    for(const sx of [-1,1]){
      wire(sx*0.020,0.020,-0.135, sx*0.020,0.000,-0.215, 0.0050);
      wire(sx*0.020,0.000,-0.215, sx*0.020,-0.150,-0.200, 0.0050);
      wire(sx*0.020,0.000,-0.170, sx*0.020,-0.150,-0.200, 0.0046);
    }
    wire(-0.020,-0.150,-0.200, 0.020,-0.150,-0.200, 0.0050); wire(-0.020,0.000,-0.215, 0.020,0.000,-0.215, 0.0046);
    box(0.050,0.020,0.016,G.rustDk,0,0.014,-0.134);
    g.userData.sightCenter = new T.Vector3(0,0.098,0.050);
    bake(g);
    /* --- магазин: ржавая коробка, наклон назад (выезжает при перезарядке) --- */
    const mag = new T.Group();
    const mb = new T.Mesh(new T.BoxGeometry(0.040,0.112,0.056), G.rustB); mb.position.set(0,-0.123,0.030); mb.rotation.x = -0.14; mag.add(mb);
    const mr = new T.Mesh(new T.BoxGeometry(0.0425,0.010,0.058), G.rustDk); mr.position.set(0,-0.090,0.029); mr.rotation.x = -0.14; mag.add(mr);
    const mp = new T.Mesh(new T.BoxGeometry(0.0435,0.010,0.060), G.rustDk); mp.position.set(0,-0.180,0.044); mp.rotation.x = -0.14; mag.add(mp);
    g.add(mag); g.userData.mag = mag;
    const fl = new T.Group(); fl.position.set(0,BY,-0.54);
    for(let i=0;i<2;i++){ const q = new T.Mesh(new T.PlaneGeometry(0.15,0.15), G.flash); q.rotation.z = i*PI/4; fl.add(q); }
    fl.visible = false; g.add(fl); g.userData.flash = fl;
    if(withHands){
      const hR = makeHand(1, 0.072), hL = makeHand(-1, 0.190);
      const V = T.Vector3, qx = new T.Quaternion(), qz = new T.Quaternion();
      const tilt = -0.26, axR = new V(0, Math.cos(tilt), Math.sin(tilt));
      hR.quaternion.setFromAxisAngle(new V(1,0,0), tilt).multiply(new T.Quaternion().setFromAxisAngle(new V(0,1,0), -0.55));
      hR.position.set(0.004,-0.080,0.146).addScaledVector(axR, -(0.072+0.03));
      qx.setFromAxisAngle(new V(1,0,0), -PI/2); qz.setFromAxisAngle(new V(0,0,1), PI*0.47);
      hL.quaternion.copy(qz).multiply(qx);
      hL.position.set(-0.004,0.048,-0.29).addScaledVector(new V(0,0,-1), -(0.19+0.03));
      g.add(hR); g.add(hL);
      const aR = makeArm(1), aL = makeArm(-1);
      aR.userData.wristLocal = hR.userData.wrist.clone(); aR.userData.hand = hR;
      aL.userData.wristLocal = hL.userData.wrist.clone(); aL.userData.hand = hL;
      aR.userData.camShoulder = new V( 0.30,-0.62, 0.02); aL.userData.camShoulder = new V(-0.34,-0.55,-0.02);
      g.userData.arms = [aR, aL]; g.userData.hands = [hR, hL]; g.userData.slide = 0; g.userData.squeeze = 0; g.userData.shoulderShift = new V();
    }
    return g;
  }

  /* ================= ПИСТОЛЕТ-ПУЛЕМЁТ (компактный ресивер, кожух ствола с дульным тормозом, передняя рукоять, магазин перед спуском, складной приклад) ================= */
  function makeSMG(withHands){
    const g = new T.Group(); g.userData.gun = true;
    const add = m=>{ g.add(m); return m; };
    const box = (w,h,d,mat,x,y,u)=>{ const m = new T.Mesh(new T.BoxGeometry(w,h,d), mat); m.position.set(x,y,-u); return add(m); };
    const cyl = (r0,r1,len,mat,x,y,u,seg)=>{ const m = new T.Mesh(new T.CylinderGeometry(r0,r1,len,seg||20), mat); m.rotation.x = PI/2; m.position.set(x,y,-u); return add(m); };
    const P = (pts,w,mat,b)=>add(prof(pts,w,mat,b));
    const white = new T.MeshBasicMaterial({color:0xe8e8e4});
    const BY = 0.040;
    /* ресивер + верхний рельс + нижняя рамка */
    P([[-0.090,0.000],[-0.090,0.066],[-0.078,0.070],[0.150,0.070],[0.150,0.000]], 0.046, G.gunSl, 0.004);
    box(0.020,0.006,0.190,G.gunSlB,0,0.073,0.030);
    P([[-0.085,0.002],[0.120,0.002],[0.120,-0.024],[-0.085,-0.024]], 0.040, G.gunFr, 0.003);
    for(let i=0;i<4;i++) for(const sx of [-1,1]) box(0.0010,0.030,0.0035,G.black, sx*0.0232,0.040,-0.072+i*0.010);   // насечки затвора
    box(0.0010,0.014,0.040,G.black,0.0232,0.056,0.070);                                                           // окно выброса
    /* кожух ствола с прорезями, ствол и дульный тормоз */
    cyl(0.0225,0.0225,0.130,G.gunFr,0,BY,0.215,24);
    for(let i=0;i<4;i++) cyl(0.0236,0.0236,0.006,G.gunSlB,0,BY,0.180+i*0.022,24);
    cyl(0.0088,0.0088,0.070,G.gunFrB,0,BY,0.310,18);
    cyl(0.0140,0.0140,0.030,G.gunSlB,0,BY,0.338,20); cyl(0.0058,0.0058,0.004,G.black,0,BY,0.3545,14);
    for(let i=0;i<3;i++) box(0.0300,0.0022,0.0040,G.black,0,BY+0.0135,0.330+i*0.008);
    /* прицел: целик с белыми точками и мушка */
    box(0.0040,0.014,0.008,G.black,-0.0085,0.081,-0.060); box(0.0040,0.014,0.008,G.black,0.0085,0.081,-0.060);
    box(0.0015,0.004,0.0015,white,-0.0085,0.089,-0.060); box(0.0015,0.004,0.0015,white,0.0085,0.089,-0.060);
    box(0.0050,0.020,0.008,G.black,0,0.072,0.270); box(0.0015,0.0015,0.0015,white,0,0.0825,0.270);
    /* спусковая скоба + спуск */
    { const cv = new T.CatmullRomCurve3([new T.Vector3(0,-0.024,0.055), new T.Vector3(0,-0.046,0.045), new T.Vector3(0,-0.050,-0.005), new T.Vector3(0,-0.032,-0.030), new T.Vector3(0,-0.024,-0.032)]);
      add(new T.Mesh(new T.TubeGeometry(cv, 18, 0.0038, 8), G.gunFrB)); }
    box(0.006,0.022,0.006,G.black,0,-0.034,-0.002).rotation.x = 0.25;
    /* пистолетная рукоять (наклон назад, рёбра) */
    { const gr = box(0.034,0.110,0.042,G.gunGrip,0,-0.073,-0.099); gr.rotation.x = -0.26;
      for(let i=0;i<5;i++){ const t = 0.10+i*0.19, y = -0.020-t*0.110*Math.cos(0.26), u = -0.085 - t*0.110*Math.sin(0.26); const r = box(0.0350,0.008,0.044,G.gunGripDk,0,y,u); r.rotation.x = -0.26 + (i%2?0.25:-0.25); }
      box(0.036,0.008,0.046,G.gunFrB,0,-0.128,-0.113).rotation.x = -0.26; }
    /* передняя рукоять под кожухом */
    box(0.026,0.072,0.030,G.gunGrip,0,-0.020,0.185);
    for(let i=0;i<3;i++) box(0.0275,0.006,0.032,G.gunGripDk,0,-0.002-i*0.020,0.185);
    /* складной приклад: две штанги и затылок */
    const rod = (x0,y0,u0,x1,y1,u1,r)=> add(tubeBetween(x0,y0,-u0,x1,y1,-u1,r,G.gunSlB,8));
    for(const sx of [-1,1]) rod(sx*0.016,0.044,-0.090, sx*0.016,0.034,-0.245, 0.0042);
    box(0.040,0.090,0.012,G.gunGrip,0,0.000,-0.250); box(0.042,0.008,0.014,G.gunGripDk,0,0.042,-0.250);
    g.userData.sightCenter = new T.Vector3(0,0.090,0.050);
    bake(g);
    /* магазин: изогнутая вперёд коробка (выезжает при перезарядке) */
    const mag = new T.Group(); mag.position.set(0,0,0);
    const mb = new T.Mesh(new T.BoxGeometry(0.028,0.132,0.040), G.gunSlB); mb.position.set(0,-0.088,-0.066); mb.rotation.x = 0.20; mag.add(mb);
    for(let i=0;i<4;i++){ const r = new T.Mesh(new T.BoxGeometry(0.0295,0.006,0.042), G.gunFrB); r.position.set(0,-0.045-i*0.028,-0.058-i*0.011); r.rotation.x = 0.20; mag.add(r); }
    const mp = new T.Mesh(new T.BoxGeometry(0.031,0.008,0.044), G.gunFr); mp.position.set(0,-0.154,-0.0955); mp.rotation.x = 0.20; mag.add(mp);
    g.add(mag); g.userData.mag = mag;
    const fl = new T.Group(); fl.position.set(0,BY,-0.375);
    for(let i=0;i<2;i++){ const q = new T.Mesh(new T.PlaneGeometry(0.13,0.13), G.flash); q.rotation.z = i*PI/4; fl.add(q); }
    fl.visible = false; g.add(fl); g.userData.flash = fl;
    if(withHands){
      const hR = makeHand(1, 0.072), hL = makeHand(-1, 0.072), V = T.Vector3;
      const tilt = -0.26, axR = new V(0, Math.cos(tilt), Math.sin(tilt));
      hR.quaternion.setFromAxisAngle(new V(1,0,0), tilt).multiply(new T.Quaternion().setFromAxisAngle(new V(0,1,0), -0.55));
      hR.position.set(0,-0.073,0.099).addScaledVector(axR, -0.103);
      hL.quaternion.setFromAxisAngle(new V(0,1,0), 0.55);                      // левая ладонь обхватывает переднюю рукоять
      hL.position.set(0,-0.020,-0.185).addScaledVector(new V(0,1,0), -0.103);
      g.add(hR); g.add(hL);
      const aR = makeArm(1), aL = makeArm(-1);
      aR.userData.wristLocal = hR.userData.wrist.clone(); aR.userData.hand = hR;
      aL.userData.wristLocal = hL.userData.wrist.clone(); aL.userData.hand = hL;
      aR.userData.camShoulder = new V( 0.30,-0.62, 0.02); aL.userData.camShoulder = new V(-0.34,-0.55,-0.02);
      g.userData.arms = [aR, aL]; g.userData.hands = [hR, hL]; g.userData.slide = 0; g.userData.squeeze = 0; g.userData.shoulderShift = new V();
    }
    return g;
  }

  /* ================= РПГ (ракетница): труба с раструбом, прицел, две рукояти, ракета в стволе; обе руки на рукоятях ================= */
  function makeRPG(withHands){
    const g = new T.Group(), V = T.Vector3, PI2 = Math.PI/2;
    const MS = (c,r,m)=> new T.MeshStandardMaterial({color:c, roughness:r, metalness:m});
    const olive = MS(0x4d5340,0.55,0.55), dark = MS(0x24262a,0.5,0.75), steel = MS(0x6b6f74,0.4,0.8), wood = MS(0x6a4829,0.8,0.05), warm = MS(0x7a4a2c,0.55,0.5), rub = MS(0x1c1c1c,0.9,0.1);
    const TY = 0.05;                                                   // ось трубы
    const cyl = (rt,rb,len,mat,z,y,seg)=>{ const o = new T.Mesh(new T.CylinderGeometry(rt,rb,len,seg||24), mat); o.rotation.x = PI2; o.position.set(0,y===undefined?TY:y,z); g.add(o); return o; };
    cyl(0.052,0.052,0.78,olive,-0.20);                                 // основная труба
    cyl(0.062,0.062,0.14,dark,-0.55);                                  // передний хомут
    cyl(0.064,0.064,0.12,dark,0.02);                                   // средний хомут
    const tr = new T.Mesh(new T.CylinderGeometry(0.052,0.085,0.17,24,1,true), dark); tr.rotation.x = PI2; tr.position.set(0,TY,0.275); tr.material.side = T.DoubleSide; g.add(tr);   // задний раструб
    cyl(0.088,0.088,0.012,steel,0.36);                                 // кромка раструба
    [-0.34,-0.08].forEach(z=> cyl(0.0545,0.0545,0.02,steel,z));        // кольца
    // ракета в стволе: боевая часть торчит спереди
    const rk = new T.Group(); rk.position.set(0,TY,0);
    const rb = new T.Mesh(new T.CylinderGeometry(0.043,0.043,0.14,18), warm); rb.rotation.x = PI2; rb.position.z = -0.455; rk.add(rb);
    const rn = new T.Mesh(new T.ConeGeometry(0.044,0.15,18), steel); rn.rotation.x = -PI2; rn.position.z = -0.605; rk.add(rn);
    const rt = new T.Mesh(new T.CylinderGeometry(0.0475,0.0475,0.04,18), dark); rt.rotation.x = PI2; rt.position.z = -0.54; rk.add(rt);
    g.add(rk); g.userData.rocket = rk;
    // прицел и мушка
    const sBase = new T.Mesh(new T.BoxGeometry(0.03,0.026,0.2), dark); sBase.position.set(-0.058,TY+0.058,-0.12); g.add(sBase);
    const sTube = new T.Mesh(new T.CylinderGeometry(0.014,0.014,0.17,12), dark); sTube.rotation.x = PI2; sTube.position.set(-0.058,TY+0.088,-0.12); g.add(sTube);
    const sLens = new T.Mesh(new T.CircleGeometry(0.012,12), MS(0x3a7fb5,0.1,0.6)); sLens.position.set(-0.058,TY+0.088,-0.037); g.add(sLens);
    const post = new T.Mesh(new T.BoxGeometry(0.008,0.04,0.008), dark); post.position.set(0,TY+0.07,-0.47); g.add(post);
    // защита щёк: деревянные накладки под трубой
    const shield = new T.Mesh(new T.BoxGeometry(0.095,0.03,0.42), wood); shield.position.set(0,TY-0.056,-0.11); g.add(shield);
    // спусковая коробка
    const box = new T.Mesh(new T.BoxGeometry(0.05,0.05,0.12), dark); box.position.set(0,TY-0.065,0.08); g.add(box);
    const trig = new T.Mesh(new T.BoxGeometry(0.008,0.04,0.012), steel); trig.position.set(0,TY-0.1,0.045); trig.rotation.x = 0.3; g.add(trig);
    const guard = new T.Mesh(new T.TorusGeometry(0.03,0.004,8,16,Math.PI), steel); guard.rotation.set(0,PI2,0); guard.position.set(0,TY-0.088,0.07); g.add(guard);
    // рукояти (ось совпадает с хватом рук)
    const tilt = -0.26, axR = new V(0, Math.cos(tilt), Math.sin(tilt));
    const gripR = new T.Mesh(new T.CylinderGeometry(0.0235,0.026,0.15,16), rub); gripR.quaternion.setFromAxisAngle(new V(1,0,0), tilt);
    const hRp = new V(0,-0.073,0.099).addScaledVector(axR,-0.103).add(new V(0,TY-0.03,0.0));
    gripR.position.copy(hRp).addScaledVector(axR,0.10); g.add(gripR);
    const hLp = new V(0,-0.020,-0.185).add(new V(0,-0.103,0)).add(new V(0,TY-0.03,0.0));
    const gripL = new T.Mesh(new T.CylinderGeometry(0.0235,0.0235,0.15,16), rub); gripL.position.copy(hLp).add(new V(0,0.10,0)); g.add(gripL);
    const fgm = new T.Mesh(new T.BoxGeometry(0.045,0.02,0.07), dark); fgm.position.set(0,TY-0.058,-0.185); g.add(fgm);
    // --- детали: рёбра хомутов, передний раструб, планка, окуляр, плечевой упор, ремень, маркировка ---
    const rib = MS(0x33362e,0.7,0.4), brass = MS(0xb08a3a,0.35,0.85), red = MS(0x9a2a22,0.6,0.3);
    for(let i=0;i<5;i++) cyl(0.0575,0.0575,0.012,rib,-0.42+i*0.06,undefined,20);               // рёбра теплозащиты
    const fcone = new T.Mesh(new T.CylinderGeometry(0.052,0.068,0.07,24,1,true), dark); fcone.rotation.x = PI2; fcone.position.set(0,TY,-0.60); fcone.material.side = T.DoubleSide; g.add(fcone);   // дульный раструб
    cyl(0.07,0.07,0.01,steel,-0.635,undefined,24);
    const rail = new T.Mesh(new T.BoxGeometry(0.018,0.01,0.34), dark); rail.position.set(0,TY+0.056,-0.12); g.add(rail);
    for(let i=0;i<9;i++){ const nt = new T.Mesh(new T.BoxGeometry(0.022,0.004,0.008), steel); nt.position.set(0,TY+0.063,-0.27+i*0.04); g.add(nt); }
    const eye = new T.Mesh(new T.CylinderGeometry(0.019,0.016,0.03,14), rub); eye.rotation.x = PI2; eye.position.set(-0.058,TY+0.088,-0.02); g.add(eye);        // резиновый окуляр
    const obj = new T.Mesh(new T.CylinderGeometry(0.018,0.018,0.018,14), dark); obj.rotation.x = PI2; obj.position.set(-0.058,TY+0.088,-0.215); g.add(obj);    // объектив
    const olens = new T.Mesh(new T.CircleGeometry(0.0145,14), MS(0x3a7fb5,0.08,0.7)); olens.rotation.y = Math.PI; olens.position.set(-0.058,TY+0.088,-0.2245); olens.rotation.y = 0; g.add(olens);
    const pad = new T.Mesh(new T.BoxGeometry(0.07,0.07,0.03), rub); pad.position.set(0,TY-0.03,0.2); g.add(pad);                                          // упор
    const knob = new T.Mesh(new T.CylinderGeometry(0.012,0.012,0.03,10), brass); knob.rotation.z = PI2; knob.position.set(0.066,TY+0.012,0.0); g.add(knob);     // взводная рукоять
    [-0.46,0.12].forEach(z=>{ const ring = new T.Mesh(new T.TorusGeometry(0.014,0.0035,8,14), steel); ring.position.set(-0.062,TY-0.015,z); ring.rotation.y = PI2; g.add(ring); });   // антабки
    const band = new T.Mesh(new T.CylinderGeometry(0.0535,0.0535,0.03,24), red); band.rotation.x = PI2; band.position.set(0,TY,-0.50); g.add(band);       // красная метка
    const warn = new T.Mesh(new T.BoxGeometry(0.002,0.03,0.07), MS(0xe0c030,0.5,0.1)); warn.position.set(0.0525,TY,-0.20); g.add(warn);
    // оперение ракеты (в стволе видна ступенька)
    const fin = new T.Mesh(new T.CylinderGeometry(0.0475,0.0475,0.012,18), brass); fin.rotation.x = PI2; fin.position.set(0,0,-0.49); rk.add(fin);
    // точка прицеливания для режима ADS (окуляр оптики)
    g.userData.sightCenter = new V(-0.058,TY+0.088,-0.037);
    const fl = new T.Group(); fl.position.set(0,TY,0.42);               // задний выхлоп
    for(let i=0;i<2;i++){ const q = new T.Mesh(new T.PlaneGeometry(0.28,0.28), G.flash); q.rotation.z = i*PI/4; q.rotation.y = Math.PI; fl.add(q); }
    fl.visible = false; g.add(fl); g.userData.flash = fl;
    if(withHands){
      const hR = makeHand(1, 0.072), hL = makeHand(-1, 0.072);
      hR.quaternion.setFromAxisAngle(new V(1,0,0), tilt).multiply(new T.Quaternion().setFromAxisAngle(new V(0,1,0), -0.55));
      hR.position.copy(hRp);
      hL.quaternion.setFromAxisAngle(new V(0,1,0), 0.55);
      hL.position.copy(hLp);
      g.add(hR); g.add(hL);
      const aR = makeArm(1), aL = makeArm(-1);
      aR.userData.wristLocal = hR.userData.wrist.clone(); aR.userData.hand = hR;
      aL.userData.wristLocal = hL.userData.wrist.clone(); aL.userData.hand = hL;
      aR.userData.camShoulder = new V( 0.30,-0.62, 0.02); aL.userData.camShoulder = new V(-0.34,-0.55,-0.02);
      g.userData.arms = [aR, aL]; g.userData.hands = [hR, hL]; g.userData.gun = true; g.userData.slide = 0; g.userData.squeeze = 0; g.userData.shoulderShift = new V();
    }
    return g;
  }

  /* ================= САТЧЕЛ-ЗАРЯД (по скриншоту: брезентовый ящик цвета хаки, коричневые ремни с пряжками, три медные банки с верёвочными петлями, деревянный вороток; в руках держится за боковые кожаные ручки двумя руками) ================= */

  /* ---- Голографический прицел (EOTech-типа): камуфляжный корпус, два окна-рамки, крепление на планку, голограмма-сетка ---- */
  function makeHoloSight(){
    const g = new T.Group(); g.name = 'holo';
    /* процедурный камуфляж: олива, коричневый, чёрный, охра + потёртости */
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
    c.fillStyle = '#4b5a37'; c.fillRect(0,0,256,256);
    let sd = 11; const rnd = ()=>{ sd = (sd*16807)%2147483647; return sd/2147483647; };
    [['#36301f',26],['#1c1d19',18],['#7b6a44',16],['#3d4a2c',22]].forEach(p=>{
      c.fillStyle = p[0];
      for(let i=0;i<p[1];i++){ const x = rnd()*256, y = rnd()*256, r = 12+rnd()*26; c.beginPath();
        c.ellipse(x,y,r*(0.8+rnd()*0.9),r*(0.5+rnd()*0.6),rnd()*3,0,6.283); c.fill(); }
    });
    c.fillStyle = 'rgba(200,190,150,.35)';
    for(let i=0;i<70;i++){ c.fillRect(rnd()*256, rnd()*256, 1+rnd()*5, 1); }
    c.fillStyle = 'rgba(10,10,8,.55)';
    for(let i=0;i<50;i++){ c.fillRect(rnd()*256, rnd()*256, 1, 1+rnd()*4); }
    const camoTex = new T.CanvasTexture(cv); camoTex.wrapS = camoTex.wrapT = T.RepeatWrapping; camoTex.anisotropy = 4;
    const env = G.steelB ? G.steelB.envMap : null;
    const camo = new T.MeshStandardMaterial({map:camoTex, roughness:0.62, metalness:0.22, envMap:env, envMapIntensity:0.55});
    const blk  = new T.MeshStandardMaterial({color:0x17181a, roughness:0.48, metalness:0.65, envMap:env, envMapIntensity:0.8});
    const blk2 = new T.MeshStandardMaterial({color:0x2a2b2d, roughness:0.4,  metalness:0.75, envMap:env, envMapIntensity:0.9});
    const rub  = new T.MeshStandardMaterial({color:0x0d0d0e, roughness:0.95, metalness:0.0});
    const glassM = new T.MeshStandardMaterial({color:0x6fa9b8, roughness:0.05, metalness:0.0, transparent:true, opacity:0.13, envMap:env, envMapIntensity:1.4, depthWrite:false, side:T.DoubleSide});
    const add = (m,par)=>{ (par||g).add(m); return m; };
    const box = (w,h,d,mat,x,y,z,par)=>{ const m = new T.Mesh(new T.BoxGeometry(w,h,d),mat); m.position.set(x,y,z); return add(m,par); };
    const cyl = (r,len,mat,x,y,z,axis,seg,par)=>{ const m = new T.Mesh(new T.CylinderGeometry(r,r,len,seg||14),mat); if(axis==='x') m.rotation.z = PI/2; else if(axis==='z') m.rotation.x = PI/2; m.position.set(x,y,z); return add(m,par); };
    const rr = (sh,x,y,w,h,r)=>{ sh.moveTo(x+r,y); sh.lineTo(x+w-r,y); sh.quadraticCurveTo(x+w,y,x+w,y+r); sh.lineTo(x+w,y+h-r); sh.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
      sh.lineTo(x+r,y+h); sh.quadraticCurveTo(x,y+h,x,y+h-r); sh.lineTo(x,y+r); sh.quadraticCurveTo(x,y,x+r,y); };
    const ring = (ow,oh,iw,ih,depth,mat,z,y)=>{
      const sh = new T.Shape(); rr(sh,-ow/2,-oh/2,ow,oh,0.006);
      const hole = new T.Path(); rr(hole,-iw/2,-ih/2,iw,ih,0.004); sh.holes.push(hole);
      const geo = new T.ExtrudeGeometry(sh,{depth:depth-0.002, bevelEnabled:true, bevelThickness:0.001, bevelSize:0.001, bevelSegments:2, curveSegments:5});
      geo.translate(0,0,-(depth-0.002)/2);
      const m = new T.Mesh(geo,mat); m.position.set(0,y,z); return add(m);
    };

    /* --- крепление на планку Пикатинни: основание, зажимной рычаг, болты, поперечные упоры --- */
    box(0.050,0.010,0.078,blk,0,0.005,0.0);
    box(0.054,0.004,0.070,blk2,0,0.0105,0.0);
    box(0.012,0.004,0.014,blk2,0,-0.002,-0.018); box(0.012,0.004,0.014,blk2,0,-0.002,0.018);       // упоры в паз планки
    cyl(0.0042,0.012,blk2,0.030,0.008,0.008,'x',12);                                              // болт зажима
    box(0.007,0.016,0.028,blk2,0.0355,0.010,0.008);                                               // рычаг зажима (рифлёный)
    for(let i=0;i<5;i++) box(0.0075,0.017,0.0016,blk,0.0357,0.010,-0.002+i*0.0050);
    cyl(0.0042,0.010,blk2,-0.029,0.008,0.008,'x',12);

    /* --- корпус: нижний блок с уклоном вперёд (камуфляж) --- */
    const body = prof2([[0.052,0.010],[0.052,0.018],[0.040,0.020],[-0.046,0.020],[-0.052,0.018],[-0.052,0.010]],0.046,camo);
    add(body);
    /* боковые стенки окон (цельные, как у оригинала) */
    box(0.0045,0.046,0.084,camo,-0.0248,0.043,-0.002); box(0.0045,0.046,0.084,camo,0.0248,0.043,-0.002);
    /* верхняя крышка с рёбрами и винтами */
    box(0.050,0.0055,0.108,camo,0,0.0672,0.0);
    box(0.050,0.003,0.030,blk,0,0.0704,0.030);   // козырёк-выступ сверху сзади
    for(let i=0;i<4;i++) box(0.0345,0.0022,0.0035,blk,0,0.0705,-0.030+i*0.0075);
    cyl(0.0032,0.003,blk2,-0.016,0.0708,0.038,'y',10); cyl(0.0032,0.003,blk2,0.016,0.0708,0.038,'y',10);

    /* --- рамки окон: задняя (у глаза) выше и глубже, передняя короче --- */
    ring(0.054,0.054,0.040,0.038,0.016,camo,0.048,0.0405);        // задняя
    ring(0.056,0.056,0.042,0.040,0.0055,rub,0.0585,0.0405);       // резиновый наглазник
    ring(0.052,0.050,0.040,0.038,0.012,camo,-0.048,0.0405);       // передняя
    ring(0.054,0.052,0.042,0.040,0.004,blk,-0.0565,0.0405);       // кант вокруг переднего окна

    /* --- стёкла с лёгким голубым отливом покрытия --- */
    const gl1 = new T.Mesh(new T.PlaneGeometry(0.040,0.038), glassM); gl1.position.set(0,0.0405,0.0475); gl1.rotation.y = PI; add(gl1);
    const gl2 = new T.Mesh(new T.PlaneGeometry(0.040,0.038), glassM); gl2.position.set(0,0.0405,-0.0475); add(gl2);

    /* --- боковая электроника: крышка батареи, две кнопки, рифлёная шайба --- */
    cyl(0.0088,0.006,blk2,0.0285,0.034,0.014,'x',18);
    box(0.0016,0.0015,0.012,blk,0.0316,0.034,0.014);                                               // шлиц крышки
    box(0.004,0.008,0.012,blk,-0.0268,0.040,0.004); box(0.004,0.008,0.012,blk,-0.0268,0.040,-0.012); // кнопки +/-
    box(0.0016,0.011,0.016,blk2,-0.0262,0.029,0.010);                                              // лейбл-пластина

    /* --- голограмма: кольцо, точка, 4 риски (красная, не пропадает за стеклом) --- */
    const red = new T.MeshBasicMaterial({color:0xff2424, transparent:true, opacity:0.95, depthWrite:false, toneMapped:false, side:T.DoubleSide});
    const ret = new T.Group(); ret.name = 'reticle'; ret.position.set(0,0.0405,0.0);
    const rg = new T.Mesh(new T.RingGeometry(0.0108,0.0120,56), red); ret.add(rg);
    const dot = new T.Mesh(new T.CircleGeometry(0.00085,14), red); ret.add(dot);
    [[0,0.0135,0.0014,0.0030],[0,-0.0135,0.0014,0.0030],[0.0135,0,0.0030,0.0014],[-0.0135,0,0.0030,0.0014]].forEach(a=>{
      const m = new T.Mesh(new T.PlaneGeometry(a[2],a[3]), red); m.position.set(a[0],a[1],0); ret.add(m); });
    ret.renderOrder = 12; ret.traverse(o=>{ o.renderOrder = 12; });
    add(ret);

    g.traverse(o=>{ o.frustumCulled = false; });
    g.userData.windowCenter = new T.Vector3(0,0.0405,0.0);   // центр окна/сетки в системе прицела
    g.userData.length = 0.112;
    return g;
  }
  /* профиль (u вперёд, y вверх) → экструзия по ширине */
  function prof2(pts, w, mat){
    const sh = new T.Shape(); sh.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) sh.lineTo(pts[i][0],pts[i][1]); sh.closePath();
    const geo = new T.ExtrudeGeometry(sh,{depth:w-0.002, bevelEnabled:true, bevelThickness:0.001, bevelSize:0.001, bevelSegments:1, curveSegments:4});
    geo.applyMatrix4(new T.Matrix4().set(0,0,1,-(w-0.002)/2, 0,1,0,0, -1,0,0,0, 0,0,0,1));
    return new T.Mesh(geo, mat);
  }
  function makeSatchel(withHands){
    const g = new T.Group(); g.userData.satchel = true;
    if(!G.leather){
      G.leather = new T.MeshStandardMaterial({color:0x4a2d1a, roughness:0.72, metalness:0.0});
      G.woodS   = new T.MeshStandardMaterial({color:0xb48a55, roughness:0.82, metalness:0.0});
      G.ropeBr  = new T.MeshStandardMaterial({color:0x7a5530, roughness:0.95, metalness:0.0});
    }
    const add = m=>{ g.add(m); return m; };
    const box = (w,h,d,mat,x,y,z)=>{ const m = new T.Mesh(new T.BoxGeometry(w,h,d), mat); m.position.set(x,y,z); return add(m); };
    const cylY = (r0,r1,h,mat,x,y,z,seg)=>{ const m = new T.Mesh(new T.CylinderGeometry(r0,r1,h,seg||20), mat); m.position.set(x,y,z); return add(m); };
    /* корпус: тёмный низ + светлая крышка с кантом */
    box(0.240,0.062,0.170,G.oliveDk,0,-0.035,0);
    box(0.246,0.030,0.176,G.olive,0,0.011,0);
    box(0.232,0.004,0.162,G.creamB,0,0.0275,0);
    for(const sx of [-1,1]) box(0.004,0.026,0.168,G.leather,sx*0.121,0.011,0);          // боковые кантовые планки
    box(0.244,0.026,0.004,G.leather,0,0.011,0.0875); box(0.244,0.026,0.004,G.leather,0,0.011,-0.0875);
    /* ремни: по крышке и вниз по лицевой стороне, пряжки */
    for(const x of [-0.060,0.060]){
      box(0.024,0.0046,0.176,G.leather,x,0.0305,0);
      box(0.024,0.094,0.0046,G.leather,x,-0.010,0.0895);
      box(0.020,0.016,0.008,G.bronze,x,-0.050,0.092);
      box(0.014,0.010,0.010,G.gunFrB,x,-0.050,0.094);
    }
    box(0.244,0.010,0.004,G.leather,0,-0.052,0.0875);                                   // нижний пояс
    /* деревянный вороток на лицевой стороне */
    box(0.052,0.030,0.018,G.woodS,0,0.000,0.098);
    for(const x of [-0.011,0.011]) box(0.008,0.072,0.012,G.woodS,x,-0.046,0.096);
    /* три медные банки с обручами, крышками и верёвочными петлями */
    const cans = [[-0.078,-0.012],[0.000,-0.034],[0.078,-0.008]];
    cans.forEach((c,i)=>{
      const x = c[0], z = c[1], y0 = 0.0295, h = 0.060;
      cylY(0.0315,0.0325,h,G.bronze,x,y0+h/2,z,24);
      for(const yy of [y0+0.004, y0+h-0.004]){ const t = new T.Mesh(new T.TorusGeometry(0.0325,0.0033,8,24), G.gunSlB); t.rotation.x = PI/2; t.position.set(x,yy,z); add(t); }
      const t2 = new T.Mesh(new T.TorusGeometry(0.0325,0.0020,6,24), G.gunFrB); t2.rotation.x = PI/2; t2.position.set(x,y0+h*0.5,z); add(t2);
      cylY(0.0275,0.0275,0.006,G.gunSl,x,y0+h+0.002,z,24);
      cylY(0.0060,0.0060,0.010,G.gunFrB,x,y0+h+0.008,z,10);
      const loop = new T.Mesh(new T.TorusGeometry(0.019,0.0034,6,14,PI), G.ropeBr); loop.position.set(x,y0+h+0.004,z); loop.rotation.set(0,i===1?PI/2:0.4,0); add(loop);
    });
    /* боковые кожаные ручки (за них держат две руки) */
    for(const sx of [-1,1]){
      const hx = sx*0.156;
      cylY(0.0115,0.0115,0.090,G.leather,hx,0.000,0,14);
      for(const yy of [-0.038,0.038]) box(0.046,0.012,0.030,G.leather,sx*0.138,yy,0);
    }
    bake(g);
    g.userData.flashMats = null;
    if(withHands){
      const hR = makeHand(1, 0.072), hL = makeHand(-1, 0.072), V = T.Vector3;
      hR.position.set( 0.156,-0.103,0.002); hL.position.set(-0.156,-0.103,0.002);
      g.add(hR); g.add(hL);
      const aR = makeArm(1), aL = makeArm(-1);
      aR.userData.wristLocal = hR.userData.wrist.clone(); aR.userData.hand = hR;
      aL.userData.wristLocal = hL.userData.wrist.clone(); aL.userData.hand = hL;
      aR.userData.camShoulder = new V( 0.34,-0.60, 0.04); aL.userData.camShoulder = new V(-0.34,-0.60, 0.04);
      g.userData.arms = [aR, aL]; g.userData.hands = [hR, hL]; g.userData.gun = true; g.userData.slide = 0; g.userData.squeeze = 0; g.userData.shoulderShift = new V();
    }
    return g;
  }

  function makePickaxe(){
    const g = new T.Group(), len = 0.60;
    g.add(makeHandle(len));
    const head = makeHead(); head.rotation.y = 1.82; head.position.y = len - 0.030; g.add(head);   // головка развёрнута к направлению взгляда
    addHands(g);
    g.traverse(o=>{ if(o.isMesh){ o.castShadow = false; o.receiveShadow = false; } });
    return g;
  }


  /* ---------------- Топор: кованая головка с проушиной, бородатое лезвие, обух ---------------- */
  function makeAxeHead(){
    const sh = new T.Shape();
    sh.moveTo(-0.058,-0.030); sh.lineTo(-0.062,0.000); sh.lineTo(-0.058,0.030);
    sh.lineTo(-0.020,0.036); sh.lineTo(0.030,0.034);
    sh.bezierCurveTo(0.075,0.042, 0.125,0.078, 0.168,0.098);
    sh.quadraticCurveTo(0.192,0.000, 0.163,-0.122);
    sh.bezierCurveTo(0.125,-0.082, 0.075,-0.048, 0.030,-0.036);
    sh.lineTo(-0.020,-0.036); sh.closePath();
    const depth = 0.032;
    const geo = new T.ExtrudeGeometry(sh, {depth, steps:1, bevelEnabled:true, bevelThickness:0.005, bevelSize:0.003, bevelSegments:4, curveSegments:14});
    geo.translate(0,0,-depth/2);
    const pos = geo.attributes.position;
    for(let i=0;i<pos.count;i++){                       // клин: толщина плавно уходит в остриё
      const x = pos.getX(i), k = Math.max(0,Math.min(1,(x-0.02)/0.15)), w = k*k*(3-2*k);
      pos.setZ(i, pos.getZ(i) * (1 - 0.88*w));
    }
    geo.computeVertexNormals();
    const g = new T.Group();
    g.add(new T.Mesh(geo, M.metal));
    const eye = new T.Mesh(new T.CylinderGeometry(0.031,0.034,0.098,28), M.dark);      // проушина
    g.add(eye);
    for(const yy of [-0.049, 0.049]){
      const ring = new T.Mesh(new T.TorusGeometry(0.0325,0.005,8,26), M.metal);
      ring.rotation.x = Math.PI/2; ring.position.y = yy; g.add(ring);
    }
    const top = new T.Mesh(new T.CylinderGeometry(0.0205,0.0235,0.03,20), M.wood);
    top.position.y = 0.062; g.add(top);
    const wedge = new T.Mesh(new T.BoxGeometry(0.030,0.012,0.006), M.dark);
    wedge.position.y = 0.078; g.add(wedge);
    for(const sz of [-1,1]){
      const rv = new T.Mesh(new T.SphereGeometry(0.0055,10,8), M.dark);
      rv.scale.set(1,1,0.55); rv.position.set(-0.040, 0, sz*0.0185); g.add(rv);
    }
    return bake(g);
  }
  function makeAxe(){
    const g = new T.Group(), len = 0.62;
    g.add(makeHandle(len));
    const head = makeAxeHead(); head.rotation.y = 1.99; head.position.y = len - 0.052; g.add(head);   // лезвие смотрит вперёд, от игрока
    addHands(g);
    g.traverse(o=>{ if(o.isMesh){ o.castShadow = false; o.receiveShadow = false; } });
    return g;
  }

  /* ---------------- Копьё: длинное древко, обмотка под ладони, листовидный наконечник ---------------- */
  function makeSpear(){
    const g = new T.Group();
    const shaft = new T.Mesh(new T.CylinderGeometry(0.0195,0.0225,1.45,16), M.wood);
    shaft.position.y = 0.275; g.add(shaft);
    const cap = new T.Mesh(new T.CircleGeometry(0.0225,16), M.end);
    cap.rotation.x = Math.PI/2; cap.position.y = -0.4501; g.add(cap);
    const wrap = new T.Mesh(new T.CylinderGeometry(0.0258,0.0258,0.27,24,1,true), M.rope);
    wrap.position.y = 0.185; g.add(wrap);
    const sock = new T.Mesh(new T.CylinderGeometry(0.026,0.021,0.10,16), M.dark);
    sock.position.y = 0.73; g.add(sock);
    const sh = new T.Shape();
    sh.moveTo(0,0); sh.bezierCurveTo(0.052,0.05, 0.048,0.17, 0,0.31);
    sh.bezierCurveTo(-0.048,0.17, -0.052,0.05, 0,0);
    const geo = new T.ExtrudeGeometry(sh, {depth:0.010, steps:1, bevelEnabled:true, bevelThickness:0.004, bevelSize:0.003, bevelSegments:2, curveSegments:12});
    geo.translate(0,0,-0.005);
    const blade = new T.Mesh(geo, M.metal); blade.position.y = 0.76; g.add(blade);
    addHands(g);
    g.traverse(o=>{ if(o.isMesh){ o.castShadow = false; o.receiveShadow = false; } });
    return g;
  }

  /* ---------------- Боевой нож: чёрная рукоять с рёбрами, гарда с кольцом, клинок с пилой и отверстием ---------------- */
  function makeKnife(){
    const g = new T.Group(), gl = 0.138;
    const gp = [new T.Vector2(0.0001,-0.016), new T.Vector2(0.0300,-0.016), new T.Vector2(0.0320,-0.010), new T.Vector2(0.0300,0.000)];
    for(let i=0;i<=60;i++){ const y = 0.004 + (gl-0.004)*i/60; gp.push(new T.Vector2(0.0262 + 0.0018*Math.sin(PI*y/gl) + 0.0013*Math.max(0, Math.sin(y*270)), y)); }
    gp.push(new T.Vector2(0.0292, gl+0.002)); gp.push(new T.Vector2(0.0001, gl+0.002));
    g.add(new T.Mesh(new T.LatheGeometry(gp, 28), M.rubber));
    const bl = new T.Group(); bl.rotation.y = -PI/2; g.add(bl);   // клинок, гарда и кольцо повёрнуты плашмя к камере, кольцо смотрит в сторону центра
    const guard = new T.Mesh(new T.BoxGeometry(0.015,0.016,0.070), M.dark); guard.position.set(0,gl+0.010,0); bl.add(guard);
    const ring = new T.Mesh(new T.TorusGeometry(0.0165,0.0034,8,22), M.dark); ring.rotation.y = PI/2; ring.position.set(0,gl+0.012,0.050); bl.add(ring);
    const sb = -0.011, eb = 0.023, L = 0.215, s = new T.Shape();
    s.moveTo(sb,0); s.lineTo(sb,0.03);
    for(let i=0;i<7;i++){ const y0 = 0.03 + i*0.0135; s.lineTo(sb-0.0048,y0+0.0015); s.lineTo(sb,y0+0.0135); }
    s.lineTo(sb,0.152); s.quadraticCurveTo(-0.003,0.19, 0.004,L);
    s.bezierCurveTo(0.021,0.195, 0.026,0.10, eb,0.0); s.lineTo(sb,0);
    const hole = new T.Path(); hole.absellipse(0.006,0.168,0.0034,0.0075,0,PI*2,false,0); s.holes.push(hole);
    const geo = new T.ExtrudeGeometry(s, {depth:0.0046, steps:1, bevelEnabled:true, bevelThickness:0.0007, bevelSize:0.0007, bevelSegments:1, curveSegments:14});
    geo.translate(0,0,-0.0023); geo.rotateY(PI/2);
    const blade = new T.Mesh(geo, M.metal); blade.position.y = gl+0.018; bl.add(blade);
    const fuller = new T.Mesh(new T.BoxGeometry(0.0054,0.115,0.0042), M.dark); fuller.position.set(0,gl+0.018+0.105,-0.0035); bl.add(fuller);
    const hR = makeHand(1, 0.072); g.add(hR);
    const aR = makeArm(1); aR.userData.wristLocal = hR.userData.wrist.clone(); aR.userData.hand = hR;
    g.userData.arms = [aR]; g.userData.hands = [hR];
    g.userData.slide = 0; g.userData.squeeze = 0; g.userData.shoulderShift = new T.Vector3();
    g.traverse(o=>{ if(o.isMesh){ o.castShadow = false; o.receiveShadow = false; } });
    return g;
  }

  return { init, makeHoloSight, makeRifle, makePistol, makeBerdanka, makeSMG, makeRPG, makeSatchel, makePickaxe, makeAxe, makeSpear, makeKnife, addHands, updateArms, materials:M };
})();
