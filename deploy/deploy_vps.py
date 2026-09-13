"""
Deploy sistema-novo para VPS Hostinger (alisson-projetos.fun).
Preserva .env e uploads existentes.
"""
from __future__ import annotations

import io
import os
import tarfile
import time
from pathlib import Path

import paramiko

HOST = "187.77.33.118"
USER = "root"
PASSWORD = os.environ.get("VPS_PASSWORD", "")
REMOTE_ROOT = "/var/www/cardozo-projetos"
LOCAL_ROOT = Path(__file__).resolve().parents[1]  # sistema-novo


def ssh_connect() -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    key_file = os.path.expanduser('~/.ssh/studyia_deploy_ed25519')
    if os.path.exists(key_file):
        client.connect(
            HOST,
            username=USER,
            key_filename=key_file,
            timeout=20,
            allow_agent=False,
        )
    else:
        client.connect(
            HOST,
            username=USER,
            password=PASSWORD,
            timeout=20,
            allow_agent=False,
            look_for_keys=False,
        )
    return client



def run(client: paramiko.SSHClient, cmd: str, check: bool = True) -> str:
    print(f"$ {cmd}")
    _i, stdout, stderr = client.exec_command(cmd, timeout=300)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out[-4000:])
    if err.strip():
        print("STDERR:", err[-2000:])
    if check and code != 0:
        raise RuntimeError(f"Command failed ({code}): {cmd}\n{err}")
    return out


def make_backend_tar() -> bytes:
    buf = io.BytesIO()
    backend = LOCAL_ROOT / "backend"
    skip_dirs = {".git", "node_modules", "storage", "uploads"}
    skip_files = {".env"}
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(backend):
            dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
            rel_root = Path(root).relative_to(backend)
            # keep empty dirs needed later
            for f in files:
                if f in skip_files:
                    continue
                if f.endswith(".log"):
                    continue
                full = Path(root) / f
                arc = Path("backend") / rel_root / f
                tar.add(full, arcname=str(arc).replace("\\", "/"))
        # ensure storage structure
        for empty in [
            "backend/storage/logs/.gitkeep",
            "backend/public/uploads/.gitkeep",
        ]:
            info = tarfile.TarInfo(name=empty)
            info.size = 0
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO())
    return buf.getvalue()


def make_frontend_tar() -> bytes:
    buf = io.BytesIO()
    dist = LOCAL_ROOT / "frontend" / "dist"
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, _dirs, files in os.walk(dist):
            for f in files:
                full = Path(root) / f
                rel = full.relative_to(dist)
                tar.add(full, arcname=str(Path("frontend-dist") / rel).replace("\\", "/"))
    return buf.getvalue()


def upload_bytes(sftp: paramiko.SFTPClient, data: bytes, remote_path: str) -> None:
    print(f"upload {remote_path} ({len(data) / 1024 / 1024:.2f} MB)")
    with sftp.file(remote_path, "wb") as rf:
        rf.write(data)


