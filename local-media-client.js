/* Bounded image/video sampling happens in the user's browser before upload. */
(function(root) {
  'use strict';
  function waitEvent(target, success, signal) {
    return new Promise((resolve,reject) => {
      const timer=setTimeout(()=>finish(Error('อ่านไฟล์สื่อไม่สำเร็จภายในเวลาที่กำหนด')),15000);
      const finish=error=>{clearTimeout(timer);target.removeEventListener(success,ok);target.removeEventListener('error',bad);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
      const ok=()=>finish(),bad=()=>finish(Error('รูปแบบไฟล์นี้เปิดไม่ได้')),abort=()=>finish(new DOMException('Cancelled','AbortError'));
      target.addEventListener(success,ok,{once:true});target.addEventListener('error',bad,{once:true});signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
    });
  }
  function frame(source,width,height) {
    if(!width||!height||width*height>40000000)throw Error('ภาพมีขนาดใหญ่เกินไป');
    const scale=Math.min(1,768/Math.max(width,height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
    let dataUrl=canvas.toDataURL('image/jpeg',.8);
    if(dataUrl.length>349550)dataUrl=canvas.toDataURL('image/jpeg',.5);
    if(dataUrl.length>349550)throw Error('ภาพยังใหญ่เกินไป กรุณาครอบภาพก่อนส่ง');
    return dataUrl;
  }
  async function prepare(files,signal) {
    files=Array.from(files||[]);
    if(files.length>4)throw Error('แนบได้ไม่เกิน 4 ภาพ หรือวิดีโอ 1 ไฟล์');
    if(files.some(f=>f.type.startsWith('video/'))&&files.length!==1)throw Error('ส่งวิดีโอครั้งละ 1 ไฟล์โดยไม่แนบภาพเพิ่ม');
    const result=[];
    for(const file of files){
      signal?.throwIfAborted();
      const video=file.type.startsWith('video/');
      if((!video&&!/^image\/(jpeg|png|webp)$/.test(file.type))||file.size>(video?50:12)*1024**2)throw Error('รองรับ JPG/PNG/WebP ไม่เกิน 12 MB หรือวิดีโอไม่เกิน 50 MB');
      const url=URL.createObjectURL(file),element=document.createElement(video?'video':'img');
      try{
        element.muted=true;element.preload='auto';
        const loaded=waitEvent(element,video?'loadeddata':'load',signal);element.src=url;await loaded;
        if(video){
          if(!Number.isFinite(element.duration)||element.duration<=0||element.duration>600)throw Error('วิดีโอต้องยาวไม่เกิน 10 นาที');
          for(let i=0;i<4;i++){
            const seconds=(i+.5)*element.duration/4;
            const seek=waitEvent(element,'seeked',signal);element.currentTime=seconds;await seek;
            result.push({dataUrl:frame(element,element.videoWidth,element.videoHeight),seconds});
          }
        }else result.push({dataUrl:frame(element,element.naturalWidth,element.naturalHeight)});
      }finally{element.removeAttribute('src');if(video)element.load();URL.revokeObjectURL(url);}
    }
    return result;
  }
  root.PanthoriumLocalMedia={prepare};
})(window);
