(function () {
  'use strict';
  const U = window.PanthoriumToolsUI,
    P = window.PanthoriumToolProjects,
    F = window.PanthoriumToolFiles;
  const {el, button, field, input, row, download, fileName, defaults, friendly} = U;
  const rootApi = '/api/online-tools';
  const tools = [
    {id: 'form', title: 'แบบฟอร์ม', icon: 'chart', search: 'สร้างฟอร์ม รับคำตอบ CSV'},
    {id: 'pdf', title: 'จัดการ PDF', icon: 'document', search: 'แยกหน้า รวมไฟล์ เรียงหน้า พีดีเอฟ'},
    {
      id: 'page',
      title: 'หน้าจดงานและแม่แบบ',
      icon: 'work',
      search: 'เช็กลิสต์ แผนคอนเทนต์ เทมเพลต แชร์สำเนา'
    },
    {id: 'flow', title: 'งานอัตโนมัติ', icon: 'settings', search: 'เวิร์กโฟลว์ รับฟอร์ม ติดตาม แจ้งทีม'},
    {id: 'design', parent: 'image', title: 'ออกแบบสื่อร้านค้า', search: 'โปสเตอร์ เมนู แค็ตตาล็อก'},
    {id: 'cutout', parent: 'image', title: 'ลบพื้นหลัง', search: 'รูปสินค้า โปร่งใส PNG'},
    {
      id: 'film',
      parent: 'video',
      title: 'สร้างหนังและซีรีส์',
      search: 'ซีรี่ ซีรีส์ ภาพยนตร์ หนังสั้น สตอรีบอร์ด'
    }
  ];
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const views = new Map();
  const apps = () => (typeof OS === 'undefined' ? null : OS);
  const principal = () => String(apps()?.state?.user?.sub || apps()?.state?.user?.id || '');
  const allowed = () =>
    principal() &&
    !/^guest[:_-]/i.test(principal()) &&
    !apps()?.state?.user?.roles?.includes('guest') &&
    apps()?.state?.user?.permissions?.includes('chat');
  const backend = () => String(apps()?.config?.backendUrl || '').replace(/\/$/, '');
  let pending = null,
    loginLink = '';
  function dispose(v) {
    v.page?.abort();
    v.controller.abort();
    if (views.get(v.kind) === v) views.delete(v.kind);
    if (v.ticket && pending === v.ticket) {
      pending.controller.abort();
      pending = null;
    }
  }
  function mount(kind, root, trackJob) {
    if (!allowed() || !byId.has(kind)) return null;
    const previous = views.get(kind);
    if (previous) dispose(previous);
    root.dataset.onlineTools = kind;
    root.classList.add('ot', 'ot-embedded');
    const v = {
      kind,
      trackJob,
      owner: principal(),
      root,
      controller: new AbortController(),
      epoch: 0,
      dirty: false,
      busy: false
    };
    views.set(kind, v);
    v.heading = el('h2');
    v.status = el('div', '', {role: 'status', class: 'ot-status'});
    v.panel = el('section', null, {class: 'ot-panel'});
    root.append(v.heading, v.status, v.panel);
    navigate(v, kind);
    return {
      isDirty: () => v.dirty,
      isBusy: () => v.busy,
      pause: () => {
        for (const media of root.querySelectorAll('audio,video')) media.pause();
      },
      destroy: () => dispose(v)
    };
  }
  function open(kind) {
    const tool = byId.get(kind);
    return window.PanthoriumCreativeStudio?.open(tool?.parent || tool?.id || 'image', {mode: tool?.id});
  }
  function valid(v) {
    return (
      v.owner === principal() &&
      allowed() &&
      !v.controller.signal.aborted &&
      (v.hash ? pending === v && location.hash === v.hash : views.get(v.kind) === v && v.root.isConnected)
    );
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
      trackJob: v.trackJob,
      request: (path, opts, raw) =>
        live() ? request(v, path, opts, raw) : Promise.reject(Error('auth_required')),
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
    const ctx = reset(v, byId.get(kind).title);
    if (kind === 'film') return window.PanthoriumFilmStudio.mount(ctx);
    if (kind === 'cutout') return F.cutout(ctx);
    if (kind === 'pdf') return F.pdfDesk(ctx);
    projectList(v, kind, ctx).catch((e) => ctx.report(friendly(e)));
  }
  async function projectList(v, kind, ctx) {
    const createBtn = ctx.act('สร้างใหม่', () =>
      edit(v, {id: crypto.randomUUID(), kind, title: '', body: defaults(kind), owner: true}, true)
    );
    ctx.panel.append(createBtn);
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
          for (const f of item.fields) block.append(el('p', f.label + ' · ' + (item.answers[f.id] || '—')));
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
    const ctx = reset(v, byId.get(p.kind).title),
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
  function handleLink() {
    const hash = location.hash;
    const film = hash === '#film-studio';
    const direct = film || hash === '#online-tools' || hash === '#creative-studio';
    const m = hash.match(/^#online-(copy|join)=([a-f\d-]{36})$/i);
    if (pending && (!valid(pending) || !m)) {
      pending.controller.abort();
      pending = null;
    }
    if (!m && !direct) {
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
      if (open(film ? 'film' : undefined))
        history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    if (pending) return;
    const ticket = (pending = {owner: principal(), controller: new AbortController(), hash});
    (async () => {
      const join = m[1] === 'join';
      const info = await request(ticket, rootApi + (join ? '/join/' : '/shared/') + m[2]);
      if (!valid(ticket)) return;
      const p = info.invite || info.project;
      if (!byId.has(p.kind) || !open(p.kind)) {
        pending = null;
        return;
      }
      const v = views.get(p.kind);
      if (!v || !leave(v)) {
        pending = null;
        return;
      }
      v.ticket = ticket;
      const ctx = reset(v, join ? 'เข้าร่วมทีม' : 'ทำสำเนาแม่แบบ');
      ctx.panel.append(
        el('h3', p.title),
        ctx.act(
          join
            ? p.kind === 'flow'
              ? 'เข้าร่วมทีมรับงาน'
              : 'เข้าร่วมแก้ไขต้นฉบับ'
            : 'สร้างสำเนาในบัญชีของฉัน',
          async () => {
            const result = await ctx.api((join ? '/join/' : '/copy/') + m[2], json('POST', {id: copyId}));
            history.replaceState(null, '', location.pathname + location.search);
            pending = null;
            await edit(v, result.project);
          }
        )
      );
      const copyId = crypto.randomUUID();
    })().catch((error) => {
      if (!valid(ticket)) return;
      if (open('page')) {
        const target = views.get('page');
        if (target) target.status.textContent = friendly(error);
      }
      pending = null;
    });
  }
  function onAuth() {
    for (const v of views.values()) if (v.owner !== principal() || !allowed()) dispose(v);
    queueMicrotask(handleLink);
  }
  window.PanthoriumOnlineTools = {tools, open, mount};
  for (const name of [
    'panthorium:auth-changed',
    'panthorium:boot-complete',
    'panthorium:apps-changed',
    'hashchange'
  ])
    window.addEventListener(name, onAuth);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onAuth, {once: true});
  else onAuth();
})();
