<?php

declare(strict_types=1);

namespace App\Support;

use App\Core\Application;
use PDO;

final class Db
{
    private static ?PDO $connection = null;

    public static function connection(): PDO
    {
        if (self::$connection instanceof PDO) {
            return self::$connection;
        }

        $app = Application::instance();
        $host = $app->env('DB_HOST', '127.0.0.1');
        $port = $app->env('DB_PORT', '3306');
        $database = $app->env('DB_DATABASE', '');
        $username = $app->env('DB_USERNAME', 'root');
        $password = $app->env('DB_PASSWORD', '');

        $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";

        self::$connection = new PDO($dsn, $username, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        // Garante leitura/gravacao de TIMESTAMP no horario de Brasilia
        self::$connection->exec("SET time_zone = '-03:00'");

        return self::$connection;
    }
}
