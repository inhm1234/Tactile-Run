(()=>{
'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
const shell=document.getElementById('shell'),overlay=document.getElementById('overlay');
const startBtn=document.getElementById('startBtn'),installBtn=document.getElementById('installBtn'),openChromeBtn=document.getElementById('openChromeBtn'),installHelp=document.getElementById('installHelp');
const hpText=document.getElementById('hpText'),hpFill=document.getElementById('hpFill'),metersEl=document.getElementById('meters');
const comboN=document.getElementById('comboN'),comboT=document.getElementById('comboT'),toast=document.getElementById('toast'),hint=document.getElementById('hint'),bestText=document.getElementById('bestText'),soundStatus=document.getElementById('soundStatus');

let W=960,H=540,dpr=1,groundY=370,physicsScale=1,last=0,state='menu',deferredPrompt=null;
let audio=null,master=null,noiseBuffer=null,audioReady=false,audioLoadPromise=null;
let keyFlash=0,keyboardTravel=0,lastSteppedKey=null,pressedKeyId=null,hudClock=0;
let keyboardCache=[],objectSprites={},renderSeed=0,skyGradient=null,plateGradient=null;

const SAMPLE_FILES={
 keyboard:['./KEY_1.wav','./KEY_2.wav','./KEY_3.wav','./KEY_4.wav','./KEY_5.wav'],
 wax:['./wax1.wav','./wax2.wav','./wax3.wav','./wax4.wav','./wax5.wav'],
 jelly:['./malrang1.wav','./malrang2.wav','./malrang3.wav'],
 bubble:['./bubble1.wav','./bubble2.wav','./bubble3.wav','./bubble4.wav']
};
const sampleState={keyboard:{last:-1},wax:{last:-1},jelly:{last:-1},bubble:{last:-1}};
const rawAudio={keyboard:[],wax:[],jelly:[],bubble:[]},audioBuffers={keyboard:[],wax:[],jelly:[],bubble:[]};

function preloadRawAudio(){
 if(audioLoadPromise)return audioLoadPromise;
 audioLoadPromise=Promise.all(Object.entries(SAMPLE_FILES).flatMap(([kind,files])=>files.map(async(src,i)=>{
  try{const r=await fetch(src,{cache:'force-cache'});if(!r.ok)throw new Error(String(r.status));rawAudio[kind][i]=await r.arrayBuffer()}catch(_){rawAudio[kind][i]=null}
 }))).then(()=>true).catch(()=>false);
 return audioLoadPromise;
}
preloadRawAudio();

function randomSampleIndex(kind){
 const files=SAMPLE_FILES[kind],st=sampleState[kind];let idx=(Math.random()*files.length)|0;
 if(files.length>1&&idx===st.last)idx=(idx+1+((Math.random()*(files.length-1))|0))%files.length;
 st.last=idx;return idx;
}
async function initAudio(){
 if(!audio){
  audio=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});
  master=audio.createGain();master.gain.value=.76;master.connect(audio.destination);
  const len=Math.max(1,Math.floor(audio.sampleRate*.24));noiseBuffer=audio.createBuffer(1,len,audio.sampleRate);const d=noiseBuffer.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
 }
 if(audio.state==='suspended')await audio.resume().catch(()=>{});
 if(audioReady)return;
 soundStatus.textContent='🔊 사운드 준비중…';
 await preloadRawAudio();
 const jobs=[];
 for(const [kind,list] of Object.entries(rawAudio)){
  list.forEach((ab,i)=>{if(ab)jobs.push(audio.decodeAudioData(ab.slice(0)).then(b=>{audioBuffers[kind][i]=b}).catch(()=>{}))});
 }
 await Promise.all(jobs);
 audioReady=true;soundStatus.textContent='🔊 실제 ASMR 샘플 ON';
}
function playRecordedSample(kind,volume=1){
 if(!audio||!audioReady)return;
 const idx=randomSampleIndex(kind),buffer=audioBuffers[kind][idx];if(!buffer)return;
 const src=audio.createBufferSource(),gain=audio.createGain();gain.gain.value=Math.max(0,Math.min(1,volume));src.buffer=buffer;src.connect(gain);gain.connect(master);src.start();
}
function envGain(t0,attack,decay,peak=.8){const g=audio.createGain();g.gain.setValueAtTime(.0001,t0);g.gain.linearRampToValueAtTime(peak,t0+attack);g.gain.exponentialRampToValueAtTime(.001,t0+attack+decay);g.connect(master);return g}
function jumpSound(){if(!audio)return;const t=audio.currentTime,o=audio.createOscillator(),g=envGain(t,.002,.07,.10);o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(205,t+.07);o.connect(g);o.start(t);o.stop(t+.08)}
function playBlueSwitch(accent=false){playRecordedSample('keyboard',accent?.72:.48)}

