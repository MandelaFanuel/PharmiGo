import { useEffect, useState } from "react";

import { getStoredAuthToken, getStoredCurrentUser, persistStoredCurrentUser } from "../lib/auth";
import { describeGeolocationError, getGeolocationPermissionState, requestBrowserCoordinates, supportsGeolocation } from "../lib/geolocation";
import { updateProfileLocation } from "../services/api";
import ModalTransition from "./ModalTransition";

const LOCATION_PROMPT_SESSION_KEY = "pharmigo.locationPrompt.v2";

function profileNeedsCoordinates() {
  const currentUser = getStoredCurrentUser();
  if (!currentUser?.profile) {
    return false;
  }

  if (!["patient", "pharmacy", "admin"].includes(currentUser.profile.role)) {
    return false;
  }

  return typeof currentUser.profile.latitude !== "number" || typeof currentUser.profile.longitude !== "number";
}

export default function LocationPermissionPrompt() {
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const authToken = getStoredAuthToken();
    if (!authToken || !profileNeedsCoordinates()) {
      return;
    }

    const sessionState = window.sessionStorage.getItem(LOCATION_PROMPT_SESSION_KEY);
    if (sessionState === "done" || sessionState === "dismissed" || sessionState === "unsupported") {
      return;
    }

    if (!supportsGeolocation()) {
      window.sessionStorage.setItem(LOCATION_PROMPT_SESSION_KEY, "unsupported");
      return;
    }

    let cancelled = false;

    async function preparePrompt() {
      const permissionState = await getGeolocationPermissionState();
      if (cancelled) {
        return;
      }

      if (permissionState === "granted") {
        setRequesting(true);
        try {
          const coordinates = await requestBrowserCoordinates();
          const updatedUser = await updateProfileLocation(coordinates);
          persistStoredCurrentUser(updatedUser);
          window.sessionStorage.setItem(LOCATION_PROMPT_SESSION_KEY, "done");
        } catch (caughtError) {
          setError(describeGeolocationError(caughtError));
          setVisible(true);
        } finally {
          setRequesting(false);
        }
        return;
      }

      const timer = window.setTimeout(() => {
        if (!cancelled) {
          setVisible(true);
        }
      }, 900);

      return () => window.clearTimeout(timer);
    }

    let cleanupTimer: (() => void) | undefined;
    void preparePrompt().then((cleanup) => {
      cleanupTimer = cleanup;
    });

    return () => {
      cancelled = true;
      cleanupTimer?.();
    };
  }, []);

  async function handleEnableLocation() {
    setRequesting(true);
    setError(null);
    try {
      const coordinates = await requestBrowserCoordinates();
      const updatedUser = await updateProfileLocation(coordinates);
      persistStoredCurrentUser(updatedUser);
      window.sessionStorage.setItem(LOCATION_PROMPT_SESSION_KEY, "done");
      setVisible(false);
    } catch (caughtError) {
      setError(describeGeolocationError(caughtError));
    } finally {
      setRequesting(false);
    }
  }

  function handleDismiss() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(LOCATION_PROMPT_SESSION_KEY, "dismissed");
    }
    setVisible(false);
  }

  if (!visible) {
    return null;
  }

  return (
    <ModalTransition
      overlayClassName="pharmigo-modal-overlay"
      panelClassName="landing-modal-card install-prompt-card"
      ariaLabel="Activer la localisation"
      onBackdropClick={handleDismiss}
    >
      <div className="landing-modal-head install-prompt-head">
        <div>
          <span className="landing-section-kicker">Localisation utile</span>
          <h2>Activez votre position pour des resultats plus proches</h2>
          <p>
            PharmiGo utilise votre position pour retrouver la pharmacie active la plus proche, calculer les distances et
            mieux trier les recommandations.
          </p>
        </div>
      </div>

      <div className="install-prompt-body install-prompt-body-single">
        <div className="install-prompt-panel highlight">
          <strong>Pourquoi l'autoriser ?</strong>
          <ul>
            <li>Voir plus vite les pharmacies proches de vous.</li>
            <li>Ameliorer le tri par distance pour les ordonnances et la recherche.</li>
            <li>Eviter de devoir expliquer manuellement votre position au chatbot.</li>
          </ul>
          {error ? <p className="install-prompt-error">{error}</p> : null}
        </div>
      </div>

      <div className="install-prompt-actions install-prompt-actions-stack">
        <button type="button" className="pharmigo-primary-btn" onClick={() => void handleEnableLocation()} disabled={requesting}>
          {requesting ? "Localisation..." : "Activer ma localisation"}
        </button>
        <button type="button" className="pharmigo-secondary-btn" onClick={handleDismiss} disabled={requesting}>
          Plus tard
        </button>
      </div>
    </ModalTransition>
  );
}
