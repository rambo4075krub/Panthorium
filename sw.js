const CACHE_NAME = 'panthorium-os-v10-original-orange';
const STATIC_ASSETS = ['./manifest.json?v=original-orange-20261015'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();

    // Updated clients manage reloads without losing edits. Migrate older clients
    // that do not implement the handshake once to the fresh no-store shell.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clients.map(async (client) => {
      const managed = await new Promise(resolve => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1500);
        channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.managed === true); };
        try { client.postMessage({ type: 'panthorium:update-ready' }, [channel.port2]); }
        catch (_) { clearTimeout(timer); channel.port1.close(); resolve(false); }
      });
      if (!managed) { try { return await client.navigate(client.url); } catch (_) {} }
    }));
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate' || request.destination === 'document' || request.destination === 'script') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () => (await caches.match(request)) || Response.error()));
    return;
  }

  event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || Response.error()));
});

// Persist only the random device binding, never authentication tokens or message contents.
function pushBinding(value) {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('panthorium-push',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('device');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('device',value===undefined?'readonly':'readwrite'),store=tx.objectStore('device');
      const op=value===undefined?store.get('binding'):store.put(value,'binding');
      tx.oncomplete=()=>{db.close();resolve(op.result);};tx.onerror=()=>{db.close();reject(tx.error);};
    };
  });
}
self.addEventListener('message',event=>{
  if(event.data?.type!=='panthorium:push-binding'||!event.source?.url)return;
  if(new URL(event.source.url).origin!==self.location.origin)return;
  const binding=event.data.binding;
  if(binding!==null&&!/^[A-Za-z0-9_-]{32}$/.test(binding||''))return;
  event.waitUntil(pushBinding(binding).then(()=>event.ports?.[0]?.postMessage({ok:true})));
});
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let data;try{data=event.data.json();}catch{return;}
    if(data?.v!==1||!/^notice_[a-f0-9]{64}$/.test(data.id||'')||data.binding!==await pushBinding())return;
    await self.registration.showNotification('Panthorium',{
      body:'มีการแจ้งเตือนใหม่ เปิด Panthorium เพื่อดูรายละเอียด',
      tag:data.id,silent:data.silent===true,data:{url:'/?notifications=1'},icon:'/panthorium-logo.png'
    });
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(c=>new URL(c.url).origin===self.location.origin);
    if(existing){await existing.focus();existing.postMessage({type:'panthorium:open-notifications'});}
    else await self.clients.openWindow('/?notifications=1');
  })());
});
