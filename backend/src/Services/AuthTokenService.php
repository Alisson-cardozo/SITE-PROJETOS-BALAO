<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

final class AuthTokenService
{
    public function issue(int $userId): string
    {
        $token = bin2hex(random_bytes(32));
        $hash = hash('sha256', $token);

        $stmt = Db::connection()->prepare(
            'INSERT INTO api_tokens (user_id, token_hash, created_at) VALUES (:user_id, :token_hash, NOW())'
        );
        $stmt->execute([
            'user_id' => $userId,
            'token_hash' => $hash,
        ]);

        return $token;
    }

    public function userIdForToken(string $token): ?int
    {
        $hash = hash('sha256', $token);

        $stmt = Db::connection()->prepare(
            'SELECT user_id FROM api_tokens
             WHERE token_hash = :hash AND (expires_at IS NULL OR expires_at > NOW())
             LIMIT 1'
        );
        $stmt->execute(['hash' => $hash]);
        $row = $stmt->fetch();

        if ($row === false) {
            return null;
        }

        Db::connection()
            ->prepare('UPDATE api_tokens SET last_used_at = NOW() WHERE token_hash = :hash')
            ->execute(['hash' => $hash]);

        return (int) $row['user_id'];
    }

    public function revoke(string $token): void
    {
        $hash = hash('sha256', $token);
        Db::connection()
            ->prepare('DELETE FROM api_tokens WHERE token_hash = :hash')
            ->execute(['hash' => $hash]);
    }
}