const SPRITE_FILES={
 run:['./sprites/run1.png','./sprites/run2.png','./sprites/run3.png','./sprites/run4.png'],
 jump:['./sprites/jump1.png','./sprites/jump2.png'],
 slide:['./sprites/slide1.png','./sprites/slide2.png'],
 crouch:['./sprites/crouch1.png','./sprites/crouch2.png']
};
const sprites={run:[],jump:[],slide:[],crouch:[]};
for(const [action,files] of Object.entries(SPRITE_FILES))for(const src of files){const im=new Image();im.decoding='async';im.src=src;sprites[action].push(im)}

const G=1700,JUMP=-690,TYPE_KEYS=['jelly','wax','bubble'];
const TYPES={
 jelly:{label:'말랑',base:'#8b54cf'},
 wax:{label:'왁스',base:'#dd812b'},
 bubble:{label:'뽁뽁',base:'#7ac9e9'}
};
let player,objects,particles,distance,hp,combo,best,spawnX,speed,runTime,shake,flash;
best=Number(localStorage.getItem('tactileBest')||0);bestText.textContent=`BEST ${best}m`;

function makeCanvas(w,h){const c=document.createElement('canvas');c.width=Math.ceil(w);c.height=Math.ceil(h);return c}
function rr(c,x,y,w,h,r){c.beginPath();c.roundRect(x,y,w,h,r)}
function drawKeyCap(c,x,y,w,h,label,pressed=false){
 c.save();
 const drop=pressed?4:0;
 c.fillStyle='rgba(0,0,0,.42)';rr(c,x+2,y+7,w-4,h-2,Math.min(9,w*.12));c.fill();
 const side=c.createLinearGradient(0,y,0,y+h);side.addColorStop(0,'#4b5260');side.addColorStop(1,'#181d25');c.fillStyle=side;rr(c,x,y+3+drop,w,h-6,Math.min(9,w*.12));c.fill();
 const top=c.createLinearGradient(x,y,x+w,y+h);top.addColorStop(0,pressed?'#596373':'#697483');top.addColorStop(.55,pressed?'#333a46':'#404855');top.addColorStop(1,'#252b34');c.fillStyle=top;rr(c,x+3,y+drop,w-6,h-11,Math.min(7,w*.10));c.fill();
 c.strokeStyle='rgba(255,255,255,.14)';c.lineWidth=1;rr(c,x+4,y+1+drop,w-8,h-14,Math.min(6,w*.09));c.stroke();
 const shine=c.createLinearGradient(0,y,0,y+h*.55);shine.addColorStop(0,'rgba(255,255,255,.22)');shine.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=shine;rr(c,x+6,y+2+drop,w-12,Math.max(5,h*.18),Math.min(5,w*.08));c.fill();
 c.fillStyle=pressed?'#eef7ff':'#f1f4f8';c.globalAlpha=.92;c.font=`700 ${Math.max(9,Math.min(15,w*.16))}px system-ui,sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(label,x+w/2,y+drop+(h-10)/2);c.globalAlpha=1;
 c.restore();
}
function keyboardMetrics(){const keyW=Math.max(45,W*.13)*.60,gap=5,stride=keyW+gap;return {keyW,gap,stride}}
const KEY_LABELS=['Q','W','E','R','T','Y','U','I','O','P','A','S','D','F','G','H','J','K','L','Z','X','C','V','B','N','M'];
const KEY_ROWS=[{h:39,offset:0,scale:1},{h:43,offset:.42,scale:1.04},{h:48,offset:-.18,scale:1.09},{h:52,offset:.30,scale:1.15}];
function rebuildKeyboardCache(){
 const {keyW,gap}=keyboardMetrics();keyboardCache=[];
 KEY_ROWS.forEach((row,r)=>{
  const kw=keyW*row.scale,st=kw+gap*row.scale,count=Math.max(18,Math.ceil((W+st*3)/st)),tw=Math.ceil(st*count),th=row.h+12,c=makeCanvas(tw,th),g=c.getContext('2d');
  for(let i=0;i<count;i++)drawKeyCap(g,i*st,0,kw,row.h,KEY_LABELS[(i+r*5)%KEY_LABELS.length],false);
  keyboardCache.push({canvas:c,st,tw,row,kw});
 });
}
function buildObjectSprites(){
 const scale=2;
 function create(w,h,draw){const c=makeCanvas(w*scale,h*scale),g=c.getContext('2d');g.scale(scale,scale);draw(g,w,h);return c}
 objectSprites.jelly=create(150,76,(g,w,h)=>{
  g.shadowColor='rgba(34,13,57,.32)';g.shadowBlur=9;g.shadowOffsetY=6;
  const side=g.createLinearGradient(0,0,0,h);side.addColorStop(0,'#7542ac');side.addColorStop(1,'#47246f');g.fillStyle=side;rr(g,5,11,w-10,h-15,27);g.fill();g.shadowColor='transparent';
  const body=g.createLinearGradient(0,4,w,h);body.addColorStop(0,'#c797f0');body.addColorStop(.42,'#9b61d3');body.addColorStop(1,'#7542ad');g.fillStyle=body;rr(g,5,4,w-10,h-20,25);g.fill();
  const gloss=g.createLinearGradient(0,0,0,32);gloss.addColorStop(0,'rgba(255,255,255,.76)');gloss.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gloss;rr(g,17,9,w-44,18,12);g.fill();
  g.strokeStyle='rgba(76,31,111,.35)';g.lineWidth=1.5;rr(g,6,5,w-12,h-22,24);g.stroke();
  g.fillStyle='rgba(255,255,255,.24)';for(let i=0;i<4;i++){g.beginPath();g.arc(41+i*23,39+(i%2)*5,2.2+(i%3),0,Math.PI*2);g.fill()}
 });
 objectSprites.wax=create(150,70,(g,w,h)=>{
  g.shadowColor='rgba(72,34,5,.34)';g.shadowBlur=8;g.shadowOffsetY=6;
  const side=g.createLinearGradient(0,0,0,h);side.addColorStop(0,'#be621f');side.addColorStop(1,'#74340d');g.fillStyle=side;rr(g,5,12,w-10,h-16,20);g.fill();g.shadowColor='transparent';
  const body=g.createLinearGradient(0,2,w,h);body.addColorStop(0,'#ffd284');body.addColorStop(.35,'#f1a344');body.addColorStop(1,'#d47623');g.fillStyle=body;rr(g,5,4,w-10,h-20,19);g.fill();
  g.strokeStyle='rgba(133,63,14,.40)';g.lineWidth=1.4;rr(g,6,5,w-12,h-22,18);g.stroke();
  g.fillStyle='rgba(255,248,220,.62)';g.beginPath();g.ellipse(w*.35,h*.27,w*.22,6,-.13,0,Math.PI*2);g.fill();
  g.strokeStyle='rgba(148,76,23,.24)';g.lineWidth=1;for(let i=0;i<5;i++){g.beginPath();g.moveTo(24+i*23,38+(i%2)*2);g.bezierCurveTo(35+i*21,31,42+i*20,48,55+i*18,40);g.stroke()}
  g.fillStyle='rgba(111,52,13,.18)';for(let i=0;i<7;i++){g.beginPath();g.arc(25+i*16,47+(i%3)*3,1.2+(i%2),0,Math.PI*2);g.fill()}
 });
 objectSprites.bubble=create(170,72,(g,w,h)=>{
  g.shadowColor='rgba(18,78,105,.25)';g.shadowBlur=8;g.shadowOffsetY=5;
  const sheet=g.createLinearGradient(0,0,0,h);sheet.addColorStop(0,'rgba(226,248,255,.92)');sheet.addColorStop(1,'rgba(105,192,224,.68)');g.fillStyle=sheet;rr(g,3,16,w-6,h-20,12);g.fill();g.shadowColor='transparent';
  g.strokeStyle='rgba(52,139,171,.48)';g.lineWidth=1.2;rr(g,4,16,w-8,h-22,11);g.stroke();
  for(let i=0;i<6;i++){
   const x=18+i*27,y=24+(i%2)*2,r=12;
   const grad=g.createRadialGradient(x-4,y-5,1,x,y,r);grad.addColorStop(0,'rgba(255,255,255,.96)');grad.addColorStop(.35,'rgba(205,244,255,.90)');grad.addColorStop(1,'rgba(90,181,216,.80)');g.fillStyle=grad;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.strokeStyle='rgba(47,137,170,.58)';g.stroke();
   g.fillStyle='rgba(255,255,255,.75)';g.beginPath();g.ellipse(x-4,y-5,3.5,2.2,-.5,0,Math.PI*2);g.fill();
  }
  g.fillStyle='rgba(255,255,255,.32)';g.fillRect(11,53,w-22,2);
 });
}

let resizeRaf=0;
function resize(){
 const r=shell.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);
 const coarse=matchMedia('(pointer:coarse)').matches;dpr=Math.min(coarse?1.10:1.50,devicePixelRatio||1);
 canvas.width=Math.max(1,Math.round(W*dpr));canvas.height=Math.max(1,Math.round(H*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=true;
 groundY=H*.69;physicsScale=Math.max(.52,Math.min(1.05,H/620));
 skyGradient=ctx.createLinearGradient(0,0,0,groundY);skyGradient.addColorStop(0,'#dff4ff');skyGradient.addColorStop(1,'#c8ecfa');
 plateGradient=ctx.createLinearGradient(0,groundY-10,0,H);plateGradient.addColorStop(0,'#252b33');plateGradient.addColorStop(.35,'#171c23');plateGradient.addColorStop(1,'#0d1117');
 rebuildKeyboardCache();buildObjectSprites();
 if(player&&player.onGround)player.y=groundY-player.h;
}
function syncViewport(){
 const vv=window.visualViewport;
 const vw=Math.max(1,Math.round(vv?vv.width:window.innerWidth));
 const vh=Math.max(1,Math.round(vv?vv.height:window.innerHeight));
 document.documentElement.style.setProperty('--app-w',vw+'px');
 document.documentElement.style.setProperty('--app-h',vh+'px');
 cancelAnimationFrame(resizeRaf);resizeRaf=requestAnimationFrame(resize);
}
addEventListener('resize',syncViewport,{passive:true});
addEventListener('orientationchange',()=>setTimeout(syncViewport,120),{passive:true});
if(window.visualViewport){visualViewport.addEventListener('resize',syncViewport,{passive:true});visualViewport.addEventListener('scroll',syncViewport,{passive:true})}
if('ResizeObserver' in window)new ResizeObserver(()=>{cancelAnimationFrame(resizeRaf);resizeRaf=requestAnimationFrame(resize)}).observe(shell);
syncViewport();

function groundKeyUnderPlayer(){
 if(!player||!player.onGround)return null;const {keyW,stride}=keyboardMetrics(),travel=keyboardTravel,cycle=Math.floor(travel/stride),scroll=travel-cycle*stride,footX=player.x+player.w*.50,localIndex=Math.floor((footX+scroll)/stride),keyX=localIndex*stride-scroll;
 if(footX<keyX||footX>keyX+keyW)return null;return localIndex+cycle;
}
function triggerKeyboardContact(accent=false){const keyId=groundKeyUnderPlayer();if(keyId!==null&&keyId!==lastSteppedKey){lastSteppedKey=keyId;pressedKeyId=keyId;keyFlash=.12;playBlueSwitch(accent)}}
function setAction(action){if(!player||player.action===action)return;player.action=action;player.actionTime=0}
function reset(){
 player={x:W*.16,y:groundY-68,w:58,h:68,vy:0,onGround:true,action:'run',actionTime:0,slideTimer:0,crouchHeld:false};objects=[];particles=[];distance=0;hp=100;combo=0;spawnX=W+100;speed=Math.max(220,Math.min(315,H*.60));runTime=0;shake=0;flash=0;keyFlash=0;keyboardTravel=0;lastSteppedKey=null;pressedKeyId=null;hudClock=0;
 for(let i=0;i<6;i++)spawnObject(i<2?W+160+i*180:undefined);updateHud(true);
}
function spawnObject(xOverride){
 const type=TYPE_KEYS[(Math.random()*TYPE_KEYS.length)|0],w=type==='bubble'?82:64+Math.random()*18,h=type==='jelly'?38:type==='wax'?31:29,gap=120+Math.random()*120,x=xOverride??Math.max(W+80,spawnX+gap);
 objects.push({x,y:groundY-h,w,h,type,hit:false,burst:false,compress:0});spawnX=x+w;
}
async function wakeAudio(){await initAudio()}
function doJump(){if(state!=='playing'||!player.onGround)return;void wakeAudio();player.slideTimer=0;player.crouchHeld=false;player.vy=JUMP*physicsScale;player.onGround=false;setAction('jump');jumpSound();hint.style.opacity=.15;if(navigator.vibrate)navigator.vibrate(8)}
function doSlide(){if(state!=='playing'||!player.onGround)return;void wakeAudio();player.crouchHeld=false;player.slideTimer=.55;setAction('slide');hint.style.opacity=.15;if(navigator.vibrate)navigator.vibrate(7)}
function startCrouch(){if(state!=='playing')return;void wakeAudio();player.crouchHeld=true;player.slideTimer=0;if(player.onGround)setAction('crouch')}
function stopCrouch(){if(!player)return;player.crouchHeld=false;if(state==='playing'&&player.onGround&&player.slideTimer<=0)setAction('run')}
function burst(o,perfect){
 if(o.burst)return;o.burst=true;o.hit=true;o.compress=1;combo=perfect?combo+1:Math.max(1,combo);hp=Math.min(100,hp+(perfect?5:2));shake=perfect?7:3.5;flash=perfect?.18:.07;
 if(o.type==='wax')playRecordedSample('wax',perfect?.95:.84);else if(o.type==='jelly')playRecordedSample('jelly',perfect?.92:.80);else playRecordedSample('bubble',perfect?.92:.82);
 if(navigator.vibrate)navigator.vibrate(perfect?[12,15,18]:9);
 const cx=o.x+o.w/2,cy=o.y+o.h/2,count=perfect?10:6;for(let i=0;i<count&&particles.length<52;i++){const a=Math.random()*Math.PI*2,s=70+Math.random()*210;particles.push({x:cx,y:cy,vx:Math.cos(a)*s,vy:Math.sin(a)*s-90,r:2+Math.random()*5,life:.32+Math.random()*.28,color:TYPES[o.type].base})}
 showToast(perfect?'PERFECT!':TYPES[o.type].label+'!');updateHud(true);
}
function showToast(text){toast.textContent=text;toast.classList.remove('show');void toast.offsetWidth;toast.classList.add('show')}
function updateHud(force=false){
 if(!force&&hudClock<.075)return;hudClock=0;hpText.textContent=Math.max(0,Math.ceil(hp));hpFill.style.transform=`scaleX(${Math.max(0,hp)/100})`;metersEl.textContent=Math.floor(distance);comboN.textContent=combo>=2?`×${combo}`:'';comboT.textContent=combo>=2?'CRUNCH COMBO':'';
}
function gameOver(){state='over';const m=Math.floor(distance);if(m>best){best=m;localStorage.setItem('tactileBest',best)}bestText.textContent=`BEST ${best}m`;document.querySelector('.title').innerHTML=`${m}m<br>달렸어!`;document.querySelector('.sub').innerHTML=`최고 콤보를 이어서 더 멀리 가보자.<br><b>정중앙 착지 = PERFECT + 체력 회복</b>`;startBtn.textContent='다시 달리기';overlay.style.display='grid';updateHud(true)}

function step(dt){
 if(state!=='playing')return;runTime+=dt;hudClock+=dt;distance+=speed*dt*.035;speed=Math.min(330,speed+dt*2.2);hp-=dt*(2.5+speed/280);if(hp<=0){hp=0;gameOver();return}
 player.actionTime+=dt;if(player.slideTimer>0)player.slideTimer=Math.max(0,player.slideTimer-dt);player.vy+=G*physicsScale*dt;player.y+=player.vy*dt;
 const wasGrounded=player.onGround;keyboardTravel+=speed*dt*.38;if(player.y+player.h>=groundY){player.y=groundY-player.h;player.vy=0;player.onGround=true}else{player.onGround=false;lastSteppedKey=null}
 if(player.onGround){if(player.slideTimer>0)setAction('slide');else if(player.crouchHeld)setAction('crouch');else setAction('run');triggerKeyboardContact(!wasGrounded||player.action==='slide')}else setAction('jump');
 for(let i=0;i<objects.length;i++){
  const o=objects[i];o.x-=speed*dt;if(o.compress>0)o.compress=Math.max(0,o.compress-dt*2.8);
  if(!o.burst&&player.vy>80){const px1=player.x+7,px2=player.x+player.w-7,py=player.y+player.h;if(px2>o.x&&px1<o.x+o.w&&py>=o.y&&py<=o.y+Math.min(29,o.h+12)){player.y=o.y-player.h+5;player.vy=-215;player.onGround=false;setAction('jump');const pc=player.x+player.w/2,oc=o.x+o.w/2;burst(o,Math.abs(pc-oc)<o.w*.22)}}
 }
 let ow=0;for(let i=0;i<objects.length;i++)if(objects[i].x>-130)objects[ow++]=objects[i];objects.length=ow;
 let pw=0;for(let i=0;i<particles.length;i++){const p=particles[i];p.life-=dt;if(p.life>0){p.vy+=620*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;particles[pw++]=p}}particles.length=pw;
 while(spawnX<W+900)spawnObject();spawnX-=speed*dt;shake*=Math.pow(.025,dt);flash*=Math.pow(.025,dt);keyFlash*=Math.pow(.008,dt);updateHud();
}

function drawBackground(t){
 ctx.fillStyle=skyGradient||'#dff4ff';ctx.fillRect(0,0,W,groundY-8);
 ctx.fillStyle='rgba(255,255,255,.72)';for(let i=0;i<4;i++){const x=((i*241-t*9)%(W+220))-100,y=84+(i%3)*84;ctx.beginPath();ctx.ellipse(x,y,38,15,0,0,Math.PI*2);ctx.ellipse(x+31,y+3,26,12,0,0,Math.PI*2);ctx.fill()}
 ctx.fillStyle=plateGradient||'#171c23';ctx.fillRect(0,groundY-10,W,H-groundY+10);ctx.fillStyle='rgba(255,255,255,.10)';ctx.fillRect(0,groundY-9,W,1);
 for(let r=0;r<keyboardCache.length;r++){
  const item=keyboardCache[r],row=KEY_ROWS[r],rowY=groundY-6+[0,44,93,146][r],shift=((keyboardTravel*row.scale)%item.tw),offset=keyboardMetrics().keyW*row.offset,x=-shift+offset;
  ctx.drawImage(item.canvas,x-item.tw,rowY);ctx.drawImage(item.canvas,x,rowY);ctx.drawImage(item.canvas,x+item.tw,rowY);
 }
 if(pressedKeyId!==null&&keyFlash>.018){
  const {keyW,stride}=keyboardMetrics(),cycle=Math.floor(keyboardTravel/stride),scroll=keyboardTravel-cycle*stride,local=pressedKeyId-cycle,x=local*stride-scroll;
  if(x>-keyW&&x<W+keyW)drawKeyCap(ctx,x,groundY-6,keyW,39,KEY_LABELS[((pressedKeyId%KEY_LABELS.length)+KEY_LABELS.length)%KEY_LABELS.length],true);
 }
}
function drawObject(o){
 const img=objectSprites[o.type];if(!img)return;const comp=o.burst?Math.max(.08,o.compress):1-o.compress*.55;
 ctx.save();ctx.translate(o.x+o.w/2,o.y+o.h);ctx.scale(1+(1-comp)*.32,comp);ctx.globalAlpha=o.burst?Math.max(.38,comp):1;ctx.drawImage(img,-o.w/2,-o.h,o.w,o.h);ctx.restore();
}
function currentSprite(){let action=player.onGround?player.action:'jump',idx=0;if(action==='run')idx=Math.floor(player.actionTime/.095)%4;else if(action==='jump')idx=player.vy<35?0:1;else if(action==='slide')idx=Math.floor(player.actionTime/.12)%2;else if(action==='crouch')idx=player.actionTime<.13?0:1;return {action,img:sprites[action][idx]}}
function drawPlayer(){
 const p=player,{action,img}=currentSprite(),scale=Math.max(.72,Math.min(1.18,H/540)),baseline=p.y+p.h,centerX=p.x+p.w/2,jumpHeight=Math.max(0,groundY-baseline),shadowScale=Math.max(.45,1-jumpHeight/(H*.48));
 ctx.save();ctx.globalAlpha=.17*shadowScale;ctx.fillStyle='#071018';ctx.beginPath();ctx.ellipse(centerX,groundY+4,34*shadowScale,7*shadowScale,0,0,Math.PI*2);ctx.fill();ctx.restore();if(!img||!img.complete||!img.naturalWidth)return;
 let targetH=88*scale,xOffset=0,yOffset=2;if(action==='jump'){targetH=84*scale;yOffset=0}if(action==='slide'){targetH=64*scale;xOffset=34*scale;yOffset=3}if(action==='crouch'){targetH=61*scale;yOffset=3}
 const targetW=targetH*(img.naturalWidth/img.naturalHeight),drawX=centerX-targetW/2+xOffset,drawY=baseline-targetH+yOffset;ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(img,Math.round(drawX),Math.round(drawY),Math.round(targetW),Math.round(targetH));ctx.restore();ctx.imageSmoothingEnabled=true;
}
function render(t){
 ctx.save();if(shake>.1){renderSeed=(renderSeed+1)&255;const sx=((renderSeed*73)%17-8)/8,sy=((renderSeed*37)%17-8)/8;ctx.translate(sx*shake*.5,sy*shake*.5)}drawBackground(t);
 for(let i=0;i<objects.length;i++)drawObject(objects[i]);for(let i=0;i<particles.length;i++){const p=particles[i];ctx.globalAlpha=Math.max(0,p.life*2.2);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;if(player)drawPlayer();if(flash>.01){ctx.fillStyle=`rgba(255,255,255,${flash})`;ctx.fillRect(0,0,W,H)}ctx.restore();
}
function loop(ts){const dt=Math.min(.033,(ts-last)/1000||0);last=ts;step(dt);render(ts/1000);requestAnimationFrame(loop)}
async function start(){
 startBtn.disabled=true;startBtn.textContent='사운드 준비중…';await wakeAudio().catch(()=>{});reset();state='playing';overlay.style.display='none';document.querySelector('.title').innerHTML='촉감런<br>ASMR PROTO';document.querySelector('.sub').innerHTML='키보드 위를 달리며 ASMR을 듣고<br>점프해 <b>왁스볼·말랑이·뽁뽁이</b>를 터뜨려봐.';startBtn.disabled=false;startBtn.textContent='탭해서 시작';
}
startBtn.addEventListener('click',e=>{e.stopPropagation();void start()});
shell.addEventListener('pointerdown',e=>{if(e.target.tagName==='BUTTON')return;doJump()},{passive:true});
addEventListener('keydown',e=>{if(['Space','ArrowUp','ArrowDown','KeyS','KeyW','ShiftLeft','ShiftRight'].includes(e.code))e.preventDefault();if((e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW')&&!e.repeat)doJump();else if((e.code==='ShiftLeft'||e.code==='ShiftRight')&&!e.repeat)doSlide();else if((e.code==='ArrowDown'||e.code==='KeyS')&&!e.repeat)startCrouch()});
addEventListener('keyup',e=>{if(e.code==='ArrowDown'||e.code==='KeyS')stopCrouch()});addEventListener('blur',stopCrouch);
const ua=navigator.userAgent||'';
const isAndroid=/Android/i.test(ua),isKakao=/KAKAOTALK/i.test(ua),isStandalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function setInstallHelp(text,show=true){if(!installHelp)return;installHelp.textContent=text;installHelp.classList.toggle('show',show)}
function setupInstallUI(){
 if(!installBtn)return;
 if(isStandalone){installBtn.style.display='none';if(openChromeBtn)openChromeBtn.style.display='none';setInstallHelp('✅ 앱으로 실행 중이에요.',true);return}
 if(isKakao&&isAndroid){
  if(openChromeBtn)openChromeBtn.style.display='block';installBtn.style.display='none';
  setInstallHelp('카카오톡 안에서는 설치 메뉴가 제한될 수 있어요. Chrome으로 연 뒤 Chrome 메뉴의 “앱 설치” 또는 “홈 화면에 추가”를 사용하세요.',true);
 }else{
  installBtn.style.display='block';installBtn.textContent='📲 앱 설치';
  setInstallHelp('설치 창이 바로 안 뜨면 Chrome 오른쪽 위 ⋮ 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택하세요.',false);
 }
}
setupInstallUI();
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;if(!isKakao&&installBtn){installBtn.style.display='block';installBtn.textContent='📲 앱 설치';setInstallHelp('',false)}});
if(installBtn)installBtn.addEventListener('click',async e=>{
 e.stopPropagation();
 if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;installBtn.style.display='none';setInstallHelp('설치가 완료되면 홈 화면의 “촉감런” 아이콘으로 실행해봐.',true);return}
 setInstallHelp('Chrome 오른쪽 위 ⋮ → “앱 설치” 또는 “홈 화면에 추가”를 눌러줘. 메뉴가 없으면 잠깐 기다렸다가 페이지를 새로고침해봐.',true);
});
if(openChromeBtn)openChromeBtn.addEventListener('click',e=>{
 e.stopPropagation();
 const fallback=location.href.split('#')[0];
 if(isAndroid){
  const scheme=location.protocol.replace(':','');
  const target=location.host+location.pathname+location.search;
  location.href=`intent://${target}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  setTimeout(()=>setInstallHelp('Chrome이 자동으로 열리지 않으면 카카오톡 오른쪽 위 메뉴에서 “다른 브라우저로 열기”를 선택해줘.',true),900);
 }else setInstallHelp('카카오톡 메뉴에서 “다른 브라우저로 열기”를 선택한 뒤 설치해줘.',true);
});
addEventListener('appinstalled',()=>{if(installBtn)installBtn.style.display='none';if(openChromeBtn)openChromeBtn.style.display='none';setInstallHelp('✅ 설치 완료! 홈 화면에서 촉감런을 실행할 수 있어.',true)});
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=10.1-hotfix').catch(()=>{}));
reset();state='menu';loop(performance.now());
})();
