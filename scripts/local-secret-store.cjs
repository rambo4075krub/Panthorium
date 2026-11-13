'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const DEFAULT_STATE = path.resolve(__dirname, '../../panthorium-state');
const HEADER = 'Panthorium local profile / DPAPI CurrentUser / v1\n';
const MAX_BYTES = 64 * 1024;

// The command is fixed. Paths and secrets travel through stdin, never argv,
// PowerShell interpolation, a temporary plaintext file, or diagnostic output.
const POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
$phase = 'input'
try {
  # A PowerShell 7 parent can pass incompatible modules through Node. Only
  # load the native Windows PowerShell modules, never user-added modules.
  $env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($request.action -eq 'restrict') {
    $item = Get-Item -LiteralPath $request.path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'reparse point' }
    $acl = Get-Acl -LiteralPath $request.path
    $phase = 'owner_check'
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    # Elevated Windows processes can create files owned by Administrators.
    if ($owner -ne $sid.Value -and !($isAdmin -and $owner -eq 'S-1-5-32-544')) { throw 'unexpected owner' }
    $allowed = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')
    $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
    $rights = if ($item.PSIsContainer) { ':(OI)(CI)F' } else { ':F' }
    $arguments = @($request.path, '/inheritance:r', '/grant:r') + @($allowed | ForEach-Object { '*' + $_ + $rights })
    $phase = 'acl_update'
    & $icacls @arguments 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'acl update failed' }
    foreach ($rule in (Get-Acl -LiteralPath $request.path).Access) {
      $identity = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if ($rule.AccessControlType -eq 'Allow' -and $identity -notin $allowed) {
        & $icacls $request.path '/remove:g' ('*' + $identity) 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'acl removal failed' }
      }
    }
    $phase = 'acl_verify'
    $actual = Get-Acl -LiteralPath $request.path
    if (!$actual.AreAccessRulesProtected) { throw 'inherited access' }
    foreach ($rule in $actual.Access) {
      $identity = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if ($rule.AccessControlType -eq 'Allow' -and $identity -notin @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) { throw 'unexpected access' }
    }
    [Console]::Out.Write('ok')
  } else {
    $bytes = [Convert]::FromBase64String($request.data)
    $entropy = [Text.Encoding]::UTF8.GetBytes('Panthorium.local-profile.v1')
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($request.action -eq 'protect') { $phase = 'protect'; $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope) }
    elseif ($request.action -eq 'unprotect') { $phase = 'unprotect'; $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope) }
    else { throw 'unknown action' }
    [Console]::Out.Write([Convert]::ToBase64String($result))
    [Array]::Clear($bytes, 0, $bytes.Length)
    [Array]::Clear($result, 0, $result.Length)
  }
} catch { [Console]::Error.Write('local_secret_' + $phase + '_failed'); exit 1 }
`;

function windowsProtector() {
  if (process.platform !== 'win32') throw new Error('local_profile_requires_windows_dpapi');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  function invoke(request) {
    const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL], {
      input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: MAX_BYTES * 4
    });
    if (result.error || result.status !== 0) {
      const code = String(result.stderr || '').trim();
      throw new Error(/^local_secret_(input|owner_check|acl_update|acl_verify|protect|unprotect)_failed$/.test(code) ? code : 'local_secret_operation_failed');
    }
    return result.stdout.trim();
  }
  return {
    restrict: target => { if (invoke({action:'restrict', path:target}) !== 'ok') throw new Error('local_secret_permissions_failed'); },
    protect: data => Buffer.from(invoke({action:'protect', data:data.toString('base64')}), 'base64'),
    unprotect: data => Buffer.from(invoke({action:'unprotect', data:data.toString('base64')}), 'base64')
  };
}

function statSafe(target, directory = false) {
  let s;
  try { s = fs.lstatSync(target); } catch (e) { if (e.code === 'ENOENT') return null; throw new Error('local_profile_access_failed'); }
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : (!s.isFile() || s.nlink !== 1 || s.size > MAX_BYTES))) {
    throw new Error('local_profile_unsafe_path');
  }
  return s;
}
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.username !== 'string' || !value.username || value.username.length > 128 || /[\x00-\x1f]/.test(value.username) ||
      typeof value.password !== 'string' || value.password.length < 10 || value.password.length > 512 ||
      typeof value.jwtSecret !== 'string' || value.jwtSecret.length < 32 || value.jwtSecret.length > 512) {
    throw new Error('local_profile_invalid');
  }
  return {username:value.username, password:value.password, jwtSecret:value.jwtSecret};
}
function decode(data) {
  try { return validate(JSON.parse(data.toString('utf8'))); } catch (_) { throw new Error('local_profile_invalid'); }
}
function same(a, b) { return a.username === b.username && a.password === b.password && a.jwtSecret === b.jwtSecret; }

// Dependency injection is only a programmatic test seam. The CLI and startup
// always construct the native protector; there is no plaintext fallback mode.
function createProfileStore(protector) {
  return function load({statePath = DEFAULT_STATE, create = true} = {}) {
    const state = path.resolve(statePath);
    statSafe(state, true);
    fs.mkdirSync(state, {recursive:true, mode:0o700});
    protector.restrict(state);
    const encrypted = path.join(state, 'local-profile.dpapi');
    const legacy = path.join(state, 'local-profile.json');
    const login = path.join(state, 'LOCAL_LOGIN.txt');
    for (const target of [encrypted, legacy, login]) if (statSafe(target)) protector.restrict(target);
    const lock = path.join(state, 'local-profile.lock');
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); } catch (_) { throw new Error('local_profile_busy_or_stale_lock'); }
    let temp;
    try {
      function readProtected(file) {
        const text = fs.readFileSync(file, 'utf8');
        if (!text.startsWith(HEADER) || !/^[A-Za-z0-9+/]+={0,2}$/.test(text.slice(HEADER.length))) throw new Error('local_profile_invalid_ciphertext');
        return decode(protector.unprotect(Buffer.from(text.slice(HEADER.length), 'base64')));
      }
      let profile;
      const hasLegacy = !!statSafe(legacy);
      if (statSafe(encrypted)) {
        profile = readProtected(encrypted);
        if (hasLegacy && !same(profile, decode(fs.readFileSync(legacy)))) throw new Error('local_profile_migration_conflict');
      } else {
        if (hasLegacy) profile = decode(fs.readFileSync(legacy));
        else {
          if (!create) throw new Error('local_profile_not_initialized');
          profile = {username:'localadmin', password:crypto.randomBytes(24).toString('base64url'), jwtSecret:crypto.randomBytes(48).toString('base64url')};
        }
        const plain = Buffer.from(JSON.stringify(profile), 'utf8');
        let cipher;
        try { cipher = protector.protect(plain); } finally { plain.fill(0); }
        if (!Buffer.isBuffer(cipher) || !cipher.length || !same(profile, decode(protector.unprotect(cipher)))) throw new Error('local_profile_roundtrip_failed');
        temp = path.join(state, '.local-profile-' + crypto.randomUUID() + '.dpapi.tmp');
        const out = fs.openSync(temp, 'wx', 0o600);
        try { fs.writeFileSync(out, HEADER + cipher.toString('base64')); fs.fsyncSync(out); } finally { fs.closeSync(out); }
        protector.restrict(temp);
        if (!same(profile, readProtected(temp))) throw new Error('local_profile_roundtrip_failed');
        fs.renameSync(temp, encrypted); temp = undefined;
        if (!same(profile, readProtected(encrypted))) throw new Error('local_profile_roundtrip_failed');
      }
      // Do not delete either plaintext file until durable encrypted storage has
      // been read back successfully under the current Windows account.
      if (statSafe(login)) fs.unlinkSync(login);
      if (hasLegacy) fs.unlinkSync(legacy);
      return profile;
    } finally {
      if (temp) fs.rmSync(temp, {force:true});
      fs.closeSync(fd); fs.unlinkSync(lock);
    }
  };
}
function loadLocalProfile(options) { return createProfileStore(windowsProtector())(options); }
module.exports = {DEFAULT_STATE, createProfileStore, loadLocalProfile, windowsProtector};
