import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { PreferencesProvider } from "./context/PreferencesContext";
import "./styles/variables.css";
import "./styles/pharmacy-stock.css";
import "./styles/dashboards.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PreferencesProvider>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
      </BrowserRouter>
    </PreferencesProvider>
  </React.StrictMode>
);

function notifyServiceWorkerUpdate(registration: ServiceWorkerRegistration) {
  window.dispatchEvent(new CustomEvent("pharmigo:sw-update-available", { detail: registration }));
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const hostname = window.location.hostname;
    const isLocalDevHost =
      ["localhost", "127.0.0.1"].includes(hostname) ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

    if (import.meta.env.DEV || isLocalDevHost) {
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())).catch(() => undefined)
      ).catch(() => undefined);

      if ("caches" in window) {
        caches.keys().then((keys) =>
          Promise.all(keys.filter((key) => key.startsWith("pharmigo-static")).map((key) => caches.delete(key))).catch(() => undefined)
        ).catch(() => undefined);
      }
      return;
    }

    let hasPendingReload = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hasPendingReload) {
        return;
      }
      hasPendingReload = true;
      window.location.reload();
    });

    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__APP_VERSION__)}`).then((registration) => {
      if (registration.waiting) {
        notifyServiceWorkerUpdate(registration);
      }

      registration.addEventListener("updatefound", () => {
        const installingWorker = registration.installing;
        if (!installingWorker) {
          return;
        }

        installingWorker.addEventListener("statechange", () => {
          if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
            notifyServiceWorkerUpdate(registration);
          }
        });
      });

      window.setInterval(() => {
        registration.update().catch(() => undefined);
      }, 5 * 60 * 1000);
    }).catch(() => undefined);
  });
}
