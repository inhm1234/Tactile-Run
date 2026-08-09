(()=>{
'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d');
const shell=document.getElementById('shell'),overlay=document.getElementById('overlay');
const startBtn=document.getElementById('startBtn'),installBtn=document.getElementById('installBtn');
const hpText=document.getElementById('hpText'),hpFill=document.getElementById('hpFill'),metersEl=document.getElementById('meters');
const comboN=document.getElementById('comboN'),comboT=document.getElementById('comboT'),toast=document.getElementById('toast'),hint=document.getElementById('hint'),bestText=document.getElementById('bestText'),soundStatus=document.getElementById('soundStatus');
let W=960,H=540,dpr=1,groundY=370,physicsScale=1,last=0,state='menu',deferredPrompt=null;
let audio=null,master=null,noiseBuffer=null;
let keyFlash=0,keyboardTravel=0,lastSteppedKey=null,pressedKeyId=null;

const SAMPLE_FILES={
 keyboard:['./keyboard1.wav','./keyboard2.wav','./keyboard3.wav','./keyboard4.wav'],
 wax:['./wax1.wav','./wax2.wav','./wax3.wav','./wax4.wav','./wax5.wav'],
 jelly:['./malrang1.wav','./malrang2.wav','./malrang3.wav'],
 bubble:['./bubble1.wav','./bubble2.wav','./bubble3.wav','./bubble4.wav']
};
const sampleState={
 keyboard:{last:-1,pool:[],cursor:0},
 wax:{last:-1,pool:[],cursor:0},
 jelly:{last:-1,pool:[],cursor:0},
 bubble:{last:-1,pool:[],cursor:0}
};
function prepareSamplePool(kind,size){
 const st=sampleState[kind]; if(st.pool.length)return;
 for(let i=0;i<size;i++){const a=new Audio();a.preload='auto';a.playsInline=true;st.pool.push(a)}
 for(const src of SAMPLE_FILES[kind]){const a=new Audio(src);a.preload='auto';a.load()}
}
function randomSampleIndex(kind){
 const files=SAMPLE_FILES[kind],st=sampleState[kind];let idx=(Math.random()*files.length)|0;
 if(files.length>1&&idx===st.last)idx=(idx+1+((Math.random()*(files.length-1))|0))%files.length;
 st.last=idx;return idx;
}
function playRecordedSample(kind,volume=1){
 const st=sampleState[kind],files=SAMPLE_FILES[kind];if(!st.pool.length)prepareSamplePool(kind,kind==='keyboard'||kind==='bubble'?4:3);
 const a=st.pool[st.cursor++%st.pool.length];a.pause();a.src=files[randomSampleIndex(kind)];a.currentTime=0;a.volume=Math.max(0,Math.min(1,volume));a.playbackRate=1;
 const pr=a.play();if(pr&&pr.catch)pr.catch(()=>{});
}
prepareSamplePool('keyboard',4);prepareSamplePool('wax',3);prepareSamplePool('jelly',3);prepareSamplePool('bubble',4);

const SPRITE_FILES={
 run:['./sprites/run1.png','./sprites/run2.png','./sprites/run3.png','./sprites/run4.png'],
 jump:['./sprites/jump1.png','./sprites/jump2.png'],
 slide:['./sprites/slide1.png','./sprites/slide2.png'],
 crouch:['./sprites/crouch1.png','./sprites/crouch2.png']
};
const sprites={run:[],jump:[],slide:[],crouch:[]};
for(const [action,files] of Object.entries(SPRITE_FILES)){
 for(const src of files){const im=new Image();im.decoding='async';im.src=src;sprites[action].push(im)}
}

const G=1700,JUMP=-690;
const TYPES={
 jelly:{label:'말랑',base:'#b46bff',edge:'#7d38c8',sound:'squish'},
 wax:{label:'왁스',base:'#ffad4b',edge:'#d96d28',sound:'crack'},
 bubble:{label:'뽁뽁',base:'#5ecdf8',edge:'#238fc2',sound:'pop'}
};
let player,objects,particles,distance,hp,combo,best,spawnX,speed,runTime,shake,flash;
best=Number(localStorage.getItem('tactileBest')||0);bestText.textContent=`BEST ${best}m`;

function resize(){
 const r=shell.getBoundingClientRect();W=r.width;H=r.height;dpr=Math.min(2,devicePixelRatio||1);
 canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=false;
 groundY=H*.69;physicsScale=Math.max(.62,Math.min(1.05,H/620));
 if(player&&player.onGround)player.y=groundY-player.h;
}
addEventListener('resize',resize);resize();

function initAudio(){
 if(audio)return;audio=new (window.AudioContext||window.webkitAudioContext)();master=audio.createGain();master.gain.value=.22;master.connect(audio.destination);
 const len=audio.sampleRate*.35;noiseBuffer=audio.createBuffer(1,len,audio.sampleRate);const d=noiseBuffer.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
 soundStatus.textContent='🔊 실제 ASMR 샘플 ON';
}
function envGain(t0,attack,decay,peak=.8){const g=audio.createGain();g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(peak,t0+attack);g.gain.exponentialRampToValueAtTime(.001,t0+attack+decay);g.connect(master);return g}
function playSound(kind,perfect=false){
 if(!audio)return;const t=audio.currentTime;
 if(kind==='pop'){
  for(let i=0;i<(perfect?5:3);i++){let o=audio.createOscillator(),g=envGain(t+i*.025,.002,.055,.42);o.type='sine';o.frequency.setValueAtTime(260+Math.random()*180,t+i*.025);o.frequency.exponentialRampToValueAtTime(90,t+i*.08);o.connect(g);o.start(t+i*.025);o.stop(t+i*.1)}
 }else if(kind==='crack'){
  const s=audio.createBufferSource(),f=audio.createBiquadFilter(),g=envGain(t,.002,perfect?.22:.14,.7);s.buffer=noiseBuffer;f.type='bandpass';f.frequency.value=perfect?1500:1100;f.Q.value=.7;s.connect(f);f.connect(g);s.start(t);s.stop(t+.25);
 }else{
  let o=audio.createOscillator(),g=envGain(t,.015,.18,.42);o.type='sine';o.frequency.setValueAtTime(perfect?105:90,t);o.frequency.exponentialRampToValueAtTime(45,t+.2);o.connect(g);o.start(t);o.stop(t+.22);
  const s=audio.createBufferSource(),f=audio.createBiquadFilter(),ng=envGain(t,.01,.12,.18);s.buffer=noiseBuffer;f.type='lowpass';f.frequency.value=450;s.connect(f);f.connect(ng);s.start(t);s.stop(t+.15);
 }
}
function jumpSound(){if(!audio)return;const t=audio.currentTime,o=audio.createOscillator(),g=envGain(t,.002,.07,.18);o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(210,t+.07);o.connect(g);o.start(t);o.stop(t+.08)}
function playBlueSwitch(accent=false){playRecordedSample('keyboard',accent?.78:.52)}

function keyboardMetrics(){
 const keyW=Math.max(45,W*.13)*.60;
 const gap=5,stride=keyW+gap;
 return {keyW,gap,stride};
}
function groundKeyUnderPlayer(){
 if(!player||!player.onGround)return null;
 const {keyW,stride}=keyboardMetrics();
 const travel=keyboardTravel;
 const cycle=Math.floor(travel/stride),scroll=travel-cycle*stride;
 const footX=player.x+player.w*.50;
 const localIndex=Math.floor((footX+scroll)/stride);
 const keyX=localIndex*stride-scroll;
 if(footX<keyX||footX>keyX+keyW)return null;
 return localIndex+cycle;
}
function triggerKeyboardContact(accent=false){
 const keyId=groundKeyUnderPlayer();
 if(keyId===null)return;
 if(keyId!==lastSteppedKey){
  lastSteppedKey=keyId;pressedKeyId=keyId;keyFlash=.12;playBlueSwitch(accent);
 }
}

function setAction(action){if(!player||player.action===action)return;player.action=action;player.actionTime=0}
function reset(){
 player={x:W*.16,y:groundY-68,w:58,h:68,vy:0,onGround:true,action:'run',actionTime:0,slideTimer:0,crouchHeld:false};
 objects=[];particles=[];distance=0;hp=100;combo=0;spawnX=W+100;speed=Math.max(220,Math.min(315,H*.60));runTime=0;shake=0;flash=0;keyFlash=0;keyboardTravel=0;lastSteppedKey=null;pressedKeyId=null;
 for(let i=0;i<6;i++)spawnObject(i<2?W+160+i*180:undefined);updateHud();
}
function spawnObject(xOverride){
 const keys=Object.keys(TYPES),type=keys[(Math.random()*keys.length)|0];
 const w=type==='bubble'?72:60+Math.random()*18,h=type==='jelly'?34:type==='wax'?28:24;
 const gap=115+Math.random()*115,x=xOverride??Math.max(W+80,spawnX+gap);
 objects.push({x,y:groundY-h,w,h,type,hit:false,burst:false,compress:0,seed:Math.random()*999});spawnX=x+w;
}
function wakeAudio(){initAudio();if(audio.state==='suspended')audio.resume()}
function doJump(){
 if(state!=='playing'||!player.onGround)return;wakeAudio();player.slideTimer=0;player.crouchHeld=false;player.vy=JUMP*physicsScale;player.onGround=false;setAction('jump');jumpSound();hint.style.opacity=.15;if(navigator.vibrate)navigator.vibrate(8);
}
function doSlide(){
 if(state!=='playing'||!player.onGround)return;wakeAudio();player.crouchHeld=false;player.slideTimer=.55;setAction('slide');hint.style.opacity=.15;if(navigator.vibrate)navigator.vibrate(7);
}
function startCrouch(){
 if(state!=='playing')return;wakeAudio();player.crouchHeld=true;player.slideTimer=0;if(player.onGround)setAction('crouch');
}
function stopCrouch(){
 if(!player)return;player.crouchHeld=false;if(state==='playing'&&player.onGround&&player.slideTimer<=0)setAction('run');
}
function burst(o,perfect){
 if(o.burst)return;o.burst=true;o.hit=true;o.compress=1;combo=perfect?combo+1:Math.max(1,combo);hp=Math.min(100,hp+(perfect?5:2));shake=perfect?8:4;flash=perfect?.22:.08;
 if(o.type==='wax')playRecordedSample('wax',perfect?.95:.84);
 else if(o.type==='jelly')playRecordedSample('jelly',perfect?.92:.80);
 else if(o.type==='bubble')playRecordedSample('bubble',perfect?.92:.82);
 else playSound(TYPES[o.type].sound,perfect);
 if(navigator.vibrate)navigator.vibrate(perfect?[14,18,20]:10);
 const cx=o.x+o.w/2,cy=o.y+o.h/2;for(let i=0;i<(perfect?18:11);i++){let a=Math.random()*Math.PI*2,s=70+Math.random()*240;particles.push({x:cx,y:cy,vx:Math.cos(a)*s,vy:Math.sin(a)*s-100,r:2+Math.random()*6,life:.35+Math.random()*.35,color:TYPES[o.type].base})}
 showToast(perfect?'PERFECT!':TYPES[o.type].label+'!');
}
function showToast(text){toast.textContent=text;toast.classList.remove('show');void toast.offsetWidth;toast.classList.add('show')}
function updateHud(){hpText.textContent=Math.max(0,Math.ceil(hp));hpFill.style.transform=`scaleX(${Math.max(0,hp)/100})`;metersEl.textContent=Math.floor(distance);comboN.textContent=combo>=2?`×${combo}`:'';comboT.textContent=combo>=2?'CRUNCH COMBO':''}
function gameOver(){
 state='over';const m=Math.floor(distance);if(m>best){best=m;localStorage.setItem('tactileBest',best)}
 bestText.textContent=`BEST ${best}m`;document.querySelector('.title').innerHTML=`${m}m<br>달렸어!`;document.querySelector('.sub').innerHTML=`최고 콤보를 이어서 더 멀리 가보자.<br><b>정중앙 착지 = PERFECT + 체력 회복</b>`;startBtn.textContent='다시 달리기';overlay.style.display='grid';
}

function step(dt){
 if(state!=='playing')return;
 runTime+=dt;distance+=speed*dt*.035;speed=Math.min(330,speed+dt*2.2);hp-=dt*(2.5+speed/280);if(hp<=0){hp=0;updateHud();gameOver();return}
 player.actionTime+=dt;
 if(player.slideTimer>0)player.slideTimer=Math.max(0,player.slideTimer-dt);
 player.vy+=G*physicsScale*dt;player.y+=player.vy*dt;
 const wasGrounded=player.onGround;
 keyboardTravel+=speed*dt*.38;
 if(player.y+player.h>=groundY){
  player.y=groundY-player.h;player.vy=0;player.onGround=true;
 }else{
  player.onGround=false;
  lastSteppedKey=null;
 }

 if(player.onGround){
  if(player.slideTimer>0)setAction('slide');else if(player.crouchHeld)setAction('crouch');else setAction('run');
  triggerKeyboardContact(!wasGrounded||player.action==='slide');
 }else setAction('jump');

 for(const o of objects){
  o.x-=speed*dt;if(o.compress>0)o.compress=Math.max(0,o.compress-dt*2.8);
  if(!o.burst&&player.vy>80){
   const px1=player.x+7,px2=player.x+player.w-7,py=player.y+player.h;
   if(px2>o.x&&px1<o.x+o.w&&py>=o.y&&py<=o.y+Math.min(28,o.h+12)){
    player.y=o.y-player.h+5;player.vy=-215;player.onGround=false;setAction('jump');const pc=player.x+player.w/2,oc=o.x+o.w/2;const perfect=Math.abs(pc-oc)<o.w*.22;burst(o,perfect);
   }
  }
 }
 objects=objects.filter(o=>o.x>-120);particles=particles.filter(p=>p.life>0);
 for(const p of particles){p.life-=dt;p.vy+=650*dt;p.x+=p.vx*dt;p.y+=p.vy*dt}
 while(spawnX<W+900)spawnObject();spawnX-=speed*dt;
 shake*=Math.pow(.02,dt);flash*=Math.pow(.02,dt);keyFlash*=Math.pow(.006,dt);updateHud();
}

function roundedRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function drawBackground(t){
 ctx.fillStyle='#dff4ff';ctx.fillRect(0,0,W,groundY-8);
 ctx.fillStyle='#fff';ctx.globalAlpha=.72;for(let i=0;i<5;i++){let x=((i*137-t*10)%(W+180))-80,y=90+(i%3)*90;ctx.beginPath();ctx.ellipse(x,y,38,16,0,0,Math.PI*2);ctx.ellipse(x+31,y+4,28,13,0,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;
 ctx.fillStyle='#20242c';ctx.fillRect(0,groundY-9,W,H-groundY+9);ctx.fillStyle='#141820';ctx.fillRect(0,groundY-8,W,5);
 const labels=['Q','W','E','R','T','Y','U','I','O','P','A','S','D','F','G','H','J','K','L','Z','X','C','V','B','N','M'];
 const {keyW,gap,stride}=keyboardMetrics(),cycle=Math.floor(keyboardTravel/stride),scroll=keyboardTravel-cycle*stride;
 const rows=[{y:groundY-6,h:39,offset:0,scale:1},{y:groundY+38,h:43,offset:keyW*.42,scale:1.04},{y:groundY+86,h:48,offset:-keyW*.18,scale:1.09},{y:groundY+139,h:52,offset:keyW*.30,scale:1.15}];
 for(let r=0;r<rows.length;r++){
  const row=rows[r],kw=keyW*row.scale,st=kw+gap*row.scale,rowScroll=(scroll*row.scale)%st;
  for(let i=-3;i<Math.ceil(W/st)+4;i++){
   const x=i*st-rowScroll+row.offset,worldId=i+Math.floor(keyboardTravel/st),idx=((worldId+r*5)%labels.length+labels.length)%labels.length;
   const pressed=r===0&&worldId===pressedKeyId&&keyFlash>.025,press=pressed?Math.min(5,2+keyFlash*18):0;
   ctx.fillStyle='#0b0e13';roundedRect(x,row.y+5,kw,row.h,7);ctx.fill();ctx.fillStyle=pressed?'#39414c':'#444d5a';roundedRect(x+1,row.y+2+press,kw-2,row.h-5,7);ctx.fill();ctx.fillStyle=pressed?'#7a8795':'#66717f';roundedRect(x+3,row.y+press,kw-6,row.h-9,6);ctx.fill();
   ctx.strokeStyle='#8994a2';ctx.globalAlpha=.35;ctx.lineWidth=1;ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle='#e8edf3';ctx.globalAlpha=.82;ctx.font=`700 ${Math.max(9,11*row.scale)}px system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(labels[idx],x+kw/2,row.y+press+(row.h-9)/2);ctx.globalAlpha=1;
   if(pressed){ctx.fillStyle='#47b8ff';ctx.globalAlpha=Math.min(.9,keyFlash*6);roundedRect(x+kw*.37,row.y+row.h-4,kw*.26,5,2);ctx.fill();ctx.globalAlpha=1}
  }
 }
 ctx.fillStyle='#a6dff8';ctx.globalAlpha=.45;ctx.fillRect(0,groundY-9,W,2);ctx.globalAlpha=1;
}
function drawObject(o){
 const T=TYPES[o.type],comp=o.burst?Math.max(.08,o.compress):1-o.compress*.55;ctx.save();ctx.translate(o.x+o.w/2,o.y+o.h);ctx.scale(1+(1-comp)*.35,comp);ctx.translate(-o.w/2,-o.h);
 if(o.type==='bubble'){
  ctx.fillStyle='#bfeeff';roundedRect(0,4,o.w,o.h-4,10);ctx.fill();ctx.strokeStyle='#6dc9eb';ctx.lineWidth=2;ctx.stroke();for(let i=0;i<5;i++){let bx=10+i*(o.w-20)/4;ctx.fillStyle=i%2?'#72d7ff':'#91e3ff';ctx.beginPath();ctx.arc(bx,7,7,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#45a9ce';ctx.stroke()}
 }else if(o.type==='wax'){
  ctx.fillStyle=T.edge;roundedRect(0,3,o.w,o.h,14);ctx.fill();ctx.fillStyle=T.base;roundedRect(2,0,o.w-4,o.h-5,14);ctx.fill();ctx.fillStyle='#ffd88f';ctx.globalAlpha=.6;ctx.beginPath();ctx.ellipse(o.w*.36,o.h*.28,o.w*.18,4,-.2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
 }else{
  ctx.fillStyle=T.edge;roundedRect(0,4,o.w,o.h,16);ctx.fill();ctx.fillStyle=T.base;roundedRect(2,0,o.w-4,o.h-5,16);ctx.fill();ctx.fillStyle='#d9b6ff';ctx.globalAlpha=.65;ctx.beginPath();ctx.ellipse(o.w*.35,o.h*.26,o.w*.17,5,-.2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
 }
 ctx.restore();
}
function currentSprite(){
 let action=player.onGround?player.action:'jump',idx=0;
 if(action==='run')idx=Math.floor(player.actionTime/.095)%4;
 else if(action==='jump')idx=player.vy<35?0:1;
 else if(action==='slide')idx=Math.floor(player.actionTime/.12)%2;
 else if(action==='crouch')idx=player.actionTime<.13?0:1;
 return {action,img:sprites[action][idx]};
}
function drawPlayer(){
 const p=player,{action,img}=currentSprite(),scale=Math.max(.72,Math.min(1.18,H/540));
 const baseline=p.y+p.h,centerX=p.x+p.w/2;
 const jumpHeight=Math.max(0,groundY-baseline),shadowScale=Math.max(.45,1-jumpHeight/(H*.48));
 ctx.save();ctx.globalAlpha=.18*shadowScale;ctx.fillStyle='#16202a';ctx.beginPath();ctx.ellipse(centerX,groundY+4,34*shadowScale,7*shadowScale,0,0,Math.PI*2);ctx.fill();ctx.restore();
 if(!img||!img.complete||!img.naturalWidth)return;
 let targetH=88*scale,xOffset=0,yOffset=2;
 if(action==='jump'){targetH=84*scale;yOffset=0}
 if(action==='slide'){targetH=64*scale;xOffset=34*scale;yOffset=3}
 if(action==='crouch'){targetH=61*scale;yOffset=3}
 const targetW=targetH*(img.naturalWidth/img.naturalHeight),drawX=centerX-targetW/2+xOffset,drawY=baseline-targetH+yOffset;
 ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(img,Math.round(drawX),Math.round(drawY),Math.round(targetW),Math.round(targetH));ctx.restore();
}
function render(t){
 ctx.save();if(shake>.1)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);drawBackground(t);
 for(const o of objects)drawObject(o);for(const p of particles){ctx.globalAlpha=Math.max(0,p.life*2);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;
 if(player)drawPlayer();if(flash>.01){ctx.fillStyle=`rgba(255,255,255,${flash})`;ctx.fillRect(0,0,W,H)}ctx.restore();
}
function loop(ts){const dt=Math.min(.033,(ts-last)/1000||0);last=ts;step(dt);render(ts/1000);requestAnimationFrame(loop)}
function start(){wakeAudio();reset();state='playing';overlay.style.display='none';document.querySelector('.title').innerHTML='촉감런<br>ASMR PROTO';document.querySelector('.sub').innerHTML='키보드 위를 달리며 ASMR을 듣고<br>점프해 <b>왁스볼·말랑이·뽁뽁이</b>를 터뜨려봐.';startBtn.textContent='탭해서 시작'}

startBtn.addEventListener('click',e=>{e.stopPropagation();start()});
shell.addEventListener('pointerdown',e=>{if(e.target.tagName==='BUTTON')return;doJump()});
addEventListener('keydown',e=>{
 if(['Space','ArrowUp','ArrowDown','KeyS','KeyW','ShiftLeft','ShiftRight'].includes(e.code))e.preventDefault();
 if((e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW')&&!e.repeat)doJump();
 else if((e.code==='ShiftLeft'||e.code==='ShiftRight')&&!e.repeat)doSlide();
 else if((e.code==='ArrowDown'||e.code==='KeyS')&&!e.repeat)startCrouch();
});
addEventListener('keyup',e=>{if(e.code==='ArrowDown'||e.code==='KeyS')stopCrouch()});
addEventListener('blur',stopCrouch);
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;installBtn.style.display='block'});
installBtn.addEventListener('click',async e=>{e.stopPropagation();if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;installBtn.style.display='none'});
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
reset();state='menu';loop(performance.now());
})();
