# Deploy VPS — sistema-novo (Alisson Projetos)

## O que sobe
- **nginx** na porta 80 (frontend React + proxy `/api`)
- **php-fpm 8.3** com o backend
- Banco: MySQL remoto Hostinger (`srv802.hstgr.io`) — já no `.env`

## Admin inicial
- Email: `admin@alissonprojetos.com`
- Senha: `Admin@123`

## Na VPS (com Docker)

```bash
# 1) copiar a pasta sistema-novo para a VPS (scp/rsync)
# 2) configurar env
cp deploy/.env.production.example .env
nano .env   # ajuste APP_URL / FRONTEND_URL / e-mail

# 3) build do frontend (no PC ou na VPS com Node 18+)
cd frontend && npm ci && npm run build && cd ..

# 4) subir
docker compose up -d --build

# 5) schema / migrations
docker compose exec api php database/migrate.php
```

## Hostinger painel (Docker Compose)
1. No hPanel → VPS → Docker Compose
2. Projeto: `alisson-projetos`
3. Cole o conteúdo de `docker-compose.yml` **ou** envie a pasta completa e rode os comandos acima via SSH

## Checklist DNS
- A do domínio apontando pro IP da VPS
- Depois: HTTPS (Caddy/Traefik/certbot) — opcional no primeiro deploy

## Logs
```bash
docker compose logs -f web
docker compose logs -f api
```
