/* Настройки игры: хранение (localStorage), окно настроек, подписка на изменения.
   game.js читает OSIL_SETTINGS.all и подписывается через onChange. */
window.OSIL_SETTINGS=(function(){
  const KEY='osil_settings_v1';
  const DEF={
    sens:10, invertY:false, joySize:100, btnSize:100,
    res:100, lighting:0, shadowFilter:1, texQ:4, aniso:4, waterQ:1, shadows:2, dist:190, fov:72, bob:100, water:true,
    volMaster:10, volSfx:10, volMusic:10, volSteps:10,
    hudOn:true, fps:true, fpsCap:1, shadowDist:60, minimap:true, miniSize:100, crosshair:true, hotbarSize:100, particles:true, camMode:0, platform:0
  };
  const all=Object.assign({},DEF);
  try{ if(!localStorage.getItem('osil_res_fix')){ localStorage.setItem('osil_res_fix','1'); } }catch(e){}
  try{ const s=JSON.parse(localStorage.getItem(KEY)||'{}'); for(const k in DEF) if(k in s && typeof s[k]===typeof DEF[k]) all[k]=s[k]; if(!localStorage.getItem('osil_light_fix')){ all.lighting=0; localStorage.setItem('osil_light_fix','1'); } if(!localStorage.getItem('osil_res_fix2')){ all.res=100; localStorage.setItem('osil_res_fix2','1'); } }catch(e){}
  try{ if(all.dist>200){ all.dist=200; localStorage.setItem(KEY,JSON.stringify(all)); } }catch(e){}
  try{ if(!localStorage.getItem('osil_sens10')){ all.sens=10; localStorage.setItem('osil_sens10','1'); localStorage.setItem(KEY,JSON.stringify(all)); } }catch(e){}
  const subs=[];
  function save(){ try{ localStorage.setItem(KEY,JSON.stringify(all)); }catch(e){} }
  function emit(k){ subs.forEach(f=>{ try{ f(k,all[k],all); }catch(e){ console.error(e); } }); }
  function set(k,v){ all[k]=v; save(); emit(k); }
  function onChange(f){ subs.push(f); }
  function reset(){ for(const k in DEF) all[k]=DEF[k]; save(); emit(null); }

  const TABS=[
    {id:'ctl',name:'Управление',rows:[
      {k:'platform',t:'seg',n:'Платформа',d:'Авто — определяется по устройству · ПК — мышь и клавиатура · Телефон — сенсорное управление',opts:['Авто','ПК','Телефон']},
      {k:'camMode',t:'seg',n:'Вид камеры',d:'1 лицо · 2 лицо (спереди) · 3 лицо (сзади) · осмотр (вращение вокруг игрока)',opts:['1 лицо','2 лицо','3 лицо','Осмотр']},
      {k:'sens',t:'range',n:'Чувствительность обзора',d:'Скорость поворота камеры',min:1,max:10,step:1},
      {k:'invertY',t:'toggle',n:'Инвертировать вертикаль'},
      {k:'joySize',t:'range',n:'Размер джойстика',min:70,max:140,step:5,u:'%'},
      {k:'btnSize',t:'range',n:'Размер кнопок действий',min:70,max:140,step:5,u:'%'},
      {t:'action',n:'Расположение кнопок и панелей',label:'ИЗМЕНИТЬ',fn:'edit'},
      {t:'action',n:'Скопировать координаты всех элементов на экране',label:'КОПИРОВАТЬ',fn:'copy'},
      {t:'action',n:'Вернуть стандартное расположение',label:'СБРОСИТЬ',fn:'reset'}
    ]},
    {id:'gfx',name:'Графика',rows:[
      {t:'head',n:'Качество'},
      {t:'head',n:'Освещение и тени'},
      {k:'lighting',t:'seg',n:'Освещение',d:'Статическое — тени обновляются по событию (быстрее). Динамическое — тени пересчитываются каждый кадр (плавнее, дороже)',opts:['Статическое','Динамическое']},
      {k:'shadowFilter',t:'seg',n:'Края теней',d:'Жёсткие — быстрее. Мягкие — красивее',opts:['Жёсткие','Мягкие']},
      {t:'head',n:'Текстуры и вода'},
      {k:'texQ',t:'seg',n:'Качество текстур',d:'Размер текстур. Меньше — меньше памяти и быстрее на слабых телефонах',opts:['Ультра слабое','Низкое','Среднее','Высокое','Ультра']},
      {k:'aniso',t:'seg',n:'Анизотропная фильтрация',d:'Чёткость текстур под острым углом (земля вдали). Выше — резче, чуть дороже',opts:['Выкл','2×','4×','8×','16×']},
      {k:'waterQ',t:'seg',n:'Качество воды',d:'Низкое — простая вода. Высокое — глубина, пена, блики',opts:['Низкое','Высокое']},
      {t:'preset',n:'Пресет графики',d:'Одним касанием выставляет разрешение, тени и дальность'},
      {t:'head',n:'Детали'},
      {k:'res',t:'range',n:'Разрешение картинки',d:'Ниже — быстрее на слабых телефонах',min:50,max:100,step:5,u:'%'},
      {k:'shadows',t:'seg',n:'Тени',opts:['Выкл','Низкие','Средние','Высокие']},
      {k:'shadowDist',t:'range',n:'Дальность теней',min:30,max:120,step:10,u:' м'},
      {k:'fpsCap',t:'seg',n:'Лимит FPS',opts:['30','60','90','Без лимита']},
      {k:'dist',t:'range',n:'Дальность прорисовки',min:60,max:200,step:10,u:' м'},
      {k:'fov',t:'range',n:'Поле зрения (FOV)',min:60,max:100,step:1,u:'°'},
      {k:'bob',t:'range',n:'Покачивание при ходьбе',d:'Качание рук и кирки при движении',min:0,max:100,step:10,u:'%'},
      {k:'water',t:'toggle',n:'Анимация воды'},
      {k:'particles',t:'toggle',n:'Частицы',d:'Щепки и крошка при ударах и разрушении'}
    ]},
    {id:'snd',name:'Звук',rows:[
      {k:'volMaster',t:'range',n:'Общая громкость',min:0,max:10,step:1},
      {k:'volSfx',t:'range',n:'Эффекты (удары, интерфейс)',min:0,max:10,step:1},
      {k:'volSteps',t:'range',n:'Шаги',min:0,max:10,step:1},
      {k:'volMusic',t:'range',n:'Музыка и окружение',min:0,max:10,step:1}
    ]},
    {id:'ui',name:'Интерфейс',rows:[
      {k:'hudOn',t:'toggle',n:'Показывать HUD',d:'Выкл — скрывает шкалы, панель быстрого доступа, миникарту, прицел и счётчик FPS'},
      {k:'fps',t:'toggle',n:'Счётчик FPS'},
      {k:'crosshair',t:'toggle',n:'Прицел'},
      {k:'minimap',t:'toggle',n:'Миникарта'},
      {k:'miniSize',t:'range',n:'Размер миникарты',min:70,max:150,step:5,u:'%'},
      {k:'hotbarSize',t:'range',n:'Размер панели быстрого доступа',min:70,max:130,step:5,u:'%'}
    ]}
  ];

  let root=null, tabId='ctl';
  function build(){
    root=document.getElementById('m-setModal'); if(!root) return;
    root.innerHTML='<div class="set-box"><div class="set-head"><b>НАСТРОЙКИ</b><small class="set-ver">v73</small><button class="set-x" id="m-setClose">&#10005;</button></div>'+
      '<div class="set-tabs"></div><div class="set-body"></div>'+
      '<div class="set-foot"><button class="set-reset" id="m-setReset">Сбросить всё</button></div></div>';
    root.addEventListener('pointerdown',e=>{ if(e.target===root) close(); });
    root.querySelector('#m-setClose').addEventListener('click',close);
    root.querySelector('#m-setReset').addEventListener('click',()=>{ reset(); render(); });
    render();
  }
  function render(){
    const tabs=root.querySelector('.set-tabs'), body=root.querySelector('.set-body'), keep=body.scrollTop;
    tabs.innerHTML=TABS.map(t=>'<button class="set-tab'+(t.id===tabId?' on':'')+'" data-t="'+t.id+'">'+t.name+'</button>').join('');
    tabs.querySelectorAll('.set-tab').forEach(b=>b.addEventListener('click',()=>{ tabId=b.dataset.t; body.scrollTop=0; render(); }));
    const tab=TABS.find(t=>t.id===tabId); body.innerHTML='';
    tab.rows.concat(tab.id==='ui' && window.OSIL_ADMIN && OSIL_ADMIN.ok() ? [{t:'admintime',n:'Время суток (админ)',d:'Только в одиночном мире'}] : []).forEach(r=>{
      if(r.t==='head'){ const hd=document.createElement('div'); hd.className='set-head-row'; hd.textContent=r.n; body.appendChild(hd); return; }
      const row=document.createElement('div'); row.className='set-row';
      const lab=document.createElement('div'); lab.className='set-lab'; lab.innerHTML='<b>'+r.n+'</b>'+(r.d?'<small>'+r.d+'</small>':''); row.appendChild(lab);
      const ctl=document.createElement('div'); ctl.className='set-ctl'; row.appendChild(ctl);
      if(r.t==='action'){
        const b=document.createElement('button'); b.className='set-tg on set-act'; b.textContent=r.label;
        b.addEventListener('click',()=>{
          const L=window.OSIL_LAYOUT; let ok=false, msg=null;
          if(L){ if(r.fn==='edit') ok=L.start(); else if(r.fn==='copy'){ L.copy(); ok=true; msg='СКОПИРОВАНО'; } else { L.reset(); ok=true; msg='ГОТОВО'; } }
          if(!ok){ msg='ТОЛЬКО В ИГРЕ'; }
          if(msg){ b.textContent=msg; setTimeout(()=>{ b.textContent=r.label; },1800); }
        });
        ctl.appendChild(b);
      } else if(r.t==='admintime'){
        const w=document.createElement('div'); w.className='set-seg'; w.style.flexWrap='wrap';
        [['Рассвет',0.02],['День',0.25],['Закат',0.47],['Ночь',0.75]].forEach(o=>{ const b=document.createElement('button'); b.textContent=o[0];
          b.addEventListener('click',()=>{ OSIL_ADMIN.setTime(o[1]); }); w.appendChild(b); });
        ctl.appendChild(w);
      } else if(r.t==='preset'){
        const PR=[{res:60,shadows:1,shadowDist:40,dist:90},{res:80,shadows:2,shadowDist:60,dist:140},{res:100,shadows:2,shadowDist:80,dist:190},{res:100,shadows:2,shadowDist:90,dist:190}];
        const w=document.createElement('div'); w.className='set-seg';
        const cur=()=>PR.findIndex(p=>Object.keys(p).every(k=>all[k]===p[k]));
        ['Низкое','Среднее','Высокое','Ультра'].forEach((o,i)=>{ const b=document.createElement('button'); b.textContent=o; b.className=(cur()===i?'on':'');
          b.addEventListener('click',()=>{ Object.keys(PR[i]).forEach(k=>set(k,PR[i][k])); render(); }); w.appendChild(b); });
        ctl.appendChild(w);
      } else if(r.t==='range'){
        const val=document.createElement('span'); val.className='set-val';
        const inp=document.createElement('input'); inp.type='range'; inp.min=r.min; inp.max=r.max; inp.step=r.step; inp.value=all[r.k];
        const fmt=v=>v+(r.u||''), pc=()=>inp.style.setProperty('--p',((parseFloat(inp.value)-r.min)/(r.max-r.min)*100)+'%'); pc();
        val.textContent=fmt(all[r.k]);
        inp.addEventListener('input',()=>{ const v=parseFloat(inp.value); val.textContent=fmt(v); pc(); set(r.k,v); });
        ctl.appendChild(inp); ctl.appendChild(val);
      } else if(r.t==='toggle'){
        const b=document.createElement('button'); b.className='set-tg'+(all[r.k]?' on':''); b.textContent=all[r.k]?'ВКЛ':'ВЫКЛ';
        b.addEventListener('click',()=>{ const v=!all[r.k]; set(r.k,v); b.classList.toggle('on',v); b.textContent=v?'ВКЛ':'ВЫКЛ'; });
        ctl.appendChild(b);
      } else if(r.t==='seg'){
        const w=document.createElement('div'); w.className='set-seg';
        r.opts.forEach((o,i)=>{ const b=document.createElement('button'); b.textContent=o; b.className=(all[r.k]===i?'on':'');
          b.addEventListener('click',()=>{ set(r.k,i);  w.querySelectorAll('button').forEach((x,j)=>x.classList.toggle('on',j===i)); }); w.appendChild(b); });
        ctl.appendChild(w);
      }
      body.appendChild(row);
    });
    body.scrollTop=keep;
  }
  function open(){ if(!root) return; render(); root.classList.remove('hidden'); }
  function close(){ if(root) root.classList.add('hidden'); }
  function init(){
    build();
    const g=document.getElementById('m-gearBtn'); if(g) g.addEventListener('click',open);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
  return {all,set,onChange,reset,open,close,DEF};
})();
