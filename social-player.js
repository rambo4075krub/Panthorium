(function () {
  "use strict";
  const status = document.getElementById("status"), params = new URLSearchParams(location.hash.slice(1));
  let stream, desired = { playing: params.get("autoplay") === "1", muted: params.get("muted") !== "0" }, apply;
  try { stream = window.PanthoriumMediaSource.source(params.get("type"), params.get("url")); if (stream.type === "website") throw Error("website_only"); }
  catch (_) { status.textContent = "ลิงก์สื่อไม่ถูกต้อง กรุณากลับไปตรวจสอบชนิดสื่อและ URL"; return; }
  const report = (time, duration, paused) => parent.postMessage({ channel: "panthorium-player-state", time, duration, paused }, location.origin);
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.channel !== "panthorium-player") return;
    const { action, value } = event.data;
    if (action === "play") { desired.playing = true; desired.muted = value !== false; }
    else if (action === "pause") desired.playing = false;
    else if (action === "toggle") { desired.playing = !desired.playing; desired.muted = false; }
    else if (action !== "seek") return;
    apply?.(action, value);
  });
  if (stream.type === "youtube") {
    const host = document.createElement("div"); host.id = "youtube-player"; document.body.append(host);
    let player, ready = false;
    apply = (action, value) => {
      if (!ready) return;
      desired.muted ? player.mute() : player.unMute();
      if (action === "seek" && Number.isFinite(value)) player.seekTo(Math.max(0,value), true);
      desired.playing ? player.playVideo() : player.pauseVideo();
    };
    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player(host, { host: "https://www.youtube-nocookie.com", videoId: new URL(stream.url).searchParams.get("v"), playerVars: { autoplay: 0, controls: params.get("controls") === "0" ? 0 : 1, playsinline: 1, origin: location.origin, enablejsapi: 1 }, events: {
        onReady: () => { ready = true; apply(); },
        onStateChange: () => report(player.getCurrentTime(), player.getDuration(), player.getPlayerState() !== 1),
        onAutoplayBlocked: () => { status.textContent = "แตะเล่นเพื่อเริ่มวิดีโอ"; },
        onError: () => { status.textContent = "วิดีโอนี้ไม่อนุญาตให้เล่นแบบฝัง กรุณาเปิดเว็บไซต์ต้นทาง"; },
      } });
    };
    const script = document.createElement("script"); script.src = "https://www.youtube.com/iframe_api"; document.head.append(script);
    const timer = setInterval(() => { if (ready) report(player.getCurrentTime(),player.getDuration(),player.getPlayerState() !== 1); }, 500);
    window.addEventListener("pagehide", () => { clearInterval(timer); player?.destroy(); });
    return;
  }
  if (stream.type === "trueid") {
    const iframe = document.createElement("iframe"); iframe.title = "TrueID Free TV player";
    const url = new URL(stream.embedUrl); url.searchParams.set("autoplay", "1"); url.searchParams.set("muted", "1");
    iframe.src = url.href; iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    iframe.referrerPolicy = "strict-origin-when-cross-origin"; iframe.allowFullscreen = true; document.body.append(iframe);
    // Provider retains control of its player, advertising and regional rights.
    apply = () => { if (desired.playing) { if (!iframe.src) iframe.src = url.href; } else iframe.removeAttribute("src"); };
    return;
  }
  const video = document.createElement("video");
  video.controls = params.get("controls") !== "0"; video.playsInline = true; video.preload = "metadata"; video.muted = desired.muted;
  document.body.append(video);
  const failed = () => { status.textContent = "โหลดสัญญาณไม่ได้: ลิงก์อาจหมดอายุ จำกัดพื้นที่ รูปแบบวิดีโอไม่รองรับ หรือต้องให้ผู้ให้บริการเปิด CORS กรุณาเปิดเว็บไซต์ต้นทาง"; };
  video.addEventListener("error", failed);
  apply = (action, value) => {
    video.muted = desired.muted;
    if (action === "seek" && Number.isFinite(value)) video.currentTime = Math.max(0,value);
    if (desired.playing) video.play().then(() => { status.textContent = ""; }).catch(() => { if (!desired.muted) status.textContent = "แตะเล่นเพื่อเริ่มวิดีโอพร้อมเสียง"; });
    else video.pause();
  };
  for (const event of ["timeupdate","pause","play","durationchange"]) video.addEventListener(event, () => report(video.currentTime,video.duration,video.paused));
  video.addEventListener("loadedmetadata", () => apply());
  let hls;
  if (stream.type === "hls" && !(video.canPlayType("application/vnd.apple.mpegurl") && ("ManagedMediaSource" in window || !window.Hls?.isSupported()))) {
    if (!window.Hls?.isSupported()) { failed(); return; }
    hls = new window.Hls({ enableWorker: false, maxBufferLength: 30, xhrSetup: (xhr, url) => { try { window.PanthoriumMediaSource.httpsUrl(url); } catch (_) { xhr.abort(); throw Error("invalid_stream_url"); } } });
    hls.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal) { failed(); hls.destroy(); } });
    hls.loadSource(stream.url); hls.attachMedia(video);
  } else video.src = stream.url;
  apply();
  window.addEventListener("pagehide", () => { hls?.destroy(); video.pause(); video.removeAttribute("src"); video.load(); });
})();
