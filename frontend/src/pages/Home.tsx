import axios from "axios";
import { startTransition, type FormEvent, type ReactNode, useDeferredValue, useMemo, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import ChatBotButton from "../components/ChatBotButton";
import PhoneNumberField from "../components/PhoneNumberField";
import NotificationToast from "../components/NotificationToast";
import PrescriptionAnalysisPopup from "../components/PrescriptionAnalysisPopup";
import PrescriptionUploader from "../components/PrescriptionUploader";
import PharmacyStockManager from "../components/PharmacyStockManager";
import PatientDashboard from "../components/PatientDashboard";
import PharmacyDashboard from "../components/PharmacyDashboard";
import AdminDashboard from "../components/AdminDashboard";
import PublicPrescriptionSheet from "../components/PublicPrescriptionSheet";
import { getApiOrigin, getChatWebSocketUrl } from "../config/endpoints";
import { usePreferences } from "../context/PreferencesContext";
import { downloadPharmiGoPDF } from "../utils/pharmigoPDF";
import { clearStoredAuthSession, getDashboardPathForUser, getStoredCurrentUser, persistStoredAuthSession, persistStoredCurrentUser } from "../lib/auth";
import { parseApiError, type FormFieldErrors } from "../lib/apiErrors";
import { formatExactDateTime } from "../lib/datetime";
import { homeUiText, landingCopy } from "../lib/homeTranslations";
import { type Language } from "../lib/i18n";
import { logClientError } from "../lib/logger";
import { buildPhoneNumber, splitPhoneNumber, type PhoneCountryCode, validateInternationalPhoneNumber } from "../lib/phoneCountries";
import {
  deleteAllNotifications,
  deleteNotification,
  fetchAppConfig,
  fetchDashboard,
  fetchMessages,
  fetchPrescriptionAnalysisTask,
  fetchProfile,
  login,
  logout,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  postMessage,
  postPharmacyComment,
  postPrescriptionComment,
  register,
  sendPresenceHeartbeat,
  sendPresenceOffline,
  updatePharmacyEngagement,
  updatePrescriptionEngagement,
  updateAdminProfile,
  updatePatientProfile,
  updatePharmacyProfile,
} from "../services/api";
import type {
  AppConfig,
  AuthUser,
  ChatMessage,
  DashboardData,
  Pharmacy,
  PrescriptionAnalysisTaskResult,
  PrescriptionComment,
  PrescriptionRecord,
  PrescriptionResponse,
  PrescriptionUploadReceipt,
} from "../types";

type KPIShape = {
  response_time_minutes: number;
  resolution_rate: number;
  satisfaction_score: number;
  active_pharmacies: number;
  live_prescriptions: number;
  confirmed_quotes: number;
};

type ModalType = "login" | "register" | "upload" | "profile" | "messages" | "pharmacy-stock" | "dashboard" | null;
type AccountType = "patient" | "pharmacy";

type LoginFormState = {
  phone_number: string;
  password: string;
  country_code: PhoneCountryCode;
};

type PatientRegisterFormState = {
  username: string;
  phone_number: string;
  email: string;
  password: string;
  country_code: PhoneCountryCode;
};

type PharmacyRegisterFormState = {
  pharmacy_name: string;
  phone_number: string;
  email: string;
  address: string;
  password: string;
  pharmacy_image: File | null;
  country_code: PhoneCountryCode;
};

type ProfileFormState = {
  username: string;
  phone_number: string;
  email: string;
  country_code: PhoneCountryCode;
};

type PharmacyProfileFormState = {
  pharmacy_name: string;
  address: string;
  city: string;
  phone_number: string;
  email: string;
  opening_hours: string;
  delivery_supported: boolean;
  pharmacy_image: File | null;
  country_code: PhoneCountryCode;
};

type AdminProfileFormState = {
  username: string;
  email: string;
  profile_image: File | null;
};

type PrescriptionCommentDraftState = {
  body: string;
};

type PharmacyCommentDraftState = {
  body: string;
};

type LanguageMeta = {
  flag: string;
  label: string;
};

type PharmacyConversationItem = {
  pharmacy: Pharmacy;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  isSaved: boolean;
};

type ShareMenuState = {
  kind: "pharmacy" | "prescription";
  id: number;
  title: string;
  text: string;
  url: string;
};

type ShareChannel = "whatsapp" | "facebook" | "instagram" | "telegram" | "tiktok" | "copy" | "platform";

const defaultKpis: KPIShape = {
  response_time_minutes: 0,
  resolution_rate: 0,
  satisfaction_score: 0,
  active_pharmacies: 0,
  live_prescriptions: 0,
  confirmed_quotes: 0,
};

function ModalShell({
  title,
  body,
  closeLabel,
  onClose,
  className,
  children,
}: {
  title: string;
  body: string;
  closeLabel: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="landing-modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={className ? `landing-modal-card ${className}` : "landing-modal-card"} onClick={(event) => event.stopPropagation()}>
        <div className="landing-modal-head">
          <div>
            <h2>{title}</h2>
            <p>{body}</p>
          </div>
          <button type="button" className="landing-modal-close" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ProfileReadItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-read-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function resolveMediaUrl(path?: string | null) {
  if (!path) {
    return null;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const explicitOrigin = import.meta.env.VITE_API_ORIGIN || getApiOrigin();
  if (explicitOrigin) {
    return `${explicitOrigin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:8000${path.startsWith("/") ? path : `/${path}`}`;
}

function getPharmacyOperationalStatus(pharmacy: Pharmacy, language: Language) {
  if (pharmacy.is_active === false) {
    return {
      className: "inactive",
      label:
        language === "en"
          ? "Inactive"
          : language === "sw"
            ? "Haifanyi kazi"
            : language === "ln"
              ? "Inactive"
              : "Inactive",
    };
  }

  return {
    className: pharmacy.is_online ? "open" : "neutral",
    label: formatPresenceLabel(pharmacy.is_online, pharmacy.last_seen, language),
  };
}

function getPharmacySubscriptionStatus(pharmacy: Pharmacy, language: Language) {
  const status = String(pharmacy.subscription_status || "").toLowerCase();
  if (status === "active") {
    return {
      className: "official",
      label:
        language === "en"
          ? "Paid status"
          : language === "sw"
            ? "Imelipiwa"
            : language === "ln"
              ? "Statut efutami"
              : "Statut paye",
    };
  }

  if (status === "trial") {
    const daysLabel =
      typeof pharmacy.trial_days_remaining === "number"
        ? language === "en"
          ? `${pharmacy.trial_days_remaining} day(s) left`
          : language === "sw"
            ? `Siku ${pharmacy.trial_days_remaining} zimebaki`
            : language === "ln"
              ? `Mikolo ${pharmacy.trial_days_remaining} etikali`
              : `${pharmacy.trial_days_remaining} jour(s) restants`
        : null;

    return {
      className: "trial",
      label:
        language === "en"
          ? "Trial period"
          : language === "sw"
            ? "Trial period"
            : language === "ln"
              ? "Trial period"
              : "Trial period",
      detail: daysLabel,
    };
  }

  if (status === "suspended" || status === "expired" || status === "cancelled") {
    return {
      className: "inactive",
      label:
        language === "en"
          ? "Unavailable"
          : language === "sw"
            ? "Haipatikani"
            : language === "ln"
              ? "Ezangi"
              : "Indisponible",
    };
  }

  return {
    className: "neutral",
    label:
      language === "en"
        ? "Status pending"
        : language === "sw"
          ? "Hali inasubiri"
          : language === "ln"
            ? "Statut ezali kozela"
            : "Statut en attente",
  };
}

function formatPresenceLabel(isOnline?: boolean, lastSeen?: string | null, language = "fr") {
  const locale =
    language === "en" ? "en-US" : language === "sw" ? "sw-TZ" : language === "ln" ? "fr-CD" : "fr-BI";

  if (isOnline) {
    if (language === "en") return "Online";
    if (language === "rn") return "Kuri internet";
    if (language === "sw") return "Mtandaoni";
    if (language === "ln") return "Na internet";
    return "En ligne";
  }

  if (!lastSeen) {
    if (language === "en") return "Offline";
    if (language === "rn") return "Ntari kuri internet";
    if (language === "sw") return "Nje ya mtandao";
    if (language === "ln") return "Offline";
    return "Hors ligne";
  }

  const date = new Date(lastSeen);
  const label = Number.isNaN(date.getTime()) ? lastSeen : date.toLocaleString(locale);
  if (language === "en") return `Seen on ${label}`;
  if (language === "rn") return `Aheruka kuboneka kw'igenekerezo rya ${label}`;
  if (language === "sw") return `Ameonekana tarehe ${label}`;
  if (language === "ln") return `Amonanaki na mokolo ya ${label}`;
  return `Vu le ${label}`;
}

function formatPharmacyLocation(pharmacy: Pharmacy) {
  const values = [pharmacy.city, pharmacy.address].filter(Boolean);
  return values.length ? values.join(" • ") : "Adresse non renseignee";
}

function mergePrescriptionRecords(current: DashboardData | null, nextPrescription: PrescriptionRecord): DashboardData | null {
  if (!current) {
    return current;
  }

  const currentPrescriptions = Array.isArray(current.prescriptions) ? current.prescriptions : [];
  const existingIndex = currentPrescriptions.findIndex((item) => item.id === nextPrescription.id);

  if (existingIndex === -1) {
    return {
      ...current,
      prescriptions: [nextPrescription, ...currentPrescriptions],
    };
  }

  return {
    ...current,
    prescriptions: currentPrescriptions.map((item) =>
      item.id === nextPrescription.id ? { ...item, ...nextPrescription } : item
    ),
  };
}

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

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <defs>
        <linearGradient id="globeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9" fill="none" stroke="url(#globeGradient)" strokeWidth="1.8" />
      <path d="M3 12h18M12 3c3 3 4.5 6 4.5 9S15 18 12 21M12 3c-3 3-4.5 6-4.5 9S9 18 12 21" fill="none" stroke="url(#globeGradient)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <defs>
        <linearGradient id="messageGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <path d="M6 5h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-4.5L9 20v-3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" fill="none" stroke="url(#messageGradient)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="11" r="1" fill="#38bdf8" />
      <circle cx="12" cy="11" r="1" fill="#2563eb" />
      <circle cx="15" cy="11" r="1" fill="#38bdf8" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="M12 4a4 4 0 0 0-4 4v2.3c0 .7-.2 1.4-.6 2l-1.3 2A1.5 1.5 0 0 0 7.4 17h9.2a1.5 1.5 0 0 0 1.3-2.3l-1.3-2a3.8 3.8 0 0 1-.6-2V8a4 4 0 0 0-4-4Z" fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      {theme === "dark" ? (
        <path d="M14.5 3.5a7.5 7.5 0 1 0 6 12.1A8.5 8.5 0 1 1 14.5 3.5Z" fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <circle cx="12" cy="12" r="4" fill="none" stroke="#f59e0b" strokeWidth="1.8" />
          <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path
        d="M21 3 10 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 3 14 21l-4-7-7-4 18-7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LikeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="M7 10v10H4V10h3Zm4.5 10H19a2 2 0 0 0 2-1.6l1-5.5A2 2 0 0 0 20 10h-5l.6-3.3A2.5 2.5 0 0 0 13.1 4L8 10.2V20h3.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="M14 5h5v5M10 14 19 5M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="M12 3.5a8.5 8.5 0 0 1 7.3 12.8L20.5 21l-4.9-1.3A8.5 8.5 0 1 1 12 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.4 8.9c.2-.4.4-.4.7-.4h.6c.2 0 .4 0 .6.4.2.4.7 1.7.8 1.8.1.2.1.4 0 .6l-.4.5c-.1.1-.2.3 0 .6.3.5.8 1.1 1.4 1.6.7.6 1.4.9 1.9 1.1.3.1.5 0 .6-.1l.6-.7c.2-.2.4-.2.6-.1l1.7.8c.2.1.4.2.4.4 0 .2 0 1.1-.7 1.6-.7.5-1.5.5-2 .4-.5-.1-1.3-.4-2.6-1.1-1.7-.9-2.8-2.5-3.2-3.2-.4-.6-.9-1.7-.9-2.6 0-.9.5-1.3.7-1.6Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="M14 8h2.5V4.8c-.4-.1-1.3-.3-2.5-.3-2.5 0-4.2 1.5-4.2 4.4V11H7v3.6h2.8V20h3.4v-5.4h2.8l.4-3.6h-3.2V9.3c0-.8.2-1.3.8-1.3Z" fill="currentColor" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <rect x="4" y="4" width="16" height="16" rx="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="m20.5 4.5-3 15.1c-.2 1-.8 1.3-1.7.8l-4.2-3.1-2 1.9c-.2.2-.4.4-.8.4l.3-4.4 8-7.2c.4-.3-.1-.5-.6-.2l-9.8 6.2-4.2-1.3c-.9-.3-1-.9.2-1.3l16.4-6.3c.8-.3 1.4.2 1.2 1.4Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="M14.5 4c.5 1.4 1.6 2.7 3.1 3.4.8.4 1.6.6 2.4.6v3.2c-1 0-2-.2-2.9-.6l-.1 4.7c0 3.1-2.5 5.7-5.6 5.7s-5.7-2.5-5.7-5.7 2.5-5.6 5.7-5.6c.4 0 .8 0 1.2.1V13a2.7 2.7 0 0 0-1.2-.3 2.6 2.6 0 1 0 2.6 2.6V4h3.5Z" fill="currentColor" />
    </svg>
  );
}

function CopyLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InternalShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="M8 7h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m11 16-5-4 5-4M6 12h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function isImageDocument(url: string | null) {
  if (!url) {
    return false;
  }

  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
}

function prescriptionHasConfirmedMedications(prescription: PrescriptionRecord) {
  return Array.isArray(prescription.extracted_medications)
    ? prescription.extracted_medications.some((item) => item.confirmed)
    : false;
}

export default function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, language, setLanguage, languageOptions, theme, setTheme, themeOptions } = usePreferences();

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showPharmiGoModal, setShowPharmiGoModal] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>("patient");
  const [uploadSuccess, setUploadSuccess] = useState<PrescriptionUploadReceipt | null>(null);
  const [pendingAnalysisRecord, setPendingAnalysisRecord] = useState<PrescriptionRecord | null>(null);
  const [analysisPopupRecord, setAnalysisPopupRecord] = useState<PrescriptionRecord | null>(null);
  const [activeAnalysisTaskId, setActiveAnalysisTaskId] = useState<string | null>(null);
  const [completedTaskResult, setCompletedTaskResult] = useState<PrescriptionAnalysisTaskResult | null>(null);
  const [analysisRevealAt, setAnalysisRevealAt] = useState<number | null>(null);
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
  const [, setAnalysisTick] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [authFieldErrors, setAuthFieldErrors] = useState<FormFieldErrors>({});
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authBootstrapped, setAuthBootstrapped] = useState(false);
  const dashboardRefreshInFlightRef = useRef(false);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isNotificationMenuOpen, setIsNotificationMenuOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileFieldErrors, setProfileFieldErrors] = useState<FormFieldErrors>({});
  const [profileForm, setProfileForm] = useState<ProfileFormState>({ username: "", phone_number: "", email: "", country_code: "bi" });
  const [adminProfileForm, setAdminProfileForm] = useState<AdminProfileFormState>({
    username: "",
    email: "",
    profile_image: null,
  });
  const [pharmacyProfileForm, setPharmacyProfileForm] = useState<PharmacyProfileFormState>({
    pharmacy_name: "",
    address: "",
    city: "",
    phone_number: "",
    email: "",
    opening_hours: "",
    delivery_supported: false,
    pharmacy_image: null,
    country_code: "bi",
  });
  const [pharmacyMessages, setPharmacyMessages] = useState<ChatMessage[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [recipientPharmacyId, setRecipientPharmacyId] = useState("");
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [responseSuccess, setResponseSuccess] = useState<string | null>(null);
  const [messageFieldErrors, setMessageFieldErrors] = useState<FormFieldErrors>({});
  const [liveFeedConnected, setLiveFeedConnected] = useState(false);
  const [expandedCommentThreads, setExpandedCommentThreads] = useState<Record<number, boolean>>({});
  const [openCommentPanels, setOpenCommentPanels] = useState<Record<number, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<number, PrescriptionCommentDraftState>>({});
  const [commentBusyId, setCommentBusyId] = useState<number | null>(null);
  const [expandedPharmacyComments, setExpandedPharmacyComments] = useState<Record<number, boolean>>({});
  const [pharmacyCommentDrafts, setPharmacyCommentDrafts] = useState<Record<number, PharmacyCommentDraftState>>({});
  const [pharmacyCommentBusyId, setPharmacyCommentBusyId] = useState<number | null>(null);
  const [pharmacyInteractionError, setPharmacyInteractionError] = useState<string | null>(null);
  const [pharmacyInteractionSuccess, setPharmacyInteractionSuccess] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState<LoginFormState>({ phone_number: "", password: "", country_code: "bi" });
  const [patientRegisterForm, setPatientRegisterForm] = useState<PatientRegisterFormState>({
    username: "",
    phone_number: "",
    email: "",
    password: "",
    country_code: "bi",
  });
  const [pharmacyRegisterForm, setPharmacyRegisterForm] = useState<PharmacyRegisterFormState>({
    pharmacy_name: "",
    phone_number: "",
    email: "",
    address: "",
    password: "",
    pharmacy_image: null,
    country_code: "bi",
  });
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showPatientRegisterPassword, setShowPatientRegisterPassword] = useState(false);
  const [showPharmacyRegisterPassword, setShowPharmacyRegisterPassword] = useState(false);

  useEffect(() => {
    const savedUser = getStoredCurrentUser();

    if (!savedUser) {
      setAuthBootstrapped(true);
      return;
    }

    void fetchProfile()
      .then((user) => {
        setCurrentUser(user);
      })
      .catch((error) => {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          persistCurrentUser(null);
        }
      })
      .finally(() => {
        setAuthBootstrapped(true);
      });
  }, []);
  const [brokenPharmacyImages, setBrokenPharmacyImages] = useState<Record<number, boolean>>({});
  const [lastReadMessageAt, setLastReadMessageAt] = useState<string>("");
  const [savedContactIds, setSavedContactIds] = useState<number[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>("");
  const [contactPickerId, setContactPickerId] = useState<string>("");
  const [activePrescriptionPreview, setActivePrescriptionPreview] = useState<{ src: string; alt: string } | null>(null);
  const [directorySearchTerm, setDirectorySearchTerm] = useState("");
  const [shareMenu, setShareMenu] = useState<ShareMenuState | null>(null);

  const copy = landingCopy[language] ?? landingCopy.fr;
  const languageMeta: Record<Language, LanguageMeta> = {
    fr: { flag: "🇫🇷", label: "Francais" },
    en: { flag: "🇬🇧", label: "English" },
    rn: { flag: "🇧🇮", label: "Kirundi" },
    sw: { flag: "🇹🇿", label: "Swahili" },
    ln: { flag: "🇨🇩", label: "Lingala" },
  };
  const uiText = homeUiText[language] ?? homeUiText.fr;
  const feedText = {
    fr: {
      liveKicker: "Temps reel",
      liveTitle: "Ordonnances publiees et interactions",
      liveBody: "Les visiteurs peuvent voir ici les pharmacies inscrites et les fiches publiques avec medicaments confirmes, reference publique et pseudonyme uniquement.",
      liveOnline: "Flux temps reel connecte",
      liveOffline: "Flux temps reel hors ligne",
      prescriptionKicker: "Ordonnance patient",
      patientLabel: "Patient",
      dosageLabel: "Dosage",
      instructionsLabel: "Instructions",
      documentLabel: "Document joint",
      documentBody: "Le fichier original de l'ordonnance reste disponible pour consultation et verification.",
      openDocument: "Ouvrir le fichier de l'ordonnance",
      unavailableDocument: "Fichier non disponible",
      commentsTitle: "Commentaires",
      noComments: "Aucun commentaire pour le moment.",
      addComment: "Ajouter un commentaire",
      commentPlaceholder: "Ecrivez votre commentaire ici...",
      submitComment: "Publier le commentaire",
      commentSending: "Envoi...",
      loginToInteract: "Connectez-vous pour commenter, liker ou partager cette ordonnance.",
      pharmacyComments: "Commentaires des pharmacies",
      pharmacyResponseNote: "Les pharmacies connectees peuvent aussi publier une reponse professionnelle a cette ordonnance.",
      pharmacyCommentLabel: "Commentaire de la pharmacie",
      etaLabel: "Delai estime (minutes)",
      interactPrescription: "Interagir avec cette ordonnance",
      saving: "Enregistrement...",
      like: "Like",
      comment: "Comment",
      share: "Share",
      readAll: "Lire tout",
      collapse: "Reduire",
      noPrescription: "Aucune ordonnance publiee pour le moment.",
      statusSubmitted: "soumise",
      statusReviewed: "revue",
      actionsCount: "action(s)",
      actionLoginRequired: "Connectez-vous pour interagir.",
      commentRequired: "Le commentaire est obligatoire.",
      commentAdded: "Commentaire ajoute avec succes.",
      commentAddFailed: "Impossible d'ajouter ce commentaire.",
      commentLoginRequired: "Connectez-vous pour commenter.",
      engagementFailed: "Impossible d'enregistrer cette action.",
      shared: "Ordonnance partagee avec succes.",
      liked: "Ordonnance aimee.",
      unliked: "Like retire.",
      pharmacySectionTitle: copy.networkTitle,
      pharmacySectionBody: copy.networkBody,
      pharmacyUnavailableLocation: "Informations de localisation en attente.",
      phoneMissing: "Numero non renseigne",
      openingMissing: "Horaires non renseignes",
      deliveryAvailable: "Livraison disponible",
      pickupOnsite: "Retrait sur place",
      servedCount: "ordonnance(s) servie(s)",
      responseAverage: "Reponse moyenne",
      registeredAt: "Inscrite le",
      pharmacyOffline: "Hors ligne",
      pharmacyOpen: "Ouverte",
      pharmacyCommentsTitle: "Commentaires sur la pharmacie",
      noPharmacyComments: "Aucun commentaire sur cette pharmacie pour le moment.",
      commentPharmacyPlaceholder: "Dites ce que vous pensez de cette pharmacie...",
      loginToInteractPharmacy: "Connectez-vous pour commenter, liker ou partager cette pharmacie.",
      pharmacyCommentAdded: "Commentaire ajoute sur la pharmacie.",
      pharmacyCommentFailed: "Impossible d'ajouter ce commentaire sur la pharmacie.",
      pharmacyShared: "Pharmacie partagee avec succes.",
      pharmacyLiked: "Pharmacie aimee.",
      pharmacyUnliked: "Like retire sur la pharmacie.",
      pharmacyActionFailed: "Impossible d'enregistrer cette action sur la pharmacie.",
      directorySearchPlaceholder: "Rechercher une pharmacie par nom ou une ordonnance par numero public...",
      directorySearchHint: "Recherche temps reel: nom de pharmacie ou numero public d'ordonnance.",
      noPharmacySearchResult: "Aucune pharmacie ne correspond a cette recherche.",
      noPrescriptionSearchResult: "Aucune ordonnance ne correspond a ce numero public.",
    },
    en: {
      liveKicker: "Real time",
      liveTitle: "Published prescriptions and interactions",
      liveBody: "Visitors can browse registered pharmacies and public prescription sheets with confirmed medicines, public reference, and pseudonym only.",
      liveOnline: "Real-time feed connected",
      liveOffline: "Real-time feed offline",
      prescriptionKicker: "Patient prescription",
      patientLabel: "Patient",
      dosageLabel: "Dosage",
      instructionsLabel: "Instructions",
      documentLabel: "Attached document",
      documentBody: "The original prescription file remains available for review and verification.",
      openDocument: "Open prescription file",
      unavailableDocument: "File unavailable",
      commentsTitle: "Comments",
      noComments: "No comments yet.",
      addComment: "Add a comment",
      commentPlaceholder: "Write your comment here...",
      submitComment: "Post comment",
      commentSending: "Sending...",
      loginToInteract: "Sign in to comment, like, or share this prescription.",
      pharmacyComments: "Pharmacy responses",
      pharmacyResponseNote: "Connected pharmacies can also publish a professional response to this prescription.",
      pharmacyCommentLabel: "Pharmacy comment",
      etaLabel: "Estimated delay (minutes)",
      interactPrescription: "Interact with this prescription",
      saving: "Saving...",
      like: "Like",
      comment: "Comment",
      share: "Share",
      readAll: "Read all",
      collapse: "Collapse",
      noPrescription: "No published prescriptions yet.",
      statusSubmitted: "submitted",
      statusReviewed: "reviewed",
      actionsCount: "action(s)",
      actionLoginRequired: "Sign in to interact.",
      commentRequired: "Comment is required.",
      commentAdded: "Comment added successfully.",
      commentAddFailed: "Unable to add this comment.",
      commentLoginRequired: "Sign in to comment.",
      engagementFailed: "Unable to save this action.",
      shared: "Prescription shared successfully.",
      liked: "Prescription liked.",
      unliked: "Like removed.",
      pharmacySectionTitle: copy.networkTitle,
      pharmacySectionBody: copy.networkBody,
      pharmacyUnavailableLocation: "Location details pending.",
      phoneMissing: "Phone not provided",
      openingMissing: "Opening hours not provided",
      deliveryAvailable: "Delivery available",
      pickupOnsite: "Pickup on site",
      servedCount: "prescription(s) served",
      responseAverage: "Average response",
      registeredAt: "Registered on",
      pharmacyOffline: "Offline",
      pharmacyOpen: "Open",
      pharmacyCommentsTitle: "Pharmacy comments",
      noPharmacyComments: "No comments on this pharmacy yet.",
      commentPharmacyPlaceholder: "Share your experience with this pharmacy...",
      loginToInteractPharmacy: "Sign in to comment, like, or share this pharmacy.",
      pharmacyCommentAdded: "Comment added to the pharmacy.",
      pharmacyCommentFailed: "Unable to add this pharmacy comment.",
      pharmacyShared: "Pharmacy shared successfully.",
      pharmacyLiked: "Pharmacy liked.",
      pharmacyUnliked: "Like removed from pharmacy.",
      pharmacyActionFailed: "Unable to save this pharmacy action.",
      directorySearchPlaceholder: "Search a pharmacy by name or a prescription by public number...",
      directorySearchHint: "Real-time search: pharmacy name or prescription public number.",
      noPharmacySearchResult: "No pharmacy matches this search.",
      noPrescriptionSearchResult: "No prescription matches this public number.",
    },
    rn: {
      liveKicker: "Mu kanya nyako",
      liveTitle: "Ordonnances zatanzwe n'ivyo vyakoreweko",
      liveBody: "Abashitse hano bashobora kubona amafarumasi yiyandikishije n'udupapuro tw'ordonance twa bose twerekana imiti yemejwe, numero ya bose n'izina ry'ukwihisha gusa.",
      liveOnline: "Flux yo mu kanya nyako irakora",
      liveOffline: "Flux yo mu kanya nyako ntikora",
      prescriptionKicker: "Ordonnance y'umurwayi",
      patientLabel: "Umurwayi",
      dosageLabel: "Dosage",
      instructionsLabel: "Amabwirizwa",
      documentLabel: "Inyandiko yometseko",
      documentBody: "Fichier y'ordonnance iguma iboneka kugira isuzumwe kandi igenzurwe.",
      openDocument: "Fungura fichier y'ordonnance",
      unavailableDocument: "Fichier ntiboneka",
      commentsTitle: "Commentaires",
      noComments: "Nta commentaire iraboneka ubu.",
      addComment: "Shirako commentaire",
      commentPlaceholder: "Andika commentaire yawe hano...",
      submitComment: "Shira commentaire",
      commentSending: "Biriko birarungikwa...",
      loginToInteract: "Injira kugira ukomante, ukunde canke usangize iyi ordonnance.",
      pharmacyComments: "Inyishu z'amafarumasi",
      pharmacyResponseNote: "Amafarumasi yinjiye ashobora no gushira inyishu y'umwuga kuri iyi ordonnance.",
      pharmacyCommentLabel: "Commentaire ya farumasi",
      etaLabel: "Umwanya witezwe (iminota)",
      interactPrescription: "Korana n'iyi ordonnance",
      saving: "Biriko birabikwa...",
      like: "Gukunda",
      comment: "Comment",
      share: "Sangira",
      readAll: "Soma vyose",
      collapse: "Gufunga",
      noPrescription: "Nta ordonnance yashizweho ubu.",
      statusSubmitted: "yatanzwe",
      statusReviewed: "yasuzumwe",
      actionsCount: "igikorwa/ibikorwa",
      actionLoginRequired: "Injira kugira ukore kuri ibi.",
      commentRequired: "Commentaire irakenewe.",
      commentAdded: "Commentaire yongewe neza.",
      commentAddFailed: "Ntivyashobotse kongerako commentaire.",
      commentLoginRequired: "Injira kugira ushire commentaire.",
      engagementFailed: "Ntivyashobotse kubika iki gikorwa.",
      shared: "Ordonnance yasangijwe neza.",
      liked: "Ordonnance yakunzwe.",
      unliked: "Gukunda vyakuweho.",
      pharmacySectionTitle: copy.networkTitle,
      pharmacySectionBody: copy.networkBody,
      pharmacyUnavailableLocation: "Amakuru y'aho iri ntaraboneka.",
      phoneMissing: "Numero ntirashirwa",
      openingMissing: "Amasaha ntarashirwa",
      deliveryAvailable: "Livraison iraboneka",
      pickupOnsite: "Gutora aho iri",
      servedCount: "ordonnance/ordonnances zakoreweko",
      responseAverage: "Inyishu isanzwe",
      registeredAt: "Yanditswe kw'igenekerezo rya",
      pharmacyOffline: "Ntiri kuri internet",
      pharmacyOpen: "Irafunguye",
      pharmacyCommentsTitle: "Commentaires kuri farumasi",
      noPharmacyComments: "Nta commentaire kuri iyi farumasi ubu.",
      commentPharmacyPlaceholder: "Shira ico ubona kuri iyi farumasi...",
      loginToInteractPharmacy: "Injira kugira ukomante, ukunde canke usangize iyi farumasi.",
      pharmacyCommentAdded: "Commentaire yongewe kuri farumasi.",
      pharmacyCommentFailed: "Ntivyashobotse kongerako commentaire kuri farumasi.",
      pharmacyShared: "Farumasi yasangijwe neza.",
      pharmacyLiked: "Farumasi yakunzwe.",
      pharmacyUnliked: "Like yakuwemwo kuri farumasi.",
      pharmacyActionFailed: "Ntivyashobotse kubika igikorwa kuri farumasi.",
      directorySearchPlaceholder: "Rondera farumasi ukoresheje izina canke ordonnance ukoresheje inomero yayo ya bose...",
      directorySearchHint: "Ishirahamwe ryo kurondera rikorwa ubwo nyene: izina rya farumasi canke inomero ya ordonnance.",
      noPharmacySearchResult: "Nta farumasi ijanye n'ivyo wanditse.",
      noPrescriptionSearchResult: "Nta ordonnance ijanye n'iyo nimero ya bose.",
    },
    sw: {
      liveKicker: "Wakati halisi",
      liveTitle: "Preskripsheni zilizochapishwa na mwingiliano",
      liveBody: "Wageni wanaweza kuona maduka ya dawa yaliyosajiliwa na fomu za umma za preskripsheni zenye dawa zilizothibitishwa, rejea ya umma na jina la utani pekee.",
      liveOnline: "Mtiririko wa wakati halisi umeunganishwa",
      liveOffline: "Mtiririko wa wakati halisi uko nje ya mtandao",
      prescriptionKicker: "Preskripsheni ya mgonjwa",
      patientLabel: "Mgonjwa",
      dosageLabel: "Dozi",
      instructionsLabel: "Maelekezo",
      documentLabel: "Faili iliyoambatanishwa",
      documentBody: "Faili ya asili ya preskripsheni inabaki kupatikana kwa uhakiki na uthibitisho.",
      openDocument: "Fungua faili ya preskripsheni",
      unavailableDocument: "Faili haipatikani",
      commentsTitle: "Maoni",
      noComments: "Hakuna maoni kwa sasa.",
      addComment: "Ongeza maoni",
      commentPlaceholder: "Andika maoni yako hapa...",
      submitComment: "Chapisha maoni",
      commentSending: "Inatumwa...",
      loginToInteract: "Ingia ili utoe maoni, kupenda au kushiriki preskripsheni hii.",
      pharmacyComments: "Majibu ya maduka ya dawa",
      pharmacyResponseNote: "Maduka yaliyounganishwa yanaweza pia kuchapisha jibu la kitaalamu kwa preskripsheni hii.",
      pharmacyCommentLabel: "Maoni ya duka la dawa",
      etaLabel: "Muda unaokadiriwa (dakika)",
      interactPrescription: "Shirikiana na preskripsheni hii",
      saving: "Inahifadhiwa...",
      like: "Like",
      comment: "Comment",
      share: "Share",
      readAll: "Soma yote",
      collapse: "Punguza",
      noPrescription: "Hakuna preskripsheni zilizochapishwa kwa sasa.",
      statusSubmitted: "imetumwa",
      statusReviewed: "imekaguliwa",
      actionsCount: "hatua",
      actionLoginRequired: "Ingia ili ushiriki.",
      commentRequired: "Maoni yanahitajika.",
      commentAdded: "Maoni yameongezwa vizuri.",
      commentAddFailed: "Imeshindikana kuongeza maoni haya.",
      commentLoginRequired: "Ingia ili utoe maoni.",
      engagementFailed: "Imeshindikana kuhifadhi hatua hii.",
      shared: "Preskripsheni imeshirikishwa vizuri.",
      liked: "Preskripsheni imependwa.",
      unliked: "Like imeondolewa.",
      pharmacySectionTitle: copy.networkTitle,
      pharmacySectionBody: copy.networkBody,
      pharmacyUnavailableLocation: "Maelezo ya eneo bado hayajapatikana.",
      phoneMissing: "Nambari haijawekwa",
      openingMissing: "Saa hazijawekwa",
      deliveryAvailable: "Usafirishaji upo",
      pickupOnsite: "Chukua dukani",
      servedCount: "preskripsheni zilizohudumiwa",
      responseAverage: "Muda wa kawaida wa jibu",
      registeredAt: "Ilisajiliwa tarehe",
      pharmacyOffline: "Nje ya mtandao",
      pharmacyOpen: "Funguliwa",
      pharmacyCommentsTitle: "Maoni kuhusu duka la dawa",
      noPharmacyComments: "Hakuna maoni kwa duka hili bado.",
      commentPharmacyPlaceholder: "Shiriki uzoefu wako kuhusu duka hili...",
      loginToInteractPharmacy: "Ingia ili utoe maoni, kupenda au kushiriki duka hili.",
      pharmacyCommentAdded: "Maoni yameongezwa kwa duka la dawa.",
      pharmacyCommentFailed: "Imeshindikana kuongeza maoni ya duka la dawa.",
      pharmacyShared: "Duka la dawa limeshirikishwa vizuri.",
      pharmacyLiked: "Duka la dawa limependwa.",
      pharmacyUnliked: "Like imeondolewa kwa duka la dawa.",
      pharmacyActionFailed: "Imeshindikana kuhifadhi hatua hii ya duka la dawa.",
      directorySearchPlaceholder: "Tafuta duka la dawa kwa jina au preskripsheni kwa namba yake ya umma...",
      directorySearchHint: "Utafutaji wa moja kwa moja: jina la duka la dawa au namba ya umma ya preskripsheni.",
      noPharmacySearchResult: "Hakuna duka la dawa linalolingana na utafutaji huu.",
      noPrescriptionSearchResult: "Hakuna preskripsheni inayolingana na namba hii ya umma.",
    },
    ln: {
      liveKicker: "Na tango oyo",
      liveTitle: "Ba ordonnance oyo ebotami mpe boyokani",
      liveBody: "Bato nyonso bakoki komona ba pharmacie oyo ekomami mpe ba fiches publiques ya ordonnance na nkisi oyo endimami, numero public mpe pseudonyme kaka.",
      liveOnline: "Flux ya tango ya solo ezali kosala",
      liveOffline: "Flux ya tango ya solo ezali te",
      prescriptionKicker: "Ordonnance ya patient",
      patientLabel: "Patient",
      dosageLabel: "Dosage",
      instructionsLabel: "Malako",
      documentLabel: "Document ekangami",
      documentBody: "Fichier original ya ordonnance etikali mpo na botali mpe verifikation.",
      openDocument: "Fungola fichier ya ordonnance",
      unavailableDocument: "Fichier ezali te",
      commentsTitle: "Ba commentaires",
      noComments: "Commentaire moko te mpo na sikoyo.",
      addComment: "Bakisa commentaire",
      commentPlaceholder: "Koma commentaire na yo awa...",
      submitComment: "Botia commentaire",
      commentSending: "Ezali kotindama...",
      loginToInteract: "Kota mpo na kokommenter, kolinga to kokabola ordonnance oyo.",
      pharmacyComments: "Ba eyano ya ba pharmacie",
      pharmacyResponseNote: "Ba pharmacie oyo bakoti bakoki mpe kopesa eyano ya mosala na ordonnance oyo.",
      pharmacyCommentLabel: "Commentaire ya pharmacie",
      etaLabel: "Ntango oyo ekanisami (minutes)",
      interactPrescription: "Sala na ordonnance oyo",
      saving: "Ezali kobombama...",
      like: "Like",
      comment: "Comment",
      share: "Share",
      readAll: "Tanga nyonso",
      collapse: "Kokanga",
      noPrescription: "Ordonnance moko te ebimisami mpo na sikoyo.",
      statusSubmitted: "etindami",
      statusReviewed: "etalami",
      actionsCount: "misala",
      actionLoginRequired: "Kota mpo osala interaction.",
      commentRequired: "Commentaire esengeli.",
      commentAdded: "Commentaire ebakisami malamu.",
      commentAddFailed: "Esalemaki te kobakisa commentaire oyo.",
      commentLoginRequired: "Kota mpo na kokommenter.",
      engagementFailed: "Esalemaki te kobomba action oyo.",
      shared: "Ordonnance ekabolami malamu.",
      liked: "Ordonnance elingami.",
      unliked: "Like elongolami.",
      pharmacySectionTitle: copy.networkTitle,
      pharmacySectionBody: copy.networkBody,
      pharmacyUnavailableLocation: "Ba informations ya esika ezali naino te.",
      phoneMissing: "Numero ezali te",
      openingMissing: "Ba heures ezali te",
      deliveryAvailable: "Livraison ezali",
      pickupOnsite: "Kozwa na esika",
      servedCount: "ba ordonnance esalelami",
      responseAverage: "Eyano ya moyenne",
      registeredAt: "Ekoma na mokolo ya",
      pharmacyOffline: "Offline",
      pharmacyOpen: "Efungwami",
      pharmacyCommentsTitle: "Ba commentaires ya pharmacie",
      noPharmacyComments: "Commentaire moko te na pharmacie oyo mpo na sikoyo.",
      commentPharmacyPlaceholder: "Kabola expérience na yo na pharmacie oyo...",
      loginToInteractPharmacy: "Kota mpo na kokommenter, kolinga to kokabola pharmacie oyo.",
      pharmacyCommentAdded: "Commentaire ebakisami na pharmacie.",
      pharmacyCommentFailed: "Esalemaki te kobakisa commentaire na pharmacie.",
      pharmacyShared: "Pharmacie ekabolami malamu.",
      pharmacyLiked: "Pharmacie elingami.",
      pharmacyUnliked: "Like elongolami na pharmacie.",
      pharmacyActionFailed: "Esalemaki te kobomba action ya pharmacie.",
      directorySearchPlaceholder: "Luka pharmacie na kombo to ordonnance na numero public na yango...",
      directorySearchHint: "Boluki ya tango ya solo: kombo ya pharmacie to numero public ya ordonnance.",
      noPharmacySearchResult: "Pharmacie moko te ekokani na boluki oyo.",
      noPrescriptionSearchResult: "Ordonnance moko te ekokani na numero public oyo.",
    },
  }[language];
  const localizedUi = {
    fr: {
      emailMissing: "Email non renseigne",
      shareDialogTitle: "Partage",
      shareDialogBody: "Choisissez ou partager cette fiche ou ce contenu pour promouvoir PharmiGo.",
      shareCopy: "Copier le lien",
      shareRepublish: "Republier sur la plateforme",
      shareStarted: "Partage lance avec succes.",
      shareRepublished: "Lien republie sur la plateforme.",
      shareFailedPharmacy: "Impossible de partager cette fiche pour le moment.",
      shareFailedPrescription: "Impossible de partager cette ordonnance pour le moment.",
      patientOnlyUpload: "Votre compte actuel est une pharmacie. Seuls les patients peuvent publier une ordonnance.",
      loginPatientFirst: "Connectez-vous d'abord comme patient pour publier une ordonnance.",
    },
    en: {
      emailMissing: "Email not provided",
      shareDialogTitle: "Share",
      shareDialogBody: "Choose where to share this card or content to promote PharmiGo.",
      shareCopy: "Copy link",
      shareRepublish: "Republish on the platform",
      shareStarted: "Share started successfully.",
      shareRepublished: "Link republished on the platform.",
      shareFailedPharmacy: "Unable to share this pharmacy card right now.",
      shareFailedPrescription: "Unable to share this prescription right now.",
      patientOnlyUpload: "Your current account is a pharmacy account. Only patients can publish a prescription.",
      loginPatientFirst: "Sign in first as a patient to publish a prescription.",
    },
    rn: {
      emailMissing: "Email ntirashirwa",
      shareDialogTitle: "Gusangira",
      shareDialogBody: "Hitamwo aho usangiza iri fiche canke ibi bintu kugira ufashe kumenyekanisha PharmiGo.",
      shareCopy: "Kopa lien",
      shareRepublish: "Subira ushire kuri plateforme",
      shareStarted: "Gusangira vyatanguye neza.",
      shareRepublished: "Lien yasubijwe kuri plateforme.",
      shareFailedPharmacy: "Ntivyashobotse gusangiza iyi fiche ubu nyene.",
      shareFailedPrescription: "Ntivyashobotse gusangiza iyi ordonnance ubu nyene.",
      patientOnlyUpload: "Konti urimwo ni iya farumasi. Abarwayi gusa ni bo bashobora gushira ordonnance.",
      loginPatientFirst: "Banza winjire nk'umurwayi kugira ushobore gushira ordonnance.",
    },
    sw: {
      emailMissing: "Barua pepe haijawekwa",
      shareDialogTitle: "Shiriki",
      shareDialogBody: "Chagua wapi kushiriki kadi hii au maudhui haya ili kuitangaza PharmiGo.",
      shareCopy: "Nakili kiungo",
      shareRepublish: "Chapisha tena kwenye jukwaa",
      shareStarted: "Ushiriki umeanzishwa vizuri.",
      shareRepublished: "Kiungo kimechapishwa tena kwenye jukwaa.",
      shareFailedPharmacy: "Imeshindikana kushiriki kadi hii ya duka la dawa kwa sasa.",
      shareFailedPrescription: "Imeshindikana kushiriki preskripsheni hii kwa sasa.",
      patientOnlyUpload: "Akaunti yako ya sasa ni ya duka la dawa. Wagonjwa pekee wanaweza kuchapisha preskripsheni.",
      loginPatientFirst: "Ingia kwanza kama mgonjwa ili uchapishe preskripsheni.",
    },
    ln: {
      emailMissing: "Email ezali te",
      shareDialogTitle: "Kokabola",
      shareDialogBody: "Pona esika ya kokabola fiche oyo to contenu oyo mpo na koyebisa bato PharmiGo.",
      shareCopy: "Kopier lien",
      shareRepublish: "Botia lisusu na plateforme",
      shareStarted: "Kokabola ebandi malamu.",
      shareRepublished: "Lien ezongisami na plateforme.",
      shareFailedPharmacy: "Ekoki te kokabola fiche ya pharmacie oyo mpo na sikoyo.",
      shareFailedPrescription: "Ekoki te kokabola ordonnance oyo mpo na sikoyo.",
      patientOnlyUpload: "Compte na yo ya sikoyo ezali ya pharmacie. Ba patient kaka nde bakoki kobimisa ordonnance.",
      loginPatientFirst: "Banda okota lokola patient mpo na kotinda ordonnance.",
    },
  }[language];
  const pharmigoModalContent = {
    fr: {
      title: "PharmiGo : l'acces intelligent aux medicaments",
      downloadPdf: "Telecharger PDF",
      sections: [
        {
          title: "Qu'est-ce que PharmiGo ?",
          intro:
            "PharmiGo connecte les patients et les pharmacies avec des donnees reelles de stock, de disponibilite et de reponse.",
          items: [
            { title: "Diffusion en temps reel", body: "Une ordonnance publiee devient visible sans rechargement aux pharmacies concernees." },
            { title: "Recherche ciblee", body: "La plateforme identifie rapidement les pharmacies capables de servir la demande." },
            { title: "Choix guide", body: "Le patient compare prix, delais et disponibilite avant de confirmer son choix." },
          ],
        },
        {
          title: "Objectifs",
          items: [
            { title: "Reduire les ruptures", body: "Mieux orienter les patients vers les stocks disponibles." },
            { title: "Faire gagner du temps", body: "Eviter les deplacements et appels inutiles." },
            { title: "Rendre la sante plus accessible", body: "Donner un acces plus simple aux traitements essentiels." },
          ],
        },
        {
          title: "Comment ca marche ?",
          items: [
            { title: "1. Publier", body: "Le patient envoie son ordonnance ou son besoin." },
            { title: "2. Analyser et comparer", body: "PharmiGo analyse puis croise la demande avec les stocks pharmacies." },
            { title: "3. Selectionner et servir", body: "Le patient choisit une pharmacie, puis le suivi continue jusqu'a la confirmation finale." },
          ],
        },
        {
          title: "Pourquoi PharmiGo est different",
          items: [
            { title: "Temps reel", body: "Les dashboards, notifications et flux se synchronisent avec les evenements de la plateforme." },
            { title: "Contexte local", body: "Les moyens de paiement, langues et parcours sont adaptes au Burundi et a la RDC." },
            { title: "Trajectoire complete", body: "La plateforme couvre la demande, la reponse, la selection et la confirmation." },
          ],
        },
        {
          title: "Valeur pour les pharmacies",
          items: [
            { title: "Visibilite accrue", body: "Les pharmacies apparaissent sur de vraies demandes actives." },
            { title: "Pilotage du stock", body: "Le stock peut etre mis a jour et exploite directement par les parcours patients." },
            { title: "Revenus mieux cadres", body: "Abonnements et moyens de paiement sont geres au niveau systeme." },
          ],
        },
      ],
    },
    en: {
      title: "PharmiGo: smart access to medicine",
      downloadPdf: "Download PDF",
      sections: [
        {
          title: "What is PharmiGo?",
          intro:
            "PharmiGo connects patients and pharmacies with live stock, availability, and response data.",
          items: [
            { title: "Real-time broadcast", body: "A published prescription becomes visible to relevant pharmacies without a page reload." },
            { title: "Targeted search", body: "The platform quickly identifies pharmacies that can fulfill the request." },
            { title: "Guided choice", body: "The patient compares price, timing, and availability before confirming." },
          ],
        },
        {
          title: "Goals",
          items: [
            { title: "Reduce shortages", body: "Direct patients toward pharmacies with available stock." },
            { title: "Save time", body: "Avoid unnecessary travel and repeated calls." },
            { title: "Improve access", body: "Make essential treatment easier to reach." },
          ],
        },
        {
          title: "How it works",
          items: [
            { title: "1. Publish", body: "The patient submits a prescription or medicine request." },
            { title: "2. Analyze and compare", body: "PharmiGo analyzes the request and matches it with pharmacy stock." },
            { title: "3. Select and serve", body: "The patient chooses a pharmacy and the workflow continues until final confirmation." },
          ],
        },
        {
          title: "Why PharmiGo is different",
          items: [
            { title: "Real time", body: "Dashboards, notifications, and feeds stay aligned with platform events." },
            { title: "Local context", body: "Payment methods, languages, and flows fit Burundi and DRC realities." },
            { title: "End-to-end journey", body: "The platform covers request, response, selection, and completion." },
          ],
        },
        {
          title: "Value for pharmacies",
          items: [
            { title: "More visibility", body: "Pharmacies appear on real active patient demand." },
            { title: "Stock control", body: "Stock updates directly power the patient experience." },
            { title: "Structured revenue", body: "Subscriptions and payment methods are managed at system level." },
          ],
        },
      ],
    },
    rn: {
      title: "PharmiGo: ugushika ku miti mu buryo bw'ubwenge",
      downloadPdf: "Kurura PDF",
      sections: [
        {
          title: "PharmiGo ni iki?",
          intro:
            "PharmiGo ihuza abarwayi n'amafarumasi ikoresheje amakuru nyayo ya stock n'inyishu zitangwa.",
          items: [
            { title: "Kwamamaza mu kanya nyako", body: "Ordonnance yashizweho ibonwa n'amafarumasi ata gusubiramwo urupapuro." },
            { title: "Ugushaka kwihuta", body: "Urubuga ruronka vuba afarumasi ashobora gutanga imiti isabwa." },
            { title: "Uguhitamwo neza", body: "Umurwayi aragereranya igiciro, umwanya n'ukuboneka imbere yo kwemeza." },
          ],
        },
        {
          title: "Intumbero",
          items: [
            { title: "Kugabanya ukubura imiti", body: "Kuyobora abarwayi aho stock iboneka." },
            { title: "Kuziganya umwanya", body: "Kwirinda ingendo n'amatelefone adafise akamaro." },
            { title: "Gutuma ubuvuzi bwegerezwa bose", body: "Gutuma imiti y'ingenzi iboneka bitagoranye." },
          ],
        },
        {
          title: "Bikora gute?",
          items: [
            { title: "1. Gutanga", body: "Umurwayi ashiraho ordonnance canke asaba umuti." },
            { title: "2. Gusesengura no kugereranya", body: "PharmiGo isesangura igisabwa igahuza na stock y'amafarumasi." },
            { title: "3. Guhitamwo no gutangwa", body: "Umurwayi ahitamwo farumasi kandi urugendo rugakomeza gushika ku kwemeza kwa nyuma." },
          ],
        },
        {
          title: "Igitandukanya PharmiGo",
          items: [
            { title: "Mu kanya nyako", body: "Dashboard, notifications na flux biguma bihuye n'ibibera kuri plateforme." },
            { title: "Bijanye n'aho hantu", body: "Indimi n'uburyo bwo kwishura bijanye n'u Burundi na RDC." },
            { title: "Urugendo rwose", body: "Urubuga rukurikirana gusaba, inyishu, guhitamwo no kwemeza." },
          ],
        },
        {
          title: "Akamaro ku mafarumasi",
          items: [
            { title: "Kumenyekana kurushiriza", body: "Afarumasi aboneka ku bisabwa nyavyo vy'abarwayi." },
            { title: "Gucunga stock", body: "Ivugururwa rya stock rikora neza mu rugendo rw'umurwayi." },
            { title: "Amafaranga acungwa neza", body: "Abonnement n'uburyo bwo kwishura bicungirwa ku rwego rwa systeme." },
          ],
        },
      ],
    },
    sw: {
      title: "PharmiGo: upatikanaji wa dawa kwa akili",
      downloadPdf: "Pakua PDF",
      sections: [
        {
          title: "PharmiGo ni nini?",
          intro:
            "PharmiGo inaunganisha wagonjwa na maduka ya dawa kwa data halisi ya stock, upatikanaji na majibu.",
          items: [
            { title: "Usambazaji wa wakati halisi", body: "Preskripsheni iliyotumwa inaonekana kwa maduka husika bila kupakia ukurasa upya." },
            { title: "Utafutaji uliolengwa", body: "Jukwaa hutambua haraka maduka yanayoweza kuhudumia ombi." },
            { title: "Uamuzi unaoongozwa", body: "Mgonjwa hulinganisha bei, muda na upatikanaji kabla ya kuthibitisha." },
          ],
        },
        {
          title: "Malengo",
          items: [
            { title: "Kupunguza uhaba", body: "Kuelekeza wagonjwa kwenye stock inayopatikana." },
            { title: "Kuokoa muda", body: "Kuepuka safari na simu zisizo na matokeo." },
            { title: "Kuboresha upatikanaji", body: "Kurahisisha kupata matibabu muhimu." },
          ],
        },
        {
          title: "Inafanyaje kazi?",
          items: [
            { title: "1. Kutuma", body: "Mgonjwa hutuma preskripsheni au hitaji la dawa." },
            { title: "2. Kuchambua na kulinganisha", body: "PharmiGo huchambua ombi kisha hulinganisha na stock ya maduka ya dawa." },
            { title: "3. Kuchagua na kuhudumiwa", body: "Mgonjwa huchagua duka na safari huendelea hadi uthibitisho wa mwisho." },
          ],
        },
        {
          title: "Kwa nini PharmiGo ni tofauti",
          items: [
            { title: "Wakati halisi", body: "Dashboards, arifa na feed husawazishwa na matukio ya jukwaa." },
            { title: "Muktadha wa eneo", body: "Lugha na njia za malipo zinaendana na Burundi na DRC." },
            { title: "Safari kamili", body: "Jukwaa linafuatilia ombi, jibu, uchaguzi na ukamilishaji." },
          ],
        },
        {
          title: "Faida kwa maduka ya dawa",
          items: [
            { title: "Muonekano zaidi", body: "Maduka huonekana kwenye mahitaji halisi ya wagonjwa." },
            { title: "Udhibiti wa stock", body: "Mabadiliko ya stock yanaathiri moja kwa moja uzoefu wa mgonjwa." },
            { title: "Mapato yaliyoratibiwa", body: "Usajili na njia za malipo zinasimamiwa kwa kiwango cha mfumo." },
          ],
        },
      ],
    },
    ln: {
      title: "PharmiGo: nzela ya mayele mpo na kozwa nkisi",
      downloadPdf: "Telecharger PDF",
      sections: [
        {
          title: "PharmiGo ezali nini?",
          intro:
            "PharmiGo ekangisaka ba patient na ba pharmacie na ba donnees ya solo ya stock mpe disponibilite.",
          items: [
            { title: "Diffusion ya tango ya solo", body: "Ordonnance oyo etindami emonanaka mbala moko epai ya ba pharmacie oyo etali yango." },
            { title: "Recherche oyo etali mpenza posa", body: "Plateforme emonaka noki ba pharmacie oyo bakoki kosunga." },
            { title: "Pona na litambwisi", body: "Patient atalaka motuya, ntango mpe disponibilite liboso ya kondima." },
          ],
        },
        {
          title: "Mikano",
          items: [
            { title: "Kokitisa manque ya nkisi", body: "Kotinda bato na esika oyo stock ezali." },
            { title: "Kobikisa ntango", body: "Kolongola ba deplacement mpe ba appel oyo ezangi litomba." },
            { title: "Kosala ete soins ezala pene", body: "Kosunga bato bazwa nkisi ya motuya na pete." },
          ],
        },
        {
          title: "Esalaka ndenge nini?",
          items: [
            { title: "1. Kotinda", body: "Patient atindi ordonnance to bosenga ya nkisi." },
            { title: "2. Kotalela mpe kokokanisa", body: "PharmiGo etalela bosenga mpe ekokanisa yango na stock ya ba pharmacie." },
            { title: "3. Kopona mpe kosalela", body: "Patient apona pharmacie mpe parcours ekobaki kino na confirmation ya suka." },
          ],
        },
        {
          title: "Nini ekesenisaka PharmiGo",
          items: [
            { title: "Tango ya solo", body: "Dashboard, notification mpe feed ezalaka synchronise na makambo ya plateforme." },
            { title: "Contexte ya esika", body: "Minoko mpe ba paiement ebongisami mpo na Burundi mpe RDC." },
            { title: "Parcours nyonso", body: "Plateforme ezipaka bosenga, eyano, boponi mpe bosukisi." },
          ],
        },
        {
          title: "Litomba mpo na ba pharmacie",
          items: [
            { title: "Visibilite mingi", body: "Ba pharmacie emonanaka na ba demandes ya solo ya ba patient." },
            { title: "Contrôle ya stock", body: "Mbongwana ya stock esalaka mbala moko na parcours ya patient." },
            { title: "Recettes oyo ebongisami", body: "Abonnement mpe ba paiement ecungami na niveau ya systeme." },
          ],
        },
      ],
    },
  }[language];
  const chromeText = {
    fr: {
      notifications: "Notifications",
      messages: "Messages",
      noNotifications: "Aucune notification pour le moment.",
      markRead: "Marquer lue",
      delete: "Supprimer",
      messageModalTitle: "Messagerie pharmacies",
      messageModalBody: "Echangez uniquement avec les autres pharmacies deja inscrites sur la plateforme.",
      conversations: "Conversations",
      addConversationHint: "Ajoutez une pharmacie parmi celles deja enregistrees puis demarrez la discussion.",
      noPharmacyAvailable: "Aucune autre pharmacie disponible",
      choosePharmacy: "Choisir une pharmacie",
      add: "Ajouter",
      enableMessaging: "Inscrivez au moins une autre pharmacie pour activer la messagerie entre pharmacies.",
      noContactsYet: "Aucun contact ni message pour le moment.",
      noMessageYet: "Aucun message pour le moment.",
      savedContact: "Contact",
      unread: "non lu(s)",
      myProfile: "Mon profil",
    },
    en: {
      notifications: "Notifications",
      messages: "Messages",
      noNotifications: "No notifications for now.",
      markRead: "Mark read",
      delete: "Delete",
      messageModalTitle: "Pharmacy messaging",
      messageModalBody: "Exchange privately with other pharmacies already registered on the platform.",
      conversations: "Conversations",
      addConversationHint: "Add a pharmacy from the registered list and start a conversation.",
      noPharmacyAvailable: "No other pharmacy available",
      choosePharmacy: "Choose a pharmacy",
      add: "Add",
      enableMessaging: "Register at least one more pharmacy to enable pharmacy-to-pharmacy messaging.",
      noContactsYet: "No contacts or messages yet.",
      noMessageYet: "No messages yet.",
      savedContact: "Contact",
      unread: "unread",
      myProfile: "My profile",
    },
    rn: {
      notifications: "Notifications",
      messages: "Ubutumwa",
      noNotifications: "Nta notification iriho ubu.",
      markRead: "Shira ko yasomwe",
      delete: "Gusiba",
      messageModalTitle: "Ubutumwa bw'amafarumasi",
      messageModalBody: "Ganira n'ayandi mafaranga yanditswe kuri plateforme mu buryo bw'ibanga.",
      conversations: "Ibiganira",
      addConversationHint: "Shiramwo farumasi iri mu zanditswe hanyuma utangure ikiganiro.",
      noPharmacyAvailable: "Nta yindi farumasi iboneka",
      choosePharmacy: "Hitamwo farumasi",
      add: "Shirako",
      enableMessaging: "Andikisha nibura iyindi farumasi imwe kugira ubutumwa hagati y'amafarumasi bukore.",
      noContactsYet: "Nta contact canke butumwa biriho ubu.",
      noMessageYet: "Nta butumwa buriho ubu.",
      savedContact: "Contact",
      unread: "butarasomwa",
      myProfile: "Profil yanje",
    },
    sw: {
      notifications: "Arifa",
      messages: "Ujumbe",
      noNotifications: "Hakuna arifa kwa sasa.",
      markRead: "Weka kuwa yamesomwa",
      delete: "Futa",
      messageModalTitle: "Ujumbe wa maduka ya dawa",
      messageModalBody: "Badilishana ujumbe kwa faragha na maduka ya dawa yaliyosajiliwa kwenye jukwaa.",
      conversations: "Mazungumzo",
      addConversationHint: "Ongeza duka la dawa kutoka kwenye orodha iliyosajiliwa kisha anza mazungumzo.",
      noPharmacyAvailable: "Hakuna duka lingine la dawa",
      choosePharmacy: "Chagua duka la dawa",
      add: "Ongeza",
      enableMessaging: "Sajili angalau duka jingine la dawa ili kuwezesha ujumbe kati ya maduka ya dawa.",
      noContactsYet: "Hakuna mawasiliano au ujumbe kwa sasa.",
      noMessageYet: "Hakuna ujumbe kwa sasa.",
      savedContact: "Mwasiliano",
      unread: "hazijasomwa",
      myProfile: "Wasifu wangu",
    },
    ln: {
      notifications: "Ba notifications",
      messages: "Ba messages",
      noNotifications: "Notification ezali te mpo na sikoyo.",
      markRead: "Tia lokola etangami",
      delete: "Longola",
      messageModalTitle: "Messagerie ya ba pharmacie",
      messageModalBody: "Solola na sekele na ba pharmacie mosusu oyo bakomami na plateforme.",
      conversations: "Masolo",
      addConversationHint: "Bakisa pharmacie moko na liste mpe banda lisolo.",
      noPharmacyAvailable: "Pharmacie mosusu ezali te",
      choosePharmacy: "Pona pharmacie",
      add: "Bakisa",
      enableMessaging: "Koma pharmacie mosusu moko mpo messagerie ya ba pharmacie ekoka kosala.",
      noContactsYet: "Contact to message ezali te mpo na sikoyo.",
      noMessageYet: "Message ezali te mpo na sikoyo.",
      savedContact: "Contact",
      unread: "nanu etangami te",
      myProfile: "Profil na ngai",
    },
  }[language];

  function translateNotificationTitle(title: string) {
    const map: Record<string, string> = {
      "Nouvelle ordonnance": language === "en" ? "New prescription" : language === "rn" ? "Ordonnance nshasha" : language === "sw" ? "Preskripsheni mpya" : language === "ln" ? "Ordonnance ya sika" : "Nouvelle ordonnance",
      "Interaction pharmacie": language === "en" ? "Pharmacy interaction" : language === "rn" ? "Interaction ya farumasi" : language === "sw" ? "Mwingiliano wa duka la dawa" : language === "ln" ? "Interaction ya pharmacie" : "Interaction pharmacie",
      "Message pharmacie": language === "en" ? "Pharmacy message" : language === "rn" ? "Ubutumwa bwa farumasi" : language === "sw" ? "Ujumbe wa duka la dawa" : language === "ln" ? "Message ya pharmacie" : "Message pharmacie",
      "Nouveau commentaire patient": language === "en" ? "New patient comment" : language === "rn" ? "Commentaire nshasha y'umurwayi" : language === "sw" ? "Maoni mapya ya mgonjwa" : language === "ln" ? "Commentaire ya sika ya patient" : title,
      "Nouveau commentaire pharmacie": language === "en" ? "New pharmacy comment" : language === "rn" ? "Commentaire nshasha ya farumasi" : language === "sw" ? "Maoni mapya ya duka la dawa" : language === "ln" ? "Commentaire ya sika ya pharmacie" : title,
    };
    return map[title] ?? title;
  }

  function translateNotificationMessage(message: string) {
    if (message.includes("a publie une ordonnance sur la plateforme.")) {
      const actor = message.replace(" a publie une ordonnance sur la plateforme.", "");
      if (language === "en") return `${actor} published a prescription on the platform.`;
      if (language === "rn") return `${actor} yashize ordonnance kuri plateforme.`;
      if (language === "sw") return `${actor} amechapisha preskripsheni kwenye jukwaa.`;
      if (language === "ln") return `${actor} abimisi ordonnance na plateforme.`;
    }

    if (message.includes("a commente une ordonnance sur la plateforme.")) {
      const actor = message.replace(" a commente une ordonnance sur la plateforme.", "");
      if (language === "en") return `${actor} commented on a prescription on the platform.`;
      if (language === "rn") return `${actor} yashize commentaire ku ordonnance kuri plateforme.`;
      if (language === "sw") return `${actor} ameweka maoni kwenye preskripsheni kwenye jukwaa.`;
      if (language === "ln") return `${actor} akomi commentaire na ordonnance na plateforme.`;
    }

    if (message.includes("a commente la fiche de ")) {
      const actor = message.split(" a commente la fiche de ")[0];
      const target = message.split(" a commente la fiche de ")[1]?.replace(/\.$/, "") ?? "";
      if (language === "en") return `${actor} commented on ${target}'s profile.`;
      if (language === "rn") return `${actor} yashize commentaire kuri fiche ya ${target}.`;
      if (language === "sw") return `${actor} ameweka maoni kwenye wasifu wa ${target}.`;
      if (language === "ln") return `${actor} akomi commentaire na fiche ya ${target}.`;
    }

    if (message.includes("a reagi a l'ordonnance de ")) {
      const actor = message.split(" a reagi a l'ordonnance de ")[0];
      const target = message.split(" a reagi a l'ordonnance de ")[1]?.replace(/\.$/, "") ?? "";
      if (language === "en") return `${actor} responded to ${target}'s prescription.`;
      if (language === "rn") return `${actor} yishuye kuri ordonnance ya ${target}.`;
      if (language === "sw") return `${actor} amejibu preskripsheni ya ${target}.`;
      if (language === "ln") return `${actor} apesi eyano na ordonnance ya ${target}.`;
    }

    if (message.includes("a envoye un message visible sur la plateforme.")) {
      const actor = message.replace(" a envoye un message visible sur la plateforme.", "");
      if (language === "en") return `${actor} sent a message on the platform.`;
      if (language === "rn") return `${actor} yarungitse ubutumwa kuri plateforme.`;
      if (language === "sw") return `${actor} ametuma ujumbe kwenye jukwaa.`;
      if (language === "ln") return `${actor} atindi message na plateforme.`;
    }

    return translateBackendMessage(message);
  }

  function translateBackendMessage(message: string) {
    const exactMap: Record<string, string> = {
      "Connexion requise.": feedText.actionLoginRequired,
      "Le commentaire est obligatoire.": feedText.commentRequired,
      "Connectez-vous pour commenter une ordonnance.": feedText.commentLoginRequired,
      "Seules les pharmacies peuvent interagir avec une ordonnance.": language === "en" ? "Only pharmacies can publish a professional response to a prescription." : language === "rn" ? "Farumasi gusa ni zo zishobora gutanga inyishu y'umwuga kuri ordonnance." : language === "sw" ? "Maduka ya dawa tu ndiyo yanaweza kutoa jibu la kitaalamu kwa preskripsheni." : language === "ln" ? "Ba pharmacie kaka nde bakoki kopesa eyano ya mosala na ordonnance." : "Seules les pharmacies peuvent interagir avec une ordonnance.",
      "Le service demande est introuvable sur le serveur. Verifiez la configuration ou redemarrez le backend.": language === "en" ? "The requested service was not found on the server. Check the configuration or restart the backend." : language === "rn" ? "Service yasabwe ntiboneka kuri serveur. Suzuma configuration canke wongere utangure backend." : language === "sw" ? "Huduma iliyoombwa haikupatikana kwenye seva. Kagua usanidi au anzisha upya backend." : language === "ln" ? "Service oyo esengami emonani te na serveur. Tala configuration to banda lisusu backend." : "Le service demande est introuvable sur le serveur. Verifiez la configuration ou redemarrez le backend.",
    };
    return exactMap[message] ?? message;
  }

  useEffect(() => {
    async function loadData() {
      try {
        setError(null);
        const [configData, dashboardData] = await Promise.all([fetchAppConfig(), fetchDashboard()]);

        setConfig(configData ?? null);
        setDashboard(dashboardData ?? null);
        setLiveFeedConnected(true);
      } catch (err) {
        void err;
        logClientError("Le chargement de la page d'accueil a echoue.");
        setError("Impossible de charger les donnees.");
        setLiveFeedConnected(false);
      }
    }

    void loadData();
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pollingTimer: number | null = null;
    const shouldUsePollingFallback =
      import.meta.env.DEV ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    const refreshDashboardData = async () => {
      if (dashboardRefreshInFlightRef.current) {
        return;
      }

      dashboardRefreshInFlightRef.current = true;
      try {
        const dashboardData = await fetchDashboard();
        startTransition(() => {
          setDashboard(dashboardData);
        });
        setLiveFeedConnected(true);
      } catch {
        setLiveFeedConnected(false);
      } finally {
        dashboardRefreshInFlightRef.current = false;
      }
    };

    const connect = () => {
      if (shouldUsePollingFallback) {
        pollingTimer = window.setInterval(() => {
          void refreshDashboardData();
        }, 20000);
        return;
      }

      socket = new WebSocket(getChatWebSocketUrl("public-feed"));
      socket.onopen = () => setLiveFeedConnected(true);
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as {
            type?: string;
            event_type?: string;
            payload?: { pharmacy_id?: number | null; is_online?: boolean; last_seen?: string | null };
          };

          if (parsed.type === "feed.event" && parsed.event_type === "presence.updated" && parsed.payload?.pharmacy_id) {
            startTransition(() => {
              setDashboard((current) =>
                current
                  ? {
                    ...current,
                    pharmacies: (current.pharmacies ?? []).map((pharmacy) =>
                      pharmacy.id === parsed.payload?.pharmacy_id
                        ? {
                          ...pharmacy,
                          is_online: Boolean(parsed.payload?.is_online),
                          last_seen: parsed.payload?.last_seen ?? pharmacy.last_seen ?? null,
                        }
                        : pharmacy
                    ),
                  }
                  : current
              );
            });
            setLiveFeedConnected(true);
            return;
          }
        } catch {
          // Fallback to full refresh for non-JSON or unexpected events.
        }

        void refreshDashboardData();
      };
      socket.onerror = () => setLiveFeedConnected(false);
      socket.onclose = () => {
        setLiveFeedConnected(false);
        reconnectTimer = window.setTimeout(connect, 2500);
      };
    };

    connect();

    return () => {
      if (pollingTimer) {
        window.clearInterval(pollingTimer);
      }
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, []);

  useEffect(() => {
    function openUploadModal() {
      handleOpenUpload();
    }

    function openProfileModal() {
      openModal("profile");
    }

    function openPharmacyStockModal() {
      setActiveModal("pharmacy-stock");
    }

    function handleAuthExpired() {
      persistCurrentUser(null);
      setAuthBootstrapped(true);
      setUploadError(null);
      setUploadSuccess(null);
      setAuthError(null);
      setAuthFieldErrors({});
    }

    window.addEventListener("open-upload-modal", openUploadModal);
    window.addEventListener("open-profile-modal", openProfileModal);
    window.addEventListener("open-pharmacy-stock", openPharmacyStockModal);
    window.addEventListener("pharmigo-auth-expired", handleAuthExpired);
    return () => {
      window.removeEventListener("open-upload-modal", openUploadModal);
      window.removeEventListener("open-profile-modal", openProfileModal);
      window.removeEventListener("open-pharmacy-stock", openPharmacyStockModal);
      window.removeEventListener("pharmigo-auth-expired", handleAuthExpired);
    };
  }, [currentUser]);

  useEffect(() => {
    if (!authBootstrapped) {
      return;
    }

    if (!currentUser || !getStoredCurrentUser()) {
      return;
    }

    let heartbeatTimer: number | null = null;

    const heartbeat = async () => {
      try {
        await sendPresenceHeartbeat();
      } catch {
        // Presence will retry automatically on the next heartbeat cycle.
      }
    };

    void heartbeat();
    heartbeatTimer = window.setInterval(() => {
      void heartbeat();
    }, 10000);

    const handleFocus = () => {
      void heartbeat();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void heartbeat();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
      }
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authBootstrapped, currentUser]);

  useEffect(() => {
    if (!authBootstrapped) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const requestedModal = params.get("modal");

    if (requestedModal === "dashboard" && currentUser && activeModal !== "dashboard") {
      setActiveModal("dashboard");
    }
  }, [activeModal, authBootstrapped, currentUser, location.search]);

  useEffect(() => {
    if (!authBootstrapped) {
      return;
    }

    if (!currentUser) {
      clearStoredAuthSession();
      return;
    }

    persistStoredCurrentUser(currentUser);
  }, [authBootstrapped, currentUser]);

  useEffect(() => {
    if (!authBootstrapped) {
      return;
    }

    if (!currentUser || !getStoredCurrentUser()) {
      setProfileForm({ username: "", phone_number: "", email: "", country_code: "bi" });
      setAdminProfileForm({ username: "", email: "", profile_image: null });
      setPharmacyProfileForm({
        pharmacy_name: "",
        address: "",
        city: "",
        phone_number: "",
        email: "",
        opening_hours: "",
        delivery_supported: false,
        pharmacy_image: null,
        country_code: "bi",
      });
      setPharmacyMessages([]);
      setSavedContactIds([]);
      setSelectedConversationId("");
      setContactPickerId("");
      return;
    }

    if (currentUser.profile?.role === "pharmacy" && currentUser.profile?.pharmacy) {
      const storedValue = localStorage.getItem(`pharmigo.lastReadMessageAt.${currentUser.profile.pharmacy}`);
      setLastReadMessageAt(storedValue ?? "");
      const storedContacts = localStorage.getItem(`pharmigo.savedContacts.${currentUser.profile.pharmacy}`);
      try {
        const parsedContacts = storedContacts ? (JSON.parse(storedContacts) as number[]) : [];
        setSavedContactIds(Array.isArray(parsedContacts) ? parsedContacts.filter((item) => Number.isInteger(item)) : []);
      } catch {
        setSavedContactIds([]);
      }
    } else {
      setLastReadMessageAt("");
      setSavedContactIds([]);
    }

    void fetchProfile()
      .then((user) => {
        const patientPhone = splitPhoneNumber(user.profile?.phone_number);
        const pharmacyPhone = splitPhoneNumber(user.profile?.pharmacy_phone_number);
        setCurrentUser(user);
        setProfileForm({
          username: user.username ?? "",
          phone_number: patientPhone.localNumber,
          email: user.email ?? "",
          country_code: patientPhone.countryCode,
        });
        setAdminProfileForm({
          username: user.username ?? "",
          email: user.email ?? "",
          profile_image: null,
        });
        setPharmacyProfileForm({
          pharmacy_name: user.profile?.pharmacy_name ?? "",
          address: user.profile?.address ?? "",
          city: user.profile?.pharmacy_city ?? "",
          phone_number: pharmacyPhone.localNumber,
          email: user.profile?.pharmacy_email ?? "",
          opening_hours: user.profile?.pharmacy_opening_hours ?? "",
          delivery_supported: Boolean(user.profile?.pharmacy_delivery_supported),
          pharmacy_image: null,
          country_code: pharmacyPhone.countryCode,
        });
      })
      .catch((error) => {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          persistCurrentUser(null);
        }
      });

    if (currentUser.profile?.role === "pharmacy") {
      void fetchMessages()
        .then((items) => setPharmacyMessages(items))
        .catch(() => undefined);
    }
  }, [authBootstrapped, currentUser?.id]);

  const navigationItems = useMemo(
    () => [
      { href: "#services", label: copy.navServices },
      { href: "#pharmacies", label: t("nav.search") },
      { href: "#how-it-works", label: copy.navHow },
      { href: "#support", label: copy.navSupport },
    ],
    [copy.navHow, copy.navServices, copy.navSupport, t]
  );

  const rawConfigProduct = config?.product;
  const rawConfigFeatures = config?.features;
  const rawConfigSecurity = config?.security;
  const rawDashboardPharmacies = dashboard?.pharmacies;
  const rawDashboardPrescriptions = dashboard?.prescriptions;
  const rawDashboardNotifications = dashboard?.notifications;

  const configProduct = rawConfigProduct ?? null;
  const configFeatures = Array.isArray(rawConfigFeatures) ? rawConfigFeatures : [];
  const configSecurity = Array.isArray(rawConfigSecurity) ? rawConfigSecurity : [];
  const dashboardPharmacies = Array.isArray(rawDashboardPharmacies) ? rawDashboardPharmacies : [];
  const dashboardPrescriptions = Array.isArray(rawDashboardPrescriptions) ? rawDashboardPrescriptions : [];
  const dashboardNotifications = Array.isArray(rawDashboardNotifications) ? rawDashboardNotifications : [];
  const deferredDirectorySearchTerm = useDeferredValue(directorySearchTerm);
  const normalizedDirectorySearchTerm = deferredDirectorySearchTerm.trim().toLowerCase();
  const isPrescriptionReferenceSearch =
    normalizedDirectorySearchTerm.startsWith("ord") || /\d/.test(normalizedDirectorySearchTerm);
  const currentPharmacyId = currentUser?.profile?.role === "pharmacy" ? currentUser.profile.pharmacy ?? null : null;

  const productName = configProduct?.name?.trim() || "PharmiGo";
  const productCountries = Array.isArray(configProduct?.countries) ? configProduct.countries : [];
  const features = configFeatures.slice(0, 6);
  const security = configSecurity.slice(0, 4);
  const pharmacies: Pharmacy[] = dashboardPharmacies;
  const publishedPrescriptions: PrescriptionRecord[] = dashboardPrescriptions;
  const canViewPrescriptionBoard = Boolean(!currentUser || currentUser.is_staff || currentUser.profile?.role === "pharmacy");
  const filteredPharmacies = useMemo(
    () =>
      !normalizedDirectorySearchTerm || isPrescriptionReferenceSearch
        ? pharmacies
        : pharmacies.filter((pharmacy) =>
            [pharmacy.name, pharmacy.address, pharmacy.city]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(normalizedDirectorySearchTerm)
          ),
    [pharmacies, isPrescriptionReferenceSearch, normalizedDirectorySearchTerm]
  );
  const filteredPublishedPrescriptions = useMemo(
    () =>
      !normalizedDirectorySearchTerm || !isPrescriptionReferenceSearch
        ? publishedPrescriptions
        : publishedPrescriptions.filter((prescription) =>
            (prescription.public_reference || `ORD-${String(prescription.id).padStart(6, "0")}`)
              .toLowerCase()
              .includes(normalizedDirectorySearchTerm)
          ),
    [publishedPrescriptions, isPrescriptionReferenceSearch, normalizedDirectorySearchTerm]
  );
  const patientConfirmedPrescriptions = useMemo(() => {
    if (currentUser?.profile?.role !== "patient") {
      return [];
    }

    const visibleStatuses = new Set([
      "confirmed",
      "searching",
      "pharmacy_selected",
      "preparing",
      "ready",
      "served",
      "patient_confirmed",
      "completed",
    ]);

    return publishedPrescriptions.filter((prescription) => {
      return visibleStatuses.has(prescription.status) || prescriptionHasConfirmedMedications(prescription);
    });
  }, [currentUser?.profile?.role, publishedPrescriptions]);
  const patientProfilePrescriptions = useMemo(
    () => patientConfirmedPrescriptions.slice(0, 4),
    [patientConfirmedPrescriptions]
  );
  const publicVisiblePrescriptions = useMemo(() => {
    if (currentUser?.profile?.role === "patient") {
      return [];
    }

    return filteredPublishedPrescriptions.filter((prescription) => prescriptionHasConfirmedMedications(prescription));
  }, [currentUser?.profile?.role, filteredPublishedPrescriptions]);
  const pharmacyProfilePrescriptions = useMemo(() => {
    if (currentUser?.profile?.role !== "pharmacy" || !currentPharmacyId) {
      return [];
    }

    return publishedPrescriptions
      .filter((prescription) => prescription.pharmacy === currentPharmacyId || prescription.document_access_granted)
      .slice(0, 4);
  }, [currentPharmacyId, currentUser?.profile?.role, publishedPrescriptions]);
  const kpis: KPIShape =
    dashboard?.kpis && typeof dashboard.kpis === "object"
      ? {
        response_time_minutes:
          typeof dashboard.kpis.response_time_minutes === "number" ? dashboard.kpis.response_time_minutes : 0,
        resolution_rate:
          typeof dashboard.kpis.resolution_rate === "number" ? dashboard.kpis.resolution_rate : 0,
        satisfaction_score:
          typeof dashboard.kpis.satisfaction_score === "number" ? dashboard.kpis.satisfaction_score : 0,
        active_pharmacies:
          typeof dashboard.kpis.active_pharmacies === "number" ? dashboard.kpis.active_pharmacies : 0,
        live_prescriptions:
          typeof dashboard.kpis.live_prescriptions === "number" ? dashboard.kpis.live_prescriptions : 0,
        confirmed_quotes:
          typeof dashboard.kpis.confirmed_quotes === "number" ? dashboard.kpis.confirmed_quotes : 0,
      }
      : defaultKpis;

  const heroStats = [
    { label: copy.statTime, value: `${kpis.response_time_minutes} min` },
    { label: copy.statPharmacies, value: `${kpis.active_pharmacies}` },
    { label: copy.statSatisfaction, value: `${kpis.satisfaction_score}/5` },
  ];
  const supportPills = [
    copy.workflowSteps[0]?.title,
    copy.workflowSteps[1]?.title,
    copy.workflowSteps[2]?.title,
    t("nav.chat"),
    copy.navLogin,
    t("section.security"),
  ].filter(Boolean);
  const accountLabel = currentUser?.profile?.pharmacy_name || currentUser?.username || uiText.accountReady;
  const currentLanguageMeta = languageMeta[language];
  const notifications = dashboardNotifications;
  const unreadNotificationsCount = notifications.filter((item) => !item.is_read).length;
  const availableRecipientPharmacies = pharmacies.filter((item) => item.id !== currentPharmacyId);
  const canShowUploadAction = currentUser && currentUser.profile?.role === "patient";
  const canShowUploadActionForGuest = !currentUser;
  const shouldShowPublicUploadAction = Boolean(canShowUploadAction || canShowUploadActionForGuest);
  const pharmacyDirectory = new Map(pharmacies.map((item) => [item.id, item] as const));
  const conversationItems: PharmacyConversationItem[] =
    currentPharmacyId
      ? Array.from(
        new Set(
          [
            ...savedContactIds,
            ...pharmacyMessages.flatMap((item) => {
              if (item.sender_pharmacy === currentPharmacyId && item.pharmacy) {
                return [item.pharmacy];
              }
              if (item.pharmacy === currentPharmacyId && item.sender_pharmacy) {
                return [item.sender_pharmacy];
              }
              return [];
            }),
          ].filter((item) => item !== currentPharmacyId)
        )
      )
        .map((pharmacyId) => {
          const pharmacy = pharmacyDirectory.get(pharmacyId);
          if (!pharmacy) {
            return null;
          }

          const relatedMessages = pharmacyMessages.filter(
            (item) =>
              (item.sender_pharmacy === currentPharmacyId && item.pharmacy === pharmacyId) ||
              (item.pharmacy === currentPharmacyId && item.sender_pharmacy === pharmacyId)
          );
          const sortedMessages = [...relatedMessages].sort(
            (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
          );
          const lastMessage = sortedMessages.length ? sortedMessages[sortedMessages.length - 1] : null;
          const lastReadTime = lastReadMessageAt ? new Date(lastReadMessageAt).getTime() : 0;
          const unreadCount = sortedMessages.filter(
            (item) =>
              item.sender_pharmacy === pharmacyId &&
              new Date(item.created_at).getTime() > lastReadTime
          ).length;

          return {
            pharmacy,
            lastMessage,
            unreadCount,
            isSaved: savedContactIds.includes(pharmacyId),
          };
        })
        .filter((item): item is PharmacyConversationItem => Boolean(item))
        .sort((left, right) => {
          const leftTime = left.lastMessage ? new Date(left.lastMessage.created_at).getTime() : 0;
          const rightTime = right.lastMessage ? new Date(right.lastMessage.created_at).getTime() : 0;
          return rightTime - leftTime;
        })
      : [];
  const effectiveRecipientId = selectedConversationId || recipientPharmacyId;

  const activeConversation = effectiveRecipientId ? pharmacyDirectory.get(Number(effectiveRecipientId)) ?? null : null;
  const activeConversationMessages =
    currentPharmacyId && activeConversation
      ? pharmacyMessages
        .filter(
          (item) =>
            (item.sender_pharmacy === currentPharmacyId && item.pharmacy === activeConversation.id) ||
            (item.pharmacy === currentPharmacyId && item.sender_pharmacy === activeConversation.id)
        )
        .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
      : [];
  const unreadMessagesCount =
    currentPharmacyId
      ? pharmacyMessages.filter((item) => {
        const createdAtTime = new Date(item.created_at).getTime();
        const lastReadTime = lastReadMessageAt ? new Date(lastReadMessageAt).getTime() : 0;
        return item.sender_pharmacy !== currentPharmacyId && createdAtTime > lastReadTime;
      }).length
      : 0;

  useEffect(() => {
    if (!conversationItems.length) {
      return;
    }

    if (!effectiveRecipientId || !conversationItems.some((item) => String(item.pharmacy.id) === effectiveRecipientId)) {
      const nextConversationId = String(conversationItems[0].pharmacy.id);
      setSelectedConversationId(nextConversationId);
      setRecipientPharmacyId(nextConversationId);
    }
  }, [conversationItems, effectiveRecipientId]);

  useEffect(() => {
    if (!pharmacyInteractionError && !pharmacyInteractionSuccess) {
      return;
    }

    const timer = window.setTimeout(() => {
      setPharmacyInteractionError(null);
      setPharmacyInteractionSuccess(null);
    }, 2600);

    return () => window.clearTimeout(timer);
  }, [pharmacyInteractionError, pharmacyInteractionSuccess]);

  useEffect(() => {
    if (!authError && !authSuccess) {
      return;
    }

    const timer = window.setTimeout(() => {
      setAuthError(null);
      setAuthSuccess(null);
    }, 4200);

    return () => window.clearTimeout(timer);
  }, [authError, authSuccess]);

  useEffect(() => {
    if (!uploadSuccess) {
      return;
    }

    const timer = window.setTimeout(() => {
      setUploadSuccess(null);
      setActiveModal((current) => (current === "upload" ? null : current));
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [uploadSuccess]);

  useEffect(() => {
    if (!activeAnalysisTaskId) {
      return;
    }

    let cancelled = false;
    const pollTask = async () => {
      try {
        const result = await fetchPrescriptionAnalysisTask(activeAnalysisTaskId);
        if (cancelled) {
          return;
        }
        if (result.task_status === "completed" || result.task_status === "needs_confirmation" || result.task_status === "failed") {
          setCompletedTaskResult(result);
          setActiveAnalysisTaskId(null);
          if (result.record) {
            setDashboard((current) => mergePrescriptionRecords(current, result.record));
          }
          return;
        }
      } catch {
        if (!cancelled) {
          setUploadError("Le suivi de l'analyse a echoue temporairement. Veuillez verifier de nouveau dans quelques secondes.");
        }
      }
      if (!cancelled) {
        window.setTimeout(() => void pollTask(), 1000);
      }
    };

    void pollTask();
    return () => {
      cancelled = true;
    };
  }, [activeAnalysisTaskId]);

  useEffect(() => {
    if (!activeAnalysisTaskId) {
      return;
    }
    const timer = window.setInterval(() => {
      setAnalysisTick((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeAnalysisTaskId]);

  useEffect(() => {
    if (!completedTaskResult?.record) {
      return;
    }
    const remainingDelay = Math.max(0, (analysisRevealAt ?? Date.now()) - Date.now());
    const timer = window.setTimeout(() => {
      setPendingAnalysisRecord(completedTaskResult.record);
      setCompletedTaskResult(null);
    }, remainingDelay);
    return () => window.clearTimeout(timer);
  }, [completedTaskResult, analysisRevealAt]);

  useEffect(() => {
    if (!pendingAnalysisRecord?.bot_result) {
      return;
    }
    const timer = window.setTimeout(() => {
      setAnalysisPopupRecord(pendingAnalysisRecord);
      setPendingAnalysisRecord(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingAnalysisRecord]);

  if (error) {
    return <p className="empty-state">{error}</p>;
  }

  if (!config || !dashboard) {
    return <p className="empty-state">{t("common.loading")}</p>;
  }

  function markMessagesAsRead() {
    if (!currentUser?.profile?.pharmacy) {
      return;
    }

    const nextValue = new Date().toISOString();
    setLastReadMessageAt(nextValue);
    localStorage.setItem(`pharmigo.lastReadMessageAt.${currentUser.profile.pharmacy}`, nextValue);
  }

  function persistSavedContacts(nextContactIds: number[]) {
    setSavedContactIds(nextContactIds);
    if (!currentUser?.profile?.pharmacy) {
      return;
    }
    localStorage.setItem(`pharmigo.savedContacts.${currentUser.profile.pharmacy}`, JSON.stringify(nextContactIds));
  }

  function handleSaveContact() {
    if (!contactPickerId) {
      return;
    }

    const pharmacyId = Number(contactPickerId);
    if (!Number.isInteger(pharmacyId)) {
      return;
    }

    if (!savedContactIds.includes(pharmacyId)) {
      persistSavedContacts([...savedContactIds, pharmacyId]);
    }
    setSelectedConversationId(String(pharmacyId));
    setRecipientPharmacyId(String(pharmacyId));
    setMessageError(null);
    setMessageSuccess(null);
  }

  function handleSelectConversation(pharmacyId: number) {
    setSelectedConversationId(String(pharmacyId));
    setRecipientPharmacyId(String(pharmacyId));
    setMessageError(null);
    setMessageSuccess(null);
    markMessagesAsRead();
  }

  function openModal(modal: Exclude<ModalType, null>) {
    if (currentUser && (modal === "login" || modal === "register")) {
      setActiveModal("profile");
      setIsMenuOpen(false);
      setIsLanguageMenuOpen(false);
      setIsThemeMenuOpen(false);
      setIsNotificationMenuOpen(false);
      return;
    }

    setAuthError(null);
    setAuthSuccess(null);
    setAuthFieldErrors({});
    setUploadError(null);
    setUploadSuccess(null);
    setMessageError(null);
    setMessageSuccess(null);
    setMessageFieldErrors({});
    setActiveModal(modal);
    setIsMenuOpen(false);
    setIsLanguageMenuOpen(false);
    setIsThemeMenuOpen(false);
    setIsNotificationMenuOpen(false);
    if (modal === "messages") {
      markMessagesAsRead();
    }
  }

  function handleOpenUpload() {
    setUploadError(null);
    setUploadSuccess(null);

    if (!currentUser) {
      openModal("login");
      setAuthError("Connectez-vous d'abord comme patient pour publier une ordonnance.");
      return;
    }

    openModal("upload");
  }

  function cycleTheme() {
    const currentIndex = themeOptions.findIndex((option) => option.value === theme);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % themeOptions.length : 0;
    setTheme(themeOptions[nextIndex].value);
  }

  function persistCurrentUser(user: AuthUser | null, token?: string) {
    setCurrentUser(user);
    if (!user) {
      clearStoredAuthSession();
      return;
    }

    if (typeof token === "string" && token.trim()) {
      persistStoredAuthSession(user, token);
      return;
    }

    persistStoredCurrentUser(user);
  }

  function openDashboardForUser(user: AuthUser, token?: string) {
    setAuthBootstrapped(true);
    persistCurrentUser(user, token);
    setActiveModal("dashboard");
    navigate(getDashboardPathForUser(user), { replace: true });
  }

  async function handleLogout() {
    await Promise.allSettled([sendPresenceOffline(), logout()]);
    persistCurrentUser(null);
    setProfileError(null);
    setProfileSuccess(null);
    setProfileFieldErrors({});
    setAuthError(null);
    setAuthSuccess(null);
    setAuthFieldErrors({});
    setMessageError(null);
    setMessageSuccess(null);
    setMessageFieldErrors({});
    setIsMenuOpen(false);
    setIsLanguageMenuOpen(false);
    setIsThemeMenuOpen(false);
    setIsNotificationMenuOpen(false);
    setActiveModal(null);
    navigate("/", { replace: true });
  }

  function closeModal() {
    setAuthError(null);
    setAuthSuccess(null);
    setAuthFieldErrors({});
    setUploadError(null);
    setUploadSuccess(null);
    setMessageError(null);
    setMessageSuccess(null);
    setMessageFieldErrors({});
    setActiveModal(null);
    if (location.pathname.startsWith("/dashboard") || new URLSearchParams(location.search).get("modal") === "dashboard") {
      navigate("/", { replace: true });
    }
  }

  function updateNotifications(nextNotifications: DashboardData["notifications"]) {
    setDashboard((current) => (current ? { ...current, notifications: nextNotifications } : current));
  }

  function clearAuthFieldError(...fields: Array<keyof FormFieldErrors>) {
    setAuthFieldErrors((current) => {
      const next = { ...current };
      fields.forEach((field) => {
        delete next[field];
      });
      return next;
    });
  }

  async function handleNotificationRead(notificationId: number) {
    const target = notifications.find((item) => item.id === notificationId);
    if (!target || target.is_read) {
      return;
    }

    const updated = await markNotificationAsRead(notificationId);
    updateNotifications(notifications.map((item) => (item.id === notificationId ? updated : item)));
  }

  async function handleMarkAllNotificationsAsRead() {
    const previousNotifications = notifications;
    updateNotifications(notifications.map((item) => ({ ...item, is_read: true })));
    try {
      await markAllNotificationsAsRead();
    } catch {
      updateNotifications(previousNotifications);
    }
  }

  async function handleDeleteAllNotifications() {
    const previousNotifications = notifications;
    updateNotifications([]);
    try {
      await deleteAllNotifications();
    } catch {
      updateNotifications(previousNotifications);
    }
  }

  async function handleDeleteNotification(notificationId: number) {
    const previousNotifications = notifications;
    updateNotifications(notifications.filter((item) => item.id !== notificationId));
    try {
      await deleteNotification(notificationId);
    } catch {
      updateNotifications(previousNotifications);
    }
  }

  function switchModal(modal: Exclude<ModalType, null>) {
    setAuthError(null);
    setAuthSuccess(null);
    setAuthFieldErrors({});
    setActiveModal(modal);
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    setAuthFieldErrors({});
    const identifier = loginForm.phone_number.trim();
    const password = loginForm.password;
    const normalizedIdentifier = normalizeLoginIdentifier(identifier, loginForm.country_code);
    const identifierValidationError = validateLoginIdentifier(identifier, loginForm.country_code);

    if (identifierValidationError || !password.trim()) {
      setAuthError(uiText.authRequired);
      setAuthFieldErrors({
        ...(identifierValidationError ? { phone_number: identifierValidationError } : {}),
        ...(password.trim() ? {} : { password: "Le mot de passe est obligatoire." }),
      });
      if (identifierValidationError) {
        setAuthError(identifierValidationError);
      }
      return;
    }

    setAuthBusy(true);

    try {
      const result = await login({
        phone_number: normalizedIdentifier,
        password,
      });
      setAuthError(null);
      setAuthFieldErrors({});
      openDashboardForUser(result.user, result.token);
      setLoginForm((current) => ({ ...current, phone_number: "", password: "" }));
      setShowLoginPassword(false);
      setAuthSuccess(uiText.authLoginSuccess);
      void fetchDashboard().then((dashboardData) => setDashboard(dashboardData)).catch(() => undefined);
    } catch (error) {
      const parsedError = parseApiError(error, uiText.authRequired);
      setAuthError(parsedError.message);
      setAuthFieldErrors(parsedError.fieldErrors);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    setAuthFieldErrors({});
    const patientUsername = patientRegisterForm.username.trim();
    const patientPhone = patientRegisterForm.phone_number.trim();
    const patientEmail = patientRegisterForm.email.trim().toLowerCase();
    const patientPassword = patientRegisterForm.password;
    const pharmacyName = pharmacyRegisterForm.pharmacy_name.trim();
    const pharmacyPhone = pharmacyRegisterForm.phone_number.trim();
    const pharmacyEmail = pharmacyRegisterForm.email.trim().toLowerCase();
    const pharmacyAddress = pharmacyRegisterForm.address.trim();
    const pharmacyPassword = pharmacyRegisterForm.password;
    const patientFullPhone = buildPhoneNumber(patientRegisterForm.country_code, patientPhone);
    const pharmacyFullPhone = buildPhoneNumber(pharmacyRegisterForm.country_code, pharmacyPhone);
    const patientPhoneValidationError = validateInternationalPhoneNumber(patientFullPhone);
    const pharmacyPhoneValidationError = validateInternationalPhoneNumber(pharmacyFullPhone);

    if (accountType === "patient") {
      if (!patientUsername || !patientPhone || !patientPassword.trim()) {
        setAuthError(uiText.authRequired);
        setAuthFieldErrors({
          ...(patientUsername ? {} : { username: "Le nom d'utilisateur est obligatoire." }),
          ...(patientPhone ? {} : { phone_number: "Le numero de telephone est obligatoire." }),
          ...(patientPassword.trim() ? {} : { password: "Le mot de passe est obligatoire." }),
        });
        return;
      }

      if (patientPassword.trim().length < 6) {
        setAuthError(uiText.authPasswordMin);
        setAuthFieldErrors({ password: uiText.authPasswordMin });
        return;
      }

      if (patientPhoneValidationError) {
        setAuthError(patientPhoneValidationError);
        setAuthFieldErrors({ phone_number: patientPhoneValidationError });
        return;
      }
    } else {
      if (!pharmacyName || !pharmacyPhone || !pharmacyAddress || !pharmacyPassword.trim()) {
        setAuthError(uiText.authRequired);
        setAuthFieldErrors({
          ...(pharmacyName ? {} : { pharmacy_name: "Le nom de la pharmacie est obligatoire." }),
          ...(pharmacyPhone ? {} : { phone_number: "Le numero de telephone est obligatoire." }),
          ...(pharmacyAddress ? {} : { address: "L'adresse exacte est obligatoire." }),
          ...(pharmacyPassword.trim() ? {} : { password: "Le mot de passe est obligatoire." }),
        });
        return;
      }

      if (pharmacyPassword.trim().length < 6) {
        setAuthError(uiText.authPasswordMin);
        setAuthFieldErrors({ password: uiText.authPasswordMin });
        return;
      }

      if (pharmacyPhoneValidationError) {
        setAuthError(pharmacyPhoneValidationError);
        setAuthFieldErrors({ phone_number: pharmacyPhoneValidationError });
        return;
      }
    }

    setAuthBusy(true);

    try {
      if (accountType === "patient") {
        await register({
          account_type: "patient",
          username: patientUsername,
          phone_number: patientFullPhone,
          email: patientEmail,
          password: patientPassword,
        });
        const session = await login({ phone_number: patientFullPhone, password: patientPassword });
        setAuthError(null);
        setAuthFieldErrors({});
        openDashboardForUser(session.user, session.token);
        void fetchDashboard().then((dashboardData) => setDashboard(dashboardData)).catch(() => undefined);
        setPatientRegisterForm({ username: "", phone_number: "", email: "", password: "", country_code: patientRegisterForm.country_code });
        setShowPatientRegisterPassword(false);
        setAuthSuccess(`${uiText.authRegisterSuccessPatient} ${uiText.authLoginSuccess}`);
        return;
      }

      await register({
        account_type: "pharmacy",
        pharmacy_name: pharmacyName,
        phone_number: pharmacyFullPhone,
        email: pharmacyEmail,
        address: pharmacyAddress,
        password: pharmacyPassword,
        pharmacy_image: pharmacyRegisterForm.pharmacy_image,
      });
      const session = await login({ phone_number: pharmacyFullPhone, password: pharmacyPassword });
      setAuthError(null);
      setAuthFieldErrors({});
      openDashboardForUser(session.user, session.token);
      void fetchDashboard().then((dashboardData) => setDashboard(dashboardData)).catch(() => undefined);
      setPharmacyRegisterForm({
        pharmacy_name: "",
        phone_number: "",
        email: "",
        address: "",
        password: "",
        pharmacy_image: null,
        country_code: pharmacyRegisterForm.country_code,
      });
      setShowPharmacyRegisterPassword(false);
      setAuthSuccess(`${uiText.authRegisterSuccessPharmacy} ${uiText.authLoginSuccess}`);
    } catch (error) {
      const parsedError = parseApiError(error, uiText.authRequired);
      setAuthError(parsedError.message);
      setAuthFieldErrors(parsedError.fieldErrors);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) {
      return;
    }

    setProfileBusy(true);
    setProfileError(null);
    setProfileSuccess(null);
    setProfileFieldErrors({});

    try {
      const updated =
        currentUser.is_staff || currentUser.profile?.role === "admin"
          ? await updateAdminProfile({
            username: adminProfileForm.username.trim(),
            email: adminProfileForm.email.trim(),
            profile_image: adminProfileForm.profile_image,
          })
          : currentUser.profile?.role === "patient"
          ? await updatePatientProfile({
            username: profileForm.username.trim(),
            phone_number: buildPhoneNumber(profileForm.country_code, profileForm.phone_number.trim()),
            email: profileForm.email.trim().toLowerCase(),
          })
          : await updatePharmacyProfile({
            pharmacy_name: pharmacyProfileForm.pharmacy_name.trim(),
            address: pharmacyProfileForm.address.trim(),
            city: pharmacyProfileForm.city.trim(),
            phone_number: buildPhoneNumber(pharmacyProfileForm.country_code, pharmacyProfileForm.phone_number.trim()),
            email: pharmacyProfileForm.email.trim(),
            opening_hours: pharmacyProfileForm.opening_hours.trim(),
            delivery_supported: pharmacyProfileForm.delivery_supported,
            pharmacy_image: pharmacyProfileForm.pharmacy_image,
          });
      persistCurrentUser(updated);
      const patientPhone = splitPhoneNumber(updated.profile?.phone_number);
      const pharmacyPhone = splitPhoneNumber(updated.profile?.pharmacy_phone_number);
      setProfileForm({
        username: updated.username ?? "",
        phone_number: patientPhone.localNumber,
        email: updated.email ?? "",
        country_code: patientPhone.countryCode,
      });
      setAdminProfileForm({
        username: updated.username ?? "",
        email: updated.email ?? "",
        profile_image: null,
      });
      setPharmacyProfileForm((current) => ({
        ...current,
        pharmacy_name: updated.profile?.pharmacy_name ?? current.pharmacy_name,
        address: updated.profile?.address ?? current.address,
        city: updated.profile?.pharmacy_city ?? current.city,
        phone_number: pharmacyPhone.localNumber,
        email: updated.profile?.pharmacy_email ?? current.email,
        opening_hours: updated.profile?.pharmacy_opening_hours ?? current.opening_hours,
        delivery_supported: Boolean(updated.profile?.pharmacy_delivery_supported),
        pharmacy_image: null,
        country_code: pharmacyPhone.countryCode,
      }));
      setProfileSuccess("Profil mis a jour.");
    } catch (error) {
      const parsedError = parseApiError(error, "Impossible de mettre le profil a jour.");
      setProfileError(parsedError.message);
      setProfileFieldErrors(parsedError.fieldErrors);
    } finally {
      setProfileBusy(false);
    }
  }

  async function handlePharmacyMessageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessageSuccess(null);
    const destinationId = effectiveRecipientId;
    if (!destinationId || !messageBody.trim()) {
      setMessageError("Choisissez une pharmacie et ecrivez un message.");
      setMessageFieldErrors({
        ...(destinationId ? {} : { pharmacy: "Selectionnez une pharmacie destinataire." }),
        ...(messageBody.trim() ? {} : { message: "Le message est obligatoire." }),
      });
      return;
    }

    setMessageBusy(true);
    setMessageError(null);
    setMessageSuccess(null);
    setMessageFieldErrors({});
    try {
      const created = await postMessage({
        sender_name: currentUser?.profile?.pharmacy_name || currentUser?.username || "Pharmacie",
        sender_role: "pharmacy",
        message: messageBody.trim(),
        pharmacy: Number(destinationId),
      });
      setPharmacyMessages((current) => [...current, created]);
      setMessageBody("");
      setRecipientPharmacyId(String(destinationId));
      setSelectedConversationId(String(destinationId));
      setMessageError(null);
      setMessageFieldErrors({});
      setMessageSuccess("Message envoye avec succes.");
      void fetchMessages().then((items) => setPharmacyMessages(items)).catch(() => undefined);
      void fetchDashboard().then((dashboardData) => setDashboard(dashboardData)).catch(() => undefined);
    } catch (error) {
      const parsedError = parseApiError(error, "Impossible d'envoyer le message.");
      setMessageError(parsedError.message);
      setMessageFieldErrors(parsedError.fieldErrors);
    } finally {
      setMessageBusy(false);
    }
  }

  function handleOpenPrescriptionComments(prescriptionId: number) {
    if (!currentUser) {
      openModal("login");
      setAuthError("Veuillez vous connecter ou créer un compte pour interagir.");
      return;
    }

    setOpenCommentPanels((current) => ({
      ...current,
      [prescriptionId]: !current[prescriptionId],
    }));

    window.requestAnimationFrame(() => {
      const target = document.getElementById(`prescription-comments-${prescriptionId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function handlePrescriptionCommentSubmit(event: FormEvent<HTMLFormElement>, prescriptionId: number) {
    event.preventDefault();
    if (!currentUser) {
      openModal("login");
      setAuthError("Veuillez vous connecter ou créer un compte pour interagir.");
      return;
    }

    const draft = commentDrafts[prescriptionId];
    const body = draft?.body?.trim() ?? "";
    if (!body) {
      setResponseError(feedText.commentRequired);
      return;
    }

    try {
      setCommentBusyId(prescriptionId);
      setResponseError(null);
      setResponseSuccess(null);
      const updatedPrescription = await postPrescriptionComment(prescriptionId, body);
      setDashboard((current) => mergePrescriptionRecords(current, updatedPrescription));
      setCommentDrafts((current) => ({
        ...current,
        [prescriptionId]: { body: "" },
      }));
      setOpenCommentPanels((current) => ({
        ...current,
        [prescriptionId]: true,
      }));
      setResponseSuccess(feedText.commentAdded);
    } catch (error) {
      const parsedError = parseApiError(error, feedText.commentAddFailed);
      setResponseError(translateBackendMessage(parsedError.message));
    } finally {
      setCommentBusyId(null);
    }
  }

  async function handlePrescriptionEngagement(prescription: PrescriptionRecord, action: "like" | "share") {
    if (!currentUser) {
      openModal("login");
      setAuthError("Veuillez vous connecter ou créer un compte pour interagir.");
      return;
    }

    try {
      setResponseError(null);
      const updatedPrescription = await updatePrescriptionEngagement(prescription.id, action);
      setDashboard((current) => mergePrescriptionRecords(current, updatedPrescription));

      if (action === "share") {
        const shareUrl = `${window.location.origin}/?prescription=${prescription.id}`;

        setShareMenu({
          kind: "prescription",
          id: prescription.id,
          title: updatedPrescription.medication_name || "Ordonnance",
          text: `Ordonnance ${updatedPrescription.public_reference || `ORD-${String(prescription.id).padStart(6, "0")}`} partagee sur PharmiGo.`,
          url: shareUrl,
        });
        setResponseSuccess(feedText.shared);
        return;
      }

      setResponseSuccess(updatedPrescription.viewer_has_liked ? feedText.liked : feedText.unliked);
    } catch (error) {
      const parsedError = parseApiError(error, feedText.engagementFailed);
      setResponseError(translateBackendMessage(parsedError.message));
    }
  }

  function handleOpenPharmacyComments(pharmacyId: number) {
    if (!currentUser) {
      openModal("login");
      setAuthError("Veuillez vous connecter ou créer un compte pour interagir.");
      return;
    }

    setExpandedPharmacyComments((current) => ({
      ...current,
      [pharmacyId]: !current[pharmacyId],
    }));
  }

  async function handlePharmacyCommentSubmit(event: FormEvent<HTMLFormElement>, pharmacyId: number) {
    event.preventDefault();
    if (!currentUser) {
      openModal("login");
      setAuthError("Veuillez vous connecter ou créer un compte pour interagir.");
      return;
    }

    const draft = pharmacyCommentDrafts[pharmacyId];
    const body = draft?.body?.trim() ?? "";
    if (!body) {
      setPharmacyInteractionError(feedText.commentRequired);
      return;
    }

    try {
      setPharmacyCommentBusyId(pharmacyId);
      setPharmacyInteractionError(null);
      setPharmacyInteractionSuccess(null);
      const updatedPharmacy = await postPharmacyComment(pharmacyId, body);
      setDashboard((current) =>
        current
          ? {
            ...current,
            pharmacies: (current.pharmacies ?? []).map((item) => (item.id === pharmacyId ? updatedPharmacy : item)),
          }
          : current
      );
      setPharmacyCommentDrafts((current) => ({
        ...current,
        [pharmacyId]: { body: "" },
      }));
      setExpandedPharmacyComments((current) => ({
        ...current,
        [pharmacyId]: true,
      }));
      setPharmacyInteractionSuccess(feedText.pharmacyCommentAdded);
    } catch (error) {
      const parsedError = parseApiError(error, feedText.pharmacyCommentFailed);
      setPharmacyInteractionError(translateBackendMessage(parsedError.message));
    } finally {
      setPharmacyCommentBusyId(null);
    }
  }

  async function handlePharmacyEngagement(pharmacy: Pharmacy, action: "like" | "share") {
    if (!currentUser) {
      openModal("login");
      setAuthError("Veuillez vous connecter ou créer un compte pour interagir.");
      return;
    }

    try {
      setPharmacyInteractionError(null);
      setPharmacyInteractionSuccess(null);
      const updatedPharmacy = await updatePharmacyEngagement(pharmacy.id, action);
      setDashboard((current) =>
        current
          ? {
            ...current,
            pharmacies: (current.pharmacies ?? []).map((item) => (item.id === pharmacy.id ? updatedPharmacy : item)),
          }
          : current
      );

      if (action === "share") {
        const shareUrl = `${window.location.origin}/pharmacy/${pharmacy.id}`;
        setShareMenu({
          kind: "pharmacy",
          id: pharmacy.id,
          title: pharmacy.name,
          text: `${pharmacy.name} sur PharmiGo`,
          url: shareUrl,
        });
        setPharmacyInteractionSuccess(feedText.pharmacyShared);
        return;
      }

      setPharmacyInteractionSuccess(updatedPharmacy.viewer_has_liked ? feedText.pharmacyLiked : feedText.pharmacyUnliked);
    } catch (error) {
      const parsedError = parseApiError(error, feedText.pharmacyActionFailed);
      setPharmacyInteractionError(translateBackendMessage(parsedError.message));
    }
  }

  async function handleShareChannel(channel: ShareChannel) {
    if (!shareMenu) {
      return;
    }

    const encodedUrl = encodeURIComponent(shareMenu.url);
    const encodedText = encodeURIComponent(`${shareMenu.text} ${shareMenu.url}`);

    try {
      if (channel === "copy") {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareMenu.url);
        }
      } else if (channel === "instagram") {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(`${shareMenu.text} ${shareMenu.url}`);
        }
        window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
      } else if (channel === "platform") {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareMenu.url);
        }
        window.location.hash = shareMenu.kind === "pharmacy" ? `pharmacy-${shareMenu.id}` : `prescription-${shareMenu.id}`;
      } else {
        const shareUrls: Record<Exclude<ShareChannel, "instagram" | "copy" | "platform">, string> = {
          whatsapp: `https://wa.me/?text=${encodedText}`,
          facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
          telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
          tiktok: `https://www.tiktok.com/upload?url=${encodedUrl}`,
        };
        window.open(shareUrls[channel as Exclude<ShareChannel, "instagram" | "copy" | "platform">], "_blank", "noopener,noreferrer");
      }

      if (shareMenu.kind === "pharmacy") {
        setPharmacyInteractionSuccess(channel === "platform" ? localizedUi.shareRepublished : localizedUi.shareStarted);
      } else {
        setResponseSuccess(channel === "platform" ? localizedUi.shareRepublished : localizedUi.shareStarted);
      }
    } catch (error) {
      void error;
      logClientError("Le partage du contenu a echoue.");
      if (shareMenu.kind === "pharmacy") {
        setPharmacyInteractionError(localizedUi.shareFailedPharmacy);
      } else {
        setResponseError(localizedUi.shareFailedPrescription);
      }
    } finally {
      setShareMenu(null);
    }
  }

  function renderInteractivePrescriptionSheet(
    prescription: PrescriptionRecord,
    options?: {
      compact?: boolean;
      showProfileHeader?: boolean;
    }
  ) {
    const commentDraft = commentDrafts[prescription.id] ?? { body: "" };
    const socialComments: PrescriptionComment[] = Array.isArray(prescription.comments) ? prescription.comments : [];
    const visibleComments = expandedCommentThreads[prescription.id] ? socialComments : socialComments.slice(0, 2);
    const cardClassName = options?.compact ? "public-prescription-sheet interactive compact" : "public-prescription-sheet interactive";

    return (
      <div key={prescription.id} className="interactive-prescription-sheet-card" id={`prescription-${prescription.id}`}>
        <PublicPrescriptionSheet
          prescription={prescription}
          title={prescription.medication_name || "Ordonnance confirmee"}
          className={cardClassName}
          footer={
            <>
              <div className="prescription-social-actions sheet-actions">
                <button
                  type="button"
                  className={prescription.viewer_has_liked ? "prescription-action-button active" : "prescription-action-button"}
                  onClick={() => void handlePrescriptionEngagement(prescription, "like")}
                >
                  <LikeIcon />
                  <span>{feedText.like}</span>
                  <strong>{prescription.like_count ?? 0}</strong>
                </button>
                <button
                  type="button"
                  className={openCommentPanels[prescription.id] ? "prescription-action-button active" : "prescription-action-button"}
                  onClick={() => handleOpenPrescriptionComments(prescription.id)}
                >
                  <CommentIcon />
                  <span>{feedText.comment}</span>
                  <strong>{prescription.comment_count ?? socialComments.length}</strong>
                </button>
                <button
                  type="button"
                  className={prescription.viewer_has_shared ? "prescription-action-button active" : "prescription-action-button"}
                  onClick={() => void handlePrescriptionEngagement(prescription, "share")}
                >
                  <ShareIcon />
                  <span>{feedText.share}</span>
                  <strong>{prescription.share_count ?? 0}</strong>
                </button>
              </div>

              {openCommentPanels[prescription.id] ? (
                <div className="prescription-comments-panel sheet-comments" id={`prescription-comments-${prescription.id}`}>
                  <div className="prescription-comments-head">
                    <strong>{feedText.commentsTitle}</strong>
                    {socialComments.length > 2 ? (
                      <button
                        type="button"
                        className="inline-text-button"
                        onClick={() =>
                          setExpandedCommentThreads((current) => ({
                            ...current,
                            [prescription.id]: !current[prescription.id],
                          }))
                        }
                      >
                        {expandedCommentThreads[prescription.id] ? feedText.collapse : feedText.readAll}
                      </button>
                    ) : null}
                  </div>
                  {socialComments.length ? (
                    <div className="prescription-response-stream">
                      {visibleComments.map((comment) => (
                        <article key={comment.id} className="prescription-response-item social-comment-item">
                          <div>
                            <strong>{comment.author_name}</strong>
                            <p>{comment.body}</p>
                          </div>
                          <small>{new Date(comment.created_at).toLocaleString()}</small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="prescription-live-note">
                      <span>{feedText.noComments}</span>
                    </div>
                  )}
                  {currentUser ? (
                    <form className="prescription-comment-form" onSubmit={(event) => void handlePrescriptionCommentSubmit(event, prescription.id)}>
                      <label>
                        <span>{feedText.addComment}</span>
                        <textarea
                          rows={3}
                          value={commentDraft.body}
                          onChange={(event) =>
                            setCommentDrafts((current) => ({
                              ...current,
                              [prescription.id]: { body: event.target.value },
                            }))
                          }
                          placeholder={feedText.commentPlaceholder}
                        />
                      </label>
                      <button type="submit" className="pharmigo-secondary-btn" disabled={commentBusyId === prescription.id}>
                        {commentBusyId === prescription.id ? feedText.commentSending : feedText.submitComment}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="pharmigo-homepage landing-page">
      <header className="landing-nav-shell">
        <div className="landing-nav">
          <a href="#hero" className="landing-brand" onClick={() => setIsMenuOpen(false)}>
            <img src="/pharmigo-logo.png" alt="PharmiGo" className="pharmigo-brand-image" />
            <div className="landing-brand-copy">
              <strong>{productName}</strong>
              <span>{t("brand.tagline")}</span>
            </div>
          </a>

          <nav className="landing-nav-links" aria-label="Navigation principale">
            {navigationItems.map((item) => (
              <a key={item.href} href={item.href} className="landing-nav-link">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="landing-nav-actions">
            <div className="landing-utility-menu">
              <button
                type="button"
                className="landing-icon-trigger landing-language-trigger nav-desktop-only"
                onClick={() => {
                  setIsLanguageMenuOpen((current) => !current);
                  setIsThemeMenuOpen(false);
                  setIsNotificationMenuOpen(false);
                }}
                aria-expanded={isLanguageMenuOpen}
                aria-label="Choisir la langue"
              >
                <GlobeIcon />
                <span className="landing-language-label">{currentLanguageMeta.label}</span>
              </button>
              {isLanguageMenuOpen ? (
                <div className="landing-popover-menu language-menu">
                  {languageOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={language === option.value ? "landing-popover-item active" : "landing-popover-item"}
                      onClick={() => {
                        setLanguage(option.value);
                        setIsLanguageMenuOpen(false);
                      }}
                    >
                      <span>{languageMeta[option.value].flag}</span>
                      <span>{languageMeta[option.value].label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="landing-utility-menu">
              <button
                type="button"
                className="landing-icon-trigger nav-desktop-only"
                onClick={() => {
                  setIsThemeMenuOpen((current) => !current);
                  setIsLanguageMenuOpen(false);
                  setIsNotificationMenuOpen(false);
                }}
                aria-expanded={isThemeMenuOpen}
                aria-label="Changer le theme"
              >
                <ThemeIcon theme={theme} />
                <span>{t(`theme.${theme}`)}</span>
              </button>
              {isThemeMenuOpen ? (
                <div className="landing-popover-menu">
                  {themeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={theme === option.value ? "landing-popover-item active" : "landing-popover-item"}
                      onClick={() => {
                        setTheme(option.value);
                        setIsThemeMenuOpen(false);
                      }}
                    >
                      <span>{t(`theme.${option.value}`)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {currentUser ? (
              <>
                {currentUser.profile?.role === "pharmacy" ? (
                  <button
                    type="button"
                    className="landing-icon-trigger nav-desktop-only"
                    onClick={() => openModal("messages")}
                    aria-label="Messagerie pharmacies"
                  >
                    <MessageIcon />
                    <span>{chromeText.messages}</span>
                    {unreadMessagesCount ? <span className="landing-notification-count message-count-badge">{unreadMessagesCount}</span> : null}
                  </button>
                ) : null}
                <div className="landing-utility-menu">
                  <button
                    type="button"
                    className="landing-icon-trigger notification-trigger"
                    onClick={() => {
                      setIsNotificationMenuOpen((current) => !current);
                      setIsLanguageMenuOpen(false);
                      setIsThemeMenuOpen(false);
                    }}
                    aria-expanded={isNotificationMenuOpen}
                    aria-label="Notifications"
                  >
                    <BellIcon />
                    {unreadNotificationsCount ? <span className="landing-notification-count">{unreadNotificationsCount}</span> : null}
                  </button>
                  {isNotificationMenuOpen ? (
                    <div className="landing-popover-menu notification-menu">
                      <div className="notification-menu-head">
                        <strong>{chromeText.notifications}</strong>
                        <div className="notification-menu-actions">
                          <button type="button" className="notification-menu-button" onClick={() => void handleMarkAllNotificationsAsRead()}>
                            {feedText.readAll}
                          </button>
                          <button type="button" className="notification-menu-button" onClick={() => void handleDeleteAllNotifications()}>
                            {language === "en" ? "Delete all" : language === "rn" ? "Siba vyose" : language === "sw" ? "Futa zote" : language === "ln" ? "Boma nyonso" : "Supprimer tout"}
                          </button>
                        </div>
                      </div>
                      {notifications.length ? (
                        notifications.map((item) => (
                          <article key={item.id} className={item.is_read ? "landing-notification-item read" : "landing-notification-item unread"}>
                            <button type="button" className="landing-notification-body" onClick={() => void handleNotificationRead(item.id)}>
                              <strong>{translateNotificationTitle(item.title)}</strong>
                              <p>{translateNotificationMessage(item.message)}</p>
                              <small>{new Date(item.created_at).toLocaleString()}</small>
                            </button>
                            <div className="landing-notification-tools">
                              {!item.is_read ? (
                                <button type="button" className="notification-inline-action" onClick={() => void handleNotificationRead(item.id)}>
                                  {chromeText.markRead}
                                </button>
                              ) : null}
                              <button type="button" className="notification-inline-action danger" onClick={() => void handleDeleteNotification(item.id)}>
                                {chromeText.delete}
                              </button>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="landing-notification-empty">{chromeText.noNotifications}</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <button type="button" className="landing-account-chip" onClick={() => openModal("dashboard")}>
                  {accountLabel}
                </button>
                <button type="button" className="landing-logout-button" onClick={handleLogout}>
                  Deconnexion
                </button>
              </>
            ) : (
              <button type="button" className="landing-signin-button" onClick={() => openModal("login")}>
                {copy.navLogin}
              </button>
            )}

            <button
              type="button"
              className="landing-menu-button"
              aria-expanded={isMenuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setIsMenuOpen((current) => !current)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>

        <div className={isMenuOpen ? "landing-mobile-panel open" : "landing-mobile-panel"} id="mobile-navigation">
          <div className="landing-mobile-utility-row">
            <button
              type="button"
              className="landing-mobile-link as-button mobile-icon-link"
              onClick={() => {
                setLanguage(languageOptions[(languageOptions.findIndex((option) => option.value === language) + 1) % languageOptions.length].value);
                setIsMenuOpen(false);
              }}
            >
              <GlobeIcon />
              <span>{currentLanguageMeta.label}</span>
            </button>
            <button
              type="button"
              className="landing-mobile-link as-button mobile-icon-link"
              onClick={() => {
                cycleTheme();
                setIsMenuOpen(false);
              }}
            >
              <ThemeIcon theme={theme} />
              <span>{t(`theme.${theme}`)}</span>
            </button>
          </div>
          {navigationItems.map((item) => (
            <a key={item.href} href={item.href} className="landing-mobile-link" onClick={() => setIsMenuOpen(false)}>
              {item.label}
            </a>
          ))}
          {!currentUser ? (
            <>
              <button type="button" className="landing-mobile-link as-button" onClick={() => openModal("login")}>
                {copy.navLogin}
              </button>
              <button type="button" className="landing-mobile-link as-button" onClick={() => openModal("register")}>
                {copy.navRegister}
              </button>
            </>
          ) : null}
          {currentUser?.profile?.role === "pharmacy" ? (
            <button type="button" className="landing-mobile-link as-button mobile-message-link" onClick={() => openModal("messages")}>
              <span className="mobile-link-inline-icon"><MessageIcon /></span>
              <span>{chromeText.messages}</span>
              {unreadMessagesCount ? <span className="landing-notification-count message-count-badge">{unreadMessagesCount}</span> : null}
            </button>
          ) : null}
          {currentUser ? (
            <>
              <button type="button" className="landing-mobile-link as-button" onClick={() => openModal("dashboard")}>
                {accountLabel}
              </button>
              <button type="button" className="landing-mobile-link as-button" onClick={handleLogout}>
                Deconnexion
              </button>
            </>
          ) : null}
        </div>
      </header>

      <section className="landing-hero designed-hero" id="hero">
        <div className="hero-story-panel">
          <span className="landing-section-kicker">{copy.heroKicker}</span>
          <div className="hero-wordmark-block">
            <h1 className="hero-brand-display">{productName}</h1>
            <p className="hero-editorial-title">{copy.heroTitle}</p>
          </div>

          <p className="hero-editorial-body">
            {copy.heroBody} {productCountries.join(" | ") || "RDC | Burundi"}.
          </p>

          <div className="landing-hero-actions hero-cta-row">
            {shouldShowPublicUploadAction ? (
              <button type="button" className="pharmigo-primary-btn" onClick={handleOpenUpload}>
                {copy.heroPrimary}
              </button>
            ) : null}
            <button
              onClick={() => setShowPharmiGoModal(true)}
              className="pharmigo-secondary-btn"
            >
              {copy.heroSecondary}
            </button>
          </div>

          <div className="hero-mini-stats hero-mini-stats-desktop">
            {heroStats.map((item) => (
              <div key={item.label} className="hero-mini-stat">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="hero-visual-column">
        <div className="hero-medicine-stage" aria-hidden="true">
          <img src="/pharmigo-logo.png" alt="" className="hero-logo-watermark" />
            <div className="hero-medicine-glow" />
            <div className="hero-medicine-photo photo-table">
              <img src="/hero-medicines/medicines-table.png" alt="" />
            </div>
            <div className="hero-medicine-photo photo-pillbox">
              <img src="/hero-medicines/pillbox.png" alt="" />
            </div>
            <div className="hero-medicine-photo photo-repargut">
              <img src="/hero-medicines/repargut.png" alt="" />
            </div>
            <div className="hero-blister-pack">
              {Array.from({ length: 12 }).map((_, index) => (
                <span key={index} />
              ))}
            </div>
            <div className="hero-blister-pack secondary">
              {Array.from({ length: 10 }).map((_, index) => (
                <span key={index} />
              ))}
            </div>
          </div>

          <div className="landing-hero-actions hero-cta-row hero-cta-row-mobile">
            {shouldShowPublicUploadAction ? (
              <button type="button" className="pharmigo-primary-btn" onClick={handleOpenUpload}>
                {copy.heroPrimary}
              </button>
            ) : null}
            <button type="button" className="pharmigo-secondary-btn" onClick={() => setShowPharmiGoModal(true)}>
              {copy.heroSecondary}
            </button>
          </div>

          <div className="hero-benefits-stack">
            {copy.highlights.map((item) => (
              <article key={item.title} className="hero-benefit-card">
                <div className="hero-benefit-icon">{item.icon}</div>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="hero-mini-stats hero-mini-stats-mobile">
            {heroStats.map((item) => (
              <div key={`${item.label}-mobile`} className="hero-mini-stat">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-network-grid" id="pharmacies">
        <div className="landing-network-main">
          <div className="landing-section-heading compact with-search">
            <div className="landing-section-heading-copy">
              <span className="landing-section-kicker">{t("nav.search")}</span>
              <h2>{feedText.pharmacySectionTitle}</h2>
              <p>{feedText.pharmacySectionBody}</p>
            </div>
            <div className="landing-directory-search-card">
              <label className="landing-directory-search-label" htmlFor="landing-directory-search">
                <span>{t("nav.search")}</span>
                <input
                  id="landing-directory-search"
                  type="search"
                  value={directorySearchTerm}
                  onChange={(event) => setDirectorySearchTerm(event.target.value)}
                  placeholder={feedText.directorySearchPlaceholder}
                />
              </label>
              <p>{feedText.directorySearchHint}</p>
            </div>
          </div>

          {filteredPharmacies.length ? (
            <div className="pharmacy-showcase-list">
              {filteredPharmacies.map((pharmacy) => {
                const pharmacyImage = resolveMediaUrl(pharmacy.profile_image);
                const hasVisibleImage = Boolean(pharmacyImage) && !brokenPharmacyImages[pharmacy.id];
                const pharmacyImageSrc = hasVisibleImage && pharmacyImage ? pharmacyImage : undefined;
                const operationalStatus = getPharmacyOperationalStatus(pharmacy, language);
                const subscriptionStatus = getPharmacySubscriptionStatus(pharmacy, language);

                return (
                  <article key={pharmacy.id} className="pharmacy-showcase-card landing-panel-card" id={`pharmacy-${pharmacy.id}`}>
                    <div className="pharmacy-showcase-shell">
                      <button
                        type="button"
                        className="pharmacy-showcase-media"
                        onClick={() => {
                          if (pharmacyImageSrc) {
                            setActivePrescriptionPreview({ src: pharmacyImageSrc, alt: pharmacy.name });
                          }
                        }}
                        aria-label={pharmacyImageSrc ? `Agrandir l'image de ${pharmacy.name}` : `Profil de ${pharmacy.name}`}
                      >
                        {pharmacyImageSrc ? (
                          <div className="presence-avatar-wrap">
                            <img
                              src={pharmacyImageSrc}
                              alt={pharmacy.name}
                              className="pharmacy-showcase-image"
                              loading="lazy"
                              onError={(event) => {
                                setBrokenPharmacyImages((current) => ({ ...current, [pharmacy.id]: true }));
                                event.currentTarget.style.display = "none";
                              }}
                            />
                            <span className={pharmacy.is_online ? "presence-dot online" : "presence-dot"} />
                          </div>
                        ) : (
                          <div className="presence-avatar-wrap">
                            <div className="pharmacy-showcase-placeholder" aria-hidden="true">
                              <span>{(pharmacy.name || "P").slice(0, 1).toUpperCase()}</span>
                            </div>
                            <span className={pharmacy.is_online ? "presence-dot online" : "presence-dot"} />
                          </div>
                        )}
                      </button>

                      <div className="pharmacy-showcase-body">
                        <div className="pharmacy-showcase-head">
                          <div className="pharmacy-showcase-title-wrap">
                            <h3 className="pharmacy-display-name pharmacy-name-row">
                              {pharmacy.name}
                              {pharmacy.is_official || pharmacy.subscription_status === "active" ? (
                                <span className="verified-badge">Verified</span>
                              ) : null}
                            </h3>
                            <div className="pharmacy-showcase-inline-meta">
                              <span>{pharmacy.city || feedText.pharmacyUnavailableLocation}</span>
                              <span>{pharmacy.phone_number || feedText.phoneMissing}</span>
                              {typeof pharmacy.distance_km === "number" && pharmacy.distance_km > 0 ? (
                                <span>{pharmacy.distance_km.toFixed(1)} km</span>
                              ) : null}
                            </div>
                            <p>{pharmacy.address || feedText.pharmacyUnavailableLocation}</p>
                          </div>

                          <div className="pharmacy-showcase-side">
                            <div className="pharmacy-showcase-statuses">
                              <span className={`pharmacy-status-pill ${operationalStatus.className}`}>{operationalStatus.label}</span>
                              <span className={pharmacy.is_open ? "pharmacy-status-pill open" : "pharmacy-status-pill neutral"}>
                                {pharmacy.is_open ? feedText.pharmacyOpen : feedText.pharmacyOffline}
                              </span>
                              <span className={`pharmacy-status-pill ${subscriptionStatus.className}`}>{subscriptionStatus.label}</span>
                              {subscriptionStatus.detail ? <span className="pharmacy-status-pill subtle">{subscriptionStatus.detail}</span> : null}
                            </div>
                            <button
                              type="button"
                              className="pharmacy-info-button"
                              onClick={() => {
                                if (pharmacyImageSrc) {
                                  setActivePrescriptionPreview({ src: pharmacyImageSrc, alt: pharmacy.name });
                                }
                              }}
                              aria-label={`Agrandir le profil de ${pharmacy.name}`}
                            >
                              i
                            </button>
                          </div>
                        </div>

                        <div className="pharmacy-showcase-meta structured">
                          <div className="pharmacy-meta-card">
                            <span className="pharmacy-meta-label">Email</span>
                            <span className="pharmacy-meta-line">{pharmacy.email || localizedUi.emailMissing}</span>
                          </div>
                          <div className="pharmacy-meta-card">
                            <span className="pharmacy-meta-label">Horaires</span>
                            <span className="pharmacy-meta-line">{pharmacy.opening_hours || feedText.openingMissing}</span>
                          </div>
                        </div>

                        <div className="pharmacy-showcase-tags">
                          <span className="pharmacy-showcase-tag">
                            {pharmacy.delivery_supported || pharmacy.delivery_available ? feedText.deliveryAvailable : feedText.pickupOnsite}
                          </span>
                          <span className="pharmacy-showcase-tag subtle">
                            {pharmacy.response_count ?? 0} {feedText.servedCount}
                          </span>
                          {pharmacy.response_time_minutes ? (
                            <span className="pharmacy-showcase-tag subtle">
                              {feedText.responseAverage} {pharmacy.response_time_minutes} min
                            </span>
                          ) : null}
                          <span className="pharmacy-showcase-tag subtle">
                            {feedText.registeredAt} {formatExactDateTime(pharmacy.created_at, language)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="prescription-social-actions pharmacy-social-actions">
                      <button
                        type="button"
                        className={pharmacy.viewer_has_liked ? "prescription-action-button active" : "prescription-action-button"}
                        onClick={() => void handlePharmacyEngagement(pharmacy, "like")}
                      >
                        <LikeIcon />
                        <span>{feedText.like}</span>
                        <strong>{pharmacy.like_count ?? 0}</strong>
                      </button>
                      <button
                        type="button"
                        className={expandedPharmacyComments[pharmacy.id] ? "prescription-action-button active" : "prescription-action-button"}
                        onClick={() => handleOpenPharmacyComments(pharmacy.id)}
                      >
                        <CommentIcon />
                        <span>{feedText.comment}</span>
                        <strong>{pharmacy.comment_count ?? pharmacy.comments?.length ?? 0}</strong>
                      </button>
                      <button
                        type="button"
                        className={pharmacy.viewer_has_shared ? "prescription-action-button active" : "prescription-action-button"}
                        onClick={() => void handlePharmacyEngagement(pharmacy, "share")}
                      >
                        <ShareIcon />
                        <span>{feedText.share}</span>
                        <strong>{pharmacy.share_count ?? 0}</strong>
                      </button>
                    </div>

                    {expandedPharmacyComments[pharmacy.id] ? (
                      <div className="prescription-comments-panel pharmacy-comments-panel">
                        <div className="prescription-comments-head">
                          <strong>{feedText.pharmacyCommentsTitle}</strong>
                          {(pharmacy.comments?.length ?? 0) > 2 ? (
                            <button
                              type="button"
                              className="inline-text-button"
                              onClick={() =>
                                setExpandedPharmacyComments((current) => ({
                                  ...current,
                                  [pharmacy.id]: !current[pharmacy.id],
                                }))
                              }
                            >
                              {feedText.collapse}
                            </button>
                          ) : null}
                        </div>

                        {pharmacy.comments?.length ? (
                          <div className="prescription-response-stream">
                            {(pharmacy.comments ?? []).map((comment) => (
                              <article key={comment.id} className="prescription-response-item social-comment-item">
                                <div>
                                  <strong>{comment.author_name}</strong>
                                  <p>{comment.body}</p>
                                </div>
                                <small>{new Date(comment.created_at).toLocaleString()}</small>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className="prescription-live-note">
                            <span>{feedText.noPharmacyComments}</span>
                          </div>
                        )}

                        {currentUser ? (
                          <form className="prescription-comment-form" onSubmit={(event) => void handlePharmacyCommentSubmit(event, pharmacy.id)}>
                            <label>
                              <span>{feedText.addComment}</span>
                              <textarea
                                rows={3}
                                value={pharmacyCommentDrafts[pharmacy.id]?.body ?? ""}
                                onChange={(event) =>
                                  setPharmacyCommentDrafts((current) => ({
                                    ...current,
                                    [pharmacy.id]: { body: event.target.value },
                                  }))
                                }
                                placeholder={feedText.commentPharmacyPlaceholder}
                              />
                            </label>
                            <button type="submit" className="pharmigo-secondary-btn" disabled={pharmacyCommentBusyId === pharmacy.id}>
                              {pharmacyCommentBusyId === pharmacy.id ? feedText.commentSending : feedText.submitComment}
                            </button>
                          </form>
                        ) : (
                          <div className="prescription-live-note">
                            <span>{feedText.loginToInteractPharmacy}</span>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <p>{normalizedDirectorySearchTerm ? feedText.noPharmacySearchResult : "Aucune pharmacie enregistree n'est visible pour le moment."}</p>
            </div>
          )}
        </div>
      </section>

      <section className="landing-stat-band" id="services">
        <article className="landing-stat-card emphasis">
          <span>{t("kpi.response")}</span>
          <strong>{kpis.response_time_minutes} min</strong>
          <p>{copy.workflowSteps[1].body}</p>
        </article>
        <article className="landing-stat-card">
          <span>{t("kpi.resolution")}</span>
          <strong>{kpis.resolution_rate}%</strong>
          <p>{copy.networkBody}</p>
        </article>
        <article className="landing-stat-card">
          <span>{t("kpi.satisfaction")}</span>
          <strong>{kpis.satisfaction_score}/5</strong>
          <p>{copy.supportBody}</p>
        </article>
        <article className="landing-stat-card">
          <span>{t("kpi.confirmed")}</span>
          <strong>{kpis.confirmed_quotes}</strong>
          <p>{copy.finalBody}</p>
        </article>
      </section>

      <section className="landing-section-grid" id="how-it-works">
        <div className="landing-section-heading">
          <span className="landing-section-kicker">{copy.workflowKicker}</span>
          <h2>{copy.workflowTitle}</h2>
          <p>{copy.workflowBody}</p>
        </div>

        <div className="landing-steps-grid">
          {copy.workflowSteps.map((step) => (
            <article key={step.index} className="landing-step-card">
              <span className="landing-step-index">{step.index}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-final-cta">
        <div>
          <span className="landing-section-kicker">{copy.finalKicker}</span>
          <h2>{copy.finalTitle}</h2>
          <p>{copy.finalBody}</p>
        </div>

        <div className="landing-final-actions">
          {canShowUploadAction ? (
            <button type="button" className="pharmigo-primary-btn" onClick={handleOpenUpload}>
              {copy.finalPrimary}
            </button>
          ) : null}
          {!currentUser ? (
            <button type="button" className="pharmigo-secondary-btn" onClick={() => openModal("register")}>
              {copy.finalSecondary}
            </button>
          ) : null}
        </div>
      </section>

      <section className="landing-utility-ribbon" id="support">
        <div className="landing-utility-copy">
          <span className="landing-section-kicker">{copy.supportKicker}</span>
          <strong>{copy.supportTitle}</strong>
          <p>{copy.supportBody}</p>
        </div>

        <div className="landing-utility-pills">
          {supportPills.map((item, index) => (
            <span key={`${item}-${index}`} className={index < 4 ? "pharmigo-pill blue" : "pharmigo-pill green"}>
              {item}
            </span>
          ))}
        </div>

        <div className="landing-utility-notes">
          {copy.supportCards.slice(0, 3).map((card) => (
            <article key={card.title} className="landing-utility-note">
              <strong>{card.title}</strong>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section-grid pharmacy-live-board">
        <div className="landing-section-heading compact">
          <span className="landing-section-kicker">{feedText.liveKicker}</span>
          <h2>{feedText.liveTitle}</h2>
          <p>{feedText.liveBody}</p>
          <div className="status-indicator">
            <span className={liveFeedConnected ? "badge success" : "badge"}>
              {liveFeedConnected ? feedText.liveOnline : feedText.liveOffline}
            </span>
          </div>
        </div>
        {currentUser?.profile?.role === "patient" ? (
          patientConfirmedPrescriptions.length ? (
            <div className="prescription-live-list prescription-grid-two-up">
              {patientConfirmedPrescriptions.map((prescription) => renderInteractivePrescriptionSheet(prescription))}
            </div>
          ) : (
            <article className="landing-confidentiality-card">
              <span className="landing-section-kicker">Mes ordonnances confirmees</span>
              <h3>Aucune fiche ordonnance n'est encore prete.</h3>
              <p>
                Une fois vos medicaments confirmes, ils apparaitront ici sous forme de fiche numerique
                avec votre reference publique, pour vous et la pharmacie choisie.
              </p>
            </article>
          )
        ) : canViewPrescriptionBoard ? (
          publicVisiblePrescriptions.length ? (
            !currentUser ? (
              <div className="prescription-live-list prescription-grid-two-up">
                {publicVisiblePrescriptions.map((prescription) => (
                  <PublicPrescriptionSheet
                    key={prescription.id}
                    prescription={prescription}
                    title={prescription.medication_name || "Ordonnance confirmee"}
                  />
                ))}
              </div>
            ) : (
              <div className="prescription-live-list prescription-grid-two-up">
                {publicVisiblePrescriptions.map((prescription) => renderInteractivePrescriptionSheet(prescription))}
              </div>
            )
          ) : (
            <div className="empty-state">
              <p>{normalizedDirectorySearchTerm ? feedText.noPrescriptionSearchResult : feedText.noPrescription}</p>
            </div>
          )
        ) : (
          <article className="landing-panel-card prescription-access-guard" aria-live="polite">
            <div className="prescription-access-guard-badge">Confidentialite medicale</div>
            <h3>Les ordonnances restent invisibles sur l’accueil public.</h3>
            <p>
              Pour proteger les patients, seules les pharmacies autorisees et l’administration peuvent consulter les demandes et les listes de medicaments confirmees.
            </p>
            <div className="prescription-access-guard-points">
              <span>ID public anonymise</span>
              <span>Document original prive</span>
              <span>Acces reserve aux roles autorises</span>
            </div>
          </article>
        )}
        {pharmacyInteractionError ? <p className="form-feedback error">{pharmacyInteractionError}</p> : null}
        {pharmacyInteractionSuccess ? <p className="form-feedback success">{pharmacyInteractionSuccess}</p> : null}
      </section>

      <footer className="landing-inline-footer">
        <div className="landing-inline-footer-grid">
          <section className="landing-inline-footer-brand">
            <div className="landing-inline-footer-logo">
              <img src="/pharmigo-logo.png" alt="PharmiGo" className="pharmigo-brand-image" />
              <div>
                <strong>{productName}</strong>
                <span>{copy.footerAbout}</span>
              </div>
            </div>
            <p>{uiText.footerCopy}</p>
          </section>

          <section>
            <h3>{copy.footerQuickLinks}</h3>
            <div className="landing-inline-footer-links">
              <a href="#services">{copy.footerLinkServices}</a>
              <a href="#pharmacies">{copy.footerLinkPharmacies}</a>
              <a href="#how-it-works">{copy.footerLinkHow}</a>
              <a href="#support">{copy.footerLinkSupport}</a>
              {!currentUser ? (
                <>
                  <button type="button" className="footer-link-button" onClick={() => openModal("login")}>
                    {copy.footerLinkLogin}
                  </button>
                  <button type="button" className="footer-link-button" onClick={() => openModal("register")}>
                    {copy.footerLinkRegister}
                  </button>
                </>
              ) : null}
            </div>
          </section>

          <section>
            <h3>{copy.footerContact}</h3>
            <div className="landing-inline-footer-office">
              <span>+257 69 906 758</span>
              <span>contact@pharmigo.app</span>
              <span>Bujumbura, Burundi</span>
              <span>Rwanda, RDCongo, Burundi</span>
            </div>
          </section>

          <section>
            <h3>{copy.footerAction}</h3>
            <p>{copy.footerActionBody}</p>
            <div className="landing-inline-footer-actions">
              {shouldShowPublicUploadAction ? (
                <button type="button" className="pharmigo-primary-btn" onClick={handleOpenUpload}>
                  {copy.heroPrimary}
                </button>
              ) : null}
              {!currentUser ? (
                <button type="button" className="pharmigo-secondary-btn" onClick={() => openModal("login")}>
                  {copy.navLogin}
                </button>
              ) : null}
            </div>
          </section>
        </div>

        <div className="landing-inline-footer-bottom">
          <span>{copy.footerBottom}</span>
        </div>
      </footer>

      {activeModal === "login" ? (
        <ModalShell
          title={copy.modalLoginTitle}
          body={copy.modalLoginBody}
          closeLabel={copy.modalClose}
          onClose={closeModal}
        >
          <form className="auth-form inline-modal-form" onSubmit={handleLoginSubmit} autoComplete="off">
            {!loginForm.phone_number.includes("@") ? (
              <label>
                <span>Pays du numero</span>
                <select
                  value={loginForm.country_code}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      country_code: event.target.value as PhoneCountryCode,
                    }))
                  }
                >
                  <option value="bi">Burundi (+257)</option>
                  <option value="cd">RDC (+243)</option>
                  <option value="tz">Tanzanie (+255)</option>
                </select>
              </label>
            ) : null}
            <label>
              <span>{uiText.authIdentifier}</span>
              <input
                name="phone_number"
                type="text"
                autoComplete="off"
                placeholder={uiText.authIdentifierPlaceholder}
                className={authFieldErrors.phone_number ? "field-input-error" : ""}
                value={loginForm.phone_number}
                onChange={(event) => {
                  setAuthError(null);
                  clearAuthFieldError("phone_number");
                  setLoginForm((current) => ({ ...current, phone_number: event.target.value }));
                }}
              />
              {authFieldErrors.phone_number ? <small className="field-error">{authFieldErrors.phone_number}</small> : null}
            </label>
            <label>
              <span>{copy.authPassword}</span>
              <div className={authFieldErrors.password ? "password-field password-field-error" : "password-field"}>
                <input
                  name="password"
                  type={showLoginPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={loginForm.password}
                  onChange={(event) => {
                    setAuthError(null);
                    clearAuthFieldError("password");
                    setLoginForm((current) => ({ ...current, password: event.target.value }));
                  }}
                />
                <button type="button" className="password-toggle-button" onClick={() => setShowLoginPassword((current) => !current)}>
                  {showLoginPassword ? "Masquer" : "Voir"}
                </button>
              </div>
              {authFieldErrors.password ? <small className="field-error">{authFieldErrors.password}</small> : null}
            </label>
            <p className="auth-helper-text">{uiText.authPhoneHint}</p>
            {authError ? <p className="form-feedback error">{authError}</p> : null}
            {authSuccess ? <p className="form-feedback success">{authSuccess}</p> : null}
            <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={authBusy}>
              {copy.authLoginSubmit}
            </button>
            {!currentUser ? (
              <p className="auth-switch">
                <a href="/forgot-password">Mot de passe oublie ?</a>
              </p>
            ) : null}
            {!currentUser ? (
              <p className="auth-switch">
                {copy.authNoAccount}{" "}
                <button type="button" className="inline-text-button" onClick={() => switchModal("register")}>
                  {copy.authCreateAccount}
                </button>
              </p>
            ) : null}
          </form>
        </ModalShell>
      ) : null}

      {activeModal === "register" ? (
        <ModalShell
          title={copy.modalRegisterTitle}
          body={copy.modalRegisterBody}
          closeLabel={copy.modalClose}
          onClose={closeModal}
        >
          <form className="auth-form inline-modal-form" onSubmit={handleRegisterSubmit}>
            <div className="auth-role-switch" aria-label="Type de compte">
              <button
                type="button"
                className={accountType === "patient" ? "auth-role-chip active" : "auth-role-chip"}
                onClick={() => setAccountType("patient")}
              >
                {copy.authPatient}
              </button>
              <button
                type="button"
                className={accountType === "pharmacy" ? "auth-role-chip active" : "auth-role-chip"}
                onClick={() => setAccountType("pharmacy")}
              >
                {copy.authPharmacy}
              </button>
            </div>

            {accountType === "patient" ? (
              <>
                <label>
                  <span>{copy.authUsername}</span>
                  <input
                    name="patient_username"
                    type="text"
                    placeholder={copy.authUsername}
                    className={authFieldErrors.username ? "field-input-error" : ""}
                    value={patientRegisterForm.username}
                    onChange={(event) => {
                      setAuthError(null);
                      clearAuthFieldError("username");
                      setPatientRegisterForm((current) => ({ ...current, username: event.target.value }));
                    }}
                  />
                  {authFieldErrors.username ? <small className="field-error">{authFieldErrors.username}</small> : null}
                </label>
              <PhoneNumberField
                label={copy.authPhone}
                countryCode={patientRegisterForm.country_code}
                localNumber={patientRegisterForm.phone_number}
                  onCountryChange={(value) => {
                    setAuthError(null);
                    setPatientRegisterForm((current) => ({ ...current, country_code: value }));
                  }}
                  onLocalNumberChange={(value) => {
                    setAuthError(null);
                    clearAuthFieldError("phone_number");
                    setPatientRegisterForm((current) => ({ ...current, phone_number: value }));
                  }}
                  error={authFieldErrors.phone_number}
                />
                <label>
                  <span>Email facultatif</span>
                  <input
                    name="patient_email"
                    type="email"
                    placeholder="Optionnel, utile si vous oubliez le mot de passe"
                    className={authFieldErrors.email ? "field-input-error" : ""}
                    value={patientRegisterForm.email}
                    onChange={(event) => {
                      setAuthError(null);
                      clearAuthFieldError("email");
                      setPatientRegisterForm((current) => ({ ...current, email: event.target.value }));
                    }}
                  />
                  {authFieldErrors.email ? <small className="field-error">{authFieldErrors.email}</small> : null}
                  <small className="field-help">La connexion reste par numero de telephone. L'email est seulement utile pour recuperer le mot de passe plus tard.</small>
                </label>
                <label>
                  <span>{copy.authPassword}</span>
                  <div className={authFieldErrors.password ? "password-field password-field-error" : "password-field"}>
                    <input
                      name="patient_password"
                      type={showPatientRegisterPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={patientRegisterForm.password}
                      onChange={(event) => {
                        setAuthError(null);
                        clearAuthFieldError("password");
                        setPatientRegisterForm((current) => ({ ...current, password: event.target.value }));
                      }}
                    />
                    <button type="button" className="password-toggle-button" onClick={() => setShowPatientRegisterPassword((current) => !current)}>
                      {showPatientRegisterPassword ? "Masquer" : "Voir"}
                    </button>
                  </div>
                  {authFieldErrors.password ? <small className="field-error">{authFieldErrors.password}</small> : null}
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>{copy.authPharmacyName}</span>
                  <input
                    name="pharmacy_name"
                    type="text"
                    placeholder={copy.authPharmacyName}
                    className={authFieldErrors.pharmacy_name ? "field-input-error" : ""}
                    value={pharmacyRegisterForm.pharmacy_name}
                    onChange={(event) => {
                      setAuthError(null);
                      clearAuthFieldError("pharmacy_name");
                      setPharmacyRegisterForm((current) => ({ ...current, pharmacy_name: event.target.value }));
                    }}
                  />
                  {authFieldErrors.pharmacy_name ? <small className="field-error">{authFieldErrors.pharmacy_name}</small> : null}
                </label>
                <PhoneNumberField
                  label={copy.authPhone}
                  countryCode={pharmacyRegisterForm.country_code}
                  localNumber={pharmacyRegisterForm.phone_number}
                  onCountryChange={(value) => {
                    setAuthError(null);
                    setPharmacyRegisterForm((current) => ({ ...current, country_code: value }));
                  }}
                  onLocalNumberChange={(value) => {
                    setAuthError(null);
                    clearAuthFieldError("phone_number");
                    setPharmacyRegisterForm((current) => ({ ...current, phone_number: value }));
                  }}
                  error={authFieldErrors.phone_number}
                />
                <label>
                  <span>Email facultatif</span>
                  <input
                    name="pharmacy_email"
                    type="email"
                    placeholder="Optionnel, utile si vous oubliez le mot de passe"
                    className={authFieldErrors.email ? "field-input-error" : ""}
                    value={pharmacyRegisterForm.email}
                    onChange={(event) => {
                      setAuthError(null);
                      clearAuthFieldError("email");
                      setPharmacyRegisterForm((current) => ({ ...current, email: event.target.value }));
                    }}
                  />
                  {authFieldErrors.email ? <small className="field-error">{authFieldErrors.email}</small> : null}
                  <small className="field-help">La connexion pharmacie reste basee sur le numero et le mot de passe. Cet email est optionnel.</small>
                </label>
                <label>
                  <span>{copy.authAddress}</span>
                  <input
                    name="pharmacy_address"
                    type="text"
                    placeholder={copy.authAddress}
                    className={authFieldErrors.address ? "field-input-error" : ""}
                    value={pharmacyRegisterForm.address}
                    onChange={(event) => {
                      setAuthError(null);
                      clearAuthFieldError("address");
                      setPharmacyRegisterForm((current) => ({ ...current, address: event.target.value }));
                    }}
                  />
                  {authFieldErrors.address ? <small className="field-error">{authFieldErrors.address}</small> : null}
                </label>
                <label>
                  <span>Image de la pharmacie</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      setPharmacyRegisterForm((current) => ({
                        ...current,
                        pharmacy_image: event.target.files?.[0] ?? null,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{copy.authPassword}</span>
                  <div className={authFieldErrors.password ? "password-field password-field-error" : "password-field"}>
                    <input
                      name="pharmacy_password"
                      type={showPharmacyRegisterPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={pharmacyRegisterForm.password}
                      onChange={(event) => {
                        setAuthError(null);
                        clearAuthFieldError("password");
                        setPharmacyRegisterForm((current) => ({ ...current, password: event.target.value }));
                      }}
                    />
                    <button type="button" className="password-toggle-button" onClick={() => setShowPharmacyRegisterPassword((current) => !current)}>
                      {showPharmacyRegisterPassword ? "Masquer" : "Voir"}
                    </button>
                  </div>
                  {authFieldErrors.password ? <small className="field-error">{authFieldErrors.password}</small> : null}
                </label>
              </>
            )}

            <p className="auth-helper-text">
              {accountType === "patient" ? uiText.authRegisterPhoneHint : `${uiText.authRegisterPhoneHint} ${uiText.authPharmacyHint}`}
            </p>
            {authError ? <p className="form-feedback error">{authError}</p> : null}
            {authSuccess ? <p className="form-feedback success">{authSuccess}</p> : null}
            <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={authBusy}>
              {accountType === "patient" ? copy.authPatientSubmit : copy.authPharmacySubmit}
            </button>
            <p className="auth-switch">
              {copy.authHaveAccount}{" "}
              <button type="button" className="inline-text-button" onClick={() => switchModal("login")}>
                {copy.authLoginLink}
              </button>
            </p>
          </form>
        </ModalShell>
      ) : null}

      {activeModal === "profile" && currentUser ? (
        <ModalShell title={accountLabel} body="Consultez les informations liees a votre compte." closeLabel={copy.modalClose} onClose={closeModal}>
          {currentUser.is_staff || currentUser.profile?.role === "admin" ? (
            <form className="auth-form inline-modal-form" onSubmit={handleProfileSubmit}>
              <div className="profile-summary patient-profile-summary">
                <div className="profile-summary-head">
                  {currentUser.profile?.profile_image ? (
                    <img
                      src={resolveMediaUrl(currentUser.profile.profile_image) ?? ""}
                      alt={currentUser.username || "Admin"}
                      className="profile-pharmacy-image"
                    />
                  ) : (
                    <div className="profile-avatar-badge">{(currentUser.username || "A").slice(0, 1).toUpperCase()}</div>
                  )}
                  <div className="profile-summary-grid">
                    <ProfileReadItem label="Nom d'utilisateur" value={currentUser.username || "Non renseigne"} />
                    <ProfileReadItem label="Email" value={currentUser.email || "Non renseigne"} />
                    <ProfileReadItem label="Role" value="Administrateur" />
                    <ProfileReadItem label="Statut" value={currentUser.is_active === false ? "Desactive" : "Actif"} />
                  </div>
                </div>
              </div>
              <label>
                <span>{copy.authUsername}</span>
                <input
                  name="admin_profile_username"
                  type="text"
                  className={profileFieldErrors.username ? "field-input-error" : ""}
                  value={adminProfileForm.username}
                  onChange={(event) => setAdminProfileForm((current) => ({ ...current, username: event.target.value }))}
                />
                {profileFieldErrors.username ? <small className="field-error">{profileFieldErrors.username}</small> : null}
              </label>
              <label>
                <span>Email</span>
                <input
                  name="admin_profile_email"
                  type="email"
                  className={profileFieldErrors.email ? "field-input-error" : ""}
                  value={adminProfileForm.email}
                  onChange={(event) => setAdminProfileForm((current) => ({ ...current, email: event.target.value }))}
                />
                {profileFieldErrors.email ? <small className="field-error">{profileFieldErrors.email}</small> : null}
              </label>
              <label>
                <span>Photo de profil</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setAdminProfileForm((current) => ({ ...current, profile_image: event.target.files?.[0] ?? null }))
                  }
                />
              </label>
              {profileError ? <p className="form-feedback error">{profileError}</p> : null}
              {profileSuccess ? <p className="form-feedback success">{profileSuccess}</p> : null}
              <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={profileBusy}>
                Mettre a jour le profil admin
              </button>
              <button
                type="button"
                className="pharmigo-secondary-btn auth-submit"
                onClick={() => setActiveModal("dashboard")}
              >
                📊 Voir mon Dashboard
              </button>
              <button type="button" className="pharmigo-secondary-btn auth-submit" onClick={handleLogout}>
                Deconnexion
              </button>
            </form>
          ) : currentUser.profile?.role === "patient" ? (
            <form className="auth-form inline-modal-form" onSubmit={handleProfileSubmit}>
              <div className="profile-summary patient-profile-summary">
                <div className="profile-avatar-badge">{(currentUser.username || "P").slice(0, 1).toUpperCase()}</div>
                <div className="profile-summary-grid">
                  <ProfileReadItem label="Nom d'utilisateur" value={currentUser.username || "Non renseigne"} />
                  <ProfileReadItem label="Numero" value={currentUser.profile?.phone_number || "Non renseigne"} />
                  <ProfileReadItem label="Role" value="Patient" />
                </div>
              </div>
              <label>
                <span>{copy.authUsername}</span>
                <input
                  name="profile_username"
                  type="text"
                  className={profileFieldErrors.username ? "field-input-error" : ""}
                  value={profileForm.username}
                  onChange={(event) => setProfileForm((current) => ({ ...current, username: event.target.value }))}
                />
                {profileFieldErrors.username ? <small className="field-error">{profileFieldErrors.username}</small> : null}
              </label>
              <PhoneNumberField
                label={copy.authPhone}
                countryCode={profileForm.country_code}
                localNumber={profileForm.phone_number}
                onCountryChange={(value) => setProfileForm((current) => ({ ...current, country_code: value }))}
                onLocalNumberChange={(value) => setProfileForm((current) => ({ ...current, phone_number: value }))}
                error={profileFieldErrors.phone_number}
              />
              <label>
                <span>Email facultatif</span>
                <input
                  name="profile_email"
                  type="email"
                  className={profileFieldErrors.email ? "field-input-error" : ""}
                  value={profileForm.email}
                  onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="Optionnel, utile pour la recuperation"
                />
                {profileFieldErrors.email ? <small className="field-error">{profileFieldErrors.email}</small> : null}
                <small className="field-help">Votre connexion patient reste basee sur le numero de telephone et le mot de passe.</small>
              </label>
              {profileError ? <p className="form-feedback error">{profileError}</p> : null}
              {profileSuccess ? <p className="form-feedback success">{profileSuccess}</p> : null}
              <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={profileBusy}>
                Enregistrer mes modifications
              </button>
              <button
                type="button"
                className="pharmigo-secondary-btn auth-submit"
                onClick={() => setActiveModal("dashboard")}
              >
                📊 Voir mon Dashboard
              </button>
              <button type="button" className="pharmigo-secondary-btn auth-submit" onClick={handleLogout}>
                Deconnexion
              </button>
              <div className="profile-prescription-showcase">
                <div className="profile-prescription-showcase-head">
                  <strong>Mes ordonnances confirmees</strong>
                  <small>Je peux liker, commenter et partager ces fiches directement depuis mon profil.</small>
                </div>
                {patientProfilePrescriptions.length ? (
                  <div className="profile-prescription-grid">
                    {patientProfilePrescriptions.map((prescription) =>
                      renderInteractivePrescriptionSheet(prescription, { compact: true })
                    )}
                  </div>
                ) : (
                  <div className="pharmacy-message-feed">
                    <article className="landing-notification-item">
                      <strong>Aucune ordonnance confirmee</strong>
                      <p>Confirmez vos medicaments pour voir vos fiches ordonnance apparaitre ici.</p>
                    </article>
                  </div>
                )}
              </div>
            </form>
          ) : (
            <form className="auth-form inline-modal-form" onSubmit={handleProfileSubmit}>
              <div className="profile-summary">
                <div className="profile-summary-head">
                  {currentUser.profile?.pharmacy_image ? (
                    <img
                      src={resolveMediaUrl(currentUser.profile.pharmacy_image) ?? ""}
                      alt={currentUser.profile.pharmacy_name}
                      className="profile-pharmacy-image"
                    />
                  ) : (
                    <div className="profile-avatar-badge">
                      {(currentUser.profile?.pharmacy_name || "P").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="profile-summary-grid">
                    <ProfileReadItem label="Nom" value={currentUser.profile?.pharmacy_name || "Non renseigne"} />
                    <ProfileReadItem label="Numero" value={currentUser.profile?.pharmacy_phone_number || currentUser.profile?.phone_number || "Non renseigne"} />
                    <ProfileReadItem label="Adresse" value={currentUser.profile?.address || "Non renseignee"} />
                    <ProfileReadItem label="Ville" value={currentUser.profile?.pharmacy_city || "Non renseignee"} />
                  </div>
                </div>
              </div>
              <label>
                <span>Nom de la pharmacie</span>
                <input
                  className={profileFieldErrors.pharmacy_name ? "field-input-error" : ""}
                  value={pharmacyProfileForm.pharmacy_name}
                  onChange={(event) => setPharmacyProfileForm((current) => ({ ...current, pharmacy_name: event.target.value }))}
                />
                {profileFieldErrors.pharmacy_name ? <small className="field-error">{profileFieldErrors.pharmacy_name}</small> : null}
              </label>
              <PhoneNumberField
                label="Numero de telephone"
                countryCode={pharmacyProfileForm.country_code}
                localNumber={pharmacyProfileForm.phone_number}
                onCountryChange={(value) => setPharmacyProfileForm((current) => ({ ...current, country_code: value }))}
                onLocalNumberChange={(value) => setPharmacyProfileForm((current) => ({ ...current, phone_number: value }))}
                error={profileFieldErrors.phone_number}
              />
              <label>
                <span>Adresse</span>
                <input
                  className={profileFieldErrors.address ? "field-input-error" : ""}
                  value={pharmacyProfileForm.address}
                  onChange={(event) => setPharmacyProfileForm((current) => ({ ...current, address: event.target.value }))}
                />
                {profileFieldErrors.address ? <small className="field-error">{profileFieldErrors.address}</small> : null}
              </label>
              <div className="card-row">
                <label>
                  <span>Ville</span>
                  <input
                    value={pharmacyProfileForm.city}
                    onChange={(event) => setPharmacyProfileForm((current) => ({ ...current, city: event.target.value }))}
                  />
                </label>
              </div>
              <label>
                <span>Email</span>
                <input
                  value={pharmacyProfileForm.email}
                  onChange={(event) => setPharmacyProfileForm((current) => ({ ...current, email: event.target.value }))}
                />
              </label>
              <div className="card-row">
                <label>
                  <span>Heures d'ouverture</span>
                  <input
                    value={pharmacyProfileForm.opening_hours}
                    onChange={(event) => setPharmacyProfileForm((current) => ({ ...current, opening_hours: event.target.value }))}
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={pharmacyProfileForm.delivery_supported}
                    onChange={(event) => setPharmacyProfileForm((current) => ({ ...current, delivery_supported: event.target.checked }))}
                  />
                  <span>Livraison disponible</span>
                </label>
              </div>
              <label>
                <span>Image de la pharmacie</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setPharmacyProfileForm((current) => ({ ...current, pharmacy_image: event.target.files?.[0] ?? null }))
                  }
                />
              </label>
              {profileError ? <p className="form-feedback error">{profileError}</p> : null}
              {profileSuccess ? <p className="form-feedback success">{profileSuccess}</p> : null}
              <button type="submit" className="pharmigo-primary-btn auth-submit" disabled={profileBusy}>
                Mettre a jour la pharmacie
              </button>
              <button
                type="button"
                className="pharmigo-secondary-btn auth-submit"
                onClick={() => setActiveModal("dashboard")}
              >
                📊 Voir mon Dashboard
              </button>
              <button
                type="button"
                className="pharmigo-secondary-btn auth-submit"
                onClick={() => setActiveModal("pharmacy-stock")}
              >
                💊 Gérer le stock de médicaments
              </button>
              <button type="button" className="pharmigo-secondary-btn auth-submit" onClick={handleLogout}>
                Deconnexion
              </button>
              <div className="profile-prescription-showcase">
                <div className="profile-prescription-showcase-head">
                  <strong>Ordonnances choisies pour ma pharmacie</strong>
                  <small>Les interactions restent actives ici aussi pour suivre les retours et le partage.</small>
                </div>
                {pharmacyProfilePrescriptions.length ? (
                  <div className="profile-prescription-grid">
                    {pharmacyProfilePrescriptions.map((prescription) =>
                      renderInteractivePrescriptionSheet(prescription, { compact: true })
                    )}
                  </div>
                ) : (
                  <div className="pharmacy-message-feed">
                    <article className="landing-notification-item">
                      <strong>Aucune ordonnance selectionnee</strong>
                      <p>Les ordonnances choisies par les patients apparaitront ici automatiquement.</p>
                    </article>
                  </div>
                )}
              </div>
            </form>
          )}
        </ModalShell>
      ) : null}

      {activeModal === "messages" && currentUser?.profile?.role === "pharmacy" ? (
        <ModalShell
          title={chromeText.messageModalTitle}
          body={chromeText.messageModalBody}
          closeLabel={copy.modalClose}
          onClose={closeModal}
          className="landing-modal-card wide-chat-modal"
        >
          <div className="pharmacy-message-layout">
            <aside className="pharmacy-chat-sidebar">
              <div className="pharmacy-chat-sidebar-head">
                <h3>{chromeText.conversations}</h3>
                <p>{chromeText.addConversationHint}</p>
              </div>

              <div className="pharmacy-chat-add-contact">
                <select
                  value={contactPickerId}
                  onChange={(event) => {
                    setContactPickerId(event.target.value);
                    setRecipientPharmacyId(event.target.value);
                    setSelectedConversationId(event.target.value);
                    setMessageError(null);
                    setMessageSuccess(null);
                  }}
                  disabled={availableRecipientPharmacies.length === 0}
                >
                  <option value="">
                    {availableRecipientPharmacies.length === 0 ? chromeText.noPharmacyAvailable : chromeText.choosePharmacy}
                  </option>
                  {availableRecipientPharmacies.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="pharmigo-secondary-btn pharmacy-chat-add-button"
                  onClick={handleSaveContact}
                  disabled={!contactPickerId}
                >
                  {chromeText.add}
                </button>
              </div>

              {availableRecipientPharmacies.length === 0 ? (
                <p className="auth-helper-text">{chromeText.enableMessaging}</p>
              ) : null}

              <div className="pharmacy-chat-conversation-list">
                {conversationItems.length === 0 ? (
                  <p className="empty-state">{chromeText.noContactsYet}</p>
                ) : (
                  conversationItems.map((item) => (
                    <button
                      key={item.pharmacy.id}
                      type="button"
                      className={effectiveRecipientId === String(item.pharmacy.id) ? "pharmacy-chat-contact active" : "pharmacy-chat-contact"}
                      onClick={() => handleSelectConversation(item.pharmacy.id)}
                    >
                      <div className="pharmacy-chat-contact-avatar">
                        {item.pharmacy.profile_image && !brokenPharmacyImages[item.pharmacy.id] ? (
                          <img
                            src={resolveMediaUrl(item.pharmacy.profile_image) ?? ""}
                            alt={item.pharmacy.name}
                            onError={() => setBrokenPharmacyImages((current) => ({ ...current, [item.pharmacy.id]: true }))}
                          />
                        ) : (
                          <span>{item.pharmacy.name.slice(0, 1).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="pharmacy-chat-contact-copy">
                        <div className="pharmacy-chat-contact-line">
                          <strong>{item.pharmacy.name}</strong>
                          {item.lastMessage ? <small>{formatExactDateTime(item.lastMessage.created_at, language)}</small> : null}
                        </div>
                        <p>{item.lastMessage?.message || chromeText.noMessageYet}</p>
                        <div className="pharmacy-chat-contact-meta">
                          {item.isSaved ? <span className="pharmacy-chat-saved-pill">{chromeText.savedContact}</span> : null}
                          {item.unreadCount ? <span className="pharmacy-chat-unread-pill">{item.unreadCount} {chromeText.unread}</span> : null}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </aside>

            <section className="pharmacy-chat-main">
              <div className="pharmacy-chat-thread-head">
                {activeConversation ? (
                  <>
                    <div className="pharmacy-chat-thread-identity">
                      <div className="pharmacy-chat-thread-avatar">
                        {activeConversation.profile_image && !brokenPharmacyImages[activeConversation.id] ? (
                          <img
                            src={resolveMediaUrl(activeConversation.profile_image) ?? ""}
                            alt={activeConversation.name}
                            onError={() => setBrokenPharmacyImages((current) => ({ ...current, [activeConversation.id]: true }))}
                          />
                        ) : (
                          <span>{activeConversation.name.slice(0, 1).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        <strong>{activeConversation.name}</strong>
                        <p>{formatPharmacyLocation(activeConversation)}</p>
                      </div>
                    </div>
                    <div className="pharmacy-chat-thread-status">
                      <span>{activeConversation.phone_number || feedText.phoneMissing}</span>
                    </div>
                  </>
                ) : (
                  <div className="pharmacy-chat-thread-empty-head">
                    <strong>{chromeText.choosePharmacy}</strong>
                    <p>
                      {language === "en"
                        ? "Select a contact on the left to display the conversation."
                        : language === "rn"
                          ? "Hitamwo contact ibubamfu kugira ubone ikiganiro."
                          : language === "sw"
                            ? "Chagua mawasiliano kushoto ili kuona mazungumzo."
                            : language === "ln"
                              ? "Pona contact na loboko ya mwasi mpo omona lisolo."
                              : "Selectionnez un contact a gauche pour afficher la conversation."}
                    </p>
                  </div>
                )}
              </div>

              <div className="pharmacy-chat-thread-body">
                {activeConversation ? (
                  activeConversationMessages.length ? (
                    activeConversationMessages.map((item) => {
                      const isOutgoing = item.sender_pharmacy === currentUser.profile?.pharmacy;
                      return (
                        <article key={item.id} className={isOutgoing ? "pharmacy-chat-bubble outgoing" : "pharmacy-chat-bubble incoming"}>
                          <div className="pharmacy-chat-bubble-card">
                            <strong>{isOutgoing ? "Vous" : item.sender_pharmacy_name || item.sender_name}</strong>
                            <p>{item.message}</p>
                            <small>{new Date(item.created_at).toLocaleString()}</small>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="pharmacy-chat-thread-empty">
                      <p>Aucun message dans cette discussion pour le moment.</p>
                    </div>
                  )
                ) : (
                  <div className="pharmacy-chat-thread-empty">
                    <p>Ajoutez ou choisissez un contact pour commencer a ecrire.</p>
                  </div>
                )}
              </div>

              <form className="pharmacy-chat-composer" onSubmit={handlePharmacyMessageSubmit}>
                <div className="pharmacy-chat-composer-field">
                  <textarea
                    rows={3}
                    placeholder={activeConversation ? `Ecrire a ${activeConversation.name}...` : "Choisissez d'abord une pharmacie"}
                    value={messageBody}
                    onChange={(event) => {
                      setMessageBody(event.target.value);
                      setMessageError(null);
                      setMessageSuccess(null);
                      setMessageFieldErrors((current) => ({ ...current, message: "" }));
                    }}
                    disabled={!effectiveRecipientId || availableRecipientPharmacies.length === 0}
                  />
                  <button
                    type="submit"
                    className="pharmigo-primary-btn pharmacy-chat-send-button"
                    disabled={messageBusy || availableRecipientPharmacies.length === 0 || !effectiveRecipientId}
                    aria-label={messageBusy ? "Envoi en cours" : "Envoyer le message"}
                  >
                    <SendIcon />
                  </button>
                </div>
                {messageFieldErrors.pharmacy ? <p className="field-error-summary field-error">{messageFieldErrors.pharmacy}</p> : null}
                {messageFieldErrors.message ? <p className="field-error-summary field-error">{messageFieldErrors.message}</p> : null}
                {messageError ? <p className="form-feedback error">{messageError}</p> : null}
                {messageSuccess ? <p className="form-feedback success">{messageSuccess}</p> : null}
              </form>
            </section>
          </div>
        </ModalShell>
      ) : null}

      {activeModal === "pharmacy-stock" && currentUser?.profile?.role === "pharmacy" ? (
        <ModalShell
          title="Gestion du Stock"
          body="Ajoutez ou modifiez les médicaments disponibles dans votre pharmacie."
          closeLabel={copy.modalClose}
          onClose={closeModal}
          className="landing-modal-card wide-modal"
        >
          <div className="pharmacy-stock-container">
            <PharmacyStockManager />
          </div>
        </ModalShell>
      ) : null}

      {activeModal === "dashboard" && authBootstrapped && currentUser ? (
        <ModalShell
          title={currentUser.is_staff ? `Dashboard Admin - ${accountLabel}` : accountLabel}
          body={currentUser.is_staff ? "Pilotage global de PharmiGo en temps reel" : "Vue d'ensemble de votre activité sur PharmiGo"}
          closeLabel={copy.modalClose}
          onClose={closeModal}
          className="landing-modal-card wide-modal"
        >
          <div className="dashboard-container">
            {currentUser.is_staff ? <AdminDashboard /> : currentUser.profile?.role === "patient" ? <PatientDashboard /> : <PharmacyDashboard />}
          </div>
        </ModalShell>
      ) : null}

      {activeModal === "upload" ? (
        <ModalShell
          title={copy.modalUploadTitle}
          body={uiText.uploadBody}
          closeLabel={copy.modalClose}
          onClose={closeModal}
        >
          {uploadSuccess ? (
            <NotificationToast
              message={`${copy.uploadSuccessPrefix} ${uploadSuccess.medication_name}. ${t("common.status")}: ${uploadSuccess.task_status}.`}
            />
          ) : null}
          {uploadError ? <p className="form-feedback error">{uploadError}</p> : null}
          {!currentUser ? (
            <div className="form-card restricted-action-card">
              <p>{localizedUi.loginPatientFirst}</p>
              <div className="landing-final-actions">
                <button type="button" className="pharmigo-primary-btn" onClick={() => switchModal("login")}>
                  {copy.navLogin}
                </button>
                <button type="button" className="pharmigo-secondary-btn" onClick={() => switchModal("register")}>
                  {copy.navRegister}
                </button>
              </div>
            </div>
          ) : currentUser.profile?.role !== "patient" ? (
            <div className="form-card restricted-action-card">
              <p>{localizedUi.patientOnlyUpload}</p>
            </div>
          ) : (
            <PrescriptionUploader
              pharmacies={pharmacies}
              currentUser={currentUser}
              onSuccess={(result) => {
                setUploadError(null);
                setUploadSuccess(result);
                setAnalysisPopupRecord(null);
                setPendingAnalysisRecord(null);
                setCompletedTaskResult(null);
                setActiveAnalysisTaskId(result.task_id);
                setAnalysisRevealAt(Date.now() + 7000);
                setAnalysisStartedAt(Date.now());
                void fetchDashboard().then((dashboardData) => setDashboard(dashboardData)).catch(() => undefined);
              }}
              onError={(message) => setUploadError(message)}
            />
          )}
        </ModalShell>
      ) : null}

      {activeAnalysisTaskId ? (
        <div className="guardian-popup-overlay" role="dialog" aria-modal="true" aria-label="Analyse en cours">
          <div className="guardian-popup-card guardian-popup-loader-card">
            <div className="guardian-popup-head">
              <div>
                <p className="guardian-popup-kicker">Assistant PharmiGo</p>
                <h3>Analyse de mon ordonnance en cours...</h3>
              </div>
            </div>
            <div className="guardian-popup-block guardian-popup-loading">
              <div className="guardian-loading-skeleton" />
              <div className="guardian-loading-skeleton short" />
              <p className="guardian-popup-subtle">
                {analysisStartedAt && Date.now() - analysisStartedAt > 8000
                  ? "L’analyse prend plus de temps que prévu. Je peux continuer ou confirmer manuellement."
                  : analysisStartedAt && Date.now() - analysisStartedAt > 2000
                    ? "L’analyse prend quelques secondes, je continue..."
                    : "Analyse de mon ordonnance en cours..."}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {analysisPopupRecord?.bot_result ? (
        <PrescriptionAnalysisPopup
          prescriptionId={analysisPopupRecord.id}
          result={analysisPopupRecord.bot_result}
          ocrText={analysisPopupRecord.ocr_text}
          confidenceScore={analysisPopupRecord.confidence_score}
          onClose={() => setAnalysisPopupRecord(null)}
          onAnalysisUpdated={(updatedRecord) => {
            setAnalysisPopupRecord(updatedRecord);
            setDashboard((current) => mergePrescriptionRecords(current, updatedRecord));
          }}
          onPharmacySelected={(pharmacyName) => {
            setUploadSuccess((current) =>
              current ? { ...current, task_status: `pharmacy_selected:${pharmacyName}` } : current
            );
          }}
        />
      ) : null}

      {shareMenu ? (
        <div className="landing-share-overlay" role="dialog" aria-modal="true" aria-label={localizedUi.shareDialogTitle} onClick={() => setShareMenu(null)}>
          <div className="landing-share-card" onClick={(event) => event.stopPropagation()}>
            <div className="landing-share-head">
              <div>
                <span className="landing-section-kicker">{localizedUi.shareDialogTitle}</span>
                <h3>{shareMenu.title}</h3>
                <p>{localizedUi.shareDialogBody}</p>
              </div>
              <button type="button" className="landing-modal-close" onClick={() => setShareMenu(null)}>
                {copy.modalClose}
              </button>
            </div>
            <div className="landing-share-grid">
              <button type="button" className="pharmigo-primary-btn share-channel-button" onClick={() => void handleShareChannel("whatsapp")}><WhatsAppIcon />WhatsApp</button>
              <button type="button" className="pharmigo-secondary-btn share-channel-button" onClick={() => void handleShareChannel("facebook")}><FacebookIcon />Facebook</button>
              <button type="button" className="pharmigo-secondary-btn share-channel-button" onClick={() => void handleShareChannel("instagram")}><InstagramIcon />Instagram</button>
              <button type="button" className="pharmigo-secondary-btn share-channel-button" onClick={() => void handleShareChannel("telegram")}><TelegramIcon />Telegram</button>
              <button type="button" className="pharmigo-secondary-btn share-channel-button" onClick={() => void handleShareChannel("tiktok")}><TikTokIcon />TikTok</button>
              <button type="button" className="pharmigo-secondary-btn share-channel-button" onClick={() => void handleShareChannel("copy")}><CopyLinkIcon />{localizedUi.shareCopy}</button>
              <button type="button" className="pharmigo-secondary-btn share-channel-button" onClick={() => void handleShareChannel("platform")}><InternalShareIcon />{localizedUi.shareRepublish}</button>
            </div>
          </div>
        </div>
      ) : null}

      {activePrescriptionPreview ? (
        <div
          className="prescription-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={feedText.documentLabel}
          onClick={() => setActivePrescriptionPreview(null)}
        >
          <div className="prescription-lightbox-dialog" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="prescription-lightbox-close"
              onClick={() => setActivePrescriptionPreview(null)}
            >
              {copy.modalClose}
            </button>
            <img src={activePrescriptionPreview.src} alt={activePrescriptionPreview.alt} />
          </div>
        </div>
      ) : null}

      {/* PharmiGo Modal */}
      {/* ChatBot flottant */}
      <ChatBotButton />

      {showPharmiGoModal ? (
        <div className="pharmigo-modal-overlay" onClick={() => setShowPharmiGoModal(false)}>
          <div className="pharmigo-modal-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="pharmigo-modal-header">
              <h2 className="pharmigo-modal-title">{pharmigoModalContent.title}</h2>
              <div className="pharmigo-modal-actions">
                <button
                  type="button"
                  className="pharmigo-pdf-download-btn"
                  onClick={() => downloadPharmiGoPDF()}
                >
                  📄 {pharmigoModalContent.downloadPdf}
                </button>
                <button
                  type="button"
                  className="pharmigo-modal-close"
                  onClick={() => setShowPharmiGoModal(false)}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="pharmigo-modal-content">
              {pharmigoModalContent.sections.map((section) => (
                <div key={section.title} className="pharmigo-content-block">
                  <h3 className="pharmigo-block-title">{section.title}</h3>
                  <div className="pharmigo-block-content">
                    {section.intro ? <p className="pharmigo-paragraph">{section.intro}</p> : null}
                    <div className="pharmigo-features-list">
                      {section.items.map((item) => (
                        <div key={item.title} className="pharmigo-feature">
                          <div className="feature-content">
                            <h4>{item.title}</h4>
                            <p>{item.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
