import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { parseApiError } from "../lib/apiErrors";
import { confirmPasswordReset } from "../services/api";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const uid = searchParams.get("uid") ?? "";
  const token = searchParams.get("token") ?? "";
  const hasValidLinkParams = useMemo(() => Boolean(uid && token), [token, uid]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

    if (!hasValidLinkParams) {
      setError("Lien de reinitialisation invalide ou incomplet.");
      setBusy(false);
      return;
    }

    if (!password.trim()) {
      setError("Veuillez choisir un nouveau mot de passe.");
      setFieldErrors({ new_password: "Le mot de passe est obligatoire." });
      setBusy(false);
      return;
    }

    if (password.trim().length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caracteres.");
      setFieldErrors({ new_password: "Le mot de passe doit contenir au moins 6 caracteres." });
      setBusy(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      setFieldErrors({ confirm_password: "La confirmation ne correspond pas." });
      setBusy(false);
      return;
    }

    try {
      const result = await confirmPasswordReset({
        uid,
        token,
        new_password: password,
      });
      setSuccess(result.message);
      window.setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (caughtError) {
      const parsedError = parseApiError(caughtError, "Impossible de reinitialiser le mot de passe.");
      setError(parsedError.message);
      setFieldErrors(parsedError.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-panel auth-copy">
        <span className="landing-section-kicker">Acces</span>
        <h1>Choisissez un nouveau mot de passe.</h1>
        <p>Ce lien est temporaire. Une fois le mot de passe defini, vous pourrez reprendre votre connexion normale sur PharmiGo.</p>
      </div>

      <div className="auth-panel auth-form-panel">
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="section-heading compact">
            <h2>Nouveau mot de passe</h2>
            <p>Utilisez au minimum 6 caracteres pour securiser votre compte.</p>
          </div>

          <label>
            <span>Nouveau mot de passe</span>
            <input
              type="password"
              className={fieldErrors.new_password ? "field-input-error" : ""}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
            {fieldErrors.new_password ? <small className="field-error">{fieldErrors.new_password}</small> : null}
          </label>

          <label>
            <span>Confirmation</span>
            <input
              type="password"
              className={fieldErrors.confirm_password ? "field-input-error" : ""}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="••••••••"
            />
            {fieldErrors.confirm_password ? <small className="field-error">{fieldErrors.confirm_password}</small> : null}
          </label>

          {error ? <p className="form-feedback error">{error}</p> : null}
          {success ? <p className="form-feedback success">{success}</p> : null}

          <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={busy || !hasValidLinkParams}>
            {busy ? "Reinitialisation..." : "Definir mon nouveau mot de passe"}
          </button>

          <p className="auth-switch">
            Retour a la <Link to="/login">connexion</Link>
          </p>
        </form>
      </div>
    </section>
  );
}
