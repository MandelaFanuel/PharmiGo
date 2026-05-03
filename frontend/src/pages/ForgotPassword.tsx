import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { parseApiError } from "../lib/apiErrors";
import { requestPasswordReset } from "../services/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    setFieldErrors({});

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Veuillez saisir votre adresse email.");
      setFieldErrors({ email: "L'adresse email est obligatoire." });
      setBusy(false);
      return;
    }

    try {
      const result = await requestPasswordReset({ email: normalizedEmail });
      setSuccess(result.message);
    } catch (caughtError) {
      const parsedError = parseApiError(caughtError, "Impossible d'envoyer le lien de reinitialisation.");
      setError(parsedError.message);
      setFieldErrors(parsedError.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-panel auth-copy">
        <span className="landing-section-kicker">Securite</span>
        <h1>Reinitialisez votre mot de passe PharmiGo.</h1>
        <p>La connexion normale reste basee sur le numero de telephone et le mot de passe. Ce formulaire sert seulement si vous aviez ajoute un email de recuperation a votre compte.</p>
      </div>

      <div className="auth-panel auth-form-panel">
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="section-heading compact">
            <h2>Mot de passe oublie</h2>
            <p>Si vous n'avez pas renseigne d'email auparavant, la reinitialisation automatique ne pourra pas etre envoyee.</p>
          </div>

          <label>
            <span>Email de recuperation</span>
            <input
              type="email"
              className={fieldErrors.email ? "field-input-error" : ""}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email optionnel enregistre auparavant"
            />
            {fieldErrors.email ? <small className="field-error">{fieldErrors.email}</small> : null}
          </label>

          {error ? <p className="form-feedback error">{error}</p> : null}
          {success ? <p className="form-feedback success">{success}</p> : null}

          <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={busy}>
            {busy ? "Envoi..." : "Envoyer le lien"}
          </button>

          <p className="auth-switch">
            Retour a la <Link to="/login">connexion</Link>
          </p>
        </form>
      </div>
    </section>
  );
}
