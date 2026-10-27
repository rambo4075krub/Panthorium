"use strict";
const { mkdtemp, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
async function shortDuration(body) {
  const folder = await mkdtemp(join(tmpdir(), "panthorium-short-"));
  try {
    const file = join(folder, "clip"); await writeFile(file, body);
    const { stdout } = await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-read_intervals", "%+61", "-show_entries", "format=duration:stream=codec_type,duration:packet=pts_time,duration_time", "-of", "json", file], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const durations = [data.format?.duration, ...(data.streams || []).map(s => s.duration)].map(Number).filter(Number.isFinite);
    for (const packet of data.packets || []) { const end = Number(packet.pts_time) + (Number(packet.duration_time) || 0); if (Number.isFinite(end)) durations.push(end); }
    const duration = Math.max(0, ...durations);
    if (!data.streams?.some(s => s.codec_type === "video") || duration <= 0 || duration > 60.05) throw Error("social_short_duration");
    return duration;
  } finally { await rm(folder, { recursive: true, force: true }); }
}
module.exports = { shortDuration };
