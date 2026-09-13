<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap/app.php';

use App\Support\Db;

$schemaPath = __DIR__ . '/schema.sql';
$sql = file_get_contents($schemaPath);
if ($sql === false) {
    fwrite(STDERR, "Nao foi possivel ler schema.sql\n");
    exit(1);
}

$statements = array_filter(array_map('trim', explode(';', $sql)));

$pdo = Db::connection();
foreach ($statements as $statement) {
    if ($statement === '') {
        continue;
    }
    $pdo->exec($statement);
}

// Coluna tutorials_json para salvar videos de tutorial por aba
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM system_settings LIKE 'tutorials_json'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE system_settings ADD COLUMN tutorials_json TEXT NULL");
        echo "Coluna tutorials_json adicionada com sucesso.\n";
    }
} catch (Throwable $e) {
    // Tabela system_settings pode nao existir ainda
}

// Colunas de sessao ativa para o mecanismo de 1 conta = 1 sessao
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'active_session_id'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE users 
            ADD COLUMN active_session_id VARCHAR(255) NULL AFTER plano_id,
            ADD COLUMN session_device VARCHAR(255) NULL AFTER active_session_id,
            ADD COLUMN session_created_at DATETIME NULL AFTER session_device,
            ADD COLUMN last_activity DATETIME NULL AFTER session_created_at");
        echo "Colunas de sessao adicionadas na tabela users com sucesso.\n";
    }
} catch (Throwable $e) {
    // Tabela users pode nao existir ainda
}

// Colunas de ranking para tabela planos
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM planos LIKE 'show_in_ranking'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE planos 
            ADD COLUMN show_in_ranking TINYINT(1) NOT NULL DEFAULT 0 AFTER ativo,
            ADD COLUMN sales_override_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER show_in_ranking");
        echo "Colunas de ranking adicionadas na tabela planos com sucesso.\n";
    }
} catch (Throwable $e) {
    // Tabela planos pode nao existir ainda
}

// Coluna device para api_tokens
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM api_tokens LIKE 'device'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE api_tokens ADD COLUMN device VARCHAR(255) NULL AFTER token_hash");
        echo "Coluna device adicionada na tabela api_tokens com sucesso.\n";
    }
} catch (Throwable $e) {
    // Tabela api_tokens pode nao existir ainda
}

// Colunas de forma de pagamento (Pix x cartao de credito) para pagamentos
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM pagamentos LIKE 'metodo'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE pagamentos
            ADD COLUMN metodo VARCHAR(20) NOT NULL DEFAULT 'pix' AFTER status,
            ADD COLUMN parcelas TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER metodo");
        echo "Colunas metodo/parcelas adicionadas na tabela pagamentos com sucesso.\n";
    }
} catch (Throwable $e) {
    // Tabela pagamentos pode nao existir ainda
}

// Chaves VAPID do Web Push (notificacoes push do admin) em system_settings
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM system_settings LIKE 'vapid_public_key'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE system_settings
            ADD COLUMN vapid_public_key VARCHAR(255) NULL AFTER mercado_pago_access_token_encrypted,
            ADD COLUMN vapid_private_key_encrypted TEXT NULL AFTER vapid_public_key");
        echo "Colunas VAPID adicionadas na tabela system_settings com sucesso.\n";
    }
} catch (Throwable $e) {
    // Tabela system_settings pode nao existir ainda
}

