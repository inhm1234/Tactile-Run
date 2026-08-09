(()=>{
'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d');
const shell=document.getElementById('shell'),overlay=document.getElementById('overlay');
const startBtn=document.getElementById('startBtn'),installBtn=document.getElementById('installBtn');
const hpText=document.getElementById('hpText'),hpFill=document.getElementById('hpFill'),metersEl=document.getElementById('meters');
const comboN=document.getElementById('comboN'),comboT=document.getElementById('comboT'),toast=document.getElementById('toast'),hint=document.getElementById('hint'),bestText=document.getElementById('bestText'),soundStatus=document.getElementById('soundStatus');
let W=390,H=844,dpr=1,groundY=680,raf=0,last=0,state='menu',deferredPrompt=null;
let audio=null,master=null,noiseBuffer=null;
const G=1700, JUMP=-690;
const TYPES={
 jelly:{label:'말랑',base:'#b46bff',edge:'#7d38c8',sound:'squish'},
 wax:{label:'왁스',base:'#ffad4b',edge:'#d96d28',sound:'crack'},
 bubble:{label:'뽁뽁',base:'#5ecdf8',edge:'#238fc2',sound:'pop'}
};
let player,objects,particles,distance,hp,combo,best,spawnX,speed,runTime,shake,flash;
best=Number(localStorage.getItem('tactileBest')||0); bestText.textContent=`BEST ${best}m`;

function resize(){
  const r=shell.getBoundingClientRect();W=r.width;H=r.height;dpr=Math.min(2,devicePixelRatio||1);
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);groundY=H*.79;
}
addEventListener('resize',resize);resize();

function initAudio(){
 if(audio)return; audio=new (window.AudioContext||window.webkitAudioContext)(); master=audio.createGain();master.gain.value=.22;master.connect(audio.destination);
 const len=audio.sampleRate*.35;noiseBuffer=audio.createBuffer(1,len,audio.sampleRate);const d=noiseBuffer.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
 soundStatus.textContent='🔊 ASMR 사운드 ON';
}
function envGain(t0,attack,decay,peak=.8){const g=audio.createGain();g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(peak,t0+attack);g.gain.exponentialRampToValueAtTime(.001,t0+attack+decay);g.connect(master);return g}
function playSound(kind,perfect=false){
 if(!audio)return; const t=audio.currentTime;
 if(kind==='pop'){
   for(let i=0;i<(perfect?5:3);i++){let o=audio.createOscillator(),g=envGain(t+i*.025,.002,.055,.42);o.type='sine';o.frequency.setValueAtTime(260+Math.random()*180,t+i*.025);o.frequency.exponentialRampToValueAtTime(90,t+i*.08);o.connect(g);o.start(t+i*.025);o.stop(t+i*.1)}
 } else if(kind==='crack'){
   const s=audio.createBufferSource(),f=audio.createBiquadFilter(),g=envGain(t,.002,perfect?.22:.14,.7);s.buffer=noiseBuffer;f.type='bandpass';f.frequency.value=perfect?1500:1100;f.Q.value=.7;s.connect(f);f.connect(g);s.start(t);s.stop(t+.25);
   let o=audio.createOscillator(),og=envGain(t,.001,.11,.25);o.type='triangle';o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(55,t+.12);o.connect(og);o.start(t);o.stop(t+.14);
 } else {
   let o=audio.createOscillator(),g=envGain(t,.015,.18,.42);o.type='sine';o.frequency.setValueAtTime(perfect?105:90,t);o.frequency.exponentialRampToValueAtTime(45,t+.2);o.connect(g);o.start(t);o.stop(t+.22);
   const s=audio.createBufferSource(),f=audio.createBiquadFilter(),ng=envGain(t,.01,.12,.18);s.buffer=noiseBuffer;f.type='lowpass';f.frequency.value=450;s.connect(f);f.connect(ng);s.start(t);s.stop(t+.15);
 }
}
function jumpSound(){if(!audio)return;const t=audio.currentTime,o=audio.createOscillator(),g=envGain(t,.002,.07,.18);o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(210,t+.07);o.connect(g);o.start(t);o.stop(t+.08)}

