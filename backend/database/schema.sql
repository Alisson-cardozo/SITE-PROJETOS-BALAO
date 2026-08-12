-- Schema inicial do sistema novo (do zero)
-- Modulo: autenticacao (login/cadastro) + base para os demais modulos

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  -- pending_payment: cadastro novo que ainda nao pagou nenhum plano -- login
  -- funciona normalmente (pra ele conseguir chegar na aba "Solicitar Acesso"),
  -- mas nenhuma outra funcionalidade fica liberada (ver PaidAccessMiddleware).
  -- Vira 'active' automaticamente quando um pagamento e aprovado.
  status ENUM('active', 'blocked', 'pending_payment') NOT NULL DEFAULT 'active',
  -- NULL = acesso sem prazo. Setado quando o admin "libera acesso por X dias"
  -- (ou quando um pagamento e aprovado) — login passa a ser recusado depois
  -- dessa data mesmo com status='active'.
  access_expires_at DATETIME NULL,
  -- Inicio do periodo de acesso atual ("assinou em"). Fixado junto com
  -- access_expires_at no grantAccess. NULL = nunca teve acesso liberado.
  access_started_at DATETIME NULL,
  -- Plano do ultimo pagamento aprovado — define quais abas o usuario pode
  -- usar (ver PlanoService::abasForPlanoId / AbaAccessMiddleware). NULL =
  -- sem plano especifico (acesso liberado manualmente pelo admin via
  -- AdminUserController::grantAccess, ou conta de antes dessa coluna
  -- existir) -- tratado como SEM restricao, libera todas as abas. Sem FK
  -- pra `planos` aqui de proposito: a tabela `planos` so e definida mais
  -- abaixo neste arquivo (planos.created_by/updated_by ja referenciam
  -- `users`, entao um FK aqui criaria dependencia circular na 1a execucao
  -- do schema num banco novo).
  plano_id BIGINT UNSIGNED NULL,
  active_session_id VARCHAR(255) NULL,
  session_device VARCHAR(255) NULL,
  session_created_at DATETIME NULL,
  last_activity DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_plano_id (plano_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Coluna nova pra quem ja tinha rodado o schema antes dessa mudanca — rode
-- manualmente uma unica vez (MySQL nao aceita "ADD COLUMN IF NOT EXISTS"
-- nessa forma). Instalacao nova ja nasce com a coluna via CREATE TABLE acima.
-- Sem ponto-e-virgula no exemplo de proposito, ver nota no fim do arquivo:
-- ALTER TABLE users ADD COLUMN access_expires_at DATETIME NULL AFTER status

-- Idem pro ENUM de status ganhar 'pending_payment' num banco que ja tinha a
-- tabela `users` (instalacao nova ja nasce certa via CREATE TABLE acima):
-- ALTER TABLE users MODIFY COLUMN status ENUM('active', 'blocked', 'pending_payment') NOT NULL DEFAULT 'active'

-- Idem pro plano_id (planos por aba) num banco que ja tinha `users`:
-- ALTER TABLE users ADD COLUMN plano_id BIGINT UNSIGNED NULL AFTER access_expires_at, ADD KEY idx_users_plano_id (plano_id)

CREATE TABLE IF NOT EXISTS api_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  device VARCHAR(255) NULL,
  last_used_at DATETIME NULL,
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_tokens_hash (token_hash),
  KEY idx_api_tokens_user (user_id),
  CONSTRAINT fk_api_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- ADMIN INICIAL DO SISTEMA
-- Email: admin@alissonprojetos.com
-- Senha: Admin@123
-- Troque a senha pelo painel assim que o login estiver no ar.
-- =========================================================
INSERT INTO users (name, email, password_hash, role, status)
SELECT
  'Administrador',
  'admin@alissonprojetos.com',
  '$2y$12$8R4Im/Fesk5F.gjtBOXX4u6B7tkKOV573SIF4TxFQAtRLo/UJFQby',
  'admin',
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE email = 'admin@alissonprojetos.com'
);

