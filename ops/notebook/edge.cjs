'use strict';
// Stable loopback entry point. Only the local controller changes active.json.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
function createEdge(statePath, allowedPorts) {
  const sockets = new Set();
  function target(url) {
    const p = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    if (p.startsWith('/__notebook')) return {status:404};
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, ''));
    if (state.maintenance) return {status:503};
    if (!allowedPorts.includes(state.port)) throw Error('invalid_backend_port');
    return {port:state.port};
  }
  const server = http.createServer((req, res) => {
    let t; try { t=target(req.url); } catch { t={status:503}; }
    if (t.status) {
      res.writeHead(t.status, {'content-type':'application/json','cache-control':'no-store','retry-after':'30'});
      return res.end(JSON.stringify({ok:false,error:t.status===404?'not_found':'updating'}));
    }
    const upstream = http.request({hostname:'127.0.0.1',port:t.port,method:req.method,path:req.url,headers:req.headers}, r => {
      res.writeHead(r.statusCode,r.headers);r.pipe(res);
      r.on('error',()=>res.destroy());
    });
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'cache-control':'no-store'});res.end();});
    req.on('aborted',()=>upstream.destroy());
    res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
    req.pipe(upstream);
  });
  server.on('upgrade',(req,socket,head)=>{
    let t;try{t=target(req.url);}catch{t={status:503};}
    if(t.status){socket.end('HTTP/1.1 '+t.status+' Unavailable\r\nConnection: close\r\n\r\n');return;}
    const u=http.request({hostname:'127.0.0.1',port:t.port,method:req.method,path:req.url,headers:req.headers});
    u.on('upgrade',(r,peer,peerHead)=>{
      socket.write('HTTP/1.1 101 Switching Protocols\r\n'+r.rawHeaders.reduce((a,v,i)=>i%2?a:a+v+': '+r.rawHeaders[i+1]+'\r\n','')+'\r\n');
      if(head.length)peer.write(head);if(peerHead.length)socket.write(peerHead);
      peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
      peer.on('close',()=>socket.destroy());socket.on('close',()=>peer.destroy());
      socket.pipe(peer).pipe(socket);
    });
    u.on('response',r=>{socket.end('HTTP/1.1 '+r.statusCode+' Rejected\r\nConnection: close\r\n\r\n');r.resume();});
    u.on('error',()=>socket.destroy());socket.on('close',()=>u.destroy());u.end();
  });
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  server.shutdown=()=>{server.close();for(const s of sockets)s.destroy();};
  return server;
}
if(require.main===module){
  const stage=process.argv[2];
  if(!['production','staging'].includes(stage))throw Error('stage_required');
  const publicPort=stage==='production'?8790:8791;
  const allowed=stage==='production'?[8810,8811]:[8820,8821];
  const root=process.env.PANTHORIUM_HOST_ROOT||'D:/Panthorium/Host';
  const server=createEdge(path.join(root,stage,'active.json'),allowed);
  server.listen(publicPort,'127.0.0.1',()=>console.log('Notebook edge ready: '+stage));
}
module.exports={createEdge};
