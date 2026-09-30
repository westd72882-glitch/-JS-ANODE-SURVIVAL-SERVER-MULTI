/* Звуковая система: короткие SFX декодируются в буферы WebAudio,
   длинные (ambient, walk) играют через <audio> из blob-URL. */
window.OSIL_AUDIO=(function(){
  const S='assets/sounds/';
  const SFX=['chop','hit_tree','hit_stone','jump','inventory_open','open','close','build','empty','rust-door-denied','player_scream','ak'];
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
  return {SFX,LOOPS,load,play,music,walk,unlock,setVolume,setVolumes};
})();