// Data de inicio do acesso ("assinou em") na tabela users. access_expires_at
// (fim) ja existia; essa guarda o INICIO do periodo atual — fixado quando o
// admin libera acesso / o pagamento e aprovado (UserService::grantAccess).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'access_started_at'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE users ADD COLUMN access_started_at DATETIME NULL AFTER access_expires_at");
        echo "Coluna access_started_at adicionada na tabela users.\n";
        // Backfill: usa a data do ULTIMO pagamento aprovado de cada usuario.
        try {
            $pdo->exec("
                UPDATE users u
                JOIN (
                    SELECT p.user_id, MAX(COALESCE(p.paid_at, p.created_at)) AS started
                    FROM pagamentos p
                    WHERE p.status = 'aprovado'
                    GROUP BY p.user_id
                ) last ON last.user_id = u.id
                SET u.access_started_at = last.started
                WHERE u.access_started_at IS NULL
            ");
            echo "Backfill de access_started_at a partir dos pagamentos aprovados.\n";
        } catch (Throwable $e) {
            // pagamentos pode nao ter paid_at em bancos antigos — ignora backfill
        }
    }
} catch (Throwable $e) {
    // Tabela users pode nao existir ainda
}

// Verificacao de e-mail por codigo de 6 digitos (colunas + garantia de que
// todo admin ja nasce validado — senao o proprio dono se trancaria fora).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'email_verified_at'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE users
            ADD COLUMN email_verified_at DATETIME NULL AFTER email,
            ADD COLUMN email_verification_code VARCHAR(6) NULL AFTER email_verified_at,
            ADD COLUMN email_verification_deadline DATETIME NULL AFTER email_verification_code");
        echo "Colunas de verificacao de e-mail adicionadas na tabela users.\n";
    }
    // Idempotente: admin sempre validado. Roda sempre (cobre instalacao nova,
    // onde as colunas ja vieram do CREATE TABLE e o bloco acima nao executa).
    $pdo->exec("UPDATE users SET email_verified_at = NOW() WHERE role = 'admin' AND email_verified_at IS NULL");
} catch (Throwable $e) {
    // Tabela users pode nao existir ainda
}

// Cupom aplicado no pagamento (pra registrar o uso quando aprovar).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM pagamentos LIKE 'cupom_id'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE pagamentos ADD COLUMN cupom_id BIGINT UNSIGNED NULL AFTER plano_id");
        echo "Coluna cupom_id adicionada na tabela pagamentos.\n";
    }
} catch (Throwable $e) {
    // Tabela pagamentos pode nao existir ainda
}

// Ultima data em que o usuario recebeu o e-mail de reengajamento (campanha a
// cada 3 dias). NULL = nunca recebeu.
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'last_reengage_at'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE users ADD COLUMN last_reengage_at DATETIME NULL AFTER last_activity");
        echo "Coluna last_reengage_at adicionada na tabela users.\n";
    }
} catch (Throwable $e) {
    // Tabela users pode nao existir ainda
}

// Config da solicitacao de molde sob encomenda: valor por metro + video tutorial.
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM system_settings LIKE 'valor_metro_molde'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE system_settings
            ADD COLUMN valor_metro_molde DECIMAL(10,2) NOT NULL DEFAULT 0,
            ADD COLUMN solicitacao_video_url VARCHAR(500) NULL");
        echo "Colunas de solicitacao de molde adicionadas em system_settings.\n";
    }
} catch (Throwable $e) {
    // Tabela system_settings pode nao existir ainda
}

// Flag: quais moldes ficam disponiveis pra solicitacao publica.
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM molds LIKE 'disponivel_solicitacao'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE molds ADD COLUMN disponivel_solicitacao TINYINT(1) NOT NULL DEFAULT 0");
        echo "Coluna disponivel_solicitacao adicionada na tabela molds.\n";
    }
} catch (Throwable $e) {
    // Tabela molds pode nao existir ainda
}

// Solicitacao de molde agora usa o catalogo (/data.json): guarda a chave do
// modelo + categoria, e mold_id passa a ser opcional.
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM solicitacoes_molde LIKE 'modelo_key'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE solicitacoes_molde
            ADD COLUMN modelo_key VARCHAR(150) NULL AFTER mold_id,
            ADD COLUMN categoria VARCHAR(60) NULL AFTER modelo_key,
            MODIFY COLUMN mold_id BIGINT UNSIGNED NULL");
        echo "Colunas modelo_key/categoria adicionadas em solicitacoes_molde.\n";
    }
} catch (Throwable $e) {
    // Tabela pode nao existir ainda
}

