"use strict";
const CACHE="acbf-v3.3.0-usability-refinement";
const CORE=["./","./index.html","./styles.css","./engine.js","./database.js","./app.js","./caribbean-map.jpg","./man-o-war-hybrid.png","./branding-splash.png","./favicon-16.png","./favicon-32.png","./favicon-64.png","./manifest.webmanifest","./icon-180.png","./icon-192.png","./icon-512.png","./VERSION.json","./CHANGELOG.md","./UPLOAD_INSTRUCTIONS.md","./KNOWN_LIMITATIONS.md","./DATABASE_COVERAGE.md","./TESTING_REPORT.md","./UPGRADE_GUIDE.md","./ARCHITECTURE.md","./TESTING_REPORT_V3.3.0.md","./BUILD_CHECKSUMS.txt"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
  const sensitive=/\.(?:html|js|css|webmanifest|json)$/.test(url.pathname)||url.pathname.endsWith("/");
  if(sensitive){event.respondWith(fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));return response}).catch(async()=>await caches.match(event.request)||await caches.match("./index.html")));return}
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));return response}).catch(()=>caches.match("./index.html"))));
});
