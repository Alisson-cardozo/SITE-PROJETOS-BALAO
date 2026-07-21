<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Application;
use App\Core\Request;
use App\Core\Response;
use App\Services\BandeiraService;
use App\Services\UserService;
use App\Support\Mailer;
use Throwable;

final class BandeiraController
{
    // Grade salva ja vem no tamanho REAL (1 celula = 1cm, expandida no
    // frontend a partir da grade pequena de trabalho) — teto bem maior que o
    // da grade de trabalho, so pra nao aceitar um payload absurdo.
    private const MAX_GRID_CELLS = 3_000_000;
    private const MAX_COLOR_TABLE_ENTRIES = 500;
    private const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024;

    private BandeiraService $bandeiras;
    private UserService $users;

    public function __construct()
    {
        $this->bandeiras = new BandeiraService();
        $this->users = new UserService();
    }

    public function index(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $items = $this->bandeiras->listAll();
        $data = array_map(fn (array $item) => $this->withPermissions($item, $user), $items);

        return Response::json(['data' => $data]);
    }

    public function show(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $bandeira = $this->bandeiras->findById($id);
        if ($bandeira === null) {
            return Response::json(['error' => 'Bandeira nao encontrada.'], 404);
        }

        return Response::json(['data' => $this->withPermissions($bandeira, $user)]);
    }

    public function store(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $validated = $this->validatePayload($request);
        if (isset($validated['error'])) {
            return Response::json(['error' => $validated['error']], 422);
        }

        $bandeira = $this->bandeiras->create($validated['data'], (int) $user['id']);

        return Response::json(['data' => $this->withPermissions($bandeira, $user)], 201);
    }

    public function update(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->bandeiras->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Bandeira nao encontrada.'], 404);
        }

        if (!$this->canEditExisting($existing, $user)) {
            return Response::json(['error' => 'Apenas quem criou a bandeira pode editar.'], 403);
        }

        $validated = $this->validatePayload($request);
        if (isset($validated['error'])) {
            return Response::json(['error' => $validated['error']], 422);
        }

        $bandeira = $this->bandeiras->update($id, $validated['data'], (int) $user['id']);
        if ($bandeira === null) {
            return Response::json(['error' => 'Bandeira nao encontrada.'], 404);
        }

