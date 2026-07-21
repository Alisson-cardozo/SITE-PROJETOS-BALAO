<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;
use App\Support\Password;

final class UserService
{
    public function findByEmail(string $email): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();

        return $user === false ? null : $user;
    }

    public function findById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $user = $stmt->fetch();

        return $user === false ? null : $user;
    }

    public function create(string $name, string $email, string $password): array
    {
        $stmt = Db::connection()->prepare(
            'INSERT INTO users (name, email, password_hash, role, status)
             VALUES (:name, :email, :password_hash, "user", "active")'
        );
        $stmt->execute([
            'name' => $name,
            'email' => $email,
            'password_hash' => Password::hash($password),
        ]);

        $id = (int) Db::connection()->lastInsertId();

        return $this->findById($id) ?? [];
    }

    public function updatePassword(int $userId, string $newPassword): void
    {
        $stmt = Db::connection()->prepare('UPDATE users SET password_hash = :password_hash WHERE id = :id');
        $stmt->execute([
            'id' => $userId,
            'password_hash' => Password::hash($newPassword),
        ]);
    }

    public function toPublicArray(array $user): array
    {
        return [
            'id' => (int) $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'role' => $user['role'],
            'status' => $user['status'],
        ];
    }
}
