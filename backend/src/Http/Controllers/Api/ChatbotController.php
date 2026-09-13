<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\ChatbotService;

/** CRUD dos fluxos do chatbot (aba "Chatbot" do admin). */
final class ChatbotController
{
    private ChatbotService $bot;

    public function __construct()
    {
        $this->bot = new ChatbotService();
    }

    public function index(Request $request): Response
    {
        return Response::json(['data' => $this->bot->listFlows()]);
    }

    public function show(Request $request): Response
    {
        $id = (int) $request->param('id', '0');
        $flow = $this->bot->getFlow($id);
        if ($flow === null) {
            return Response::json(['error' => 'Fluxo não encontrado.'], 404);
        }
        return Response::json(['data' => $flow]);
    }

    public function store(Request $request): Response
    {
        $name = trim((string) $request->input('name', ''));
        if ($name === '') {
            return Response::json(['error' => 'Informe um nome pro fluxo.'], 422);
        }
        return Response::json(['data' => $this->bot->createFlow($name)], 201);
    }

    public function update(Request $request): Response
    {
        $id = (int) $request->param('id', '0');
        $name = $request->input('name');
        $trigger = $request->input('trigger_keyword');
        $isActive = $request->input('is_active');
        $flow = $request->input('flow');

        $this->bot->updateFlow(
            $id,
            is_string($name) ? $name : null,
            is_string($trigger) ? $trigger : null,
            is_bool($isActive) ? $isActive : null,
            is_array($flow) ? $flow : null,
        );

        $updated = $this->bot->getFlow($id);
        if ($updated === null) {
            return Response::json(['error' => 'Fluxo não encontrado.'], 404);
        }
        return Response::json(['data' => $updated]);
    }

    public function destroy(Request $request): Response
    {
        $id = (int) $request->param('id', '0');
        $this->bot->deleteFlow($id);
        return Response::json(['ok' => true]);
    }
}
