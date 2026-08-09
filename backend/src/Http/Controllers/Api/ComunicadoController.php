<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Support\Db;
use App\Support\Mailer;
use Throwable;

final class ComunicadoController
{
    /** Lista todos os comunicados (admin only) */
    public function index(Request $request): Response
    {
        $pdo = Db::connection();
        $sql = "
            SELECT 
                c.*, 
                COALESCE(COUNT(cv.user_id), 0) AS total_views 
            FROM comunicados c 
            LEFT JOIN comunicado_views cv ON cv.comunicado_id = c.id 
            GROUP BY c.id 
            ORDER BY c.created_at DESC
        ";
        $data = $pdo->query($sql)->fetchAll();

        return Response::json(['data' => $data]);
    }

    /** Cria novo comunicado e dispara e-mails (admin only) */
    public function store(Request $request): Response
    {
        $titulo = trim((string) $request->input('titulo', ''));
        $conteudo = trim((string) $request->input('conteudo', ''));
        $sendEmailTo = (string) $request->input('send_email_to', 'all'); // 'all' | 'selected'
        $filteredEmails = $request->input('emails'); // array of strings
        if (!is_array($filteredEmails)) {
            $filteredEmails = [];
        }

        if (mb_strlen($titulo) < 3) {
            return Response::json(['error' => 'O título precisa ter pelo menos 3 caracteres.'], 422);
        }
        if (mb_strlen($conteudo) < 5) {
            return Response::json(['error' => 'O conteúdo da mensagem precisa ter pelo menos 5 caracteres.'], 422);
        }

        $pdo = Db::connection();
        $pdo->beginTransaction();

        try {
            $stmt = $pdo->prepare('INSERT INTO comunicados (titulo, conteudo) VALUES (:titulo, :conteudo)');
            $stmt->execute(['titulo' => $titulo, 'conteudo' => $conteudo]);
            $id = (int) $pdo->lastInsertId();
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            return Response::json(['error' => 'Falha ao salvar comunicado: ' . $e->getMessage()], 500);
        }

        // Buscar os clientes com base na selecao (sem restriçao de status)
        if ($sendEmailTo === 'selected') {
            if (!empty($filteredEmails)) {
                $placeholders = implode(',', array_fill(0, count($filteredEmails), '?'));
                $stmtUsers = $pdo->prepare("SELECT email, name FROM users WHERE role = 'user' AND email IN ($placeholders)");
                $stmtUsers->execute($filteredEmails);
                $users = $stmtUsers->fetchAll();
            } else {
                $users = [];
            }
        } else {
            $stmtUsers = $pdo->query("SELECT email, name FROM users WHERE role = 'user'");
            $users = $stmtUsers->fetchAll();
        }

        // Enviar os e-mails (disparo assíncrono simulado via try/catch por e-mail para não travar a requisição em caso de falha de um SMTP)
        $sentCount = 0;
        $failedCount = 0;
        foreach ($users as $user) {
            if (empty($user['email'])) {
                continue;
            }
            try {
                Mailer::send($user['email'], $titulo, [
                    'body' => $conteudo,
                    'html' => $this->buildHtmlTemplate($user['name'] ?? '', $titulo, $conteudo)
                ]);
                $sentCount++;
            } catch (Throwable $e) {
                $failedCount++;
            }
        }

        $comunicado = $pdo->query("SELECT *, 0 as total_views FROM comunicados WHERE id = {$id}")->fetch();

        return Response::json([
            'data' => $comunicado,
            'email_stats' => [
                'sent' => $sentCount,
                'failed' => $failedCount
            ]
        ]);
    }

    /** Retorna comunicado mais recente nao lido (auth user) */
    public function getPending(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        if ($userId === 0) {
            return Response::json(['data' => null]);
        }

        $pdo = Db::connection();
        $sql = "
            SELECT c.* 
            FROM comunicados c 
            LEFT JOIN comunicado_views cv ON cv.comunicado_id = c.id AND cv.user_id = :user_id 
            WHERE cv.user_id IS NULL 
            ORDER BY c.created_at DESC 
            LIMIT 1
        ";
        $stmt = $pdo->prepare($sql);
        $stmt->execute(['user_id' => $userId]);
        $row = $stmt->fetch();

        return Response::json(['data' => $row !== false ? $row : null]);
    }

    /** Marca o comunicado como lido pelo usuario logado (auth user) */
    public function markAsRead(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $comunicadoId = (int) ($request->param('id') ?? 0);

        if ($userId === 0 || $comunicadoId === 0) {
            return Response::json(['error' => 'Parâmetros inválidos.'], 400);
        }

        $pdo = Db::connection();
        try {
            $stmt = $pdo->prepare('INSERT IGNORE INTO comunicado_views (user_id, comunicado_id) VALUES (:user_id, :comunicado_id)');
            $stmt->execute(['user_id' => $userId, 'comunicado_id' => $comunicadoId]);
        } catch (Throwable $e) {
            return Response::json(['error' => 'Falha ao marcar como lido.'], 500);
        }

        return Response::json(['ok' => true]);
    }

    private function buildHtmlTemplate(string $name, string $title, string $content): string
    {
        $safeName = htmlspecialchars($name);
        $safeTitle = htmlspecialchars($title);
        $formattedContent = nl2br(htmlspecialchars($content));

        return <<<HTML
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{$safeTitle}</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 20px; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e1e8ed; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <!-- Header -->
        <div style="background-color: #1e3c72; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: bold;">Comunicado Importante</h1>
        </div>
        <!-- Body -->
        <div style="padding: 24px; line-height: 1.6;">
            <p style="font-size: 16px; font-weight: bold; margin-top: 0;">Olá, {$safeName}!</p>
            <h2 style="font-size: 18px; color: #1e3c72; margin-top: 20px; margin-bottom: 12px; border-bottom: 2px solid #f4f6f9; padding-bottom: 8px;">{$safeTitle}</h2>
            <p style="font-size: 15px; color: #4a5568;">{$formattedContent}</p>
            
            <div style="margin-top: 30px; padding: 12px; background-color: #f7fafc; border-left: 4px solid #1e3c72; font-size: 13px; color: #718096; border-radius: 4px;">
                Este é um informativo oficial enviado para todos os clientes ativos do sistema Alisson Projetos.
            </div>
        </div>
        <!-- Footer -->
        <div style="background-color: #f7fafc; padding: 16px; text-align: center; border-top: 1px solid #edf2f7; font-size: 12px; color: #a0aec0;">
            © 2026 Alisson Projetos. Todos os direitos reservados.
        </div>
    </div>
</body>
</html>
HTML;
    }
}
