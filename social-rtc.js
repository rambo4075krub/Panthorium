(function () {
  "use strict";
  let active = null,
    generation = 0;
  async function stop(notify = true) {
    const old = active;
    active = null;
    generation++;
    if (!old) return;
    clearTimeout(old.timer);
    for (const pc of old.peers.values()) pc.close();
    old.stream?.getTracks().forEach((t) => t.stop());
    old.render.replaceChildren();
    if (notify)
      try {
        await old.write(
          old.kind === "live"
            ? old.owner === old.uid
              ? "live-end"
              : "live-leave"
            : "call-end",
          { recordId: old.id },
        );
      } catch (_) {}
    window.dispatchEvent(
      new CustomEvent("panthorium:social-rtc", { detail: { active: false } }),
    );
  }
  async function start({
    id,
    kind,
    owner,
    uid,
    video = true,
    read,
    write,
    render,
    status,
  }) {
    await stop();
    const turn = ++generation;
    window.PanthoriumLiveVoice?.stop?.();
    const state = {
      id,
      kind,
      owner,
      uid,
      read,
      write,
      render,
      status,
      peers: new Map(),
      seen: new Set(),
      pending: new Map(),
      stream: null,
    };
    active = state;
    const valid = () =>
      active === state && generation === turn && render.isConnected;
    try {
      const config = await read("/api/social/rtc/" + encodeURIComponent(id));
      if (!valid()) return;
      if (kind !== "live" || owner === uid) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: video
            ? {
                width: { ideal: 640 },
                height: { ideal: 360 },
                frameRate: { ideal: 20 },
              }
            : false,
        });
        if (!valid()) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        state.stream = stream;
        const local = document.createElement("video");
        local.autoplay = true;
        local.muted = true;
        local.playsInline = true;
        local.srcObject = stream;
        render.append(local);
      }
      status(
        config.relayConfigured
          ? "กำลังเชื่อมต่อเสียง/วิดีโอ…"
          : "กำลังเชื่อมต่อโดยตรง • หากเชื่อมข้ามเครือข่ายไม่ได้ ต้องตั้งค่า TURN",
      );
      const peer = (person) => {
        if (state.peers.has(person)) return state.peers.get(person);
        const pc = new RTCPeerConnection({ iceServers: config.iceServers });
        state.peers.set(person, pc);
        if (state.stream)
          for (const track of state.stream.getTracks())
            pc.addTrack(track, state.stream);
        pc.onicecandidate = (e) => {
          if (e.candidate && valid())
            write("signal", {
              recordId: id,
              to: person,
              type: "ice",
              payload: e.candidate.toJSON(),
            }).catch((e) => status(e.message));
        };
        pc.ontrack = (e) => {
          if (!valid()) return;
          let media = render.querySelector('[data-peer="' + person + '"]');
          if (!media) {
            media = document.createElement("video");
            media.dataset.peer = person;
            media.autoplay = true;
            media.controls = true;
            media.playsInline = true;
            render.append(media);
          }
          media.srcObject = e.streams[0] || new MediaStream([e.track]);
          media.play().catch(() => status("แตะปุ่มเล่นเพื่อฟังเสียง"));
        };
        pc.onconnectionstatechange = () => {
          if (!valid()) return;
          status(
            pc.connectionState === "connected"
              ? "เชื่อมต่อแล้ว"
              : pc.connectionState === "failed"
                ? "เชื่อมต่อไม่สำเร็จ กรุณาตรวจเครือข่ายและการตั้งค่า TURN"
                : "สถานะการเชื่อมต่อ: " + pc.connectionState,
          );
        };
        return pc;
      };
      let heartbeat = 0;
      const poll = async () => {
        if (!valid()) {
          if (active === state) await stop();
          return;
        }
        try {
          if (
            Date.now() - heartbeat > 15000 &&
            (kind === "call" || owner === uid)
          ) {
            await write(kind === "call" ? "call-heartbeat" : "live-heartbeat", {
              recordId: id,
            });
            heartbeat = Date.now();
          }
          const data = await read("/api/social/rtc/" + encodeURIComponent(id));
          if (!valid()) return;
          if (owner === uid)
            for (const person of data.session.members.filter(
              (x) => x !== uid,
            )) {
              if (!state.peers.has(person)) {
                const pc = peer(person);
                await pc.setLocalDescription(await pc.createOffer());
                await write("signal", {
                  recordId: id,
                  to: person,
                  type: "offer",
                  payload: {
                    type: pc.localDescription.type,
                    sdp: pc.localDescription.sdp,
                  },
                });
              }
            }
          for (const [person, pc] of state.peers)
            if (!data.session.members.includes(person)) {
              pc.close();
              state.peers.delete(person);
              render.querySelector('[data-peer="' + person + '"]')?.remove();
            }
          for (const signal of data.signals.slice().reverse()) {
            if (state.seen.has(signal.id)) continue;
            state.seen.add(signal.id);
            const pc = peer(signal.ownerId);
            if (signal.type === "ice") {
              if (pc.remoteDescription)
                await pc.addIceCandidate(signal.payload);
              else {
                const q = state.pending.get(signal.ownerId) || [];
                q.push(signal.payload);
                state.pending.set(signal.ownerId, q);
              }
              continue;
            }
            if (signal.type === "offer") {
              await pc.setRemoteDescription(signal.payload);
              await pc.setLocalDescription(await pc.createAnswer());
              await write("signal", {
                recordId: id,
                to: signal.ownerId,
                type: "answer",
                payload: {
                  type: pc.localDescription.type,
                  sdp: pc.localDescription.sdp,
                },
              });
            } else if (
              signal.type === "answer" &&
              pc.signalingState === "have-local-offer"
            )
              await pc.setRemoteDescription(signal.payload);
            if (pc.remoteDescription) {
              for (const ice of state.pending.get(signal.ownerId) || [])
                await pc.addIceCandidate(ice);
              state.pending.delete(signal.ownerId);
            }
          }
          if (state.seen.size > 1000)
            state.seen = new Set([...state.seen].slice(-500));
        } catch (e) {
          if (valid()) {
            status(e.message);
            if (
              /ended|not_found|forbidden|not_accepted|account_changed/.test(
                e.message,
              )
            ) {
              await stop(false);
              return;
            }
          }
        }
        if (valid()) state.timer = setTimeout(poll, 2000);
      };
      window.dispatchEvent(
        new CustomEvent("panthorium:social-rtc", { detail: { active: true } }),
      );
      poll();
    } catch (e) {
      status(
        e.name === "NotAllowedError" ? "กรุณาอนุญาตกล้อง/ไมโครโฟน" : e.message,
      );
      if (active === state) await stop();
    }
  }
  window.PanthoriumSocialRTC = {
    start,
    stop,
    isActive: () => !!active,
    toggleMic: () => {
      active?.stream?.getAudioTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
    },
    toggleCamera: () => {
      active?.stream?.getVideoTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
    },
  };
  window.addEventListener("panthorium:auth-changed", () => stop(false));
  window.addEventListener("pagehide", () => stop(false));
})();
