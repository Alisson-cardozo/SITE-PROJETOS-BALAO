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

        foreach (['telegram', 'instagram', 'whatsapp', 'youtube'] as $field) {
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

        if ($request->input('phone_validation_required') !== null) {
            $data['phone_validation_required'] = (bool) $request->input('phone_validation_required');
        }

        $hiddenNavItems = $request->input('hidden_nav_items');
        if ($hiddenNavItems !== null) {
            if (!is_array($hiddenNavItems) || array_filter($hiddenNavItems, static fn ($v) => !is_string($v)) !== []) {
                $errors['hidden_nav_items'] = 'Lista de abas invalida.';
            } else {
                $data['hidden_nav_items'] = array_values(array_unique($hiddenNavItems));
            }
        }

        $navItemLabels = $request->input('nav_item_labels');
        if ($navItemLabels !== null) {
            if (!is_array($navItemLabels)) {
                $errors['nav_item_labels'] = 'Rotulos de aba invalidos.';
            } else {
                $clean = [];
                foreach ($navItemLabels as $key => $value) {
                    if (!is_string($key) || !is_string($value)) {
                        $errors['nav_item_labels'] = 'Rotulos de aba invalidos.';
                        break;
                    }
                    $trimmed = trim($value);
                    if (mb_strlen($trimmed) > 40) {
                        $errors['nav_item_labels'] = 'Rotulo muito longo (max. 40 caracteres).';
                        break;
                    }
                    if ($trimmed !== '') {
                        $clean[$key] = $trimmed;
                    }
                }
                if (!isset($errors['nav_item_labels'])) {
                    $data['nav_item_labels'] = $clean;
                }
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

        $tutorials = $request->input('tutorials');
        if ($tutorials !== null) {
            if (!is_array($tutorials)) {
                $errors['tutorials'] = 'Tutoriais inválidos.';
            } else {
                $clean = [];
                foreach ($tutorials as $key => $value) {
                    if (!is_string($key)) {
                        $errors['tutorials'] = 'Identificador da aba inválido.';
                        break;
                    }
                    if (!is_array($value)) {
                        $errors['tutorials'] = 'Configuração do tutorial inválida.';
                        break;
                    }
                    $show = !empty($value['show']);
                    $videoUrl = trim((string) ($value['video_url'] ?? ''));
                    if (mb_strlen($videoUrl) > 500) {
                        $errors['tutorials'] = 'O link do vídeo é muito longo.';
                        break;
                    }
                    $clean[$key] = [
                        'show' => $show,
                        'video_url' => $videoUrl
                    ];
                }
                if (!isset($errors['tutorials'])) {
                    $data['tutorials'] = $clean;
                }
            }
        }

        if ($request->input('no_plan_msg_enabled') !== null) {
            $data['no_plan_msg_enabled'] = (bool) $request->input('no_plan_msg_enabled');
        }
        if ($request->input('no_plan_msg_text') !== null) {
            $value = trim((string) $request->input('no_plan_msg_text'));
            if (mb_strlen($value) > 1000) {
                $errors['no_plan_msg_text'] = 'Mensagem muito longa (max. 1000 caracteres).';
            } else {
                $data['no_plan_msg_text'] = $value === '' ? null : $value;
            }
        }
        if ($request->input('no_plan_msg_delay_min') !== null) {
            $data['no_plan_msg_delay_min'] = max(1, (int) $request->input('no_plan_msg_delay_min'));
        }
        if ($request->input('no_plan_msg_repeat_min') !== null) {
            $data['no_plan_msg_repeat_min'] = max(1, (int) $request->input('no_plan_msg_repeat_min'));
        }

        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        $userId = (int) $request->attribute('user_id', 0);

        return Response::json(['data' => $this->settings->update($data, $userId)]);
    }
}
