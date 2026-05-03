import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import PhoneNumberField from "../components/PhoneNumberField";
import { getDashboardPathForUser, persistStoredAuthSession } from "../lib/auth";
import { parseApiError } from "../lib/apiErrors";
import { buildPhoneNumber, type PhoneCountryCode, validateInternationalPhoneNumber } from "../lib/phoneCountries";
import { login, register } from "../services/api";

type AccountType = "patient" | "pharmacy";

export default function Register() {
  const navigate = useNavigate();
  const [accountType, setAccountType] = useState<AccountType>("patient");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [patientCountryCode, setPatientCountryCode] = useState<PhoneCountryCode>("bi");
  const [pharmacyCountryCode, setPharmacyCountryCode] = useState<PhoneCountryCode>("bi");
  const [patientForm, setPatientForm] = useState({ username: "", phone_number: "", email: "", password: "" });
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
        const email = patientForm.email.trim().toLowerCase();
        const password = patientForm.password.trim();

        if (!username || !phoneNumber || !password) {
          setError("Veuillez remplir correctement les champs obligatoires.");
          setFieldErrors({
            ...(username ? {} : { username: "Le nom d'utilisateur est obligatoire." }),
            ...(phoneNumber ? {} : { phone_number: "Le numero de telephone est obligatoire." }),
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

        await register({
          account_type: "patient",
          username,
          phone_number: fullPhoneNumber,
          email,
          password: patientForm.password,
        });

        const result = await login({ phone_number: fullPhoneNumber, password: patientForm.password });
        persistStoredAuthSession(result.user, result.token);
        navigate(getDashboardPathForUser(result.user), { replace: true });
        return;
      }

      const pharmacyName = pharmacyForm.pharmacy_name.trim();
      const phoneNumber = pharmacyForm.phone_number.trim();
      const email = pharmacyForm.email.trim().toLowerCase();
      const address = pharmacyForm.address.trim();
      const password = pharmacyForm.password.trim();

        if (!pharmacyName || !phoneNumber || !address || !password) {
          setError("Veuillez remplir correctement les champs obligatoires.");
          setFieldErrors({
            ...(pharmacyName ? {} : { pharmacy_name: "Le nom de la pharmacie est obligatoire." }),
            ...(phoneNumber ? {} : { phone_number: "Le numero de telephone est obligatoire." }),
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

      await register({
        account_type: "pharmacy",
        pharmacy_name: pharmacyName,
        phone_number: fullPhoneNumber,
        email,
        address,
        password: pharmacyForm.password,
        pharmacy_image: pharmacyForm.pharmacy_image,
      });

      const result = await login({ phone_number: fullPhoneNumber, password: pharmacyForm.password });
      persistStoredAuthSession(result.user, result.token);
      navigate(getDashboardPathForUser(result.user), { replace: true });
      return;
    } catch (caughtError) {
      const parsedError = parseApiError(caughtError, "Inscription impossible pour le moment. Verifiez les informations saisies.");
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
        <p>Les pharmacies deviennent visibles sur la page d’accueil apres inscription, et les patients peuvent ensuite publier leurs ordonnances.</p>
      </div>

      <div className="auth-panel auth-form-panel">
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="section-heading compact">
            <h2>Inscription</h2>
            <p>Choisissez votre profil et completez les champs necessaires.</p>
          </div>

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
                <span>Email facultatif</span>
                <input
                  type="email"
                  className={fieldErrors.email ? "field-input-error" : ""}
                  value={patientForm.email}
                  onChange={(event) => setPatientForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="Optionnel, utile si vous oubliez le mot de passe"
                />
                {fieldErrors.email ? <small className="field-error">{fieldErrors.email}</small> : null}
                <small className="field-help">Ajoutez un email seulement si vous voulez pouvoir recuperer votre mot de passe plus facilement.</small>
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
                    {showPatientPassword ? "Masquer" : "Voir"}
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
                <span>Email facultatif</span>
                <input
                  type="email"
                  className={fieldErrors.email ? "field-input-error" : ""}
                  value={pharmacyForm.email}
                  onChange={(event) => setPharmacyForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="Optionnel, utile si vous oubliez le mot de passe"
                />
                {fieldErrors.email ? <small className="field-error">{fieldErrors.email}</small> : null}
                <small className="field-help">Cet email reste optionnel et sert surtout a la recuperation de mot de passe.</small>
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
                    {showPharmacyPassword ? "Masquer" : "Voir"}
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
