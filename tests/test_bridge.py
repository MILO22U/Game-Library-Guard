import json, os, tempfile, unittest, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
import host
class BridgeTests(unittest.TestCase):
 def test_reject_nonread(self): self.assertEqual(host.handle({'action':'delete'})['error'],'Unsupported request')
 def test_reads(self):
  with tempfile.TemporaryDirectory() as tmp:
   old=host.LIB
   try:
    host.LIB=Path(tmp)/'library.json'; host.LIB.write_text(json.dumps({'games':[{'name':'Dino Crisis','source':'GOG'}]}))
    self.assertEqual(host.handle({'action':'get_library','backend':'sdk'})['games'][0]['source'],'GOG')
   finally:host.LIB=old
 def test_missing_db_reader(self):
  old=host.READER
  try:
   host.READER=Path('nonexistent-reader.exe')
   self.assertIn('reader missing',host.handle({'action':'get_library','db_path':'portable/games.db'})['error'])
  finally:host.READER=old
 def test_invalid_db_path(self):
  self.assertIn('Invalid games.db path',host.handle({'action':'get_library','db_path':42})['error'])
 def test_unsupported_backend(self):
  self.assertIn('Unsupported',host.handle({'action':'get_library','backend':'sqlite'})['error'])
 def test_missing_export(self):
  old=host.LIB
  try:
   host.LIB=Path('does-not-exist-library.json')
   self.assertIn('SDK export unavailable',host.handle({'action':'get_library','backend':'sdk'})['error'])
  finally:host.LIB=old
 def test_invalid_exports(self):
  with tempfile.TemporaryDirectory() as tmp:
   old=host.LIB
   try:
    host.LIB=Path(tmp)/'library.json'
    for payload in ['{','null','{}','{"games":[{}]}','{"games":[{"name":"X"}]}']:
     host.LIB.write_text(payload,encoding='utf-8')
     self.assertIn('error',host.handle({'action':'get_library','backend':'sdk'}))
    host.LIB.write_text('{"games":[]}',encoding='utf-8')
    self.assertEqual(host.handle({'action':'get_library','backend':'sdk'})['games'],[])
   finally:host.LIB=old
if __name__=='__main__': unittest.main()
