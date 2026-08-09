"""Corrige o nginx na VPS para servir imagens de /uploads/ corretamente."""
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

print("=== arquivo nginx atual ===")
run("ls /etc/nginx/sites-enabled/")

# Le o conteudo atual
_, stdout, _ = client.exec_command("cat /etc/nginx/sites-enabled/alisson-projetos.fun 2>/dev/null || cat /etc/nginx/sites-enabled/default 2>/dev/null")
current = stdout.read().decode()
print(current[:200])

# Descobre o nome do arquivo
_, stdout, _ = client.exec_command("ls /etc/nginx/sites-enabled/")
site_file = stdout.read().decode().strip().split("\n")[0]
print(f"Arquivo: {site_file}")

# Corrige o nginx: adiciona ^~ no location /uploads/ para ter prioridade sobre regex
fix_cmd = r"""
python3 -c "
import re, subprocess

path = '/etc/nginx/sites-enabled/' + subprocess.check_output('ls /etc/nginx/sites-enabled/', shell=True).decode().strip().split('\n')[0]
with open(path) as f:
    content = f.read()

# Substitui 'location /uploads/' por 'location ^~ /uploads/' para ter prioridade sobre a regex de imagens
fixed = content.replace('location /uploads/', 'location ^~ /uploads/')

with open(path, 'w') as f:
    f.write(fixed)

print('Arquivo corrigido:', path)
print('location ^~ /uploads/ presente:', 'location ^~ /uploads/' in fixed)
"
"""

print("\n=== aplicando fix no nginx ===")
run(fix_cmd)

print("\n=== testando e recarregando nginx ===")
run("nginx -t && systemctl reload nginx && echo nginx_reloaded")

print("\n=== testando URL da foto ===")
run("curl -sS -o /dev/null -w 'status uploads: %{http_code}\\n' 'https://alisson-projetos.fun/uploads/rifas/ce5d96c6a6c8494d/foto1.png'")

client.close()
print("\nDone.")
