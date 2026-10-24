"""Establish irreversible process restrictions before loading application code."""

import ctypes
import json
import os
from pathlib import Path
import sys

PR_SET_NO_NEW_PRIVS = 38
PR_GET_NO_NEW_PRIVS = 39


def security_status():
    fields = {}
    for line in Path("/proc/self/status").read_text().splitlines():
        key, _, value = line.partition(":")
        if key in {"NoNewPrivs", "CapInh", "CapPrm", "CapEff", "CapAmb"}:
            fields[key] = int(value.strip(), 10 if key == "NoNewPrivs" else 16)
    if set(fields) != {"NoNewPrivs", "CapInh", "CapPrm", "CapEff", "CapAmb"}:
        raise RuntimeError("runtime_security_status_unavailable")
    return fields


def harden_process():
    if sys.platform != "linux":
        raise RuntimeError("runtime_requires_linux")
    if 0 in {os.getuid(), os.geteuid(), os.getgid(), os.getegid(), *os.getgroups()}:
        raise RuntimeError("runtime_requires_unprivileged_user")
    before = security_status()
    if any(before[key] for key in ("CapInh", "CapPrm", "CapEff", "CapAmb")):
        raise RuntimeError("runtime_capabilities_forbidden")
    libc = ctypes.CDLL(None, use_errno=True)
    prctl = libc.prctl
    prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    prctl.restype = ctypes.c_int
    if prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "runtime_no_new_privileges_failed")
    if prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1:
        raise RuntimeError("runtime_no_new_privileges_not_enabled")
    state = security_status()
    if state["NoNewPrivs"] != 1:
        raise RuntimeError("runtime_no_new_privileges_not_enabled")
    return state


def main():
    if sys.argv[1:] not in ([], ["--check"]):
        raise SystemExit("usage: runtime_guard.py [--check]")
    state = harden_process()
    if sys.argv[1:] == ["--check"]:
        print(json.dumps({"uid": os.getuid(), "gid": os.getgid(), **state}, sort_keys=True))
        return
    # Fixed application path; this launcher cannot execute caller-supplied commands.
    app = Path(__file__).resolve().with_name("app.py")
    os.execv(sys.executable, [sys.executable, str(app)])


if __name__ == "__main__":
    main()