// Limite total de usos por cupom (NULL = ilimitado).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM cupons LIKE 'max_usos'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE cupons ADD COLUMN max_usos INT UNSIGNED NULL AFTER is_campanha");
        echo "Coluna max_usos adicionada na tabela cupons.\n";
    }
} catch (Throwable $e) {
    // Tabela cupons pode nao existir ainda
}

// Liga/desliga a pagina publica de solicitacao de molde (venda com IA).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM system_settings LIKE 'solicitacao_molde_ativa'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE system_settings ADD COLUMN solicitacao_molde_ativa TINYINT(1) NOT NULL DEFAULT 1");
        echo "Coluna solicitacao_molde_ativa adicionada em system_settings.\n";
    }
} catch (Throwable $e) {
    // Tabela system_settings pode nao existir ainda
}

// Aba/ferramenta que o cliente esta usando agora (mostrado pro admin).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'current_view'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE users ADD COLUMN current_view VARCHAR(120) NULL");
        echo "Coluna current_view adicionada na tabela users.\n";
    }
} catch (Throwable $e) {
    // Tabela users pode nao existir ainda
}

// Config: exigir validacao de telefone (portao) — so vale se o admin ligar.
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM system_settings LIKE 'phone_validation_required'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE system_settings ADD COLUMN phone_validation_required TINYINT(1) NOT NULL DEFAULT 0");
        echo "Coluna phone_validation_required adicionada em system_settings.\n";
    }
} catch (Throwable $e) {
    // Tabela system_settings pode nao existir ainda
}

// Validacao de telefone por codigo no WhatsApp (igual a de e-mail).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'phone'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE users
            ADD COLUMN phone VARCHAR(30) NULL AFTER email,
            ADD COLUMN phone_verified_at DATETIME NULL AFTER phone,
            ADD COLUMN phone_verification_code VARCHAR(6) NULL AFTER phone_verified_at,
            ADD COLUMN phone_verification_deadline DATETIME NULL AFTER phone_verification_code");
        echo "Colunas de validacao de telefone adicionadas na tabela users.\n";
    }
} catch (Throwable $e) {
    // Tabela users pode nao existir ainda
}

// Ultimo IP (rede/wifi) do cliente — capturado no login, mostrado pro admin.
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'last_ip'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE users ADD COLUMN last_ip VARCHAR(45) NULL AFTER last_activity");
        echo "Coluna last_ip adicionada na tabela users.\n";
    }
} catch (Throwable $e) {
    // Tabela users pode nao existir ainda
}

// Blocklist de e-mails: quem estiver aqui nao consegue logar nem criar conta.
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS blocked_emails (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(180) NOT NULL,
        motivo VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_blocked_emails (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
} catch (Throwable $e) {
    // ignora
}

// Link do canal do YouTube (mostrado pros clientes verem as funcionalidades).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM system_settings LIKE 'youtube'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE system_settings ADD COLUMN youtube VARCHAR(255) NULL AFTER whatsapp");
        echo "Coluna youtube adicionada em system_settings.\n";
    }
} catch (Throwable $e) {
    // Tabela system_settings pode nao existir ainda
}

// Troca de e-mail com confirmacao por codigo enviado pro e-mail NOVO.
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'pending_email'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE users
            ADD COLUMN pending_email VARCHAR(180) NULL AFTER email_verification_deadline,
            ADD COLUMN pending_email_code VARCHAR(6) NULL AFTER pending_email,
            ADD COLUMN pending_email_deadline DATETIME NULL AFTER pending_email_code");
        echo "Colunas de troca de e-mail (pending_email) adicionadas na tabela users.\n";
    }
} catch (Throwable $e) {
    // Tabela users pode nao existir ainda
}

