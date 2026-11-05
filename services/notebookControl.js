'use strict';
const {timingSafeEqual}=require('node:crypto');
function installNotebookControl(app) {
  let shutdown=null;
  app.post('/__notebook/shutdown',(req,res)=>{
    const secret=process.env.PANTHORIUM_DEPLOY_CONTROL_TOKEN||'';
    const provided=String(req.get('x-panthorium-control')||'');
    const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const good=local && secret.length>=32 && Buffer.byteLength(secret)===Buffer.byteLength(provided)
      && timingSafeEqual(Buffer.from(secret),Buffer.from(provided));
    if(!good)return res.status(404).json({ok:false,error:'not_found'});
    if(!shutdown)return res.status(503).json({ok:false});
    res.status(202).json({ok:true});setImmediate(shutdown);
  });
  return {setShutdown(fn){shutdown=fn;}};
}
module.exports={installNotebookControl};
