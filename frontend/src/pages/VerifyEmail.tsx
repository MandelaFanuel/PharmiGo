import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { parseApiError } from "../lib/apiErrors";
import { resendVerificationEmail, verifyEmail } from "../services/api";

export default function VerifyEmail() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);
  const locationState =
    location.state && typeof location.state === "object" ? (location.state as Record<string, unknown>) : null;
  const initialEmail = useMemo(
    () => String(locationState && "email" in locationState ? locationState.email : searchParams.get("email") ?? ""),
    [locationState, searchParams]
  );
  const initialMessage = useMemo(
    () => String(locationState && "message" in locationState ? locationState.message : ""),
    [locationState]
  );
  const initialDeliveryMode = useMemo(
    () => String(locationState && "emailDeliveryMode" in locationState ? locationState.emailDeliveryMode ?? "" : ""),
    [locationState]
  );
  const initialDebugToken = useMemo(
    () => String(locationState && "debugVerificationToken" in locationState ? locationState.debugVerificationToken ?? "" : ""),
    [locationState]
  );
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verification de votre adresse email...");
  const [email, setEmail] = useState(initialEmail);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [debugVerificationToken, setDebugVerificationToken] = useState(initialDebugToken);
  const [emailDeliveryMode, setEmailDeliveryMode] = useState(initialDeliveryMode);

  const debugVerificationUrl = useMemo(() => {
    if (!debugVerificationToken || typeof window === "undefined") {
      return "";
    }
    return `${window.location.origin}/verify-email?token=${encodeURIComponent(debugVerificationToken)}`;
  }, [debugVerificationToken]);

  useEffect(() => {
    if (!token) {
      setStatus("loading");
      setMessage(initialMessage || "Un email de verification a ete envoye. Ouvrez votre boite mail puis cliquez sur le lien recu.");
      return;
    }

    let cancelled = false;

    verifyEmail({ token })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setStatus("success");
        setMessage(result.message);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const parsedError = parseApiError(error, "Lien de verification invalide ou expire.");
        setStatus("error");
        setMessage(parsedError.message);
      });

    return () => {
      cancelled = true;
    };
  }, [initialMessage, token]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResendBusy(true);
    setResendMessage(null);
    setResendError(null);

    try {
      const result = await resendVerificationEmail({ email: email.trim().toLowerCase() });
      setResendMessage(result.message);
      setEmailDeliveryMode(result.email_delivery_mode ?? "");
      setDebugVerificationToken(result.debug_verification_token ?? "");
    } catch (error) {
      const parsedError = parseApiError(error, "Impossible de renvoyer l'email pour le moment.");
      setResendError(parsedError.message);
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <section className="auth-shell verify-email-page">
      <div className="verify-email-card">
        <div className="verify-email-card-top">
          <Link to="/" className="auth-brand-mark verify-email-brand" aria-label="Retour a l'accueil PharmiGo">
            <span className="auth-brand-icon">
              <img src="/logo.png" alt="" />
            </span>
            <span className="auth-brand-copy">
              <strong>PharmiGo</strong>
              <small>Verification email securisee</small>
            </span>
          </Link>

          <div className="auth-mode-switch verify-email-nav" aria-label="Acces auth">
            <Link to="/login" className="auth-mode-chip">
              Connexion
            </Link>
            <Link to="/login?mode=register" className="auth-mode-chip">
              Inscription
            </Link>
          </div>
        </div>

        <div className="verify-email-hero">
          <span className="landing-section-kicker">Verification email</span>
          <h1>Activez votre compte PharmiGo.</h1>
          <p>
            Confirmez votre adresse email pour finaliser l'inscription et acceder a votre espace en toute securite,
            avec un parcours simple et professionnel.
          </p>
        </div>

        <div className="verify-email-status-card">
          <div className="section-heading compact">
            <h2>Etat de verification</h2>
            <p>{token && status === "loading" ? "Nous validons votre lien..." : "Suivez les etapes ci-dessous pour activer votre compte."}</p>
          </div>

          <p className={`form-feedback ${status === "success" ? "success" : status === "error" ? "error" : status === "loading" ? "success" : ""}`}>{message}</p>

          {status === "success" ? (
            <div className="verify-email-actions">
              <Link to="/login" className="pharmigo-primary-btn auth-submit">
                Aller a la connexion
              </Link>
            </div>
          ) : null}

          {!token || status === "error" ? (
            <form onSubmit={handleResend} className="verify-email-form">
              <label>
                <span>Adresse email</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vous@exemple.com" />
              </label>

              {resendMessage ? <p className="form-feedback success">{resendMessage}</p> : null}
              {resendError ? <p className="form-feedback error">{resendError}</p> : null}
              {emailDeliveryMode === "console_preview" && debugVerificationUrl ? (
                <div className="form-feedback success">
                  <strong>Mode developpement :</strong> l’email est genere localement. Vous pouvez ouvrir directement le lien de verification.
                  <div className="verify-email-dev-link">
                    <a href={debugVerificationUrl} className="auth-mode-chip">
                      Ouvrir le lien de verification
                    </a>
                  </div>
                </div>
              ) : null}

              <div className="verify-email-actions">
                <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={resendBusy || !email.trim()}>
                  {resendBusy ? "Envoi..." : "Renvoyer l'email de verification"}
                </button>
                <Link to="/login?mode=register" className="verify-email-secondary-link">
                  Creer un nouveau compte
                </Link>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
