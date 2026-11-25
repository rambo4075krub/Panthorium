(function () {
  'use strict';
  const U = window.PanthoriumToolsUI,
    P = window.PanthoriumToolProjects,
    F = window.PanthoriumToolFiles;
  const {el, button, field, input, row, download, fileName, defaults, friendly} = U;
  const id = 'online-tools',
    rootApi = '/api/online-tools';
  const catalogue = [
    ['office', 'เอกสาร ตาราง และสไลด์', 'Word · Excel · PowerPoint', 'document'],
    ['form', 'แบบฟอร์ม', 'ลิงก์รับคำตอบ · CSV', 'chart'],
    ['design', 'ออกแบบสื่อร้านค้า', 'โปสเตอร์ · เมนู · แค็ตตาล็อก', 'pen'],
    ['cutout', 'ลบพื้นหลัง', 'รูปสินค้าพื้นโปร่งใส · PNG', 'image'],
    ['video', 'ตัดต่อวิดีโอ', 'สร้างหนังและซีรีส์ · ไทม์ไลน์ · MP4', 'video'],
    ['pdf', 'จัดการ PDF', 'เลือกหน้า · จัดลำดับ · รวมไฟล์', 'document'],
    ['page', 'หน้าจดงานและแม่แบบ', 'เช็กลิสต์ · แผนคอนเทนต์ · แชร์สำเนา', 'work'],
    ['flow', 'งานอัตโนมัติ', 'รับฟอร์ม · ติดตาม · แจ้งทีม', 'settings']
  ];
  const kinds = new Set(['form', 'design', 'page', 'flow']);
  const apps = () => (typeof OS === 'undefined' ? null : OS);
  const principal = () => String(apps()?.state?.user?.sub || apps()?.state?.user?.id || '');
  const allowed = () =>
    principal() &&
    !/^guest[:_-]/i.test(principal()) &&
    !apps()?.state?.user?.roles?.includes('guest') &&
    apps()?.state?.user?.permissions?.includes('chat');
  const backend = () => String(apps()?.config?.backendUrl || '').replace(/\/$/, '');
  let view,
    pending = '',
    loginLink = '';
  function close() {
    if (view) {
      view.page?.abort();
      view.controller.abort();
      view = null;
    }
    if (typeof closeWindow === 'function') closeWindow(id);
  }
  function open() {
    if (!allowed()) {
      window.PanthoriumAccounts?.openLogin?.();
      return null;
    }
    if (view && view.owner === principal() && view.root.isConnected) {
      window.PanthoriumWindowManager?.restore?.(id);
      if (typeof focusWindow === 'function') focusWindow(id);
      return view;
    }
    if (typeof createWindow !== 'function') return null;
    createWindow(id, 'เครื่องมือออนไลน์', '<div class="ot ot-shell" data-online-tools></div>', {
      width: 1080,
      height: 760,
      onClose: () => {
        if (view) {
          view.page?.abort();
          view.controller.abort();
          view = null;
        }
      }
    });
    const root = document.querySelector('.window[data-id="online-tools"] [data-online-tools]');
    if (!root) return null;
    const v = {
      owner: principal(),
      root,
      controller: new AbortController(),
      epoch: 0,
      dirty: false,
      busy: false
    };
    view = v;
    v.nav = el('nav', null, {'aria-label': 'เครื่องมือออนไลน์'});
    v.heading = el('h2');
    v.panel = el('section', null, {class: 'ot-panel'});
    v.status = el('div', '', {role: 'status', class: 'ot-status'});
    const content = el('div', null, {class: 'ot-content'});
    content.append(v.heading, v.status, v.panel);
    root.append(v.nav, content);
    for (const [kind, name, , icon] of catalogue) {
      const b = button('', () => navigate(v, kind));
      b.dataset.tool = kind;
      const svg = window.PanthoriumStartMenuUI?.icon(icon);
      if (svg) b.append(svg);
      b.append(el('span', name));
      v.nav.append(b);
    }
    root.closest('.window')?.addEventListener('panthorium:before-window-close', (e) => {
      if (
        v.owner === principal() &&
        (v.busy || (v.dirty && !confirm('ออกจากงานที่ยังไม่ได้บันทึกหรือไม่?')))
      )
        e.preventDefault();
    });
    navigate(v, 'home');
    return v;
  }
  function valid(v) {
    return view === v && v.owner === principal() && allowed() && v.root.isConnected;
  }
  async function request(v, path, options = {}, raw = false) {
    const send = () => {
      if (!valid(v)) throw Error('auth_required');
      const token = apps()?.config?.accessToken;
      return fetch(backend() + path, {
        ...options,
        credentials: 'include',
        cache: 'no-store',
        signal: v.controller.signal,
        headers: {
          ...(token ? {Authorization: 'Bearer ' + token} : {}),
          ...(options.body ? {'Content-Type': 'application/json'} : {}),
          ...options.headers
        }
      });
    };
    let res = await send();
    if (
      res.status === 401 &&
      window.PanthoriumAuth?.refreshSession &&
      (await window.PanthoriumAuth.refreshSession().catch(() => false))
    )
      res = await send();
    if (!valid(v)) throw Error('auth_required');
    if (raw && res.ok) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw Error(data.error || 'HTTP ' + res.status);
    return data;
  }
  const json = (method, body) => ({method, body: JSON.stringify(body)});
  function context(v) {
    const epoch = v.epoch,
      live = () => valid(v) && v.epoch === epoch;
    const report = (t) => {
      if (live()) v.status.textContent = t;
    };
    const handle = (fn) => async (e) => {
      if (!live() || v.busy) return;
      v.busy = true;
      v.root.setAttribute('aria-busy', 'true');
      v.panel.inert = true;
      try {
        await fn(e);
      } catch (err) {
        if (valid(v) && err.name !== 'AbortError') v.status.textContent = friendly(err);
      } finally {
        if (valid(v)) {
          v.busy = false;
          v.panel.inert = false;
          v.root.removeAttribute('aria-busy');
        }
      }
    };
    const api = async (path, opts, raw) => {
      if (!live()) throw Error('auth_required');
      const d = await request(v, rootApi + path, opts, raw);
      if (!live()) throw Error('งานถูกปิดแล้ว');
      return d;
    };
    return {
      panel: v.panel,
      request: (path,opts,raw) => live() ? request(v,path,opts,raw) : Promise.reject(Error('auth_required')),
      signal: v.page.signal,
      live,
      report,
      handle,
      act: (label, fn) => button(label, handle(fn)),
      api,
      changed: () => {
        if (live()) v.dirty = true;
      },
      clean: () => {
        if (live()) v.dirty = false;
      },
      output: async (blob, name, cloud) => {
        if (!live()) return;
        if (cloud) {
          await request(v, '/api/files', {
            method: 'POST',
            body: blob,
            headers: {
              'Content-Type': 'application/octet-stream',
              'x-file-name': encodeURIComponent(name),
              'x-file-content-type': blob.type
            }
          });
          report('บันทึกในไฟล์ของฉันแล้ว');
        } else download(blob, name);
      }
    };
  }
  function reset(v, title) {
    v.page?.abort();
    v.page = new AbortController();
    v.epoch++;
    v.dirty = false;
    v.heading.textContent = title;
    v.panel.replaceChildren();
    v.panel.inert = false;
    v.status.textContent = '';
    return context(v);
  }
  function leave(v) {
    return !v.busy && (!v.dirty || confirm('มีงานที่ยังไม่ได้บันทึก ต้องการเปลี่ยนหน้าหรือไม่?'));
  }
  function navigate(v, kind) {
    if (!valid(v) || !leave(v)) return;
    const tool = catalogue.find((t) => t[0] === kind),
      ctx = reset(v, tool?.[1] || 'เครื่องมือออนไลน์');
    for (const b of v.nav.children) b.setAttribute('aria-current', String(b.dataset.tool === kind));
    if (kind === 'home') {
      const grid = el('div', null, {class: 'ot-grid'});
      for (const [key, title, hint] of catalogue) {
        const b = button('', () => navigate(v, key));
        b.append(el('strong', title), el('span', hint));
        grid.append(b);
      }
      ctx.panel.append(grid);
      return;
    }
    if (kind === 'office' || kind === 'video') {
      if (kind === 'video') ctx.panel.append(ctx.act('สร้างหนังและซีรีส์', () => navigateFilm(v)));
      const items =
        kind === 'video'
          ? [['video', 'เปิดไทม์ไลน์วิดีโอ']]
          : [
              ['document', 'เปิดเอกสาร Word'],
              ['spreadsheet', 'เปิดตาราง Excel'],
              ['presentation', 'เปิดงานนำเสนอ PowerPoint']
            ];
      for (const [key, title] of items)
        ctx.panel.append(ctx.act(title, () => window.PanthoriumCreativeStudio.open(key)));
      return;
    }
    if (kind === 'cutout') return F.cutout(ctx);
    if (kind === 'pdf') return F.pdfDesk(ctx);
    projectList(v, kind, ctx).catch((e) => ctx.report(friendly(e)));
  }
  async function projectList(v, kind, ctx) {
    const createBtn = ctx.act('สร้างใหม่', () =>
      edit(v, {id: crypto.randomUUID(), kind, title: '', body: defaults(kind), owner: true}, true)
    );
    ctx.panel.append(createBtn);
    if (kind === 'design')
      ctx.panel.append(
        ctx.act('เปิดตัวออกแบบเลเยอร์', () => window.PanthoriumCreativeStudio.open('image'))
      );
    if (kind === 'page') {
      const samples = [
        ['เช็กลิสต์เปิดร้าน', ['เปิดหน้าร้าน', 'ตรวจสินค้า', 'ตรวจคิวลูกค้า']],
        ['ปฏิทินคอนเทนต์', ['วางหัวข้อประจำสัปดาห์', 'เตรียมภาพและคำบรรยาย', 'นัดวันเผยแพร่']]
      ];
      for (const [name, items] of samples)
        ctx.panel.append(
          ctx.act(name, () =>
            edit(
              v,
              {
                id: crypto.randomUUID(),
                kind,
                title: name,
                owner: true,
                body: {blocks: items.map((text) => ({type: 'check', text, done: false}))}
              },
              true
            )
          )
        );
    }
    if (kind === 'flow') {
      const picker = el('input', null, {type: 'file', accept: '.json,application/json'});
      picker.onchange = ctx.handle(async () => {
        const f = picker.files[0];
        if (!f || f.size > 20000) throw Error('เลือกไฟล์แม่แบบ JSON ไม่เกิน 20 KB');
        const draft = P.readBlueprint(JSON.parse(await f.text()));
        if (ctx.live()) await edit(v, {...draft, id: crypto.randomUUID(), kind, owner: true}, true);
      });
      ctx.panel.append(field('นำเข้าแม่แบบ JSON', picker));
    }
    const holder = el('div', null, {class: 'ot-cards'});
    ctx.panel.append(holder);
    const list = (await ctx.api('/projects')).items.filter((p) => p.kind === kind);
    if (!list.length) {
      holder.append(el('p', 'ยังไม่มีงานที่บันทึกไว้'));
      return;
    }
    for (const p of list) {
      const b = ctx.act(p.title, async () => {
        const data = await ctx.api('/projects/' + p.id);
        await edit(v, data.project);
      });
      b.append(el('small', p.owner ? 'เจ้าของ' : 'ใช้ร่วมกับทีม'));
      holder.append(b);
    }
  }
  const origins = () => new URL(backend() || location.href, location.href).origin;
  function showLink(ctx, body, label, url) {
    const link = input(url, 2048);
    link.readOnly = true;
    const copy = ctx.act('คัดลอกลิงก์', async () => {
      try {
        await navigator.clipboard.writeText(url);
        ctx.report('คัดลอกลิงก์แล้ว');
      } catch {
        link.focus();
        link.select();
        ctx.report('เลือกลิงก์แล้ว กดคัดลอก');
      }
    });
    body.append(row(field(label, link), copy));
  }
  async function sharing(v, p, ctx) {
    const box = el('details', null, {'data-tool-sharing': ''}),
      body = el('div');
    box.append(el('summary', 'ลิงก์และสิทธิ์'), body);
    ctx.panel.append(box);
    function option(mode, on, label) {
      body.append(
        ctx.act((on ? 'ปิด' : 'เปิด') + label, async () => {
          if (v.dirty) throw Error('บันทึกฉบับแก้ไขก่อนเปลี่ยนสิทธิ์');
          const d = await ctx.api(
            '/projects/' + p.id + '/share',
            json('PUT', {mode, on: !on, revision: p.revision})
          );
          await edit(v, d.project);
          const sharing = v.panel.querySelector('[data-tool-sharing]');
          if (sharing) sharing.open = true;
        })
      );
    }
    if (p.kind !== 'flow') {
      option('public', p.share, p.kind === 'form' ? 'ลิงก์รับคำตอบ' : 'ลิงก์แม่แบบสำหรับทำสำเนา');
      if (p.share) showLink(ctx, body, 'ลิงก์ที่แชร์ได้', origins() + '/online-share#' + p.share);
    }
    if (['page', 'design', 'flow'].includes(p.kind)) {
      option('team', p.invite, p.kind === 'flow' ? 'ลิงก์เข้าทีมรับงาน' : 'ลิงก์เข้าร่วมแก้ไขต้นฉบับ');
      if (p.invite)
        showLink(
          ctx,
          body,
          'ผู้มีลิงก์และบัญชี Panthorium เข้าทีมได้',
          origins() + '/#online-join=' + p.invite
        );
      const members = (await ctx.api('/projects/' + p.id + '/members')).items;
      for (const m of members)
        body.append(
          row(
            el('span', m.username),
            ctx.act('นำสมาชิกออก', async () => {
              if (v.dirty) throw Error('บันทึกงานก่อน');
              if (!confirm('นำสมาชิกออกและปิดลิงก์เชิญปัจจุบันหรือไม่?')) return;
              await ctx.api('/projects/' + p.id + '/members/' + m.member, {method: 'DELETE'});
              await edit(v, (await ctx.api('/projects/' + p.id)).project);
            })
          )
        );
    }
  }
  function activity(p, ctx) {
    const isForm = p.kind === 'form',
      box = el('details'),
      holder = el('div');
    box.append(el('summary', isForm ? 'คำตอบและไฟล์ CSV' : 'รายการจากเวิร์กโฟลว์'), holder);
    ctx.panel.append(box);
    const endpoint = '/projects/' + p.id;
    let offset = 0;
    async function load() {
      const result = await ctx.api(endpoint + '/' + (isForm ? 'answers' : 'runs') + '?offset=' + offset);
      holder.replaceChildren();
      holder.append(ctx.act('รีเฟรช', load));
      if (isForm)
        holder.append(
          ctx.act('ดาวน์โหลดคำตอบทั้งหมด CSV', async () => {
            const r = await ctx.api(endpoint + '/responses.csv', {}, true);
            await ctx.output(await r.blob(), fileName(p.title, '.csv'), false);
          })
        );
      if (!result.items.length) holder.append(el('p', 'ยังไม่มีรายการ'));
      for (const item of result.items) {
        const block = el('article');
        block.append(el('small', new Date(item.created_at).toLocaleString('th-TH')));
        if (isForm) {
          for (const f of item.fields)
            block.append(el('p', f.label + ' · ' + (item.answers[f.id] || '—')));
        } else {
          block.append(
            el('p', item.label),
            ctx.act(item.done ? 'เปิดงานอีกครั้ง' : 'ทำเครื่องหมายเสร็จ', async () => {
              await ctx.api(endpoint + '/runs/' + item.id, json('PUT', {done: !item.done}));
              await load();
            })
          );
        }
        holder.append(block);
      }
      if (offset)
        holder.append(
          ctx.act('ก่อนหน้า', async () => {
            offset -= 25;
            await load();
          })
        );
      if (result.more)
        holder.append(
          ctx.act('ถัดไป', async () => {
            offset += 25;
            await load();
          })
        );
    }
    box.ontoggle = () => {
      if (box.open) load().catch((e) => ctx.report(friendly(e)));
    };
  }
  async function edit(v, p, isNew = false) {
    if (!valid(v)) return;
    const ctx = reset(v, catalogue.find((t) => t[0] === p.kind)[1]),
      readonly = p.kind === 'flow' && !p.owner;
    const back = button('กลับไปรายการ', () => navigate(v, p.kind)),
      title = input(p.title, 120);
    title.readOnly = readonly;
    const fields = el('div');
    ctx.panel.append(back, field('ชื่องาน', title), fields);
    const dirty = () => ctx.changed();
    fields.addEventListener('input', dirty);
    title.addEventListener('input', dirty);
    let collect;
    if (p.kind === 'form') collect = P.formEditor(ctx, p.body, fields);
    if (p.kind === 'page') collect = P.pageEditor(ctx, p.body, fields);
    if (p.kind === 'design') collect = P.designEditor(ctx, p.body, fields, () => title.value);
    if (p.kind === 'flow') collect = await P.flowEditor(ctx, p.body, fields, readonly);
    if (!ctx.live()) return;
    if (!readonly)
      ctx.panel.append(
        ctx.act('บันทึกงาน', async () => {
          const payload = {
            id: p.id,
            kind: p.kind,
            title: title.value,
            body: collect(),
            revision: p.revision
          };
          const changed = await ctx.api(
            '/projects' + (isNew ? '' : '/' + p.id),
            json(isNew ? 'POST' : 'PUT', payload)
          );
          await edit(v, changed.project);
          v.status.textContent = 'บันทึกแล้ว';
        })
      );
    if (!isNew && !readonly)
      ctx.panel.append(
        ctx.act('เปิดฉบับล่าสุด', async () => {
          if (v.dirty && !confirm('แทนที่งานที่ยังไม่ได้บันทึกด้วยฉบับล่าสุดหรือไม่?')) return;
          await edit(v, (await ctx.api('/projects/' + p.id)).project);
        })
      );
    if (p.kind === 'flow')
      ctx.panel.append(
        ctx.act('ส่งออกแม่แบบ JSON', () => {
          const bp = P.blueprint(title.value, readonly ? p.body : collect());
          P.readBlueprint(bp);
          download(
            new Blob([JSON.stringify(bp, null, 2)], {type: 'application/json'}),
            fileName(title.value, '.json')
          );
        })
      );
    if (!isNew) {
      if (p.kind === 'form' || p.kind === 'flow') activity(p, ctx);
      if (p.owner) await sharing(v, p, ctx);
      if (!ctx.live()) return;
      if (p.owner)
        ctx.panel.append(
          ctx.act('ลบงานนี้', async () => {
            if (!confirm('ลบงานนี้และรายการที่เกี่ยวข้องอย่างถาวรหรือไม่?')) return;
            await ctx.api('/projects/' + p.id, json('DELETE', {revision: p.revision}));
            const next = reset(v, v.heading.textContent);
            await projectList(v, p.kind, next);
          })
        );
      else
        ctx.panel.append(
          ctx.act('ออกจากทีม', async () => {
            if (!confirm('ออกจากงานที่แชร์นี้หรือไม่?')) return;
            await ctx.api('/projects/' + p.id + '/members/' + v.owner, {method: 'DELETE'});
            const next = reset(v, v.heading.textContent);
            await projectList(v, p.kind, next);
          })
        );
    }
  }
  function navigateFilm(v) {
    const ctx = reset(v, 'สตูดิโอหนังและซีรีส์');
    for (const b of v.nav.children) b.setAttribute('aria-current',String(b.dataset.tool === 'video'));
    window.PanthoriumFilmStudio.mount(ctx);
  }
  function handleLink() {
    const film = location.hash === '#film-studio';
    const direct = film || location.hash === '#online-tools';
    const m = location.hash.match(/^#online-(copy|join)=([a-f\d-]{36})$/i);
    if (!m && !direct) {
      pending = '';
      loginLink = '';
      return;
    }
    if (!allowed()) {
      if (
        apps()?.state?.user?.roles?.includes('guest') &&
        loginLink !== location.hash &&
        window.PanthoriumAccounts?.openLogin
      ) {
        const target = location.hash;
        queueMicrotask(() => {
          if (
            target !== location.hash ||
            allowed() ||
            loginLink === target ||
            document.querySelector('[data-login-email]')
          )
            return;
          window.PanthoriumAccounts.openLogin();
          document.querySelector('.window[data-id="account-login"]')?.addEventListener(
            'panthorium:before-window-close',
            () => {
              loginLink = target;
            },
            {once: true}
          );
        });
      }
      return;
    }
    loginLink = '';
    if (direct) {
      const v = open();
      if (v && (!film || leave(v))) {
        if (film) navigateFilm(v);
        history.replaceState(null, '', location.pathname + location.search);
      }
      return;
    }
    if (pending === location.hash) return;
    const v = open();
    if (!v || !leave(v)) return;
    pending = location.hash;
    const ctx = reset(v, m[1] === 'join' ? 'เข้าร่วมทีม' : 'ทำสำเนาแม่แบบ');
    (async () => {
      const join = m[1] === 'join',
        info = await ctx.api((join ? '/join/' : '/shared/') + m[2]);
      const p = info.invite || info.project;
      ctx.panel.append(
        el('h3', p.title),
        ctx.act(
          join
            ? p.kind === 'flow'
              ? 'เข้าร่วมทีมรับงาน'
              : 'เข้าร่วมแก้ไขต้นฉบับ'
            : 'สร้างสำเนาในบัญชีของฉัน',
          async () => {
            const result = await ctx.api(
              (join ? '/join/' : '/copy/') + m[2],
              json('POST', {id: copyId})
            );
            history.replaceState(null, '', location.pathname + location.search);
            pending = '';
            await edit(v, result.project);
          }
        )
      );
      const copyId = crypto.randomUUID();
    })().catch((e) => ctx.report(friendly(e)));
  }
  let observedMenu, menuObserver;
  function installMenu() {
    const menu = document.getElementById('sm-apps');
    if (!menu) return;
    if (observedMenu !== menu && window.MutationObserver) {
      menuObserver?.disconnect();
      observedMenu = menu;
      menuObserver = new MutationObserver(installMenu);
      menuObserver.observe(menu, {childList: true});
    }
    const existing = menu.querySelector('[data-app-id="online-tools"]');
    if (!allowed()) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const launch = button('', () => {
      open();
      if (typeof closeStartMenu === 'function') closeStartMenu();
    });
    launch.className = 'sm-app';
    launch.dataset.appId = id;
    launch.dataset.searchText =
      'เครื่องมือออนไลน์ แบบฟอร์ม เอกสาร ตาราง สไลด์ ออกแบบ ลบพื้นหลัง วิดีโอ หนัง ซีรีส์ หนังสั้น สตอรีบอร์ด PDF แม่แบบ อัตโนมัติ';
    const graphic = el('span', null, {class: 'sm-pack-icon'}),
      icon = window.PanthoriumStartMenuUI?.icon('work');
    if (icon) graphic.append(icon);
    launch.append(graphic, el('span', 'เครื่องมือออนไลน์'));
    menu.append(launch);
    window.PanthoriumStartMenuUI?.keepPinnedLast(menu);
  }
  function onAuth() {
    installMenu();
    if (view && (!allowed() || view.owner !== principal())) {
      pending = '';
      close();
    }
    handleLink();
  }
  window.PanthoriumOnlineTools = {open};
  for (const name of [
    'panthorium:auth-changed',
    'panthorium:boot-complete',
    'panthorium:apps-changed',
    'hashchange'
  ])
    window.addEventListener(name, onAuth);
  window.addEventListener('beforeunload', (e) => {
    if (view?.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', onAuth, {once: true});
  else onAuth();
})();
