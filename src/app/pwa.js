/**
 * Registra el service worker. Cuando hay una versión nueva instalada y esperando, avisa con un botón:
 * no se recarga sola, para no interrumpir una edición.
 */
export async function registerServiceWorker({ toaster, nav = navigator, win = window } = {}) {
  if (!nav.serviceWorker) return null;
  // En desarrollo local la caché serviría código viejo: solo se activa con ?sw en la dirección.
  if (win.location.hostname === 'localhost' && !new URLSearchParams(win.location.search).has('sw')) return null;
  const registration = await nav.serviceWorker.register('sw.js', { scope: './' });
  const offer = (worker) => toaster.show('Hay una versión nueva del editor.', {
    ms: 0, action: { label: 'Actualizar', run: () => worker.postMessage('skip-waiting') },
  });
  const watch = (worker) => worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && nav.serviceWorker.controller) offer(worker);
  });
  if (registration.waiting && nav.serviceWorker.controller) offer(registration.waiting);
  registration.addEventListener('updatefound', () => watch(registration.installing));
  let reloading = false;
  nav.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !nav.serviceWorker.controller) return;
    reloading = true;
    win.location.reload();
  });
  return registration;
}