CREATE TABLE IF NOT EXISTS molds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(180) NOT NULL,
  modelo VARCHAR(80) NOT NULL,
  quantidade_gomos INT UNSIGNED NOT NULL,
  bainha_cm DECIMAL(10, 2) NOT NULL,
  altura_total_cm DECIMAL(10, 2) NOT NULL DEFAULT 0,
  pontos_json JSON NOT NULL,
  -- plotter_config_json (legado): substituido pela tabela mold_projects (um molde
  -- pode ter varios projetos plotados agora). Mantida na tabela so pra nao quebrar
  -- instalacoes existentes - o codigo novo nao le nem escreve mais nela.
  plotter_config_json JSON NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_molds_created_by (created_by),
  KEY idx_molds_updated_by (updated_by),
  KEY idx_molds_nome (nome),
  CONSTRAINT fk_molds_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_molds_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Um molde (padrao/tabela) pode ter VARIOS projetos plotados (configuracoes de
-- taco diferentes salvas separadamente) — plotar de novo NUNCA sobrescreve um
-- projeto existente, sempre cria um novo.
CREATE TABLE IF NOT EXISTS mold_projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mold_id BIGINT UNSIGNED NOT NULL,
  plotter_config_json JSON NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mold_projects_mold (mold_id),
  KEY idx_mold_projects_created_by (created_by),
  KEY idx_mold_projects_updated_by (updated_by),
  CONSTRAINT fk_mold_projects_mold FOREIGN KEY (mold_id) REFERENCES molds(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mold_projects_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_mold_projects_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migra os projetos que ja existiam (1 por molde, guardados direto em
-- molds.plotter_config_json) pra virarem o primeiro projeto de cada molde na
-- tabela nova. So roda uma vez por molde (NOT EXISTS evita duplicar se o
-- migrate.php rodar de novo).
INSERT INTO mold_projects (mold_id, plotter_config_json, created_by, updated_by, created_at, updated_at)
SELECT m.id, m.plotter_config_json, m.updated_by, m.updated_by, m.updated_at, m.updated_at
FROM molds m
WHERE m.plotter_config_json IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM mold_projects mp WHERE mp.mold_id = m.id);

