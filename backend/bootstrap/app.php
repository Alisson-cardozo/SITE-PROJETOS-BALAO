<?php

declare(strict_types=1);

spl_autoload_register(function (string $class): void {
    $prefix = 'App\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $file = __DIR__ . '/../src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

require_once __DIR__ . '/../src/helpers.php';

use App\Core\Application;
use App\Support\Env;

date_default_timezone_set('America/Sao_Paulo');

$app = Application::instance();
$app->setEnv(Env::load(__DIR__ . '/../.env'));

require __DIR__ . '/../routes/api.php';

return $app;
