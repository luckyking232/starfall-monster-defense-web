from hashlib import sha256
from http.client import HTTPConnection
import io
from pathlib import Path
import sys
from threading import Thread
from unittest import TestCase
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import dev


class DevCLI(TestCase):
    def test_only_pinned_origin_and_rehashed_payload(self):
        data=b'fake exact asset'
        spec={'url':'https://github.com'+dev.FIRST,'size':len(data),'sha256':sha256(data).hexdigest()}
        class R(io.BytesIO): headers={}
        class Mock:
            def open(self,*args,**kwargs): return R(data)
        with patch.object(dev,'build_opener',return_value=Mock()) as opened:
            self.assertEqual(dev.download_input(spec),data)
            with self.assertRaises(ValueError):
                dev.download_input({**spec,'sha256':'0'*64})
            with self.assertRaises(ValueError):
                dev.download_input({**spec,'url':'https://example.net'+dev.FIRST})
            redirect=opened.call_args[0][0]
            with self.assertRaises(ValueError):
                redirect.redirect_request(None,None,302,None,{},'https://example.net/asset')
        self.assertEqual(opened.call_count,2)

    def test_only_allowlisted_loopback_routes_and_hosts(self):
        routes=dev.static_routes({'xingluo-monsters-defense/index.html':b'example',
                                 'xingluo-monsters-defense/engine.wasm':b'fake'})
        with dev.server(routes,0) as s:
            thread=Thread(target=s.serve_forever,daemon=True)
            thread.start()
            self.addCleanup(thread.join)
            self.addCleanup(s.shutdown)
            def request(method,url,headers=None):
                c=HTTPConnection('127.0.0.1',s.server_port,timeout=2)
                try:
                    c.request(method,url,headers=headers or {})
                    response=c.getresponse()
                    return response.status,response.getheader('Content-Type'),response.read()
                finally: c.close()
            self.assertEqual(request('GET','/play/')[::2],(200,b'example'))
            self.assertEqual(request('HEAD','/play/engine.wasm'),(200,'application/wasm',b''))
            self.assertEqual(request('GET','/play/../index.html')[0],404)
            self.assertEqual(request('GET','/play/',{'Host':'wrong.test'})[0],403)
            self.assertEqual(request('GET','/play/',{'Origin':'https://outside.test'})[0],403)
            self.assertNotEqual(request('POST','/play/')[0],200)
