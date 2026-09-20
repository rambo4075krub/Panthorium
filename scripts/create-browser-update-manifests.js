'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const metadata=require('../package.json');
const directory=path.resolve(process.argv[2]||'dist');
const releaseBase='https://github.com/rambo4075krub/Panthorium/releases/download/staging/';
for(const edition of ['admin','user']){
  const manifest={version:metadata.version,edition,assets:{}};
  for(const name of fs.readdirSync(directory)){
    if(!name.startsWith('Panthorium-Browser-'+edition+'-'))continue;
    const platform=name.endsWith('.exe')?'windows':name.endsWith('.dmg')?'macos':name.endsWith('.AppImage')?'linux':null;
    if(!platform)continue;
    const bytes=fs.readFileSync(path.join(directory,name));
    manifest.assets[platform]={name,url:releaseBase+name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
  }
  if(!manifest.assets.windows)throw new Error('missing Windows '+edition+' installer');
  fs.writeFileSync(path.join(directory,'Panthorium-Browser-'+edition+'-update.json'),JSON.stringify(manifest,null,2)+'\n');
}
console.log('Panthorium update manifests created');
