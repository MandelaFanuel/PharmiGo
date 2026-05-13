import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import GoogleSignInButton from "../components/GoogleSignInButton";
import PhoneNumberField from "../components/PhoneNumberField";
import { getDashboardPathForUser, persistStoredAuthSession } from "../lib/auth";
import { parseApiError } from "../lib/apiErrors";
import { describeGeolocationError, requestBrowserCoordinates, supportsGeolocation } from "../lib/geolocation";
import { buildPhoneNumber, type PhoneCountryCode, validateInternationalPhoneNumber } from "../lib/phoneCountries";
import { login, loginWithGoogle, register } from "../services/api";

type AuthMode = "login" | "register";
type AccountType = "patient" | "pharmacy";
type PatientGender = "male" | "female" | "other" | "";
type PharmacySalesModeChoice = "retail" | "wholesale" | "both" | null;
type RegistrationLocation = {
  latitude: number;
  longitude: number;
};

function getSalesModeChoiceFromFlags({
  wholesale_supported,
  retail_supported,
}: {
  wholesale_supported: boolean;
  retail_supported: boolean;
}): PharmacySalesModeChoice {
  if (wholesale_supported && retail_supported) {
    return "both";
  }
  if (wholesale_supported) {
    return "wholesale";
  }
  if (retail_supported) {
    return "retail";
  }
  return null;
}

