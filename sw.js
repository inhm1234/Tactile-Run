const CACHE='tactile-run-v16-material-state-audio-overlap';
const ASSETS=[
 './','./index.html','./game.js?v=16-material-state-audio-overlap','./manifest.webmanifest?v=16','./icons/icon-192.png','./icons/icon-512.png',
 './KEY_1.wav','./KEY_2.wav','./KEY_3.wav','./KEY_4.wav','./KEY_5.wav',
 './wax1.wav','./wax2.wav','./wax3.wav','./wax4.wav','./wax5.wav',
 './malrang1.wav','./malrang2.wav','./malrang3.wav',
 './bubble1.wav','./bubble2.wav','./bubble3.wav','./bubble4.wav',
 './sprites/run1.png','./sprites/run2.png','./sprites/run3.png','./sprites/run4.png',
 './sprites/jump1.png','./sprites/jump2.png','./sprites/slide1.png','./sprites/slide2.png','./sprites/crouch1.png','./sprites/crouch2.png'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.mode==='navigate'||u.pathname.endsWith('/index.html')||u.pathname.endsWith('/game.js')||u.pathname.endsWith('/manifest.webmanifest')){
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)));
  return;
 }
 e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
