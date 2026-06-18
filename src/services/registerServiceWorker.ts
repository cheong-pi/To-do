export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  if (!import.meta.env.PROD) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => void registration.unregister());
    });
    if ("caches" in window) {
      void caches.keys().then((keys) => {
        keys.filter((key) => key.startsWith("dont-forget-")).forEach((key) => void caches.delete(key));
      });
    }
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => {
        // Service worker registration should never block app usage.
      });
  });
}
