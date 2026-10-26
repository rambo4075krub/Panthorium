(function (root) {
  "use strict";
  function httpsUrl(value, optional = false) {
    if (!value && optional) return "";
    if (typeof value !== "string" || value.length > 2000) throw Object.assign(Error("social_invalid_media_url"), { code: "social_invalid_media_url", status: 400, sideEffectNotApplied: true });
    let u;
    try { u = new URL(value); } catch (_) { throw Object.assign(Error("social_invalid_media_url"), { code: "social_invalid_media_url", status: 400, sideEffectNotApplied: true }); }
    const host = u.hostname.toLowerCase();
    // Never load local/private addresses or credentials from a submitted channel.
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") ||
        !host.includes(".") || /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host) ||
        /^[\d.]+$/.test(host) || host.includes(":")) throw Object.assign(Error("social_invalid_media_url"), { code: "social_invalid_media_url", status: 400, sideEffectNotApplied: true });
    u.hash = "";
    return u.href;
  }
  function source(type, value) {
    const url = httpsUrl(value), u = new URL(url);
    if (type === "website") return { type, url };
    if (type === "youtube") {
      const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
      let id;
      if (host === "youtu.be") id = u.pathname.slice(1);
      else if (["youtube.com", "youtube-nocookie.com"].includes(host))
        id = u.pathname === "/watch" ? u.searchParams.get("v") : /^\/(embed|live)\/([^/]+)$/.exec(u.pathname)?.[2];
      if (!/^[\w-]{11}$/.test(id || "")) throw Object.assign(Error("social_invalid_media_url"), { code: "social_invalid_media_url", status: 400, sideEffectNotApplied: true });
      return { type, url: "https://www.youtube.com/watch?v=" + id, embedUrl: "https://www.youtube-nocookie.com/embed/" + id + "?playsinline=1" };
    }
    if (type === "hls" && /\.m3u8$/i.test(u.pathname)) return { type, url };
    if (type === "video" && /\.(mp4|webm)$/i.test(u.pathname)) return { type, url };
    throw Object.assign(Error("social_invalid_media_url"), { code: "social_invalid_media_url", status: 400, sideEffectNotApplied: true });
  }
  const api = { httpsUrl, source };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PanthoriumMediaSource = api;
})(typeof window !== "undefined" ? window : globalThis);