function applySalesModeChoice(choice: PharmacySalesModeChoice) {
  if (choice === "both") {
    return { wholesale_supported: true, retail_supported: true };
  }
  if (choice === "wholesale") {
    return { wholesale_supported: true, retail_supported: false };
  }
  if (choice === "retail") {
    return { wholesale_supported: false, retail_supported: true };
  }
  return { wholesale_supported: false, retail_supported: false };
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

function BackHomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="auth-back-icon">
      <path d="M15 18l-6-6 6-6M9 12h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function validateEmailIdentifier(identifier: string) {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return "L'adresse email est obligatoire.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "Adresse email invalide.";
  }
  return null;
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

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginFieldErrors, setLoginFieldErrors] = useState<Record<string, string>>({});

  const [accountType, setAccountType] = useState<AccountType>("patient");
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerFieldErrors, setRegisterFieldErrors] = useState<Record<string, string>>({});
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
    referral_code: "",
    wholesale_supported: false,
    retail_supported: false,
  });
  const [showPatientPassword, setShowPatientPassword] = useState(false);
  const [showPharmacyPassword, setShowPharmacyPassword] = useState(false);
  const [registrationLocation, setRegistrationLocation] = useState<RegistrationLocation | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const mode: AuthMode = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("mode") === "register" ? "register" : "login";
  }, [location.search]);

  const referralCodeFromUrl = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return (searchParams.get("ref") || "").trim().toUpperCase();
  }, [location.search]);

  useEffect(() => {
    if (!referralCodeFromUrl) {
      return;
    }

    setAccountType("pharmacy");
    setPharmacyForm((current) => (
      current.referral_code === referralCodeFromUrl
        ? current
        : {
            ...current,
            referral_code: referralCodeFromUrl,
          }
    ));
  }, [referralCodeFromUrl]);

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) {
      return;
    }
    const preservedRef = referralCodeFromUrl ? `&ref=${encodeURIComponent(referralCodeFromUrl)}` : "";
    navigate(nextMode === "register" ? `/login?mode=register${preservedRef}` : "/login");
  }

  async function handleCaptureLocation() {
    setLocationBusy(true);
    setLocationError(null);
    try {
      const coordinates = await requestBrowserCoordinates();
      setRegistrationLocation(coordinates);
    } catch (caughtError) {
      setLocationError(describeGeolocationError(caughtError));
    } finally {
      setLocationBusy(false);
    }
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    setLoginFieldErrors({});

    const identifierValidationError = validateEmailIdentifier(loginEmail);
    const normalizedIdentifier = loginEmail.trim().toLowerCase();

    if (identifierValidationError || !loginPassword.trim()) {
      setLoginError(identifierValidationError ?? "Veuillez remplir correctement les champs obligatoires.");
      setLoginFieldErrors({
        ...(identifierValidationError ? { email: identifierValidationError } : {}),
        ...(loginPassword.trim() ? {} : { password: "Le mot de passe est obligatoire." }),
      });
      setLoginBusy(false);
      return;
    }

    try {
      const result = await login({ email: normalizedIdentifier, password: loginPassword });
      if (!result.token) {
        throw new Error("Token de connexion manquant.");
      }
      persistStoredAuthSession(result.user, result.token);
      navigate(getDashboardPathForUser(result.user), { replace: true });
    } catch (caughtError) {
      const parsedError = parseApiError(caughtError, "Connexion impossible avec cette adresse email et ce mot de passe.");
      setLoginError(parsedError.message);
      setLoginFieldErrors(parsedError.fieldErrors);
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleGoogleAuth(credential: string) {
    const isRegisterMode = mode === "register";
    if (isRegisterMode) {
      setRegisterBusy(true);
      setRegisterError(null);
      setRegisterFieldErrors({});
    } else {
      setLoginBusy(true);
      setLoginError(null);
      setLoginFieldErrors({});
    }

    try {
      const result = await loginWithGoogle({ credential });
      if (!result.token) {
        throw new Error("Token de connexion Google manquant.");
      }
      persistStoredAuthSession(result.user, result.token);
      navigate(getDashboardPathForUser(result.user), { replace: true });
    } catch (caughtError) {
      const parsedError = parseApiError(
        caughtError,
        isRegisterMode ? "Inscription Google impossible pour le moment." : "Connexion Google impossible pour le moment."
      );
      if (isRegisterMode) {
        setRegisterError(parsedError.message);
        setRegisterFieldErrors(parsedError.fieldErrors);
      } else {
        setLoginError(parsedError.message);
        setLoginFieldErrors(parsedError.fieldErrors);
      }
    } finally {
      if (isRegisterMode) {
        setRegisterBusy(false);
      } else {
        setLoginBusy(false);
      }
    }
  }

  async function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegisterBusy(true);
    setRegisterError(null);
    setRegisterFieldErrors({});

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
          setRegisterError(emailValidationError ?? "Veuillez remplir correctement les champs obligatoires.");
          setRegisterFieldErrors({
            ...(username ? {} : { username: "Le nom d'utilisateur est obligatoire." }),
            ...(phoneNumber ? {} : { phone_number: "Le numero de telephone est obligatoire." }),
            ...(emailValidationError ? { email: emailValidationError } : {}),
            ...(password ? {} : { password: "Le mot de passe est obligatoire." }),
          });
          return;
        }

        if (password.length < 6) {
          setRegisterError("Le mot de passe doit contenir au moins 6 caracteres.");
          setRegisterFieldErrors({ password: "Le mot de passe doit contenir au moins 6 caracteres." });
          return;
        }

        const fullPhoneNumber = buildPhoneNumber(patientCountryCode, phoneNumber);
        const phoneValidationError = validateInternationalPhoneNumber(fullPhoneNumber);
        if (phoneValidationError) {
          setRegisterError(phoneValidationError);
          setRegisterFieldErrors({ phone_number: phoneValidationError });
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
          latitude: registrationLocation?.latitude,
          longitude: registrationLocation?.longitude,
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
      const referralCode = pharmacyForm.referral_code.trim().toUpperCase();
      const emailValidationError = validateEmailValue(email);
      const hasSelectedSalesMode = pharmacyForm.wholesale_supported || pharmacyForm.retail_supported;

      if (!pharmacyName || !phoneNumber || !email || !address || !password || emailValidationError || !hasSelectedSalesMode) {
        setRegisterError(emailValidationError ?? "Veuillez remplir correctement les champs obligatoires.");
        setRegisterFieldErrors({
          ...(pharmacyName ? {} : { pharmacy_name: "Le nom de la pharmacie est obligatoire." }),
          ...(phoneNumber ? {} : { phone_number: "Le numero de telephone est obligatoire." }),
          ...(emailValidationError ? { email: emailValidationError } : {}),
          ...(address ? {} : { address: "L'adresse exacte est obligatoire." }),
          ...(password ? {} : { password: "Le mot de passe est obligatoire." }),
          ...(hasSelectedSalesMode ? {} : { retail_supported: "Choisissez le mode de vente de cette pharmacie." }),
        });
        return;
      }

      if (password.length < 6) {
        setRegisterError("Le mot de passe doit contenir au moins 6 caracteres.");
        setRegisterFieldErrors({ password: "Le mot de passe doit contenir au moins 6 caracteres." });
        return;
      }

      const fullPhoneNumber = buildPhoneNumber(pharmacyCountryCode, phoneNumber);
      const phoneValidationError = validateInternationalPhoneNumber(fullPhoneNumber);
      if (phoneValidationError) {
        setRegisterError(phoneValidationError);
        setRegisterFieldErrors({ phone_number: phoneValidationError });
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
        wholesale_supported: pharmacyForm.wholesale_supported,
        retail_supported: pharmacyForm.retail_supported,
        referral_code: referralCode || undefined,
        latitude: registrationLocation?.latitude,
        longitude: registrationLocation?.longitude,
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
    } catch (caughtError) {
      const parsedError = parseApiError(caughtError, "Inscription impossible pour le moment. Verifiez les informations saisies.");
      setRegisterError(parsedError.message);
      setRegisterFieldErrors(parsedError.fieldErrors);
    } finally {
      setRegisterBusy(false);
    }
  }

  if (location.pathname === "/register") {
    const redirectSearch = new URLSearchParams();
    redirectSearch.set("mode", "register");
    if (referralCodeFromUrl) {
      redirectSearch.set("ref", referralCodeFromUrl);
    }
    return <Navigate to={`/login?${redirectSearch.toString()}`} replace />;
  }

  return (
    <section className="auth-shell login-shell auth-experience-shell">
      <div className="auth-panel login-form-panel auth-book-panel">
        <div className={mode === "register" ? `auth-book is-register ${accountType === "pharmacy" ? "is-pharmacy" : "is-patient"}` : "auth-book"}>
          <div className="auth-book-pages">
            <form className="auth-form login-form auth-page-face auth-page-face-login" onSubmit={handleLoginSubmit} autoComplete="off">
              <Link to="/" className="auth-back-link" aria-label="Retour a l'accueil">
                <BackHomeIcon />
                <span>Retour a l'accueil</span>
              </Link>
              <Link to="/" className="login-brand-row login-brand-link">
                <img src="/pharmigo-logo.png" alt="PharmiGo" className="login-brand-logo" />
                <div className="login-brand-copy">
                  <strong>PharmiGo</strong>
                  <span>Sante connectee, rapide et humaine.</span>
                </div>
              </Link>

              <div className="login-copy-block">
                <h1>Bienvenue sur PharmiGo</h1>
                <p>Connectez-vous avec votre email verifie et votre mot de passe pour retrouver votre espace en toute simplicite.</p>
              </div>

              <div className="auth-surface-toolbar auth-inline-mode-switch">
                <div className="auth-mode-switch" aria-label="Basculer entre connexion et inscription">
                  <button
                    type="button"
                    className={mode === "login" ? "auth-mode-chip active" : "auth-mode-chip"}
                    onClick={() => switchMode("login")}
                  >
                    Connexion
                  </button>
                  <button
                    type="button"
                    className={mode === "register" ? "auth-mode-chip active" : "auth-mode-chip"}
                    onClick={() => switchMode("register")}
                  >
                    Inscription
                  </button>
                </div>
              </div>

              <label className="login-field">
                <span>Adresse email</span>
                <input
                  type="email"
                  autoComplete="email"
                  className={loginFieldErrors.email ? "field-input-error" : ""}
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  placeholder="vous@exemple.com"
                />
                {loginFieldErrors.email ? <small className="field-error">{loginFieldErrors.email}</small> : null}
              </label>

              <label className="login-field">
                <span>Mot de passe</span>
                <div className={loginFieldErrors.password ? "password-field password-field-error" : "password-field"}>
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder="Votre mot de passe"
                  />
                  <button type="button" className="password-toggle-button" onClick={() => setShowLoginPassword((current) => !current)}>
                    <EyeIcon open={showLoginPassword} />
                  </button>
                </div>
                {loginFieldErrors.password ? <small className="field-error">{loginFieldErrors.password}</small> : null}
              </label>

              {loginError ? <p className="form-feedback error">{loginError}</p> : null}

              <button type="submit" className="pharmigo-primary-btn auth-submit login-submit" disabled={loginBusy}>
                {loginBusy ? "Connexion..." : "Continuer"}
              </button>

              <div className="login-google-wrap login-google-wrap-prominent">
                <GoogleSignInButton onCredential={handleGoogleAuth} onError={setLoginError} disabled={loginBusy} />
              </div>

              <div className="login-links-grid">
                <p className="auth-switch">
                  <Link to="/forgot-password">Mot de passe oublie ?</Link>
                </p>
              </div>

            </form>

            <form className="auth-form login-form auth-page-face auth-page-face-register" onSubmit={handleRegisterSubmit}>
              <Link to="/" className="auth-back-link" aria-label="Retour a l'accueil">
                <BackHomeIcon />
                <span>Retour a l'accueil</span>
              </Link>
              <Link to="/" className="login-brand-row login-brand-link">
                <img src="/pharmigo-logo.png" alt="PharmiGo" className="login-brand-logo" />
                <div className="login-brand-copy">
                  <strong>PharmiGo</strong>
                  <span>Inscription rapide et verification securisee.</span>
                </div>
              </Link>

              <div className="login-copy-block">
                <h1>Creer votre compte</h1>
                <p>Choisissez votre profil et activez votre compte via la verification email.</p>
              </div>

              <div className="auth-surface-toolbar auth-inline-mode-switch">
                <div className="auth-mode-switch" aria-label="Basculer entre connexion et inscription">
                  <button
                    type="button"
                    className={mode === "login" ? "auth-mode-chip active" : "auth-mode-chip"}
                    onClick={() => switchMode("login")}
                  >
                    Connexion
                  </button>
                  <button
                    type="button"
                    className={mode === "register" ? "auth-mode-chip active" : "auth-mode-chip"}
                    onClick={() => switchMode("register")}
                  >
                    Inscription
                  </button>
                </div>
              </div>

              <div className="login-google-wrap">
                <GoogleSignInButton onCredential={handleGoogleAuth} onError={setRegisterError} disabled={registerBusy} text="signup_with" />
              </div>

              <div className="auth-mode-switch auth-account-switch" aria-label="Type de compte">
                <button
                  type="button"
                  className={accountType === "patient" ? "auth-mode-chip auth-account-chip active" : "auth-mode-chip auth-account-chip"}
                  onClick={() => setAccountType("patient")}
                >
                  Patient
                </button>
                  <button
                    type="button"
                    className={accountType === "pharmacy" ? "auth-mode-chip auth-account-chip active" : "auth-mode-chip auth-account-chip"}
                    onClick={() => setAccountType("pharmacy")}
                  >
                  Pharmacie
                </button>
              </div>

              <div className={accountType === "pharmacy" ? "auth-account-book is-pharmacy" : "auth-account-book"}>
                <div className="auth-account-pages">
                  <div className="auth-account-face auth-account-face-patient auth-account-grid auth-account-grid-patient">
                    <label className="login-field">
                      <span>Nom d'utilisateur</span>
                      <input
                        className={registerFieldErrors.username ? "field-input-error" : ""}
                        value={patientForm.username}
                        onChange={(event) => setPatientForm((current) => ({ ...current, username: event.target.value }))}
                      />
                      {registerFieldErrors.username ? <small className="field-error">{registerFieldErrors.username}</small> : null}
                    </label>
                    <PhoneNumberField
                      label="Numero de telephone"
                      countryCode={patientCountryCode}
                      localNumber={patientForm.phone_number}
                      onCountryChange={setPatientCountryCode}
                      onLocalNumberChange={(value) => setPatientForm((current) => ({ ...current, phone_number: value }))}
                      error={registerFieldErrors.phone_number}
                    />
                    <label className="login-field">
                      <span>Date de naissance</span>
                      <input
                        type="date"
                        value={patientForm.birth_date}
                        onChange={(event) => setPatientForm((current) => ({ ...current, birth_date: event.target.value }))}
                      />
                    </label>
                    <label className="login-field">
                      <span>Genre</span>
                      <select
                        value={patientForm.gender}
                        onChange={(event) => setPatientForm((current) => ({ ...current, gender: event.target.value as PatientGender }))}
                      >
                        <option value="">Selectionner</option>
                        <option value="male">Homme</option>
                        <option value="female">Femme</option>
                        <option value="other">Autre</option>
                      </select>
                    </label>
                    <label className="login-field">
                      <span>Email obligatoire</span>
                      <input
                        type="email"
                        className={registerFieldErrors.email ? "field-input-error" : ""}
                        value={patientForm.email}
                        onChange={(event) => setPatientForm((current) => ({ ...current, email: event.target.value }))}
                        placeholder="vous@exemple.com"
                      />
                      {registerFieldErrors.email ? <small className="field-error">{registerFieldErrors.email}</small> : null}
                    </label>
                    <label className="login-field">
                      <span>Mot de passe</span>
                      <div className={registerFieldErrors.password ? "password-field password-field-error" : "password-field"}>
                        <input
                          type={showPatientPassword ? "text" : "password"}
                          value={patientForm.password}
                          onChange={(event) => setPatientForm((current) => ({ ...current, password: event.target.value }))}
                        />
                        <button type="button" className="password-toggle-button" onClick={() => setShowPatientPassword((current) => !current)}>
                          <EyeIcon open={showPatientPassword} />
                        </button>
                      </div>
                      {registerFieldErrors.password ? <small className="field-error">{registerFieldErrors.password}</small> : null}
                    </label>
                  </div>

                  <div className="auth-account-face auth-account-face-pharmacy auth-account-grid auth-account-grid-pharmacy">
                    <label className="login-field auth-upload-field">
                      <span>Nom de la pharmacie</span>
                      <input
                        className={registerFieldErrors.pharmacy_name ? "field-input-error" : ""}
                        value={pharmacyForm.pharmacy_name}
                        onChange={(event) => setPharmacyForm((current) => ({ ...current, pharmacy_name: event.target.value }))}
                      />
                      {registerFieldErrors.pharmacy_name ? <small className="field-error">{registerFieldErrors.pharmacy_name}</small> : null}
                    </label>
                    <label className="login-field">
                      <span>Lien / code de parrainage</span>
                      <input
                        value={pharmacyForm.referral_code}
                        onChange={(event) => setPharmacyForm((current) => ({ ...current, referral_code: event.target.value.toUpperCase() }))}
                        placeholder="Ex: 5CZSYK"
                      />
                      <small className="auth-location-note">
                        Si vous arrivez via un lien ambassadeur, ce code est applique automatiquement a votre inscription pharmacie.
                      </small>
                    </label>
                    <PhoneNumberField
                      label="Numero de telephone"
                      countryCode={pharmacyCountryCode}
                      localNumber={pharmacyForm.phone_number}
                      onCountryChange={setPharmacyCountryCode}
                      onLocalNumberChange={(value) => setPharmacyForm((current) => ({ ...current, phone_number: value }))}
                      error={registerFieldErrors.phone_number}
                    />
                    <label className="login-field">
                      <span>Email obligatoire</span>
                      <input
                        type="email"
                        className={registerFieldErrors.email ? "field-input-error" : ""}
                        value={pharmacyForm.email}
                        onChange={(event) => setPharmacyForm((current) => ({ ...current, email: event.target.value }))}
                        placeholder="contact@pharmacie.com"
                      />
                      {registerFieldErrors.email ? <small className="field-error">{registerFieldErrors.email}</small> : null}
                    </label>
                    <label className="login-field">
                      <span>Adresse exacte</span>
                      <input
                        className={registerFieldErrors.address ? "field-input-error" : ""}
                        value={pharmacyForm.address}
                        onChange={(event) => setPharmacyForm((current) => ({ ...current, address: event.target.value }))}
                      />
                      {registerFieldErrors.address ? <small className="field-error">{registerFieldErrors.address}</small> : null}
                    </label>
                    <label className="login-field">
                      <span>Image de la pharmacie</span>
                      <input type="file" accept="image/*" onChange={(event) => setPharmacyForm((current) => ({ ...current, pharmacy_image: event.target.files?.[0] ?? null }))} />
                    </label>
                    <div className="sales-mode-selector compact" role="radiogroup" aria-label="Mode de vente pharmacie">
                      <button
                        type="button"
                        className={`sales-mode-option${getSalesModeChoiceFromFlags(pharmacyForm) === "retail" ? " is-active retail" : ""}`}
                        onClick={() => {
                          setRegisterError(null);
                          setRegisterFieldErrors((current) => {
                            const next = { ...current };
                            delete next.retail_supported;
                            return next;
                          });
                          setPharmacyForm((current) => ({ ...current, ...applySalesModeChoice("retail") }));
                        }}
                      >
                        <strong>Vente au detail</strong>
                        <span>Comprime, flacon, unite patient</span>
                      </button>
                      <button
                        type="button"
                        className={`sales-mode-option${getSalesModeChoiceFromFlags(pharmacyForm) === "wholesale" ? " is-active wholesale" : ""}`}
                        onClick={() => {
                          setRegisterError(null);
                          setRegisterFieldErrors((current) => {
                            const next = { ...current };
                            delete next.retail_supported;
                            return next;
                          });
                          setPharmacyForm((current) => ({ ...current, ...applySalesModeChoice("wholesale") }));
                        }}
                      >
                        <strong>Vente en gros</strong>
                        <span>Carton, caisse, lot, palette</span>
                      </button>
                      <button
                        type="button"
                        className={`sales-mode-option${getSalesModeChoiceFromFlags(pharmacyForm) === "both" ? " is-active both" : ""}`}
                        onClick={() => {
                          setRegisterError(null);
                          setRegisterFieldErrors((current) => {
                            const next = { ...current };
                            delete next.retail_supported;
                            return next;
                          });
                          setPharmacyForm((current) => ({ ...current, ...applySalesModeChoice("both") }));
                        }}
                      >
                        <strong>Gros et detail</strong>
                        <span>La pharmacie sert les deux formats</span>
                      </button>
                    </div>
                    <small className="field-help">Choix obligatoire. Aucun mode n'est preselectionne par defaut.</small>
                    {registerFieldErrors.retail_supported ? <small className="field-error">{registerFieldErrors.retail_supported}</small> : null}
                    <label className="login-field">
                      <span>Mot de passe</span>
                      <div className={registerFieldErrors.password ? "password-field password-field-error" : "password-field"}>
                        <input
                          type={showPharmacyPassword ? "text" : "password"}
                          value={pharmacyForm.password}
                          onChange={(event) => setPharmacyForm((current) => ({ ...current, password: event.target.value }))}
                        />
                        <button type="button" className="password-toggle-button" onClick={() => setShowPharmacyPassword((current) => !current)}>
                          <EyeIcon open={showPharmacyPassword} />
                        </button>
                      </div>
                      {registerFieldErrors.password ? <small className="field-error">{registerFieldErrors.password}</small> : null}
                    </label>
                  </div>
                </div>
              </div>

              <div className="auth-location-card">
                <div className="auth-location-copy">
                  <strong>Activez votre localisation</strong>
                  <p>
                    PharmiGo vous la demande des l'inscription pour retrouver les pharmacies proches de vous et calculer les
                    distances plus justement.
                  </p>
                  {registrationLocation ? (
                    <p className="auth-location-success">
                      Position recuperee. Vos coordonnees seront associees a votre compte apres l'inscription.
                    </p>
                  ) : null}
                  {locationError ? <p className="field-error auth-location-error">{locationError}</p> : null}
                  {!supportsGeolocation() ? (
                    <p className="auth-location-note">
                      Ce navigateur ne permet pas la geolocalisation ici. Vous pourrez la partager plus tard depuis votre compte.
                    </p>
                  ) : (
                    <p className="auth-location-note">
                      Si vous refusez maintenant, PharmiGo vous la redemandera plus tard pour ameliorer la recherche locale.
                    </p>
                  )}
                </div>
                <div className="auth-location-actions">
                  <button
                    type="button"
                    className="pharmigo-secondary-btn"
                    onClick={() => void handleCaptureLocation()}
                    disabled={locationBusy || !supportsGeolocation()}
                  >
                    {locationBusy ? "Localisation..." : registrationLocation ? "Actualiser ma position" : "Activer ma localisation"}
                  </button>
                </div>
              </div>

              {registerError ? <p className="form-feedback error">{registerError}</p> : null}

              <button type="submit" className="pharmigo-primary-btn auth-submit login-submit" disabled={registerBusy}>
                {registerBusy ? "Enregistrement..." : accountType === "patient" ? "Creer mon compte patient" : "Enregistrer ma pharmacie"}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="auth-panel login-visual-panel">
        <div className={mode === "register" ? "login-visual-backdrop auth-visual-backdrop is-register" : "login-visual-backdrop auth-visual-backdrop"}>
          <div className="login-visual-copy">
            <span className="login-visual-badge">{mode === "register" ? "PharmiGo bot" : "PharmiGo bot"}</span>
            <h2>
              {mode === "register"
                ? "PharmiGo bot accompagne chaque inscription."
                : "PharmiGo bot vous accompagne."}
            </h2>
            <p>
              {mode === "register"
                ? "Inscription, verification email et acces Google dans une seule experience claire et conforme a la plateforme."
                : "Retrouvez vos ordonnances, vos echanges et vos recommandations avec un assistant visuel aligne sur l'identite PharmiGo."}
            </p>
          </div>

          <div className={mode === "register" ? "login-visual-stage is-register" : "login-visual-stage"}>
            <img src="/chatbot-guardian.png" alt="Chatbot PharmiGo" className="login-chatbot-image" />
          </div>
        </div>
      </div>
    </section>
  );
}
