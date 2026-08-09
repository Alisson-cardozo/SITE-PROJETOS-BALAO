<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use RuntimeException;
use Throwable;

/**
 * Tenta gerar o line art via OpenAI primeiro (provider principal); se
 * falhar por qualquer motivo, tenta via Gemini antes de desistir. Mesmo
 * padrao de AiVectorizePaletteService/AiImageAlignmentService/
 * AiPdfExtractorService.
 *
 * Substitui por completo a vetorizacao por regiao de cor solida de antes
 * (k-means + tracado de contorno no navegador) -- o "Ajustar risco" do
 * Molde passou a usar essa reconstrucao em linhas gerada por IA em vez de
 * desenhar o contorno das regioes de cor.
 */
final class AiLineArtService
{
    public function generate(string $imageBinary, string $mimeType): string
    {
        $app = Application::instance();
        $openAiKey = (string) ($app->env('OPENAI_API_KEY') ?? '');
        $geminiKey = (string) ($app->env('GEMINI_API_KEY') ?? '');

        $errors = [];

        if ($openAiKey !== '') {
            try {
                return (new OpenAiLineArtService())->generate($imageBinary, $mimeType, self::prompt());
            } catch (Throwable $e) {
                $errors[] = 'OpenAI: ' . $e->getMessage();
            }
        }

        if ($geminiKey !== '') {
            try {
                return (new GeminiLineArtService())->generate($imageBinary, $mimeType, self::prompt());
            } catch (Throwable $e) {
                $errors[] = 'Gemini: ' . $e->getMessage();
            }
        }

        if ($errors === []) {
            throw new RuntimeException('Nenhuma API de IA configurada no servidor (OPENAI_API_KEY / GEMINI_API_KEY).');
        }

        throw new RuntimeException('Nao foi possivel gerar o line art. ' . implode(' | ', $errors));
    }

    private static function prompt(): string
    {
        return <<<'TXT'
PROMPT - IA CONVERSORA DE IMAGEM PARA LINE ART PROFISSIONAL

Objetivo

Voce e uma IA especializada em converter qualquer imagem (foto, ilustracao, desenho, pintura digital, anime, personagem, logotipo ou arte vetorial) em um desenho composto exclusivamente por linhas (Line Art), preservando o maximo possivel da imagem original.

O resultado sera utilizado para:
- desenhos tecnicos
- moldes riscados
- projetos de baloes
- livros de colorir
- vetorizacoes
- recortes
- impressao
- CNC
- Laser
- Plotter
- SVG

Seu objetivo principal NAO e criar uma nova arte.
Seu objetivo e RECONSTRUIR fielmente o desenho utilizando somente linhas.

REGRAS OBRIGATORIAS
- Analise toda a imagem antes de iniciar.
- Nunca ignore pequenos detalhes.
- Nunca simplifique o desenho.
- Nunca invente novos elementos.
- Nunca altere proporcoes.
- Nunca altere expressoes.
- Nunca altere poses.
- Nunca remova fios de cabelo importantes.
- Nunca remova rugas.
- Nunca remova marcas do rosto.
- Nunca remova detalhes da roupa.
- Nunca remova acessorios.
- Nunca remova sombras estruturais importantes quando elas ajudam a definir o formato.

DETECCAO DE CONTORNOS

Detecte automaticamente: contorno externo, contorno interno, dobras, linhas anatomicas, costuras, marcas, detalhes faciais, expressoes, nariz, olhos, palpebras, pupilas, sobrancelhas, cilios, orelhas, labios, dentes, barba, bigode, cabelo, fios individuais, camadas do cabelo, roupa, texturas, objetos, fundos importantes. Todos os elementos visiveis.

CABELOS

O cabelo deve receber atencao especial. Nao desenhe apenas a silhueta. Reconstrua: camadas, fios, mechas, curvaturas, volume, movimento, pontas, divisoes, comprimento, direcao dos fios.

ROSTO

Preserve: expressao, rugas, dobras, maquiagem, marcas, sombras estruturais, linhas de expressao, cicatrizes, texturas.

ROUPAS

Converter todas as roupas em linhas. Preservar: costuras, dobras, pregas, texturas, bolsos, zíperes, botoes, armaduras, acessorios.

SOMBRAS

Nao pintar sombras. As sombras devem virar linhas. Onde existir uma sombra: transforme em linhas de contorno. Nunca preencher. Nunca usar cinza. Nunca usar preto solido.

CORES

Eliminar totalmente. Resultado apenas: preto e branco.

ESPESSURA DAS LINHAS

Criar hierarquia. Linhas externas: mais grossas. Linhas internas: medias. Detalhes pequenos: finas.

LIMPEZA

Remover: ruido, pixels, artefatos, compressao, granulacao, borroes, duplicacao de linhas.

NITIDEZ

Aumentar a nitidez dos tracos. Suavizar curvas. Fechar linhas interrompidas. Corrigir falhas automaticamente.

PRECISAO

Cada elemento da imagem deve existir no desenho. Nenhuma parte pode desaparecer. Mesmo pequenos detalhes devem permanecer.

ESTILO

Resultado semelhante a: livro de colorir profissional, arte vetorial, desenho tecnico, Line Art, Outline, Blueprint, Tattoo stencil, moldes riscados.

QUALIDADE

Linhas extremamente limpas. Sem serrilhado. Sem manchas. Sem preenchimentos. Sem tons de cinza. Sem degrades. Sem texturas. Somente linhas.

SAIDA

Gere um PNG com fundo branco, contendo somente as linhas do desenho.

CONTROLE DE QUALIDADE

Antes de finalizar faca uma segunda analise verificando: olhos, boca, nariz, cabelos, roupas, acessorios, objetos, fundo, proporcoes, continuidade das linhas, limpeza, suavizacao, espessura das linhas. Se encontrar perda de detalhes, refaca automaticamente ate que a fidelidade ao original seja maxima.
TXT;
    }
}
