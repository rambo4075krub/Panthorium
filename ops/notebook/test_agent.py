import contextlib, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import agent
class DeploymentRecoveryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.host=self.root/'host'
  self.host.mkdir();self.stage='staging';(self.host/self.stage).mkdir()
  self.patch=patch.multiple(agent,ROOT=self.root,HOST=self.host);self.patch.start()
  self.ap=patch.object(agent,'active_path',lambda s:self.host/s/'active.json');self.ap.start()
  self.old={'stage':self.stage,'sha':'a'*40,'path':'old','port':8820,'maintenance':False}
  self.new={'stage':self.stage,'sha':'b'*40,'path':'new','port':8821,'maintenance':False}
  agent.atomic(agent.active_path(self.stage),self.old)
 def tearDown(self):self.ap.stop();self.patch.stop();self.temp.cleanup()
 def journal(self,phase):
  j={'old':self.old,'new':self.new,'phase':phase,'operation':str(self.root/'op'),'finalBackup':'backup'}
  agent.atomic(agent.journal_path(self.stage),j);return j
 def test_release_identity_checks_environment_and_full_commit(self):
  h={'ok':True,'release':'notebook-staging-'+('a'*12),'deployment':{'sha':'a'*40,'stage':'staging'}}
  self.assertTrue(agent.matches(h,'staging','a'*40))
  self.assertFalse(agent.matches(h,'production','a'*40))
  self.assertFalse(agent.matches(h,'staging',('a'*12)+('b'*28)))
 def test_exact_head_gate(self):
  refs={'refs/heads/staging':'a'*40,'refs/heads/deploy/notebook-staging':'b'*40}
  self.assertIsNone(agent.eligible(refs,'staging'))
  refs['refs/heads/staging']='b'*40;self.assertEqual(agent.eligible(refs,'staging'),'b'*40)
  self.assertIsNone(agent.eligible(refs,'production'))
  refs['refs/heads/staging']='bad';self.assertIsNone(agent.eligible(refs,'staging'))
 def test_exposed_release_never_restores_data(self):
  self.journal('candidate_verified');agent.atomic(agent.active_path(self.stage),self.new)
  with patch.object(agent,'start_backend'),patch.object(agent,'start_edge'),patch.object(agent,'verify_readiness'),patch.object(agent,'restore_before_exposure') as restore:
   agent.recover(self.stage);restore.assert_not_called()
  self.assertEqual(agent.read(agent.journal_path(self.stage))['phase'],'complete')
 def test_exposed_unhealthy_release_does_not_restore_data(self):
  self.journal('candidate_verified');agent.atomic(agent.active_path(self.stage),self.new)
  with patch.object(agent,'start_backend',side_effect=RuntimeError('unhealthy')),patch.object(agent,'restore_before_exposure') as restore:
   with self.assertRaises(RuntimeError):agent.recover(self.stage)
   restore.assert_not_called()
  self.assertEqual(agent.read(agent.active_path(self.stage))['sha'],self.new['sha'])
 def test_unexposed_failure_restores_under_maintenance(self):
  self.journal('candidate_starting');agent.atomic(agent.active_path(self.stage),{**self.old,'maintenance':True})
  calls=[]
  def restore(*args):
   self.assertTrue(agent.read(agent.active_path(self.stage))['maintenance']);calls.append('restore');return 'failed_copy'
  with patch.object(agent,'start_backend'),patch.object(agent,'stop_backend'),patch.object(agent,'start_edge'),patch.object(agent,'verify_readiness'),patch.object(agent,'restore_before_exposure',side_effect=restore):
   agent.recover(self.stage)
  self.assertEqual(calls,['restore']);self.assertEqual(agent.read(agent.active_path(self.stage)),self.old)
  self.assertEqual(agent.read(agent.journal_path(self.stage))['phase'],'rolled_back')
 def test_interrupted_backup_preserves_current_data(self):
  self.journal('draining');agent.atomic(agent.active_path(self.stage),{**self.old,'maintenance':True})
  with patch.object(agent,'start_backend'),patch.object(agent,'start_edge'),patch.object(agent,'restore_before_exposure') as restore:
   agent.recover(self.stage);restore.assert_not_called()
  self.assertEqual(agent.read(agent.active_path(self.stage)),self.old)
 def test_active_route_write_is_complete_json(self):
  for n in range(10):agent.atomic(agent.active_path(self.stage),{**self.old,'counter':n})
  self.assertEqual(agent.read(agent.active_path(self.stage))['counter'],9)
  self.assertFalse(list((self.host/self.stage).glob('*.tmp')))
if __name__=='__main__':unittest.main()
