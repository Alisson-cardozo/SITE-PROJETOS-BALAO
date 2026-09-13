<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\WhatsAppService;

/**
 * Admin: conectar/desconectar o WhatsApp (aba Comunicação → WhatsApp). Tudo
 * passa pelo serviço Node via WhatsAppService.
 */
final class WhatsAppAdminController
{
    private WhatsAppService $wa;

    public function __construct()
    {
        $this->wa = new WhatsAppService();
    }

    /** Status + QR (o frontend faz poll disso enquanto não conecta). */
    public function status(Request $request): Response
    {
        $r = $this->wa->status();
        if (!$r['ok'] && $r['status'] === 0) {
            return Response::json([
                'data' => ['connected' => false, 'qr' => null, 'service_online' => false, 'error' => $r['data']['error'] ?? 'Serviço offline.'],
            ]);
        }
        return Response::json([
            'data' => [
                'connected' => (bool) ($r['data']['connected'] ?? false),
                'qr' => $r['data']['qr'] ?? null,
                'pairingCode' => $r['data']['pairingCode'] ?? null,
                'initializing' => (bool) ($r['data']['initializing'] ?? false),
                'service_online' => true,
                'error' => $r['data']['error'] ?? null,
            ],
        ]);
    }

    /** (Re)inicia a conexão — botão "Conectar" (QR). */
    public function connect(Request $request): Response
    {
        $r = $this->wa->connect();
        return Response::json(['data' => $r['data']], $r['ok'] ? 200 : ($r['status'] ?: 502));
    }

    /** Metodo alternativo ao QR: gera codigo de 8 digitos pro numero informado. */
    public function connectWithCode(Request $request): Response
    {
        $phone = trim((string) $request->input('phone', ''));
        if ($phone === '') {
            return Response::json(['error' => 'Informe o número.'], 422);
        }
        $r = $this->wa->connectWithPairingCode($phone);
        return Response::json(['data' => $r['data']], $r['ok'] ? 200 : ($r['status'] ?: 502));
    }

    /** Desconecta o número (logout). */
    public function disconnect(Request $request): Response
    {
        $r = $this->wa->disconnect();
        return Response::json(['data' => $r['data']], $r['ok'] ? 200 : ($r['status'] ?: 502));
    }
}
