"use strict";

const path = require("path");

// This directory also contains server code and runtime data. Never serve it
// wholesale: every additional public file must be reviewed and named here.
const PUBLIC_ASSET_FILES = Object.freeze([
  "browser-download.html",
  "browser-download.js",
  "manifest.json",
  "panthorium-logo.svg",
  "panthorium-logo-mark.svg",
  "panthorium-logo.png",
  "panthorium-logo-sapphire.png",
  "panthorium-window-base.css",
  "panthorium-window-base.js"
]);

function createPublicAssetMiddleware(frontendRoot, { maxAge = 0 } = {}) {
  const root = path.resolve(frontendRoot);
  const assets = new Map(PUBLIC_ASSET_FILES.map((file) => [`/${file}`, path.join(root, file)]));
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // Match the raw path exactly. In particular, do not decode or normalize a
    // user-controlled path into a filesystem location. Query strings are fine.
    const file = assets.get(req.path);
    if (!file) return next();
    res.sendFile(file, { dotfiles: "deny", etag: true, maxAge }, (error) => {
      if (!error) return;
      if (error.status === 404 || error.code === "ENOENT") return next();
      next(error);
    });
  };
}

module.exports = { createPublicAssetMiddleware, PUBLIC_ASSET_FILES };
