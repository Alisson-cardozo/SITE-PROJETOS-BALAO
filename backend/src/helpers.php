<?php

declare(strict_types=1);

use App\Core\Application;

if (!function_exists('app')) {
    function app(): Application
    {
        return Application::instance();
    }
}
