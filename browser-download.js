'use strict';
(async () => {
  const PLATFORMS = [
    { id: 'windows', label: 'Windows', icon: '🪟', match: (n) => /\.exe$/i.test(n) || /[-_]windows([-_.]|$)/i.test(n), fileHint: '.exe' },
    { id: 'macos', label: 'macOS', icon: '', match: (n) => /\.dmg$/i.test(n) || /[-_](macos|darwin|osx)([-_.]|$)/i.test(n), fileHint: '.dmg' },
    { id: 'linux', label: 'Linux', icon: '🐧', match: (n) => /\.AppImage$/i.test(n) || /[-_]linux([-_.]|$)/i.test(n), fileHint: '.AppImage' },
    { id: 'android', label: 'Android', icon: '🤖', match: (n) => /\.apk$/i.test(n) || /\.aab$/i.test(n) || /[-_]android([-_.]|$)/i.test(n), fileHint: '.apk / Play Store' },
    { id: 'ios', label: 'iOS', icon: '📱', match: (n) => /\.ipa$/i.test(n) || /[-_]ios([-_.]|$)/i.test(n), fileHint: '.ipa / App Store' }
  ];

  const params = new URLSearchParams(location.search);
  let edition = params.get('edition') === 'admin' ? 'admin' : 'user';
  const status = document.getElementById('status');
  const downloads = document.getElementById('downloads');
  const title = document.getElementById('title');

  function versionKey(name) {
    const nums = String(name).match(/\d+/g);
    if (!nums || !nums.length) return [0];
    return nums.map(Number);
  }

  function compareVersionDesc(a, b) {
    const left = versionKey(a);
    const right = versionKey(b);
    const len = Math.max(left.length, right.length);
    for (let i = 0; i < len; i += 1) {
      const x = left[i] || 0;
      const y = right[i] || 0;
      if (x !== y) return y - x; // newer first
    }
    return String(a).localeCompare(String(b));
  }

  function extractVersion(name) {
    const m = String(name).match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
    return m ? m[1] : '';
  }

  function trustedGithub(url) {
    try {
      const u = new URL(url);
      return u.origin === 'https://github.com' && u.pathname.startsWith('/rambo4075krub/Panthorium/releases/download/');
    } catch (_) {
      return false;
    }
  }

  function setEdition(next) {
    edition = next;
    document.querySelectorAll('#edition-tabs .tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.edition === edition);
    });
    if (title) title.textContent = 'Panthorium Browser ' + (edition === 'admin' ? 'Admin' : 'User');
    const url = new URL(location.href);
    url.searchParams.set('edition', edition);
    history.replaceState({}, '', url);
    render();
  }

  document.querySelectorAll('#edition-tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => setEdition(btn.dataset.edition));
  });

  function latestByPlatform(assets) {
    const map = {};
    for (const asset of assets) {
      const name = asset.name || '';
      if (!name.startsWith('Panthorium-Browser-' + edition + '-')) continue;
      const platform = PLATFORMS.find((p) => p.match(name));
      if (!platform) continue;
      if (!trustedGithub(asset.browser_download_url)) continue;
      const prev = map[platform.id];
      if (!prev || compareVersionDesc(name, prev.name) < 0) {
        map[platform.id] = {
          ...asset,
          platformId: platform.id,
          version: extractVersion(name) || asset.version || ''
        };
      }
    }
    return map;
  }

  function card(platform, asset, storeLinks) {
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.platform = platform.id;
    const version = asset?.version || '';
    const hasFile = Boolean(asset?.browser_download_url);
    const storeUrl = storeLinks?.[platform.id] || '';
    el.innerHTML = `
      <h2><span aria-hidden="true">${platform.icon}</span> ${platform.label}</h2>
      <div class="meta">ไฟล์: ${platform.fileHint}</div>
      <div class="ver">${hasFile ? ('v' + version) : (storeUrl ? 'ผ่านสโตร์' : 'ยังไม่พร้อม')}</div>
      <div class="actions"></div>
    `;
    const actions = el.querySelector('.actions');
    if (hasFile) {
      const a = document.createElement('a');
      a.className = 'btn primary';
      a.href = asset.browser_download_url;
      a.rel = 'noopener';
      a.textContent = 'ดาวน์โหลดล่าสุด · ' + asset.name;
      a.title = asset.name;
      actions.appendChild(a);
    }
    if (platform.id === 'android' || platform.id === 'ios') {
      if (storeUrl) {
        const s = document.createElement('a');
        s.className = 'btn primary';
        s.href = storeUrl;
        s.rel = 'noopener';
        s.target = '_blank';
        s.textContent = platform.id === 'android' ? 'เปิดใน Google Play' : 'เปิดใน App Store';
        actions.appendChild(s);
      } else if (!hasFile) {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'btn ghost disabled';
        s.textContent = platform.id === 'android' ? 'Google Play — เตรียมเผยแพร่' : 'App Store — เตรียมเผยแพร่';
        actions.appendChild(s);
      }
      if (platform.id === 'android' || platform.id === 'ios') {
        const pwa = document.createElement('button');
        pwa.type = 'button';
        pwa.className = 'btn ghost';
        pwa.textContent = 'ติดตั้งแบบ PWA จากเบราว์เซอร์';
        pwa.onclick = () => {
          if (window.deferredPanthoriumInstall) {
            window.deferredPanthoriumInstall.prompt();
          } else {
            alert('บนมือถือ: เปิดเมนูเบราว์เซอร์ → เพิ่มไปยังหน้าจอหลัก / Install app เพื่อติดตั้ง Panthorium แบบ PWA');
          }
        };
        actions.appendChild(pwa);
      }
    }
    if (!actions.children.length) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'btn ghost disabled';
      s.textContent = 'ยังไม่มีตัวติดตั้งล่าสุด';
      actions.appendChild(s);
    }
    return el;
  }

  async function render() {
    downloads.innerHTML = '';
    status.textContent = 'กำลังตรวจตัวติดตั้งที่พร้อมดาวน์โหลด…';
    try {
      const response = await fetch('/browser-releases.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('release_unavailable');
      const release = await response.json();
      const assets = release.assets || [];
      const latest = latestByPlatform(assets);
      const storeLinks = release.storeLinks || {};
      for (const platform of PLATFORMS) {
        downloads.appendChild(card(platform, latest[platform.id], storeLinks));
      }
      const ready = Object.keys(latest).length;
      status.textContent = ready
        ? `แสดงเฉพาะเวอร์ชันล่าสุดของรุ่น ${edition === 'admin' ? 'Admin' : 'User'} · พร้อม ${ready} แพลตฟอร์ม`
        : 'ตัวติดตั้งรุ่นนี้ยังอยู่ระหว่างเตรียม กรุณากลับมาตรวจอีกครั้ง';
    } catch (_) {
      status.textContent = 'ตรวจรายการดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่ภายหลัง';
      for (const platform of PLATFORMS) downloads.appendChild(card(platform, null, {}));
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.deferredPanthoriumInstall = event;
  });

  setEdition(edition);
})();
