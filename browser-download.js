'use strict';
(async()=>{
 const edition=new URLSearchParams(location.search).get('edition')==='admin'?'admin':'user';
 document.querySelector('h1').textContent='Panthorium Browser '+(edition==='admin'?'Admin':'User');
 const status=document.getElementById('status');
 const downloads=document.getElementById('downloads');
 try{
  const response=await fetch('/browser-releases.json',{cache:'no-store'});
  if(!response.ok)throw new Error('release_unavailable');
  const release=await response.json();
  const assets=(release.assets||[])
    .filter(a=>a.name.startsWith('Panthorium-Browser-'+edition+'-')&&/\.(exe|dmg|AppImage)$/.test(a.name))
    .sort((a,b)=>{
      const nums=v=>String(v).match(/\d+/g)?.map(Number)||[0];
      const left=nums(a.name),right=nums(b.name);
      const len=Math.max(left.length,right.length);
      for(let i=0;i<len;i+=1){
        const x=left[i]||0,y=right[i]||0;
        if(x!==y)return y-x; // newest first
      }
      return a.name.localeCompare(b.name);
    });
  for(const asset of assets){
   const url=new URL(asset.browser_download_url);
   if(url.origin!=='https://github.com'||!url.pathname.startsWith('/rambo4075krub/Panthorium/releases/download/'))continue;
   const link=document.createElement('a');
   link.textContent=asset.name;
   link.href=url.href;
   link.rel='noopener';
   downloads.appendChild(link);
  }
  status.textContent=downloads.children.length
    ?'รุ่น Staging — รายการเรียงจากเวอร์ชันใหม่ไปเก่า เลือกไฟล์ที่ตรงกับระบบเครื่อง'
    :'ตัวติดตั้งรุ่นนี้ยังอยู่ระหว่างเตรียม กรุณากลับมาตรวจอีกครั้ง';
 }catch(_){status.textContent='ตรวจรายการดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่ภายหลัง';}
})();
