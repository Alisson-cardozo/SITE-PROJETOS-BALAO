<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Application;
use App\Core\Request;
use App\Core\Response;
use App\Services\MoldProjectService;
use App\Services\MoldService;
use App\Services\UserService;
use App\Support\Mailer;
use Throwable;

final class MoldProjectController
{
    private const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024;
    private const MAX_CONFIG_JSON_BYTES = 200000;

    private MoldProjectService $projects;
    private MoldService $molds;
    private UserService $users;

    public function __construct()
    {
        $this->projects = new MoldProjectService();
        $this->molds = new MoldService();
        $this->users = new UserService();
    }

    public function index(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $items = $this->projects->listAll();
        $data = array_map(fn (array $project) => $this->withPermissions($project, $user), $items);

        return Response::json(['data' => $data]);
    }

    public function show(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $project = $this->projects->findById($id);
        if ($project === null) {
            return Response::json(['error' => 'Projeto nao encontrado.'], 404);
        }

        return Response::json(['data' => $this->withPermissions($project, $user)]);
    }

    /**
     * Cria um projeto NOVO pra este molde (rota aninhada em /api/molds/{id}/projects).
     * Nunca sobrescreve um projeto ja existente do mesmo molde.
     */
    public function store(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $moldId = (int) ($request->param('moldId') ?? 0);
        $mold = $this->molds->findRawById($moldId);
        if ($mold === null) {
            return Response::json(['error' => 'Molde nao encontrado.'], 404);
        }

        $config = $this->validateConfig($request);
        if (isset($config['error'])) {
            return Response::json(['error' => $config['error']], 422);
        }

        $project = $this->projects->create($moldId, $config['data'], (int) $user['id']);

        return Response::json(['data' => $this->withPermissions($project, $user)], 201);
    }

    /**
     * Atualiza a configuracao de UM projeto ja existente (usado ao editar via
     * "Modificar" em Meus Projetos — continua sendo o mesmo projeto).
     */
    public function update(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->projects->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Projeto nao encontrado.'], 404);
        }

        if (!$this->canEditExisting($existing, $user)) {
            return Response::json([
                'error' => 'Apenas quem criou o projeto pode editar.',
            ], 403);
        }

        $config = $this->validateConfig($request);
        if (isset($config['error'])) {
            return Response::json(['error' => $config['error']], 422);
        }

        $project = $this->projects->update($id, $config['data'], (int) $user['id']);
        if ($project === null) {
            return Response::json(['error' => 'Projeto nao encontrado.'], 404);
        }