function reset(){
 player={x:W*.23,y:groundY-56,w:42,h:56,vy:0,onGround:true,rot:0,squash:0};objects=[];particles=[];distance=0;hp=100;combo=0;spawnX=W+100;speed=Math.max(220,W*.58);runTime=0;shake=0;flash=0;
 for(let i=0;i<6;i++)spawnObject(i<2?W+160+i*180:undefined);
 updateHud();
}
function spawnObject(xOverride){
 const keys=Object.keys(TYPES),type=keys[(Math.random()*keys.length)|0];
 const w=type==='bubble'?72:60+Math.random()*18; const h=type==='jelly'?34:type==='wax'?28:24;
 const gap=115+Math.random()*115; const x=xOverride??Math.max(W+80,spawnX+gap);
 objects.push({x,y:groundY-h,w,h,type,hit:false,burst:false,compress:0,seed:Math.random()*999}); spawnX=x+w;
}
function doJump(){
 if(state!=='playing')return;initAudio(); if(audio.state==='suspended')audio.resume();
 if(player.onGround){player.vy=JUMP;player.onGround=false;player.squash=-.15;jumpSound();hint.style.opacity=.15; if(navigator.vibrate)navigator.vibrate(8)}
}
function burst(o,perfect){
 if(o.burst)return;o.burst=true;o.hit=true;o.compress=1;combo=perfect?combo+1:Math.max(1,combo);hp=Math.min(100,hp+(perfect?5:2));shake=perfect?8:4;flash=perfect?.22:.08;playSound(TYPES[o.type].sound,perfect);
 if(navigator.vibrate)navigator.vibrate(perfect?[14,18,20]:10);
 const cx=o.x+o.w/2,cy=o.y+o.h/2;for(let i=0;i<(perfect?18:11);i++){let a=Math.random()*Math.PI*2,s=70+Math.random()*240;particles.push({x:cx,y:cy,vx:Math.cos(a)*s,vy:Math.sin(a)*s-100,r:2+Math.random()*6,life:.35+Math.random()*.35,color:TYPES[o.type].base})}
 showToast(perfect?'PERFECT!':TYPES[o.type].label+'!');
}
function showToast(text){toast.textContent=text;toast.classList.remove('show');void toast.offsetWidth;toast.classList.add('show')}
function updateHud(){hpText.textContent=Math.max(0,Math.ceil(hp));hpFill.style.transform=`scaleX(${Math.max(0,hp)/100})`;metersEl.textContent=Math.floor(distance);comboN.textContent=combo>=2?`×${combo}`:'';comboT.textContent=combo>=2?'CRUNCH COMBO':''}
function gameOver(){
 state='over'; const m=Math.floor(distance); if(m>best){best=m;localStorage.setItem('tactileBest',best)}
 bestText.textContent=`BEST ${best}m`; document.querySelector('.title').innerHTML=`${m}m<br>달렸어!`;document.querySelector('.sub').innerHTML=`최고 콤보를 이어서 더 멀리 가보자.<br><b>정중앙 착지 = PERFECT + 체력 회복</b>`;startBtn.textContent='다시 달리기';overlay.style.display='grid';
}
function step(dt){
 if(state!=='playing')return;runTime+=dt;distance+=speed*dt*.035;speed=Math.min(330,speed+dt*2.2);hp-=dt*(2.5+speed/280); if(hp<=0){hp=0;updateHud();gameOver();return}
 player.vy+=G*dt;player.y+=player.vy*dt;player.rot+=(player.onGround?0:(player.vy>0?1.8:-1.2))*dt;
 if(player.y+player.h>=groundY){player.y=groundY-player.h;player.vy=0;player.onGround=true;player.rot*=.6}
 for(const o of objects){o.x-=speed*dt;if(o.compress>0)o.compress=Math.max(0,o.compress-dt*2.8);
   if(!o.burst && player.vy>80){const px1=player.x+7,px2=player.x+player.w-7,py=player.y+player.h; if(px2>o.x&&px1<o.x+o.w&&py>=o.y&&py<=o.y+Math.min(28,o.h+12)){
      player.y=o.y-player.h+5; player.vy=-215; player.onGround=false; player.squash=.25; const pc=player.x+player.w/2,oc=o.x+o.w/2;const perfect=Math.abs(pc-oc)<o.w*.22;burst(o,perfect);
   }}
 }
 objects=objects.filter(o=>o.x>-120);particles=particles.filter(p=>p.life>0);for(const p of particles){p.life-=dt;p.vy+=650*dt;p.x+=p.vx*dt;p.y+=p.vy*dt}
 while(spawnX< W+900){spawnObject()} spawnX-=speed*dt;
 if(player.squash!==0)player.squash*=Math.pow(.02,dt);shake*=Math.pow(.02,dt);flash*=Math.pow(.02,dt);updateHud();
}
function roundedRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function drawBackground(t){
 ctx.fillStyle='#dff4ff';ctx.fillRect(0,0,W,groundY);ctx.fillStyle='#fff3d8';ctx.fillRect(0,groundY,W,H-groundY);
 ctx.fillStyle='#fff';ctx.globalAlpha=.72;for(let i=0;i<5;i++){let x=((i*137-t*10)% (W+180))-80,y=90+(i%3)*90;ctx.beginPath();ctx.ellipse(x,y,38,16,0,0,Math.PI*2);ctx.ellipse(x+31,y+4,28,13,0,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;
 ctx.fillStyle='#ead8a6';ctx.fillRect(0,groundY,W,5);for(let x=-((t*speed*.3)%34);x<W;x+=34){ctx.fillStyle='#e6c88c';ctx.beginPath();ctx.ellipse(x+8,groundY+32,5,2,0,0,Math.PI*2);ctx.fill()}
}
function drawObject(o){
 const T=TYPES[o.type],comp=o.burst?Math.max(.08,o.compress):1-o.compress*.55; ctx.save();ctx.translate(o.x+o.w/2,o.y+o.h);ctx.scale(1+(1-comp)*.35,comp);ctx.translate(-o.w/2,-o.h);
 if(o.type==='bubble'){
   ctx.fillStyle='#bfeeff';roundedRect(0,4,o.w,o.h-4,10);ctx.fill();ctx.strokeStyle='#6dc9eb';ctx.lineWidth=2;ctx.stroke();for(let i=0;i<5;i++){let bx=10+i*(o.w-20)/4;ctx.fillStyle=i%2?'#72d7ff':'#91e3ff';ctx.beginPath();ctx.arc(bx,7,7,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#45a9ce';ctx.stroke()}
 }else if(o.type==='wax'){
   ctx.fillStyle=T.edge;roundedRect(0,3,o.w,o.h,14);ctx.fill();ctx.fillStyle=T.base;roundedRect(2,0,o.w-4,o.h-5,14);ctx.fill();ctx.fillStyle='#ffd88f';ctx.globalAlpha=.6;ctx.beginPath();ctx.ellipse(o.w*.36,o.h*.28,o.w*.18,4,-.2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
 }else{
   ctx.fillStyle=T.edge;roundedRect(0,4,o.w,o.h,16);ctx.fill();ctx.fillStyle=T.base;roundedRect(2,0,o.w-4,o.h-5,16);ctx.fill();ctx.fillStyle='#d9b6ff';ctx.globalAlpha=.65;ctx.beginPath();ctx.ellipse(o.w*.35,o.h*.26,o.w*.17,5,-.2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
 }
 ctx.restore();
}
function drawPlayer(){
 const p=player;ctx.save();ctx.translate(p.x+p.w/2,p.y+p.h/2);ctx.rotate(p.rot);const sy=1-p.squash,sx=1+p.squash*.55;ctx.scale(sx,sy);ctx.translate(-p.w/2,-p.h/2);
 // shadow-ish feet
 ctx.fillStyle='#574339';ctx.beginPath();ctx.ellipse(9,52,11,5,-.1,0,Math.PI*2);ctx.ellipse(33,52,11,5,.1,0,Math.PI*2);ctx.fill();
 // ears
 ctx.fillStyle='#f6dfca';roundedRect(5,-16,10,31,7);ctx.fill();roundedRect(27,-16,10,31,7);ctx.fill();ctx.fillStyle='#f3adba';roundedRect(8,-11,4,21,4);ctx.fill();roundedRect(30,-11,4,21,4);ctx.fill();
 // body/head
 ctx.fillStyle='#fff8ef';roundedRect(3,5,36,39,17);ctx.fill();ctx.strokeStyle='#6f5649';ctx.lineWidth=2;ctx.stroke();
 ctx.fillStyle='#2f2927';ctx.beginPath();ctx.arc(14,20,2.3,0,Math.PI*2);ctx.arc(29,20,2.3,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#b37179';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(21.5,26,3,0,Math.PI);ctx.stroke();
 ctx.fillStyle='#ff8a72';roundedRect(5,38,32,11,6);ctx.fill();ctx.restore();
}
function render(t){
 ctx.save();if(shake>.1)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);drawBackground(t);
 for(const o of objects)drawObject(o);for(const p of particles){ctx.globalAlpha=Math.max(0,p.life*2);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;
 if(player)drawPlayer();if(flash>.01){ctx.fillStyle=`rgba(255,255,255,${flash})`;ctx.fillRect(0,0,W,H)}ctx.restore();
}
function loop(ts){const dt=Math.min(.033,(ts-last)/1000||0);last=ts;step(dt);render(ts/1000);raf=requestAnimationFrame(loop)}
function start(){initAudio();if(audio.state==='suspended')audio.resume();reset();state='playing';overlay.style.display='none';document.querySelector('.title').innerHTML='촉감런<br>ASMR PROTO';document.querySelector('.sub').innerHTML='말랑이·왁스볼·뽁뽁이를 밟아 터뜨리며<br><b>최대한 멀리</b> 가는 1시간 프로토타입.';startBtn.textContent='탭해서 시작';doJump()}
startBtn.addEventListener('click',e=>{e.stopPropagation();start()});shell.addEventListener('pointerdown',e=>{if(e.target.tagName==='BUTTON')return;doJump()});
addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='ArrowUp')doJump()});
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;installBtn.style.display='block'});installBtn.addEventListener('click',async e=>{e.stopPropagation();if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;installBtn.style.display='none'});
if('serviceWorker' in navigator) addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
reset();state='menu';loop(performance.now());
})();
