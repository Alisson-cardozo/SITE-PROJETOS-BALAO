<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Crypto;
use App\Support\Db;
use Throwable;

/**
 * Configuracao global do sistema — linha unica (id=1), sem dono por usuario.
 * Redes sociais mostradas no rodape pra quem estiver logado, a lista de abas
 * do menu que o admin escolheu esconder dos usuarios comuns, e as
 * credenciais do Mercado Pago (compartilhadas por todos os planos — o
 * valor/dias de cada plano ficam na tabela `planos`, nao aqui).
 */
final class SystemSettingsService
{
    /**
     * @return array{
     *   telegram:?string, instagram:?string, whatsapp:?string, hidden_nav_items:array<int,string>,
     *   nav_item_labels:array<string,string>,
     *   mercado_pago_public_key:?string, mercado_pago_access_token_configured:bool,
     *   tutorials:array<string,array{show:bool,video_url:string}>
     * }
     */
    public function get(): array
    {
        $row = Db::connection()->query('SELECT * FROM system_settings WHERE id = 1')->fetch();

        return $this->toPublicArray($row === false ? null : $row);
    }

    /**
     * @param array{
     *   telegram?:?string, instagram?:?string, whatsapp?:?string, hidden_nav_items?:array<int,string>,
     *   nav_item_labels?:array<string,string>,
     *   mercado_pago_public_key?:?string, mercado_pago_access_token?:?string,
     *   tutorials?:array<string,array{show:bool,video_url:string}>
     * } $data
     * @return array{
     *   telegram:?string, instagram:?string, whatsapp:?string, hidden_nav_items:array<int,string>,
     *   nav_item_labels:array<string,string>,
     *   mercado_pago_public_key:?string, mercado_pago_access_token_configured:bool,
     *   tutorials:array<string,array{show:bool,video_url:string}>
     * }
     */
    public function update(array $data, int $userId): array
    {
        $existingRow = Db::connection()->query('SELECT * FROM system_settings WHERE id = 1')->fetch();
        $existingRow = $existingRow === false ? null : $existingRow;
        $current = $this->toPublicArray($existingRow);

        $telegram = array_key_exists('telegram', $data) ? $data['telegram'] : $current['telegram'];
        $instagram = array_key_exists('instagram', $data) ? $data['instagram'] : $current['instagram'];
        $whatsapp = array_key_exists('whatsapp', $data) ? $data['whatsapp'] : $current['whatsapp'];
        $hiddenNavItems = array_key_exists('hidden_nav_items', $data) ? $data['hidden_nav_items'] : $current['hidden_nav_items'];
        $navItemLabels = array_key_exists('nav_item_labels', $data) ? $data['nav_item_labels'] : $current['nav_item_labels'];
        $mpPublicKey = array_key_exists('mercado_pago_public_key', $data)
            ? $data['mercado_pago_public_key']
            : $current['mercado_pago_public_key'];
        $tutorials = array_key_exists('tutorials', $data) ? $data['tutorials'] : $current['tutorials'];

        // Access token e secreto: so mexe se veio explicitamente no payload.
        // Vazio limpa (admin removendo a credencial); ausente mantem o que
        // ja estava salvo (o frontend nunca recebe o valor decodificado de
        // volta, entao nao tem como reenviar o mesmo valor por engano).
        $mpAccessTokenEncrypted = $existingRow['mercado_pago_access_token_encrypted'] ?? null;
        if (array_key_exists('mercado_pago_access_token', $data)) {
            $newToken = $data['mercado_pago_access_token'];
            $mpAccessTokenEncrypted = $newToken === null || $newToken === '' ? null : Crypto::encrypt($newToken);
        }

        $stmt = Db::connection()->prepare(
            'INSERT INTO system_settings
              (id, telegram, instagram, whatsapp, hidden_nav_items_json, nav_item_labels_json,
               mercado_pago_public_key, mercado_pago_access_token_encrypted, tutorials_json, updated_by)
             VALUES
              (1, :telegram, :instagram, :whatsapp, :hidden_nav_items_json, :nav_item_labels_json,
               :mp_public_key, :mp_access_token_encrypted, :tutorials_json, :updated_by)
             ON DUPLICATE KEY UPDATE
               telegram = VALUES(telegram), instagram = VALUES(instagram), whatsapp = VALUES(whatsapp),
               hidden_nav_items_json = VALUES(hidden_nav_items_json),
               nav_item_labels_json = VALUES(nav_item_labels_json),
               mercado_pago_public_key = VALUES(mercado_pago_public_key),
               mercado_pago_access_token_encrypted = VALUES(mercado_pago_access_token_encrypted),
               tutorials_json = VALUES(tutorials_json),
               updated_by = VALUES(updated_by)'
        );
        $stmt->execute([
            'telegram' => $telegram,
            'instagram' => $instagram,
            'whatsapp' => $whatsapp,
            'hidden_nav_items_json' => json_encode($hiddenNavItems, JSON_UNESCAPED_UNICODE),
            'nav_item_labels_json' => json_encode($navItemLabels, JSON_UNESCAPED_UNICODE),
            'mp_public_key' => $mpPublicKey,
            'mp_access_token_encrypted' => $mpAccessTokenEncrypted,
            'tutorials_json' => json_encode($tutorials, JSON_UNESCAPED_UNICODE),
            'updated_by' => $userId,
        ]);

        return $this->get();
    }

    private function toPublicArray(?array $row): array
    {
        $hidden = [];
        if ($row !== null && !empty($row['hidden_nav_items_json'])) {
            $decoded = json_decode((string) $row['hidden_nav_items_json'], true);
            if (is_array($decoded)) {
                $hidden = array_values(array_filter($decoded, 'is_string'));
            }
        }

        $navItemLabels = [];
        if ($row !== null && !empty($row['nav_item_labels_json'])) {
            $decoded = json_decode((string) $row['nav_item_labels_json'], true);
            if (is_array($decoded)) {
                foreach ($decoded as $key => $value) {
                    if (is_string($key) && is_string($value) && $value !== '') {
                        $navItemLabels[$key] = $value;
                    }
                }
            }
        }

        $accessTokenConfigured = false;
        if ($row !== null && !empty($row['mercado_pago_access_token_encrypted'])) {
            // So confirma que da pra descriptografar (credencial valida) --
            // nunca expoe o valor de volta.
            try {
                $accessTokenConfigured = Crypto::decrypt((string) $row['mercado_pago_access_token_encrypted']) !== null;
            } catch (Throwable) {
                $accessTokenConfigured = false;
            }
        }

        $tutorials = [];
        if ($row !== null && !empty($row['tutorials_json'])) {
            $decoded = json_decode((string) $row['tutorials_json'], true);
            if (is_array($decoded)) {
                foreach ($decoded as $key => $value) {
                    if (is_string($key) && is_array($value)) {
                        $tutorials[$key] = [
                            'show' => !empty($value['show']),
                            'video_url' => is_string($value['video_url'] ?? null) ? $value['video_url'] : '',
                        ];
                    }
                }
            }
        }

        return [
            'telegram' => $row['telegram'] ?? null,
            'instagram' => $row['instagram'] ?? null,
            'whatsapp' => $row['whatsapp'] ?? null,
            'hidden_nav_items' => $hidden,
            'nav_item_labels' => $navItemLabels,
            'mercado_pago_public_key' => $row['mercado_pago_public_key'] ?? null,
            'mercado_pago_access_token_configured' => $accessTokenConfigured,
            'tutorials' => $tutorials,
        ];
    }
}
