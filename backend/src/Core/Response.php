<?php

declare(strict_types=1);

namespace App\Core;

final class Response
{
    /** @param array<string,string> $headers */
    private function __construct(
        public readonly int $status,
        public readonly string $body,
        public readonly array $headers
    ) {
    }

    public static function json(mixed $data, int $status = 200): self
    {
        $encoded = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return new self($status, $encoded === false ? '{}' : $encoded, [
            'Content-Type' => 'application/json; charset=utf-8',
            // A API e toda dinamica (status de conexao, saldo, etc). Sem isso o
            // navegador pode servir uma resposta antiga do cache em vez de bater
            // no servidor de novo — foi o que deixava o QR do WhatsApp "travado".
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
        ]);
    }

    public static function html(string $content, int $status = 200): self
    {
        return new self($status, $content, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header($name . ': ' . $value);
        }
        echo $this->body;
    }
}
