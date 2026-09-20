'use strict';
(async () => {
  const PLATFORMS = [
    { id: 'windows', label: 'Windows', icon: '🪟', match: (n) => /\.exe$/i.test(n) || /[-_]windows([-_.]|$)/i.test(n), fileHint: 'ตัวติดตั้ง .exe' },
    { id: 'macos', label: 'macOS', icon: '', match: (n) => /\.dmg$/i.test(n) || /[-_](macos|darwin|osx)([-_.]|$)/i.test(n), fileHint: 'ตัวติดตั้ง .dmg' },
    { id: 'linux', label: 'Linux', icon: '🐧', match: (n) => /\.AppImage$/i.test(n) || /[-_]linux([-_.]|$)/i.test(n), fileHint: 'ตัวติดตั้ง .AppImage' },
    { id: 'android', label: 'Android', icon: '🤖', match: (n) => /\.apk$/i.test(n) || /\.aab$/i.test(n) || /[-_]android([-_.]|$)/i.test(n), fileHint: '.apk / Google Play' },
    { id: 'ios', label: 'iOS', icon: '📱', match: (n) => /\.ipa$/i.test(n) || /[-_]ios([-_.]|$)/i.test(n), fileHint: '.ipa / App Store' }
  ];

  const params = new URLSearchParams(location.search);
  let edition = params.get('edition') === 'admin' ? 'admin' : 'user';
  const status = document.getElementById('status');
  const downloads = document.getElementById('downloads');
  const title = document.getElementById('title');

  function extractVersion(name) {
    const m = String(name || '').match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
    return m ? m[1] : '';
  }

  function versionNewer(a, b) {
    const left = extractVersion(a).split('.').map((n) => Number(n) || 0);
    const right = extractVersion(b).split('.').map((n) => Number(n) || 0);
    const len = Math.max(left.length, right.length);
    for (let i = 0; i < len; i += 1) {
      const x = left[i] || 0;
      const y = right[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
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

  /** One newest file per platform for the active edition. */
  function latestByPlatform(assets) {
    const map = {};
    for (const asset of assets || []) {
      const name = asset.name || '';
      if (!name.startsWith('Panthorium-Browser-' + edition + '-')) continue;
      if (!trustedGithub(asset.browser_download_url)) continue;
      const platform = PLATFORMS.find((p) => p.match(name));
      if (!platform) continue;
      const prev = map[platform.id];
      if (!prev || versionNewer(name, prev.name)) {
        map[platform.id] = {
          ...asset,
          platformId: platform.id,
          version: extractVersion(name)
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

    const h2 = document.createElement('h2');
    h2.innerHTML = '<span aria-hidden="true">' + platform.icon + '</span> ' + platform.label;
    el.appendChild(h2);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = platform.fileHint;
    el.appendChild(meta);

    const ver = document.createElement('div');
    ver.className = 'ver';
    ver.textContent = hasFile ? ('เวอร์ชันล่าสุด v' + version) : (storeUrl ? 'พร้อมในสโตร์' : 'ยังไม่พร้อม');
    el.appendChild(ver);

    const actions = document.createElement('div');
    actions.className = 'actions';

    if (hasFile) {
      const a = document.createElement('a');
      a.className = 'btn primary';
      a.href = asset.browser_download_url;
      a.rel = 'noopener';
      a.textContent = 'ดาวน์โหลด ' + platform.label;
      a.title = asset.name;
      actions.appendChild(a);
      const file = document.createElement('div');
      file.className = 'meta';
      file.textContent = asset.name;
      actions.appendChild(file);
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
        s.textContent = platform.id === 'android' ? 'Google Play — เร็วๆ นี้' : 'App Store — เร็วๆ นี้';
        actions.appendChild(s);
      }
      const pwa = document.createElement('button');
      pwa.type = 'button';
      pwa.className = 'btn ghost';
      pwa.textContent = 'ติดตั้งแบบ PWA จากเบราว์เซอร์';
      pwa.onclick = () => {
        if (window.deferredPanthoriumInstall) window.deferredPanthoriumInstall.prompt();
        else alert('บนมือถือ: เปิดเมนูเบราว์เซอร์ → เพิ่มไปยังหน้าจอหลัก / Install app');
      };
      actions.appendChild(pwa);
    }

    if (!actions.children.length) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'btn ghost disabled';
      s.textContent = 'ยังไม่มีตัวติดตั้ง';
      actions.appendChild(s);
    }

    el.appendChild(actions);
    return el;
  }

  async function render() {
    downloads.innerHTML = '';
    status.textContent = 'กำลังตรวจเวอร์ชันล่าสุด…';
    try {
      const response = await fetch('/browser-releases.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('release_unavailable');
      const release = await response.json();
      const latest = latestByPlatform(release.assets || []);
      const storeLinks = release.storeLinks || {};
      for (const platform of PLATFORMS) {
        downloads.appendChild(card(platform, latest[platform.id], storeLinks));
      }
      const ready = Object.keys(latest).length;
      status.textContent = ready
        ? 'แสดงเฉพาะเวอร์ชันล่าสุด · พร้อม ' + ready + ' แพลตฟอร์ม (รุ่น ' + (edition === 'admin' ? 'Admin' : 'User') + ')'
        : 'ตัวติดตั้งรุ่นนี้ยังอยู่ระหว่างเตรียม';
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
