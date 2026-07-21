<?php

declare(strict_types=1);

namespace App\Support;

final class Env
{
    /** @return array<string,string> */
    public static function load(string $path): array
    {
        $env = [];
        if (!is_file($path)) {
            return $env;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }

            $key = trim(substr($line, 0, $pos));
            $value = trim(substr($line, $pos + 1));
            $value = trim($value, "\"'");
            $env[$key] = $value;
        }

        return $env;
    }
}
