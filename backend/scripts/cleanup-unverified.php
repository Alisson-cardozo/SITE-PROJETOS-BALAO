<?php

declare(strict_types=1);

/**
 * Exclui contas de usuario que entraram no sistema, receberam o card de
 * confirmacao de e-mail e nao validaram dentro do prazo (1h). Admin nunca e
 * afetado. Rodar por cron (ex: a cada 10 min):
 *
 *   *\/10 * * * * php /var/www/cardozo-projetos/backend/scripts/cleanup-unverified.php >> /var/log/cleanup-unverified.log 2>&1
 */

require_once __DIR__ . '/../bootstrap/app.php';

use App\Services\UserService;

$removed = (new UserService())->deleteExpiredUnverified();
echo date('Y-m-d H:i:s') . " - contas removidas por falta de confirmacao: {$removed}\n";
