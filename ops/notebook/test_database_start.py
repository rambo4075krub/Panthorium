import subprocess, sys, tempfile, time, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import runtime

class DatabaseStartupTests(unittest.TestCase):
 def test_postmaster_inherited_output_does_not_hold_startup_open(self):
  real_run=subprocess.run
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'logs').mkdir()
   def emulate(args,**kwargs):
    if str(args[0]).endswith('pg_isready.exe'):return SimpleNamespace(returncode=1)
    # Like pg_ctl, this parent exits while its child retains stdout/stderr.
    code="import subprocess,sys;subprocess.Popen([sys.executable,'-c','import time;time.sleep(2)'],stdout=sys.stdout,stderr=sys.stderr)"
    return real_run([sys.executable,'-c',code],**kwargs)
   try:
    with patch.object(runtime,'DBROOT',root),patch.object(runtime.subprocess,'run',side_effect=emulate):
     started=time.monotonic();runtime.ensure_database()
     self.assertLess(time.monotonic()-started,1.5,'Startup waited for descendant pipe EOF')
   finally:
    # Let the short-lived fixture close its log handle before Windows cleanup.
    time.sleep(2.2)
 def test_healthy_http_cannot_mask_unavailable_database(self):
  with patch.object(runtime,'pg_env',return_value={}),patch.object(runtime,'sql',side_effect=RuntimeError('database unavailable')),patch.object(runtime,'health',return_value={'ok':True}):
   with self.assertRaisesRegex(RuntimeError,'database unavailable'):
    runtime.verify_readiness('production',{'port':8810,'sha':'a'*40})

if __name__=='__main__':unittest.main()
