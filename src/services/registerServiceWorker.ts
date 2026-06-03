export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch(() => {
        // Service worker registration should never block app usage.
      });
  });
}
