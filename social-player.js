(function () {
  "use strict";
  const status = document.getElementById("status"), params = new URLSearchParams(location.hash.slice(1));
  let stream;
  try {
    stream = window.PanthoriumMediaSource.source(params.get("type"), params.get("url"));
    if (stream.type === "website") throw Error("website_only");
  } catch (_) { status.textContent = "ลิงก์สื่อไม่ถูกต้อง กรุณากลับไปตรวจสอบชนิดสื่อและ URL"; return; }
  if (stream.type === "youtube") {
    const iframe = document.createElement("iframe"); iframe.title = "YouTube video player";
    iframe.src = stream.embedUrl; iframe.allow = "fullscreen; picture-in-picture; encrypted-media";
    iframe.referrerPolicy = "strict-origin-when-cross-origin"; iframe.allowFullscreen = true;
    document.body.append(iframe); return;
  }
  const video = document.createElement("video");
  video.controls = true; video.playsInline = true; video.preload = "metadata";
  document.body.append(video);
  const failed = () => { status.textContent = "โหลดสัญญาณไม่ได้: ลิงก์อาจหมดอายุ จำกัดพื้นที่ รูปแบบวิดีโอไม่รองรับ หรือต้องให้ผู้ให้บริการเปิด CORS กรุณาใช้ปุ่มเปิดเว็บไซต์ต้นทาง"; };
  video.addEventListener("error", failed);
  let hls;
  if (stream.type === "hls" && !(video.canPlayType("application/vnd.apple.mpegurl") && ("ManagedMediaSource" in window || !window.Hls?.isSupported()))) {
    if (!window.Hls?.isSupported()) { failed(); return; }
    hls = new window.Hls({ enableWorker: false, maxBufferLength: 30, xhrSetup: (xhr, url) => { try { window.PanthoriumMediaSource.httpsUrl(url); } catch (_) { xhr.abort(); throw Error("invalid_stream_url"); } } });
    hls.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal) { failed(); hls.destroy(); } });
    hls.loadSource(stream.url); hls.attachMedia(video);
  } else video.src = stream.url;
  window.addEventListener("pagehide", () => { hls?.destroy(); video.pause(); video.removeAttribute("src"); video.load(); });
})();
