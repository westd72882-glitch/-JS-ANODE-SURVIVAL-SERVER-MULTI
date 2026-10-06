/* Загрузочные экраны: (1) старт — предзагрузка текстур/звуков/кода с прогрессом,
   (2) вход на остров — этапы подготовки мира. */
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
  let _gameAssets=false;
  async function loadGameAssets(){
    if(_gameAssets) return; _gameAssets=true;
    const menu=new Set(MENU_IMGS);
    const imgs=Array.from(new Set(Object.values(TEXTURES).concat(window.EXTRA_IMAGES||[]))).filter(u=>!menu.has(u));
    const snds=OSIL_AUDIO.SFX.concat(OSIL_AUDIO.LOOPS.filter(n=>n!=='night'));
    const total=imgs.length+snds.length; let done=0;
    const tick=(stage,file)=>{ done++; set(0.05+0.9*done/total,stage,file); };
    for(let i=0;i<imgs.length;i+=8){ await Promise.all(imgs.slice(i,i+8).map(u=>img(u).then(()=>tick('Загрузка текстур',u.split('/').pop())))); }
    for(let i=0;i<snds.length;i+=4){ await Promise.all(snds.slice(i,i+4).map(n=>OSIL_AUDIO.load(n).then(()=>tick('Загрузка звуков',n+'.mp3')))); }
  }
  async function boot(){
    show();
    if(typeof THREE==='undefined'){
      set(0,'Ошибка: не загружен Three.js','Проверьте интернет и обновите страницу'); return;
    }
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
    await wait(350); hide();
    OSIL_AUDIO.load('night'); // тихо догружаем ночную дорожку
  }

  /* Экран входа на остров (вызывается по кнопке ИГРАТЬ) */
  async function enter(cb){
    show(); set(0,'Вход на остров','');
    await loadGameAssets();
    set(0.97,'Спавн игрока',''); await frame();
    set(1,'Добро пожаловать!',''); await frame();
    try{ cb&&cb(); }catch(e){}
    await wait(250); hide();
  }
  return {boot,enter,set,show,hide};
})();
window.addEventListener('load',()=>OSIL_LOADER.boot());