-- Modulo Bandeiras: imagem taqueada (pixelada) numa grade, com tamanho real
-- fisico (cm) e tabela de cores contada/nomeada. Cada linha e um projeto de
-- bandeira completo e independente (grade + paleta ja salvas).
CREATE TABLE IF NOT EXISTS bandeiras (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(180) NOT NULL,
  largura_cm DECIMAL(10, 2) NOT NULL,
  altura_cm DECIMAL(10, 2) NOT NULL,
  largura_px INT UNSIGNED NOT NULL,
  altura_px INT UNSIGNED NOT NULL,
  grid_json JSON NOT NULL,
  color_table_json JSON NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bandeiras_created_by (created_by),
  KEY idx_bandeiras_updated_by (updated_by),
  CONSTRAINT fk_bandeiras_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_bandeiras_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Modulo "3D e Fotos": modelos de referencia so pra preview 3D (torno a
-- partir do perfil de pontos). Tabela separada de `molds` de proposito —
-- `molds` guarda o padrao de corte de UM gomo pra plotagem real (Plotter/
-- Bandeiras), o que nao serve pra gerar o solido 3D certo. Nao aparece na
-- Galeria de Moldes nem em nenhum outro modulo, so no seletor do "3D e Fotos".
CREATE TABLE IF NOT EXISTS modelos_3d (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(180) NOT NULL,
  quantidade_gomos INT UNSIGNED NOT NULL,
  altura_total_cm DECIMAL(10, 2) NOT NULL DEFAULT 0,
  pontos_json JSON NOT NULL,
  -- Oculto some da lista pra usuario comum, mas o admin (ou quem criou)
  -- continua vendo pra poder desfazer — mesmo dono/admin que ja edita e exclui.
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_modelos_3d_created_by (created_by),
  KEY idx_modelos_3d_updated_by (updated_by),
  KEY idx_modelos_3d_nome (nome),
  CONSTRAINT fk_modelos_3d_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_modelos_3d_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Coluna nova pra quem ja tinha rodado o schema antes dessa mudanca — MySQL
-- (ao contrario do MariaDB) nao aceita "ADD COLUMN IF NOT EXISTS" nessa forma,
-- entao rode essa linha manualmente uma unica vez num banco que ja tinha a
-- tabela `modelos_3d` (instalacao nova ja nasce com a coluna via CREATE TABLE
-- acima). Sem ponto-e-virgula no exemplo de proposito, ver nota no fim do arquivo:
-- ALTER TABLE modelos_3d ADD COLUMN hidden TINYINT(1) NOT NULL DEFAULT 0 AFTER pontos_json

-- Modulo Rifas: configuracao de pagamento por usuario (token do Mercado Pago
-- guardado criptografado — ver App\Support\Crypto). 1 linha por usuario.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id BIGINT UNSIGNED NOT NULL,
  mercado_pago_token_encrypted TEXT NULL,
  mercado_pago_webhook_secret_encrypted TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comunicados (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  titulo VARCHAR(255) NOT NULL,
  conteudo TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comunicado_views (
  user_id BIGINT UNSIGNED NOT NULL,
  comunicado_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, comunicado_id),
  KEY idx_comunicado_views_comunicado (comunicado_id),
  CONSTRAINT fk_comunicado_views_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_comunicado_views_comunicado FOREIGN KEY (comunicado_id) REFERENCES comunicados(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notificacoes internas do admin (hoje: uma por venda aprovada). `dados_json`
-- guarda o detalhe pra renderizar o historico (nome/email do cliente, plano,
-- valor, metodo, pagamento_id) sem depender de JOINs. `lida` marca visto.
CREATE TABLE IF NOT EXISTS notificacoes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo VARCHAR(30) NOT NULL DEFAULT 'pagamento',
  titulo VARCHAR(255) NOT NULL,
  mensagem TEXT NOT NULL,
  dados_json TEXT NULL,
  lida TINYINT(1) NOT NULL DEFAULT 0,
  lida_em DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notificacoes_lida (lida),
  KEY idx_notificacoes_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inscricoes de Web Push (um registro por dispositivo/navegador do admin que
-- ativou notificacoes). `endpoint` e a URL do push service. p256dh/auth sao as
-- chaves da subscription usadas pra criptografar o payload (RFC 8291).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_subscriptions_endpoint (endpoint),
  KEY idx_push_subscriptions_user (user_id),
  CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rifas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(180) NOT NULL,
  slug VARCHAR(200) NOT NULL,
  descricao TEXT NOT NULL,
  foto1_path VARCHAR(255) NULL,
  foto2_path VARCHAR(255) NULL,
  foto3_path VARCHAR(255) NULL,
  valor_numero DECIMAL(10, 2) NOT NULL,
  quantidade_numeros INT UNSIGNED NOT NULL,
  modo_sorteio ENUM('caixa_federal', 'sistema') NOT NULL,
  modo_termino ENUM('data', 'vender_tudo') NOT NULL,
  data_termino DATETIME NULL,
  forma_recebimento ENUM('manual', 'mercado_pago') NOT NULL,
  whatsapp_contato VARCHAR(30) NULL,
  chave_pix VARCHAR(140) NULL,
  status ENUM('ativa', 'finalizada', 'cancelada') NOT NULL DEFAULT 'ativa',
  numero_sorteado INT UNSIGNED NULL,
  sorteado_em TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rifas_slug (slug),
  KEY idx_rifas_created_by (created_by),
  KEY idx_rifas_status (status),
  CONSTRAINT fk_rifas_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_rifas_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rifa_compradores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rifa_id BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(180) NOT NULL,
  whatsapp VARCHAR(30) NOT NULL,
  email VARCHAR(180) NULL,
  quantidade_numeros INT UNSIGNED NOT NULL,
  valor_total DECIMAL(10, 2) NOT NULL,
  forma_pagamento ENUM('manual', 'mercado_pago') NOT NULL,
  status ENUM('aguardando_pagamento', 'pago', 'expirado', 'cancelado') NOT NULL DEFAULT 'aguardando_pagamento',
  mp_payment_id VARCHAR(64) NULL,
  expira_em DATETIME NULL,
  pago_em TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rifa_compradores_rifa (rifa_id),
  KEY idx_rifa_compradores_status (status),
  CONSTRAINT fk_rifa_compradores_rifa FOREIGN KEY (rifa_id) REFERENCES rifas(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uma linha por numero da rifa, pre-criada inteira na hora que a rifa e
-- criada (INSERT em lote 1..quantidade_numeros, todas 'disponivel'). Isso
-- torna a trava de concorrencia (2 compradores no mesmo numero) e a conta de
-- "quantos ainda restam" simples e atomicas via UPDATE/SELECT ... FOR UPDATE,
-- sem precisar calcular contra um intervalo.
CREATE TABLE IF NOT EXISTS rifa_numeros (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rifa_id BIGINT UNSIGNED NOT NULL,
  numero INT UNSIGNED NOT NULL,
  status ENUM('disponivel', 'reservado', 'vendido') NOT NULL DEFAULT 'disponivel',
  comprador_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rifa_numeros_rifa_numero (rifa_id, numero),
  KEY idx_rifa_numeros_rifa_status (rifa_id, status),
  KEY idx_rifa_numeros_comprador (comprador_id),
  CONSTRAINT fk_rifa_numeros_rifa FOREIGN KEY (rifa_id) REFERENCES rifas(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rifa_numeros_comprador FOREIGN KEY (comprador_id) REFERENCES rifa_compradores(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Precos promocionais por quantidade, editaveis a qualquer momento pelo dono
-- (ex: vender mais rapido no fim da rifa). Dois tipos:
-- 'pacote'  -> quantidade EXATA por um valor_total fixo (ex: 5 numeros = R$4,40)
-- 'faixa'   -> a partir de uma quantidade MINIMA, cada numero sai por
--              valor_unidade (ex: 10+ numeros = R$0,89 cada)
-- Nao se aplica a rifa com modo_sorteio = 'caixa_federal' (bloqueado na validacao).
CREATE TABLE IF NOT EXISTS rifa_promocoes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rifa_id BIGINT UNSIGNED NOT NULL,
  tipo ENUM('pacote', 'faixa') NOT NULL,
  quantidade INT UNSIGNED NOT NULL,
  valor_total DECIMAL(10, 2) NULL,
  valor_unidade DECIMAL(10, 2) NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rifa_promocoes_rifa (rifa_id, ativo),
  CONSTRAINT fk_rifa_promocoes_rifa FOREIGN KEY (rifa_id) REFERENCES rifas(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fotos deixaram de ser obrigatorias na criacao da rifa. O CREATE TABLE acima
-- ja nasce com as colunas NULL pra instalacao nova. Os MODIFY abaixo cobrem
-- bancos que rodaram o schema antes dessa mudanca (rodar de novo e idempotente).
ALTER TABLE rifas MODIFY foto1_path VARCHAR(255) NULL;
ALTER TABLE rifas MODIFY foto2_path VARCHAR(255) NULL;
ALTER TABLE rifas MODIFY foto3_path VARCHAR(255) NULL;

-- Pix automatico (Mercado Pago) foi retirado — toda rifa recebe no modo
-- manual, com o dono informando a propria chave Pix pro cliente pagar direto
-- e depois mandar o comprovante por WhatsApp. Coluna nova pra quem rodou o
-- schema antes dessa mudanca — MySQL (ao contrario do MariaDB) nao aceita
-- "ADD COLUMN IF NOT EXISTS" nessa forma, entao rode essa linha manualmente
-- uma unica vez num banco que ja tinha a tabela `rifas` (dai em diante o
-- CREATE TABLE acima ja cobre instalacoes novas):
-- ALTER TABLE rifas ADD COLUMN chave_pix VARCHAR(140) NULL AFTER whatsapp_contato
-- (sem ponto-e-virgula de proposito nesses exemplos comentados -- migrate.php
-- parte o arquivo ingenuamente por ponto-e-virgula, entao um exemplo com um
-- no fim quebraria o proximo statement real ao ser executado)

-- Configuracao global do sistema (linha unica, id sempre 1): redes sociais do
-- admin (mostradas no rodape pra quem estiver logado) e a lista de abas do
-- menu que o admin escolheu esconder dos usuarios comuns. hidden_nav_items_json
-- guarda um array JSON de ids (ex: '["bandeiras","baixar-app"]') como TEXT,
-- decodificado em PHP -- mesmo padrao ja usado em `molds.pontos_json`.
CREATE TABLE IF NOT EXISTS system_settings (
  id TINYINT UNSIGNED NOT NULL,
  telegram VARCHAR(255) NULL,
  instagram VARCHAR(255) NULL,
  whatsapp VARCHAR(255) NULL,
  hidden_nav_items_json TEXT NULL,
  -- Rotulo opcional pra mostrar no lugar de uma aba ESCONDIDA na lista de
  -- abas de cada plano (tela "Solicitar Acesso" e checklist do admin em
  -- Planos) -- ex.: {"profissionais":"Em breve"}. So faz sentido/e exibido
  -- quando o id tambem esta em hidden_nav_items_json (ver SolicitarAcessoPage
  -- e AdminTabsPage). JSON objeto (id => texto), nao array.
  nav_item_labels_json TEXT NULL,
  -- Tutoriais das abas: JSON objeto mapeando ID da aba para {show, video_url}
  tutorials_json TEXT NULL,
  -- Credenciais do Mercado Pago (dono do sistema, compartilhadas por todos os
  -- planos). O access token e uma credencial de API de verdade, entao vai
  -- criptografado em repouso (Crypto::encrypt, chave = APP_KEY) -- nunca
  -- decodificado de volta pro frontend, so um booleano informando se ja foi
  -- configurado. O valor/dias de cada plano ficam na tabela `planos` (varios
  -- planos possiveis, ex: mensal/anual), nao aqui.
  mercado_pago_public_key VARCHAR(255) NULL,
  mercado_pago_access_token_encrypted TEXT NULL,
  -- Chaves VAPID do Web Push (geradas uma unica vez pelo WebPushService). A
  -- publica vai pro frontend (pushManager.subscribe). A privada assina o JWT
  -- VAPID e vai criptografada em repouso (Crypto::encrypt, chave = APP_KEY).
  vapid_public_key VARCHAR(255) NULL,
  vapid_private_key_encrypted TEXT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_system_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Colunas novas pra quem ja tinha rodado o schema antes dessa mudanca — MySQL
-- (ao contrario do MariaDB) nao aceita "ADD COLUMN IF NOT EXISTS" nessa forma,
-- entao rode essas linhas manualmente uma unica vez num banco que ja tinha a
-- tabela `system_settings` (instalacao nova ja nasce com elas via CREATE
-- TABLE acima). Sem ponto-e-virgula nos exemplos de proposito, ver nota no
-- fim do arquivo:
-- ALTER TABLE system_settings ADD COLUMN tutorials_json TEXT NULL AFTER nav_item_labels_json
-- ALTER TABLE system_settings ADD COLUMN mercado_pago_public_key VARCHAR(255) NULL AFTER hidden_nav_items_json
-- ALTER TABLE system_settings ADD COLUMN mercado_pago_access_token_encrypted TEXT NULL AFTER mercado_pago_public_key
-- ALTER TABLE system_settings ADD COLUMN nav_item_labels_json TEXT NULL AFTER hidden_nav_items_json
-- Se o banco ainda tiver as colunas plano_valor/plano_dias_acesso de uma
-- versao anterior (substituidas pela tabela `planos` abaixo), rode:
-- ALTER TABLE system_settings DROP COLUMN plano_valor
-- ALTER TABLE system_settings DROP COLUMN plano_dias_acesso

-- Catalogo de planos pagos (admin cadastra quantos quiser, ex: mensal/anual).
-- Um plano com pagamentos ja registrados nao pode ser excluido (FK RESTRICT
-- em `pagamentos.plano_id`) -- o admin desativa (ativo=0) em vez de excluir.
CREATE TABLE IF NOT EXISTS planos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(120) NOT NULL,
  valor DECIMAL(10, 2) NOT NULL,
  dias_acesso INT UNSIGNED NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  show_in_ranking TINYINT(1) NOT NULL DEFAULT 0,
  sales_override_count INT UNSIGNED NOT NULL DEFAULT 0,
  -- Lista JSON dos ids de aba que esse plano libera (ex.: '["moldes","bandeiras"]',
  -- mesmos ids usados em hidden_nav_items_json/AbaAccessMiddleware). NULL =
  -- libera TODAS as abas -- planos criados antes dessa coluna existir
  -- continuam liberando tudo, sem quebrar quem ja paga (ver PlanoService).
  abas_json TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_planos_created_by (created_by),
  KEY idx_planos_updated_by (updated_by),
  CONSTRAINT fk_planos_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_planos_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Idem pro abas_json (planos por aba) num banco que ja tinha `planos`:
-- ALTER TABLE planos ADD COLUMN abas_json TEXT NULL AFTER ativo

-- Cobrancas Mercado Pago (Pix ou cartao de credito) por usuario/plano. `valor`
-- e uma copia do preco do plano no momento do pagamento (o preco do plano pode
-- mudar depois sem afetar cobrancas ja criadas). `mp_payment_id` so e preenchido
-- depois que o Mercado Pago aceita a cobranca -- unico, mas MySQL permite varios
-- NULL num UNIQUE KEY, entao uma cobranca que falhou ao criar (nunca chegou
-- a ter um id do MP) nao trava a unicidade. `metodo` distingue Pix de cartao;
-- `qr_code`/`qr_code_base64` so sao preenchidos no Pix (cartao fica NULL).
-- `parcelas` so faz sentido no cartao (Pix e sempre 1).
CREATE TABLE IF NOT EXISTS pagamentos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  plano_id BIGINT UNSIGNED NOT NULL,
  valor DECIMAL(10, 2) NOT NULL,
  status ENUM('pendente', 'aprovado', 'rejeitado') NOT NULL DEFAULT 'pendente',
  metodo VARCHAR(20) NOT NULL DEFAULT 'pix',
  parcelas TINYINT UNSIGNED NOT NULL DEFAULT 1,
  mp_payment_id VARCHAR(64) NULL,
  qr_code TEXT NULL,
  qr_code_base64 MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pagamentos_mp_payment_id (mp_payment_id),
  KEY idx_pagamentos_user (user_id),
  KEY idx_pagamentos_status (status),
  CONSTRAINT fk_pagamentos_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pagamentos_plano FOREIGN KEY (plano_id) REFERENCES planos(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Se o banco ja tinha a tabela `pagamentos` de uma versao anterior (so Pix),
-- rode essas linhas manualmente UMA vez pra habilitar o cartao de credito
-- (instalacao nova ja nasce com elas via CREATE TABLE acima). ATENCAO: prod e
-- local sao bancos separados -- rode nos DOIS. Sem ponto-e-virgula de proposito:
-- ALTER TABLE pagamentos ADD COLUMN metodo VARCHAR(20) NOT NULL DEFAULT 'pix' AFTER status
-- ALTER TABLE pagamentos ADD COLUMN parcelas TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER metodo

-- Loja: vitrine de produtos digitais avulsos (aba admin-only) -- cada produto
-- e um item UNICO (nao e SKU/estoque), com no maximo 4 imagens, um valor e um
-- link (pra onde os arquivos ja estao hospedados, ex: Google Drive) que o
-- sistema manda por email so depois do pagamento aprovado. "reservado" e um
-- hold curto enquanto o Pix de um comprador especifico esta pendente (evita
-- 2 pessoas pagando pelo mesmo produto ao mesmo tempo) -- expira sozinho (ver
-- LojaProdutoService::liberarReservasExpiradas) se o Pix nao for pago.
CREATE TABLE IF NOT EXISTS loja_produtos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(180) NOT NULL,
  descricao TEXT NULL,
  valor DECIMAL(10, 2) NOT NULL,
  link_arquivo VARCHAR(500) NOT NULL,
  imagem1_path VARCHAR(255) NULL,
  imagem2_path VARCHAR(255) NULL,
  imagem3_path VARCHAR(255) NULL,
  imagem4_path VARCHAR(255) NULL,
  status ENUM('disponivel', 'reservado', 'vendido') NOT NULL DEFAULT 'disponivel',
  reservado_email VARCHAR(180) NULL,
  reserva_expira_em DATETIME NULL,
  comprador_email VARCHAR(180) NULL,
  vendido_em TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_loja_produtos_status (status),
  CONSTRAINT fk_loja_produtos_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loja_produtos_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pix da Loja (Mercado Pago) -- mesmo padrao/servico de `pagamentos`
-- (Planos), so que sem usuario logado (o comprador e um visitante publico,
-- identificado so pelo email que ele digitou na hora de comprar).
CREATE TABLE IF NOT EXISTS loja_pagamentos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  produto_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(180) NOT NULL,
  valor DECIMAL(10, 2) NOT NULL,
  status ENUM('pendente', 'aprovado', 'rejeitado') NOT NULL DEFAULT 'pendente',
  mp_payment_id VARCHAR(64) NULL,
  qr_code TEXT NULL,
  qr_code_base64 MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_loja_pagamentos_mp_payment_id (mp_payment_id),
  KEY idx_loja_pagamentos_produto (produto_id),
  -- ON DELETE CASCADE de proposito (diferente de fk_pagamentos_plano) -- um
  -- produto da Loja e um item avulso, descartavel: o admin precisa poder
  -- excluir um produto (mesmo com tentativas de pagamento falhas/pendentes
  -- associadas) sem tomar erro de integridade. comprador_email/vendido_em ja
  -- ficam salvos direto em loja_produtos, entao o essencial de "quem comprou"
  -- nao se perde enquanto o produto no catalogo existir.
  CONSTRAINT fk_loja_pagamentos_produto FOREIGN KEY (produto_id) REFERENCES loja_produtos(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Projetos do Plotter Riscado (Lek + edicao na aba Criar). state_json guarda
-- parametros do lek, canvas paint e snapshot SVG. MEDIUMTEXT aguenta imagens
-- embutidas no canvas (base64) sem estourar o limite do tipo JSON nativo.
CREATE TABLE IF NOT EXISTS riscado_projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(180) NOT NULL,
  modelo_key VARCHAR(180) NOT NULL DEFAULT '',
  modelo_nome VARCHAR(180) NOT NULL DEFAULT '',
  altura_cm DECIMAL(10, 2) NOT NULL DEFAULT 300,
  quantidade_gomos INT NOT NULL DEFAULT 16,
  bainha_cm DECIMAL(10, 2) NOT NULL DEFAULT 1,
  state_json MEDIUMTEXT NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_riscado_projects_created_by (created_by),
  KEY idx_riscado_projects_updated_by (updated_by),
  KEY idx_riscado_projects_updated_at (updated_at),
  CONSTRAINT fk_riscado_projects_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_riscado_projects_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Projetos de Lanternagem de Bojo (Acabamentos). state_json guarda a grade de
-- cores (1 celula = 1 lanterna) e as opcoes de exibicao (bolinha, linhas de
-- gomo/divisao etc) -- nao e imagem, e um arquivo editavel que reabre na
-- mesma tela pra continuar o desenho.
CREATE TABLE IF NOT EXISTS lanterna_projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(180) NOT NULL,
  gomos INT NOT NULL DEFAULT 32,
  lanternas_por_gomo INT NOT NULL DEFAULT 2,
  lanternas_subindo INT NOT NULL DEFAULT 16,
  state_json MEDIUMTEXT NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lanterna_projects_created_by (created_by),
  KEY idx_lanterna_projects_updated_by (updated_by),
  KEY idx_lanterna_projects_updated_at (updated_at),
  CONSTRAINT fk_lanterna_projects_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_lanterna_projects_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
