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
