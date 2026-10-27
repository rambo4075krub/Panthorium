"use strict";
let bytes;
module.exports = () => bytes ||= require("node:child_process").execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:size=32x32:rate=1:duration=1", "-c:v", "libvpx", "-f", "webm", "pipe:1"]);
