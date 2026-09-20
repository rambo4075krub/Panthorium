'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const metadata=require('../package.json');
const directory=path.resolve(process.argv[2]||'dist');
const releaseBase='https://github.com/rambo4075krub/Panthorium/releases/download/staging/';

function detectPlatform(name){
  if(name.endsWith('.exe'))return 'windows';
  if(name.endsWith('.dmg'))return 'macos';
  if(name.endsWith('.AppImage'))return 'linux';
  return null;
}

function compareVersion(a,b){
  const parts=value=>{
    const nums=String(value||'').match(/\d+/g);
    if(!nums||!nums.length)return [0,0,0];
    return nums.slice(0,4).map(n=>Number(n)||0);
  };
  const left=parts(a),right=parts(b);
  const len=Math.max(left.length,right.length);
  for(let i=0;i<len;i+=1){
    const x=left[i]||0,y=right[i]||0;
    if(x!==y)return x>y?1:x<y?-1:0;
  }
  return 0;
}

if(!fs.existsSync(directory))throw new Error('dist directory missing: '+directory);

const files=fs.readdirSync(directory).sort((a,b)=>a.localeCompare(b));
for(const edition of ['admin','user']){
  const manifest={
    version:metadata.version,
    edition,
    releasedAt:new Date().toISOString(),
    assets:{}
  };
  for(const name of files){
    if(!name.startsWith('Panthorium-Browser-'+edition+'-'))continue;
    const platform=detectPlatform(name);
    if(!platform)continue;
    const bytes=fs.readFileSync(path.join(directory,name));
    const asset={
      name,
      url:releaseBase+name,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      size:bytes.length
    };
    const existing=manifest.assets[platform];
    if(!existing || compareVersion(name,existing.name)>0){
      manifest.assets[platform]=asset;
    }
  }
  if(!manifest.assets.windows)throw new Error('missing Windows '+edition+' installer');
  const out=path.join(directory,'Panthorium-Browser-'+edition+'-update.json');
  fs.writeFileSync(out,JSON.stringify(manifest,null,2)+'\n');
  console.log('wrote',path.basename(out),'platforms',Object.keys(manifest.assets).sort().join(','));
}
console.log('Panthorium update manifests created for version',metadata.version);
