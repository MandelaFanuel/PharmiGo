import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: {
              type?: string;
              theme?: string;
              size?: string;
              text?: string;
              shape?: string;
              width?: number;
            }
          ) => void;
        };
      };
    };
  }
}

const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
let googleCredentialHandler: ((credential: string) => void) | null = null;
let initializedGoogleClientId: string | null = null;

function loadGoogleScript() {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Impossible de charger Google Sign-In."));
    document.head.appendChild(script);
  });
}

function initializeGoogleIdentityClient(clientId: string) {
  if (!window.google?.accounts.id) {
    return;
  }

  if (initializedGoogleClientId === clientId) {
    return;
  }

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: ({ credential }) => {
      googleCredentialHandler?.(credential);
    },
  });
  initializedGoogleClientId = clientId;
}

export default function GoogleSignInButton({
  onCredential,
  onError,
  disabled = false,
  text = "signin_with",
}: {
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  text?: "signin_with" | "signup_with" | "continue_with";
}) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [buttonWidth, setButtonWidth] = useState(360);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    const element = buttonRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      const parentWidth = element.parentElement?.clientWidth ?? element.clientWidth ?? 360;
      const nextWidth = Math.max(220, Math.min(360, Math.floor(parentWidth)));
      setButtonWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(element);
      if (element.parentElement) {
        observer.observe(element.parentElement);
      }
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    googleCredentialHandler = onCredential;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google?.accounts.id) {
          return;
        }
        buttonRef.current.innerHTML = "";
        initializeGoogleIdentityClient(clientId);
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          width: buttonWidth,
        });
      })
      .catch((error: Error) => {
        if (!cancelled) {
          onError(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [buttonWidth, clientId, onCredential, onError, text]);

  if (!clientId) {
    return null;
  }

  return (
    <div className="google-signin-block" aria-busy={loading || disabled}>
      <div ref={buttonRef} style={disabled ? { pointerEvents: "none", opacity: 0.65 } : undefined} />
    </div>
  );
}
