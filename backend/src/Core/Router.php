<?php

declare(strict_types=1);

namespace App\Core;

final class Router
{
    /**
     * @var array<int, array{
     *   method: string,
     *   pattern: string,
     *   paramNames: array<int,string>,
     *   handler: mixed,
     *   middlewares: array<int, array{0: class-string, 1: string}|\Closure>
     * }>
     */
    private array $routes = [];

    /**
     * @param array<int, array{0: class-string, 1: string}|\Closure> $middlewares
     *   Cada item e um par [Classe::class, 'metodo'] OU uma Closure(Request): ?Response
     *   (usada quando o middleware precisa de um parametro fixo por rota, ex.:
     *   AbaAccessMiddleware — ver helper abaMiddleware() em routes/api.php).
     */
    public function add(string $method, string $path, mixed $handler, array $middlewares = []): void
    {
        $paramNames = [];
        $normalizedPath = rtrim($path, '/');
        $normalizedPath = $normalizedPath === '' ? '/' : $normalizedPath;

        $pattern = preg_replace_callback('#\{(\w+)\}#', function (array $matches) use (&$paramNames): string {
            $paramNames[] = $matches[1];
            return '([^/]+)';
        }, $normalizedPath);

        $this->routes[] = [
            'method' => strtoupper($method),
            'pattern' => '#^' . $pattern . '$#',
            'paramNames' => $paramNames,
            'handler' => $handler,
            'middlewares' => $middlewares,
        ];
    }

    public function dispatch(Request $request): Response
    {
        $path = $request->path === '' ? '/' : $request->path;
        $pathKnown = false;

        foreach ($this->routes as $route) {
            if (preg_match($route['pattern'], $path, $matches) !== 1) {
                continue;
            }

            $pathKnown = true;
            if ($route['method'] !== $request->method) {
                continue;
            }

            array_shift($matches);
            $request->params = array_combine($route['paramNames'], $matches) ?: [];

            foreach ($route['middlewares'] as $middleware) {
                if ($middleware instanceof \Closure) {
                    $result = $middleware($request);
                } else {
                    [$class, $method] = $middleware;
                    $result = (new $class())->$method($request);
                }
                if ($result instanceof Response) {
                    return $result;
                }
            }

            return $this->invoke($route['handler'], $request);
        }

        return Response::json(
            ['error' => $pathKnown ? 'Metodo nao permitido.' : 'Rota nao encontrada.'],
            $pathKnown ? 405 : 404
        );
    }

    private function invoke(mixed $handler, Request $request): Response
    {
        if ($handler instanceof \Closure) {
            return $handler($request);
        }

        [$class, $method] = $handler;
        return (new $class())->$method($request);
    }
}
