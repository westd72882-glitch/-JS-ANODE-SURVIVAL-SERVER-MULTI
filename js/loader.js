/* Загрузочные экраны: (1) старт — предзагрузка текстур/звуков/кода с прогрессом,
   (2) вход на остров — этапы подготовки мира. */

/* Окно входа: без карточки, прямо на тёмно-синем фоне. Используется на старте (до меню) и при повторном входе. */
window.OSIL_AUTH=(function(){
  let ov=null;
  const VER=()=>String(window.__APP_VER||''), SIG=()=>String(window.__APP_SIG||'');
  const lastUser=()=>{ try{ return localStorage.getItem('anode_lastuser')||''; }catch(e){ return ''; } };
  function close(){ if(!ov) return; const o=ov; ov=null; o.classList.add('out'); setTimeout(()=>o.remove(),500); }
  function status(txt){
    if(!ov) return; const e=ov.querySelector('.au-stat'); if(!e) return;
    e.classList.toggle('on',!!txt); e.querySelector('span').textContent=txt||'';
  }
  /* o: {base, note, skip}. Возвращает Promise: данные входа {u,token} или null (если пропустили) */
  function open(o){
    o=o||{}; if(ov){ ov.remove(); ov=null; }
    return new Promise(resolve=>{
      const el=document.createElement('div'); el.id='auth-ov'; ov=el;
      el.innerHTML=
        '<div class="au-wrap">'+
          '<div class="au-brand"><img src="1/icon-192.png" alt=""><div><div class="t1">ANODE</div><div class="t2">SURVIVAL ISLAND</div></div></div>'+
          '<div class="au-form">'+
            '<input id="au-u" class="au-in" placeholder="Ник" maxlength="16" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="username" enterkeyhint="next">'+
            '<input id="au-p" class="au-in" type="password" placeholder="Пароль" maxlength="64" autocomplete="current-password" enterkeyhint="go">'+
            '<div class="au-more"><div><input id="au-p2" class="au-in" type="password" placeholder="Повторите пароль" maxlength="64" autocomplete="new-password" enterkeyhint="go" tabindex="-1"></div></div>'+
            '<div id="au-e" class="au-err"></div>'+
            '<button id="au-l" class="au-main" type="button">ВОЙТИ</button>'+
            '<div class="au-links"><button id="au-r" type="button">Создать аккаунт</button>'+(o.skip?'<button id="au-s" type="button">Без входа</button>':'')+'</div>'+
            '<label class="au-ok"><input id="au-ok" type="checkbox" checked><i></i><span>Принимаю условия использования и политику конфиденциальности</span></label>'+
          '</div>'+
        '</div>'+
        '<div class="au-stat"><b></b><span></span></div>'+
        (VER()?'<div class="au-ver">v'+VER()+'</div>':'');
      document.body.appendChild(el);
      const $=id=>el.querySelector('#'+id), err=$('au-e'); let busy=false, mode='login';
      const say=(t,bad)=>{ err.textContent=t||''; err.classList.toggle('bad',!!bad); };
      if(o.note) say(o.note,true);

      /* вход <-> регистрация в одном и том же окне */
      const setMode=m=>{
        mode=m; const reg=m==='register';
        el.classList.toggle('reg',reg);
        $('au-l').textContent=reg?'СОЗДАТЬ АККАУНТ':'ВОЙТИ';
        $('au-r').textContent=reg?'Войти в аккаунт':'Создать аккаунт';
        $('au-p').placeholder=reg?'Пароль (от 6 символов)':'Пароль';
        $('au-p').autocomplete=reg?'new-password':'current-password';
        $('au-p').setAttribute('enterkeyhint',reg?'next':'go'); $('au-p2').tabIndex=reg?0:-1; $('au-p2').value='';
        say('');
      };
      const go=async()=>{
        if(busy) return; const u=$('au-u').value.trim(), p=$('au-p').value, reg=mode==='register';
        if(!u||!p){ say('Введите ник и пароль',true); return; }
        if(reg){
          if(u.length<3){ say('Ник — от 3 символов',true); return; }
          if(p.length<6){ say('Пароль — от 6 символов',true); return; }
          if(p!==$('au-p2').value){ say('Пароли не совпадают',true); return; }
        }
        if(!$('au-ok').checked){ say('Нужно принять условия',true); return; }
        busy=true; el.classList.add('busy'); say('Подождите…');
        try{
          const r=await fetch((o.base||'')+'/api/'+(reg?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({u,p,v:VER(),s:SIG()})});
          const d=await r.json();
          if(!r.ok||!d.token){ say(d.error||'Ошибка',true); busy=false; el.classList.remove('busy'); return; }
          say(''); detach(); close(); resolve(d);
        }catch(e){ say('Сервер недоступен. На бесплатном хостинге он просыпается до минуты — повторите',true); busy=false; el.classList.remove('busy'); }
      };
      $('au-l').onclick=go; $('au-r').onclick=()=>{ setMode(mode==='login'?'register':'login'); };
      const sk=$('au-s'); if(sk) sk.onclick=()=>{ detach(); close(); resolve(null); };
      el.addEventListener('keydown',e=>{
        if(e.key==='Enter'){ e.preventDefault();
          if(e.target.id==='au-u'){ $('au-p').focus(); } else if(e.target.id==='au-p'&&mode==='register'){ $('au-p2').focus(); } else go(); }
        e.stopPropagation(); });
      el.addEventListener('keyup',e=>e.stopPropagation());
      ['au-u','au-p','au-p2'].forEach(id=>$(id).addEventListener('input',()=>{ if(err.classList.contains('bad')) say(''); }));

      /* клавиатура и смена раскладки меняют размер окна — окно остаётся на месте, форма прокручивается и держит поле в видимой зоне */
      const vv=window.visualViewport;
      const fit=()=>{
        if(!el.isConnected) return;
        const h=Math.round(vv?vv.height:innerHeight), top=Math.round(vv?vv.offsetTop:0);
        el.style.setProperty('--avh',h+'px'); el.style.top=top+'px';
        el.classList.toggle('kb',h<Math.min(innerHeight,screen.height||innerHeight)*0.8||h<300);
        const a=document.activeElement; if(a&&el.contains(a)&&a.tagName==='INPUT'&&a.type!=='checkbox') a.scrollIntoView({block:'center',behavior:'auto'});
      };
      const detach=()=>{ if(vv){ vv.removeEventListener('resize',fit); vv.removeEventListener('scroll',fit); } removeEventListener('resize',fit); removeEventListener('orientationchange',fit); };
      if(vv){ vv.addEventListener('resize',fit); vv.addEventListener('scroll',fit); }
      addEventListener('resize',fit); addEventListener('orientationchange',fit);
      el.addEventListener('focusin',()=>setTimeout(fit,60));
      fit();
      const lu=lastUser(); if(lu) $('au-u').value=lu; setTimeout(()=>$(lu?'au-p':'au-u').focus({preventScroll:true}),120);
    });
  }
  return {open,close,status};
})();

