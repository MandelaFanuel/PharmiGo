import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import GoogleSignInButton from "../components/GoogleSignInButton";
import { getDashboardPathForUser, persistStoredAuthSession } from "../lib/auth";
import { parseApiError } from "../lib/apiErrors";
import { login, loginWithGoogle } from "../services/api";

function normalizeLoginIdentifier(identifier: string) {
  const trimmed = identifier.trim();
  return trimmed.toLowerCase();
}

function validateLoginIdentifier(identifier: string) {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return "L'adresse email est obligatoire.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "Adresse email invalide.";
  }
  return null;
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="password-toggle-icon">
      <path
        d="M3 3l18 18M10.58 10.59A2 2 0 0012 14a2 2 0 001.41-.58M9.88 5.09A10.94 10.94 0 0112 5c5.05 0 9.27 3.11 10 7-.28 1.48-1.15 2.87-2.45 4.03M6.23 6.24C4.24 7.51 2.82 9.39 2 12c.73 3.89 4.95 7 10 7 1.55 0 3.03-.29 4.36-.82"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="password-toggle-icon">
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const identifierValidationError = validateLoginIdentifier(email);
    const normalizedIdentifier = normalizeLoginIdentifier(email);

    if (identifierValidationError || !password.trim()) {
      setError(identifierValidationError ?? "Veuillez remplir correctement les champs obligatoires.");
      setFieldErrors({
        ...(identifierValidationError ? { email: identifierValidationError } : {}),
        ...(password.trim() ? {} : { password: "Le mot de passe est obligatoire." }),
      });
      setBusy(false);
      return;
    }

    try {
      const result = await login({ email: normalizedIdentifier, password });
      if (!result.token) {
        throw new Error("Token de connexion manquant.");
      }
      persistStoredAuthSession(result.user, result.token);
      navigate(getDashboardPathForUser(result.user), { replace: true });
    } catch (caughtError) {
      const parsedError = parseApiError(caughtError, "Connexion impossible avec cette adresse email et ce mot de passe.");
      setError(parsedError.message);
      setFieldErrors(parsedError.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleLogin(credential: string) {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await loginWithGoogle({ credential });
      if (!result.token) {
        throw new Error("Token de connexion Google manquant.");
      }
      persistStoredAuthSession(result.user, result.token);
      navigate(getDashboardPathForUser(result.user), { replace: true });
    } catch (caughtError) {
      const parsedError = parseApiError(caughtError, "Connexion Google impossible pour le moment.");
      setError(parsedError.message);
      setFieldErrors(parsedError.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-shell login-shell">
      <div className="auth-panel login-form-panel">
        <form className="auth-form login-form" onSubmit={handleSubmit} autoComplete="off">
          <div className="login-brand-row">
            <img src="/pharmigo-logo.png" alt="PharmiGo" className="login-brand-logo" />
            <div className="login-brand-copy">
              <strong>PharmiGo</strong>
              <span>Sante connectee, rapide et humaine.</span>
            </div>
          </div>

          <div className="login-copy-block">
            <h1>Bienvenue sur votre espace PharmiGo</h1>
            <p>Connectez-vous avec votre email verifie pour gerer les ordonnances, suivre les echanges et retrouver votre assistant PharmiGo.</p>
          </div>

          <label className="login-field">
            <span>Adresse email</span>
            <input
              type="email"
              autoComplete="email"
              className={fieldErrors.email ? "field-input-error" : ""}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="vous@exemple.com"
            />
            {fieldErrors.email ? <small className="field-error">{fieldErrors.email}</small> : null}
          </label>

          <label className="login-field">
            <span>Mot de passe</span>
            <div className={fieldErrors.password ? "password-field password-field-error" : "password-field"}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Votre mot de passe"
              />
              <button type="button" className="password-toggle-button" onClick={() => setShowPassword((current) => !current)}>
                <EyeIcon open={showPassword} />
              </button>
            </div>
            {fieldErrors.password ? <small className="field-error">{fieldErrors.password}</small> : null}
          </label>

          {error ? <p className="form-feedback error">{error}</p> : null}

          <button type="submit" className="pharmigo-primary-btn auth-submit login-submit" disabled={busy}>
            {busy ? "Connexion..." : "Continuer"}
          </button>

          <div className="login-divider">
            <span>Ou continuer avec</span>
          </div>

          <div className="login-google-wrap">
            <GoogleSignInButton onCredential={handleGoogleLogin} onError={setError} disabled={busy} />
          </div>
          <div className="login-links-grid">
            <p className="auth-switch">
              <Link to="/forgot-password">Mot de passe oublie ?</Link>
            </p>
          </div>

          <p className="auth-switch login-register-link">
            Pas encore de compte ? <Link to="/register">Creer un compte</Link>
          </p>
        </form>
      </div>

      <div className="auth-panel login-visual-panel">
        <div className="login-visual-backdrop">
          <div className="login-visual-copy">
            <span className="login-visual-badge">Assistant PharmiGo</span>
            <h2>Votre chatbot sante vous accompagne a chaque connexion.</h2>
            <p>Retrouvez vos interactions, vos ordonnances et vos recommandations dans une experience plus claire, plus rapide et plus rassurante.</p>
          </div>

          <div className="login-visual-stage">
            <img src="/chatbot-guardian.png" alt="Chatbot PharmiGo" className="login-chatbot-image" />
          </div>
        </div>
      </div>
    </section>
  );
}