        return Response::json(['data' => $this->withPermissions($project, $user)]);
    }

    public function destroy(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->projects->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Projeto nao encontrado.'], 404);
        }

        if (!$this->canDeleteExisting($existing, $user)) {
            return Response::json(['error' => 'Apenas quem criou o projeto ou um administrador pode excluir.'], 403);
        }

        $this->projects->delete($id);

        return Response::json(['ok' => true]);
    }

    public function sendEmail(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $project = $this->projects->findById($id);
        if ($project === null) {
            return Response::json(['error' => 'Projeto nao encontrado.'], 404);
        }

        $clientEmail = trim((string) $request->input('client_email', ''));
        if (!filter_var($clientEmail, FILTER_VALIDATE_EMAIL)) {
            return Response::json(['error' => 'Informe um email valido do cliente.'], 422);
        }

        $clientName = trim((string) $request->input('client_name', ''));
        $message = trim((string) $request->input('message', ''));

        $file = $_FILES['pdf'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return Response::json(['error' => 'Envie o PDF do molde.'], 422);
        }

        if ((int) ($file['size'] ?? 0) > self::MAX_PDF_SIZE_BYTES) {
            return Response::json(['error' => 'PDF muito grande (limite de 15MB).'], 422);
        }

        $binary = file_get_contents((string) $file['tmp_name']);
        if ($binary === false || $binary === '') {
            return Response::json(['error' => 'Nao foi possivel ler o PDF enviado.'], 500);
        }

        $filename = preg_replace('/[^A-Za-z0-9_\-.]/', '_', (string) $project['display_nome']) . '.pdf';

        $bodyLines = [];
        $bodyLines[] = $clientName !== '' ? "Ola, {$clientName}!" : 'Ola!';
        $bodyLines[] = '';
        if ($message !== '') {
            $bodyLines[] = $message;
            $bodyLines[] = '';
        }
        $bodyLines[] = "Segue em anexo o molde \"{$project['nome']}\" (modelo {$project['modelo']}), em pecas separadas.";
        $bodyLines[] = '';
        $bodyLines[] = 'Dados do molde:';
        $bodyLines[] = "- Nome: {$project['nome']}";
        $bodyLines[] = "- Modelo: {$project['modelo']}";
        $bodyLines[] = "- Tamanho: {$project['altura_total_cm']} cm";
        $bodyLines[] = "- Quantidade de gomos: {$project['quantidade_gomos']}";
        $bodyLines[] = '';
        $bodyLines[] = 'Atenciosamente,';
        $bodyLines[] = 'Alisson Projetos';

        try {
            Mailer::send($clientEmail, "Seu molde: {$project['nome']}", [
                'body' => implode("\n", $bodyLines),
                'html' => $this->buildEmailHtml($project, $clientName, $message),
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

    /**
     * @param array<string, mixed> $project
     */
    private function buildEmailHtml(array $project, string $clientName, string $message): string
    {
        $e = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
        $formatCm = static fn (mixed $value): string => rtrim(rtrim(number_format((float) $value, 1, ',', '.'), '0'), ',') . ' cm';

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

        $nome = $e((string) $project['nome']);
        $modelo = $e((string) $project['modelo']);
        $tamanho = $e($formatCm($project['altura_total_cm']));
        $gomos = $e((string) $project['quantidade_gomos']);

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
                            Segue em anexo o molde <strong>&quot;{$nome}&quot;</strong> (modelo {$modelo}), em pecas separadas.
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 0 32px 28px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                {$stat('Nome', $nome)}
                                {$stat('Modelo', $modelo)}
                              </tr>
                              <tr>
                                {$stat('Tamanho', $tamanho)}
                                {$stat('Gomos', $gomos)}
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

    private function canEditExisting(array $existing, array $user): bool
    {
        $isOwner = (int) $existing['created_by'] === (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';

        return $isOwner || $isAdmin;
    }

    private function canDeleteExisting(array $existing, array $user): bool
    {
        return $this->canEditExisting($existing, $user);
    }

    /**
     * @param array<string, mixed> $project
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    private function withPermissions(array $project, array $user): array
    {
        $userId = (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';
        $ownerId = (int) ($project['created_by']['id'] ?? 0);
        $isOwner = $ownerId === $userId;

        $project['can_edit'] = $isOwner || $isAdmin;
        $project['can_delete'] = $isOwner || $isAdmin;

        return $project;
    }

    /**
     * @return array{error?: string, data?: array{section_colors: array, section_ratios: array, taco_configs: array}}
     */
    private function validateConfig(Request $request): array
    {
        $sectionColors = $request->input('section_colors');
        $sectionRatios = $request->input('section_ratios');
        $tacoConfigs = $request->input('taco_configs');

        if (!is_array($sectionColors) || !is_array($sectionRatios) || !is_array($tacoConfigs)) {
            return ['error' => 'Configuracao do plotter invalida.'];
        }

        $config = [
            'section_colors' => $sectionColors,
            'section_ratios' => $sectionRatios,
            'taco_configs' => $tacoConfigs,
        ];

        $encoded = json_encode($config, JSON_UNESCAPED_UNICODE);
        if ($encoded === false || strlen($encoded) > self::MAX_CONFIG_JSON_BYTES) {
            return ['error' => 'Configuracao do plotter grande ou invalida demais.'];
        }

        return ['data' => $config];
    }
}
