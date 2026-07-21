-- Schema inicial do sistema novo (do zero)
-- Modulo: autenticacao (login/cadastro) + base para os demais modulos

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  status ENUM('active', 'blocked') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
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
-- ALTER TABLE rifas ADD COLUMN chave_pix VARCHAR(140) NULL AFTER whatsapp_contato;
