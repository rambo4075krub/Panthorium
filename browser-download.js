'use strict';
(async()=>{
 const edition=new URLSearchParams(location.search).get('edition')==='admin'?'admin':'user';
 document.querySelector('h1').textContent='Panthorium Browser '+(edition==='admin'?'Admin':'User');
 const status=document.getElementById('status');
 try{
  const response=await fetch('/browser-releases.json');
  if(!response.ok)throw new Error('release_unavailable');
  const release=await response.json();
  const assets=(release.assets||[]).filter(a=>a.name.startsWith('Panthorium-Browser-'+edition+'-')&&/\.(exe|dmg|AppImage)$/.test(a.name));
  for(const asset of assets){
   const url=new URL(asset.browser_download_url);
   if(url.origin!=='https://github.com'||!url.pathname.startsWith('/rambo4075krub/Panthorium/releases/download/'))continue;
   const link=document.createElement('a');link.textContent=asset.name;link.href=url.href;link.rel='noopener';document.getElementById('downloads').appendChild(link);
  }
  status.textContent=document.getElementById('downloads').children.length?'รุ่นทดสอบ Staging — เลือกไฟล์ที่ตรงกับระบบและสถาปัตยกรรมเครื่อง':'ตัวติดตั้งรุ่นนี้ยังอยู่ระหว่างเตรียม กรุณากลับมาตรวจอีกครั้ง';
 }catch(_){status.textContent='ตรวจรายการดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่ภายหลัง';}
})();