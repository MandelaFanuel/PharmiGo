import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import GoogleSignInButton from "../components/GoogleSignInButton";
import PhoneNumberField from "../components/PhoneNumberField";
import { parseApiError } from "../lib/apiErrors";
import { buildPhoneNumber, type PhoneCountryCode, validateInternationalPhoneNumber } from "../lib/phoneCountries";
import { getDashboardPathForUser, persistStoredAuthSession } from "../lib/auth";
import { loginWithGoogle, register } from "../services/api";

type AccountType = "patient" | "pharmacy";
type PatientGender = "male" | "female" | "other" | "";

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

function validateEmailValue(email: string) {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return "L'adresse email est obligatoire.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "Adresse email invalide.";
  }
  return null;
}

export default function Register() {
  const navigate = useNavigate();
  const [accountType, setAccountType] = useState<AccountType>("patient");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [patientCountryCode, setPatientCountryCode] = useState<PhoneCountryCode>("bi");
  const [pharmacyCountryCode, setPharmacyCountryCode] = useState<PhoneCountryCode>("bi");
  const [patientForm, setPatientForm] = useState({
    username: "",
    phone_number: "",
    birth_date: "",
    gender: "" as PatientGender,
    email: "",
    password: "",
  });
  const [pharmacyForm, setPharmacyForm] = useState({
    pharmacy_name: "",
    phone_number: "",
    email: "",
    address: "",
    password: "",
    pharmacy_image: null as File | null,
  });
  const [showPatientPassword, setShowPatientPassword] = useState(false);
  const [showPharmacyPassword, setShowPharmacyPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      if (accountType === "patient") {
        const username = patientForm.username.trim();
        const phoneNumber = patientForm.phone_number.trim();
        const birthDate = patientForm.birth_date.trim();
        const gender = patientForm.gender;
        const email = patientForm.email.trim().toLowerCase();
        const password = patientForm.password.trim();
        const emailValidationError = validateEmailValue(email);

        if (!username || !phoneNumber || !email || !password || emailValidationError) {
          setError(emailValidationError ?? "Veuillez remplir correctement les champs obligatoires.");
          setFieldErrors({
            ...(username ? {} : { username: "Le nom d'utilisateur est obligatoire." }),
            ...(phoneNumber ? {} : { phone_number: "Le numero de telephone est obligatoire." }),
            ...(emailValidationError ? { email: emailValidationError } : {}),
            ...(password ? {} : { password: "Le mot de passe est obligatoire." }),
          });
          return;
        }

        if (password.length < 6) {
          setError("Le mot de passe doit contenir au moins 6 caracteres.");
          setFieldErrors({ password: "Le mot de passe doit contenir au moins 6 caracteres." });
          return;
        }

        const fullPhoneNumber = buildPhoneNumber(patientCountryCode, phoneNumber);
        const phoneValidationError = validateInternationalPhoneNumber(fullPhoneNumber);
        if (phoneValidationError) {
          setError(phoneValidationError);
          setFieldErrors({ phone_number: phoneValidationError });
          return;
        }

        const result = await register({
          account_type: "patient",
          username,
          phone_number: fullPhoneNumber,
          birth_date: birthDate || undefined,
          gender: gender || undefined,
          email,
          password: patientForm.password,
        });
        navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
          replace: true,
          state: {
            message: result.message,
            email,
            emailDeliveryMode: result.email_delivery_mode,
            debugVerificationToken: result.debug_verification_token,
          },
        });
        return;
      }

      const pharmacyName = pharmacyForm.pharmacy_name.trim();
      const phoneNumber = pharmacyForm.phone_number.trim();
      const email = pharmacyForm.email.trim().toLowerCase();
      const address = pharmacyForm.address.trim();
      const password = pharmacyForm.password.trim();
      const emailValidationError = validateEmailValue(email);

      if (!pharmacyName || !phoneNumber || !email || !address || !password || emailValidationError) {
          setError(emailValidationError ?? "Veuillez remplir correctement les champs obligatoires.");
          setFieldErrors({
            ...(pharmacyName ? {} : { pharmacy_name: "Le nom de la pharmacie est obligatoire." }),
            ...(phoneNumber ? {} : { phone_number: "Le numero de telephone est obligatoire." }),
            ...(emailValidationError ? { email: emailValidationError } : {}),
            ...(address ? {} : { address: "L'adresse exacte est obligatoire." }),
            ...(password ? {} : { password: "Le mot de passe est obligatoire." }),
          });
          return;
      }

      if (password.length < 6) {
        setError("Le mot de passe doit contenir au moins 6 caracteres.");
        setFieldErrors({ password: "Le mot de passe doit contenir au moins 6 caracteres." });
        return;
      }

      const fullPhoneNumber = buildPhoneNumber(pharmacyCountryCode, phoneNumber);
      const phoneValidationError = validateInternationalPhoneNumber(fullPhoneNumber);
      if (phoneValidationError) {
        setError(phoneValidationError);
        setFieldErrors({ phone_number: phoneValidationError });
        return;
      }

      const result = await register({
        account_type: "pharmacy",
        pharmacy_name: pharmacyName,
        phone_number: fullPhoneNumber,
        email,
        address,
        password: pharmacyForm.password,
        pharmacy_image: pharmacyForm.pharmacy_image,
      });
      navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
        replace: true,
        state: {
          message: result.message,
          email,
          emailDeliveryMode: result.email_delivery_mode,
          debugVerificationToken: result.debug_verification_token,
        },
      });
      return;
    } catch (caughtError) {
      const parsedError = parseApiError(caughtError, "Inscription impossible pour le moment. Verifiez les informations saisies.");
      setError(parsedError.message);
      setFieldErrors(parsedError.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleRegister(credential: string) {
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
      const parsedError = parseApiError(caughtError, "Inscription Google impossible pour le moment.");
      setError(parsedError.message);
      setFieldErrors(parsedError.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-panel auth-copy">
        <span className="landing-section-kicker">Inscription</span>
        <h1>Creer votre compte PharmiGo.</h1>
        <p>Les pharmacies deviennent visibles sur la page d'accueil apres inscription, et les patients peuvent ensuite publier leurs ordonnances.</p>
      </div>

      <div className="auth-panel auth-form-panel">
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="section-heading compact">
            <h2>Inscription</h2>
            <p>Choisissez votre profil, ajoutez un email obligatoire, puis confirmez-le pour activer le compte.</p>
          </div>

          <GoogleSignInButton onCredential={handleGoogleRegister} onError={setError} disabled={busy} text="signup_with" />
          <div className="auth-role-switch" aria-label="Type de compte">
            <button type="button" className={accountType === "patient" ? "auth-role-chip active" : "auth-role-chip"} onClick={() => setAccountType("patient")}>
              Patient
            </button>
            <button type="button" className={accountType === "pharmacy" ? "auth-role-chip active" : "auth-role-chip"} onClick={() => setAccountType("pharmacy")}>
              Pharmacie
            </button>
          </div>

          {accountType === "patient" ? (
            <>
              <label>
                <span>Nom d'utilisateur</span>
                <input
                  className={fieldErrors.username ? "field-input-error" : ""}
                  value={patientForm.username}
                  onChange={(event) => setPatientForm((current) => ({ ...current, username: event.target.value }))}
                />
                {fieldErrors.username ? <small className="field-error">{fieldErrors.username}</small> : null}
              </label>
              <PhoneNumberField
                label="Numero de telephone"
                countryCode={patientCountryCode}
                localNumber={patientForm.phone_number}
                onCountryChange={setPatientCountryCode}
                onLocalNumberChange={(value) => setPatientForm((current) => ({ ...current, phone_number: value }))}
                error={fieldErrors.phone_number}
              />
              <label>
                <span>Email obligatoire</span>
                <input
                  type="email"
                  className={fieldErrors.email ? "field-input-error" : ""}
                  value={patientForm.email}
                  onChange={(event) => setPatientForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="vous@exemple.com"
                />
                {fieldErrors.email ? <small className="field-error">{fieldErrors.email}</small> : null}
                <small className="field-help">Un lien de verification sera envoye a cette adresse avant la premiere connexion.</small>
              </label>
              <label>
                <span>Date de naissance</span>
                <input
                  type="date"
                  value={patientForm.birth_date}
                  onChange={(event) => setPatientForm((current) => ({ ...current, birth_date: event.target.value }))}
                />
              </label>
              <label>
                <span>Genre</span>
                <select value={patientForm.gender} onChange={(event) => setPatientForm((current) => ({ ...current, gender: event.target.value as PatientGender }))}>
                  <option value="">Selectionner</option>
                  <option value="male">Masculin</option>
                  <option value="female">Feminin</option>
                  <option value="other">Autre</option>
                </select>
              </label>
              <label>
                <span>Mot de passe</span>
                <div className={fieldErrors.password ? "password-field password-field-error" : "password-field"}>
                  <input
                    type={showPatientPassword ? "text" : "password"}
                    value={patientForm.password}
                    onChange={(event) => setPatientForm((current) => ({ ...current, password: event.target.value }))}
                  />
                  <button type="button" className="password-toggle-button" onClick={() => setShowPatientPassword((current) => !current)}>
                    <EyeIcon open={showPatientPassword} />
                  </button>
                </div>
                {fieldErrors.password ? <small className="field-error">{fieldErrors.password}</small> : null}
              </label>
            </>
          ) : (
            <>
              <label>
                <span>Nom de la pharmacie</span>
                <input
                  className={fieldErrors.pharmacy_name ? "field-input-error" : ""}
                  value={pharmacyForm.pharmacy_name}
                  onChange={(event) => setPharmacyForm((current) => ({ ...current, pharmacy_name: event.target.value }))}
                />
                {fieldErrors.pharmacy_name ? <small className="field-error">{fieldErrors.pharmacy_name}</small> : null}
              </label>
              <PhoneNumberField
                label="Numero de telephone"
                countryCode={pharmacyCountryCode}
                localNumber={pharmacyForm.phone_number}
                onCountryChange={setPharmacyCountryCode}
                onLocalNumberChange={(value) => setPharmacyForm((current) => ({ ...current, phone_number: value }))}
                error={fieldErrors.phone_number}
              />
              <label>
                <span>Email obligatoire</span>
                <input
                  type="email"
                  className={fieldErrors.email ? "field-input-error" : ""}
                  value={pharmacyForm.email}
                  onChange={(event) => setPharmacyForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="contact@pharmacie.com"
                />
                {fieldErrors.email ? <small className="field-error">{fieldErrors.email}</small> : null}
                <small className="field-help">Le compte pharmacie restera bloque tant que cet email n'a pas ete verifie.</small>
              </label>
              <label>
                <span>Adresse exacte</span>
                <input
                  className={fieldErrors.address ? "field-input-error" : ""}
                  value={pharmacyForm.address}
                  onChange={(event) => setPharmacyForm((current) => ({ ...current, address: event.target.value }))}
                />
                {fieldErrors.address ? <small className="field-error">{fieldErrors.address}</small> : null}
              </label>
              <label>
                <span>Image de la pharmacie</span>
                <input type="file" accept="image/*" onChange={(event) => setPharmacyForm((current) => ({ ...current, pharmacy_image: event.target.files?.[0] ?? null }))} />
              </label>
              <label>
                <span>Mot de passe</span>
                <div className={fieldErrors.password ? "password-field password-field-error" : "password-field"}>
                  <input
                    type={showPharmacyPassword ? "text" : "password"}
                    value={pharmacyForm.password}
                    onChange={(event) => setPharmacyForm((current) => ({ ...current, password: event.target.value }))}
                  />
                  <button type="button" className="password-toggle-button" onClick={() => setShowPharmacyPassword((current) => !current)}>
                    <EyeIcon open={showPharmacyPassword} />
                  </button>
                </div>
                {fieldErrors.password ? <small className="field-error">{fieldErrors.password}</small> : null}
              </label>
            </>
          )}

          {error ? <p className="form-feedback error">{error}</p> : null}

          <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={busy}>
            {busy ? "Enregistrement..." : accountType === "patient" ? "Creer mon compte patient" : "Enregistrer ma pharmacie"}
          </button>

          <p className="auth-switch">
            Vous avez deja un compte ? <Link to="/login">Se connecter</Link>
          </p>
        </form>
      </div>
    </section>
  );
}
