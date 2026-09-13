/**
 * Broadcaster de WebSocket pro chat do WhatsApp (aba "Mensagens" do admin).
 *
 * Nao guarda historico nem fala com o WhatsApp — so mantem as conexoes
 * WebSocket dos admins logados e repassa (broadcast) qualquer evento que o
 * PHP mandar via POST /broadcast assim que uma mensagem chega/sai. O
 * historico de verdade fica no MySQL (tabelas whatsapp_conversations /
 * whatsapp_messages); esse servico e so o "empurrador" em tempo real.
 *
 * Autenticacao da conexao WS: o PHP gera um "ticket" curto (30s, assinado com
 * HMAC usando o mesmo segredo CHAT_WS_SECRET) via GET /admin/whatsapp/ws-ticket;
 * o frontend conecta em wss://.../ws/chat?ticket=... e esse servico valida o
 * HMAC localmente, sem precisar perguntar pro PHP a cada conexao.
 */
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.CHAT_WS_PORT || 3002);
const SECRET = process.env.CHAT_WS_SECRET || 'dev-chat-ws-secret';

function verifyTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return false;
  const dot = ticket.lastIndexOf('.');
  if (dot < 0) return false;
  const payloadB64 = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return false;
  }
  try {
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload.exp === 'number' && Date.now() <= payload.exp;
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/broadcast') {
    if (req.headers['x-broadcast-secret'] !== SECRET) {
      res.writeHead(401);
      return res.end('unauthorized');
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      broadcast(body);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: wss.clients.size }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocketServer({ noServer: true });

function broadcast(rawJson) {
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(rawJson);
    }
  }
}

server.on('upgrade', (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, 'http://internal');
  } catch {
    socket.destroy();
    return;
  }
  if (url.pathname !== '/ws/chat' || !verifyTicket(url.searchParams.get('ticket'))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello' }));
  const ping = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 25000);
  ws.on('close', () => clearInterval(ping));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[chat-ws] ouvindo em http://127.0.0.1:${PORT} (broadcast) e ws://127.0.0.1:${PORT}/ws/chat`);
});
