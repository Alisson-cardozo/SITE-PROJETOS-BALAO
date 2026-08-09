import io
import os
import tarfile
import time
from pathlib import Path

import paramiko

HOST = "187.77.33.118"
USER = "root"
PASSWORD = os.environ.get("VPS_PASSWORD", "")
REMOTE = "/var/www/cardozo-projetos"
LOCAL = Path(__file__).resolve().parents[1]
DIST = LOCAL / "frontend" / "dist"


def main() -> None:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, _dirs, files in os.walk(DIST):
            for f in files:
                full = Path(root) / f
                rel = full.relative_to(DIST)
                tar.add(full, arcname=str(Path("frontend-dist") / rel).replace("\\", "/"))
    data = buf.getvalue()

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    remote_tar = f"/tmp/frontend-{int(time.time())}.tar.gz"
    with sftp.file(remote_tar, "wb") as rf:
        rf.write(data)
    sftp.close()

    cmd = f"""
set -e
rm -rf {REMOTE}/frontend-dist.new
mkdir -p {REMOTE}/frontend-dist.new
tar -xzf {remote_tar} -C {REMOTE}/frontend-dist.new --strip-components=1
rm -rf {REMOTE}/frontend-dist.old
mv {REMOTE}/frontend-dist {REMOTE}/frontend-dist.old
mv {REMOTE}/frontend-dist.new {REMOTE}/frontend-dist
chown -R www-data:www-data {REMOTE}/frontend-dist
nginx -t && systemctl reload nginx
curl -sS -o /dev/null -w "index:%{{http_code}}\\n" https://alisson-projetos.fun/
echo FRONTEND_DEPLOYED
"""
    _i, o, e = client.exec_command(cmd)
    print(o.read().decode())
    print(e.read().decode())
    client.close()


if __name__ == "__main__":
    main()
