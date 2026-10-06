/* Звуковая система: короткие SFX декодируются в буферы WebAudio,
   длинные (ambient, walk) играют через <audio> из blob-URL. */
window.OSIL_AUDIO=(function(){
  const S='assets/sounds/';
  const SFX=['chop','hit_tree','hit_stone','jump','inventory_open','open','close','build','empty','rust-door-denied','player_scream','ak','headshot'];
  const LOOPS=['ambient','night','walk'];
  const AC=window.AudioContext||window.webkitAudioContext;
  let ctx=null, master=null; const buf={}, loops={};
  const vol={master:1,sfx:1,music:1,steps:1};
  function ensure(){ if(!ctx&&AC){ ctx=new AC(); master=ctx.createGain(); master.connect(ctx.destination);} return ctx; }
  async function fetchBuf(u){ const r=await fetch(u); if(!r.ok) throw 0; return r.arrayBuffer(); }
  /* загрузка одного звука; onDone вызывается всегда (даже при ошибке) */
  async function load(name){
    try{
      const ab=await fetchBuf(S+name+'.mp3');
      if(LOOPS.includes(name)){
        const a=new Audio(URL.createObjectURL(new Blob([ab],{type:'audio/mpeg'})));
        a.loop=true; a.preload='auto'; loops[name]=a;
      } else if(ensure()){
        buf[name]=await new Promise((res,rej)=>ctx.decodeAudioData(ab,res,rej));
      }
    }catch(e){}
  }
  function play(name,o){
    o=o||{}; if(!ctx||!buf[name]) return;
    if(ctx.state==='suspended') ctx.resume();
    const src=ctx.createBufferSource(), g=ctx.createGain();
    src.buffer=buf[name]; src.playbackRate.value=(o.rate||1)*(0.95+Math.random()*0.1);
    g.gain.value=(o.vol||1)*vol.sfx*vol.master; src.connect(g); g.connect(master); src.start();
  }
  function unlock(){ if(ensure()&&ctx.state==='suspended') ctx.resume(); }
  function music(name){
    Object.keys(loops).forEach(k=>{ if(k!=='walk'&&k!==name) loops[k].pause(); });
    const a=loops[name]; if(a){ a.volume=Math.min(1,0.45*vol.music*vol.master); a.play().catch(()=>{}); }
  }
  let walking=false;
  function walk(on,run){
    const a=loops.walk; if(!a) return;
    a.playbackRate=run?1.35:1; a.volume=Math.min(1,0.55*vol.steps*vol.master);
    if(on&&!walking){ a.play().catch(()=>{}); walking=true; }
    else if(!on&&walking){ a.pause(); walking=false; }
  }
  function setVolumes(o){
    for(const k in o) if(k in vol) vol[k]=o[k];
    Object.keys(loops).forEach(k=>{ if(k!=='walk') loops[k].volume=Math.min(1,0.45*vol.music*vol.master); });
  }
  function setVolume(v){ setVolumes({master:v}); }
  /* синтезированные звуки сатчела: писк и взрыв (файлов нет, генерируем) */
  function beep(o){   // короткий чистый электронный «пик»: синус 2.4 кГц + тихая гармоника, резкая атака, ~70 мс
    o=o||{}; if(!ensure()) return; if(ctx.state==='suspended') ctx.resume();
    const t=ctx.currentTime, v=(o.vol||0.6)*vol.sfx*vol.master*0.5, f=o.f||2400;
    const g=ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(v,t+0.003); g.gain.setValueAtTime(v,t+0.055); g.gain.linearRampToValueAtTime(0.0001,t+0.075);
    const a=ctx.createOscillator(); a.type='sine'; a.frequency.value=f; a.connect(g); a.start(t); a.stop(t+0.09);
    const h=ctx.createOscillator(), hg=ctx.createGain(); h.type='sine'; h.frequency.value=f*2; hg.gain.value=0.18; h.connect(hg); hg.connect(g); h.start(t); h.stop(t+0.09);
  }
  function boom(o){
    o=o||{}; if(!ensure()) return; if(ctx.state==='suspended') ctx.resume();
    const t=ctx.currentTime, len=1.3, n=Math.floor(ctx.sampleRate*len), b=ctx.createBuffer(1,n,ctx.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<n;i++){ const k=i/n; d[i]=(Math.random()*2-1)*Math.pow(1-k,2.2); }
    const src=ctx.createBufferSource(); src.buffer=b;
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(3200,t); lp.frequency.exponentialRampToValueAtTime(120,t+len);
    const g=ctx.createGain(), v=(o.vol||1)*vol.sfx*vol.master; g.gain.value=v;
    src.connect(lp); lp.connect(g); g.connect(master); src.start(t);
    const os=ctx.createOscillator(), og=ctx.createGain(); os.type='sine'; os.frequency.setValueAtTime(95,t); os.frequency.exponentialRampToValueAtTime(32,t+0.5);
    og.gain.setValueAtTime(v*0.9,t); og.gain.exponentialRampToValueAtTime(0.0001,t+0.6); os.connect(og); og.connect(master); os.start(t); os.stop(t+0.65);
  }
  /* треск горящей печки: процедурный шум, громкость по расстоянию (0..1) */
  let fNode=null;
  function furnace(v){
    if(!ensure()) return;
    if(!fNode){
      if(v<=0) return;
      const len=ctx.sampleRate*2, b=ctx.createBuffer(1,len,ctx.sampleRate), d=b.getChannelData(0); let lp=0;
      for(let i=0;i<len;i++){ lp+=(Math.random()*2-1-lp)*0.08; d[i]=lp*1.8+(Math.random()<0.0015?(Math.random()*2-1)*1.2:0)+(Math.random()<0.0004?(Math.random()*2-1)*2:0); }
      const src=ctx.createBufferSource(); src.buffer=b; src.loop=true;
      const f=ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=900; f.Q.value=0.5;
      const g=ctx.createGain(); g.gain.value=0; src.connect(f); f.connect(g); g.connect(master); src.start(); fNode={g};
    }
    fNode.g.gain.setTargetAtTime(v*0.55*vol.sfx*vol.master,ctx.currentTime,0.15);
  }
  return {SFX,LOOPS,load,play,music,walk,unlock,setVolume,setVolumes,beep,boom,furnace};
})();
