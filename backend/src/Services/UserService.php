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
        // pending_payment: cadastro novo fica bloqueado ate pagar um plano
        // (ver PaidAccessMiddleware) -- vira 'active' quando um pagamento e
        // aprovado (PagamentoService::reconcileRow -> grantAccess()).
        $stmt = Db::connection()->prepare(
            'INSERT INTO users (name, email, password_hash, role, status)
             VALUES (:name, :email, :password_hash, "user", "pending_payment")'
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

    public function updateEmail(int $userId, string $newEmail): void
    {
        $stmt = Db::connection()->prepare('UPDATE users SET email = :email WHERE id = :id');
        $stmt->execute(['id' => $userId, 'email' => $newEmail]);
    }

    public function listAll(): array
    {
        return Db::connection()->query('SELECT * FROM users ORDER BY created_at DESC')->fetchAll();
    }

    public function updateStatus(int $userId, string $status): void
    {
        $stmt = Db::connection()->prepare('UPDATE users SET status = :status WHERE id = :id');
        $stmt->execute(['id' => $userId, 'status' => $status]);
    }

    /** "Liberar acesso": reativa a conta e define ate quando o acesso vale. */
    public function grantAccess(int $userId, int $days): void
    {
        $stmt = Db::connection()->prepare(
            "UPDATE users SET status = 'active', access_expires_at = DATE_ADD(NOW(), INTERVAL :days DAY) WHERE id = :id"
        );
        $stmt->execute(['id' => $userId, 'days' => $days]);
    }

    /**
     * @throws \PDOException se o usuario tiver dados vinculados (moldes, rifas etc —
     *   FK com ON DELETE RESTRICT de proposito, pra nunca apagar historico junto)
     */
    public function delete(int $userId): void
    {
        $stmt = Db::connection()->prepare('DELETE FROM users WHERE id = :id');
        $stmt->execute(['id' => $userId]);
    }

    public function toPublicArray(array $user): array
    {
        return [
            'id' => (int) $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'role' => $user['role'],
            'status' => $user['status'],
            'access_expires_at' => $user['access_expires_at'] ?? null,
            'created_at' => $user['created_at'] ?? null,
        ];
    }
}
