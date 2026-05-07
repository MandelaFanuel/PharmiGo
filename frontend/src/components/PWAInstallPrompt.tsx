import { useEffect, useMemo, useState } from "react";

import ModalTransition from "./ModalTransition";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type UpdateRegistration = ServiceWorkerRegistration | null;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isMobileInstallTarget() {
  return /android|iphone|ipad|ipod/i.test(window.navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstallGate, setShowInstallGate] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateRegistration, setUpdateRegistration] = useState<UpdateRegistration>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [iosInstallChecked, setIosInstallChecked] = useState(false);

  const needsManualInstall = useMemo(() => isIos() && !isStandalone(), []);
  const shouldRequireInstall = useMemo(() => isMobileInstallTarget() && !isStandalone(), []);
  const isUpdateBlocking = Boolean(updateRegistration);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    if (showInstallGate || isUpdateBlocking) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isUpdateBlocking, showInstallGate]);

  useEffect(() => {
    if (!shouldRequireInstall) {
      return;
    }

    const timer = window.setTimeout(() => setShowInstallGate(true), 700);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as InstallPromptEvent);
      setShowInstallGate(true);
    };

    const handleInstalled = () => {
      setShowInstallGate(false);
      setDeferredPrompt(null);
      setIosInstallChecked(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [shouldRequireInstall]);

  useEffect(() => {
    const handleUpdateAvailable = (event: Event) => {
      const customEvent = event as CustomEvent<ServiceWorkerRegistration>;
      setUpdateRegistration(customEvent.detail || null);
    };

    window.addEventListener("pharmigo:sw-update-available", handleUpdateAvailable);
    return () => {
      window.removeEventListener("pharmigo:sw-update-available", handleUpdateAvailable);
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
        setShowInstallGate(false);
      }
    } finally {
      setDeferredPrompt(null);
      setInstalling(false);
    }
  }

  function handleIosInstallCheck() {
    if (isStandalone()) {
      setShowInstallGate(false);
      setIosInstallChecked(false);
      return;
    }
    setIosInstallChecked(true);
  }

  function handleForceUpdate() {
    setIsRefreshing(true);
    if (updateRegistration?.waiting) {
      updateRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    window.location.reload();
  }

  if (isUpdateBlocking) {
    return (
      <ModalTransition overlayClassName="pharmigo-modal-overlay" panelClassName="landing-modal-card install-prompt-card install-prompt-card-critical" ariaLabel="Mise a jour obligatoire">
        <div className="landing-modal-head install-prompt-head">
          <div>
            <span className="landing-section-kicker">Mise a jour requise</span>
            <h2>Une nouvelle version de PharmiGo est disponible</h2>
            <p>
              Pour continuer a utiliser l'application en toute securite, vous devez charger la derniere version maintenant.
            </p>
          </div>
        </div>

        <div className="install-prompt-body install-prompt-body-single">
          <div className="install-prompt-panel highlight">
            <strong>Pourquoi cette action est obligatoire ?</strong>
            <ul>
              <li>Synchroniser les ecrans avec le backend et les dashboards.</li>
              <li>Eviter d'utiliser une ancienne version qui pourrait devenir instable.</li>
              <li>Garantir la compatibilite Android, iPhone et iPad sur le meme build.</li>
            </ul>
          </div>
        </div>

        <div className="install-prompt-actions install-prompt-actions-stack">
          <button type="button" className="pharmigo-primary-btn" onClick={handleForceUpdate} disabled={isRefreshing}>
            {isRefreshing ? "Mise a jour en cours..." : "Mettre a jour maintenant"}
          </button>
        </div>
      </ModalTransition>
    );
  }

  if (!showInstallGate || !shouldRequireInstall) {
    return null;
  }

  return (
    <ModalTransition overlayClassName="pharmigo-modal-overlay" panelClassName="landing-modal-card install-prompt-card" ariaLabel="Installer PharmiGo">
      <div className="landing-modal-head install-prompt-head">
        <div>
          <span className="landing-section-kicker">Installation obligatoire sur mobile</span>
          <h2>Installez PharmiGo avant de continuer</h2>
          <p>
            Sur Android et iPhone, PharmiGo doit etre installee comme une vraie application pour garantir une experience stable, rapide
            et bien mise a jour.
          </p>
        </div>
      </div>

      <div className="install-prompt-body">
        <div className="install-prompt-panel highlight">
          <strong>Ce que vous gagnez</strong>
          <ul>
            <li>Ouverture plein ecran et navigation plus fiable.</li>
            <li>Mises a jour plus claires et plus faciles a appliquer.</li>
            <li>Comportement plus proche d'une application native sur Android et iOS.</li>
          </ul>
        </div>

        <div className="install-prompt-panel">
          <strong>Etape suivante</strong>
          {needsManualInstall ? (
            <>
              <p>
                Sur iPhone ou iPad, ouvrez le menu de partage Safari puis choisissez <strong>Ajouter a l'ecran d'accueil</strong>, et
                relancez PharmiGo depuis l'icone installee.
              </p>
              <p className="install-prompt-note">
                Tant que l'application n'est pas ouverte depuis l'ecran d'accueil, l'acces reste bloque.
              </p>
              {iosInstallChecked ? <p className="install-prompt-error">Installation non detectee. Ouvrez maintenant PharmiGo depuis l'icone installee.</p> : null}
            </>
          ) : deferredPrompt ? (
            <p>Votre appareil est pret. Lancez maintenant l'installation pour continuer.</p>
          ) : (
            <p>Preparation de l'installation... si le bouton n'apparait pas tout de suite, laissez la page ouverte quelques instants.</p>
          )}
        </div>
      </div>

      <div className="install-prompt-actions install-prompt-actions-stack">
        {deferredPrompt ? (
          <button type="button" className="pharmigo-primary-btn" onClick={() => void handleInstall()} disabled={installing}>
            {installing ? "Installation..." : "Installer PharmiGo"}
          </button>
        ) : null}
        {needsManualInstall ? (
          <button type="button" className="pharmigo-secondary-btn" onClick={handleIosInstallCheck}>
            J'ai installe l'application
          </button>
        ) : null}
      </div>
    </ModalTransition>
  );
}