def main() -> None:
    assert (LOCAL_ROOT / "frontend" / "dist" / "index.html").is_file(), "frontend dist missing — run npm run build"
    assert (LOCAL_ROOT / "backend" / "public" / "index.php").is_file()

    client = ssh_connect()
    sftp = client.open_sftp()

    stamp = time.strftime("%Y%m%d-%H%M%S")
    print("=== backup ===")
    run(
        client,
        f"mkdir -p /var/backups/cardozo-projetos && "
        f"cp -a {REMOTE_ROOT}/backend /var/backups/cardozo-projetos/backend-{stamp} && "
        f"cp -a {REMOTE_ROOT}/frontend-dist /var/backups/cardozo-projetos/frontend-dist-{stamp} && "
        f"echo backup_ok",
    )

    print("=== pack local ===")
    backend_tar = make_backend_tar()
    frontend_tar = make_frontend_tar()

    print("=== upload tarballs ===")
    upload_bytes(sftp, backend_tar, f"/tmp/backend-{stamp}.tar.gz")
    upload_bytes(sftp, frontend_tar, f"/tmp/frontend-{stamp}.tar.gz")

    print("=== extract preserving env/uploads ===")
    run(
        client,
        f"""
set -e
# preserve critical
cp -a {REMOTE_ROOT}/backend/.env /tmp/cardozo.env.bak
if [ -d {REMOTE_ROOT}/backend/public/uploads ]; then
  cp -a {REMOTE_ROOT}/backend/public/uploads /tmp/cardozo-uploads.bak
fi

# replace backend code (not wiping uploads yet)
rm -rf {REMOTE_ROOT}/backend.new
mkdir -p {REMOTE_ROOT}/backend.new
tar -xzf /tmp/backend-{stamp}.tar.gz -C {REMOTE_ROOT}/backend.new --strip-components=1
# restore env
cp /tmp/cardozo.env.bak {REMOTE_ROOT}/backend.new/.env
# restore uploads if present
if [ -d /tmp/cardozo-uploads.bak ]; then
  rm -rf {REMOTE_ROOT}/backend.new/public/uploads
  mv /tmp/cardozo-uploads.bak {REMOTE_ROOT}/backend.new/public/uploads
fi
# swap
rm -rf {REMOTE_ROOT}/backend.old
mv {REMOTE_ROOT}/backend {REMOTE_ROOT}/backend.old
mv {REMOTE_ROOT}/backend.new {REMOTE_ROOT}/backend

# frontend
rm -rf {REMOTE_ROOT}/frontend-dist.new
mkdir -p {REMOTE_ROOT}/frontend-dist.new
tar -xzf /tmp/frontend-{stamp}.tar.gz -C {REMOTE_ROOT}/frontend-dist.new --strip-components=1
rm -rf {REMOTE_ROOT}/frontend-dist.old
mv {REMOTE_ROOT}/frontend-dist {REMOTE_ROOT}/frontend-dist.old
mv {REMOTE_ROOT}/frontend-dist.new {REMOTE_ROOT}/frontend-dist

# perms
chown -R www-data:www-data {REMOTE_ROOT}/backend {REMOTE_ROOT}/frontend-dist
chmod -R u+rwX,g+rwX {REMOTE_ROOT}/backend/storage {REMOTE_ROOT}/backend/public/uploads
find {REMOTE_ROOT}/backend -type f -name '*.php' -exec chmod 644 {{}} \\;
chmod 640 {REMOTE_ROOT}/backend/.env

# production env keys
php -r '
$p="{REMOTE_ROOT}/backend/.env";
$c=file_get_contents($p);
$repl=[
  "APP_ENV=local"=>"APP_ENV=production",
  "APP_DEBUG=true"=>"APP_DEBUG=false",
  "APP_URL=http://localhost:8080"=>"APP_URL=https://alisson-projetos.fun",
];
foreach($repl as $a=>$b){{ $c=str_replace($a,$b,$c); }}
if(strpos($c,"FRONTEND_URL=")!==false){{
  $c=preg_replace("/^FRONTEND_URL=.*$/m","FRONTEND_URL=https://alisson-projetos.fun",$c);
}} else {{
  $c.="\\nFRONTEND_URL=https://alisson-projetos.fun\\n";
}}
file_put_contents($p,$c);
echo "env_updated\\n";
'

# migrate schema (riscado_projects etc)
cd {REMOTE_ROOT}/backend && php database/migrate.php

# reload php-fpm
systemctl reload php8.3-fpm || service php8.3-fpm reload || true
nginx -t && systemctl reload nginx

# smoke tests
curl -sS -o /tmp/health.json -w "%{{http_code}}" https://alisson-projetos.fun/api/health || true
echo
cat /tmp/health.json 2>/dev/null; echo
curl -sS -o /dev/null -w "index:%{{http_code}}\\n" https://alisson-projetos.fun/
curl -sS -o /dev/null -w "lek:%{{http_code}}\\n" https://alisson-projetos.fun/lek.html
curl -sS -o /dev/null -w "data:%{{http_code}}\\n" https://alisson-projetos.fun/data.json
ls {REMOTE_ROOT}/frontend-dist/lek.html {REMOTE_ROOT}/backend/src/Services/RiscadoProjectService.php
echo DEPLOY_DONE
""",
    )

    sftp.close()
    client.close()
    print("All done.")


if __name__ == "__main__":
    main()