// Assistente-IA Carla disponivel por plano (recurso a parte do plotter).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM planos LIKE 'carla_ia'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE planos ADD COLUMN carla_ia TINYINT(1) NOT NULL DEFAULT 0 AFTER abas_json");
        echo "Coluna carla_ia adicionada na tabela planos.\n";
    }
} catch (Throwable $e) {
    // Tabela planos pode nao existir ainda
}

// Chat do WhatsApp (aba "Mensagens" no admin) — conversas + historico.
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS whatsapp_conversations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        remote_jid VARCHAR(60) NOT NULL,
        contact_name VARCHAR(120) NULL,
        phone VARCHAR(30) NULL,
        last_message_preview VARCHAR(255) NULL,
        last_message_at DATETIME NULL,
        last_direction ENUM('in','out') NULL,
        unread_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_whatsapp_conversations_jid (remote_jid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        conversation_id BIGINT UNSIGNED NOT NULL,
        wa_message_id VARCHAR(120) NULL,
        direction ENUM('in','out') NOT NULL,
        body TEXT NULL,
        status VARCHAR(20) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_whatsapp_messages_conversation (conversation_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
} catch (Throwable $e) {
    // ignora
}

// Chatbot com fluxo visual (aba "Chatbot" no admin) — os nos/conexoes ficam
// salvos como JSON (flow_json); a sessao guarda em que no da conversa o
// cliente esta parado, esperando resposta.
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS chatbot_flows (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(120) NOT NULL,
        trigger_keyword VARCHAR(120) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 0,
        flow_json LONGTEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS chatbot_sessions (
        conversation_id BIGINT UNSIGNED NOT NULL,
        flow_id BIGINT UNSIGNED NOT NULL,
        current_node_id VARCHAR(80) NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (conversation_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
} catch (Throwable $e) {
    // ignora
}

// Historico de nos (pra opcao "voltar" do chatbot) + pausa do bot quando o
// cliente pede pra falar com um humano (aba "Mensagens" nao interrompe mais
// enquanto o admin conversa direto).
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM chatbot_sessions LIKE 'history_json'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE chatbot_sessions ADD COLUMN history_json TEXT NULL");
        echo "Coluna history_json adicionada na tabela chatbot_sessions.\n";
    }
} catch (Throwable $e) {
    // ignora
}
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM whatsapp_conversations LIKE 'bot_paused'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE whatsapp_conversations ADD COLUMN bot_paused TINYINT(1) NOT NULL DEFAULT 0");
        echo "Coluna bot_paused adicionada na tabela whatsapp_conversations.\n";
    }
} catch (Throwable $e) {
    // ignora
}

// Mensagem automatica por WhatsApp pra quem se cadastrou e nao ativou plano
// (aba Comunicação/WhatsApp do admin). Cooldown em `users.last_no_plan_msg_at`
// pra nao mandar em loop — igual o padrao ja usado em last_reengage_at.
try {
    $stmt = $pdo->query("SHOW COLUMNS FROM system_settings LIKE 'no_plan_msg_enabled'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE system_settings
            ADD COLUMN no_plan_msg_enabled TINYINT(1) NOT NULL DEFAULT 0,
            ADD COLUMN no_plan_msg_text TEXT NULL,
            ADD COLUMN no_plan_msg_delay_min INT UNSIGNED NOT NULL DEFAULT 60,
            ADD COLUMN no_plan_msg_repeat_min INT UNSIGNED NOT NULL DEFAULT 1440");
        echo "Colunas de mensagem automatica (sem plano) adicionadas em system_settings.\n";
    }
} catch (Throwable $e) {
    // Tabela system_settings pode nao existir ainda
}

try {
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'last_no_plan_msg_at'");
    if ($stmt->fetch() === false) {
        $pdo->exec("ALTER TABLE users ADD COLUMN last_no_plan_msg_at DATETIME NULL");
        echo "Coluna last_no_plan_msg_at adicionada na tabela users.\n";
    }
} catch (Throwable $e) {
    // Tabela users pode nao existir ainda
}

echo "Schema aplicado com sucesso.\n";
