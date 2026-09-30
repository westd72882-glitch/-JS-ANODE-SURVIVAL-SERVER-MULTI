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
    M.skin  = new T.MeshStandardMaterial({map:skin, normalMap:sN, normalScale:nS(0.45), roughness:0.6, emissive:0x1f0c07, envMap:env, envMapIntensity:0.14});
    M.crease= new T.MeshStandardMaterial({color:0x8d5439, roughness:0.85});
    M.cloth = new T.MeshStandardMaterial({map:cloth, normalMap:cN, normalScale:nS(0.9), roughness:1});
    M.nail  = new T.MeshStandardMaterial({color:0xdcae98, roughness:0.28, envMap:env, envMapIntensity:0.6});
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
  function crease(p, tg, n, rad, arc, parent){
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
    for(let i=0;i<=20;i++){ const y = 0.17*i/20, k = Math.min(1,y/0.16), sm = k*k*(3-2*k); sp.push(new V2(0.0255 + 0.012*sm + 0.0035*Math.sin(PI*k), y)); }
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
      hs[1].position.y = -0.024*sl + 0.0012*Math.sin(t*0.55);          // ведущая рука съезжает при ударе
      hs[0].position.y =  0.004*sl + 0.0010*Math.sin(t*0.47+1.3);
      hs[1].rotation.y = -0.035*sl + 0.012*Math.sin(t*0.41+0.7);       // проворот кисти на рукояти
      hs[0].rotation.y =  0.050*sl + 0.010*Math.sin(t*0.36);
      const k = 1 - 0.035*sq;                                          // сжатие хвата
      hs[0].scale.set(k,1,k); hs[1].scale.set(k,1,k);
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

  return { init, makeRifle, makePistol, makeBerdanka, makePickaxe, makeAxe, makeSpear, addHands, updateArms, materials:M };
})();
