/* Мультиплеер: клиент WebSocket, аватары игроков, синхронизация ресурсов/построек/боя, чат,
   список серверов (локальная игра / сохранённые / автопоиск в сети). Грузится после game.js
   и использует его глобальные переменные (player, scene, camera, harvestables, ...). */
window.OSIL_NET = (function(){
  const $ = id => document.getElementById(id);
  const LS_SRV = 'anode_servers', LS_NAME = 'anode_name';
  let ws = null, on = false, myId = 0, srvName = '', applying = false, sendT = 0, meleeT = 0, dieSent = false;
  const remotes = new Map();
  const TOOLS = {none:0, axe:1, pickaxe:2, rifle:3}, TOOLN = ['none','axe','pickaxe','rifle'];

  const toast = m => { try{ showToast(m); }catch(e){} };
  const send = o => { if(ws && ws.readyState===1) ws.send(JSON.stringify(o)); };
  const r2 = v => Math.round(v*100)/100;

  /* ---------------- аватар удалённого игрока ---------------- */
  const COLS = [0x4d5b3d,0x7a3b32,0x33506e,0x6b5a2e,0x5a3d6b,0x2f6b5c,0x8a5a2a,0x555a60];
  function makeAvatar(id, name){
    const root = new THREE.Group(), M = c => new THREE.MeshLambertMaterial({color:c});
    const jacket = M(COLS[id % COLS.length]), skin = M(0xd8a77e), pants = M(0x35404f), boot = M(0x2b2119), hair = M(0x33241a);
    const box = (w,h,d,m,x,y,z,par)=>{ const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m); o.position.set(x,y,z); o.castShadow = true; (par||root).add(o); return o; };
    const pivot = (x,y,z,par)=>{ const g = new THREE.Group(); g.position.set(x,y,z); (par||root).add(g); return g; };
    const torso = pivot(0,0.78,0); box(0.5,0.62,0.27,jacket,0,0.31,0,torso);
    const head = pivot(0,0.66,0,torso);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.135,12,10), skin); hd.position.y = 0.14; hd.castShadow = true; head.add(hd);
    const hr = new THREE.Mesh(new THREE.SphereGeometry(0.14,12,8,0,6.29,0,1.6), hair); hr.position.y = 0.16; head.add(hr);
    const legL = pivot(-0.12,0.78,0), legR = pivot(0.12,0.78,0);
    [legL,legR].forEach(l=>{ box(0.2,0.62,0.22,pants,0,-0.31,0,l); box(0.21,0.14,0.28,boot,0,-0.72,-0.03,l); });
    const armL = pivot(-0.33,0.55,0,torso), armR = pivot(0.33,0.55,0,torso);
    [armL,armR].forEach(a=>{ box(0.14,0.55,0.14,jacket,0,-0.27,0,a); box(0.11,0.11,0.11,skin,0,-0.6,0,a); });
    const hold = pivot(0,-0.6,0,armR);
    const c = document.createElement('canvas'); c.width = 256; c.height = 56; const g = c.getContext('2d');
    g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)'; g.fillStyle = '#fff';
    g.strokeText(name,128,38); g.fillText(name,128,38);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c), transparent:true, depthWrite:false}));
    sp.scale.set(1.3,0.284,1); sp.position.y = 2.15; root.add(sp);
    scene.add(root);
    return {id, name, root, torso, head, legL, legR, armL, armR, hold, held:null, heldKind:'none', tools:{},
            p:new THREE.Vector3(), tp:new THREE.Vector3(), yaw:0, tyaw:0, pitch:0, crouch:0, aim:0, phase:0, amp:0, swing:0, flash:0, fresh:true};
  }
  function setHeld(r, kind){
    if(r.heldKind === kind) return;
    if(r.held){ r.hold.remove(r.held); r.held = null; }
    r.heldKind = kind; if(kind === 'none') return;
    let t = r.tools[kind];
    if(!t){
      const src = kind==='axe' ? makeAxeModel() : kind==='rifle' ? OSIL_TOOLS.makeRifle(false) : makePickaxeModel();
      t = new THREE.Group(); t.add(src); src.scale.setScalar(kind==='rifle'?0.85:1.15);
      if(kind==='rifle') src.position.set(0,0.077,-0.077);
      t.rotation.set(kind==='rifle'?-Math.PI/2:-1.25,0,0);
      src.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
      r.tools[kind] = t; r.flashObj = r.flashObj || null;
      if(kind==='rifle') r.rifleFlash = src.userData.flash || null;
    }
    r.held = t; r.hold.add(t);
  }
  function angDiff(a,b){ let d = (b-a) % (Math.PI*2); if(d > Math.PI) d -= Math.PI*2; if(d < -Math.PI) d += Math.PI*2; return d; }
  function animRemotes(dt){
    remotes.forEach(r=>{
      const ox = r.p.x, oz = r.p.z;
      if(r.fresh){ r.p.copy(r.tp); r.yaw = r.tyaw; r.fresh = false; }
      const k = Math.min(1, dt*12);
      r.p.lerp(r.tp, k); r.yaw += angDiff(r.yaw, r.tyaw)*k;
      const sp = Math.min(12, Math.hypot(r.p.x-ox, r.p.z-oz)/Math.max(dt,1e-3));
      r.amp += (Math.min(1, sp/4) - r.amp)*Math.min(1,dt*10); r.phase += dt*(3+sp*1.3);
      const s = Math.sin(r.phase)*r.amp, a = s*0.75, cr = r.crouch;
      r.legL.rotation.x = a + cr*0.5; r.legR.rotation.x = -a + cr*0.5;
      const held = r.heldKind !== 'none', rifle = r.heldKind === 'rifle';
      r.armL.rotation.set(rifle ? 1.15 : -a*0.9, 0, rifle ? 0.5 : 0.06);
      let up = rifle ? (0.95 + r.aim*0.25) : 0.95;
      if(r.swing > 0){ r.swing -= dt*3.2; if(!rifle) up -= 1.9*Math.sin(Math.max(0,r.swing)*Math.PI); }
      r.armR.rotation.set(held ? up : a*0.9, 0, -0.06);
      r.torso.rotation.x = cr*0.35; r.head.rotation.x = -r.pitch*0.5 - cr*0.3;
      r.root.position.set(r.p.x, r.p.y - cr*0.18 + Math.abs(Math.cos(r.phase))*0.035*r.amp, r.p.z);
      r.root.rotation.y = r.yaw;
      if(r.flash > 0){ r.flash -= dt; if(r.rifleFlash){ r.rifleFlash.visible = r.flash > 0; r.rifleFlash.rotation.z = Math.random()*6; } }
    });
  }

  /* ---------------- сообщения сервера ---------------- */
  const byNid = n => harvestables.find(h => h.nid === n);
  function applyBuild(b){ try{ applying = true; spawnBuilt(b.k, b.x,b.y,b.z,b.r,b.l,b.b); }catch(e){ console.warn('build',e); } finally{ applying = false; } }
  function removeRemote(id){ const r = remotes.get(id); if(!r) return; scene.remove(r.root); remotes.delete(id); }
  function onMsg(m){
    switch(m.t){
      case 'w':
        myId = m.id; on = true; srvName = m.name;
        if(m.ver !== 40) toast('Версия сервера отличается от клиента');
        (m.players||[]).forEach(p=>{ if(!remotes.has(p.id)) remotes.set(p.id, makeAvatar(p.id,p.n)); });
        applying = true;
        try{
          (m.dead||[]).forEach(n=>{ const t = byNid(n); if(t) destroyHarvestable(t); });
          Object.keys(m.hp||{}).forEach(n=>{ const t = byNid(+n); if(t) t.health = Math.min(t.health, m.hp[n]); });
        } finally{ applying = false; }
        (m.builds||[]).forEach(applyBuild);
        toast('Подключено: '+srvName); hud(); chat('', 'Вы на сервере «'+srvName+'». Enter — чат.'); break;
      case 'full': toast('Сервер заполнен'); disconnect(); break;
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
      case 'hh': { const t = byNid(m.i); if(t) t.health = Math.min(t.health, m.h); break; }
      case 'bd': applyBuild(m); break;
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
    if(best) send({t:'hit', to:best.r.id, d: best.head ? 40 : 20});
  }
  function melee(){
    if(!on || performance.now()-meleeT < 550) return; meleeT = performance.now();
    camera.getWorldDirection(_d); const dmg = toolKind==='axe' ? 15 : 12;
    remotes.forEach(r=>{
      const dx = r.p.x-player.pos.x, dz = r.p.z-player.pos.z, dist = Math.hypot(dx,dz);
      if(dist < 2.3 && (dx*_d.x + dz*_d.z)/Math.max(dist,1e-3) > 0.5) send({t:'hit', to:r.id, d:dmg});
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
  function getName(){
    let n = ''; try{ n = localStorage.getItem(LS_NAME) || ''; }catch(e){}
    if(!n){ n = (prompt('Ваш ник для мультиплеера:', 'Игрок' + (100 + Math.floor(Math.random()*900))) || '').trim().slice(0,16) || 'Игрок';
      try{ localStorage.setItem(LS_NAME, n); }catch(e){} }
    return n;
  }
  function cleanup(){ on = false; myId = 0; remotes.forEach(r=>scene.remove(r.root)); remotes.clear(); hud(); }
  function disconnect(){ const w = ws; ws = null; if(w){ w.onclose = null; try{ w.close(); }catch(e){} } cleanup(); }
  function connect(s){
    disconnect(); if(!s || s.solo) return;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + s.host + ':' + s.port + '/ws';
    let w; try{ w = new WebSocket(url); }catch(e){ toast('Неверный адрес сервера'); return; }
    ws = w; const name = getName();
    const to = setTimeout(()=>{ if(ws === w && !on){ toast('Сервер не отвечает — одиночная игра'); disconnect(); } }, 6000);
    w.onopen = () => send({t:'join', n:name});
    w.onmessage = e => { try{ onMsg(JSON.parse(e.data)); }catch(err){ console.warn(err); } };
    w.onerror = () => { if(ws === w && !on){ toast('Не удалось подключиться — одиночная игра'); } };
    w.onclose = () => { clearTimeout(to); if(ws === w){ if(on) toast('Соединение потеряно'); ws = null; cleanup(); } };
  }

  /* ---------------- события игры ---------------- */
  function onDestroy(t){ if(on && !applying && t.nid != null) send({t:'hv', i:t.nid}); }
  function onHit(t){ if(on && t.nid != null) send({t:'hh', i:t.nid, h:Math.round(t.health)}); }
  function onBuild(b){ if(on && !applying) send(b); }
  function onSwing(){ if(on) send({t:'sw'}); }

  /* ---------------- список серверов ---------------- */
  const saved = () => { try{ return JSON.parse(localStorage.getItem(LS_SRV) || '[]'); }catch(e){ return []; } };
  const saveList = l => { try{ localStorage.setItem(LS_SRV, JSON.stringify(l)); }catch(e){} };
  const norm = h => (h === 'localhost' ? '127.0.0.1' : h);
  async function probe(c){
    const ac = new AbortController(), tm = setTimeout(()=>ac.abort(), 3500), t0 = performance.now();
    try{ const r = await fetch('http://' + c.host + ':' + c.port + '/api/info', {signal:ac.signal, cache:'no-store'}); const d = await r.json();
      return Object.assign({}, c, {name:d.name, cur:d.cur, max:d.max, ping:Math.max(1, Math.round(performance.now()-t0)), ok:true}); }
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
    const rebind = (id, fn) => { const b = $(id); if(!b) return; const n = b.cloneNode(true); b.replaceWith(n); n.addEventListener('click', fn); };
    rebind('m-addServ', addServer); rebind('m-refServ', () => { toast('Поиск серверов…'); refresh().then(()=>toast('Список обновлён')); });
    $('start-btn').addEventListener('click', () => { const s = mServers[mSelServer]; if(s && !s.solo) connect(s); else disconnect(); });
    $('pm-exit').addEventListener('click', disconnect);
    harvestables.forEach((h,i) => { h.nid = i; });
    mServers.length = 0; mServers.push({name:'Локальная игра', sub:'Одиночная · без сети', cur:0, max:1, ping:0, solo:true}); mSelServer = 0; renderMenuServers();
    refresh(); setInterval(() => { const ss = $('start-screen'); if(ss && ss.style.display !== 'none' && !document.hidden) refresh(); }, 15000);
    setInterval(() => {                                       // отправка своего состояния 10 раз/с
      if(!on) return;
      send({t:'st', s:[r2(player.pos.x), r2(player.pos.y), r2(player.pos.z), r2(player.yaw), r2(player.pitch), TOOLS[toolKind] || 0,
        (isCrouching ? 1 : 0) | (aimK > 0.5 ? 2 : 0)].slice(0,7).concat([])});
    }, 100);
    let last = performance.now();
    (function loop(){ const n = performance.now(), dt = Math.min(0.1, (n-last)/1000); last = n; animRemotes(dt); requestAnimationFrame(loop); })();
  }
  try{ init(); }catch(e){ alert('Ошибка net.js: ' + e.message); }
  return {connect, disconnect, refresh, onDestroy, onHit, onBuild, onShoot, onSwing, melee, get on(){ return on; }};
})();
