(function () {
  'use strict';
  const {el, field, input, area, select, row} = window.PanthoriumToolsUI;
  const clock = (seconds) => {
    const t = Math.round(seconds);
    return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60]
      .map((n, i) => (i ? String(n).padStart(2, '0') : n))
      .join(':');
  };
  const money = (n) =>
    n == null
      ? 'ยังไม่มีอัตราของโมเดลนี้'
      : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(n);
  const states = {
    running: 'กำลังเดินคิว',
    waiting_quota: 'รอโควตารอบถัดไป',
    paused: 'พักคิวแล้ว',
    complete: 'สร้างครบแล้ว',
    needs_script: 'รอบนี้เสร็จแล้ว ยังมีฉากที่รอบท'
  };
  const exportStates = {
    queued: 'รอรวมไฟล์',
    running: 'กำลังรวมไฟล์',
    ready: 'MP4 พร้อมดาวน์โหลด',
    expired: 'ไฟล์ดาวน์โหลดหมดอายุ สั่งรวมใหม่ได้',
    failed: 'รวมไฟล์ไม่สำเร็จ'
  };
  const defaults = () => ({minutes: 120, synopsis: '', screenplay: ''});
  function section(title) {
    const card = el('section', null, {class: 'film-card'});
    card.append(el('h3', title));
    return card;
  }
  function makeStructure(p) {
    const first = p.body.episodes[0];
    if (p.body.episodes.length !== 1 || first.shots.length || first.footage)
      throw Error('สร้างโครงอัตโนมัติได้เมื่อยังมีลำดับเดียวและยังไม่มีช็อตหรือฟุตเทจ');
    const seconds = p.body.feature.minutes * 60;
    const count = Math.ceil(seconds / 64);
    const sequences = Array.from({length: count}, (_, i) => {
      const start = i * 64;
      const ep =
        i === 0 ? first : {id: crypto.randomUUID(), title: 'ลำดับฉากที่ ' + (i + 1), story: '', shots: []};
      return {
        ...ep,
        act: start < seconds * 0.25 ? 1 : start < seconds * 0.75 ? 2 : 3,
        plannedSeconds: Math.min(64, seconds - start)
      };
    });
    const paragraphs = p.body.feature.screenplay
      .split(/\n\s*\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    paragraphs.forEach((paragraph, i) => {
      const index = paragraphs.length > 1 ? Math.round((i * (count - 1)) / (paragraphs.length - 1)) : 0;
      if (index === 0 && first.story) return;
      const ep = sequences[index];
      ep.story = (ep.story ? ep.story + '\n\n' + paragraph : paragraph).slice(0, 8000);
    });
    return sequences;
  }
  function workspace(v) {
    const {p, ep, act, change, redraw, edit, info, out, save, refresh, endpoint, ctx, go} = v;
    const setup = section('บทภาพยนตร์ทั้งเรื่อง');
    const minutes = select(
      [120, 150, 180].map((n) => [String(n), n + ' นาที']),
      String(p.body.feature.minutes)
    );
    setup.append(
      edit('ความยาวเป้าหมาย', minutes, p.body.feature, 'minutes', (c) => Number(c.value)),
      edit('เรื่องย่อและความต่อเนื่อง', area(p.body.feature.synopsis, 6000), p.body.feature, 'synopsis'),
      edit('บทภาพยนตร์หลัก', area(p.body.feature.screenplay, 120000), p.body.feature, 'screenplay')
    );
    if (p.body.episodes.length === 1 && !ep.shots.length && !ep.footage)
      setup.append(
        act('แบ่งโครงเป็น 3 องก์', () => {
          p.body.episodes = makeStructure(p);
          change();
          redraw();
          ctx.report('แบ่งลำดับฉากตามเวลาเป้าหมายแล้ว เลือกลำดับเพื่อเขียนบทหรือแนบฟุตเทจ');
        })
      );
    const panel = section('การผลิตและงบประมาณ');
    const show = async () => {
      await save();
      await refresh();
    };
    panel.append(act('คำนวณงบและความคืบหน้า', show));
    if (info) {
      const s = info.summary,
        q = info.quota,
        run = info.run;
      panel.append(
        el(
          'p',
          'เวลาที่วางไว้ ' +
            clock(s.seconds) +
            ' / เป้าหมาย ' +
            clock(p.body.feature.minutes * 60) +
            ' · สร้างแล้ว ' +
            clock(s.readySeconds)
        ),
        el(
          'p',
          'MP4 พร้อม ' + s.ready + ' จาก ' + s.total + ' ลำดับ · รอบทหรือฟุตเทจ ' + s.empty + ' ลำดับ'
        ),
        el(
          'p',
          'งานที่ยังต้องสร้างจากบทที่บันทึกแล้ว ' +
            s.images +
            ' ภาพ · ' +
            s.videos +
            ' คลิป (' +
            s.videoSeconds +
            ' วินาที) · ค่าสื่อขาออกประมาณ ' +
            money(s.outputUSD)
        ),
        el(
          'p',
          'โควตาสร้างสื่อวันนี้เหลือ ' +
            q.remaining +
            '/' +
            q.limit +
            ' ภาพและคลิปรวมกัน · ฟุตเทจของคุณใช้โควตาสร้างสื่อ 0 รายการ'
        )
      );
      if (s.price.imageUSD != null && s.price.videoUSD != null) {
        const goal = p.body.feature.minutes * 60;
        panel.append(
          el(
            'small',
            'หากสร้างใหม่ทั้งเรื่องด้วย AI โดยใช้ช็อตละ 8 วินาที ประมาณ ' +
              money(Math.ceil(goal / 8) * s.price.imageUSD + goal * s.price.videoUSD) +
              ' ก่อนรวมภาพอ้างอิง'
          )
        );
      }
      panel.append(
        el(
          'small',
          'คำนวณจากอัตราสื่อขาออก Google Cloud ในสกุล USD สำหรับภาพราว 1K และวิดีโอ 720p พร้อมเสียง ค่าอินพุต AI การวางบท พื้นที่เก็บไฟล์ ภาษี และการสร้างซ้ำอาจคิดเพิ่ม'
        )
      );
      panel.append(
        el('a', 'ตารางราคาของ Google Cloud', {
          href: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
          target: '_blank',
          rel: 'noreferrer'
        })
      );
      const script = info.script,
        scripting = script && ['running', 'generating'].includes(script.status);
      if (script) {
        const text = {
          running: 'กำลังวางช็อต',
          generating: 'Gemini กำลังเขียนลำดับฉาก',
          paused: 'พักการวางช็อตแล้ว',
          complete: 'วางช็อตที่อนุมัติครบแล้ว'
        };
        setup.append(
          el(
            'p',
            (text[script.status] || script.status) +
              ' · เหลือ ' +
              script.remaining +
              ' คำสั่ง' +
              (script.reason ? ' · ' + v.detail(script.reason) : '')
          )
        );
      }
      if (scripting) {
        setup.append(
          act('พักการวางช็อต', async () => {
            await ctx.api(endpoint('feature/script'), v.json('POST', {action: 'pause'}));
            await refresh();
          })
        );
      } else if (s.empty && !['running', 'waiting_quota'].includes(run?.status)) {
        setup.append(
          act('ให้ Gemini วางช็อตทั้งเรื่อง', async () => {
            await save();
            const fresh = await ctx.api(endpoint('feature/overview'));
            if (!ctx.live() || !fresh.summary.empty) return;
            const reviewed = fresh.script?.reason === 'feature_script_review';
            if (
              !confirm(
                (reviewed ? 'ตรวจประวัติ Gemini ก่อนเริ่มซ้ำในลำดับที่ยังยืนยันผลไม่ได้\n' : '') +
                  'วางสตอรีบอร์ดจากบทหลักตามลำดับ สูงสุด ' +
                  fresh.summary.empty +
                  ' คำสั่งข้อความ Gemini ค่าร่างบทคิดตามโทเค็น สร้างเฉพาะลำดับที่ยังว่าง เมื่อบทพร้อมคุณจะเห็นงบภาพและคลิปก่อนสั่งผลิต'
              )
            )
              return;
            await ctx.api(
              endpoint('feature/script'),
              v.json('POST', {
                action: 'start',
                confirmed: true,
                reviewed,
                maxCalls: fresh.summary.empty,
                revision: fresh.revision
              })
            );
            await refresh();
          })
        );
      }
      if (run)
        panel.append(
          el('p', (states[run.status] || run.status) + (run.reason ? ' · ' + v.detail(run.reason) : ''))
        );
      if (run && ['running', 'waiting_quota'].includes(run.status)) {
        panel.append(
          act('พักคิวหลังชุดปัจจุบัน', async () => {
            await ctx.api(endpoint('feature/control'), v.json('POST', {action: 'pause'}));
            await refresh();
          })
        );
      } else if (s.next && !scripting) {
        panel.append(
          act('เริ่มหรือทำต่อจากฉากค้าง', async () => {
            await save();
            const fresh = await ctx.api(endpoint('feature/overview'));
            if (!ctx.live()) return;
            const n = fresh.summary;
            const review = Boolean(
              fresh.uncertainJob || fresh.run?.reason === 'studio_submission_uncertain'
            );
            if (!n.next) return refresh();
            if (
              !confirm(
                (review
                  ? 'ตรวจประวัติผู้ให้บริการก่อนยืนยันสั่งใหม่ ผลของคำสั่งก่อนหน้ายังไม่แน่ชัด\n'
                  : '') +
                  'อนุมัติคิวสำหรับบทที่บันทึกแล้ว ' +
                  n.images +
                  ' ภาพ ' +
                  n.videos +
                  ' คลิป ค่าสื่อขาออกประมาณ ' +
                  money(n.outputUSD) +
                  ' ระบบทำงานทีละชุด วันที่โควตาเต็มจะทำต่อในวันถัดไป พักคิวได้ทุกเมื่อ'
              )
            )
              return;
            await ctx.api(
              endpoint('feature/control'),
              v.json('POST', {
                action: 'start',
                revision: p.revision,
                token: fresh.token,
                confirmed: true,
                reviewed: review
              })
            );
            await refresh();
          })
        );
      }
      if (s.next) panel.append(act('เปิดลำดับที่ค้าง', () => go(s.next.episode)));
    }
    const master = section('ไฟล์ภาพยนตร์');
    if (out && exportStates[out.status])
      master.append(el('p', exportStates[out.status] + (out.reason ? ' · ' + v.detail(out.reason) : '')));
    if (out?.status === 'ready') {
      master.append(
        act('ดาวน์โหลดหนังทั้งเรื่อง', async () => {
          await save();
          const ticket = await ctx.api(endpoint('feature/download'), v.json('POST', {}));
          const a = document.createElement('a');
          a.href = new URL(ticket.href, ctx.origin()).href;
          a.download = '';
          document.body.append(a);
          a.click();
          a.remove();
        })
      );
    } else if (!['queued', 'running'].includes(out?.status)) {
      const start = act('รวมทั้งเรื่องเป็น MP4', async () => {
        await save();
        await ctx.api(endpoint('feature/export'), v.json('POST', {revision: p.revision}));
        await refresh();
      });
      start.disabled = !info || info.summary.ready !== info.summary.total;
      master.append(start);
    }
    ctx.panel.append(setup, panel, master);
  }
  function footage(v) {
    const {ep, ctx, change, redraw, act} = v;
    const card = section('ใช้ฟุตเทจที่ถ่ายไว้');
    const upload = el('input', null, {type: 'file', accept: 'video/*'});
    upload.onchange = ctx.handle(async () => {
      const f = upload.files[0];
      if (!f) return;
      if (!f.type.startsWith('video/') || f.size > 20 * 1024 * 1024)
        throw Error('เลือกวิดีโอขนาดไม่เกิน 20 MB ต่อไฟล์');
      const video = document.createElement('video'),
        url = URL.createObjectURL(f);
      let duration;
      try {
        duration = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => finish(Error('อ่านความยาวคลิปไม่ได้')), 15000);
          function finish(error) {
            clearTimeout(timeout);
            video.onloadedmetadata = video.onerror = null;
            error ? reject(error) : resolve(video.duration);
          }
          video.onloadedmetadata = () => finish();
          video.onerror = () => finish(Error('อ่านความยาวคลิปไม่ได้'));
          video.preload = 'metadata';
          video.src = url;
        });
      } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
      if (!Number.isFinite(duration) || duration < 0.05) throw Error('อ่านความยาวคลิปไม่ได้');
      const data = await ctx.request('/api/files', {
        method: 'POST',
        body: f,
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-content-type': f.type,
          'x-file-name': encodeURIComponent(f.name)
        }
      });
      if (!ctx.live()) return;
      ep.footage = {fileId: data.file.id, start: 0, end: Math.min(120, Math.floor(duration * 1000) / 1000)};
      change();
      redraw();
      ctx.report('แนบฟุตเทจแล้ว กำหนดช่วงและบันทึกโปรเจกต์ได้');
    });
    card.append(
      field(ep.footage ? 'เปลี่ยนไฟล์ฟุตเทจ' : 'แนบวิดีโอจากอุปกรณ์', upload),
      el('small', 'ใช้วิดีโอได้สูงสุด 120 วินาทีต่อลำดับ ไฟล์ละไม่เกิน 20 MB')
    );
    if (ep.footage) {
      for (const [key, label] of [
        ['start', 'เริ่มที่วินาที'],
        ['end', 'สิ้นสุดที่วินาที']
      ]) {
        const n = input(ep.footage[key], 10, 'number');
        n.step = '.001';
        n.min = '0';
        card.append(v.edit(label, n, ep.footage, key, (c) => c.valueAsNumber));
      }
      card.append(
        act('ถอดฟุตเทจและใช้สตอรีบอร์ด', () => {
          ep.footage = null;
          change();
          redraw();
        })
      );
    }
    ctx.panel.append(card);
  }
  window.PanthoriumFeatureFilm = {defaults, workspace, footage, clock};
})();