        return Response::json(['data' => $this->withPermissions($bandeira, $user)]);
    }

    public function destroy(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->bandeiras->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Bandeira nao encontrada.'], 404);
        }

        if (!$this->canDeleteExisting($existing, $user)) {
            return Response::json(['error' => 'Apenas quem criou a bandeira ou um administrador pode excluir.'], 403);
        }

        $this->bandeiras->delete($id);

        return Response::json(['ok' => true]);
    }

    /**
     * Nao depende de a bandeira ja estar salva no banco — o PDF e sempre
     * gerado no navegador (igual ao "Baixar PDF"), o cliente so manda o
     * arquivo + os dados basicos (nome, tamanho, cores) pra montar o corpo
     * do email.
     */
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
            return Response::json(['error' => 'Informe o nome da bandeira.'], 422);
        }
        $larguraCm = (float) $request->input('largura_cm', 0);
        $alturaCm = (float) $request->input('altura_cm', 0);
        $coresDistintas = (int) $request->input('cores_distintas', 0);
        $clientName = trim((string) $request->input('client_name', ''));
        $message = trim((string) $request->input('message', ''));

        $file = $_FILES['pdf'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return Response::json(['error' => 'Envie o PDF da bandeira.'], 422);
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
        $bodyLines[] = "Segue em anexo a bandeira \"{$nome}\".";
        $bodyLines[] = '';
        $bodyLines[] = 'Dados da bandeira:';
        $bodyLines[] = "- Nome: {$nome}";
        $bodyLines[] = "- Tamanho real: {$larguraCm} x {$alturaCm} cm";
        $bodyLines[] = "- Cores distintas: {$coresDistintas}";
        $bodyLines[] = '';
        $bodyLines[] = 'Atenciosamente,';
        $bodyLines[] = 'Alisson Projetos';

        try {
            Mailer::send($clientEmail, "Sua bandeira: {$nome}", [
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
                            Segue em anexo a bandeira <strong>&quot;{$nomeSafe}&quot;</strong>.
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
     * @param array<string, mixed> $bandeira
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    private function withPermissions(array $bandeira, array $user): array
    {
        $userId = (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';
        $ownerId = (int) ($bandeira['created_by']['id'] ?? 0);
        $isOwner = $ownerId === $userId;

        $bandeira['can_edit'] = $isOwner || $isAdmin;
        $bandeira['can_delete'] = $isOwner || $isAdmin;

        return $bandeira;
    }

    /**
     * @return array{error?: string, data?: array{nome:string, largura_cm:float, altura_cm:float, largura_px:int, altura_px:int, grid_runs:array<int,array{0:string,1:int}>, color_table:array<int,array{hex:string,name:string,count:int}>}}
     */
    private function validatePayload(Request $request): array
    {
        $nome = trim((string) $request->input('nome', ''));
        $larguraCm = $request->input('largura_cm');
        $alturaCm = $request->input('altura_cm');
        $larguraPx = $request->input('largura_px');
        $alturaPx = $request->input('altura_px');
        $gridRuns = $request->input('grid_runs');
        $colorTable = $request->input('color_table');

        if ($nome === '' || mb_strlen($nome) > 180) {
            return ['error' => 'Informe um nome valido para a bandeira (ate 180 caracteres).'];
        }

        if (!is_numeric($larguraCm) || (float) $larguraCm <= 0 || !is_numeric($alturaCm) || (float) $alturaCm <= 0) {
            return ['error' => 'Informe o tamanho real (largura e altura em cm).'];
        }

        if (!is_numeric($larguraPx) || !is_numeric($alturaPx)) {
            return ['error' => 'Tamanho da grade invalido.'];
        }

        $larguraPxInt = (int) $larguraPx;
        $alturaPxInt = (int) $alturaPx;
        if ($larguraPxInt < 1 || $alturaPxInt < 1) {
            return ['error' => 'A grade precisa ter pelo menos 1x1 pixel.'];
        }
        if ($larguraPxInt * $alturaPxInt > self::MAX_GRID_CELLS) {
            return ['error' => 'Grade grande demais. Reduza o tamanho real da bandeira.'];
        }

        // A grade chega comprimida (RLE: [cor, repeticoes]) pra caber no
        // post_max_size mesmo em bandeiras grandes (ex: 1000x1500 = 1.5M
        // celulas) — validamos os runs e conferimos que a soma bate com o
        // tamanho declarado, sem nunca expandir pra um array plano aqui.
        if (!is_array($gridRuns) || count($gridRuns) === 0) {
            return ['error' => 'A grade de pixels nao bate com o tamanho informado.'];
        }
        $normalizedGridRuns = [];
        $totalCells = 0;
        foreach ($gridRuns as $run) {
            if (!is_array($run) || count($run) !== 2) {
                return ['error' => 'A grade de pixels tem um formato invalido.'];
            }
            $hex = $run[0] ?? null;
            $count = $run[1] ?? null;
            if (!is_string($hex) || !preg_match('/^#[0-9a-fA-F]{6}$/', $hex)) {
                return ['error' => 'A grade de pixels tem uma cor invalida.'];
            }
            if (!is_int($count) && !(is_numeric($count) && (float) $count === floor((float) $count))) {
                return ['error' => 'A grade de pixels tem uma repeticao invalida.'];
            }
            $countInt = (int) $count;
            if ($countInt < 1) {
                return ['error' => 'A grade de pixels tem uma repeticao invalida.'];
            }
            $normalizedGridRuns[] = [strtolower($hex), $countInt];
            $totalCells += $countInt;
        }
        if ($totalCells !== $larguraPxInt * $alturaPxInt) {
            return ['error' => 'A grade de pixels nao bate com o tamanho informado.'];
        }

        if (!is_array($colorTable) || count($colorTable) > self::MAX_COLOR_TABLE_ENTRIES) {
            return ['error' => 'Tabela de cores invalida.'];
        }
        $normalizedColorTable = [];
        foreach ($colorTable as $entry) {
            if (!is_array($entry)) {
                return ['error' => 'Tabela de cores invalida.'];
            }
            $hex = (string) ($entry['hex'] ?? '');
            $name = (string) ($entry['name'] ?? '');
            $count = $entry['count'] ?? null;
            if (!preg_match('/^#[0-9a-fA-F]{6}$/', $hex) || $name === '' || !is_numeric($count)) {
                return ['error' => 'Tabela de cores invalida.'];
            }
            $normalizedColorTable[] = ['hex' => strtolower($hex), 'name' => $name, 'count' => (int) $count];
        }

        return [
            'data' => [
                'nome' => $nome,
                'largura_cm' => round((float) $larguraCm, 2),
                'altura_cm' => round((float) $alturaCm, 2),
                'largura_px' => $larguraPxInt,
                'altura_px' => $alturaPxInt,
                'grid_runs' => $normalizedGridRuns,
                'color_table' => $normalizedColorTable,
            ],
        ];
    }
}
