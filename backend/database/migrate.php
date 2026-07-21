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

echo "Schema aplicado com sucesso.\n";
