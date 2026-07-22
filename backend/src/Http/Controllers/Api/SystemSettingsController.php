<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\SystemSettingsService;

final class SystemSettingsController
{
    private SystemSettingsService $settings;

    public function __construct()
    {
        $this->settings = new SystemSettingsService();
    }

    public function show(Request $request): Response
    {
        return Response::json(['data' => $this->settings->get()]);
    }

    public function update(Request $request): Response
    {
        $data = [];
        $errors = [];

        foreach (['telegram', 'instagram', 'whatsapp'] as $field) {
            if ($request->input($field) === null) {
                continue;
            }
            $value = trim((string) $request->input($field));
            if (mb_strlen($value) > 255) {
                $errors[$field] = 'Esse valor e muito longo.';
                continue;
            }
            $data[$field] = $value === '' ? null : $value;
        }

        $hiddenNavItems = $request->input('hidden_nav_items');
        if ($hiddenNavItems !== null) {
            if (!is_array($hiddenNavItems) || array_filter($hiddenNavItems, static fn ($v) => !is_string($v)) !== []) {
                $errors['hidden_nav_items'] = 'Lista de abas invalida.';
            } else {
                $data['hidden_nav_items'] = array_values(array_unique($hiddenNavItems));
            }
        }

        if ($request->input('mercado_pago_public_key') !== null) {
            $value = trim((string) $request->input('mercado_pago_public_key'));
            if (mb_strlen($value) > 255) {
                $errors['mercado_pago_public_key'] = 'Esse valor e muito longo.';
            } else {
                $data['mercado_pago_public_key'] = $value === '' ? null : $value;
            }
        }

        if ($request->input('mercado_pago_access_token') !== null) {
            $data['mercado_pago_access_token'] = trim((string) $request->input('mercado_pago_access_token'));
        }

        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        $userId = (int) $request->attribute('user_id', 0);

        return Response::json(['data' => $this->settings->update($data, $userId)]);
    }
}
