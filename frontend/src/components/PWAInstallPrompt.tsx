import { useEffect, useMemo, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const INSTALL_SNOOZE_KEY = "pharmigo.installPromptSnoozeUntil";
const INSTALL_ACCEPTED_KEY = "pharmigo.installPromptAccepted";
const SNOOZE_DURATION_MS = 12 * 60 * 60 * 1000;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  const needsManualInstall = useMemo(() => isIos() && !isStandalone(), []);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(INSTALL_ACCEPTED_KEY) === "true") {
      return;
    }

    const snoozeUntil = Number(localStorage.getItem(INSTALL_SNOOZE_KEY) || "0");
    if (Number.isFinite(snoozeUntil) && snoozeUntil > Date.now()) {
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), 900);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as InstallPromptEvent);
      setVisible(true);
    };

    const handleInstalled = () => {
      localStorage.setItem(INSTALL_ACCEPTED_KEY, "true");
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) {
      return;
    }

    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        localStorage.setItem(INSTALL_ACCEPTED_KEY, "true");
        setVisible(false);
      }
    } finally {
      setDeferredPrompt(null);
      setInstalling(false);
    }
  }

  function handleContinueWeb() {
    localStorage.setItem(INSTALL_SNOOZE_KEY, String(Date.now() + SNOOZE_DURATION_MS));
    setVisible(false);
  }

  if (!visible || isStandalone()) {
    return null;
  }

  return (
    <div className="pharmigo-modal-overlay" role="dialog" aria-modal="true" aria-label="Installer PharmiGo">
      <div className="landing-modal-card install-prompt-card">
        <div className="landing-modal-head install-prompt-head">
          <div>
            <span className="landing-section-kicker">Installation recommandee</span>
            <h2>Installez d'abord PharmiGo sur votre appareil</h2>
            <p>
              Pour une utilisation plus stable, plus rapide et plus proche d'une vraie application mobile, PharmiGo recommande fortement
              l'installation avant la connexion.
            </p>
          </div>
        </div>

        <div className="install-prompt-body">
          <div className="install-prompt-panel highlight">
            <strong>Pourquoi installer ?</strong>
            <ul>
              <li>Ouverture plus rapide et plus fiable.</li>
              <li>Experience plein ecran proche d'une application native.</li>
              <li>Acces plus pratique aux notifications et aux ordonnances.</li>
            </ul>
          </div>

          <div className="install-prompt-panel">
            <strong>Suite recommandee</strong>
            <p>
              Installez l'application, puis connectez-vous pour commencer a utiliser PharmiGo dans de bonnes conditions.
            </p>
            {needsManualInstall ? (
              <p>
                Sur iPhone/iPad, ouvrez le menu de partage de Safari puis choisissez <strong>Ajouter a l'ecran d'accueil</strong>.
              </p>
            ) : deferredPrompt ? (
              <p>Votre navigateur est pret a installer PharmiGo maintenant.</p>
            ) : (
              <p>Si le bouton d'installation n'apparait pas encore, continuez quelques instants sur le web puis relancez l'installation.</p>
            )}
          </div>
        </div>

        <div className="install-prompt-actions">
          {deferredPrompt ? (
            <button type="button" className="pharmigo-primary-btn" onClick={() => void handleInstall()} disabled={installing}>
              {installing ? "Installation..." : "Installer PharmiGo"}
            </button>
          ) : null}
          <button type="button" className="pharmigo-secondary-btn" onClick={handleContinueWeb}>
            Continuer sur le web
          </button>
        </div>
      </div>
    </div>
  );
}
