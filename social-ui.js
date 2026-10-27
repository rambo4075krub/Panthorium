(function () {
  "use strict";
  const specs = [
    ["feed", "Feed", "ภาพและข้อความ", "▧"],
    ["short", "Short", "วิดีโอสั้นและ Reels", "▶"],
    ["watch", "Watch", "วิดีโอยาวและภาพยนตร์", "▷"],
    ["live", "Live", "ถ่ายทอดสด", "◉"],
    ["tv", "TV", "ทีวีสดและผู้ให้บริการ", "▣"],
    ["market", "Market", "ร้านค้า", "▣"],
    ["community", "Community", "แชตกลุ่ม", "◌"],
    ["talk", "Chat", "แชตส่วนตัว", "☏"],
    ["connect", "Connect", "หาคู่ 18+", "♡"],
    ["profile", "Profile", "โปรไฟล์ส่วนตัว", "◯"],
    ["friends", "Friends", "ค้นหาเพื่อน", "+"],
    ["notifications", "การแจ้งเตือนรวม", "ไลค์ ความคิดเห็น แชร์ และกิจกรรมอื่น", "🔔"],
  ];
  const WINDOW_ID = "social-media";
  let workspace;
  const views = new Map();
  const os = () => (typeof OS !== "undefined" ? OS : window.OS);
  const uid = () =>
    String(os()?.state?.user?.sub || os()?.state?.user?.id || "");
  const allowed = () =>
    !!uid() &&
    !os()?.state?.user?.roles?.includes("guest") &&
    os()?.state?.user?.permissions?.includes("chat");
  const current = (v) =>
    allowed() &&
    uid() === v.uid &&
    v.root.isConnected &&
    !v.controller.signal.aborted;
  const el = (tag, text, attrs = {}) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const messages = {
    social_profile_required: "กรุณาบันทึกโปรไฟล์ก่อน",
    social_adult_consent_required:
      "Connect ต้องยืนยันอายุ 18 ปีขึ้นไปและสมัครใจเปิดใช้",
    social_support_unavailable: "แชทแอดมินยังไม่พร้อมใช้งาน กรุณาติดต่อ account@panthorium.net",
    social_support_blocked: "ไม่สามารถเปิดแชทนี้ได้ กรุณาตรวจบัญชีที่บล็อกหรือติดต่อ account@panthorium.net",
    social_thread_not_accepted: "รออีกฝ่ายรับคำขอสนทนาก่อน",
    social_join_required: "กรุณาเข้าร่วมกลุ่มก่อนส่งข้อความหรือไฟล์",
    social_group_capacity: "กลุ่มนี้มีสมาชิกครบ 200 คนแล้ว",
    social_group_owner_required: "ผู้สร้างกลุ่มต้องอยู่ในกลุ่มเพื่อดูแลสมาชิก",
    social_group_request_not_pending: "คำขอนี้ได้รับการจัดการแล้ว กรุณารีเฟรชกลุ่ม",
    social_invalid_group_privacy: "กรุณาเลือกกลุ่มแบบเปิดหรือแบบปิด",
    social_match_required: "ต้องสนใจตรงกันก่อนเริ่มคุย",
    social_not_found: "ไม่พบรายการหรือไม่มีสิทธิ์เข้าถึง",
    files_quota_exceeded: "พื้นที่คลาวด์เต็ม กรุณาจัดการไฟล์หรือแพ็กเกจ",
    file_too_large: "ไฟล์เกินขนาดที่ระบบรองรับ 20 MB",
    social_video_required: "Short ต้องแนบวิดีโอ MP4 หรือ WebM จำนวน 1 ไฟล์",
    social_short_duration: "Short ต้องเป็นวิดีโอที่อ่านได้และยาวไม่เกิน 1 นาที กรุณาใช้ Watch สำหรับวิดีโอยาว",
    social_feed_images_only: "Feed รองรับภาพและข้อความ กรุณาโพสต์วิดีโอใน Short หรือ Watch",
    social_long_video_required: "Watch ต้องแนบวิดีโอ หรือเพิ่มลิงก์วิดีโอ",
    social_invalid_media_url: "กรุณาใช้ลิงก์ HTTPS สาธารณะให้ตรงกับชนิดสื่อ เช่น YouTube, .mp4 หรือ .m3u8",
    social_invalid_tv_channel: "กรุณากรอกชื่อช่อง ผู้ให้บริการ และช่องทางติดต่อให้ครบ",
    social_tv_rights_required: "กรุณายืนยันสิทธิ์ในการเผยแพร่ช่องและสัญญาณ",
    social_image_required: "โปรไฟล์รองรับรูป PNG, JPEG, WebP หรือ GIF",
    social_forbidden: "คุณไม่มีสิทธิ์ดำเนินการกับรายการนี้",
    social_friend_request_not_pending: "คำขอนี้ได้รับการจัดการแล้ว กรุณารีเฟรช",
    social_invitation_not_pending: "คำขอนี้ได้รับการจัดการแล้ว กรุณารีเฟรช",
    social_live_capacity: "ห้องนี้ครบจำนวนผู้ชม 8 คนแล้ว",
    social_invalid_order: "จำนวนสินค้าไม่พอหรือรายการไม่พร้อมขาย",
    social_connect_disabled: "ฝ่ายใดฝ่ายหนึ่งปิด Connect แล้ว",
    social_name_required: "กรุณาระบุชื่อที่แสดง",
    social_invalid_product: "ตรวจราคาและจำนวนสินค้า",
  };
  const friendly = (e) =>
    messages[e.message] || e.message || "ดำเนินการไม่สำเร็จ";
  function status(v, text) {
    if (current(v)) {
      const target = v.status || views.get(workspace?.active)?.status;
      if (target) target.textContent = text;
    }
  }
  async function api(v, path, options = {}, raw = false) {
    if (!current(v)) throw Error("account_changed");
    const send = () =>
      fetch(String(os()?.config?.backendUrl || "").replace(/\/$/, "") + path, {
        ...options,
        credentials: "include",
        cache: "no-store",
        signal: v.controller.signal,
        headers: {
          ...(os()?.config?.accessToken
            ? { Authorization: "Bearer " + os().config.accessToken }
            : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      });
    let res = await send();
    if (
      res.status === 401 &&
      current(v) &&
      window.PanthoriumAuth?.refreshSession
    ) {
      await window.PanthoriumAuth.refreshSession();
      if (!current(v)) throw Error("account_changed");
      res = await send();
    }
    if (!current(v)) throw Error("account_changed");
    if (raw) {
      if (!res.ok)
        throw Error((await res.json()).error || "social_media_unavailable");
      return res.blob();
    }
    const data = await res.json();
    if (!res.ok || data.ok === false)
      throw Error(data.error || "social_request_failed");
    return data;
  }
  const write = async (v, action, input, requestId = crypto.randomUUID()) => {
    const result = await api(v, "/api/social/actions", {
      method: "POST",
      headers: { "Idempotency-Key": requestId },
      body: JSON.stringify({ action, input }),
    });
    if (!["signal", "live-heartbeat", "call-heartbeat"].includes(action)) refreshNotifications();
    return result;
  };
  function button(v, text, fn) {
    const b = el("button", text, { type: "button" });
    b.addEventListener("click", async () => {
      if (!current(v) || b.disabled) return;
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        status(v, friendly(e));
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }
  function input(form, label, type = "text", value = "") {
    const wrap = el("label", label),
      n = el(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") n.type = type;
    n.value = value;
    if (type === "checkbox") {
      wrap.className = "social-checkbox";
      wrap.replaceChildren(n, el("span", label));
    } else wrap.append(n);
    form.append(wrap);
    return n;
  }
  function select(form, label, options, value) {
    const wrap = el("label", label),
      s = el("select", null, { "aria-label": label });
    for (const [id, name] of options)
      s.append(el("option", name, { value: id }));
    if (value) s.value = value;
    wrap.append(s);
    form.append(wrap);
    return s;
  }
  function section(v, title) {
    const n = el("section", null, { class: "social-card" });
    n.append(el("h3", title));
    v.content.append(n);
    return n;
  }
  function clear(v) {
    v.pendingCamera?.getTracks().forEach(track => track.stop()); v.pendingCamera = null;
    v.viewer?.close(); v.autoplayObserver?.disconnect(); v.autoplayItems = new Map(); v.videoEntries = []; v.videoNextCursor = null; v.recordOrder = new Map(); v.mediaLoads = new Set();
    v.content.querySelectorAll("video,audio").forEach(node => { if (!node.srcObject) node.pause(); });
    v.renderVersion = (v.renderVersion || 0) + 1;
    v.noticeThrough = new Date().toISOString();
    v.readObserver?.disconnect();
    clearTimeout(v.readTimer);
    v.readSeen = new Set();
    v.messageRender = (v.messageRender || 0) + 1;
    v.lastMessages = null;
    v.messageLog = null;
    v.groupState = null;
    v.groupItems = null;
    v.groupCursor = null;
    v.detail = null;
    v.refreshFriends = null;
    v.refreshThreads = null;
    if (v.blockedBack) v.blockedBack.hidden = true;
    for (const b of v.communityButtons || []) b.setAttribute("aria-expanded", "false");
    v.liveComments = new Map();
    for (const url of v.urls) URL.revokeObjectURL(url);
    v.urls.clear();
    v.content.replaceChildren();
  }
  function change(v, fn) {
    v.detail = null;
    clear(v);
    return fn();
  }
  function bindForm(v, form, action, data, after) {
    const sending = ["message", "group-message", "live-chat", "comment"].includes(action);
    const submit = el("button", sending ? "ส่ง" : action === "group-create" ? "สร้างกลุ่ม" : "บันทึก", { type: "submit" });
    form.append(submit);
    let requestId = crypto.randomUUID();
    form.addEventListener("input", () => {
      requestId = crypto.randomUUID();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const out = await write(v, action, await data(), requestId);
        status(v, sending ? "ส่งแล้ว" : "บันทึกแล้ว");
        requestId = crypto.randomUUID();
        if (after) await after(out);
      } catch (e) {
        v.pendingCamera?.getTracks().forEach(track => track.stop()); v.pendingCamera = null;
        status(v, friendly(e));
      } finally {
        submit.disabled = false;
      }
    });
    return submit;
  }
  async function attachments(v, form, initial = []) {
    const selected = new Map(initial.map(id => [id, { id, name: "ไฟล์ที่เลือก" }]));
    const wrap = el("div", null, { class: "social-attachments" }), menu = el("details"), summary = el("summary", "+", { "aria-label": "แนบไฟล์", role: "button" });
    const choices = el("div", null, { class: "social-attachment-menu" }), chosen = el("div", null, { "data-selected-files": "" });
    const upload = el("input", null, { type: "file", hidden: "", "aria-label": "อัปโหลด" });
    if (v.module === "short") upload.accept = "video/mp4,video/webm";
    else if (v.module === "feed") upload.accept = "image/png,image/jpeg,image/webp,image/gif";
    menu.append(summary, choices); wrap.append(menu, chosen, upload); form.append(wrap);
    const changed = () => {
      chosen.replaceChildren();
      for (const f of selected.values()) chosen.append(button(v, f.name + " ×", () => { selected.delete(f.id); changed(); }));
      form.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const add = file => { if (!selected.has(file.id) && selected.size >= 6) throw Error("แนบได้สูงสุด 6 ไฟล์"); selected.set(file.id, file); changed(); };
    choices.append(button(v, "แนบไฟล์จากคลาวด์", async () => {
      menu.open = false;
      const dialog = el("dialog", null, { class: "social-file-picker", "aria-label": "เลือกไฟล์จากคลาวด์" });
      const list = el("div", "กำลังโหลด…"), query = el("input", null, { type: "search", placeholder: "ค้นหาไฟล์", "aria-label": "ค้นหาไฟล์" });
      const close = () => { dialog.close?.(); dialog.remove(); summary.focus(); };
      dialog.append(el("h3", "เลือกไฟล์จากคลาวด์"), query, list, button(v, "เสร็จสิ้น", close)); v.root.append(dialog);
      dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
      try {
        const data = await api(v, "/api/files");
        if (!dialog.isConnected || !current(v)) return;
        const render = () => {
          list.replaceChildren();
          for (const f of data.files || []) {
            if (!f.name.toLowerCase().includes(query.value.toLowerCase())) continue;
            const label = el("label", null, { class: "social-checkbox" }), check = el("input", null, { type: "checkbox" }); check.checked = selected.has(f.id);
            check.onchange = () => { try { check.checked ? add(f) : (selected.delete(f.id), changed()); } catch(e) { check.checked = false; status(v, friendly(e)); } };
            label.append(check, el("span", f.name)); list.append(label);
          }
          if (!list.children.length) list.append(el("p", "ไม่พบไฟล์"));
        };
        query.oninput = render; render();
      } catch(e) { list.textContent = friendly(e); }
    }), button(v, "อัปโหลด", () => { menu.open = false; upload.click(); }));
    upload.addEventListener("change", async () => {
      menu.open = false;
      const file = upload.files?.[0]; if (!file) return;
      try {
        if (selected.size >= 6) throw Error("แนบได้สูงสุด 6 ไฟล์");
        if (file.size > 20 * 1024 * 1024) throw Error("file_too_large");
        if (!window.confirm("ต้องการอัพโหลดไฟล์หรือไม่")) return;
        upload.disabled = true;
        const result = await api(v, "/api/files", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "X-File-Content-Type": file.type || "application/octet-stream" }, body: file });
        if (current(v) && form.isConnected) add(result.file);
      } catch(e) { status(v, friendly(e)); }
      finally { upload.disabled = false; upload.value = ""; }
    });
    changed();
    const getFiles = () => [...selected.keys()];
    getFiles.reset = () => { selected.clear(); changed(); upload.value = ""; };
    return getFiles;
  }
  const watchPost = (v, record) => ["feed", "watch", "community"].includes(record.kind) && (record.module === "feed" || v.module === "feed");
  const feedPost = (v, record) => ["feed", "video", "watch", "short", "listing", "live"].includes(record.kind) || (record.kind === "community" && ["feed", "short"].includes(record.module || v.module));
  function playQuietly(node) { try { const pending = node.play(); pending?.catch(() => {}); } catch (_) {} }
  function mediaCommand(entry, action, value) {
    if (entry.node.tagName === "VIDEO") {
      if (action === "play") { entry.node.muted = value !== false; playQuietly(entry.node); }
      if (action === "pause") entry.node.pause();
      if (action === "seek" && Number.isFinite(value)) entry.node.currentTime = value;
    } else {
      if (["play", "pause"].includes(action)) { entry.node.dataset.playing = String(action === "play"); entry.node.dataset.muted = String(value !== false); }
      if (action === "play") entry.mount?.();
      entry.node.querySelector("iframe")?.contentWindow?.postMessage({ channel: "panthorium-player", action, value }, location.origin);
    }
  }
  function watchInline(v, entry) {
    v.videoEntries ||= []; v.videoEntries.push(entry);
    v.videoEntries.sort((a,b) => (v.recordOrder?.get(a.record?.id) || 0) - (v.recordOrder?.get(b.record?.id) || 0));
    if (!window.IntersectionObserver) return;
    v.autoplayItems ||= new Map(); v.autoplayItems.set(entry.node, { entry, ratio: 0 });
    const update = () => {
      if (!current(v) || v.viewer) return;
      const eligible = !v.root.hidden && document.visibilityState === "visible";
      const best = eligible ? [...v.autoplayItems.values()].filter(x => x.ratio >= .25 && x.entry.node.isConnected).sort((a,b) => b.ratio - a.ratio)[0]?.entry : null;
      for (const { entry: item, ratio } of v.autoplayItems.values()) mediaCommand(item, (v.module === "tv" ? eligible && ratio >= .25 : item === best) ? "play" : "pause", true);
    };
    if (!v.autoplayObserver) {
      v.autoplayObserver = new IntersectionObserver(changes => {
        for (const change of changes) { const item = v.autoplayItems.get(change.target); if (item) item.ratio = change.intersectionRatio; }
        update();
      }, { root: v.root, threshold: [0,.25,.5,.75,1] });
      v.updatePlayback = update;
    }
    v.autoplayObserver.observe(entry.node);
  }
  function attachVideo(v, r, node, mount) {
    const entry = { record: r, node, mount };
    const launch = () => openVideo(v, entry);
    if (node.tagName === "VIDEO") {
      node.controls = false; node.muted = true; node.loop = r.module === "short"; node.setAttribute("aria-label", "ดูวิดีโอเต็มจอ"); node.tabIndex = 0;
      node.addEventListener("click", launch);
      node.addEventListener("keydown", e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); launch(); } });
    } else {
      const cover = button(v, "", launch); cover.className = "social-video-open"; cover.setAttribute("aria-label", "ดูวิดีโอเต็มจอ"); node.append(cover);
    }
    watchInline(v, entry);
  }
  async function sharePost(v, r) {
    const url = location.origin + location.pathname + "#social=" + (r.module || v.module) + "&record=" + encodeURIComponent(r.id);
    try {
      if (navigator.share) await navigator.share({ title: r.title || "Panthorium", url });
      else { await navigator.clipboard.writeText(url); status(v, "คัดลอกลิงก์แล้ว ผู้เปิดต้องมีสิทธิ์เข้าถึง"); }
      await write(v, "share", { recordId: r.id });
    } catch (e) { if (e.name !== "AbortError") throw e; }
  }
  async function likePost(v, r, enabled) {
    if (r.likeBusy || (enabled === true && r.liked)) return;
    r.likeBusy = true;
    try {
      const out = await write(v, "like", { recordId: r.id, ...(enabled === true ? { enabled: true } : {}) });
      r.likeCount = out.likeCount ?? Math.max(0, (r.likeCount || 0) + (out.liked === r.liked ? 0 : out.liked ? 1 : -1)); r.liked = out.liked;
      for (const like of v.root.querySelectorAll("[data-like-record]")) if (like.dataset.likeRecord === r.id) {
        like.textContent = (r.liked ? "♥" : "♡") + " " + r.likeCount;
        like.setAttribute("aria-label", "ถูกใจ " + r.likeCount); like.setAttribute("aria-pressed", String(r.liked));
      }
    } finally { r.likeBusy = false; }
  }
  function openVideo(v, initial) {
    if (!current(v) || v.viewer) return;
    const dialog = el("dialog", null, { class: "social-viewer", "aria-label": "เครื่องเล่นวิดีโอเต็มจอ" });
    const stage = el("div", null, { class: "social-viewer-stage" }), surface = el("div", null, { class: "social-video-surface", "aria-label": "แตะเพื่อแสดงหรือซ่อนปุ่ม แตะสองครั้งเพื่อถูกใจ" });
    const hud = el("div", null, { class: "social-video-hud" }), side = el("div", null, { class: "social-video-side" }), bottom = el("div", null, { class: "social-video-bottom" });
    const drawer = el("section", null, { class: "social-video-drawer", hidden: "" });
    let entry, placeholder, hideTimer, tapTimer, lastTap = 0, gesture, lastWheel = 0, navigating = false, closed = false;
    const focusBefore = document.activeElement;
    const restore = () => {
      if (!entry) return;
      mediaCommand(entry, "pause");
      if (placeholder?.isConnected) placeholder.replaceWith(entry.node);
      if (entry.node.tagName === "VIDEO") { entry.node.muted = true; entry.node.ontimeupdate = null; }
    };
    const close = () => {
      if (closed) return; closed = true;
      clearTimeout(hideTimer); clearTimeout(tapTimer); restore();
      if (document.fullscreenElement === dialog) document.exitFullscreen?.().catch(() => {});
      dialog.close?.(); dialog.remove(); v.viewer = null;
      focusBefore?.focus?.({ preventScroll: true }); v.updatePlayback?.();
    };
    v.viewer = { close, pause: () => entry && mediaCommand(entry, "pause") }; v.root.append(dialog);
    const visible = show => { hud.hidden = !show; clearTimeout(hideTimer); if (show && drawer.hidden) hideTimer = setTimeout(() => { if (!hud.contains(document.activeElement)) hud.hidden = true; }, 3500); };
    const control = (text, label, fn) => { const b = button(v, text, fn); b.setAttribute("aria-label", label); return b; };
    hud.append(control("←", "กลับ", close)); hud.firstChild.className = "social-video-back";
    const panel = render => { drawer.replaceChildren(control("×", "ปิดรายละเอียด", () => { drawer.hidden = true; visible(true); })); drawer.hidden = false; visible(true); render(drawer); };
    const progress = el("input", null, { type: "range", min: "0", max: "1000", value: "0", step: "1", "aria-label": "ตำแหน่งวิดีโอ" });
    const clock = el("span", "0:00 / 0:00"), playback = control("Ⅱ", "เล่นหรือหยุดชั่วคราว", () => {
      if (entry.node.tagName === "VIDEO") mediaCommand(entry, entry.node.paused ? "play" : "pause", false);
      else mediaCommand(entry, "toggle", false);
      visible(true);
    });
    let duration = 0;
    const time = n => Number.isFinite(n) ? Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2,"0") : "0:00";
    const tick = (currentTime, total, paused) => { duration = total; clock.textContent = time(currentTime) + " / " + time(total); progress.value = total > 0 ? String(currentTime / total * 1000) : "0"; progress.disabled = !Number.isFinite(total) || total <= 0; playback.textContent = paused ? "▷" : "Ⅱ"; };
    progress.oninput = () => { mediaCommand(entry, "seek", Number(progress.value) / 1000 * duration); visible(true); };
    const more = control("⌃", "ตัวเลือกวิดีโอ", () => panel(parent => {
      for (const file of entry.record.files || []) parent.append(button(v, "ดาวน์โหลด " + file.name, async () => {
        const blob = await api(v, "/api/social/records/" + encodeURIComponent(entry.record.id) + "/files/" + encodeURIComponent(file.id) + "?download=1", {}, true);
        if (!current(v)) return; const url = URL.createObjectURL(blob); v.urls.add(url);
        const a = el("a", "ดาวน์โหลด", { href: url, download: file.name }); parent.append(a); a.click(); a.remove();
      }));
      if (entry.record.source) parent.append(externalLink("เปิดเว็บไซต์ต้นทาง", entry.record.source.url));
      parent.append(button(v, "เพิ่มลงเพลย์ลิสต์", () => { const id = entry.record.id; close(); return collections(v, "playlist", id); }));
      if (entry.record.ownerId !== v.uid) {
        const reason = input(parent, "เหตุผลที่รายงาน", "textarea");
        parent.append(button(v, "รายงาน", async () => { if (!reason.value.trim()) { reason.focus(); return; } await write(v, "report", { recordId: entry.record.id, reason: reason.value.trim() }); reason.value = ""; parent.append(el("p", "ส่งรายงานแล้ว")); }));
      }
    }));
    const transport = el("div", null, { class: "social-video-transport" }); transport.append(playback, clock, progress, more);
    const show = next => {
      if (closed || !next?.node.isConnected) return;
      restore(); entry = next; drawer.hidden = true;
      placeholder = el("div", null, { class: "social-video-placeholder" }); placeholder.style.height = Math.max(200, entry.node.getBoundingClientRect().height) + "px";
      entry.node.replaceWith(placeholder); stage.replaceChildren(entry.node); side.replaceChildren(); bottom.replaceChildren();
      const r = entry.record;
      const avatar = control((r.author?.name || "สมาชิก").slice(0,1), "ผู้โพสต์ " + (r.author?.name || "สมาชิก"), () => panel(parent => {
        parent.append(el("h3", r.author?.name || "สมาชิก"));
        if (r.ownerId !== v.uid) parent.append(button(v, "ติดตาม", async () => { await write(v, "follow", { userId: r.ownerId }); parent.append(el("p", "ติดตามแล้ว")); }));
      })); avatar.className = "social-video-avatar";
      if (r.author?.avatarUrl) api(v, r.author.avatarUrl, {}, true).then(blob => {
        if (!current(v) || !avatar.isConnected) return; const url = URL.createObjectURL(blob); v.urls.add(url); avatar.replaceChildren(el("img", null, { src: url, alt: r.author.name }));
      }).catch(() => {});
      const like = control((r.liked ? "♥" : "♡") + " " + (r.likeCount || 0), "ถูกใจ " + (r.likeCount || 0), () => likePost(v, r)); like.dataset.likeRecord = r.id; like.setAttribute("aria-pressed", String(!!r.liked));
      side.append(avatar, control("↗", "แชร์", () => sharePost(v, r)), control("☏", "ความคิดเห็น", () => panel(parent => inlineComments(v, r, parent))), like);
      if (r.text || r.title) { const description = control([r.title, r.text].filter(Boolean).join("\n"), "ดูรายละเอียดวิดีโอ", () => panel(parent => parent.append(el("p", [r.title,r.text].filter(Boolean).join("\n"))))); description.className = "social-video-description"; bottom.append(description); }
      bottom.append(transport); tick(0,0,false);
      if (entry.node.tagName === "VIDEO") { entry.node.ontimeupdate = () => tick(entry.node.currentTime, entry.node.duration, entry.node.paused); }
      mediaCommand(entry, "play", false); visible(true);
    };
    const navigate = async direction => {
      if (navigating || closed || !drawer.hidden) return;
      navigating = true;
      try {
        const index = v.videoEntries.indexOf(entry);
        if (direction > 0 && index === v.videoEntries.length - 1 && v.videoNextCursor) { await feed(v, v.videoNextCursor); await Promise.allSettled([...(v.mediaLoads || [])]); }
        const next = v.videoEntries[index + direction]; if (next) show(next);
      } catch(e) { status(v, friendly(e)); } finally { navigating = false; }
    };
    const tap = () => {
      const now = Date.now();
      if (now - lastTap < 300) { clearTimeout(tapTimer); lastTap = 0; likePost(v, entry.record, true).catch(e => status(v, friendly(e))); surface.classList.add("social-liked"); setTimeout(() => surface.classList.remove("social-liked"), 650); }
      else { lastTap = now; tapTimer = setTimeout(() => visible(hud.hidden), 300); }
    };
    surface.addEventListener("pointerdown", e => { gesture = { x:e.clientX, y:e.clientY, id:e.pointerId }; surface.setPointerCapture(e.pointerId); });
    surface.addEventListener("pointerup", e => {
      if (!gesture) return; const dy=e.clientY-gesture.y, dx=e.clientX-gesture.x; gesture=null;
      if (Math.abs(dy)>65 && Math.abs(dy)>Math.abs(dx)) { clearTimeout(tapTimer); lastTap=0; navigate(dy<0?1:-1); }
      else if (Math.abs(dy)<15 && Math.abs(dx)<15) tap();
    });
    surface.addEventListener("pointercancel", () => { gesture=null; });
    dialog.addEventListener("wheel", e => { if (!drawer.hidden || e.target.closest("input")) return; e.preventDefault(); if (Math.abs(e.deltaY)>20 && Date.now()-lastWheel>650) { lastWheel=Date.now(); navigate(e.deltaY>0?1:-1); } }, { passive:false });
    dialog.addEventListener("keydown", e => {
      if (e.target.matches("input,textarea,select")) return;
      if (["ArrowDown","ArrowUp"].includes(e.key)) { e.preventDefault(); navigate(e.key==="ArrowDown"?1:-1); }
      if (e.key===" ") { e.preventDefault(); playback.click(); }
    });
    dialog.addEventListener("cancel", e => { e.preventDefault(); close(); });
    hud.addEventListener("pointerdown", () => visible(true));
    const onState = event => { if (event.origin !== location.origin || event.source !== entry?.node.querySelector?.("iframe")?.contentWindow || event.data?.channel !== "panthorium-player-state") return; tick(event.data.time,event.data.duration,event.data.paused); };
    window.addEventListener("message", onState, { signal:v.controller.signal });
    dialog.addEventListener("close", () => window.removeEventListener("message", onState), { once:true });
    hud.append(side,bottom); dialog.append(stage,surface,hud,drawer);
    dialog.showModal(); show(initial);
    // Use native fullscreen where available, with the full-viewport dialog as a fallback.
    dialog.requestFullscreen?.().catch(() => {});
    dialog.focus();
  }

  async function media(v, record, container) {
    const compact = feedPost(v, record);
    if (record.source) { sourcePlayer(v, record.source, container, record.title || "Watch", record); container.append(externalLink("เปิดเว็บไซต์ต้นทาง", record.source.url)); }
    for (const file of record.files || []) {
      const item = el("div", null, { class: "social-media" });
      if (!compact) item.append(el("small", file.name));
      const preview = el("div");
      item.append(preview);
      container.append(item);
      const show = async () => {
        const blob = await api(v, "/api/social/records/" +
          encodeURIComponent(record.id) + "/files/" + encodeURIComponent(file.id), {}, true);
        if (!current(v) || !item.isConnected) return;
        let view;
        if (/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || /^(video|audio)\//.test(blob.type)) {
          const url = URL.createObjectURL(blob);
          v.urls.add(url);
          view = blob.type.startsWith("image")
            ? el("img", null, { alt: compact ? "ภาพในโพสต์" : file.name, src: url })
            : el(blob.type.startsWith("video") ? "video" : "audio", null,
                { src: url, controls: "", playsinline: "", preload: "metadata" });
        } else if (compact && !/^text\//.test(blob.type)) {
          view = el("p", "ไม่สามารถแสดงตัวอย่างไฟล์ชนิดนี้ได้");
        } else {
          view = el("pre", await blob.text());
          if (!current(v) || !item.isConnected) return;
        }
        preview.replaceChildren(view);
        if (view.tagName === "VIDEO" && ["short", "watch"].includes(record.module || v.module)) attachVideo(v, record, view);
      };
      if (compact || ["feed", "video", "watch", "short", "listing", "connect"].includes(record.kind) || (record.kind === "group-message" && /^(image\/(png|jpeg|webp|gif)|video\/|audio\/)/.test(file.contentType))) {
        preview.textContent = "กำลังโหลดสื่อ…";
        // Load independently so a slow attachment never blocks the feed or its controls.
        const loading = show().catch(() => {
          if (!current(v) || !item.isConnected) return;
          preview.replaceChildren(el("p", "โหลดสื่อไม่สำเร็จ"), button(v, "ลองโหลดอีกครั้ง", show));
        });
        v.mediaLoads ||= new Set(); v.mediaLoads.add(loading); loading.finally(() => v.mediaLoads.delete(loading));
      } else {
        preview.append(button(v, "เปิดไฟล์ / ดูตัวอย่าง", show));
      }
      if (!compact) item.append(
        button(v, "ดาวน์โหลดต้นฉบับ", async () => {
          const blob = await api(
            v,
            "/api/social/records/" +
              encodeURIComponent(record.id) +
              "/files/" +
              file.id +
              "?download=1",
            {},
            true,
          );
          if (!current(v)) return;
          const url = URL.createObjectURL(blob);
          v.urls.add(url);
          const a = el("a", "ดาวน์โหลด", { href: url, download: file.name });
          item.append(a);
          a.click();
        }),
      );
      container.append(item);
    }
  }
  async function profileSettings(v) {
    clear(v);
    const data = await api(v, "/api/social/profile");
    if (!current(v)) return;
    const f = section(v, "โปรไฟล์ส่วนตัว"),
      form = el("form");
    f.append(form);
    const name = input(form, "ชื่อที่แสดง", "text", data.profile?.name || ""),
      bio = input(form, "เกี่ยวกับฉัน", "textarea", data.profile?.bio || ""),
      visible = input(
        form,
        "อนุญาตให้ค้นหาชื่อของฉันและส่งคำขอเป็นเพื่อน",
        "checkbox",
      );
    visible.checked = !!data.profile?.discoverable;
    name.maxLength = 80;
    bio.maxLength = 1000;
    const getFiles = await attachments(v, form, (data.profile?.files || []).map(file => file.id));
    form.append(el("p", "แนบรูปโปรไฟล์ได้ รูปแรกใช้เป็นรูปผู้โพสต์สำหรับผู้ที่มีสิทธิ์ดูโพสต์ของคุณ"));
    bindForm(
      v,
      form,
      "profile",
      () => ({
        name: name.value,
        bio: bio.value,
        discoverable: visible.checked,
        fileIds: getFiles(),
      }),
      () => profileSettings(v),
    );
    f.append(
      el(
        "p",
        "ชื่อที่แสดงและรูปแรกใช้กำกับโพสต์ ส่วนข้อมูลเกี่ยวกับฉันยังเป็นส่วนตัว หากเปิดการซิงค์ Connect จะแชร์เฉพาะข้อมูลที่ยินยอมไว้ใน Connect",
      ),
    );
    if (os()?.state?.user?.roles?.includes("administrator"))
      f.append(
        button(v, "รายการรายงานเนื้อหา", async () => {
          const r = await api(v, "/api/social/reports");
          const target = section(v, "รายงาน");
          for (const report of r.items) {
            const c = el("div");
            c.append(
              el("p", report.reason),
              el("small", report.targetId),
              button(v, "ซ่อนรายการนี้", async () => {
                await write(v, "moderate", {
                  recordId: report.targetId,
                  hidden: true,
                  reason: report.reason,
                });
                status(v, "ซ่อนรายการแล้ว");
              }),
            );
            target.append(c);
          }
        }),
      );
  }
  async function compose(v) {
    clear(v);
    const card = section(
        v,
        v.module === "market" ? "ลงสินค้า" : "เผยแพร่ " + v.module,
      ),
      form = el("form");
    card.append(form);
    const watch = v.module === "feed";
    const title = ["feed", "short"].includes(v.module) ? null : input(form, v.module === "market" ? "ชื่อสินค้า" : "ชื่อเรื่อง", "text"),
      text = input(form, "รายละเอียด", "textarea"),
      audience = select(form, "ผู้ที่ดูได้", watch ? [["public", "สาธารณะ"], ["friends", "เพื่อน"]] : [
        ["public", "สาธารณะ"],
        ["followers", "ผู้ติดตาม"],
        ["private", "เฉพาะฉัน"],
      ]);
    if (title) title.maxLength = 200;
    text.maxLength = 8000;
    let sourceType, sourceUrl;
    if (v.module === "watch") {
      form.append(el("p", "วิดีโอยาว รายการ และภาพยนตร์ • แนบไฟล์ตามโควตาคลาวด์ หรือใช้ลิงก์วิดีโอที่คุณมีสิทธิ์เผยแพร่"));
      sourceType = select(form, "แหล่งวิดีโอ", [["youtube", "YouTube"], ["video", "MP4 / WebM"], ["hls", "HLS (.m3u8)"]]);
      sourceUrl = input(form, "ลิงก์วิดีโอ (ไม่ต้องกรอกหากแนบไฟล์)", "url"); sourceUrl.maxLength = 2000;
    }
    let price, stock;
    if (v.module === "market") {
      price = input(form, "ราคา (บาท)", "number");
      price.min = 0;
      price.step = "0.01";
      stock = input(form, "จำนวนสินค้า", "number", "1");
      stock.min = 1;
    }
    if (watch) form.append(el("p", "ภาพ ข้อความ และ GIF"));
    if (["short", "market"].includes(v.module)) { audience.value = "public"; audience.disabled = true; form.append(el("p", v.module === "short" ? "วิดีโอสั้นและ Reels • สาธารณะ" : "ร้านค้าสาธารณะ")); }
    const groupId = v.groupId;
    v.groupId = null;
    if (groupId) {
      audience.value = "private";
      audience.disabled = true;
      form.append(el("p", "โพสต์นี้มองเห็นเฉพาะสมาชิกกลุ่ม"));
    }
    const getFiles = await attachments(v, form, v.sourceFileIds || []);
    v.sourceFileIds = [];
    const submit = bindForm(
      v,
      form,
      v.module === "market" ? "listing" : "publish",
      () => ({
        module: v.module,
        ...(sourceUrl?.value ? { sourceType: sourceType.value, sourceUrl: sourceUrl.value } : {}),
        title: title?.value || "",
        text: text.value,
        audience: groupId ? "group" : audience.value,
        ...(groupId ? { groupId } : {}),
        fileIds: getFiles(),
        ...(price
          ? {
              priceSatang: Math.round(Number(price.value) * 100),
              stock: Number(stock.value),
            }
          : {}),
      }),
      () => groupId ? detail(v, groupId) : feed(v),
    );
    submit.textContent = v.module === "market" ? "ลงสินค้า" : "เผยแพร่";
    if (["feed", "short", "watch", "market"].includes(v.module)) composeActions(v, form, submit);
  }
  function composeActions(v, form, submit) {
    const actions = el("div", null, { class: "social-compose-actions" });
    const cancel = button(v, "ยกเลิก", () => { if (!submit.disabled) return feed(v); });
    actions.append(submit, cancel); form.append(actions);
  }
  function backActions(v, form, submit) {
    const actions = el("div", null, { class: "social-compose-actions" });
    actions.append(submit, button(v, "กลับ", () => { if (!submit.disabled) return feed(v); }));
    form.append(actions);
  }
  function friendActions(v, person, parent, reload) {
    const relation = person.friendship;
    if (relation?.status === "accepted") {
      parent.append(el("small", "เป็นเพื่อนกันแล้ว"), button(v, "ส่งข้อความ", async () => {
        const out = await write(v, "thread", { userId: person.id }); await open("talk", { recordId: out.record.id });
      }), button(v, "เลิกเป็นเพื่อน", async () => {
        if (!window.confirm("เลิกเป็นเพื่อนกับ " + person.name + "?")) return;
        await write(v, "friend-remove", { recordId: relation.id }); await reload();
      }));
    } else if (relation?.status === "pending") {
      if (relation.direction === "incoming") for (const [text, accept] of [["รับคำขอเป็นเพื่อน", true], ["ปฏิเสธ", false]])
        parent.append(button(v, text, async () => { await write(v, "friend-review", { recordId: relation.id, accept }); await reload(); }));
      else parent.append(el("small", "ส่งคำขอเป็นเพื่อนแล้ว"), button(v, "ยกเลิกคำขอ", async () => { await write(v, "friend-cancel", { recordId: relation.id }); await reload(); }));
    } else parent.append(button(v, "เพิ่มเพื่อน", async () => { await write(v, "friend-request", { userId: person.id }); await reload(); }));
    parent.append(button(v, "บล็อก", async () => { await write(v, "block", { userId: person.id, enabled: true }); await reload(); }));
  }
  async function people(v) {
    clear(v);
    const card = section(v, "เพื่อน"), q = v.search, results = el("div"); card.append(results);
    const contacts = el("section", null, { "data-social-friends": "" }); v.content.append(contacts);
    const renderPerson = (p, parent, reload) => {
      const row = el("article", null, { class: "social-card", "data-friend-id": p.id }); row.append(el("h4", p.name));
      friendActions(v, p, row, reload); parent.append(row);
    };
    const search = async () => {
      const data = await api(v, "/api/social/people?query=" + encodeURIComponent(q.value));
      if (!current(v) || !results.isConnected) return;
      results.replaceChildren();
      for (const person of data.items) renderPerson(person, results, async () => { await search(); await v.refreshFriends?.(); });
      if (!data.items.length) results.append(el("p", "ไม่พบชื่อที่อนุญาตให้ค้นหา"));
    };
    if (q.value.trim()) await search();
    v.refreshFriends = async (before) => {
      v.noticeThrough = new Date().toISOString();
      const data = await api(v, "/api/social/friends" + (before ? "?before=" + encodeURIComponent(before) : ""));
      if (!current(v) || !contacts.isConnected) return;
      if (!before) contacts.replaceChildren(el("h3", "เพื่อนและคำขอเป็นเพื่อน"));
      if (!data.items.length && !before) contacts.append(el("p", "ยังไม่มีเพื่อนหรือคำขอ"));
      for (const relation of [...data.items].sort((a,b) => Number(b.status === "pending" && b.direction === "incoming") - Number(a.status === "pending" && a.direction === "incoming"))) renderPerson({ id: relation.userId, name: relation.name, friendship: relation }, contacts, () => v.refreshFriends());
      if (data.nextCursor) contacts.append(button(v, "โหลดเพื่อนเพิ่มเติม", async () => { await v.refreshFriends(data.nextCursor); }));
    };
    await v.refreshFriends();
  }
  function inlineComments(v, record, parent, initial, toggle) {
    const collapsible = !!toggle, live = record.kind === "live";
    const section = el("section", null, {
      class: "social-comments", "data-social-comments": record.id,
      id: "comments-" + record.id, "aria-label": "ความคิดเห็นใต้โพสต์",
    });
    section.hidden = collapsible;
    const log = el("div", "กำลังโหลดความคิดเห็น…", { "data-social-messages": record.id });
    const form = el("form", null, { "data-social-comment-form": record.id });
    const text = input(form, "เขียนความคิดเห็น", "textarea");
    text.setAttribute("data-social-comment-input", ""); text.required = true; text.maxLength = 2000;
    const notice = el("p"); notice.hidden = true;
    section.append(el("h4", "ความคิดเห็น"), log, notice, form); parent.append(section);
    let version = 0, items = [], pending, fingerprint;
    const active = () => current(v) && section.isConnected;
    const setCount = count => {
      if (!toggle) return;
      const value = Number.isSafeInteger(count) && count >= 0 ? count : 0;
      toggle.textContent = "ความคิดเห็น " + value; toggle.dataset.commentCount = String(value);
    };
    const render = (data, older = false) => {
      if (!active()) return;
      items = older ? [...data.items, ...items] : data.items;
      setCount(data.record?.commentCount ?? items.length);
      if (live) {
        const latest = data.record || record;
        const joined = latest.members?.includes(v.uid), ended = latest.status !== "live";
        form.hidden = ended || !joined; notice.hidden = !form.hidden;
        notice.textContent = ended ? "การถ่ายทอดสดสิ้นสุดแล้ว" : "เข้าชมไลฟ์เพื่อแสดงความคิดเห็น";
      }
      const next = JSON.stringify([items.map(item => [item.id, item.text, item.author?.name]), data.nextCursor]);
      if (next === fingerprint) return;
      fingerprint = next;
      log.replaceChildren();
      if (data.nextCursor) log.append(button(v, "ดูความคิดเห็นก่อนหน้า", () => load(data.nextCursor)));
      for (const comment of items) {
        const row = el("article", null, { class: "social-message", "data-comment-id": comment.id });
        row.append(el("small", (comment.ownerId === v.uid ? "คุณ" : comment.author?.name || "สมาชิก") + " • " + new Date(comment.createdAt).toLocaleString("th-TH")), el("p", comment.text));
        if (collapsible && comment.ownerId === v.uid) row.append(button(v, "ลบความคิดเห็น", async () => {
          if (!window.confirm("ลบความคิดเห็นนี้?")) return;
          await write(v, "delete", { recordId: comment.id });
          if (pending) await pending;
          await load();
        }));
        log.append(row);
      }
    };
    const load = async (before) => {
      if (pending) return pending;
      const request = ++version;
      pending = (async () => {
        try {
          const data = await api(v, "/api/social/records/" + encodeURIComponent(record.id) + (before ? "?before=" + encodeURIComponent(before) : ""));
          if (active() && request === version) render(data, !!before);
        } catch (error) {
          if (!active() || request !== version) return;
          fingerprint = null;
          log.replaceChildren(el("p", "โหลดความคิดเห็นไม่สำเร็จ: " + friendly(error)), button(v, "ลองโหลดความคิดเห็นอีกครั้ง", () => load()));
        } finally { pending = null; }
      })();
      return pending;
    };
    const submit = bindForm(v, form, live ? "live-chat" : "comment", () => ({ recordId: record.id, text: text.value }), async () => {
      if (!active()) return;
      text.value = "";
      if (pending) await pending;
      await load();
    });
    if (collapsible) {
      const actions = el("div", null, { class: "social-comment-actions" });
      const erase = button(v, "ลบ", () => {
        if (submit.disabled) return;
        text.value = ""; form.dispatchEvent(new Event("input", { bubbles: true })); text.focus();
      });
      erase.title = "ล้างข้อความที่กำลังเขียน"; erase.setAttribute("aria-label", "ลบข้อความที่กำลังเขียน");
      actions.append(submit, erase); form.append(actions);
      toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", section.id);
      setCount(record.commentCount);
      toggle.addEventListener("click", async () => {
        if (!current(v)) return;
        section.hidden = !section.hidden; toggle.setAttribute("aria-expanded", String(!section.hidden));
        if (!section.hidden) {
          await load();
          if (active() && !section.hidden) text.focus({ preventScroll: true });
        }
      });
    }
    if (initial) render(initial);
    else if (!collapsible) load();
    if (live) {
      form.hidden = record.status !== "live" || !record.members?.includes(v.uid);
      (v.liveComments ||= new Map()).set(record.id, { section, load });
    }
  }
  async function card(v, r, parent, commentData) {
    const c = el("article", null, {
      class: "social-card",
      "data-record-id": r.id,
    });
    parent.append(c);
    v.recordOrder ||= new Map(); if (!v.recordOrder.has(r.id)) v.recordOrder.set(r.id, v.recordOrder.size);
    if (r.kind === "thread") {
      const latest = r.lastMessage;
      c.append(el("h3", r.peer?.name || "สมาชิก"),
        el("p", latest ? (latest.ownerId === v.uid ? "คุณ: " : "") + (latest.text || "ไฟล์แนบ " + latest.attachmentCount + " ไฟล์")
          : r.status === "pending" ? "รอรับคำขอสนทนา" : r.status === "declined" ? "คำขอสนทนาถูกปฏิเสธ" : "เริ่มสนทนา", { class: "social-chat-preview" }));
      if (latest) c.append(el("small", new Date(latest.createdAt).toLocaleString("th-TH")));
      c.setAttribute("role", "button"); c.tabIndex = 0; c.setAttribute("aria-label", "เปิดแชท " + (r.peer?.name || "สมาชิก"));
      c.append(recordBadge(r.id));
      c.addEventListener("click", () => detail(v, r.id).catch(e => status(v, friendly(e))));
      c.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); c.click(); } });
      return;
    }
    const compact = feedPost(v, r);
    let commentToggle;
    const actions = compact ? el("div", null, { class: "social-post-actions" }) : c;
    c.append(
      el("small", r.author?.name || "สมาชิก"),
      ...(["feed", "short"].includes(r.module || v.module) && !r.title ? [] : [el("h3", r.title || r.name || (r.kind === "thread" ? "Chat" : r.module === "short" || r.kind === "short" ? "วิดีโอ" : "โพสต์"))]),
      el("p", r.text || r.bio || ""),
    );
    if (r.kind === "connect") {
      await media(v, r, c);
      c.append(
        button(v, "สนใจ", async () => {
          await write(v, "interest", { userId: r.ownerId });
          await feed(v);
        }),
        button(v, "ผ่าน", async () => {
          await write(v, "pass", { userId: r.ownerId });
          c.remove();
        }),
      );
      if (r.matched)
        c.append(
          button(v, "ตรงกันแล้ว • เริ่มคุย", async () => {
            const t = await write(v, "thread", {
              userId: r.ownerId,
              context: "connect",
            });
            await open("connect", { recordId: t.record.id });
          }),
        );
    } else if (r.kind === "live") {
      if (v.sessionId === r.id) c.append(el("p", r.ownerId === v.uid ? "กำลังถ่ายทอดสด" : "กำลังรับชมไลฟ์"));
      else if (r.status === "live") c.append(
        button(v, "เข้าชมไลฟ์", async () => {
          const out = await write(v, "live-join", { recordId: r.id });
          await startRTC(v, out.record);
          await detail(v, r.id);
        }),
      );
      else c.append(el("p", "การถ่ายทอดสดสิ้นสุดแล้ว"));
    } else {
      await media(v, r, c);
      if (r.kind === "listing") {
        c.append(
          el(
            "strong",
            (r.priceSatang / 100).toLocaleString("th-TH") +
              " บาท • คงเหลือ " +
              r.stock,
          ),
        );
        if (r.ownerId !== v.uid) {
          const qty = input(c, "จำนวน", "number", "1");
          qty.min = 1;
          c.append(
            button(v, "ส่งคำขอสั่งซื้อ", async () => {
              if (
                !window.confirm(
                  "ส่งคำขอสั่งซื้อ " +
                    r.title +
                    " จำนวน " +
                    qty.value +
                    "? ยังไม่มีการตัดเงิน",
                )
              )
                return;
              await write(v, "order", {
                recordId: r.id,
                quantity: Number(qty.value),
              });
              status(v, "ส่งคำขอสั่งซื้อแล้ว เปิดรายการซื้อขายเพื่อติดตาม");
            }),
          );
        }
      }
    }
    if (["feed", "video", "watch", "short", "community", "listing", "live"].includes(r.kind)) {
      const like = button(v, (r.liked ? "♥" : "♡") + " " + (r.likeCount || 0), () => likePost(v, r));
      like.dataset.likeRecord = r.id;
      like.setAttribute("aria-label", "ถูกใจ " + (r.likeCount || 0)); like.setAttribute("aria-pressed", String(!!r.liked));
      commentToggle = compact ? el("button", "ความคิดเห็น " + (r.commentCount || 0), { type: "button", "data-comment-toggle": r.id }) : button(v, "ความคิดเห็น", () => c.querySelector("[data-social-comment-input]")?.focus());
      const share = button(v, "↗", () => sharePost(v, r)); share.setAttribute("aria-label", "แชร์");
      actions.append(like, commentToggle, share);
      if (compact) c.append(actions);
    }
    let extra = c;
    if (compact) {
      const dropdown = el("details", null, { class: "social-post-menu" });
      const trigger = el("summary", "⋯", { role: "button", "aria-label": "ตัวเลือกโพสต์", "aria-expanded": "false" });
      extra = el("div", null, { class: "social-post-menu-items" }); dropdown.append(trigger, extra); actions.append(dropdown);
      const close = focus => { dropdown.open = false; trigger.setAttribute("aria-expanded", "false"); if (focus) trigger.focus({ preventScroll: true }); };
      dropdown.addEventListener("toggle", () => {
        trigger.setAttribute("aria-expanded", String(dropdown.open));
        if (dropdown.open) v.root.querySelectorAll(".social-post-menu[open]").forEach(other => { if (other !== dropdown) other.open = false; });
      });
      dropdown.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); close(true); } });
      dropdown.addEventListener("focusout", event => { if (!dropdown.contains(event.relatedTarget)) close(false); });
      extra.addEventListener("click", event => { if (event.target.closest("button")) close(false); });
    }
    if (["short", "watch"].includes(r.module) || ["short", "video"].includes(r.kind))
      extra.append(
        button(v, "เพิ่มลงเพลย์ลิสต์", () => collections(v, "playlist", r.id)),
      );
    if (
      r.ownerId === v.uid &&
      ["community", "feed", "video", "watch", "short", "listing"].includes(r.kind)
    )
      extra.append(button(v, "แก้ไข", () => edit(v, r)));
    if (
      r.ownerId === v.uid &&
      ["community", "feed", "video", "watch", "short", "listing"].includes(r.kind)
    )
      extra.append(
        button(v, "ลบ", async () => {
          if (!window.confirm("ลบรายการนี้? ไฟล์ต้นฉบับยังอยู่ในพื้นที่ของคุณ"))
            return;
          await write(v, "delete", { recordId: r.id });
          await feed(v);
        }),
      );
    if (r.kind === "live" && r.ownerId === v.uid && r.status === "live") extra.append(button(v, "จบไลฟ์", async () => {
      if (!window.confirm("จบการถ่ายทอดสดนี้?")) return;
      await write(v, "live-end", { recordId: r.id });
      if (v.sessionId === r.id) { await window.PanthoriumSocialRTC?.stop(false); v.sessionId = null; v.rtc.hidden = true; }
      await feed(v);
    }));
    if (r.ownerId !== v.uid) {
      if (r.kind !== "connect") extra.append(
        button(v, "ขอสนทนากับเจ้าของ", async () => {
          const t = await write(v, "thread", {
            userId: r.ownerId,
            title: r.title || "Chat",
          });
          await open("talk", { recordId: t.record.id });
        }),
      );
      extra.append(
        button(v, "บล็อกเจ้าของ", async () => {
          await write(v, "block", { userId: r.ownerId, enabled: true });
          await feed(v);
        }),
      );
      const reportForm = el("div");
      reportForm.hidden = true;
      const reason = input(reportForm, "เหตุผลที่รายงาน", "textarea");
      const reportButton = button(v, "รายงาน", () => {
        reportForm.hidden = false;
        reportButton.setAttribute("aria-expanded", "true");
        reason.focus();
      });
      reportButton.setAttribute("aria-expanded", "false");
      const closeReport = () => {
        reportForm.hidden = true;
        reportButton.setAttribute("aria-expanded", "false");
        (compact ? actions.querySelector("summary") : reportButton).focus();
      };
      reportForm.append(
        button(v, "ส่งรายงาน", async () => {
          if (!reason.value.trim()) { reason.focus(); return; }
          await write(v, "report", { recordId: r.id, reason: reason.value.trim() });
          reason.value = "";
          closeReport();
          status(v, "ส่งรายงานให้ผู้ดูแลแล้ว");
        }),
        button(v, "ยกเลิก", closeReport),
      );
      extra.append(reportButton); c.append(reportForm);
    }
    const tools = compact ? extra : el("details", null, { class: "social-record-tools" });
    if (!compact) { tools.append(el("summary", "เครื่องมือของรายการ")); c.append(tools); }
    tools.append(
      button(v, "นำไปใช้กับ Sentinel", async () => {
        await window.PanthoriumVoiceCommands?.windowAction("open_sentinel");
        const field = document.getElementById("chat-input");
        if (field) {
          field.value =
            "ช่วยสรุปรายการ Social Media รหัส " +
            r.id +
            " และเสนอสิ่งที่ทำต่อได้ โดยอ่านข้อมูลผ่าน social.read ก่อน";
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.focus();
        }
      }),
    );
    tools.append(
      button(v, "คัดลอกลิงก์รายการ", async () => {
        await navigator.clipboard.writeText(
          location.origin +
            location.pathname +
            "#social=" +
            v.module +
            "&record=" +
            encodeURIComponent(r.id),
        );
        status(v, "คัดลอกลิงก์แล้ว ผู้เปิดต้องมีสิทธิ์เข้าถึง");
      }),
      button(v, "นำไปวางแผนในปฏิทิน", () =>
        window.PanthoriumCalendar?.command({
          action: "new_event",
          title: r.title || r.name || "นัดหมายจาก Social Media",
        }),
      ),
    );
    if (["feed", "video", "watch", "short", "community", "listing", "live"].includes(r.kind))
      inlineComments(v, r, c, commentData, compact ? commentToggle : null);
  }
  async function detail(v, id, reset = true) {
    if (reset) clear(v);
    v.detail = id;
    v.noticeThrough = new Date().toISOString();
    scheduleRead(v);
    const version = v.renderVersion;
    const data = await api(v, "/api/social/records/" + encodeURIComponent(id));
    if (!current(v) || v.detail !== id || version !== v.renderVersion) return;
    const r = data.record;
    if (r.module && r.module !== v.module && ["feed", "video", "watch", "short", "community", "listing", "thread", "live"].includes(r.kind)) {
      v.detail = null;
      return open(r.module, { recordId: id });
    }
    if (["feed", "video", "watch", "short", "community", "listing", "live"].includes(r.kind)) {
      await window.PanthoriumSocial.renderCard(v, r, v.content, data);
      return;
    }
    const card = section(v, r.kind === "thread" ? r.peer?.name || "บทสนทนา" : r.title || "บทสนทนา");
    if (r.kind === "thread" && r.status === "pending") {
      card.append(el("p", "คำขอสนทนา • ยังส่งข้อความหรือโทรไม่ได้"));
      if (r.ownerId !== v.uid)
        card.append(
          button(v, "รับคำขอ", async () => {
            await write(v, "accept-thread", { recordId: id, accept: true });
            await detail(v, id);
          }),
          button(v, "ปฏิเสธ", async () => {
            await write(v, "accept-thread", { recordId: id, accept: false });
            await feed(v);
          }),
        );
      card.append(button(v, "กลับ", () => feed(v)));
      return;
    }
    if (r.kind === "group") return groupDetail(v, data, card);
    if (r.kind === "playlist") {
      for (const post of data.items) {
        await window.PanthoriumSocial.renderCard(v, post, card);
        card.append(
          button(v, "นำออกจากเพลย์ลิสต์", async () => {
            await write(v, "playlist-remove", {
              recordId: r.id,
              targetId: post.id,
            });
            await detail(v, r.id);
          }),
        );
      }
      return;
    }
    if (r.kind === "thread")
      card.append(
        button(v, "โทรด้วยเสียง", () => call(v, r, false)),
        button(v, "วิดีโอคอล", () => call(v, r, true)),
      );
    const log = el("div", null, { "data-social-messages": id });
    if (r.kind === "thread" && v.module === "talk") {
      log.className = "social-thread-log";
      card.append(el("p", "ข้อความใน Chat จะลบอัตโนมัติหลัง 3 วัน"));
    }
    card.append(log);
    if (["thread", "live"].includes(r.kind)) {
      v.messageLog = log;
      v.lastMessages = JSON.stringify(data.items.map(x => [x.id, x.deleted, x.readAt, x.author?.name]));
    }
    await renderMessages(v, data.items, log);
    if (
      r.kind === "thread" ||
      r.kind === "live" ||
      ["community", "feed", "video", "watch", "short", "listing"].includes(r.kind)
    ) {
      const f = el("form"),
        text = input(
          f,
          r.kind === "thread" ? "ข้อความ" : "ความคิดเห็น",
          "textarea",
        );
      card.append(f);
      const getFiles = r.kind === "thread" ? await attachments(v, f) : () => [];
      const submit = bindForm(
        v,
        f,
        r.kind === "thread"
          ? "message"
          : r.kind === "live"
            ? "live-chat"
            : "comment",
        () => ({ recordId: id, text: text.value, fileIds: getFiles() }),
        async () => {
          text.value = "";
          const fresh = await api(
            v,
            "/api/social/records/" + encodeURIComponent(id),
          );
          await renderMessages(v, fresh.items, log);
        },
      );
      if (r.kind === "thread") backActions(v, f, submit);
    }
  }
  const messageFingerprint = items => JSON.stringify(items.map(x => [x.id, x.deleted, x.readAt, x.readCount, x.author?.name]));
  function groupRequests(v, requests) {
    const panel = v.groupState?.requests;
    if (!panel?.isConnected) return;
    const signature = JSON.stringify(requests);
    if (v.groupState.requestSignature === signature) return;
    v.groupState.requestSignature = signature;
    const groupId = v.detail;
    panel.replaceChildren(el("h4", "คำขอเข้าร่วมกลุ่ม (" + requests.length + ")"));
    if (!requests.length) panel.append(el("p", "ยังไม่มีคำขอรออนุมัติ"));
    for (const request of requests) {
      const row = el("article", null, { class: "social-card", "data-group-request": request.userId });
      row.append(el("strong", request.name), el("p", new Date(request.requestedAt).toLocaleString("th-TH")));
      for (const [label, accept] of [["อนุมัติ", true], ["ไม่อนุมัติ", false]])
        row.append(button(v, label, async () => {
          await write(v, "group-review", { recordId: groupId, userId: request.userId, accept });
          if (v.groupState?.requests !== panel) return;
          const fresh = await api(v, "/api/social/records/" + encodeURIComponent(groupId));
          if (v.groupState?.requests !== panel) return;
          groupRequests(v, fresh.requests || []);
          v.groupState.summary.textContent = groupSummary(fresh.record);
        }));
      panel.append(row);
    }
  }
  const groupSummary = r => (r.privacy === "closed" ? "กลุ่มปิด • ผู้สร้างอนุมัติการเข้าร่วม" : "กลุ่มเปิด • เข้าร่วมได้ทันที") + " • สมาชิก " + r.memberCount + " คน";
  async function groupMessages(v, data, older = false) {
    const log = v.messageLog;
    if (!current(v) || !v.groupState || !log?.isConnected) return;
    if (!v.groupItems) v.groupItems = new Map();
    // Keep older loaded history, but replace the refreshed page so removed/blocked messages disappear.
    if (!older) {
      const first = data.items[0]?.id;
      for (const id of v.groupItems.keys()) if (!first || id >= first) v.groupItems.delete(id);
    }
    for (const item of data.items) v.groupItems.set(item.id, item);
    if (older || !v.groupState.historyLoaded) v.groupCursor = data.nextCursor;
    if (older) v.groupState.historyLoaded = true;
    const items = [...v.groupItems.values()].sort((a, b) => a.id.localeCompare(b.id));
    const fingerprint = messageFingerprint(items);
    if (v.lastMessages !== fingerprint) {
      v.lastMessages = fingerprint;
      await renderMessages(v, items, log);
    }
    if (!current(v) || v.messageLog !== log || !v.groupState) return;
    v.groupState.older.hidden = !v.groupCursor;
    v.groupState.empty.hidden = !!items.length;
    scheduleRead(v);
  }
  async function groupDetail(v, data, card) {
    const r = data.record;
    const summary = el("p", groupSummary(r));
    card.append(summary, el("p", r.text || ""));
    v.groupState = { membership: r.membership, summary };
    card.append(button(v, "กลับไปกลุ่มทั้งหมด", () => collections(v, "group")));
    if (r.membership !== "member") {
      card.append(el("p", r.membership === "pending" ? "ส่งคำขอแล้ว รอผู้สร้างกลุ่มอนุมัติ" :
        r.membership === "declined" ? "คำขอก่อนหน้ายังไม่ได้รับอนุมัติ คุณสามารถส่งคำขอใหม่ได้" :
        "เข้าร่วมกลุ่มเพื่ออ่านแชตและแชร์ข้อความ รูปภาพ วิดีโอ และไฟล์"));
      card.append(button(v, r.membership === "pending" ? "ยกเลิกคำขอ" : r.privacy === "closed" ? "ขอเข้าร่วมกลุ่ม" : "เข้าร่วมกลุ่ม", async () => {
        await write(v, r.membership === "pending" ? "group-cancel-request" : "group-join", { recordId: r.id });
        await detail(v, r.id);
      }));
      return;
    }
    if (r.ownerId === v.uid) {
      card.append(el("p", "คุณเป็นผู้สร้างกลุ่ม"));
      const requests = el("section", null, { "data-group-requests": "" });
      card.append(requests);
      v.groupState.requests = requests;
      groupRequests(v, data.requests || []);
    } else card.append(button(v, "ออกจากกลุ่ม", async () => {
      await write(v, "group-leave", { recordId: r.id });
      await detail(v, r.id);
    }));
    card.append(el("h4", "แชตกลุ่ม"));
    const older = button(v, "โหลดข้อความก่อนหน้า", async () => {
      const log = v.messageLog, id = r.id;
      const previous = await api(v, "/api/social/records/" + encodeURIComponent(id) + "?before=" + encodeURIComponent(v.groupCursor));
      if (v.detail === id && v.messageLog === log) await groupMessages(v, previous, true);
    });
    const empty = el("p", "ยังไม่มีข้อความ เริ่มสนทนาในกลุ่มได้เลย");
    const log = el("div", null, { "data-social-messages": r.id, "aria-label": "ข้อความในกลุ่ม" });
    card.append(older, empty, log);
    Object.assign(v.groupState, { older, empty });
    v.messageLog = log;
    await groupMessages(v, data);
    const form = el("form", null, { "data-group-composer": "" });
    card.append(form);
    const text = input(form, "ข้อความในกลุ่ม", "textarea"); text.maxLength = 8000;
    const getFiles = await attachments(v, form, v.sourceFileIds || []);
    v.sourceFileIds = [];
    bindForm(v, form, "group-message", () => ({ recordId: r.id, text: text.value, fileIds: getFiles() }), async () => {
      if (v.detail !== r.id || v.messageLog !== log) return;
      text.value = ""; getFiles.reset();
      const fresh = await api(v, "/api/social/records/" + encodeURIComponent(r.id));
      if (v.detail === r.id && v.messageLog === log) await groupMessages(v, fresh);
    });
    // Existing group posts stay available alongside the new conversation.
    const posts = el("details"); posts.append(el("summary", "โพสต์ในกลุ่ม (" + (data.posts || []).length + ")")); card.append(posts);
    posts.append(button(v, "โพสต์ในกลุ่ม", async () => { v.groupId = r.id; await compose(v); }));
    for (const post of data.posts || []) await window.PanthoriumSocial.renderCard(v, post, posts);
  }
  function messageVisible(v, node, container = v.messageLog) {
    if (!current(v) || document.visibilityState !== "visible" || !document.hasFocus() ||
        !container?.contains(node) || !v.root.contains(container)) return false;
    const win = v.root.closest(".window");
    const z = Number(getComputedStyle(win).zIndex) || 0;
    for (const other of document.querySelectorAll(".window"))
      if (other !== win && other.getClientRects().length && (Number(getComputedStyle(other).zIndex) || 0) > z) return false;
    const rect = node.getBoundingClientRect();
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top),
      right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    }
    if (rect.height <= 0 || rect.width <= 0 || bottom - top < Math.min(24, rect.height) || right - left < Math.min(80, rect.width)) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return !!hit && node.contains(hit);
  }
  function scheduleRead(v) {
    clearTimeout(v.readTimer);
    v.readTimer = setTimeout(() => { acknowledgeVisible(v); acknowledgeActivity(v); }, 150);
  }
  async function acknowledgeVisible(v) {
    if (v.readBusy || !current(v) || !v.messageLog?.isConnected || !v.detail) return;
    const log = v.messageLog, threadId = v.detail;
    const ids = [...log.querySelectorAll('[data-incoming="true"]')]
      .filter(node => !v.readSeen?.has(node.dataset.messageId) && messageVisible(v, node))
      .map(node => node.dataset.messageId).slice(0, 100);
    if (!ids.length) return;
    v.readBusy = true;
    try {
      await api(v, "/api/social/records/" + encodeURIComponent(threadId) + "/read", {
        method: "POST", body: JSON.stringify({ messageIds: ids }),
      });
      if (current(v) && v.messageLog === log) {
        v.readSeen ||= new Set();
        for (const id of ids) v.readSeen.add(id);
        refreshNotifications();
      }
    } catch (_) {
      // Retry visible messages on the next poll; never claim an unconfirmed read.
    } finally { v.readBusy = false; }
  }
  async function renderMessages(v, items, log) {
    if (!current(v) || !log.isConnected) return;
    const version = v.messageRender = (v.messageRender || 0) + 1;
    v.readObserver?.disconnect();
    const previous = v.messageLog === log ? new Map([...log.children].map(node => [node.dataset.messageId, node])) : null;
    if (!previous) log.replaceChildren();
    const rendered = [];
    const revoke = node => {
      for (const media of node.querySelectorAll('[src^="blob:"]')) { URL.revokeObjectURL(media.src); v.urls.delete(media.src); }
    };
    for (const msg of items) {
      if (!current(v) || !log.isConnected || v.messageRender !== version) return;
      const signature = JSON.stringify([msg.text, msg.files, msg.author, msg.createdAt]);
      const old = previous?.get(msg.id);
      const reuse = old?.dataset.messageSignature === signature;
      const c = reuse ? old : el("article", null, { class: "social-message", "data-message-id": msg.id });
      c.dataset.messageSignature = signature;
      rendered.push(c);
      const chat = ["message", "group-message"].includes(msg.kind);
      if (v.module === "talk" && msg.kind === "message") c.dataset.direction = msg.ownerId === v.uid ? "outgoing" : "incoming";
      if (chat && msg.ownerId !== v.uid && !msg.readAt) c.dataset.incoming = "true";
      else delete c.dataset.incoming;
      if (!reuse) c.append(
        el(
          "small",
          (msg.ownerId === v.uid ? "คุณ" : msg.author?.name || "สมาชิก") +
            " • " +
            new Date(msg.createdAt).toLocaleString("th-TH"),
        ),
        el("p", msg.text),
      );
      if (chat && msg.ownerId === v.uid) {
        const label = msg.readAt ? msg.kind === "group-message" ? "อ่านแล้ว " + msg.readCount + " คน" : "อ่านแล้ว" : "ส่งแล้ว";
        const receipt = c.querySelector(".social-message-receipt") || el("span", null, {
          class: "social-message-receipt", "data-delivery": msg.readAt ? "read" : "sent",
          "aria-label": label, title: label,
        });
        receipt.textContent = msg.readAt ? "✓✓" : "✓";
        receipt.dataset.delivery = msg.readAt ? "read" : "sent";
        receipt.setAttribute("aria-label", label); receipt.title = label;
        if (!receipt.isConnected) c.append(receipt);
        if (msg.kind === "group-message") {
          const count = c.querySelector("[data-group-read-count]") || el("small", null, { "data-group-read-count": "" });
          count.textContent = msg.readCount ? label : "";
          if (!count.isConnected) c.append(count);
        }
      }
      if (reuse) continue;
      await media(v, msg, c);
      if (!current(v) || !log.isConnected || v.messageRender !== version) return;
      if (msg.ownerId === v.uid && chat && !(v.module === "talk" && msg.kind === "message"))
        c.append(
          button(v, "ลบข้อความ", async () => {
            await write(v, "delete", { recordId: msg.id });
            v.groupItems?.delete(msg.id);
            c.remove();
          }),
        );
      if (old) { revoke(old); old.replaceWith(c); }
      else log.append(c);
    }
    if (previous) {
      const keep = new Set(rendered);
      for (const node of [...log.children]) if (!keep.has(node)) { revoke(node); node.remove(); }
      rendered.forEach((node, index) => { if (log.children[index] !== node) log.insertBefore(node, log.children[index] || null); });
    }
    if (current(v) && v.messageLog === log && log.isConnected) {
      if (window.IntersectionObserver) {
        v.readObserver = new IntersectionObserver(() => scheduleRead(v), { threshold: [0, 0.5, 1] });
        log.querySelectorAll('[data-incoming="true"]').forEach(node => v.readObserver.observe(node));
      }
      scheduleRead(v);
    }
  }
  async function connectSettings(v) {
    clear(v);
    const data = await api(v, "/api/social/profile"),
      old = data.connect;
    const card = section(v, "Connect • สมัครใจเปิดใช้สำหรับผู้ใหญ่"),
      f = el("form");
    card.append(f);
    const name = input(f, "ชื่อใน Connect", "text", old?.name || ""),
      bio = input(f, "แนะนำตัว", "textarea", old?.bio || ""),
      gender = select(
        f,
        "เพศของฉัน",
        [
          ["male", "ชาย"],
          ["female", "หญิง"],
          ["nonbinary", "นอนไบนารี"],
          ["self-described", "ระบุด้วยตนเองในคำแนะนำตัว"],
        ],
        old?.gender,
      ),
      pref = select(
        f,
        "สนใจทำความรู้จัก",
        [
          ["all", "ทุกเพศ"],
          ["male", "ชาย"],
          ["female", "หญิง"],
          ["nonbinary", "นอนไบนารี"],
          ["self-described", "ระบุด้วยตนเอง"],
        ],
        old?.preferences?.[0],
      ),
      adult = input(
        f,
        "ฉันอายุ 18 ปีขึ้นไป และยินยอมแสดงโปรไฟล์นี้ต่อผู้เปิดใช้ Connect",
        "checkbox",
      );
    const sync = input(f, "ใช้ชื่อ รูป และคำแนะนำจากโปรไฟล์ของฉันใน Connect", "checkbox");
    sync.checked = old ? old.syncProfile === true : true;
    let fileFields;
    const syncFields = () => {
      if (sync.checked) { name.value = data.profile?.name || ""; bio.value = data.profile?.bio || ""; }
      name.disabled = bio.disabled = sync.checked;
      if (fileFields) fileFields.hidden = sync.checked;
    };
    sync.onchange = syncFields; syncFields();
    f.append(el("p", "เพศและความสนใจในการค้นหาเป็นการตั้งค่าส่วนตัว ใช้จับคู่ชาย–ชาย ชาย–หญิง หญิง–หญิง หรือความสนใจที่เลือก ข้อมูลจากโปรไฟล์จะแชร์ใน Connect เมื่อคุณเปิดใช้และยินยอมเท่านั้น"));
    const getFiles = await attachments(v, f, (old?.files || []).map(file => file.id));
    fileFields = f.lastElementChild; syncFields();
    const submit = bindForm(
      v,
      f,
      "connect",
      () => ({
        enabled: true,
        adultConfirmed: adult.checked,
        syncProfile: sync.checked,
        name: name.value,
        bio: bio.value,
        gender: gender.value,
        preferences: [pref.value],
        fileIds: getFiles(),
      }),
      () => feed(v),
    );
    backActions(v, f, submit);
    card.append(
      button(v, "ปิด Connect และหยุดการค้นพบ/สนทนา", async () => {
        await write(v, "connect", { enabled: false });
        await feed(v);
      }),
    );
  }
  async function community(v, mode = "mine", before) {
    if (!before) {
      clear(v); v.communityMode = mode;
      for (const b of v.communityButtons || []) b.setAttribute("aria-expanded", String(b.dataset.groupMenu === mode));
      v.communityPanel = section(v, { mine: "กลุ่มของฉัน", all: "กลุ่มทั้งหมด", create: "สร้างกลุ่ม" }[mode]);
      v.communityPanel.id = "social-community-panel";
    }
    const panel = v.communityPanel, version = v.renderVersion;
    if (mode === "create") {
      const form = el("form"), title = input(form, "ชื่อ"); panel.append(form);
      title.required = true; title.maxLength = 120;
      const privacy = select(form, "ประเภทกลุ่ม", [["open", "แบบเปิด — เข้าร่วมได้ทันที"], ["closed", "แบบปิด — ผู้สร้างอนุมัติคำขอ"]], "open");
      const description = input(form, "คำอธิบายกลุ่ม", "textarea"); description.maxLength = 2000;
      bindForm(v, form, "group-create", () => ({ title: title.value, privacy: privacy.value, text: description.value }), out => detail(v, out.record.id));
      return;
    }
    const data = await api(v, "/api/social/collections/group?scope=" + mode + "&query=" + encodeURIComponent(v.search.value) + (before ? "&before=" + encodeURIComponent(before) : ""));
    if (!current(v) || version !== v.renderVersion || !panel.isConnected) return;
    if (!data.items.length && !before) panel.append(el("p", mode === "mine" ? "คุณยังไม่ได้เข้าร่วมกลุ่ม เลือกกลุ่มทั้งหมดเพื่อค้นหากลุ่ม หรือสร้างกลุ่มของคุณ" : "ยังไม่มีกลุ่ม"));
    for (const r of data.items) {
      const c = el("article", null, { class: "social-card", "data-group-id": r.id });
      c.append(el("h4", r.title), recordBadge(r.id), el("p", r.text || ""), el("p", groupSummary(r)),
        el("small", r.membership === "member" ? "เป็นสมาชิกแล้ว" : r.membership === "pending" ? "รออนุมัติคำขอ" : ""),
        button(v, "เปิด", () => detail(v, r.id)));
      panel.append(c);
    }
    notificationBadges();
    if (data.nextCursor) {
      const more = button(v, "โหลดกลุ่มเพิ่มเติม", async () => { await community(v, mode, data.nextCursor); more.remove(); });
      panel.append(more);
    }
  }
  async function collections(v, kind, targetId) {
    if (kind === "group") return community(v);
    clear(v);
    if (kind === "block" && v.blockedBack) v.blockedBack.hidden = false;
    const version = v.renderVersion, data = await api(v, "/api/social/collections/" + kind);
    if (!current(v) || version !== v.renderVersion) return;
    const card = section(v, kind === "block" ? "บัญชีที่บล็อก" : "เพลย์ลิสต์ส่วนตัว");
    if (kind !== "block") {
      const f = el("form"),
        title = input(f, "ชื่อ");
      card.append(f);
      title.maxLength = 120; title.required = true;
      bindForm(
        v,
        f,
        "playlist-create",
        () => ({ title: title.value }),
        () => collections(v, kind, targetId),
      );
    }
    for (const r of data.items) {
      const c = el("article", null, { class: "social-card" });
      c.append(el("h4", r.title || r.targetId));
      if (kind === "block")
        c.append(
          button(v, "เลิกบล็อก", async () => {
            await write(v, "block", { userId: r.targetId, enabled: false });
            await collections(v, kind);
          }),
        );
      else if (targetId)
        c.append(
          button(v, "เพิ่มวิดีโอนี้", async () => {
            await write(v, "playlist-add", { recordId: r.id, targetId });
            status(v, "เพิ่มลงเพลย์ลิสต์แล้ว");
          }),
        );
      else c.append(button(v, "เปิด", () => detail(v, r.id)));
      card.append(c);
    }
  }
  async function edit(v, r) {
    clear(v);
    const c = section(v, "แก้ไขรายการ"),
      f = el("form");
    c.append(f);
    const watch = watchPost(v, r);
    const title = ["feed", "short"].includes(r.module || v.module) ? null : input(f, r.kind === "listing" ? "ชื่อสินค้า" : "ชื่อเรื่อง", "text", r.title),
      text = input(f, "เนื้อหา", "textarea", r.text),
      audience = select(
        f,
        "ผู้ที่ดูได้",
        watch ? [["public", "สาธารณะ"], ["friends", "เพื่อน"], ...(!["public", "friends"].includes(r.audience) ? [[r.audience, "สิทธิ์เดิม"]] : [])] : [
          ["public", "ผู้ใช้ที่เข้าสู่ระบบ"],
          ["followers", "ผู้ติดตาม"],
          ["private", "เฉพาะฉัน"],
        ],
        r.audience,
      );
    if (r.audience === "group") audience.disabled = true;
    let sourceType, sourceUrl;
    if (r.kind === "video") {
      sourceType = select(f, "แหล่งวิดีโอ", [["youtube", "YouTube"], ["video", "MP4 / WebM"], ["hls", "HLS (.m3u8)"]], r.source?.type || "youtube");
      sourceUrl = input(f, "ลิงก์วิดีโอ (ไม่ต้องกรอกหากแนบไฟล์)", "url", r.source?.url || ""); sourceUrl.maxLength = 2000;
    }
    const submit = bindForm(
      v,
      f,
      "edit",
      () => ({
        recordId: r.id,
        ...(sourceUrl ? { sourceType: sourceType.value, sourceUrl: sourceUrl.value } : {}),
        title: title?.value ?? r.title,
        text: text.value,
        ...(r.audience === "group" ? {} : { audience: audience.value }),
      }),
      () => feed(v),
    );
    if (feedPost(v, r)) composeActions(v, f, submit);
  }
  async function orders(v, selectedId) {
    clear(v);
    const data = await api(v, "/api/social/inbox"),
      sectionNode = section(v, "รายการซื้อขาย");
    sectionNode.append(
      el(
        "p",
        "ระบบรับคำสั่งซื้อและติดตามสถานะ ยังไม่เรียกเก็บเงินหรือจ่ายเงินให้ผู้ขายอัตโนมัติ",
      ),
    );
    for (const r of data.orders) {
      const c = el("article", null, { class: "social-card" });
      c.append(
        el("h3", r.title),
        el(
          "p",
          `${r.quantity} ชิ้น • ${r.totalSatang / 100} บาท • ${r.status}`,
        ),
      );
      for (const next of r.status === "requested"
        ? ["accepted", "cancelled"]
        : r.status === "accepted"
          ? ["fulfilled", "cancelled"]
          : []) {
        if (next !== "cancelled" && r.sellerId !== v.uid) continue;
        c.append(
          button(
            v,
            {
              accepted: "รับคำสั่งซื้อ",
              cancelled: "ยกเลิก",
              fulfilled: "ส่งมอบแล้ว",
            }[next],
            async () => {
              await write(v, "order-status", { recordId: r.id, status: next });
              await orders(v);
            },
          ),
        );
      }
      sectionNode.append(c);
      if (r.id === selectedId) { c.dataset.selectedOrder = "true"; c.style.borderColor = "#ff9f43"; c.scrollIntoView?.({ block: "nearest" }); }
    }
  }
  async function startRTC(v, r, preparedStream) {
    v.rtc.replaceChildren();
    v.rtc.hidden = false;
    v.sessionId = r.id;
    const screen = el("div", null, { class: "social-video-grid" });
    v.rtc.append(
      button(v, "วางสาย / ออกจากไลฟ์", async () => {
        await window.PanthoriumSocialRTC.stop();
        v.sessionId = null;
        v.rtc.hidden = true;
      }),
      button(v, "เปิด/ปิดไมค์", () => window.PanthoriumSocialRTC.toggleMic()),
      button(v, "เปิด/ปิดกล้อง", () =>
        window.PanthoriumSocialRTC.toggleCamera(),
      ),
      screen,
    );
    await window.PanthoriumSocialRTC.start({
      id: r.id,
      stream: preparedStream,
      kind: r.kind,
      owner: r.ownerId,
      uid: v.uid,
      video: r.video !== false,
      read: (path) => api(v, path),
      write: (action, input) => write(v, action, input),
      render: screen,
      status: (text) => status(v, text),
    });
  }
  async function call(v, r, video) {
    const out = await write(v, "call", { recordId: r.id, video });
    v.call = out.record;
    status(v, "ส่งคำเชิญโทรแล้ว รออีกฝ่ายรับสาย");
  }
  async function poll(v) {
    if (!current(v)) return;
    let groupDetailId;
    try {
      if (!v.root.hidden && v.module === "live") {
        for (const [id, comments] of v.liveComments || []) {
          if (!comments.section.isConnected) { v.liveComments.delete(id); continue; }
          if (!comments.section.hidden) await comments.load();
        }
      }
      if (["talk", "connect"].includes(v.module)) {
        const data = await api(v, "/api/social/inbox");
        if (!current(v)) return;
        v.incoming.replaceChildren();
        for (const c of data.calls) {
          if ((c.context === "connect") !== (v.module === "connect")) continue;
          if (c.status === "ringing" && c.ownerId !== v.uid) {
            const box = el("div", null, { class: "social-card" });
            box.append(
              el(
                "p",
                (c.video ? "วิดีโอคอล" : "สายโทรเข้า") + " จาก " + (c.author?.name || "สมาชิก"),
              ),
              button(v, "รับสาย", async () => {
                const result = await write(v, "call-answer", {
                  recordId: c.id,
                  accept: true,
                });
                await startRTC(v, result.record);
              }),
              button(v, "ปฏิเสธ", () =>
                write(v, "call-answer", { recordId: c.id, accept: false }),
              ),
            );
            v.incoming.append(box);
          } else if (
            c.status === "accepted" &&
            v.call?.id === c.id &&
            v.sessionId !== c.id
          )
            await startRTC(v, c);
        }
      }
      if (!v.root.hidden && !v.detail) await v.refreshThreads?.();
      if (!v.root.hidden && v.detail && (v.messageLog?.isConnected || v.groupState)) {
        const detailId = v.detail, messageLog = v.messageLog;
        if (v.groupState) groupDetailId = detailId;
        const latest = await api(
          v,
          "/api/social/records/" + encodeURIComponent(detailId),
        );
        if (!current(v) || v.detail !== detailId || v.messageLog !== messageLog) return;
        if (v.groupState) {
          if (latest.record.membership !== v.groupState.membership) { await detail(v, detailId); return; }
          v.groupState.summary.textContent = groupSummary(latest.record);
          groupRequests(v, latest.requests || []);
          if (latest.record.membership === "member") await groupMessages(v, latest);
          return;
        }
        const fingerprint = JSON.stringify(
          latest.items.map((x) => [x.id, x.deleted, x.readAt, x.author?.name]),
        );
        if (fingerprint !== v.lastMessages) {
          v.lastMessages = fingerprint;
          await renderMessages(v, latest.items, v.messageLog);
        }
        scheduleRead(v);
      }
    } catch (e) {
      if (v.groupState && v.detail === groupDetailId && e.message === "social_not_found") clear(v);
      status(v, friendly(e));
    } finally {
      if (current(v)) v.timer = setTimeout(() => poll(v), 4000);
    }
  }
  function stopSourcePlayer(box) {
    box.dataset.playing = "false"; box.querySelector("iframe")?.remove();
  }
  function sourcePlayer(v, source, parent, title, record) {
    const box = el("div", null, { class: "social-source-player", "data-social-player": "" });
    const mount = () => {
      if (box.querySelector("iframe")) return;
      const frame = el("iframe", null, {
        src: "/social-player.html#" + new URLSearchParams({ type: source.type, url: source.url, autoplay: "1", muted: "1", controls: record ? "0" : "1" }),
        title: title || "เครื่องเล่นวิดีโอ", allow: "autoplay; fullscreen; picture-in-picture; encrypted-media", allowfullscreen: "", referrerpolicy: "strict-origin-when-cross-origin",
      });
      frame.onload = () => { frame.contentWindow.postMessage({ channel: "panthorium-player", action: box.dataset.playing === "false" ? "pause" : "play", value: box.dataset.muted !== "false" }, location.origin); };
      box.prepend(frame);
    };
    parent.append(box);
    if (record) attachVideo(v, record, box, mount);
    else { const entry = { node: box, mount }; watchInline(v, entry); }
  }
  function externalLink(label, url) {
    // Only the server-validated public destination is rendered; never execute submitted HTML.
    let safe;
    try { safe = new URL(url); } catch (_) { return el("span", "ยังไม่มีลิงก์"); }
    if (safe.protocol !== "https:" || safe.username || safe.password) return el("span", "ลิงก์ไม่ถูกต้อง");
    return el("a", label, { href: safe.href, target: "_blank", rel: "noopener noreferrer" });
  }
  async function tvForm(v, record = {}) {
    clear(v);
    const panel = section(v, record.id ? "แก้ไขช่อง TV" : "เพิ่มช่อง TV สำหรับผู้ให้บริการ"), form = el("form");
    panel.append(el("p", "กรอกข้อมูลสถานีและแหล่งรับชม ผู้ดูแลจะตรวจสอบสิทธิ์และทดสอบสัญญาณก่อนเผยแพร่ช่อง"), form);
    const name = input(form, "ชื่อช่อง", "text", record.name || ""), provider = input(form, "ผู้ให้บริการ / สถานี", "text", record.provider || "");
    name.required = provider.required = true; name.maxLength = 100; provider.maxLength = 120;
    const number = input(form, "หมายเลขช่อง (ถ้ามี)", "text", record.number || ""); number.maxLength = 10;
    const category = input(form, "หมวดรายการ", "text", record.category || "ทั่วไป"); category.maxLength = 80;
    const website = input(form, "เว็บไซต์ทางการ / หน้าชมสด", "url", record.websiteUrl || ""); website.required = true; website.maxLength = 2000;
    const schedule = input(form, "ลิงก์ผังรายการ (ถ้ามี)", "url", record.scheduleUrl || ""); schedule.maxLength = 2000;
    const type = select(form, "รูปแบบการรับชม", [["website", "เปิดเว็บไซต์สถานี"], ["youtube", "YouTube Live / วิดีโอ"], ["hls", "HLS (.m3u8)"], ["video", "MP4 / WebM"]], record.source?.type || "website");
    const url = input(form, "ลิงก์สัญญาณ / วิดีโอ", "url", record.source?.type === "website" ? "" : record.source?.url || ""); url.maxLength = 2000;
    const syncSource = () => { url.required = type.value !== "website"; url.parentElement.hidden = type.value === "website"; }; type.onchange = syncSource; syncSource();
    const contact = input(form, "ช่องทางติดต่อผู้ให้บริการ (เฉพาะผู้ดูแลเห็น)", "text", record.contact || ""); contact.required = true; contact.maxLength = 200;
    const guide = el("details"), summary = el("summary", "วิธีเชื่อมต่อช่องและข้อกำหนดสัญญาณ");
    guide.append(summary, el("p", "เว็บไซต์: ใช้หน้าชมสดทางการ ไม่ต้องดึงสัญญาณจากหน้าเว็บ • YouTube: ใช้ลิงก์วิดีโอหรือ Live ที่เปิดให้ฝัง • HLS: ให้สถานีส่ง HTTPS .m3u8 และเปิด CORS ให้ Panthorium รวมถึงไฟล์ย่อย • ช่องที่ต้องล็อกอิน ชำระเงิน หรือใช้ DRM ให้เปิดผ่านเว็บไซต์ผู้ให้บริการ"),
      externalLink("คู่มือฝังวิดีโอ YouTube", "https://developers.google.com/youtube/player_parameters"), el("p", "การแก้ไขช่องจะส่งให้ตรวจสอบอีกครั้ง ลิงก์ต้องเปิดรับชมได้โดยไม่ส่งรหัสผ่านหรือ stream key"));
    form.append(guide);
    const rights = input(form, "ฉันเป็นผู้ให้บริการหรือได้รับอนุญาตให้เผยแพร่ช่องและใช้สัญญาณนี้", "checkbox"); rights.required = true;
    const preview = el("div");
    form.append(button(v, "ทดสอบการรับชม", () => {
      preview.replaceChildren();
      if (type.value === "website") preview.append(externalLink("เปิดหน้าชมสด", website.value));
      else sourcePlayer(v, { type: type.value, url: url.value }, preview, name.value || "ทดสอบช่อง");
    }), preview);
    const submit = bindForm(v, form, "tv-save", () => ({
      ...(record.id ? { recordId: record.id } : {}), name: name.value, provider: provider.value, number: number.value,
      category: category.value, websiteUrl: website.value, scheduleUrl: schedule.value,
      sourceType: type.value, sourceUrl: type.value === "website" ? website.value : url.value,
      contact: contact.value, rightsConfirmed: rights.checked,
    }), async () => { v.tvMode = "mine"; v.search.value = ""; await tvCatalog(v); status(v, "ส่งช่องแล้ว รอผู้ดูแลตรวจสอบก่อนเผยแพร่"); });
    submit.textContent = "ส่งช่องให้ตรวจสอบ";
    form.append(button(v, "ยกเลิก", () => tvCatalog(v)));
  }
  async function tvCatalog(v, before) {
    if (!before) { clear(v); status(v, ""); v.tvProviders = new Set(); }
    const version = v.renderVersion, mode = v.tvMode || "all";
    const data = await api(v, "/api/social/feed/tv?" + new URLSearchParams({ query: v.search.value, mode, ...(before ? { before } : {}) }));
    if (!current(v) || version !== v.renderVersion) return;
    if (!before) section(v, "TV · ทีวีสด").append(el("p", "เลือกช่องฟรีทีวีแล้วกดเล่นได้เลย • เครื่องเล่น TrueID อาจเริ่มแบบปิดเสียง แตะเปิดเสียงในเครื่องเล่นเพื่อรับฟัง"));
    if (!data.items.length && !before) section(v, mode === "mine" ? "ยังไม่มีช่องของคุณ" : mode === "review" ? "ไม่มีช่องรอตรวจสอบ" : "ไม่พบช่องในรายการนี้");
    const grid = el("div", null, { class: "social-tv-grid" }); v.content.append(grid);
    for (const channel of data.items) {
      if (mode === "providers") {
        if (v.tvProviders.has(channel.provider)) continue;
        v.tvProviders.add(channel.provider);
        grid.append(button(v, channel.provider, () => { v.tvMode = "all"; v.search.value = channel.provider; return tvCatalog(v); }));
        continue;
      }
      const card = el("article", null, { class: "social-card", "data-tv-channel": channel.id });
      card.append(el("h3", channel.name + (channel.number ? " · " + channel.number : "")), el("p", channel.provider + " · " + channel.category));
      if (channel.source.type === "trueid") card.append(el("small", "พร้อมดูในแอป · เครื่องเล่น TrueID"));
      if (mode === "mine" || mode === "review") card.append(el("p", "สถานะ: " + ({ pending: "รอตรวจสอบ", approved: "เผยแพร่แล้ว", rejected: "ไม่ผ่านการตรวจสอบ" }[channel.status] || channel.status)));
      if (channel.reviewNote) card.append(el("p", "หมายเหตุ: " + channel.reviewNote));
      if (channel.source.type !== "website") sourcePlayer(v, channel.source, card, channel.name);
      const links = el("div", null, { class: "social-tv-links" });
      links.append(externalLink(channel.source.type === "website" ? "▶ ชมสดที่เว็บไซต์สถานี" : "เปิดเว็บไซต์ต้นทาง", channel.websiteUrl));
      if (channel.scheduleUrl) links.append(externalLink("ผังรายการ", channel.scheduleUrl));
      card.append(links);
      if (channel.status === "approved") card.append(button(v, channel.favorite ? "★ ลบจากช่องโปรด" : "☆ เพิ่มช่องโปรด", async () => {
        await write(v, "tv-favorite", { recordId: channel.id, enabled: !channel.favorite }); await tvCatalog(v);
      }));
      if (channel.canEdit) card.append(button(v, "แก้ไขช่อง", () => tvForm(v, channel)));
      if (data.canReview && mode === "review") {
        card.append(el("p", "ติดต่อ: " + channel.contact), el("p", "ตรวจสอบสิทธิ์กับผู้ให้บริการและทดสอบสัญญาณก่อนอนุมัติ"));
        const note = input(card, "หมายเหตุการตรวจสอบ"); note.maxLength = 1000;
        for (const [state, label] of [["approved", "อนุมัติช่อง"], ["rejected", "ไม่อนุมัติ"]]) card.append(button(v, label, async () => {
          await write(v, "tv-review", { recordId: channel.id, status: state, reviewNote: note.value }); await tvCatalog(v);
        }));
      }
      if (channel.canEdit || (data.canReview && !channel.official)) card.append(button(v, "ลบช่อง", async () => {
        if (!window.confirm("ลบช่อง " + channel.name + " ออกจากรายการหรือไม่?")) return;
        await write(v, "tv-delete", { recordId: channel.id }); await tvCatalog(v);
      }));
      grid.append(card);
    }
    if (data.nextCursor) v.content.append(button(v, "โหลดช่องเพิ่มเติม", () => tvCatalog(v, data.nextCursor)));
  }
  async function feed(v, before, mode) {
    if (v.module === "tv") return tvCatalog(v, before);
    if (v.module === "community") return community(v);
    if (v.module === "notifications") return notificationPage(v);
    if (v.module === "friends") return people(v);
    if (mode) v.feedMode = mode;
    if (!before) {
      clear(v);
      v.detail = null;
      v.messageLog = null;
    }
    const version = v.renderVersion;
    const data = await api(
      v,
      "/api/social/feed/" +
        v.module +
        "?query=" +
        encodeURIComponent(v.search.value) +
        (v.module === "connect" && v.feedMode === "chats" ? "&mode=chats" : "") +
        (before ? "&before=" + encodeURIComponent(before) : ""),
    );
    if (!current(v) || version !== v.renderVersion) return;
    if (data.optInRequired) {
      section(v, "Connect ยังไม่ได้เปิดใช้").append(
        button(v, "ตั้งค่า Connect 18+", () => connectSettings(v)),
      );
      return;
    }
    if (!data.items.length && !before)
      section(v, "ยังไม่มีรายการ").append(
        el("p", "เริ่มสร้างรายการของคุณ หรือค้นหาผู้ใช้เพื่อเชื่อมต่อ"),
      );
    v.videoNextCursor = data.nextCursor;
    for (const r of data.items) {
      if (!current(v) || version !== v.renderVersion) return;
      await card(v, r, v.content);
    }
    if (!current(v) || version !== v.renderVersion) return;
    notificationBadges(); scheduleRead(v);
    if (data.nextCursor)
      v.content.append(
        button(v, "โหลดรายการก่อนหน้า", async () => {
          await feed(v, data.nextCursor);
        }),
      );
    if (v.module === "talk" && !before) {
      let signature = JSON.stringify(data);
      const query = v.search.value;
      v.refreshThreads = async () => {
        const latest = await api(v, "/api/social/feed/talk?query=" + encodeURIComponent(query));
        if (!current(v) || v.renderVersion !== version || v.detail || v.search.value !== query) return;
        if (JSON.stringify(latest) === signature) return;
        signature = JSON.stringify(latest);
        const focused = document.activeElement?.closest("[data-record-id]")?.dataset.recordId;
        const scroll = v.root.scrollTop;
        v.content.replaceChildren();
        for (const r of latest.items) await card(v, r, v.content);
        if (!latest.items.length) section(v, "ยังไม่มีรายการ");
        if (latest.nextCursor) v.content.append(button(v, "โหลดรายการก่อนหน้า", () => feed(v, latest.nextCursor)));
        if (focused) [...v.content.querySelectorAll("[data-record-id]")].find(c => c.dataset.recordId === focused)?.querySelector("button")?.focus({ preventScroll: true });
        v.root.scrollTop = scroll; notificationBadges();
      };
    } else if (before) v.refreshThreads = null;
  }
  async function support(v) {
    clear(v);
    status(v, "กำลังเปิดแชทกับแอดมิน…");
    const result = await api(v, "/api/social/support", { method: "POST" });
    if (result.inbox) await feed(v);
    else await detail(v, result.record.id);
    status(v, "");
  }
  function disposeWorkspace() {
    for (const v of views.values()) {
      v.pendingCamera?.getTracks().forEach(track => track.stop());
      v.viewer?.close(); v.autoplayObserver?.disconnect();
      v.controller.abort(); clearTimeout(v.timer); clearTimeout(v.readTimer); v.readObserver?.disconnect();
      for (const url of v.urls) URL.revokeObjectURL(url);
      if (v.sessionId) window.PanthoriumSocialRTC?.stop();
    }
    views.clear(); workspace?.controller.abort(); workspace = null;
  }
  function ensureWorkspace() {
    if (workspace && current(workspace)) return workspace;
    if (workspace) disposeWorkspace();
    const markup = `<div class="social-shell"><style>
      .social-shell{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--text,#edf2f7);background:#0b131d;overflow:hidden}
      .social-shell *{box-sizing:border-box}.social-shell [hidden]{display:none!important}
      .social-shell button,.social-shell input,.social-shell select,.social-shell textarea{font:inherit;color:inherit;background:#152332;border:1px solid #33495b;border-radius:10px;padding:9px;max-width:100%}
      .social-shell button{cursor:pointer;min-height:40px;margin:3px}.social-shell button:hover{border-color:#ff9d4d}.social-shell button:focus-visible,.social-shell summary:focus-visible{outline:2px solid #ffb26e;outline-offset:2px}.social-shell button:disabled{opacity:.5}
      .social-tabs{display:flex;flex:0 0 auto;flex-wrap:nowrap;gap:5px;overflow-x:auto;overflow-y:hidden;padding:8px 12px 6px;border-bottom:1px solid #263b4b;background:#0e1d2a;scrollbar-width:thin;scrollbar-color:#6b8ba1 #101b26}
      .social-tabs button{white-space:nowrap;flex:0 0 auto;min-height:42px;margin:0;padding:9px 14px;border:1px solid transparent;background:transparent;font-weight:600}
      .social-tabs button[aria-selected=true]{background:#263343;border-color:#ee984e;color:#ffbf88}.social-tabs button:last-child{color:#bed0df}
      .social-pages{flex:1;min-height:0;overflow:hidden}.social-app{height:100%;overflow:auto;padding:12px 18px 24px;scrollbar-width:thin;scrollbar-color:#496779 #101923}
      .social-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 8px}.social-toolbar form{display:flex;gap:5px;align-items:center}.social-toolbar form label{margin:0}.social-toolbar input{min-width:100px;width:230px!important;margin:0!important}.social-toolbar form button{margin:0}.social-toolbar .social-tools{margin-left:auto}
      .social-tools{position:relative}.social-tools summary,.social-activity summary{cursor:pointer;padding:9px 12px;border-radius:9px;background:#142433;color:#c2d4e3;min-height:40px}.social-tools>div{padding:10px;max-width:360px}
      .social-app label{display:block;margin:10px 0}.social-app label input:not([type=checkbox]),.social-app textarea,.social-app select{display:block;width:100%;margin-top:5px}.social-app textarea{min-height:90px;resize:vertical}.social-app option{background:#152332;color:#fff}
      .social-app label.social-checkbox{display:flex;align-items:flex-start;gap:12px;min-height:36px;padding:4px 0;cursor:pointer}
      .social-app label.social-checkbox input[type=checkbox]{flex:0 0 20px;width:20px;height:20px;min-width:20px;margin:3px 0 0;padding:0;accent-color:#ff9f43;cursor:pointer}
      .social-app label.social-checkbox span{min-width:0;line-height:1.65;overflow-wrap:anywhere}
      .social-card{border:1px solid #2b4052;border-radius:14px;padding:16px;margin:12px 0;background:#101c28;min-width:0}.social-card h3,.social-card h4{margin:0 0 10px;overflow-wrap:anywhere}.social-card p,.social-message p{white-space:pre-wrap;overflow-wrap:anywhere}.social-card strong{overflow-wrap:anywhere}
      .social-record-tools{margin-top:12px}.social-record-tools summary{cursor:pointer;color:#acbfce;padding:6px 0}
      .social-post-actions{display:flex;align-items:center;gap:6px;min-width:0}.social-post-actions>button{margin:0}.social-post-menu{position:relative;margin-left:auto;flex:0 0 auto}
      .social-post-menu>summary{display:flex;align-items:center;justify-content:center;list-style:none;cursor:pointer;font-size:25px;line-height:1;width:42px;height:40px;border:1px solid #33495b;border-radius:10px;background:#152332}.social-post-menu>summary::-webkit-details-marker{display:none}
      .social-post-menu-items{position:absolute;right:0;top:calc(100% + 5px);z-index:20;width:250px;max-width:calc(100vw - 48px);max-height:280px;overflow:auto;padding:6px;background:#152332;border:1px solid #496779;border-radius:12px;box-shadow:0 12px 28px #0009}.social-post-menu-items button{display:block;width:100%;text-align:left;margin:0;padding:10px;border:0;background:transparent}.social-post-menu-items button:hover{background:#263343}
      .social-compose-actions,.social-comment-actions{display:flex;align-items:center;gap:8px}.social-compose-actions>button:last-child{margin-left:auto}
      .social-comments{border-top:1px solid #304252;margin-top:16px;padding-top:12px}.social-message{padding:12px;border-bottom:1px solid #304252}.social-app small{color:#acbfce;overflow-wrap:anywhere}.social-app [role=status]{color:#ffb26e}.social-app [role=status]:empty{display:none}
      .social-thread-log{display:flex;flex-direction:column;gap:10px;margin:16px 0}.social-thread-log .social-message{border:1px solid #304252;border-radius:14px;max-width:85%;min-width:0;align-self:flex-start;background:#172634}.social-thread-log .social-message[data-direction=outgoing]{align-self:flex-end;background:#203e55;border-color:#3d647f}.social-thread-log .social-message p{margin:8px 0}.social-chat-preview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.social-toolbar [data-group-menu]::after{content:' ▾'}.social-toolbar [data-group-menu][aria-expanded=true]{border-color:#ee984e;background:#263343}.social-toolbar .social-back{margin-left:auto}
      .social-source-player iframe{display:block;border:0;width:100%;height:clamp(220px,45vw,500px);background:#09111a;border-radius:10px}.social-tv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}.social-tv-grid .social-card{margin:0}.social-tv-links{display:flex;flex-wrap:wrap;gap:8px}.social-tv-links a{display:inline-block;padding:10px;border:1px solid #496779;border-radius:9px;background:#172634;color:#c4e5ff;text-decoration:none}.social-tv-links a:hover{background:#263e51}.social-tv-links a:focus-visible{outline:2px solid #ff9f43;outline-offset:2px}.social-source-player+a{display:inline-block;color:#a4d5ff;margin:8px 0}.social-media{margin:10px 0}.social-media img,.social-media video{display:block;max-width:100%;max-height:560px;border-radius:10px}.social-media audio{max-width:100%}.social-media pre{white-space:pre-wrap;max-height:420px;overflow:auto}
      .social-video-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.social-video-grid video{width:100%;max-height:400px;background:#000}
      .social-message-receipt{display:inline-block;margin:4px 8px;color:#9bb1c9;font-size:18px;font-weight:600}.social-message-receipt[data-delivery=read]{letter-spacing:-6px;padding-right:6px;color:#66d0ff}
      .social-activity{border-bottom:1px solid #263b4b;margin-bottom:10px}.social-activity summary{background:transparent;padding:7px 3px;min-height:32px;font-size:13px}.social-activity article{padding:10px;border-bottom:1px solid #263b4b}.social-activity article[data-unread=true]{border-left:3px solid #ff9f43}.social-activity p{margin:4px 0}.social-activity [data-activity-items]{max-height:330px;overflow:auto}
      @media(max-width:540px){.social-app{padding:10px}.social-tabs{padding:6px 8px}.social-tabs button{padding:8px 11px}.social-card{padding:12px}.social-toolbar{align-items:stretch}.social-toolbar form{flex:1 1 100%;min-width:0}.social-toolbar form label{flex:1;min-width:0}.social-toolbar input{min-width:0;width:100%!important}.social-tools{margin-left:0!important}}

      .social-search{display:flex;align-items:center;gap:4px;max-width:100%}.social-toolbar .social-search form{position:relative;flex:0 1 300px;width:300px;max-width:calc(100vw - 85px)}.social-toolbar .social-search input{width:100%!important;padding-right:65px;margin:0!important}.social-search form button{position:absolute;right:3px;top:3px;bottom:3px;min-height:0;border:0;background:transparent;padding:4px 8px}.social-attachments{position:relative}.social-attachments summary{width:42px;height:42px;display:grid;place-items:center;font-size:28px;cursor:pointer;list-style:none;border:1px solid #33495b;border-radius:10px}.social-attachment-menu{position:absolute;z-index:25;display:flex;flex-direction:column;padding:6px;background:#152332;border:1px solid #496779;border-radius:12px}.social-file-picker{width:min(90vw,540px);max-height:80vh;overflow:auto;background:#101c28;color:#edf2f7;border:1px solid #496779;border-radius:14px;padding:20px}.social-file-picker::backdrop{background:#0009}.social-card[role=button]{cursor:pointer}.social-card[role=button]:focus-visible{outline:2px solid #ffb26e}.social-notification-badge{vertical-align:middle}

      .social-source-player{position:relative;min-height:220px;background:#000}.social-video-open{position:absolute;inset:0;width:100%;height:100%;margin:0!important;opacity:0;z-index:2}.social-media video{cursor:pointer;width:100%}.social-viewer{position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;max-height:none;margin:0;padding:0;border:0;background:#000;color:#fff;overflow:hidden}.social-viewer::backdrop{background:#000}.social-viewer-stage,.social-video-surface,.social-video-hud{position:absolute;inset:0}.social-viewer-stage video,.social-viewer-stage .social-source-player,.social-viewer-stage iframe{width:100%;height:100%;max-height:none;border-radius:0;object-fit:contain}.social-viewer-stage .social-video-open{display:none}.social-video-surface{z-index:2;touch-action:none}.social-video-hud{z-index:3;pointer-events:none}.social-video-hud button,.social-video-hud input{pointer-events:auto}.social-viewer button{background:transparent!important;border:0!important;color:#fff;font-size:24px;text-shadow:0 2px 5px #000;min-width:44px;min-height:44px}.social-video-back{position:absolute;top:max(12px,env(safe-area-inset-top));left:12px}.social-video-side{position:absolute;top:max(20px,env(safe-area-inset-top));right:12px;display:flex;align-items:center;flex-direction:column;gap:15px}.social-video-avatar{border-radius:50%;width:48px;height:48px;padding:0!important;overflow:hidden}.social-video-avatar img{width:100%;height:100%;object-fit:cover}.social-video-bottom{position:absolute;bottom:max(12px,env(safe-area-inset-bottom));left:12px;right:12px}.social-viewer .social-video-description{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;font-size:15px;text-align:left;max-width:calc(100% - 65px);padding:6px;line-height:1.5}.social-video-transport{display:flex;align-items:center;gap:8px;text-shadow:0 1px 4px #000}.social-video-transport input{min-width:0;flex:1;accent-color:#ff9f43;padding:0!important}.social-video-transport span{font-size:12px;white-space:nowrap}.social-video-drawer{position:absolute;z-index:5;bottom:0;left:0;right:0;max-height:72%;overflow:auto;padding:18px;background:#101c28;color:#edf2f7}.social-video-drawer>button:first-child{float:right}.social-video-drawer button{font-size:16px}.social-video-drawer p{white-space:pre-wrap;overflow-wrap:anywhere}.social-liked::after{content:'♥';position:absolute;top:42%;left:42%;color:#ff496c;font-size:90px;filter:drop-shadow(0 2px 10px #000)}
    </style><nav class="social-tabs" role="tablist" aria-label="Social Media"></nav><div class="social-pages"></div></div>`;
    if (typeof window.createWindow !== "function") throw Error("window_system_unavailable");
    window.createWindow(WINDOW_ID, "Social Media", markup, { width: 1040, height: 740, onClose: disposeWorkspace });
    const root = document.querySelector('.window[data-id="' + WINDOW_ID + '"] .social-shell');
    if (!root) throw Error("window_system_unavailable");
    const shell = workspace = { uid: uid(), root, controller: new AbortController() };
    const nav = root.querySelector(".social-tabs");
    for (const [id, label, thai] of specs) {
      const tab = button(shell, id === "notifications" ? "🔔 " + label : label, () => open(id));
      tab.dataset.socialTab = id; tab.id = "social-tab-" + id;
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "social-page-" + id); tab.setAttribute("aria-selected", "false"); tab.title = thai;
      tab.append(moduleBadge(id)); nav.append(tab);
    }
    const refresh = button(shell, "↻", () => refreshView(views.get(workspace?.active)));
    refresh.title = "รีเฟรชเมนูที่เปิดอยู่"; refresh.setAttribute("aria-label", "Refresh"); refresh.dataset.socialRefresh = ""; nav.append(refresh);
    nav.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || event.target.getAttribute("role") !== "tab") return;
      event.preventDefault(); const tabs = [...nav.querySelectorAll('[role="tab"]')], index = tabs.indexOf(event.target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
    notificationBadges();
    return shell;
  }
  function activate(module) {
    const shell = ensureWorkspace(); shell.active = module;
    shell.root.closest(".window").dataset.socialActive = module;
    for (const [id, v] of views) {
      v.root.hidden = id !== module;
      if (id === module) v.updatePlayback?.();
      if (id !== module) { v.viewer?.close(); v.root.querySelectorAll("[data-social-player]").forEach(stopSourcePlayer); }
      if (id !== module) v.root.querySelectorAll("video,audio").forEach(media => { if (!media.srcObject) media.pause(); });
    }
    for (const tab of shell.root.querySelectorAll("[data-social-tab]")) {
      const selected = tab.dataset.socialTab === module;
      tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    shell.root.querySelector('[data-social-tab="' + module + '"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    window.PanthoriumWindowManager?.restore?.(WINDOW_ID); window.focusWindow?.(WINDOW_ID);
  }
  function moduleTools(v) {
    const toolbar = v.root.querySelector("[data-social-toolbar]");
    v.search = el("input"); v.search.value = "";
    if (v.module !== "notifications") {
      const box = el("div", null, { class: "social-search" });
      const toggle = button(v, "", () => { form.hidden = !form.hidden; toggle.setAttribute("aria-expanded", String(!form.hidden)); if (!form.hidden) q.focus(); });
      toggle.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15 15 6 6" stroke="currentColor" stroke-width="2"/></svg>';
      toggle.setAttribute("aria-label", "ค้นหา"); toggle.setAttribute("aria-expanded", "false");
      const form = el("form", null, { hidden: "", role: "search" }), q = el("input", null, { type: "search", "aria-label": "ค้นหารายการ", placeholder: "ค้นหาใน " + specs.find(s => s[0] === v.module)[1] });
      const submit = el("button", "ค้นหา", { type: "submit" }); v.search = q; form.append(q, submit);
      form.onsubmit = event => { event.preventDefault(); feed(v).catch(error => status(v, friendly(error))); };
      form.addEventListener("keydown", event => { if (event.key === "Escape") { form.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); } });
      box.append(toggle, form); toolbar.append(box);
    }
    if (["feed", "short", "watch", "market"].includes(v.module)) toolbar.append(button(v, v.module === "market" ? "ลงสินค้า" : ["short", "watch"].includes(v.module) ? "โพสต์วิดีโอ" : "สร้างโพสต์", () => compose(v)));
    if (["live", "market", "talk"].includes(v.module)) toolbar.append(button(v, "รายการทั้งหมด", () => feed(v)));
    if (["short", "watch"].includes(v.module)) toolbar.append(button(v, "เพลย์ลิสต์", () => collections(v, "playlist")));
    if (v.module === "tv") {
      for (const [mode, label] of [["all", "ช่องทั้งหมด"], ["favorites", "ช่องโปรด"], ["providers", "ผู้ให้บริการ"], ["mine", "ช่องของฉัน"]])
        toolbar.append(button(v, label, () => { v.tvMode = mode; v.search.value = ""; return tvCatalog(v); }));
      toolbar.append(button(v, "เพิ่มช่อง TV", () => tvForm(v)));
      if (os().state.user.roles?.includes("administrator") && os().state.user.permissions?.includes("settings"))
        toolbar.append(button(v, "ตรวจสอบช่อง", () => { v.tvMode = "review"; return tvCatalog(v); }));
    }
    if (v.module === "community") {
      v.communityButtons = ["mine", "all", "create"].map((mode, i) => {
        const b = button(v, ["กลุ่มของฉัน", "กลุ่มทั้งหมด", "สร้างกลุ่ม"][i], () => {
          if (b.getAttribute("aria-expanded") === "true") { clear(v); return; }
          return community(v, mode);
        });
        b.dataset.groupMenu = mode; b.setAttribute("aria-label", b.textContent); b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", "social-community-panel");
        toolbar.append(b); return b;
      });
    }
    if (v.module === "talk") toolbar.append(button(v, "ค้นหาเพื่อน", () => open("friends")));
    if (v.module === "market") toolbar.append(button(v, "รายการซื้อขาย", () => orders(v)));
    if (v.module === "connect") {
      toolbar.append(button(v, "ตั้งค่า Connect", () => connectSettings(v)), button(v, "ค้นหาคู่", () => feed(v, null, "discover")), button(v, "บทสนทนา Connect", () => feed(v, null, "chats")));
    }

    if (["profile", "friends"].includes(v.module)) toolbar.append(button(v, "บัญชีที่บล็อก", () => collections(v, "block")));
    if (v.module === "live") toolbar.append(button(v, "เริ่มไลฟ์", async () => {
      clear(v); const form = el("form"), title = input(form, "ชื่อไลฟ์");
      section(v, "เริ่มถ่ายทอดสด • ผู้ชมพร้อมกันสูงสุด 8 คน").append(form);
      title.maxLength = 200;
      const audience = select(form, "ผู้ที่ดูได้", [["public", "สาธารณะ"]]); audience.disabled = true;
      let camera;
      const submit = bindForm(v, form, "live-start", async () => {
        if (!navigator.mediaDevices?.getUserMedia) throw Error("กรุณาเปิดผ่าน HTTPS และอนุญาตกล้อง/ไมโครโฟน");
        // Acquire permission before publishing a live room, so a permission dialog cannot expire it.
        camera?.getTracks().forEach(track => track.stop());
        try { camera = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20 } } }); }
        catch (e) { throw Error(e.name === "NotAllowedError" ? "กรุณาอนุญาตกล้อง/ไมโครโฟนในตั้งค่าแอปหรือเบราว์เซอร์" : "เปิดกล้องไม่ได้ กรุณาปิดแอปอื่นที่ใช้กล้องแล้วลองอีกครั้ง"); }
        if (!current(v) || !form.isConnected || v.root.hidden) { camera.getTracks().forEach(track => track.stop()); camera = null; throw Error("ยกเลิกการเปิดกล้องแล้ว กรุณาเริ่มไลฟ์ใหม่"); }
        v.pendingCamera = camera;
        return { title: title.value };
      }, async out => {
        try { await startRTC(v, out.record, camera); v.pendingCamera = null; camera = null; await detail(v, out.record.id); }
        catch(e) { v.sessionId = null; v.rtc.hidden = true; throw e; }
      });

      submit.textContent = "เริ่มถ่ายทอดสด"; composeActions(v, form, submit);
    }));
    if (v.module === "profile") {
      toolbar.append(button(v, "ตั้งค่าโปรไฟล์", () => profileSettings(v)));
      toolbar.append(toolbar.querySelector(".social-search"));
      v.blockedBack = button(v, "กลับ", () => feed(v));
      v.blockedBack.className = "social-back"; v.blockedBack.hidden = true; toolbar.append(v.blockedBack);
    }
  }
  async function refreshView(v) {
    if (!v || !current(v)) return;
    if (v.detail) await detail(v, v.detail);
    else if (v.module === "notifications") await notificationPage(v);
    else if (v.module === "friends") await people(v);
    else if (v.module === "community") await community(v, v.communityMode || "mine");
    else await feed(v);
    await refreshNotifications();
  }
  async function open(module = "feed", options = {}) {
    if (!allowed()) throw Error("account_required");
    if (!specs.some(s => s[0] === module)) throw Error("social_invalid_module");
    const shell = ensureWorkspace();
    let v = views.get(module), created = false;
    if (!v || !current(v)) {
      created = true;
      const root = el("div", null, { class: "social-app", "data-social": module, id: "social-page-" + module, role: "tabpanel", "aria-labelledby": "social-tab-" + module });
      root.innerHTML = '<div class="social-toolbar" data-social-toolbar></div><p role="status" aria-live="polite"></p><div data-social-incoming></div><section data-social-rtc hidden></section><div data-social-content></div>';
      shell.root.querySelector(".social-pages").append(root);
      v = { uid: uid(), root, module, controller: new AbortController(), urls: new Set(), sourceFileIds: [], status: root.querySelector("[role=status]"), content: root.querySelector("[data-social-content]"), incoming: root.querySelector("[data-social-incoming]"), rtc: root.querySelector("[data-social-rtc]") };
      views.set(module, v); moduleTools(v);
      root.addEventListener("scroll", () => scheduleRead(v), { capture: true, signal: v.controller.signal });
      root.addEventListener("pointerup", () => scheduleRead(v), { signal: v.controller.signal });
      document.addEventListener("pointerdown", event => {
        root.querySelectorAll(".social-post-menu[open]").forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
      }, { signal: v.controller.signal });
      window.addEventListener("focus", () => scheduleRead(v), { signal: v.controller.signal });
      document.addEventListener("visibilitychange", () => { scheduleRead(v); if (document.visibilityState === "hidden") v.viewer?.pause(); v.updatePlayback?.(); }, { signal: v.controller.signal });
    }
    activate(module);
    v.noticeThrough = new Date().toISOString();
    try {
      if (options.support) await support(v);
      else if (options.orders) await orders(v, options.recordId);
      else if (options.personId) await people(v);
      else if (options.recordId) await detail(v, options.recordId);
      else if (options.sourceFileIds) {
        v.sourceFileIds = options.sourceFileIds;
        if (module === "community") { await collections(v, "group"); status(v, "เลือกกลุ่มที่เป็นสมาชิกเพื่อแนบไฟล์ในแชต"); }
        else await compose(v);
      }
      else if (created) await refreshView(v);
    } catch (error) { status(v, friendly(error)); }
    if (created && ["talk", "live", "community", "connect"].includes(module)) poll(v);
    if (!created && v.module === "friends") await v.refreshFriends?.();
    if (!created && v.module === "notifications") await notificationPage(v);
    notificationBadges(); loadActivity(v); scheduleRead(v);
    return v.root;
  }
  let notificationState;
  function notificationStyles() {
    if (document.getElementById("social-notification-style")) return;
    document.head.append(el("style", '.social-notification-badge{display:inline-block;flex:0 0 auto!important;width:auto!important;min-width:19px;max-width:max-content;padding:1px 5px;margin-left:6px;border-radius:20px;background:#ff9f43;color:#101820;font:700 11px/18px system-ui;text-align:center}.social-notification-badge[hidden]{display:none!important}', { id: "social-notification-style" }));
  }
  const moduleBadge = module => el("span", "", { class: "social-notification-badge", "data-social-module-count": module, hidden: "" });
  const recordBadge = id => el("span", "", { class: "social-notification-badge", "data-social-record-count": id, hidden: "" });
  const notificationBadge = () => el("span", "", { class: "social-notification-badge", "data-social-notification-count": "", hidden: "" });
  function notificationBadges() {
    const data = allowed() ? notificationState?.data || {} : {};
    for (const node of document.querySelectorAll("[data-social-notification-count],[data-social-module-count],[data-social-record-count]")) {
      const aggregate = node.hasAttribute("data-social-notification-count");
      const count = Math.max(0, Number(node.hasAttribute("data-social-record-count") ? data.recordCounts?.[node.dataset.socialRecordCount] : aggregate ? data.unreadCount : data.counts?.[node.dataset.socialModuleCount]) || 0);
      node.textContent = count > 99 ? "99+" : String(count); node.hidden = count === 0;
      node.setAttribute("aria-label", count + " การแจ้งเตือนยังไม่อ่าน");
    }
  }
  async function acknowledgeActivity(v) {
    if (v.activityReadBusy || !current(v) || v.root.hidden || document.visibilityState !== "visible" || !document.hasFocus()) return;
    const module = v.module;
    let recordIds;
    if (["feed", "short", "watch", "live", "market"].includes(module)) recordIds = [...v.content.querySelectorAll("[data-record-id]")].filter(row => messageVisible(v, row, v.content)).map(row => row.dataset.recordId);
    else if (["talk", "community"].includes(module)) recordIds = v.detail ? [v.detail] : [];
    else if (!["notifications", "friends", "connect"].includes(module)) return;
    if (recordIds && !recordIds.length) return;
    const data = notificationState?.data;
    if (!data?.counts?.[module]) return;
    const through = v.noticeThrough || new Date().toISOString();
    v.activityReadBusy = true;
    try {
      await api(v, "/api/social/notifications/read-section", { method: "POST", body: JSON.stringify({ module, recordIds: recordIds?.slice(0,100), through }) });
      await refreshNotifications();
    } catch (_) { /* Retry without clearing an unconfirmed count. */ }
    finally { v.activityReadBusy = false; }
  }
  async function readNotifications(v, ids) {
    if (!ids.length) return;
    await api(v, "/api/social/notifications/read", { method: "POST", body: JSON.stringify({ ids }) });
    await refreshNotifications();
  }
  async function notificationPage(v, before) {
    if (!before) { clear(v); v.noticeThrough = new Date().toISOString(); }
    const data = await api(v, "/api/social/notifications?module=notifications" + (before ? "&before=" + encodeURIComponent(before) : ""));
    if (!current(v)) return;
    if (!before) v.lastNotice = data.items[0]?.id || null;
    if (!data.items.length && !before) section(v, "ยังไม่มีการแจ้งเตือน");
    // Social interactions are prominent; service/moderation notices remain reachable separately.
    let other;
    for (const item of data.items) {
      let parent = v.content;
      if (!["like", "comment", "share"].includes(item.type)) {
        if (!other) { other = el("details"); other.append(el("summary", "กิจกรรมอื่นและการดูแลชุมชน")); v.content.append(other); }
        parent = other;
      }
      const row = el("article", null, { class: "social-card", "data-notification-id": item.id, "data-unread": String(!item.readAt) });
      row.append(el("p", item.name + " • " + item.text), el("small", new Date(item.createdAt).toLocaleString("th-TH")));
      if (item.reason) row.append(el("p", item.reason));
      if (item.target) {
        row.tabIndex = 0; row.setAttribute("role", "button");
        const go = async () => { if (!item.readAt) await readNotifications(v, [item.id]); await open(item.target.module, item.target); };
        row.addEventListener("click", () => go().catch(e => status(v, friendly(e))));
        row.addEventListener("keydown", e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); row.click(); } });
      }
      parent.append(row);
    }
    if (data.nextCursor) v.content.append(button(v, "รายการก่อนหน้า", () => notificationPage(v, data.nextCursor)));
    await acknowledgeActivity(v);
  }
  async function loadActivity(v) { if (v && current(v)) scheduleRead(v); }
  async function refreshNotifications() {
    const n = notificationState;
    if (!n || !current(n)) return;
    if (n.polling) return n.polling;
    clearTimeout(n.timer);
    n.polling = (async () => {
      try {
        const data = await api(n, "/api/social/notifications");
        if (!current(n) || n !== notificationState) return;
        const changed = JSON.stringify(n.data) !== JSON.stringify(data);
        n.data = data; n.error = ""; notificationBadges();
        const v = views.get(workspace?.active);
        if (changed && v) {
          await loadActivity(v, v.activityCursor); if (v.module === "friends") await v.refreshFriends?.();
          if (v.module === "notifications") {
            const latest = data.items.find(item => item.module === "notifications")?.id;
            if (latest && latest !== v.lastNotice) setTimeout(() => { if (current(v) && !v.root.hidden) notificationPage(v).catch(e => status(v, friendly(e))); }, 0);
          }
        }
      } catch (error) { n.error = "notification_unavailable"; }
      finally {
        n.polling = null;
        if (current(n) && n === notificationState) n.timer = setTimeout(refreshNotifications, n.error || document.visibilityState === "hidden" ? 30000 : 5000);
      }
    })();
    return n.polling;
  }
  async function showNotifications() { return open("notifications"); }
  function syncNotifications() {
    if (notificationState && !current(notificationState)) {
      notificationState.controller.abort(); clearTimeout(notificationState.timer); notificationState = null; notificationBadges();
    }
    if (!allowed() || notificationState) return;
    notificationStyles();
    const n = notificationState = { uid: uid(), root: document.body, controller: new AbortController(), data: { items: [], unreadCount: 0, counts: {} } };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshNotifications(); }, { signal: n.controller.signal });
    window.addEventListener("online", refreshNotifications, { signal: n.controller.signal });
    refreshNotifications();
  }

  function menu() {
    syncNotifications();
    const target = document.getElementById("sm-apps");
    if (!target) return;
    if (!allowed()) {
      target.querySelector('[data-start-group="social"]')?.remove();
      return;
    }
    const g = window.PanthoriumStartMenuUI?.group(
      "social",
      "Social Media",
      target,
    );
    if (!g) return;
    g.querySelector(".social-notification-menu")?.remove();
    if (!g.querySelector(".sm-group-label [data-social-notification-count]")) g.querySelector(".sm-group-label")?.append(notificationBadge());
    for (const [id, name, thai, icon] of specs) {
      if (g.querySelector('[data-app-id="social-' + id + '"]')) continue;
      const b = el("button", icon + " " + name + " · " + thai, {
        type: "button",
        class: "sm-app",
        "data-app-id": "social-" + id,
        "data-search-text": "social โซเชียล " + name + " " + thai,
      });
      b.append(el("span", "", { class: "social-notification-badge", "data-social-module-count": id, hidden: "" }));
      b.onclick = () => {
        open(id).catch((e) => {
          if (typeof toast === "function") toast(friendly(e));
        });
        document.getElementById("start-menu")?.classList.remove("open");
      };
      window.PanthoriumStartMenuUI.groupItems(g).append(b);
    }
    notificationBadges();
  }
  function cleanup() {
    for (const v of views.values()) {
      if (!current(v)) {
        v.controller.abort();
        clearTimeout(v.timer);
        clearTimeout(v.readTimer);
        v.readObserver?.disconnect();
        for (const url of v.urls) URL.revokeObjectURL(url);
        v.root.replaceChildren();
        views.delete(v.module);
      }
    }
    if (workspace && !current(workspace)) {
      const win = workspace.root.closest(".window");
      window.PanthoriumWindowManager?.close?.(WINDOW_ID);
      if (workspace) disposeWorkspace();
      win?.remove(); os()?.windows?.delete(WINDOW_ID);
    }
    menu();
  }
  window.PanthoriumSocial = {
    open,
    openChat: () => open("talk"),
    renderMenu: menu,
    showNotifications,
    refreshNotifications,
    renderCard: card,
    refresh: () => refreshView(views.get(workspace?.active)),
    ...Object.fromEntries(
      specs.map(([id]) => [
        "open" + id[0].toUpperCase() + id.slice(1),
        () => open(id),
      ]),
    ),
  };
  for (const event of [
    "panthorium:auth-changed",
    "panthorium:desktop-ready",
    "panthorium:boot-complete",
  ])
    window.addEventListener(event, cleanup);
  window.addEventListener("panthorium:ai-done", (e) => {
    if (
      e.detail?.toolResults?.some(
        (r) => r.toolId === "social.write" && r.ok && !r.error,
      )
    )
      window.PanthoriumSocial.refresh();
  });
  const observe = new MutationObserver(() => {
    for (const [id, v] of views)
      if (!v.root.isConnected) {
        v.controller.abort();
        clearTimeout(v.timer);
        clearTimeout(v.readTimer);
        v.readObserver?.disconnect();
        for (const url of v.urls) URL.revokeObjectURL(url);
        if (v.sessionId) window.PanthoriumSocialRTC?.stop();
        views.delete(id);
      }
  });
  observe.observe(document.body, { childList: true, subtree: true });
  let openedLink = "";
  function deepLink() {
    const p = new URLSearchParams(location.hash.slice(1));
    const key = uid() + location.hash;
    if (p.has("social") && allowed() && key !== openedLink) {
      openedLink = key;
      open(p.get("social"), { recordId: p.get("record") }).catch(() => {
        openedLink = "";
      });
    }
  }
  window.addEventListener("hashchange", deepLink);
  for (const event of ["panthorium:auth-changed", "panthorium:boot-complete"])
    window.addEventListener(event, deepLink);
  deepLink();
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", menu, { once: true });
  else menu();
})();
