(()=>{
'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
const shell=document.getElementById('shell'),overlay=document.getElementById('overlay');
const startBtn=document.getElementById('startBtn'),installBtn=document.getElementById('installBtn'),openChromeBtn=document.getElementById('openChromeBtn'),installHelp=document.getElementById('installHelp');
const hpText=document.getElementById('hpText'),hpFill=document.getElementById('hpFill'),metersEl=document.getElementById('meters');
const comboN=document.getElementById('comboN'),comboT=document.getElementById('comboT'),toast=document.getElementById('toast'),hint=document.getElementById('hint'),bestText=document.getElementById('bestText'),soundStatus=document.getElementById('soundStatus');
const slideTouchBtn=document.getElementById('slideTouchBtn'),crouchTouchBtn=document.getElementById('crouchTouchBtn');

let W=960,H=540,dpr=1,groundY=370,physicsScale=1,last=0,state='menu',deferredPrompt=null;
let audio=null,master=null,noiseBuffer=null,audioReady=false,audioLoadPromise=null;
let keyboardTravel=0,lastSteppedKey=null,hudClock=0;
let objectSprites={},hazardSprites={},renderSeed=0,skyGradient=null,abyssGradient=null;
let platforms=[],hazards=[],nextX=0,platformSeq=0,hazardSeq=0,sectionSeq=0,materialSeq=0,jumpBufferUntil=0,coyoteUntil=0,lastSupportId=null,lastMaterialStepKey=null,slideHeld=false;

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

const G=2250,COYOTE=.115,JUMP_BUFFER=.145,TYPE_KEYS=['jelly','wax','bubble'];
function jumpPeakTarget(){return Math.max(96,Math.min(132,H*.30))}
function jumpVelocity(){return -Math.sqrt(2*G*jumpPeakTarget())}
function maxSafeRise(){return jumpPeakTarget()*.72}
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


function buildHazardSprites(){
 const scale=2;
 function create(w,h,draw){const c=makeCanvas(w*scale,h*scale),g=c.getContext('2d');g.scale(scale,scale);draw(g,w,h);return c}
 hazardSprites.slide=create(180,92,(g,w,h)=>{
  // 낮게 매달린 기계식 스위치 테스트 바
  g.shadowColor='rgba(0,0,0,.30)';g.shadowBlur=8;g.shadowOffsetY=5;
  const rail=g.createLinearGradient(0,0,0,h);rail.addColorStop(0,'#4b5563');rail.addColorStop(.45,'#232a33');rail.addColorStop(1,'#10151c');
  g.fillStyle=rail;rr(g,4,8,w-8,28,8);g.fill();g.shadowColor='transparent';
  g.fillStyle='rgba(255,255,255,.17)';g.fillRect(13,12,w-26,2);
  for(let i=0;i<5;i++){
   const x=15+i*33;
   g.fillStyle='#181e26';rr(g,x,29,27,34,5);g.fill();
   const sw=g.createLinearGradient(x,31,x+25,60);sw.addColorStop(0,'#9ed8ff');sw.addColorStop(.55,'#4da4dc');sw.addColorStop(1,'#1f6f9e');
   g.fillStyle=sw;rr(g,x+4,33,19,24,4);g.fill();
   g.fillStyle='rgba(255,255,255,.55)';rr(g,x+7,35,12,4,2);g.fill();
   g.strokeStyle='rgba(0,0,0,.38)';g.lineWidth=1;rr(g,x+4,33,19,24,4);g.stroke();
  }
  g.fillStyle='#ffd866';rr(g,53,67,74,19,7);g.fill();g.fillStyle='#2a2520';g.font='900 11px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('SHIFT',90,77);
 });
 hazardSprites.crouch=create(330,108,(g,w,h)=>{
  // 긴 투명 아크릴 키보드 커버 - 웅크리고 유지하는 구간
  g.shadowColor='rgba(20,45,58,.26)';g.shadowBlur=9;g.shadowOffsetY=5;
  const acrylic=g.createLinearGradient(0,0,0,h);acrylic.addColorStop(0,'rgba(240,252,255,.76)');acrylic.addColorStop(.52,'rgba(164,211,226,.43)');acrylic.addColorStop(1,'rgba(80,139,160,.35)');
  g.fillStyle=acrylic;rr(g,4,7,w-8,57,14);g.fill();g.shadowColor='transparent';
  g.strokeStyle='rgba(64,119,139,.55)';g.lineWidth=2;rr(g,4,7,w-8,57,14);g.stroke();
  g.strokeStyle='rgba(255,255,255,.72)';g.lineWidth=2;g.beginPath();g.moveTo(18,15);g.lineTo(w-24,15);g.stroke();
  for(let i=0;i<6;i++){g.fillStyle='rgba(255,255,255,.24)';g.beginPath();g.arc(40+i*47,34+(i%2)*7,9,0,Math.PI*2);g.fill()}
  g.fillStyle='#fff1a8';rr(g,112,74,106,22,8);g.fill();g.fillStyle='#29251f';g.font='900 11px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('HOLD  ↓',165,85);
 });
}

let resizeRaf=0;
function resize(){
 const r=shell.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);
 const coarse=matchMedia('(pointer:coarse)').matches;dpr=Math.min(coarse?1.08:1.45,devicePixelRatio||1);
 canvas.width=Math.max(1,Math.round(W*dpr));canvas.height=Math.max(1,Math.round(H*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=true;
 groundY=H*.73;physicsScale=1;
 skyGradient=ctx.createLinearGradient(0,0,0,H);skyGradient.addColorStop(0,'#dff4ff');skyGradient.addColorStop(.62,'#c9ebf8');skyGradient.addColorStop(1,'#9bc9da');
 abyssGradient=ctx.createLinearGradient(0,groundY,0,H);abyssGradient.addColorStop(0,'rgba(35,50,60,.10)');abyssGradient.addColorStop(.35,'rgba(28,38,46,.32)');abyssGradient.addColorStop(1,'rgba(9,14,19,.88)');
 buildObjectSprites();buildHazardSprites();
 for(const p of platforms)buildPlatformSprite(p);
 for(const o of objects){if(o.kind==='land')o.y=groundY-o.lift-o.h}
 if(player&&player.onGround&&lastSupportId){
  const p=platforms.find(x=>x.id===lastSupportId);
  const o=objects.find(x=>x.kind==='land'&&x.id===lastSupportId);
  if(p)player.y=p.y-player.h;else if(o)player.y=o.y-player.h;
 }
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

function buildPlatformSprite(p){
 const h=Math.max(116,Math.min(150,H*.29)),c=makeCanvas(p.w,h),g=c.getContext('2d'),{keyW,gap,stride}=keyboardMetrics();
 const deck=g.createLinearGradient(0,0,0,h);deck.addColorStop(0,'#343b45');deck.addColorStop(.28,'#20262e');deck.addColorStop(1,'#0d1117');g.fillStyle=deck;rr(g,0,4,p.w,h-4,10);g.fill();
 g.fillStyle='rgba(255,255,255,.11)';g.fillRect(4,7,p.w-8,2);
 const rows=[{y:0,off:0,s:1,h:39},{y:42,off:.36,s:1.03,h:43},{y:89,off:-.14,s:1.08,h:47}];
 for(let r=0;r<rows.length;r++){
  const row=rows[r],kw=keyW*row.s,st=kw+gap*row.s,off=row.off*keyW;
  for(let x=off,i=0;x<p.w+kw;x+=st,i++)drawKeyCap(g,x,row.y,kw,row.h,KEY_LABELS[(i+r*5+p.seed)%KEY_LABELS.length],false);
 }
 p.img=c;p.visualH=h;
}
function addKeyboardPlatform(x,keyCount){
 const {keyW,gap,stride}=keyboardMetrics(),w=Math.max(stride*keyCount-gap,keyW),p={id:'k'+(++platformSeq),x,y:groundY,w,keyCount,seed:(platformSeq*7)%KEY_LABELS.length,img:null,visualH:140,pressedIndex:-1,pressedTimer:0};
 buildPlatformSprite(p);platforms.push(p);return p;
}
function addMaterialLand(x,type,lift=42,width=null){
 const baseW=width||Math.max(245,Math.min(365,W*.31));
 const h=type==='jelly'?50:type==='wax'?43:39;
 // 모바일에서도 키보드 바닥에서 한 번의 점프로 확실히 올라갈 수 있도록
 // '발판 윗면 높이'를 점프 최대높이의 72% 이내로 제한한다.
 const maxLift=Math.max(10,maxSafeRise()-h);
 lift=Math.max(6,Math.min(lift,maxLift));
 const stepSpan=type==='bubble'?42:type==='wax'?55:52;
 const count=Math.max(4,Math.ceil(baseW/stepSpan));
 const o={
  id:'m'+(++materialSeq),kind:'land',x,y:groundY-lift-h,w:baseW,h,type,lift,
  stepSpan,lastStep:-1,stepCount:0,squish:0,squishX:.5,
  bubbleCells:type==='bubble'?Array.from({length:Math.max(7,Math.ceil(baseW/34))},()=>false):null,
  waxMarks:type==='wax'?Array.from({length:count},()=>0):null
 };
 objects.push(o);return o;
}
function triggerMaterialStep(o,accent=false){
 if(!o||o.kind!=='land')return;
 const footX=player.x+player.w*.50,local=Math.max(0,Math.min(o.w-1,footX-o.x));
 const idx=Math.max(0,Math.floor(local/o.stepSpan));
 const stepKey=o.id+':'+idx;
 if(stepKey===lastMaterialStepKey)return;
 lastMaterialStepKey=stepKey;o.lastStep=idx;o.stepCount++;
 if(o.type==='bubble'){
  const bi=Math.max(0,Math.min(o.bubbleCells.length-1,Math.floor(local/o.w*o.bubbleCells.length)));
  o.bubbleCells[bi]=true;
  // 발 폭만큼 옆 에어캡 하나가 같이 눌릴 때도 있음. 비닐 바닥은 그대로 남는다.
  if(bi+1<o.bubbleCells.length&&o.stepCount%3===0)o.bubbleCells[bi+1]=true;
  playRecordedSample('bubble',accent?.98:.88);
  if(navigator.vibrate)navigator.vibrate(5);
 }else if(o.type==='wax'){
  const levels=[1,.72,.50,.34,.22,.16];
  const vol=levels[Math.min(levels.length-1,o.stepCount-1)]*(accent?1:.94);
  if(o.waxMarks) o.waxMarks[Math.min(o.waxMarks.length-1,idx)]=Math.min(3,(o.waxMarks[Math.min(o.waxMarks.length-1,idx)]||0)+1);
  playRecordedSample('wax',vol);
  shake=Math.max(shake,o.stepCount===1?4.2:1.7);
  if(o.stepCount===1)flash=Math.max(flash,.055);
  if(navigator.vibrate)navigator.vibrate(o.stepCount===1?9:4);
  // 왁스 조각은 사라지지 않고 부서진 상태로 남는다.
  const cx=footX,cy=o.y+8,count=o.stepCount===1?5:2;
  for(let i=0;i<count&&particles.length<48;i++)particles.push({x:cx+(Math.random()-.5)*24,y:cy,vx:(Math.random()-.5)*75,vy:-25-Math.random()*55,r:1.5+Math.random()*2.2,life:.22+Math.random()*.14,color:'#c8762b'});
 }else{
  o.squish=1;o.squishX=local/o.w;
  playRecordedSample('jelly',accent?.88:.74);
  if(navigator.vibrate)navigator.vibrate(5);
 }
}
function addMaterialChain(){
 const count=2+((Math.random()*2)|0);
 // 첫 재질땅은 키보드보다 윗면이 약 58~75px 높은 수준에서 시작한다.
 // 화면 높이에 따라 maxSafeRise()가 더 낮으면 자동으로 내려간다.
 let lastTopRise=Math.min(maxSafeRise(),58+Math.random()*17);
 nextX+=Math.max(72,Math.min(108,W*.085));
 const order=[...TYPE_KEYS].sort(()=>Math.random()-.5);
 for(let i=0;i<count;i++){
  const type=order[i%order.length];
  const h=type==='jelly'?50:type==='wax'?43:39;
  // 연속 재질땅끼리는 높이차를 작게 제한해서 모바일에서도 점프로 연결 가능하게 한다.
  const topRise=Math.max(44,Math.min(maxSafeRise(),lastTopRise+(Math.random()-.5)*24));
  const lift=Math.max(6,topRise-h);
  const width=Math.max(245,Math.min(370,W*(.28+Math.random()*.07)));
  const o=addMaterialLand(nextX,type,lift,width);
  nextX=o.x+o.w;
  // 직접 점프해서 다음 재질 땅으로 넘어가는 간격. 자동 반동은 없다.
  nextX+=Math.max(66,Math.min(106,70+Math.random()*30));
  lastTopRise=groundY-o.y;
 }
 const p=addKeyboardPlatform(nextX,5+((Math.random()*4)|0));nextX=p.x+p.w;
}
function maybeAddGroundTarget(p){
 // v13부터 작은 1회성 오브젝트 대신 긴 재질 땅을 사용한다.
 return p;
}
function addHazard(p,type){
 const margin=Math.max(54,Math.min(92,p.w*.12));
 let w,x;
 if(type==='slide'){
  w=Math.max(118,Math.min(168,p.w*.25));
  x=p.x+Math.min(p.w-w-margin,Math.max(margin,p.w*.58));
 }else{
  w=Math.max(245,Math.min(330,p.w*.48));
  x=p.x+Math.min(p.w-w-margin,Math.max(margin,p.w*.43));
 }
 const h={id:'h'+(++hazardSeq),type,x,y:p.y,w,platformId:p.id,hit:false,passed:false};hazards.push(h);return h;
}
function generateActionSection(type){
 nextX+=Math.max(58,Math.min(105,62+Math.random()*50));
 const keys=type==='crouch'?12+((Math.random()*2)|0):10+((Math.random()*2)|0);
 const p=addKeyboardPlatform(nextX,keys);nextX=p.x+p.w;addHazard(p,type);
}
function generateSection(){
 const {stride}=keyboardMetrics();sectionSeq++;
 const pattern=sectionSeq%7;
 if(pattern===0||pattern===3){
  addMaterialChain();
 }else if(pattern===2){
  generateActionSection('slide');
 }else if(pattern===5){
  generateActionSection('crouch');
 }else{
  nextX+=Math.max(70,Math.min(138,72+Math.random()*72));
  const p=addKeyboardPlatform(nextX,5+((Math.random()*5)|0));nextX=p.x+p.w;
 }
}
function platformUnderFoot(){
 const footX=player.x+player.w*.50;
 for(let i=0;i<platforms.length;i++){const p=platforms[i];if(footX>=p.x&&footX<=p.x+p.w&&Math.abs((player.y+player.h)-p.y)<7)return p}
 return null;
}
function triggerKeyboardContact(p,accent=false){
 if(!p)return;const {keyW,stride}=keyboardMetrics(),footX=player.x+player.w*.50,local=footX-p.x,idx=Math.floor(local/stride),kx=idx*stride;
 if(idx<0||local<kx||local>kx+keyW)return;
 const keyId=p.id+':'+idx;if(keyId===lastSteppedKey)return;
 lastSteppedKey=keyId;p.pressedIndex=idx;p.pressedTimer=.105;playBlueSwitch(accent);
}
function setAction(action){if(!player||player.action===action)return;player.action=action;player.actionTime=0}
function reset(){
 platforms=[];hazards=[];objects=[];particles=[];distance=0;hp=100;combo=0;speed=Math.max(235,Math.min(320,H*.64));runTime=0;shake=0;flash=0;keyboardTravel=0;lastSteppedKey=null;lastMaterialStepKey=null;hudClock=0;platformSeq=0;hazardSeq=0;sectionSeq=0;materialSeq=0;jumpBufferUntil=0;coyoteUntil=0;lastSupportId=null;
 const {stride}=keyboardMetrics(),startKeys=Math.max(7,Math.ceil((W*.72+150)/stride));
 const first=addKeyboardPlatform(-120,startKeys);nextX=first.x+first.w;
 slideHeld=false;player={x:W*.16,y:first.y-68,w:58,h:68,vy:0,onGround:true,action:'run',actionTime:0,slideTimer:0,crouchHeld:false,invuln:0};lastSupportId=first.id;coyoteUntil=performance.now()/1000+COYOTE;triggerKeyboardContact(first,true);
 while(nextX<W+1100)generateSection();updateHud(true);
}
async function wakeAudio(){await initAudio()}
function executeJump(){
 player.slideTimer=0;player.crouchHeld=false;player.vy=jumpVelocity();player.onGround=false;lastSupportId=null;lastSteppedKey=null;lastMaterialStepKey=null;jumpBufferUntil=0;coyoteUntil=0;setAction('jump');jumpSound();hint.style.opacity=.15;if(navigator.vibrate)navigator.vibrate(7);
}
function doJump(){
 if(state!=='playing'||!player)return;void wakeAudio();const now=performance.now()/1000;jumpBufferUntil=now+JUMP_BUFFER;
 if(player.onGround||now<=coyoteUntil)executeJump();
}
function startSlide(){
 if(state!=='playing'||!player)return;
 void wakeAudio();slideHeld=true;player.crouchHeld=false;player.slideTimer=0;
 if(player.onGround)setAction('slide');hint.style.opacity=.15;if(navigator.vibrate)navigator.vibrate(7);
}
function stopSlide(){
 slideHeld=false;if(!player)return;
 if(state==='playing'&&player.onGround&&!player.crouchHeld)setAction('run');
}
function startCrouch(){if(state!=='playing')return;void wakeAudio();slideHeld=false;player.crouchHeld=true;player.slideTimer=0;if(player.onGround)setAction('crouch')}
function stopCrouch(){if(!player)return;player.crouchHeld=false;if(state==='playing'&&player.onGround&&!slideHeld)setAction('run')}
function burst(o,perfect){
 // v13: 재질 땅은 사라지지 않는다. 호환용으로 접촉 반응만 호출한다.
 triggerMaterialStep(o,perfect);
}
function showToast(text){toast.textContent=text;toast.classList.remove('show');void toast.offsetWidth;toast.classList.add('show')}
function playerBody(){
 const bottom=player.y+player.h;
 if(player.onGround&&slideHeld&&player.action==='slide')return {x:player.x+4,y:bottom-28,w:player.w+24,h:28};
 if(player.onGround&&player.action==='crouch')return {x:player.x+8,y:bottom-42,w:player.w-12,h:42};
 return {x:player.x+9,y:bottom-62,w:player.w-18,h:62};
}
function hazardRect(h){
 if(h.type==='slide')return {x:h.x+7,y:h.y-100,w:Math.max(12,h.w-14),h:66};
 return {x:h.x+5,y:h.y-100,w:Math.max(12,h.w-10),h:52};
}
function rectOverlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y}
function hitHazard(h){
 if(!player||player.invuln>0||h.hit)return;
 h.hit=true;player.invuln=.78;hp=Math.max(0,hp-(h.type==='slide'?28:24));combo=0;shake=8;flash=.20;
 showToast(h.type==='slide'?'SHIFT! 슬라이드':'↓ 웅크리기');
 if(navigator.vibrate)navigator.vibrate([24,16,28]);
 updateHud(true);if(hp<=0)gameOver('obstacle');
}
function checkHazards(){
 if(!player)return;
 const body=playerBody();
 for(const h of hazards){
  if(h.x>W+120||h.x+h.w<-120)continue;
  if(!h.hit&&rectOverlap(body,hazardRect(h))){hitHazard(h);if(state!=='playing')return}
  if(!h.passed&&h.x+h.w<player.x-4){
   h.passed=true;
   if(!h.hit){hp=Math.min(100,hp+1);showToast(h.type==='slide'?'SLIDE!':'CROUCH!');updateHud(true)}
  }
 }
}
function updateHud(force=false){
 if(!force&&hudClock<.075)return;hudClock=0;hpText.textContent=Math.max(0,Math.ceil(hp));hpFill.style.transform=`scaleX(${Math.max(0,hp)/100})`;metersEl.textContent=Math.floor(distance);comboN.textContent=combo>=2?`×${combo}`:'';comboT.textContent=combo>=2?'CRUNCH COMBO':'';
}
function gameOver(reason='energy'){
 if(state!=='playing')return;state='over';const m=Math.floor(distance);if(m>best){best=m;localStorage.setItem('tactileBest',best)}bestText.textContent=`BEST ${best}m`;
 document.querySelector('.title').innerHTML=reason==='fall'?`💥 추락!<br>${m}m`:reason==='obstacle'?`💢 장애물 충돌!<br>${m}m`:`${m}m<br>달렸어!`;
 document.querySelector('.sub').innerHTML=reason==='fall'?`빈 곳에 떨어지면 바로 게임오버야.<br><b>키보드 → 공중 ASMR 발판 → 다음 키보드</b>로 이어가봐.`:reason==='obstacle'?`체력이 다 떨어졌어. <b>SHIFT 슬라이드</b>와 <b>↓ 웅크리기</b>로 장애물을 피해서 달려봐.`:`더 멀리 이어 달려보자.`;
 startBtn.textContent='다시 달리기';overlay.style.display='grid';updateHud(true);
}

function step(dt){
 if(state!=='playing')return;
 runTime+=dt;hudClock+=dt;distance+=speed*dt*.035;speed=Math.min(345,speed+dt*1.8);hp=Math.max(0,hp-dt*.08);
 const now=performance.now()/1000,dx=speed*dt;
 player.actionTime+=dt;if(player.invuln>0)player.invuln=Math.max(0,player.invuln-dt);
 for(const p of platforms){p.x-=dx;if(p.pressedTimer>0)p.pressedTimer=Math.max(0,p.pressedTimer-dt)}
 for(const h of hazards)h.x-=dx;
 for(const o of objects){
  o.x-=dx;
  if(o.kind==='land'&&o.type==='jelly'&&o.squish>0)o.squish=Math.max(0,o.squish-dt*.72); // 약 1.4초에 천천히 복원
 }
 nextX-=dx;keyboardTravel+=dx;

 const prevBottom=player.y+player.h,wasGrounded=player.onGround,prevSupport=lastSupportId;
 player.vy+=G*physicsScale*dt;player.y+=player.vy*dt;player.onGround=false;lastSupportId=null;
 let landed=false;
 if(player.vy>=0){
  const px1=player.x+8,px2=player.x+player.w-8,newBottom=player.y+player.h;
  // 재질 땅: 착지해도 자동으로 튀지 않는다. 일반 바닥처럼 서서 직접 다음 점프를 입력한다.
  for(let i=0;i<objects.length;i++){
   const o=objects[i];if(o.kind!=='land')continue;
   if(px2>o.x+3&&px1<o.x+o.w-3&&prevBottom<=o.y+10&&newBottom>=o.y){
    player.y=o.y-player.h;player.vy=0;player.onGround=true;lastSupportId=o.id;coyoteUntil=now+COYOTE;
    if(slideHeld)setAction('slide');else if(player.crouchHeld)setAction('crouch');else setAction('run');
    lastSteppedKey=null;
    triggerMaterialStep(o,!wasGrounded||prevSupport!==o.id);
    landed=true;break;
   }
  }
  if(!landed){
   for(let i=0;i<platforms.length;i++){
    const p=platforms[i];if(px2<=p.x+4||px1>=p.x+p.w-4)continue;
    if(prevBottom<=p.y+9&&newBottom>=p.y){
     player.y=p.y-player.h;player.vy=0;player.onGround=true;lastSupportId=p.id;coyoteUntil=now+COYOTE;
     if(slideHeld)setAction('slide');else if(player.crouchHeld)setAction('crouch');else setAction('run');
     lastMaterialStepKey=null;triggerKeyboardContact(p,!wasGrounded||prevSupport!==p.id);landed=true;break;
    }
   }
  }
 }
 if(!player.onGround){
  setAction('jump');
  if(wasGrounded){coyoteUntil=now+COYOTE;lastSteppedKey=null;lastMaterialStepKey=null}
 }
 if(player.onGround&&jumpBufferUntil>=now)executeJump();
 else if(jumpBufferUntil&&jumpBufferUntil<now)jumpBufferUntil=0;
 checkHazards();if(state!=='playing')return;

 let pw=0;for(let i=0;i<platforms.length;i++)if(platforms[i].x+platforms[i].w>-180)platforms[pw++]=platforms[i];platforms.length=pw;
 let hw=0;for(let i=0;i<hazards.length;i++)if(hazards[i].x+hazards[i].w>-190)hazards[hw++]=hazards[i];hazards.length=hw;
 let ow=0;for(let i=0;i<objects.length;i++)if(objects[i].x+objects[i].w>-220)objects[ow++]=objects[i];objects.length=ow;
 let qw=0;for(let i=0;i<particles.length;i++){const p=particles[i];p.life-=dt;if(p.life>0){p.vy+=620*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;particles[qw++]=p}}particles.length=qw;
 while(nextX<W+1100)generateSection();
 if(player.y>H+70){gameOver('fall');return}
 shake*=Math.pow(.025,dt);flash*=Math.pow(.025,dt);updateHud();
}

function drawBackground(t){
 ctx.fillStyle=skyGradient||'#dff4ff';ctx.fillRect(0,0,W,H);
 ctx.fillStyle='rgba(255,255,255,.72)';for(let i=0;i<5;i++){const x=((i*241-t*9)%(W+240))-110,y=70+(i%3)*72;ctx.beginPath();ctx.ellipse(x,y,38,15,0,0,Math.PI*2);ctx.ellipse(x+31,y+3,26,12,0,0,Math.PI*2);ctx.fill()}
 ctx.fillStyle=abyssGradient||'rgba(9,14,19,.65)';ctx.fillRect(0,groundY,W,H-groundY);
 ctx.fillStyle='rgba(255,255,255,.16)';ctx.fillRect(0,groundY, W,1);
}
function drawPlatforms(){
 const {keyW,stride}=keyboardMetrics();
 for(const p of platforms){
  if(p.x>W+80||p.x+p.w<-80)continue;
  if(p.img)ctx.drawImage(p.img,p.x,p.y-2,p.w,p.visualH);
  if(p.pressedIndex>=0&&p.pressedTimer>0){
   const kx=p.x+p.pressedIndex*stride;if(kx+keyW>p.x&&kx<p.x+p.w)drawKeyCap(ctx,kx,p.y-2,keyW,39,KEY_LABELS[(p.pressedIndex+p.seed)%KEY_LABELS.length],true);
  }
 }
}
function drawHazards(){
 for(const h of hazards){
  if(h.x>W+120||h.x+h.w<-120)continue;
  const img=hazardSprites[h.type];if(!img)continue;
  const ratio=img.height/img.width,drawH=h.w*ratio;
  const clearance=h.type==='slide'?34:48;
  const y=h.y-clearance-drawH;
  ctx.save();
  if(h.hit)ctx.globalAlpha=.48;
  ctx.drawImage(img,h.x,y,h.w,drawH);
  ctx.restore();
  // 진입 전 작은 바닥 안내 마커
  if(!h.passed&&h.x>player.x-40){
   const tx=h.x-34,ty=h.y-18;
   ctx.save();ctx.globalAlpha=.82;ctx.fillStyle=h.type==='slide'?'#ffd866':'#fff1a8';rr(ctx,tx-22,ty-11,44,19,7);ctx.fill();
   ctx.fillStyle='#29251f';ctx.font='900 9px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(h.type==='slide'?'SHIFT':'↓ HOLD',tx,ty-1);ctx.restore();
  }
 }
}
function drawObject(o){
 if(o.kind!=='land')return;
 ctx.save();
 const x=o.x,y=o.y,w=o.w,h=o.h;
 if(o.type==='bubble'){
  // 실제 에어캡: 공기방울만 꺼지고 아래 비닐 시트는 계속 남는다.
  ctx.fillStyle='rgba(198,237,249,.52)';rr(ctx,x,y+7,w,h-2,9);ctx.fill();
  ctx.strokeStyle='rgba(77,152,181,.42)';ctx.lineWidth=1;rr(ctx,x,y+7,w,h-2,9);ctx.stroke();
  const cells=o.bubbleCells||[],cellW=w/cells.length;
  for(let i=0;i<cells.length;i++){
   const cx=x+cellW*(i+.5),cy=y+11+(i%2)*2,r=Math.min(13,cellW*.34);
   if(cells[i]){
    ctx.strokeStyle='rgba(77,146,171,.38)';ctx.lineWidth=1.1;ctx.beginPath();ctx.ellipse(cx,cy+5,r*.86,r*.22,0,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.18)';ctx.fillRect(cx-r*.65,cy+4,r*1.3,1);
   }else{
    const grad=ctx.createRadialGradient(cx-r*.28,cy-r*.35,1,cx,cy,r);grad.addColorStop(0,'rgba(255,255,255,.94)');grad.addColorStop(.42,'rgba(208,244,253,.88)');grad.addColorStop(1,'rgba(89,180,213,.72)');ctx.fillStyle=grad;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(48,137,170,.48)';ctx.stroke();
   }
  }
 }else if(o.type==='wax'){
  // 왁스는 부서져도 점토/파편이 바닥에 그대로 남는다.
  const grad=ctx.createLinearGradient(x,y,x,y+h);grad.addColorStop(0,'#ffc870');grad.addColorStop(.46,'#e89538');grad.addColorStop(1,'#aa571c');ctx.fillStyle=grad;rr(ctx,x,y,w,h,11);ctx.fill();
  ctx.strokeStyle='rgba(126,62,17,.44)';rr(ctx,x,y,w,h,11);ctx.stroke();
  const marks=o.waxMarks||[],seg=w/Math.max(1,marks.length);
  for(let i=0;i<marks.length;i++)if(marks[i]>0){
   const sx=x+seg*i,level=marks[i];
   ctx.fillStyle=`rgba(126,65,25,${.10+.06*level})`;ctx.beginPath();ctx.moveTo(sx+seg*.08,y+h*.22);ctx.lineTo(sx+seg*.48,y+h*.08);ctx.lineTo(sx+seg*.92,y+h*.31);ctx.lineTo(sx+seg*.72,y+h*.76);ctx.lineTo(sx+seg*.23,y+h*.83);ctx.closePath();ctx.fill();
   ctx.strokeStyle=`rgba(91,45,16,${.36+.10*level})`;ctx.lineWidth=1+level*.35;ctx.beginPath();ctx.moveTo(sx+seg*.22,y+4);ctx.lineTo(sx+seg*.48,y+h*.46);ctx.lineTo(sx+seg*.31,y+h*.92);ctx.moveTo(sx+seg*.48,y+h*.46);ctx.lineTo(sx+seg*.82,y+h*.18);ctx.stroke();
   // 부서진 작은 왁스 점토 조각
   ctx.fillStyle='#c66d26';for(let k=0;k<level+1;k++){const px=sx+seg*(.18+.23*k),py=y+h-3-(k%2)*3;ctx.beginPath();ctx.ellipse(px,py,4+level,2.5+level*.5,.2*k,0,Math.PI*2);ctx.fill()}
  }
  ctx.fillStyle='rgba(255,245,214,.44)';ctx.beginPath();ctx.ellipse(x+w*.27,y+8,w*.16,4,-.08,0,Math.PI*2);ctx.fill();
 }else{
  // 말랑이는 눌렸다가 천천히 원래 두께로 복원한다.
  const squash=Math.max(0,Math.min(1,o.squish||0)),sy=1-squash*.42,extra=(1-sy)*.22;
  const cx=x+w*(o.squishX||.5);ctx.translate(cx,y+h);ctx.scale(1+extra,sy);ctx.translate(-cx,-(y+h));
  const grad=ctx.createLinearGradient(x,y,x+w,y+h);grad.addColorStop(0,'#d4acf5');grad.addColorStop(.48,'#a66bd8');grad.addColorStop(1,'#7542ad');ctx.fillStyle=grad;rr(ctx,x,y,w,h,17);ctx.fill();
  ctx.strokeStyle='rgba(75,31,106,.38)';rr(ctx,x,y,w,h,17);ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.55)';rr(ctx,x+14,y+5,w*.42,8,6);ctx.fill();
 }
 ctx.restore();
}
function currentSprite(){let action=player.onGround?player.action:'jump',idx=0;if(action==='run')idx=Math.floor(player.actionTime/.095)%4;else if(action==='jump')idx=player.vy<35?0:1;else if(action==='slide')idx=Math.floor(player.actionTime/.12)%2;else if(action==='crouch')idx=player.actionTime<.13?0:1;return {action,img:sprites[action][idx]}}
function drawPlayer(){
 const p=player,{action,img}=currentSprite(),scale=Math.max(.72,Math.min(1.18,H/540)),baseline=p.y+p.h,centerX=p.x+p.w/2,jumpHeight=Math.max(0,groundY-baseline),shadowScale=Math.max(.35,1-jumpHeight/(H*.48));
 const shadowY=groundY+4;ctx.save();ctx.globalAlpha=.12*shadowScale;ctx.fillStyle='#071018';ctx.beginPath();ctx.ellipse(centerX,shadowY,31*shadowScale,6*shadowScale,0,0,Math.PI*2);ctx.fill();ctx.restore();if(!img||!img.complete||!img.naturalWidth)return;
 let targetH=88*scale,xOffset=0,yOffset=2;if(action==='jump'){targetH=84*scale;yOffset=0}if(action==='slide'){targetH=64*scale;xOffset=34*scale;yOffset=3}if(action==='crouch'){targetH=61*scale;yOffset=3}
 const targetW=targetH*(img.naturalWidth/img.naturalHeight),drawX=centerX-targetW/2+xOffset,drawY=baseline-targetH+yOffset;ctx.save();ctx.imageSmoothingEnabled=false;if(player.invuln>0&&Math.floor(player.invuln*16)%2===0)ctx.globalAlpha=.38;ctx.drawImage(img,Math.round(drawX),Math.round(drawY),Math.round(targetW),Math.round(targetH));ctx.restore();ctx.imageSmoothingEnabled=true;
}
function render(t){
 ctx.save();if(shake>.1){renderSeed=(renderSeed+1)&255;const sx=((renderSeed*73)%17-8)/8,sy=((renderSeed*37)%17-8)/8;ctx.translate(sx*shake*.5,sy*shake*.5)}drawBackground(t);drawPlatforms();drawHazards();
 for(let i=0;i<objects.length;i++)drawObject(objects[i]);for(let i=0;i<particles.length;i++){const p=particles[i];ctx.globalAlpha=Math.max(0,p.life*2.2);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;if(player)drawPlayer();if(flash>.01){ctx.fillStyle=`rgba(255,255,255,${flash})`;ctx.fillRect(0,0,W,H)}ctx.restore();
}
function loop(ts){const dt=Math.min(.033,(ts-last)/1000||0);last=ts;step(dt);render(ts/1000);requestAnimationFrame(loop)}
async function start(){
 startBtn.disabled=true;startBtn.textContent='사운드 준비중…';await wakeAudio().catch(()=>{});reset();state='playing';overlay.style.display='none';document.querySelector('.title').innerHTML='촉감런<br>ASMR PROTO';document.querySelector('.sub').innerHTML='키보드 발판과 공중 ASMR 발판을 이어 달려.<br><b>빈 곳에 떨어지면 즉시 게임오버!</b>';startBtn.disabled=false;startBtn.textContent='탭해서 시작';
}
startBtn.addEventListener('click',e=>{e.stopPropagation();void start()});
shell.addEventListener('pointerdown',e=>{if(e.target.tagName==='BUTTON')return;e.preventDefault();doJump()},{passive:false});
addEventListener('keydown',e=>{if(['Space','ArrowUp','ArrowDown','KeyS','KeyW','ShiftLeft','ShiftRight'].includes(e.code))e.preventDefault();if((e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW')&&!e.repeat)doJump();else if((e.code==='ShiftLeft'||e.code==='ShiftRight')&&!e.repeat)startSlide();else if((e.code==='ArrowDown'||e.code==='KeyS')&&!e.repeat)startCrouch()});
addEventListener('keyup',e=>{if(e.code==='ArrowDown'||e.code==='KeyS')stopCrouch();if(e.code==='ShiftLeft'||e.code==='ShiftRight')stopSlide()});
addEventListener('blur',()=>{stopCrouch();stopSlide()});
if(slideTouchBtn){
 slideTouchBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();slideTouchBtn.classList.add('active');startSlide()},{passive:false});
 for(const ev of ['pointerup','pointercancel','pointerleave'])slideTouchBtn.addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();slideTouchBtn.classList.remove('active');stopSlide()},{passive:false});
}
if(crouchTouchBtn){crouchTouchBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();crouchTouchBtn.classList.add('active');startCrouch()},{passive:false});for(const ev of ['pointerup','pointercancel','pointerleave'])crouchTouchBtn.addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();crouchTouchBtn.classList.remove('active');stopCrouch()},{passive:false})}
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
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=14-mobile-jump-slide-hold').catch(()=>{}));
reset();state='menu';loop(performance.now());
})();
