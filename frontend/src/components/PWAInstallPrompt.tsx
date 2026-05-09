import { useEffect, useMemo, useState } from "react";

import ModalTransition from "./ModalTransition";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type UpdateRegistration = ServiceWorkerRegistration | null;

const INSTALL_PROMPT_STORAGE_KEY = "pharmigo.installPrompt.dismissedAt.v2";
const INSTALL_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isSafari() {
  const ua = window.navigator.userAgent;
  return /safari/i.test(ua) && !/crios|fxios|edgios|opr\//i.test(ua);
}

function isFirefoxLike() {
  return /firefox|fenix/i.test(window.navigator.userAgent);
}

function isAndroid() {
  return /android/i.test(window.navigator.userAgent);
}

function isMobileInstallTarget() {
  return /android|iphone|ipad|ipod/i.test(window.navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;
}

function shouldDelayPrompt() {
  if (typeof window === "undefined") {
    return true;
  }

  const storedValue = window.localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY);
  if (!storedValue) {
    return false;
  }

  const dismissedAt = Number.parseInt(storedValue, 10);
  if (!Number.isFinite(dismissedAt)) {
    return false;
  }

  return Date.now() - dismissedAt < INSTALL_PROMPT_COOLDOWN_MS;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateRegistration, setUpdateRegistration] = useState<UpdateRegistration>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isMobile = useMemo(() => isMobileInstallTarget(), []);
  const needsManualIosInstall = useMemo(() => isIos() && !isStandalone(), []);
  const isFirefoxManualInstall = useMemo(() => isAndroid() && isFirefoxLike() && !isStandalone(), []);
  const isIosNonSafari = useMemo(() => isIos() && !isSafari(), []);
  const shouldSuggestInstall = useMemo(() => isMobile && !isStandalone(), [isMobile]);
  const isUpdateBlocking = Boolean(updateRegistration);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    if (isUpdateBlocking) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isUpdateBlocking]);

  useEffect(() => {
    if (!shouldSuggestInstall || shouldDelayPrompt()) {
      return;
    }

    const timer = window.setTimeout(() => setShowInstallPrompt(true), 1400);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as InstallPromptEvent);
      setShowInstallPrompt(true);
    };

    const handleInstalled = () => {
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
      window.localStorage.setItem(INSTALL_PROMPT_STORAGE_KEY, String(Date.now()));
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [shouldSuggestInstall]);

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
        setShowInstallPrompt(false);
        window.localStorage.setItem(INSTALL_PROMPT_STORAGE_KEY, String(Date.now()));
      }
    } finally {
      setDeferredPrompt(null);
      setInstalling(false);
    }
  }

  function handleDismiss() {
    setShowInstallPrompt(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(INSTALL_PROMPT_STORAGE_KEY, String(Date.now()));
    }
  }

  function handleForceUpdate() {
    setIsRefreshing(true);
    if (updateRegistration?.waiting) {
      updateRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    window.location.reload();
  }

  function renderInstallInstructions() {
    if (needsManualIosInstall) {
      return (
        <>
          <p>
            Sur iPhone ou iPad, l'installation ne passe pas par un bouton automatique. Ouvrez le menu de partage puis choisissez
            <strong> Ajouter a l'ecran d'accueil</strong>.
          </p>
          {isIosNonSafari ? (
            <p className="install-prompt-note">
              Si vous etes dans Chrome, Firefox ou un autre navigateur iPhone, ouvrez cette page dans Safari pour voir l'option
              d'installation iOS.
            </p>
          ) : null}
        </>
      );
    }

    if (deferredPrompt) {
      return <p>Votre navigateur prend en charge l'installation directe. Lancez-la quand vous voulez.</p>;
    }

    if (isFirefoxManualInstall) {
      return (
        <>
          <p>
            Sur Fenix ou Firefox Android, le bouton standard n'apparait pas toujours. Utilisez le menu du navigateur puis choisissez
            <strong> Installer</strong> ou <strong>Ajouter a l'ecran d'accueil</strong>.
          </p>
          <p className="install-prompt-note">Le site reste accessible meme sans installation.</p>
        </>
      );
    }

    return (
      <>
        <p>
          Certains navigateurs mobiles n'affichent pas le bouton d'installation immediatement. Vous pouvez continuer sur le web,
          puis installer PharmiGo plus tard depuis le menu du navigateur si vous le souhaitez.
        </p>
        <p className="install-prompt-note">Cette recommandation est optionnelle: l'acces web reste ouvert.</p>
      </>
    );
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

  if (!showInstallPrompt || !shouldSuggestInstall) {
    return null;
  }

  return (
    <ModalTransition
      overlayClassName="pharmigo-modal-overlay"
      panelClassName="landing-modal-card install-prompt-card"
      ariaLabel="Installer PharmiGo"
      onBackdropClick={handleDismiss}
    >
      <div className="landing-modal-head install-prompt-head">
        <div>
          <span className="landing-section-kicker">Installation recommandee</span>
          <h2>Installez PharmiGo si vous voulez une experience plus proche d'une app</h2>
          <p>
            PharmiGo reste accessible sur le web mobile. L'installation est seulement conseillee pour un acces plus rapide et plus
            stable depuis l'ecran d'accueil.
          </p>
        </div>
      </div>

      <div className="install-prompt-body">
        <div className="install-prompt-panel highlight">
          <strong>Ce que vous gagnez</strong>
          <ul>
            <li>Ouverture plus rapide depuis l'ecran d'accueil.</li>
            <li>Moins de frictions entre l'appareil, le navigateur et les mises a jour.</li>
            <li>Une interface plus proche d'une application native.</li>
          </ul>
        </div>

        <div className="install-prompt-panel">
          <strong>Etape suivante</strong>
          {renderInstallInstructions()}
        </div>
      </div>

      <div className="install-prompt-actions install-prompt-actions-stack">
        {deferredPrompt ? (
          <button type="button" className="pharmigo-primary-btn" onClick={() => void handleInstall()} disabled={installing}>
            {installing ? "Installation..." : "Installer PharmiGo"}
          </button>
        ) : null}
        <button type="button" className="pharmigo-secondary-btn" onClick={handleDismiss} disabled={installing}>
          Continuer sur le web
        </button>
      </div>
    </ModalTransition>
  );
}
