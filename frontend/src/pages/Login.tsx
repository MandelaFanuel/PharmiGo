import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { getDashboardPathForUser, persistStoredAuthSession } from "../lib/auth";
import { parseApiError } from "../lib/apiErrors";
import { buildPhoneNumber, type PhoneCountryCode, validateInternationalPhoneNumber } from "../lib/phoneCountries";
import { login } from "../services/api";

function normalizeLoginIdentifier(identifier: string, countryCode: PhoneCountryCode) {
  const trimmed = identifier.trim();
  if (!trimmed || trimmed.includes("@") || trimmed.startsWith("+")) {
    return trimmed;
  }
  return buildPhoneNumber(countryCode, trimmed);
}

function validateLoginIdentifier(identifier: string, countryCode: PhoneCountryCode) {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return "Le numero de telephone ou l'email est obligatoire.";
  }
  if (!trimmed.includes("@")) {
    return validateInternationalPhoneNumber(normalizeLoginIdentifier(trimmed, countryCode));
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "Adresse email invalide.";
  }
  return null;
}

export default function Login() {
  const navigate = useNavigate();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [countryCode, setCountryCode] = useState<PhoneCountryCode>("bi");
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
    const identifierValidationError = validateLoginIdentifier(phoneNumber, countryCode);
    const normalizedIdentifier = normalizeLoginIdentifier(phoneNumber, countryCode);

    if (identifierValidationError || !password.trim()) {
      setError(identifierValidationError ?? "Veuillez remplir correctement les champs obligatoires.");
      setFieldErrors({
        ...(identifierValidationError ? { phone_number: identifierValidationError } : {}),
        ...(password.trim() ? {} : { password: "Le mot de passe est obligatoire." }),
      });
      setBusy(false);
      return;
    }

    try {
      const result = await login({ phone_number: normalizedIdentifier, password });
      persistStoredAuthSession(result.user, result.token);
      navigate(getDashboardPathForUser(result.user), { replace: true });
    } catch (caughtError) {
      const parsedError = parseApiError(caughtError, "Connexion impossible avec ce numero et ce mot de passe.");
      setError(parsedError.message);
      setFieldErrors(parsedError.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-panel auth-copy">
        <span className="landing-section-kicker">Connexion</span>
        <h1>Accedez a votre espace PharmiGo.</h1>
        <p>Connectez-vous pour publier, suivre les ordonnances et collaborer en temps reel sur la plateforme.</p>
      </div>

      <div className="auth-panel auth-form-panel">
        <form className="auth-form" onSubmit={handleSubmit} autoComplete="off">
          <div className="section-heading compact">
            <h2>Se connecter</h2>
            <p>Patients et pharmacies utilisent leur numero de telephone. L'administrateur utilise uniquement son email officiel.</p>
          </div>

          <label>
            {!phoneNumber.includes("@") ? (
              <>
                <span>Pays du numero</span>
                <select value={countryCode} onChange={(event) => setCountryCode(event.target.value as PhoneCountryCode)}>
                  <option value="bi">Burundi (+257)</option>
                  <option value="cd">RDC (+243)</option>
                  <option value="tz">Tanzanie (+255)</option>
                </select>
              </>
            ) : null}
          </label>

          <label>
            <span>Numero de telephone ou email</span>
            <input
              type="text"
              autoComplete="off"
              className={fieldErrors.phone_number ? "field-input-error" : ""}
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="+243812345678 ou email administrateur"
            />
            {fieldErrors.phone_number ? <small className="field-error">{fieldErrors.phone_number}</small> : null}
          </label>

          <label>
            <span>Mot de passe</span>
            <div className={fieldErrors.password ? "password-field password-field-error" : "password-field"}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Votre mot de passe"
              />
              <button type="button" className="password-toggle-button" onClick={() => setShowPassword((current) => !current)}>
                {showPassword ? "Masquer" : "Voir"}
              </button>
            </div>
            {fieldErrors.password ? <small className="field-error">{fieldErrors.password}</small> : null}
          </label>

          {error ? <p className="form-feedback error">{error}</p> : null}

          <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={busy}>
            {busy ? "Connexion..." : "Connexion"}
          </button>

          <p className="auth-switch">
            <Link to="/forgot-password">Mot de passe oublie ?</Link>
          </p>

          <p className="auth-switch">
            Pas encore de compte ? <Link to="/register">Creer un compte</Link>
          </p>
        </form>
      </div>
    </section>
  );
}
