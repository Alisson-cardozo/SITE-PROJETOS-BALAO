"""Debug das imagens de rifa na VPS."""
from __future__ import annotations
import os
import paramiko

HOST = "187.77.33.118"
USER = "root"
PASSWORD = os.environ.get("VPS_PASSWORD", "")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)

def run(cmd):
    _, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(out)
    if err.strip():
        print("ERR:", err)

print("=== nginx config ===")
run("cat /etc/nginx/sites-enabled/* 2>/dev/null || cat /etc/nginx/conf.d/*.conf 2>/dev/null || echo 'nao encontrado'")

print("\n=== arquivos de rifa ===")
run("find /var/www/cardozo-projetos/backend/public/uploads/rifas/ -type f | head -10")

print("\n=== teste HTTP uploads ===")
run("curl -sS -o /dev/null -w 'status: %{http_code}\\n' http://localhost/uploads/rifas/ || true")

print("\n=== primeira rifa no banco ===")
run("""php -r '
require "/var/www/cardozo-projetos/backend/bootstrap/app.php";
$pdo = App\Support\Db::connection();
$stmt = $pdo->query("SELECT id, nome, foto1_path, foto2_path FROM rifas LIMIT 3");
foreach ($stmt->fetchAll() as $r) {
    echo $r["id"] . " | " . $r["nome"] . " | foto1: " . $r["foto1_path"] . " | foto2: " . $r["foto2_path"] . "\n";
}
'""")

client.close()
print("\nDone.")
