const CACHE='tactile-run-v4-real-audio';
const ASSETS=['./','./index.html','./game.js?v=4-real-audio','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./keyboard1.wav','./keyboard2.wav','./keyboard3.wav','./keyboard4.wav','./wax1.wav','./wax2.wav','./wax3.wav','./wax4.wav','./wax5.wav'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.mode==='navigate'||u.pathname.endsWith('/index.html')||u.pathname.endsWith('/game.js')){
    e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
