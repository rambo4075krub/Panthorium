import json, threading, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
import runtime

class HttpReadinessTests(unittest.TestCase):
 def setUp(self):
  self.sha='a'*40
  self.health={'ok':True,'release':'notebook-production-'+self.sha[:12],
   'deployment':{'sha':self.sha,'stage':'production'}}
  self.responses={
   '/api/health':(200,self.health,{}),
   '/app-release.json':(200,{'release':self.health['release']},{'Cache-Control':'no-store'}),
   '/':(200,'<html>Sentinel AI</html>',{}),
   '/live-voice-client.js':(200,'window.liveVoiceReady=true;',{}),
   '/billing-catalog.js':(200,'window.catalogReady=true;',{}),
   '/api/files':(401,{'error':'unauthorized'},{}),
  }
  owner=self
  class Handler(BaseHTTPRequestHandler):
   def do_GET(self):
    status,body,headers=owner.responses.get(self.path,(404,'not found',{}))
    self.send_response(status)
    for key,value in headers.items():self.send_header(key,value)
    self.end_headers()
    self.wfile.write((json.dumps(body) if isinstance(body,dict) else body).encode())
   def do_POST(self):self.do_GET()
   def log_message(self,*args):pass
  self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.state={'sha':self.sha,'port':self.server.server_port}
  self.sql=patch.object(runtime,'sql',return_value='1');self.sql.start()
  self.env=patch.object(runtime,'pg_env',return_value={});self.env.start()
 def tearDown(self):
  self.server.shutdown();self.server.server_close();self.thread.join()
  self.env.stop();self.sql.stop()
 def test_live_only_release_does_not_require_disabled_qwen(self):
  self.assertNotIn('/qwen-local.js',self.responses)
  self.assertTrue(runtime.verify_readiness('production',self.state))
 def test_missing_required_shell_asset_blocks_release(self):
  for path in ['/live-voice-client.js','/billing-catalog.js']:
   with self.subTest(path=path):
    value=self.responses.pop(path)
    with self.assertRaisesRegex(RuntimeError,'http_smoke_failed_'):
     runtime.verify_readiness('production',self.state)
    self.responses[path]=value
 def test_anonymous_file_access_still_blocks_release(self):
  self.responses['/api/files']=(200,{'files':[]},{})
  with self.assertRaisesRegex(RuntimeError,'http_smoke_failed_/api/files'):
   runtime.verify_readiness('production',self.state)
 def test_wrong_release_or_cache_policy_still_blocks_release(self):
  self.responses['/app-release.json']=(200,{'release':'wrong'},{'Cache-Control':'no-store'})
  with self.assertRaisesRegex(RuntimeError,'client_update_release_mismatch'):
   runtime.verify_readiness('production',self.state)
  self.responses['/app-release.json']=(200,{'release':self.health['release']},{})
  with self.assertRaisesRegex(RuntimeError,'client_update_release_mismatch'):
   runtime.verify_readiness('production',self.state)
 def test_front_proxy_must_hide_shutdown_endpoint(self):
  with patch.dict(runtime.STAGES['production'],{'front':self.server.server_port}):
   self.assertTrue(runtime.verify_readiness('production',self.state,front=True))
   self.responses['/__notebook/shutdown']=(200,'exposed',{})
   with self.assertRaisesRegex(RuntimeError,'control_endpoint_exposed'):
    runtime.verify_readiness('production',self.state,front=True)

if __name__=='__main__':unittest.main()
