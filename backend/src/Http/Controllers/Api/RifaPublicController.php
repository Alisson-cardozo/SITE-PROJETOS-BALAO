<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\RifaCompradorService;
use App\Services\RifaNumeroService;
use App\Services\RifaPromocaoService;
use App\Services\RifaReservaService;
use App\Services\RifaService;

/**
 * Rotas SEM autenticacao — pagina publica da rifa (link que o dono manda pro
 * cliente). Recebimento e sempre manual: o cliente reserva os numeros, paga
 * direto na chave Pix do dono e confirma por WhatsApp — o dono confirma o
 * pagamento manualmente no painel dele depois de ver o comprovante.
 */
final class RifaPublicController
{
    private RifaService $rifas;
    private RifaNumeroService $numeros;
    private RifaCompradorService $compradores;
    private RifaReservaService $reservas;
    private RifaPromocaoService $promocoes;

    public function __construct()
    {
        $this->rifas = new RifaService();
        $this->numeros = new RifaNumeroService();
        $this->compradores = new RifaCompradorService();
        $this->reservas = new RifaReservaService();
        $this->promocoes = new RifaPromocaoService();
    }

    public function show(Request $request): Response
    {
        $rifa = $this->findRawBySlugOrFail($request);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        $this->numeros->liberarReservasExpiradas((int) $rifa['id']);

        $data = $this->rifas->findById((int) $rifa['id']);
        // preco promocional so faz sentido pra sorteio pelo sistema (validado na criacao/edicao) —
        // pra loteria federal a lista vem sempre vazia mesmo que exista lixo antigo no banco.
        $data['promocoes'] = $rifa['modo_sorteio'] === 'caixa_federal' ? [] : $this->promocoes->listAtivas((int) $rifa['id']);

        return Response::json(['data' => $data]);
    }

    public function reservar(Request $request): Response
    {
        $rifaRaw = $this->findRawBySlugOrFail($request);
        if ($rifaRaw instanceof Response) {
            return $rifaRaw;
        }

        if ($rifaRaw['status'] !== 'ativa') {
            return Response::json(['error' => 'Essa rifa nao esta mais ativa.'], 422);
        }

        $nome = trim((string) $request->input('nome', ''));
        $whatsapp = trim((string) $request->input('whatsapp', ''));
        $email = $request->input('email');
        $numerosRaw = $request->input('numeros', []);

        $errors = [];
        if ($nome === '') {
            $errors['nome'] = 'Informe seu nome.';
        }
        if ($whatsapp === '') {
            $errors['whatsapp'] = 'Informe seu whatsapp.';
        }
        $numerosEscolhidos = is_array($numerosRaw)
            ? array_values(array_unique(array_map('intval', $numerosRaw)))
            : [];
        if ($numerosEscolhidos === []) {
            $errors['numeros'] = 'Escolha pelo menos 1 numero na grade.';
        }
        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        $resultado = $this->reservas->reservarNumerosEscolhidos(
            $rifaRaw,
            $numerosEscolhidos,
            $nome,
            $whatsapp,
            is_string($email) && trim($email) !== '' ? trim($email) : null
        );

        if ($resultado === null) {
            return Response::json(['error' => 'Um ou mais numeros escolhidos acabaram de ser pegos por outra pessoa. Atualize a pagina e tente de novo.'], 422);
        }

        $comprador = $resultado['comprador'];
        $compradorId = (int) $comprador['id'];

        return Response::json([
            'data' => [
                'comprador_id' => $compradorId,
                'numeros' => $resultado['numeros'],
                'expira_em' => $comprador['expira_em'],
                'whatsapp_contato' => $rifaRaw['whatsapp_contato'],
                'chave_pix' => $rifaRaw['chave_pix'],
            ],
        ], 201);
    }

    /**
     * Reconhece um comprador que ja tem numeros nessa rifa pelo whatsapp
     * (soma TODAS as compras dele) — usado no formulario publico pra avisar
     * "voce ja tem esses numeros" quando ele volta pra comprar mais.
     */
    public function meusNumeros(Request $request): Response
    {
        $rifa = $this->findRawBySlugOrFail($request);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        $whatsapp = (string) $request->input('whatsapp', '');
        $digits = preg_replace('/\D+/', '', $whatsapp) ?? '';
        if ($digits === '') {
            return Response::json(['data' => ['numeros' => []]]);
        }

        return Response::json(['data' => ['numeros' => $this->numeros->listarNumerosPorWhatsapp((int) $rifa['id'], $digits)]]);
    }

    public function statusComprador(Request $request): Response
    {
        $compradorId = (int) ($request->param('compradorId') ?? 0);
        $comprador = $this->compradores->findById($compradorId);
        if ($comprador === null) {
            return Response::json(['error' => 'Comprador nao encontrado.'], 404);
        }

        return Response::json([
            'data' => [
                'status' => $comprador['status'],
                'numeros' => $this->numeros->listarNumerosDoComprador($compradorId),
            ],
        ]);
    }

    private function findRawBySlugOrFail(Request $request): array|Response
    {
        $slug = (string) ($request->param('slug') ?? '');
        $rifa = $this->rifas->findRawBySlug($slug);
        if ($rifa === null) {
            return Response::json(['error' => 'Rifa nao encontrada.'], 404);
        }

        return $rifa;
    }
}
