(function () {
  "use strict";
  const specs = [
    ["watch", "Watch", "วิดีโอ", "▶"],
    ["community", "Community", "โพสต์และชุมชน", "◉"],
    ["talk", "Talk", "ข้อความและการโทร", "☏"],
    ["market", "Market", "ร้านค้า", "▣"],
    ["live", "Live", "ถ่ายทอดสด", "◉"],
    ["connect", "Connect", "ทำความรู้จัก 18+", "♡"],
  ];
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
    social_thread_not_accepted: "รออีกฝ่ายรับคำขอสนทนาก่อน",
    social_match_required: "ต้องสนใจตรงกันก่อนเริ่มคุย",
    social_not_found: "ไม่พบรายการหรือไม่มีสิทธิ์เข้าถึง",
    files_quota_exceeded: "พื้นที่คลาวด์เต็ม กรุณาจัดการไฟล์หรือแพ็กเกจ",
    file_too_large: "ไฟล์เกินขนาดที่ระบบรองรับ 20 MB",
    social_video_required: "Watch ต้องแนบวิดีโอ MP4 หรือ WebM",
    social_live_capacity: "ห้องนี้ครบจำนวนผู้ชม 8 คนแล้ว",
    social_invalid_order: "จำนวนสินค้าไม่พอหรือรายการไม่พร้อมขาย",
    social_connect_disabled: "ฝ่ายใดฝ่ายหนึ่งปิด Connect แล้ว",
    social_name_required: "กรุณาระบุชื่อที่แสดง",
    social_invalid_product: "ตรวจราคาและจำนวนสินค้า",
  };
  const friendly = (e) =>
    messages[e.message] || e.message || "ดำเนินการไม่สำเร็จ";
  function status(v, text) {
    if (current(v)) v.status.textContent = text;
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
  const write = (v, action, input, requestId = crypto.randomUUID()) =>
    api(v, "/api/social/actions", {
      method: "POST",
      headers: { "Idempotency-Key": requestId },
      body: JSON.stringify({ action, input }),
    });
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
    wrap.append(n);
    form.append(wrap);
    return n;
  }
  function select(form, label, options, value) {
    const wrap = el("label", label),
      s = el("select");
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
    const submit = el("button", "บันทึก", { type: "submit" });
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
        status(v, "บันทึกแล้ว");
        requestId = crypto.randomUUID();
        if (after) await after(out);
      } catch (e) {
        status(v, friendly(e));
      } finally {
        submit.disabled = false;
      }
    });
    return submit;
  }
  async function attachments(v, form, initial = []) {
    const details = el("details"),
      summary = el("summary", "แนบไฟล์จากคลาวด์ / อัปโหลด"),
      list = el("div");
    details.append(summary, list);
    form.append(details);
    const selected = new Set(initial);
    const render = async () => {
      list.replaceChildren();
      const data = await api(v, "/api/files");
      if (!current(v)) return;
      list.append(
        el(
          "p",
          `พื้นที่ ${Math.round(data.usedBytes / 1048576)} / ${Math.round(data.maxBytes / 1048576)} MB · แชร์ไฟล์เดิม ไม่ทำสำเนา`,
        ),
      );
      for (const f of data.files || []) {
        const label = el("label", f.name),
          check = el("input");
        check.type = "checkbox";
        check.checked = selected.has(f.id);
        check.onchange = () => {
          if (check.checked && selected.size >= 6) {
            check.checked = false;
            status(v, "แนบได้สูงสุด 6 ไฟล์");
            return;
          }
          check.checked ? selected.add(f.id) : selected.delete(f.id);
          form.dispatchEvent(new Event("input", { bubbles: true }));
        };
        label.prepend(check);
        list.append(label);
      }
    };
    const upload = input(details, "อัปโหลดเข้าพื้นที่ของฉัน", "file");
    details.append(
      button(v, "อัปโหลดไฟล์", async () => {
        const file = upload.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw Error("file_too_large");
        const result = await api(v, "/api/files", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
            "X-File-Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        if (selected.size < 6) selected.add(result.file.id);
        form.dispatchEvent(new Event("input", { bubbles: true }));
        await render();
      }),
    );
    let loaded = false;
    details.addEventListener("toggle", () => {
      if (details.open && !loaded) {
        loaded = true;
        render().catch((e) => {
          loaded = false;
          status(v, friendly(e));
        });
      }
    });
    return () => [...selected];
  }
  async function media(v, record, container) {
    for (const file of record.files || []) {
      const item = el("div", null, { class: "social-media" });
      item.append(
        el("small", file.name),
        button(v, "เปิดไฟล์ / ดูตัวอย่าง", async () => {
          const blob = await api(
            v,
            "/api/social/records/" +
              encodeURIComponent(record.id) +
              "/files/" +
              file.id,
            {},
            true,
          );
          if (!current(v)) return;
          const url = URL.createObjectURL(blob);
          v.urls.add(url);
          let view;
          if (/^image\/(png|jpeg|webp|gif)$/.test(blob.type))
            view = el("img", null, { alt: file.name, src: url });
          else if (/^(video|audio)\//.test(blob.type)) {
            view = el(blob.type.startsWith("video") ? "video" : "audio", null, {
              src: url,
              controls: "",
              playsinline: "",
            });
          } else {
            view = el("pre", await blob.text());
          }
          item.append(view);
        }),
      );
      item.append(
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
  async function profile(v) {
    clear(v);
    const data = await api(v, "/api/social/profile");
    if (!current(v)) return;
    const f = section(v, "โปรไฟล์ Social Media"),
      form = el("form");
    f.append(form);
    const name = input(form, "ชื่อที่แสดง", "text", data.profile?.name || ""),
      bio = input(form, "เกี่ยวกับฉัน", "textarea", data.profile?.bio || ""),
      visible = input(
        form,
        "อนุญาตให้คนอื่นค้นหาโปรไฟล์และขอสนทนา",
        "checkbox",
      );
    visible.checked = !!data.profile?.discoverable;
    name.maxLength = 80;
    bio.maxLength = 1000;
    bindForm(
      v,
      form,
      "profile",
      () => ({
        name: name.value,
        bio: bio.value,
        discoverable: visible.checked,
      }),
      () => feed(v),
    );
    f.append(
      el(
        "p",
        "ใช้ชื่อ Social แยกจากบัญชีส่วนตัว ไม่เปิดเผยอีเมลหรือไฟล์ที่ไม่ได้แชร์",
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
    const title = input(form, "ชื่อเรื่อง", "text"),
      text = input(form, "รายละเอียด", "textarea"),
      audience = select(form, "ผู้ที่ดูได้", [
        ["public", "ผู้ใช้ที่เข้าสู่ระบบ"],
        ["followers", "ผู้ติดตาม"],
        ["private", "เฉพาะฉัน"],
      ]);
    title.maxLength = 200;
    text.maxLength = 8000;
    let price, stock;
    if (v.module === "market") {
      price = input(form, "ราคา (บาท)", "number");
      price.min = 0;
      price.step = "0.01";
      stock = input(form, "จำนวนสินค้า", "number", "1");
      stock.min = 1;
    }
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
        title: title.value,
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
      () => feed(v),
    );
    submit.textContent = v.module === "market" ? "ลงสินค้า" : "เผยแพร่";
  }
  async function people(v) {
    clear(v);
    const card = section(v, "ค้นหาคนใน Panthorium"),
      form = el("form"),
      q = input(form, "ชื่อที่แสดงอย่างน้อย 2 ตัวอักษร"),
      results = el("div");
    card.append(form, results);
    const b = el("button", "ค้นหา", { type: "submit" });
    form.append(b);
    form.onsubmit = async (e) => {
      e.preventDefault();
      b.disabled = true;
      try {
        const data = await api(
          v,
          "/api/social/people?query=" + encodeURIComponent(q.value),
        );
        if (!current(v)) return;
        results.replaceChildren();
        for (const p of data.items) {
          const item = el("article", null, { class: "social-card" });
          item.append(
            el("h4", p.name),
            el("p", p.bio),
            button(v, "ขอสนทนา", async () => {
              const out = await write(v, "thread", { userId: p.id });
              await open("talk", { recordId: out.record.id });
            }),
            button(v, "ติดตาม", async () => {
              await write(v, "follow", { userId: p.id, enabled: true });
              status(v, "ติดตามแล้ว");
            }),
            button(v, "เลิกติดตาม", async () => {
              await write(v, "follow", { userId: p.id, enabled: false });
              status(v, "เลิกติดตามแล้ว");
            }),
            button(v, "บล็อก", async () => {
              await write(v, "block", { userId: p.id, enabled: true });
              item.remove();
            }),
            button(v, "เลิกบล็อก", async () => {
              await write(v, "block", { userId: p.id, enabled: false });
              status(v, "เลิกบล็อกแล้ว");
            }),
          );
          results.append(item);
        }
        if (!data.items.length)
          results.append(el("p", "ไม่พบโปรไฟล์ที่เปิดให้ค้นหา"));
      } catch (e) {
        status(v, friendly(e));
      } finally {
        b.disabled = false;
      }
    };
  }
  async function card(v, r, parent) {
    const c = el("article", null, {
      class: "social-card",
      "data-record-id": r.id,
    });
    parent.append(c);
    c.append(
      el("small", r.author?.name || "สมาชิก"),
      el("h3", r.title || r.name || "Talk"),
      el("p", r.text || r.bio || ""),
    );
    if (r.kind === "thread") {
      c.append(
        el("p", r.status === "pending" ? "รอรับคำขอสนทนา" : r.status),
        button(v, "เปิดบทสนทนา", () => detail(v, r.id)),
      );
      return;
    }
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
            await open("talk", { recordId: t.record.id });
          }),
        );
    } else if (r.kind === "live") {
      c.append(
        button(v, "เข้าชมไลฟ์", async () => {
          const out = await write(v, "live-join", { recordId: r.id });
          await startRTC(v, out.record);
          await detail(v, r.id, false);
        }),
      );
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
      c.append(
        button(
          v,
          (r.liked ? "♥" : "♡") + " " + (r.likeCount || 0),
          async () => {
            await write(v, "like", { recordId: r.id });
            await feed(v);
          },
        ),
        button(v, "ความคิดเห็น", () => detail(v, r.id)),
      );
    }
    if (r.kind === "watch")
      c.append(
        button(v, "เพิ่มลงเพลย์ลิสต์", () => collections(v, "playlist", r.id)),
      );
    if (
      r.ownerId === v.uid &&
      ["community", "watch", "listing"].includes(r.kind)
    )
      c.append(button(v, "แก้ไข", () => edit(v, r)));
    if (
      r.ownerId === v.uid &&
      ["community", "watch", "listing"].includes(r.kind)
    )
      c.append(
        button(v, "ลบ", async () => {
          if (!window.confirm("ลบรายการนี้? ไฟล์ต้นฉบับยังอยู่ในพื้นที่ของคุณ"))
            return;
          await write(v, "delete", { recordId: r.id });
          await feed(v);
        }),
      );
    if (r.ownerId !== v.uid) {
      c.append(
        button(v, "ขอสนทนากับเจ้าของ", async () => {
          const t = await write(v, "thread", {
            userId: r.ownerId,
            title: r.title || "Talk",
          });
          await open("talk", { recordId: t.record.id });
        }),
        button(v, "บล็อกเจ้าของ", async () => {
          await write(v, "block", { userId: r.ownerId, enabled: true });
          await feed(v);
        }),
      );
      const reason = input(c, "เหตุผลที่รายงาน");
      c.append(
        button(v, "รายงาน", async () => {
          if (!reason.value.trim()) return;
          await write(v, "report", { recordId: r.id, reason: reason.value });
          status(v, "ส่งรายงานให้ผู้ดูแลแล้ว");
        }),
      );
    }
    c.append(
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
    c.append(
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
  }
  async function detail(v, id, reset = true) {
    if (reset) clear(v);
    v.detail = id;
    const data = await api(v, "/api/social/records/" + encodeURIComponent(id));
    if (!current(v)) return;
    const r = data.record;
    const card = section(v, r.title || "บทสนทนา");
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
      return;
    }
    if (r.kind === "group") {
      card.append(
        button(
          v,
          r.members.includes(v.uid) ? "ออกจากกลุ่ม" : "เข้าร่วมกลุ่ม",
          async () => {
            await write(
              v,
              r.members.includes(v.uid) ? "group-leave" : "group-join",
              { recordId: r.id },
            );
            await detail(v, r.id);
          },
        ),
      );
      if (r.members.includes(v.uid))
        card.append(
          button(v, "โพสต์ในกลุ่ม", async () => {
            v.groupId = r.id;
            await compose(v);
          }),
        );
      for (const post of data.items)
        await window.PanthoriumSocial.renderCard(v, post, card);
      return;
    }
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
    card.append(log);
    await renderMessages(v, data.items, log);
    if (
      r.kind === "thread" ||
      r.kind === "live" ||
      ["community", "watch", "listing"].includes(r.kind)
    ) {
      const f = el("form"),
        text = input(
          f,
          r.kind === "thread" ? "ข้อความ" : "ความคิดเห็น",
          "textarea",
        );
      card.append(f);
      const getFiles = r.kind === "thread" ? await attachments(v, f) : () => [];
      bindForm(
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
    }
    if (["thread", "live"].includes(r.kind)) v.messageLog = log;
  }
  async function renderMessages(v, items, log) {
    if (!current(v) || !log.isConnected) return;
    log.replaceChildren();
    for (const msg of items) {
      const c = el("article", null, { class: "social-message" });
      c.append(
        el(
          "small",
          (msg.ownerId === v.uid ? "คุณ" : msg.ownerId) +
            " • " +
            new Date(msg.createdAt).toLocaleString("th-TH"),
        ),
        el("p", msg.text),
      );
      await media(v, msg, c);
      if (msg.ownerId === v.uid && msg.kind === "message")
        c.append(
          button(v, "ลบข้อความ", async () => {
            await write(v, "delete", { recordId: msg.id });
            c.remove();
          }),
        );
      log.append(c);
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
    const getFiles = await attachments(v, f);
    bindForm(
      v,
      f,
      "connect",
      () => ({
        enabled: true,
        adultConfirmed: adult.checked,
        name: name.value,
        bio: bio.value,
        gender: gender.value,
        preferences: [pref.value],
        fileIds: getFiles(),
      }),
      () => feed(v),
    );
    card.append(
      button(v, "ปิด Connect และหยุดการค้นพบ/สนทนา", async () => {
        await write(v, "connect", { enabled: false });
        await feed(v);
      }),
    );
  }
  async function collections(v, kind, targetId) {
    clear(v);
    const data = await api(v, "/api/social/collections/" + kind),
      card = section(
        v,
        kind === "group"
          ? "กลุ่มชุมชน"
          : kind === "block"
            ? "บัญชีที่บล็อก"
            : "เพลย์ลิสต์ส่วนตัว",
      );
    if (kind !== "block") {
      const f = el("form"),
        title = input(f, "ชื่อ");
      card.append(f);
      bindForm(
        v,
        f,
        kind === "group" ? "group-create" : "playlist-create",
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
    const title = input(f, "ชื่อเรื่อง", "text", r.title),
      text = input(f, "เนื้อหา", "textarea", r.text),
      audience = select(
        f,
        "ผู้ชม",
        [
          ["public", "ผู้ใช้ที่เข้าสู่ระบบ"],
          ["followers", "ผู้ติดตาม"],
          ["private", "เฉพาะฉัน"],
        ],
        r.audience,
      );
    if (r.audience === "group") audience.disabled = true;
    bindForm(
      v,
      f,
      "edit",
      () => ({
        recordId: r.id,
        title: title.value,
        text: text.value,
        ...(r.audience === "group" ? {} : { audience: audience.value }),
      }),
      () => feed(v),
    );
  }
  async function orders(v) {
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
    }
  }
  async function startRTC(v, r) {
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
    try {
      if (v.module === "talk") {
        const data = await api(v, "/api/social/inbox");
        if (!current(v)) return;
        v.incoming.replaceChildren();
        for (const c of data.calls) {
          if (c.status === "ringing" && c.ownerId !== v.uid) {
            const box = el("div", null, { class: "social-card" });
            box.append(
              el(
                "p",
                (c.video ? "วิดีโอคอล" : "สายโทรเข้า") + " จาก " + c.ownerId,
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
      if (v.detail && v.messageLog?.isConnected) {
        const latest = await api(
          v,
          "/api/social/records/" + encodeURIComponent(v.detail),
        );
        const fingerprint = JSON.stringify(
          latest.items.map((x) => [x.id, x.deleted]),
        );
        if (fingerprint !== v.lastMessages) {
          v.lastMessages = fingerprint;
          await renderMessages(v, latest.items, v.messageLog);
        }
      }
    } catch (e) {
      status(v, friendly(e));
    }
    if (current(v)) v.timer = setTimeout(() => poll(v), 4000);
  }
  async function feed(v, before) {
    if (!before) {
      clear(v);
      v.detail = null;
      v.messageLog = null;
    }
    const data = await api(
      v,
      "/api/social/feed/" +
        v.module +
        "?query=" +
        encodeURIComponent(v.search.value) +
        (before ? "&before=" + encodeURIComponent(before) : ""),
    );
    if (!current(v)) return;
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
    for (const r of data.items) await card(v, r, v.content);
    if (data.nextCursor)
      v.content.append(
        button(v, "โหลดรายการก่อนหน้า", async () => {
          await feed(v, data.nextCursor);
        }),
      );
  }
  async function open(module = "community", options = {}) {
    if (!allowed()) throw Error("account_required");
    if (!specs.some((s) => s[0] === module))
      throw Error("social_invalid_module");
    const key = "social-" + module;
    let v = views.get(module);
    if (v && current(v)) {
      window.focusWindow?.(key);
      if (options.recordId) await detail(v, options.recordId);
      if (options.sourceFileIds) {
        v.sourceFileIds = options.sourceFileIds;
        await compose(v);
      }
      return v.root;
    }
    const markup =
      '<div class="social-app" data-social="' +
      module +
      '"><style>.social-app{height:100%;overflow:auto;padding:20px;color:var(--text,#edf2f7);background:linear-gradient(145deg,#10151f,#191710);box-sizing:border-box}.social-app *{box-sizing:border-box}.social-app button,.social-app input,.social-app select,.social-app textarea{font:inherit;color:inherit;background:#17202d;border:1px solid #66503d;border-radius:9px;padding:9px;max-width:100%}.social-app button{cursor:pointer;margin:4px;min-height:40px}.social-app button:hover{border-color:#ff912e}.social-app button:disabled{opacity:.5}.social-app label{display:block;margin:10px 0}.social-app label input:not([type=checkbox]),.social-app textarea,.social-app select{display:block;width:100%;margin-top:5px}.social-app textarea{min-height:90px}.social-app option{background:#17202d;color:#fff}.social-app h1{color:#ffb26e;font-size:26px}.social-app nav{display:flex;flex-wrap:wrap;gap:4px}.social-card{border:1px solid #514637;border-radius:14px;padding:16px;margin:12px 0;background:#111923}.social-card p,.social-message p{white-space:pre-wrap;overflow-wrap:anywhere}.social-message{padding:12px;border-bottom:1px solid #3e4146}.social-app small{color:#b5becb;overflow-wrap:anywhere}.social-app [role=status]{min-height:24px;color:#ffb26e}.social-media img,.social-media video{display:block;max-width:100%;max-height:420px}.social-media pre{white-space:pre-wrap;max-height:420px;overflow:auto}.social-video-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.social-video-grid video{width:100%;max-height:400px;background:#000}.social-app [hidden]{display:none!important}@media(max-width:540px){.social-app{padding:10px}.social-card{padding:12px}}</style><header><small>PANTHORIUM / SOCIAL MEDIA</small><h1>' +
      specs.find((s) => s[0] === module)[1] +
      '</h1></header><nav data-social-nav></nav><p role="status" aria-live="polite"></p><div data-social-incoming></div><section data-social-rtc hidden></section><div data-social-content></div></div>';
    if (typeof window.createWindow !== "function")
      throw Error("window_system_unavailable");
    window.createWindow(
      key,
      "Social Media · " + specs.find((s) => s[0] === module)[1],
      markup,
      {
        width: 940,
        height: 720,
        onClose: () => {
          const old = views.get(module);
          if (old) {
            if (old.sessionId) window.PanthoriumSocialRTC?.stop();
            old.controller.abort();
            clearTimeout(old.timer);
            for (const url of old.urls) URL.revokeObjectURL(url);
            views.delete(module);
          }
        },
      },
    );
    const root = document.querySelector(
      '.window[data-id="' + key + '"] [data-social]',
    );
    if (!root) throw Error("window_system_unavailable");
    v = {
      uid: uid(),
      root,
      module,
      controller: new AbortController(),
      urls: new Set(),
      sourceFileIds: options.sourceFileIds || [],
      status: root.querySelector("[role=status]"),
      content: root.querySelector("[data-social-content]"),
      incoming: root.querySelector("[data-social-incoming]"),
      rtc: root.querySelector("[data-social-rtc]"),
    };
    views.set(module, v);
    const nav = root.querySelector("nav");
    for (const [id, label] of specs)
      nav.append(button(v, label, () => open(id)));
    nav.append(
      button(v, "โปรไฟล์", () => profile(v)),
      button(v, "ค้นหาคน", () => people(v)),
      button(v, "รีเฟรช", () => feed(v)),
    );
    v.search = input(nav, "ค้นหารายการ");
    nav.append(button(v, "ค้นหา", () => feed(v)));
    if (["watch", "community", "market"].includes(module))
      nav.append(
        button(v, module === "market" ? "ลงสินค้า" : "สร้างโพสต์", () =>
          compose(v),
        ),
      );
    if (module === "community")
      nav.append(button(v, "กลุ่ม", () => collections(v, "group")));
    if (module === "watch")
      nav.append(button(v, "เพลย์ลิสต์", () => collections(v, "playlist")));
    nav.append(button(v, "บัญชีที่บล็อก", () => collections(v, "block")));
    if (module === "market")
      nav.append(button(v, "รายการซื้อขาย", () => orders(v)));
    if (module === "connect")
      nav.append(button(v, "ตั้งค่า Connect", () => connectSettings(v)));
    if (module === "live")
      nav.append(
        button(v, "เริ่มไลฟ์", async () => {
          clear(v);
          const form = el("form"),
            title = input(form, "ชื่อไลฟ์");
          section(v, "เริ่มถ่ายทอดสด • ผู้ชมพร้อมกันสูงสุด 8 คน").append(form);
          bindForm(
            v,
            form,
            "live-start",
            () => ({ title: title.value }),
            async (out) => {
              await startRTC(v, out.record);
              await detail(v, out.record.id);
            },
          );
        }),
      );
    const apps = select(nav, "เปิดเครื่องมือ Panthorium ที่เชื่อมงาน", [
      ["", "เลือกเครื่องมือ"],
      ...(window.PanthoriumWindowCatalog?.apps || [])
        .filter(
          (a) =>
            !a.virtual &&
            !a.native &&
            !a.id.startsWith("social-") &&
            window.PanthoriumWindowCatalog.allowed(a, os().state.user),
        )
        .map((a) => [a.key, a.label]),
    ]);
    apps.onchange = () => {
      if (apps.value)
        window.PanthoriumVoiceCommands?.windowAction("open_" + apps.value);
      apps.value = "";
    };
    try {
      if (options.recordId) await detail(v, options.recordId);
      else if (v.sourceFileIds.length) await compose(v);
      else await feed(v);
    } catch (error) {
      status(v, friendly(error));
    }
    if (["talk", "live"].includes(module)) poll(v);
    return root;
  }
  function menu() {
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
    for (const [id, name, thai, icon] of specs) {
      if (g.querySelector('[data-app-id="social-' + id + '"]')) continue;
      const b = el("button", icon + " " + name + " · " + thai, {
        type: "button",
        class: "sm-app",
        "data-app-id": "social-" + id,
        "data-search-text": "social โซเชียล " + name + " " + thai,
      });
      b.onclick = () => {
        open(id).catch((e) => {
          if (typeof toast === "function") toast(friendly(e));
        });
        document.getElementById("start-menu")?.classList.remove("open");
      };
      window.PanthoriumStartMenuUI.groupItems(g).append(b);
    }
  }
  function cleanup() {
    for (const v of views.values()) {
      if (!current(v)) {
        v.controller.abort();
        clearTimeout(v.timer);
        for (const url of v.urls) URL.revokeObjectURL(url);
        v.root.replaceChildren();
        views.delete(v.module);
      }
    }
    menu();
  }
  window.PanthoriumSocial = {
    open,
    renderMenu: menu,
    renderCard: card,
    refresh: () =>
      Promise.all([...views.values()].filter(current).map((v) => feed(v))),
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
