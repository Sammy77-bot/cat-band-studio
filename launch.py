"""Start/reuse the local studio, then open the browser once the server is ready."""
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser

root=Path(__file__).resolve().parent
def ready():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8766/api/health',timeout=1) as response:
            return response.status==200
    except Exception:
        return False

if not ready():
    (root/'.runtime').mkdir(exist_ok=True)
    log=open(root/'.runtime/server.log','ab')
    process=subprocess.Popen([sys.executable,'-u',str(root/'server.py')],cwd=root,stdout=log,stderr=log,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    (root/'.runtime/server.pid').write_text(str(process.pid))
    for _ in range(40):
        if ready():break
        if process.poll() is not None:raise SystemExit('服务未能启动，请查看 .runtime/server.log')
        time.sleep(.25)
    else:raise SystemExit('服务启动超时，请稍后访问 http://127.0.0.1:8766')
if '--no-browser' not in sys.argv:
    webbrowser.open('http://127.0.0.1:8766')
print('CatBand ready: http://127.0.0.1:8766')
