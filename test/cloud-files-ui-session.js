const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "sentinel.html"), "utf8");
const start = html.indexOf("function openFiles() {");
const ownerStart = html.indexOf("const ownerId =", start);
const helpersEnd = html.indexOf("const messageFor =", ownerStart);

assert.notEqual(start, -1, "Files window should be present");
assert.ok(ownerStart > start, "Files should resolve an account owner");
assert.ok(helpersEnd > ownerStart, "Files owner helpers should remain before error mapping");

const helperSource = html.slice(ownerStart, helpersEnd);
const createHelpers = new Function("OS", helperSource + "; return { ownerId, isRegistered };");

const accountId = "11111111-1111-4111-8111-111111111111";
const signedIn = createHelpers({ state: { user: { sub: accountId, roles: [] } } });
assert.equal(signedIn.ownerId(), accountId);
assert.equal(signedIn.isRegistered(), true, "registered sessions should enable cloud file actions");

const guestId = "guest:33333333-3333-4333-8333-333333333333";
const guest = createHelpers({ state: { user: { sub: guestId, roles: ["guest"] } } });
assert.equal(guest.ownerId(), guestId);
assert.equal(guest.isRegistered(), false, "Guest sessions must not enable private cloud files");

const idFallback = createHelpers({ state: { user: { id: accountId, roles: [] } } });
assert.equal(idFallback.ownerId(), accountId, "account id fallback should continue to work");

console.log("Cloud Files UI session: registered-account upload gating and Guest denial passed");
