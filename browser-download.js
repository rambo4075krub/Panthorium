'use strict';
(async () => {
  const PLATFORMS = [
    { id: 'windows', label: 'Windows', labelTh: 'วินโดวส์', icon: '🪟', match: (n) => /\.exe$/i.test(n) || /[-_]windows([-_.]|$)/i.test(n), ext: 'exe', fileHint: 'ไฟล์ .exe สำหรับ Windows' },
    { id: 'macos', label: 'macOS', labelTh: 'แมค', icon: '', match: (n) => /\.dmg$/i.test(n) || /[-_](macos|darwin|osx)([-_.]|$)/i.test(n), ext: 'dmg', fileHint: 'ไฟล์ .dmg สำหรับ macOS' },
    { id: 'linux', label: 'Linux', labelTh: 'ลินุกซ์', icon: '🐧', match: (n) => /\.AppImage$/i.test(n) || /[-_]linux([-_.]|$)/i.test(n), ext: 'AppImage', fileHint: 'ไฟล์ .AppImage สำหรับ Linux' },
    { id: 'android', label: 'Android', labelTh: 'แอนดรอยด์', icon: '🤖', match: (n) => /\.apk$/i.test(n) || /\.aab$/i.test(n) || /[-_]android([-_.]|$)/i.test(n), ext: 'apk', fileHint: 'ไฟล์ .apk / Google Play' },
    { id: 'ios', label: 'iOS', labelTh: 'ไอโอเอส', icon: '📱', match: (n) => /\.ipa$/i.test(n) || /[-_]ios([-_.]|$)/i.test(n), ext: 'ipa', fileHint: 'ไฟล์ .ipa / App Store' }
  ];

  const params = new URLSearchParams(location.search);
  function detectEdition() {
    if (params.get('edition') === 'admin') return 'admin';
    if (params.get('edition') === 'user') return 'user';
    try {
      if (/\/admin\b/i.test(document.referrer || '')) return 'admin';
    } catch (_) {}
    return 'user';
  }
  let edition = detectEdition();
  const status = document.getElementById('status');
  const downloads = document.getElementById('downloads');
  const title = document.getElementById('title');

  function extractVersion(name) {
    const m = String(name || '').match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
    return m ? m[1] : '';
  }

  function extractArch(name) {
    const n = String(name || '').toLowerCase();
    if (/arm64|aarch64/.test(n)) return 'arm64';
    if (/x86_64|x64|amd64/.test(n)) return 'x64';
    if (/ia32|x86(?!_)/.test(n)) return 'x86';
    return 'x64';
  }

  function extractExt(name, fallback) {
    const m = String(name || '').match(/\.([A-Za-z0-9]+)$/);
    return m ? m[1] : fallback;
  }

  /** Always show OS name in the filename so users pick the right file. */
  function labeledFileName(platform, asset) {
    const version = asset.version || extractVersion(asset.name) || 'latest';
    const arch = extractArch(asset.name);
    const ext = extractExt(asset.name, platform.ext);
    return 'Panthorium-Browser-' + edition + '-' + version + '-' + platform.id + '-' + arch + '.' + ext;
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

  function preferOsTagged(name, platformId) {
    const lower = String(name || '').toLowerCase();
    if (platformId === 'windows') return /[-_]windows([-_.]|$)/.test(lower) ? 2 : 1;
    if (platformId === 'macos') return /[-_](macos|darwin|osx)([-_.]|$)/.test(lower) ? 2 : 1;
    if (platformId === 'linux') return /[-_]linux([-_.]|$)/.test(lower) ? 2 : 1;
    return 1;
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
    for (const asset of assets || []) {
      const name = asset.name || '';
      if (!name.startsWith('Panthorium-Browser-' + edition + '-')) continue;
      if (!trustedGithub(asset.browser_download_url)) continue;
      const platform = PLATFORMS.find((p) => p.match(name));
      if (!platform) continue;
      const prev = map[platform.id];
      if (!prev) {
        map[platform.id] = { ...asset, platformId: platform.id, version: extractVersion(name) };
        continue;
      }
      if (versionNewer(name, prev.name)) {
        map[platform.id] = { ...asset, platformId: platform.id, version: extractVersion(name) };
        continue;
      }
      if (versionNewer(prev.name, name)) continue;
      if (preferOsTagged(name, platform.id) > preferOsTagged(prev.name, platform.id)) {
        map[platform.id] = { ...asset, platformId: platform.id, version: extractVersion(name) };
      }
    }
    return map;
  }

  function card(platform, asset, storeLinks) {
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.platform = platform.id;

    const h2 = document.createElement('h2');
    h2.innerHTML = '<span aria-hidden="true">' + platform.icon + '</span> ' + platform.label;
    el.appendChild(h2);

    const osLine = document.createElement('div');
    osLine.className = 'meta';
    osLine.textContent = 'ระบบปฏิบัติการ: ' + platform.label + ' (' + platform.labelTh + ')';
    el.appendChild(osLine);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = platform.fileHint;
    el.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const hasFile = Boolean(asset?.browser_download_url);
    const storeUrl = storeLinks?.[platform.id] || '';

    if (hasFile) {
      const ver = document.createElement('div');
      ver.className = 'ver';
      ver.textContent = 'เวอร์ชันล่าสุด v' + (asset.version || extractVersion(asset.name));
      el.appendChild(ver);

      const a = document.createElement('a');
      a.className = 'btn primary';
      a.href = asset.browser_download_url;
      a.rel = 'noopener';
      a.setAttribute('download', labeledFileName(platform, asset));
      a.textContent = 'ดาวน์โหลดสำหรับ ' + platform.label;
      a.title = labeledFileName(platform, asset);
      actions.appendChild(a);

      const file = document.createElement('div');
      file.className = 'meta';
      file.style.wordBreak = 'break-all';
      file.textContent = labeledFileName(platform, asset);
      actions.appendChild(file);
    } else {
      const ver = document.createElement('div');
      ver.className = 'ver';
      ver.textContent = storeUrl ? 'พร้อมในสโตร์' : 'ยังไม่พร้อม';
      el.appendChild(ver);
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
        ? 'เลือกตามระบบปฏิบัติการ · แสดงเฉพาะเวอร์ชันล่าสุด (' + ready + ' แพลตฟอร์ม)'
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
