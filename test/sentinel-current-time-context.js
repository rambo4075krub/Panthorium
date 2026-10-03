"use strict";
const assert = require("node:assert/strict");
const { currentTimeContext } = require("../services/sentinel");
const context = currentTimeContext(new Date("2026-09-30T12:00:00.000Z"));
assert.match(context, /30 กันยายน 2569/);
assert.match(context, /ปฏิทินพุทธศักราช \(พ\.ศ\.\)/);
assert.match(context, /2026-09-30, ค\.ศ\./);
assert.match(context, /19:00/);
console.log("sentinel current-time context uses the Bangkok Buddhist and Gregorian dates");
