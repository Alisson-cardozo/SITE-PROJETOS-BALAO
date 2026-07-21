<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Application;
use App\Core\Request;
use App\Core\Response;
use App\Services\UserService;
use App\Support\Mailer;
use Throwable;

/**
 * Painel (LED/malha) — so envio por email. Nao tem CRUD/tabela no banco: o
 * PDF e sempre gerado no navegador (igual ao "Baixar PDF"), o cliente so
 * manda o arquivo + os dados basicos (nome, tamanho, malha, cores) pra
 * montar o corpo do email.
 */
final class PainelController
{
    private const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024;

    private UserService $users;

    public function __construct()
    {
        $this->users = new UserService();
    }

    public function sendEmail(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $clientEmail = trim((string) $request->input('client_email', ''));
        if (!filter_var($clientEmail, FILTER_VALIDATE_EMAIL)) {
            return Response::json(['error' => 'Informe um email valido do cliente.'], 422);
        }

        $nome = trim((string) $request->input('nome', ''));
        if ($nome === '') {
            return Response::json(['error' => 'Informe o nome do painel.'], 422);
        }
        $larguraCm = (float) $request->input('largura_cm', 0);
        $alturaCm = (float) $request->input('altura_cm', 0);
        $coresDistintas = (int) $request->input('cores_distintas', 0);
        $clientName = trim((string) $request->input('client_name', ''));
        $message = trim((string) $request->input('message', ''));

        $file = $_FILES['pdf'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return Response::json(['error' => 'Envie o PDF do painel.'], 422);
        }
        if ((int) ($file['size'] ?? 0) > self::MAX_PDF_SIZE_BYTES) {
            return Response::json(['error' => 'PDF muito grande (limite de 15MB).'], 422);
        }

        $binary = file_get_contents((string) $file['tmp_name']);
        if ($binary === false || $binary === '') {
            return Response::json(['error' => 'Nao foi possivel ler o PDF enviado.'], 500);
        }

        $filename = preg_replace('/[^A-Za-z0-9_\-.]/', '_', $nome) . '.pdf';

        $bodyLines = [];
        $bodyLines[] = $clientName !== '' ? "Ola, {$clientName}!" : 'Ola!';
        $bodyLines[] = '';
        if ($message !== '') {
            $bodyLines[] = $message;
            $bodyLines[] = '';
        }
        $bodyLines[] = "Segue em anexo o painel \"{$nome}\".";
        $bodyLines[] = '';
        $bodyLines[] = 'Dados do painel:';
        $bodyLines[] = "- Nome: {$nome}";
        $bodyLines[] = "- Tamanho real: {$larguraCm} x {$alturaCm} cm";
        $bodyLines[] = "- Cores distintas: {$coresDistintas}";
        $bodyLines[] = '';
        $bodyLines[] = 'Atenciosamente,';
        $bodyLines[] = 'Alisson Projetos';

        try {
            Mailer::send($clientEmail, "Seu painel: {$nome}", [
                'body' => implode("\n", $bodyLines),
                'html' => $this->buildEmailHtml($nome, $larguraCm, $alturaCm, $coresDistintas, $clientName, $message),
                'files' => [[
                    'filename' => $filename,
                    'contentType' => 'application/pdf',
                    'contentBase64' => base64_encode($binary),
                ]],
            ]);
        } catch (Throwable $exception) {
            return Response::json(['error' => 'Nao foi possivel enviar o email: ' . $exception->getMessage()], 502);
        }

        return Response::json(['ok' => true]);
    }

    private function buildEmailHtml(string $nome, float $larguraCm, float $alturaCm, int $coresDistintas, string $clientName, string $message): string
    {
        $e = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
        $formatCm = static fn (float $value): string => rtrim(rtrim(number_format($value, 1, ',', '.'), '0'), ',') . ' cm';

        $greeting = $clientName !== '' ? 'Ola, ' . $e($clientName) . '!' : 'Ola!';

        $messageBlock = '';
        if ($message !== '') {
            $messageBlock = <<<HTML
                <tr>
                  <td style="padding: 0 32px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f4f6fb; border-left: 3px solid #2563eb; border-radius: 6px;">
                      <tr>
                        <td style="padding: 14px 18px; font-size: 14px; line-height: 1.6; color: #374151; white-space: pre-line;">{$e($message)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
            HTML;
        }

        $nomeSafe = $e($nome);
        $tamanho = $e($formatCm($larguraCm) . ' x ' . $formatCm($alturaCm));
        $cores = $e((string) $coresDistintas);

        $frontendUrl = trim((string) (Application::instance()->env('FRONTEND_URL', '') ?? ''));
        $siteButton = '';
        if ($frontendUrl !== '') {
            $siteUrl = $e($frontendUrl);
            $siteButton = <<<HTML
                <tr>
                  <td style="padding: 0 32px 28px;" align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background: #2563eb; border-radius: 8px;">
                          <a href="{$siteUrl}" style="display: inline-block; padding: 12px 28px; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none;">Acessar o site</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
            HTML;
        }

        $stat = static fn (string $label, string $value): string => <<<HTML
            <td width="50%" style="padding: 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 8px;">
                <tr>
                  <td style="padding: 12px 16px;">
                    <div style="font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px;">{$label}</div>
                    <div style="font-size: 15px; font-weight: 700; color: #111827;">{$value}</div>
                  </td>
                </tr>
              </table>
            </td>
        HTML;

        return <<<HTML
            <!doctype html>
            <html lang="pt-BR">
              <body style="margin: 0; padding: 24px 12px; background: #eef1f6; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center">
                      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width: 560px; width: 100%; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
                        <tr>
                          <td style="background: #111827; padding: 20px 32px;">
                            <span style="font-size: 13px; font-weight: 700; letter-spacing: .06em; color: #ffffff;">CARDOZO PROJETOS</span>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 28px 32px 8px;">
                            <div style="font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 14px;">{$e($greeting)}</div>
                          </td>
                        </tr>
                        {$messageBlock}
                        <tr>
                          <td style="padding: 0 32px 20px; font-size: 14px; line-height: 1.6; color: #374151;">
                            Segue em anexo o painel <strong>&quot;{$nomeSafe}&quot;</strong>.
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 0 32px 28px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                {$stat('Nome', $nomeSafe)}
                                {$stat('Tamanho real', $tamanho)}
                              </tr>
                              <tr>
                                {$stat('Cores distintas', $cores)}
                              </tr>
                            </table>
                          </td>
                        </tr>
                        {$siteButton}
                        <tr>
                          <td style="padding: 20px 32px; border-top: 1px solid #eef0f3; font-size: 13px; color: #9ca3af;">
                            Atenciosamente,<br><strong style="color: #6b7280;">Alisson Projetos</strong>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </body>
            </html>
        HTML;
    }

    private function currentUser(Request $request): ?array
    {
        $userId = (int) $request->attribute('user_id', 0);
        if ($userId <= 0) {
            return null;
        }

        return $this->users->findById($userId);
    }
}
