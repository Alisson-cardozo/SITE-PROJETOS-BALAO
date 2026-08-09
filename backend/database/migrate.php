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

echo "Schema aplicado com sucesso.\n";
