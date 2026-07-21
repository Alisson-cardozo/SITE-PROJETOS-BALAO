<?php

declare(strict_types=1);

namespace App\Support;

final class Password
{
    public static function hash(string $plain): string
    {
        return password_hash($plain, PASSWORD_BCRYPT);
    }

    public static function verify(string $plain, string $hash): bool
    {
        return password_verify($plain, $hash);
    }
}