window.OSIL_LOADER=(function(){
  const TIPS=['Топор быстрее рубит деревья, кирка — камень, серу и металл.','Тыквы на земле подбираются на ходу — они утоляют голод.','Зайдите в воду пруда, чтобы напиться.','Жареное мясо утоляет голод и лечит: выберите его в поясе и нажмите «Удар».','У топора и кирки есть прочность — следите за полоской в слоте. Сломанный инструмент придётся создать заново.','Между ударами есть пауза: не спамьте кнопку, а зажмите её — удары пойдут сами.','Перетаскивайте предметы из инвентаря на пояс, чтобы взять их в руки.','Присед (C) снижает скорость, но помогает целиться и прятаться.','Ночью в лесу воют хищники — держитесь ближе к базе.'];
  const el=document.createElement('div'); el.id='loading-screen';
  el.innerHTML='<div class="ld-bg"></div><div class="ld-logo"><img src="1/icon-192.png" alt=""><div><div class="t1">ANODE</div><div class="t2">SURVIVAL ISLAND</div></div></div>'+
    '<div class="ld-spin"></div><div class="ld-txt">ЗАГРУЗКА</div>'+
    '<div style="display:none"><span id="ld-stage"></span><i id="ld-fill"></i><span id="ld-file"></span><b id="ld-pct"></b><div id="ld-tip"></div></div>';
  document.body.appendChild(el);
  const $=id=>document.getElementById(id);
  let tipT=null;
  function tip(){ $('ld-tip').textContent='Совет: '+TIPS[Math.floor(Math.random()*TIPS.length)]; }
  function set(p,stage,file){
    p=Math.max(0,Math.min(1,p));
    $('ld-fill').style.width=(p*100)+'%'; $('ld-pct').textContent=Math.round(p*100)+'%';
    if(stage) $('ld-stage').textContent=stage; if(file!==undefined) $('ld-file').textContent=file;
  }
  function show(){ el.classList.remove('out'); el.style.display='flex'; if(window.__preHide) window.__preHide(); tip(); clearInterval(tipT); tipT=setInterval(tip,2600); }
  function hide(){ clearInterval(tipT); el.classList.add('out'); setTimeout(()=>{ el.style.display='none'; },500); }
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  function script(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src+(src.indexOf('?')<0?'?t='+Date.now():''); s.onload=res; s.onerror=()=>rej(src); document.body.appendChild(s); }); }
  function img(u){ return new Promise(r=>{ const i=new Image(); i.onload=i.onerror=()=>r(); i.src=u; }); }

  /* При старте грузим только то, что видно в меню. Остальные текстуры/иконки/звуки — при входе в игру (enter) */
  const MENU_IMGS=['1/menu-bg-update.webp','1/default-avatar.webp','1/coin.webp'];
  /* Фоновая подгрузка игровых ресурсов: небольшими порциями в свободное время, чтобы не мешать меню и вводу.
     Стартует сразу после загрузки кода и продолжается за меню; при входе на остров догружается остаток на полной скорости. */
  let _ga=null, _fast=false, gaProg=0;
  const idle=()=>new Promise(r=>{ if(_fast) return r(); if(window.requestIdleCallback) requestIdleCallback(()=>r(),{timeout:300}); else setTimeout(r,50); });
  function loadGameAssets(){
    if(_ga) return _ga;
    _ga=(async()=>{
      const menu=new Set(MENU_IMGS);
      const imgs=Array.from(new Set(Object.values(TEXTURES).concat(window.EXTRA_IMAGES||[]))).filter(u=>!menu.has(u));
      const snds=OSIL_AUDIO.SFX.concat(OSIL_AUDIO.LOOPS.filter(n=>n!=='night'));
      const total=imgs.length+snds.length; let done=0;
      const tick=()=>{ done++; gaProg=done/total; };
      for(let i=0;i<imgs.length;i+=(_fast?8:3)){ await Promise.all(imgs.slice(i,i+(_fast?8:3)).map(u=>img(u).then(tick))); await idle(); }
      for(let i=0;i<snds.length;i+=(_fast?4:1)){ await Promise.all(snds.slice(i,i+(_fast?4:1)).map(n=>OSIL_AUDIO.load(n).then(tick,tick))); await idle(); }
      gaProg=1;
    })();
    return _ga;
  }
  /* адрес сервера для входа: сервер игры (APK) или тот, с которого открыта страница */
  function authBase(){
    try{ if(window.__SERVER) return new URL(window.__SERVER).origin;
      if(/^https?:$/.test(location.protocol)&&location.hostname) return location.origin; }catch(e){}
    return '';
  }
  async function boot(){
    show();
    if(typeof THREE==='undefined'){
      set(0,'Ошибка: не загружен Three.js','Проверьте интернет и обновите страницу'); return;
    }
    /* окно входа показываем сразу, пока в фоне идёт загрузка */
    const base=authBase(); let authRes=null, authP=Promise.resolve();
    if(base){ authP=OSIL_AUTH.open({base,skip:true}).then(d=>{ authRes=d; }); OSIL_AUTH.status('ЗАГРУЗКА ИГРЫ'); }
    const imgs=MENU_IMGS.slice(), snds=[];
    const W_SND=3, total=imgs.length+snds.length*W_SND+4; let done=0;
    const tick=(n,stage,file)=>{ done+=n; set(done/total,stage,file); };
    // 1) текстуры и иконки (параллельно пачками)
    for(let i=0;i<imgs.length;i+=6){
      const chunk=imgs.slice(i,i+6);
      await Promise.all(chunk.map(u=>img(u).then(()=>tick(1,'Загрузка текстур',u.split('/').pop()))));
    }
    // 2) звуки
    for(let i=0;i<snds.length;i+=3){
      const chunk=snds.slice(i,i+3);
      await Promise.all(chunk.map(n=>OSIL_AUDIO.load(n).then(()=>tick(W_SND,'Загрузка звуков',n+'.mp3'))));
    }
    // 3) игровой код и построение мира
    tick(1,'Генерация острова','деревья, камни, руды…'); await frame();
    try{ await script('js/game.js'); }catch(e){ set(done/total,'Ошибка загрузки game.js',String(e)); return; }
    /* net.js встроен в game.js */
    tick(3,'Готово','');
    set(1,'Готово','');
    loadGameAssets();                                      // дальше тихо догружаем текстуры и звуки, пока игрок входит и сидит в меню
    OSIL_AUTH.status('');
    await authP;                                           // ждём, пока игрок войдёт (или нажмёт «Без входа»)
    try{ if(authRes&&window.OSIL_NET_AUTH) window.OSIL_NET_AUTH(authRes); }catch(e){}
    await wait(350); hide();
    OSIL_AUDIO.load('night'); // тихо догружаем ночную дорожку
  }

  /* Экран входа на остров (вызывается по кнопке ИГРАТЬ) */
  async function enter(cb){
    show(); set(0,'Вход на остров','');
    _fast=true; const pt=setInterval(()=>set(0.05+0.9*gaProg),80);
    try{ await loadGameAssets(); }finally{ clearInterval(pt); }
    set(0.97,'Спавн игрока',''); await frame();
    set(1,'Добро пожаловать!',''); await frame();
    try{ cb&&cb(); }catch(e){}
    await wait(250); hide();
  }
  return {boot,enter,set,show,hide};
})();
window.addEventListener('load',()=>OSIL_LOADER.boot());
