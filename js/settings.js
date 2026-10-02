/* Настройки игры: хранение (localStorage), окно настроек, подписка на изменения.
   game.js читает OSIL_SETTINGS.all и подписывается через onChange. */
window.OSIL_SETTINGS=(function(){
  const KEY='osil_settings_v1';
  const DEF={
    sens:10, invertY:false, joySize:100, btnSize:100,
    res:100, lighting:1, shadowFilter:1, texQ:4, aniso:4, waterQ:1, shadows:3, dist:200, fov:75, bob:100, water:true,
    volMaster:10, volSfx:10, volMusic:10, volSteps:10,
    hudOn:true, fps:true, fpsCap:1, shadowDist:120, minimap:false, miniSize:70, crosshair:true, hotbarSize:100, particles:true, camMode:0, platform:0
  };
  const all=Object.assign({},DEF);
  try{ if(!localStorage.getItem('osil_res_fix')){ localStorage.setItem('osil_res_fix','1'); } }catch(e){}
  try{ const s=JSON.parse(localStorage.getItem(KEY)||'{}'); for(const k in DEF) if(k in s && typeof s[k]===typeof DEF[k]) all[k]=s[k]; if(!localStorage.getItem('osil_light_fix')){ all.lighting=0; localStorage.setItem('osil_light_fix','1'); } if(!localStorage.getItem('osil_res_fix2')){ all.res=100; localStorage.setItem('osil_res_fix2','1'); } }catch(e){}
  try{ if(all.dist>200){ all.dist=200; localStorage.setItem(KEY,JSON.stringify(all)); } }catch(e){}
  try{ if(!localStorage.getItem('osil_sens10')){ all.sens=10; localStorage.setItem('osil_sens10','1'); localStorage.setItem(KEY,JSON.stringify(all)); } }catch(e){}
  try{ if(!localStorage.getItem('osil_defaults_v3')){ Object.assign(all,{res:100,lighting:1,shadowFilter:1,texQ:4,aniso:4,waterQ:1,shadows:3,dist:200,shadowDist:120,fov:75,miniSize:70}); localStorage.setItem(KEY,JSON.stringify(all)); localStorage.setItem('osil_defaults_v3','1'); } }catch(e){}
  const subs=[];
  try{ if(!localStorage.getItem('osil_mini_off')){ all.minimap=false; localStorage.setItem(KEY,JSON.stringify(all)); localStorage.setItem('osil_mini_off','1'); } }catch(e){}
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
      {t:'action',n:'Расположение как на фото (по умолчанию)',label:'ПРИМЕНИТЬ',fn:'reset'}
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

  function esc(x){ return String(x==null?'':x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function fdt(t){ if(!t) return '—'; const d=new Date(t*1000); return d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }
  let admSec='players';
  async function adminPanel(body){
    body.innerHTML='<div class="set-seg" id="adm-sec" style="margin-bottom:8px"></div><div id="adm-list" style="font-size:12px">Загрузка…</div>';
    const sec=body.querySelector('#adm-sec'), box=body.querySelector('#adm-list');
    [['players','Игроки'],['promo','Промокоды']].forEach(o=>{ const b=document.createElement('button'); b.textContent=o[1]; b.className=admSec===o[0]?'on':'';
      b.onclick=()=>{ admSec=o[0]; adminPanel(body); }; sec.appendChild(b); });
    const B='padding:5px 9px;font-size:12px', I='padding:7px;margin:3px 0;width:100%;box-sizing:border-box;background:#1c1b18;color:#fff;border:1px solid #6b6a5f;border-radius:6px';
    if(admSec==='promo'){
      const load=async()=>{
        const d=await OSIL_ACC.call('/api/admin',{op:'promo_list'}); if(d.error){ box.textContent=d.error; return; }
        box.innerHTML='<div class="set-head-row">Создать промокод</div>'+
          '<input id="pc-code" placeholder="КОД (латиница/цифры)" style="'+I+'"><input id="pc-coins" type="number" placeholder="Монет" style="'+I+'">'+
          '<select id="pc-item" style="'+I+'"><option value="">Без предмета</option><option value="copter">Миникоптер</option><option value="quarry">Карьер</option></select>'+
          '<input id="pc-uses" type="number" placeholder="Лимит активаций (0 = без лимита)" style="'+I+'">'+
          '<button class="set-tg on" id="pc-add" style="'+B+';margin:6px 0">СОЗДАТЬ</button><div class="set-head-row">Существующие</div>'+
          (d.promos.map(p=>'<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #55544a;border-radius:8px;padding:6px 8px;margin:4px 0"><span><b>'+esc(p.code)+'</b> · '+p.coins+' мон.'+(p.item?' · '+esc(p.item):'')+' · '+p.used+'/'+(p.uses||'∞')+'</span><button class="set-tg on" data-del="'+esc(p.code)+'" style="'+B+'">Удалить</button></div>').join('')||'<div style="opacity:.6">Пока нет</div>');
        box.querySelector('#pc-add').onclick=async()=>{ const r=await OSIL_ACC.call('/api/admin',{op:'promo_add',code:box.querySelector('#pc-code').value,coins:+box.querySelector('#pc-coins').value||0,item:box.querySelector('#pc-item').value,uses:+box.querySelector('#pc-uses').value||0}); if(r.error) alert(r.error); load(); };
        box.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ await OSIL_ACC.call('/api/admin',{op:'promo_del',code:b.dataset.del}); load(); });
      };
      load(); return;
    }
    const load=async()=>{
      const d=await OSIL_ACC.call('/api/admin',{op:'list'});
      if(d.error){ box.textContent=d.error; return; }
      box.innerHTML=d.players.map(p=>'<div style="border:1px solid #55544a;border-radius:8px;padding:8px;margin:6px 0;background:rgba(0,0,0,.25)">'+
        '<b style="font-size:14px">'+esc(p.u)+'</b> '+(p.admin?'<span style="color:#e8c25a">[админ]</span> ':'')+(p.online?'<span style="color:#8fd16a">● онлайн</span> ':'')+(p.banned?'<span style="color:#e06060">[БАН]</span> ':'')+(p.ipbanned?'<span style="color:#e06060">[IP-БАН]</span>':'')+
        '<div style="opacity:.85;margin-top:3px">Ур. '+p.level+' ('+p.xp+' оп.) · монеты '+p.coins+' · убийств '+p.kills+' · смертей '+p.deaths+' · '+p.min+' мин</div>'+
        '<div style="opacity:.85">Донат: '+(p.items.join(', ')||'нет')+'</div>'+
        '<div style="opacity:.7">Вход: '+fdt(p.last)+' · создан: '+fdt(p.created)+'</div>'+
        '<div style="opacity:.7;word-break:break-all">IP: '+esc(p.ips.join(', ')||'—')+'</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px" data-u="'+esc(p.u)+'">'+
        ['kick:Кик',p.banned?'unban:Разбан':'ban:Бан','banip:Бан IP','setcoins:Монеты','setxp:Опыт','giveitem:+Предмет','takeitem:−Предмет','reset:Обнулить','delete:Удалить'].map(x=>{const a=x.split(':');return '<button class="set-tg on" data-op="'+a[0]+'" style="'+B+'">'+a[1]+'</button>';}).join('')+'</div></div>').join('')||'Нет игроков';
      box.querySelectorAll('button[data-op]').forEach(b=>b.addEventListener('click',async()=>{
        const op=b.dataset.op, u=b.parentNode.dataset.u, body={op,target:u};
        if(op==='setcoins'||op==='setxp'){ const v=prompt((op==='setxp'?'Опыт':'Монеты')+' у '+u+'?'); if(v===null) return; body.v=parseInt(v)||0; }
        else if(op==='giveitem'||op==='takeitem'){ const v=prompt('Предмет: copter или quarry'); if(!v) return; body.item=v.trim(); }
        else if(op==='ban'){ const r=prompt('Причина бана (необязательно)'); if(r===null) return; body.reason=r; }
        else if(['reset','delete','banip'].includes(op) && !confirm(b.textContent+': '+u+'?')) return;
        const r=await OSIL_ACC.call('/api/admin',body); if(r.error) alert(r.error); load();
      }));
    };
    load();
    const rb=document.createElement('button'); rb.className='set-tg on'; rb.textContent='ОБНОВИТЬ'; rb.style.marginTop='6px'; rb.onclick=load; body.appendChild(rb);
  }
  function render(){
    const tabs=root.querySelector('.set-tabs'), body=root.querySelector('.set-body'), keep=body.scrollTop;
    const adm=window.OSIL_ACC && OSIL_ACC.isAdmin();
    const ALL=adm?TABS.concat([{id:'adm',name:'Админ',rows:[]}]):TABS; if(!adm && tabId==='adm') tabId='ctl';
    tabs.innerHTML=ALL.map(t=>'<button class="set-tab'+(t.id===tabId?' on':'')+'" data-t="'+t.id+'">'+t.name+'</button>').join('');
    tabs.querySelectorAll('.set-tab').forEach(b=>b.addEventListener('click',()=>{ tabId=b.dataset.t; body.scrollTop=0; render(); }));
    const tab=ALL.find(t=>t.id===tabId); body.innerHTML='';
    if(tab.id==='adm'){ adminPanel(body); return; }
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
        const PR=[{res:60,shadows:1,shadowDist:40,dist:90},{res:80,shadows:2,shadowDist:60,dist:140},{res:100,shadows:2,shadowDist:80,dist:190},{res:100,shadows:3,shadowDist:120,dist:200,lighting:1,shadowFilter:1,texQ:4,aniso:4,waterQ:1}];
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
