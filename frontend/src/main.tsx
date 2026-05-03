import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { PreferencesProvider } from "./context/PreferencesContext";
import "./styles/variables.css";
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const isLocalDevHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

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

    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
