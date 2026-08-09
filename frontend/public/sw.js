self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Sem cache proposital: o sistema depende de dados sempre atualizados
// (moldes, rifas, pagamentos). Esse listener so existe pra cumprir o
// criterio de instalabilidade do PWA — todo request continua indo direto
// pra rede.
self.addEventListener('fetch', () => {});

// Web Push: mostra a notificacao mesmo com o app fechado (a cada venda o
// backend envia titulo/body/data). Ver WebPushService/NotificacaoService.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = { title: 'Alisson Projetos', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Alisson Projetos';
  const options = {
    body: payload.body || '',
    icon: '/pwa-192-v3.png',
    badge: '/pwa-192-v3.png',
    data: payload.data || {},
    vibrate: [120, 60, 120],
    tag: 'venda-' + (payload.data && payload.data.pagamento_id ? payload.data.pagamento_id : Date.now()),
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Ao tocar na notificacao: foca uma aba aberta do app ou abre uma nova.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});
