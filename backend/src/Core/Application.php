<?php

declare(strict_types=1);

namespace App\Core;

final class Application
{
    private static ?Application $instance = null;

    public Router $router;

    /** @var array<string,string> */
    private array $env = [];

    private function __construct()
    {
        $this->router = new Router();
    }

    public static function instance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    /** @param array<string,string> $env */
    public function setEnv(array $env): void
    {
        $this->env = $env;
    }

    public function env(string $key, ?string $default = null): ?string
    {
        return $this->env[$key] ?? $default;
    }

    public function run(): void
    {
        $request = Request::capture();
        $response = $this->router->dispatch($request);
        $response->send();
    }
}
