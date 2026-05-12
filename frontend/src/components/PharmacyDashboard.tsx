import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import DashboardScaffold, { DashboardPanel, EyeGlyph, RefreshGlyph } from "./DashboardScaffold";
import InAppDocumentViewer from "./InAppDocumentViewer";
import PublicPrescriptionSheet from "./PublicPrescriptionSheet";
import PharmacyStockManager from "./PharmacyStockManager";
import { getApiOrigin, getChatWebSocketUrl } from "../config/endpoints";
import { usePreferences } from "../context/PreferencesContext";
import { formatExactDateTime } from "../lib/datetime";
import { logClientError } from "../lib/logger";
import {
  confirmPharmacyServedPrescription,
  createSubscriptionPayment,
  deletePharmacyStockItem,
  fetchDashboard,
  fetchProtectedDocument,
  fetchPharmacyStock,
  fetchPharmacySubscription,
  fetchProfile,
  fetchSubscriptionPayments,
  patchPharmacyStockItem,
} from "../services/api";
import type { PrescriptionRecord, RewardProgramPharmacyPayload } from "../types";

interface StockItem {
  id: number;
  medication_name: string;
  generic_name: string | null;
  dosage: string | null;
  quantity: number;
  sale_scope: "retail" | "wholesale";
  unit: string;
  price: number;
  currency: "BIF" | "FC" | "TSH";
  last_updated?: string | null;
  is_available: boolean;
}

interface KPIShape {
  total_stock: number;
  available_medications: number;
  total_responses: number;
  avg_response_time: number;
}

interface SubscriptionData {
  subscription_status: string;
  is_trial_active: boolean;
  trial_start_date: string;
  trial_end_date: string;
  monthly_price_usd: number;
  monthly_price_bif: number;
  current_exchange_rate_bif: number;
  next_payment_due_date: string | null;
  days_remaining: number;
  payment_details?: {
    monthly_price_usd: number;
    monthly_price_bif: number;
    exchange_rate: number;
    payment_methods: Array<{
      code: string;
      label: string;
      currency: string;
      enabled: boolean;
      account_name: string;
      account_number: string;
      instructions: string;
    }>;
  };
  reward_program?: RewardProgramPharmacyPayload;
}

interface PaymentRecord {
  id: number;
  pharmacy?: number;
  pharmacy_name?: string;
  amount_usd: number;
  amount_bif: number;
  currency: string;
  payment_method: string;
  payment_status: string;
  payment_month: string;
  transaction_reference?: string;
  sender_phone?: string;
  receiver_phone?: string;
  proof_image?: string | null;
  payer_name?: string;
  payer_address?: string;
  created_at: string;
}

type PharmacySection =
  | "dashboard"
  | "stock"
  | "prescriptions"
  | "ocr"
  | "subscription"
  | "payment-history"
  | "activity-history"
  | "ambassador"
  | "manage-stock"
  | "configuration"
  | "activate"
  | "add-medication";

const STOCK_PAGE_SIZE = 4;
const PRESCRIPTION_PAGE_SIZE = 4;
const SEARCH_LOCALES = ["fr-FR", "en-US", "sw-TZ"] as const;

function buildSearchIndex(parts: Array<string | number | null | undefined>, dateValues: Array<string | null | undefined> = []) {
  const dateTokens = dateValues.flatMap((dateValue) => {
    if (!dateValue) {
      return [];
    }

    const parsedDate = new Date(dateValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return [String(dateValue)];
    }

    return SEARCH_LOCALES.flatMap((locale) => [
      parsedDate.toLocaleDateString(locale),
      parsedDate.toLocaleString(locale, { month: "long" }),
      parsedDate.toLocaleString(locale, { month: "short" }),
      parsedDate.toLocaleString(locale, { year: "numeric", month: "long", day: "numeric" }),
    ]);
  });

  return [...parts, ...dateTokens].join(" ").toLowerCase();
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
  return path.startsWith("/") ? path : `/${path}`;
}

function getPrescriptionReference(prescription: PrescriptionRecord) {
  return prescription.public_reference || `ORD-${String(prescription.id).padStart(6, "0")}`;
}

function getPrescriptionDocumentUrl(prescription: PrescriptionRecord) {
  const rawDocumentPath =
    prescription.document_access_url ||
    prescription.prescription_image ||
    (typeof prescription.prescription_file === "string" ? prescription.prescription_file : null);
  return resolveMediaUrl(rawDocumentPath);
}

function isImageDocument(url?: string | null) {
  return Boolean(url && /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url));
}

function formatCurrencyValue(value: unknown, currency = "BIF") {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? 0));
  const amount = Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  return `${amount} ${currency}`;
}

function formatSaleScopeLabel(scope: "retail" | "wholesale") {
  return scope === "wholesale" ? "Vente en gros" : "Vente au détail";
}

function formatPresenceLabel(isOnline?: boolean, lastSeen?: string | null, language = "fr") {
  const locale = language === "en" ? "en-US" : language === "sw" ? "sw-TZ" : language === "ln" ? "fr-CD" : "fr-BI";
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

function parseValidDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildAmbassadorShareMessage(link: string) {
  return `Rejoignez PharmiGo via ce lien officiel de parrainage pharmacie : ${link}`;
}

function buildRewardGuideCopyText(program?: RewardProgramPharmacyPayload | null, language = "fr") {
  if (!program) {
    return "";
  }

  const title = program.guide_title || "Guide officiel de la promotion ambassadeur PharmiGo";
  const instructions = program.instructions || "Aucune instruction definie pour l'evenement pour le moment.";
  const threshold = program.threshold ?? 20;
  const bonusDays = program.bonus_days ?? 90;
  const startLabel = program.event_window?.start ? formatExactDateTime(program.event_window.start, language as "fr" | "en" | "rn" | "sw" | "ln") : "Debut non defini";
  const endLabel = program.event_window?.end ? formatExactDateTime(program.event_window.end, language as "fr" | "en" | "rn" | "sw" | "ln") : "Fin non definie";

  return [
    title,
    "",
    instructions,
    "",
    "Seuil valide",
    `${threshold} pharmacies`,
    "",
    "Recompense",
    `+${bonusDays} jours gratuits`,
    "",
    `Debut: ${startLabel}`,
    `Fin: ${endLabel}`,
  ].join("\n");
}

function formatRewardEventStatus(status: string) {
  const labels: Record<string, string> = {
    active: "Actif",
    upcoming: "A venir",
    closed: "Cloture",
  };
  return labels[status] ?? status;
}

function copyTextWithFallback(value: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  return new Promise<void>((resolve, reject) => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (successful) {
        resolve();
        return;
      }
      reject(new Error("copy failed"));
    } catch (error) {
      reject(error);
    }
  });
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M16.5 7.5a2.5 2.5 0 1 0-2.39-3.25l-5.38 3.1a2.5 2.5 0 1 0 0 9.3l5.38 3.1a2.5 2.5 0 1 0 .74-1.3l-5.38-3.1a2.56 2.56 0 0 0 0-2.7l5.38-3.1A2.49 2.49 0 0 0 16.5 7.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.2a9.8 9.8 0 0 0-8.48 14.71L2.2 21.8l5.03-1.28A9.8 9.8 0 1 0 12 2.2Z" fill="currentColor" opacity="0.14" />
      <path d="M12.01 4.1a8.1 8.1 0 0 0-7.02 12.13l.28.47-.82 2.99 3.06-.8.46.27A8.12 8.12 0 1 0 12 4.1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M9.4 8.2c.14-.31.28-.33.49-.34.13-.01.28-.01.43-.01.14 0 .38.05.58.26.2.22.78.77.78 1.88 0 1.11-.81 2.19-.92 2.34-.11.15-1.55 2.49-3.84 3.39-.78.31-1.39.5-1.87.63-.79.22-1.51.18-2.08.11-.63-.08-1.95-.8-2.23-1.57-.28-.77-.28-1.43-.2-1.57.08-.14.3-.22.63-.38.33-.16.69-.38.92-.56.23-.19.39-.21.66.11.27.31 1.12 1.39 1.36 1.66.23.27.47.3.79.11.33-.19 1.38-.5 2.05-1.6.54-.86.56-1.59.39-1.78-.16-.19-.36-.42-.56-.65-.2-.22-.42-.48-.59-.65-.18-.16-.36-.14-.53.23Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FacebookGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.2a9.8 9.8 0 1 0 0 19.6 9.8 9.8 0 0 0 0-19.6Z" fill="currentColor" opacity="0.14" />
      <path d="M13.55 20.25v-6.46h2.17l.33-2.55h-2.5V9.62c0-.74.2-1.25 1.28-1.25h1.37V6.03c-.23-.04-1.04-.1-1.97-.1-1.94 0-3.27 1.19-3.27 3.38v1.93H8.8v2.55h2.16v6.46h2.59Z" fill="currentColor" />
    </svg>
  );
}

function PencilGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m4 20 4.1-.9L18.7 8.5a1.6 1.6 0 0 0 0-2.26l-.94-.94a1.6 1.6 0 0 0-2.26 0L4.9 15.9 4 20Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m13.9 6.9 3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 7.5h15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M9.5 3.75h5l.7 1.75H19a.75.75 0 0 1 .75.75v.5H4.25v-.5A.75.75 0 0 1 5 5.5h3.8l.7-1.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 7.5 7.25 19a1.5 1.5 0 0 0 1.5 1.4h6.5a1.5 1.5 0 0 0 1.5-1.4L17.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 11v5M14 11v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function MinusGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function ConfirmGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m5 12.5 4.2 4.2L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getReferralStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_payment: "Attente paiement",
    pending_activity: "Attente activite",
    validated: "Valide",
    rewarded: "Recompense accordee",
    fraud_blocked: "Bloque fraude",
  };
  return labels[status] ?? status;
}

function getPharmacyPrescriptionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pharmacy_selected: "Envoyee a votre pharmacie",
    preparing: "En preparation",
    ready: "Prete a servir",
    served: "Servie",
    completed: "Classee",
    confirmation_pending: "Confirmation requise",
    confirmed: "Confirmee",
    confirmed_unavailable: "Confirmee, medicaments introuvables",
    searching: "Recherche en cours",
    analyzing: "En analyse",
  };
  return labels[status] ?? status;
}

function canPharmacyConfirmPrescription(prescription: PrescriptionRecord, currentPharmacyId: number | null) {
  if (!currentPharmacyId || prescription.pharmacy !== currentPharmacyId) {
    return false;
  }
  return ["pharmacy_selected", "confirmed", "confirmed_unavailable", "searching", "preparing", "ready"].includes(prescription.status);
}

const PHARMACY_DASHBOARD_REFRESH_EVENTS = new Set([
  "prescription.created",
  "prescription.confirmed",
  "prescription.search.completed",
  "prescription.pharmacy_selected",
  "prescription.served",
  "prescription.patient_confirmation",
  "notification.broadcast",
  "stock.updated",
  "profile.updated",
]);

export default function PharmacyDashboard({
  onRequestProfileOpen,
}: {
  onRequestProfileOpen?: () => void;
}) {
  const { language } = usePreferences();
  const [stock, setStock] = useState<StockItem[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [kpis, setKpis] = useState<KPIShape>({
    total_stock: 0,
    available_medications: 0,
    total_responses: 0,
    avg_response_time: 0,
  });
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [profileName, setProfileName] = useState("Pharmacie");
  const [profileMeta, setProfileMeta] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [profileIsOnline, setProfileIsOnline] = useState(false);
  const [currentPharmacyId, setCurrentPharmacyId] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<PharmacySection>("dashboard");
  const [searchTerm, setSearchTerm] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [prescriptionPage, setPrescriptionPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stockActionBusyId, setStockActionBusyId] = useState<number | null>(null);
  const [documentViewer, setDocumentViewer] = useState<{ src: string; title: string; contentType?: string | null; fileName?: string | null } | null>(null);
  const [showActivationForm, setShowActivationForm] = useState(false);
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationSuccess, setActivationSuccess] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);
  const [confirmBusyId, setConfirmBusyId] = useState<number | null>(null);
  const [activationForm, setActivationForm] = useState({
    payer_name: "",
    payer_address: "",
    sender_phone: "",
    payment_method: "",
    transaction_reference: "",
    proof_image: null as File | null,
  });
  const refreshInFlightRef = useRef(false);
  const backgroundRefreshTimerRef = useRef<number | null>(null);
  const lastBackgroundRefreshAtRef = useRef(0);
  const lastSnapshotRef = useRef("");
  const shareMenuRef = useRef<HTMLDivElement | null>(null);

  async function copyRewardValue(value: string, successMessage: string, emptyMessage: string) {
    if (!value.trim()) {
      setCopyFeedback(emptyMessage);
      return;
    }
    try {
      await copyTextWithFallback(value);
      setCopyFeedback(successMessage);
      window.setTimeout(() => {
        setCopyFeedback((current) => (current === successMessage ? null : current));
      }, 2800);
    } catch {
      setCopyFeedback("Impossible de copier pour le moment.");
    }
  }

  function openSocialShare(platform: "whatsapp" | "facebook") {
    const link = subscription?.reward_program?.referral_link || "";
    if (!link) {
      setCopyFeedback("Lien indisponible.");
      return;
    }

    const encodedUrl = encodeURIComponent(link);
    const encodedText = encodeURIComponent(buildAmbassadorShareMessage(link));
    const shareUrls = {
      whatsapp: `https://wa.me/?text=${encodedText}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    } as const;

    window.open(shareUrls[platform], "_blank", "noopener,noreferrer");
    setCopyFeedback(`Partage ${platform} lance.`);
    setIsShareMenuOpen(false);
  }

  const labels = {
    fr: {
      title: "Dashboard Pharmacie",
      subtitle: "Pilotage temps reel du stock, des ordonnances disponibles et de l'abonnement.",
      refresh: "Actualiser",
      stock: "Mon stock",
      manageStock: "Gerer le stock",
      silentRefresh: "Mise a jour silencieuse...",
      totalStock: "Total stock",
      available: "Medicaments disponibles",
      responses: "Reponses donnees",
      avgResponse: "Temps de reponse moyen",
      subscription: "Mon abonnement",
      paymentHistory: "Historique de paiement",
      activityHistory: "Historique d'activites",
      availablePrescriptions: "Ordonnances disponibles",
      ocr: "Verification OCR",
      configuration: "Configuration",
      activate: "Passer au statut actif",
      reactivate: "Reactiver l'abonnement",
      addMedication: "Ajouter des medicaments",
      emptyStock: "Aucun medicament en stock",
      emptyPrescription: "Aucune ordonnance disponible",
      searchPlaceholder: "Rechercher un medicament, dosage ou ordonnance...",
      stockPage: "Page stock",
      prescriptionPage: "Page ordonnances",
      upgradeTitle: "Votre pharmacie est actuellement en essai.",
      upgradeBody: "Les moyens de paiement et le prix mensuel ci-dessous sont synchronises avec la configuration admin.",
      settingsTitle: "Informations de configuration",
      settingsBody: "Les informations de la pharmacie et les moyens de paiement actifs s'affichent ici en temps reel.",
    },
    en: {
      title: "Pharmacy Dashboard",
      subtitle: "Real-time control of stock, available prescriptions, and subscription status.",
      refresh: "Refresh",
      stock: "My stock",
      manageStock: "Manage stock",
      silentRefresh: "Silent refresh...",
      totalStock: "Total stock",
      available: "Available medicines",
      responses: "Responses sent",
      avgResponse: "Average response time",
      subscription: "My subscription",
      paymentHistory: "Payment history",
      activityHistory: "Activity history",
      availablePrescriptions: "Available prescriptions",
      ocr: "OCR verification",
      configuration: "Configuration",
      activate: "Upgrade to active",
      reactivate: "Reactivate subscription",
      addMedication: "Add medicines",
      emptyStock: "No medicine in stock",
      emptyPrescription: "No prescription available",
      searchPlaceholder: "Search medicine, dosage, or prescription...",
      stockPage: "Stock page",
      prescriptionPage: "Prescription page",
      upgradeTitle: "Your pharmacy is currently on trial.",
      upgradeBody: "Payment methods and monthly pricing below stay synced with admin configuration.",
      settingsTitle: "Configuration details",
      settingsBody: "Pharmacy details and active payment methods are shown here in real time.",
    },
    rn: {
      title: "Dashboard ya Farumasi",
      subtitle: "Kugenzura stock, ordonnance n'abonnement mu kanya nyako.",
      refresh: "Subiramwo",
      stock: "Stock yanje",
      manageStock: "Tegeka stock",
      silentRefresh: "Biriko biravugururwa bucece...",
      totalStock: "Stock yose",
      available: "Imiti iboneka",
      responses: "Inyishu zatanzwe",
      avgResponse: "Igihe co kwishura",
      subscription: "Abonnement yanje",
      paymentHistory: "Historique y'ukwishyura",
      activityHistory: "Historique y'ibikorwa",
      availablePrescriptions: "Ordonnance ziboneka",
      ocr: "Verification OCR",
      configuration: "Configuration",
      activate: "Ca ku rwego rukora",
      reactivate: "Subira wishure",
      addMedication: "Shiramwo imiti",
      emptyStock: "Nta muti uri muri stock",
      emptyPrescription: "Nta ordonnance iboneka",
      searchPlaceholder: "Rondera umuti, dosage canke ordonnance...",
      stockPage: "Page ya stock",
      prescriptionPage: "Page y'ordonnance",
      upgradeTitle: "Farumasi yawe iri mu kiringo c'essai.",
      upgradeBody: "Uburyo bwo kwishura n'igiciro birajanye n'amasetingi ya admin.",
      settingsTitle: "Amakuru ya configuration",
      settingsBody: "Amakuru ya farumasi n'uburyo bwo kwishura biboneka hano mu kanya nyako.",
    },
    sw: {
      title: "Dashboard ya Duka la Dawa",
      subtitle: "Udhibiti wa stock, preskripsheni na usajili kwa wakati halisi.",
      refresh: "Onyesha upya",
      stock: "Stock yangu",
      manageStock: "Dhibiti stock",
      silentRefresh: "Inasasishwa kimya kimya...",
      totalStock: "Jumla ya stock",
      available: "Dawa zinazopatikana",
      responses: "Majibu yaliyotumwa",
      avgResponse: "Muda wa wastani wa majibu",
      subscription: "Usajili wangu",
      paymentHistory: "Historia ya malipo",
      activityHistory: "Historia ya shughuli",
      availablePrescriptions: "Preskripsheni zilizopo",
      ocr: "Uhakiki wa OCR",
      configuration: "Mipangilio",
      activate: "Nenda hali hai",
      reactivate: "Rejesha usajili",
      addMedication: "Ongeza dawa",
      emptyStock: "Hakuna dawa kwenye stock",
      emptyPrescription: "Hakuna preskripsheni",
      searchPlaceholder: "Tafuta dawa, dozi au preskripsheni...",
      stockPage: "Ukurasa wa stock",
      prescriptionPage: "Ukurasa wa preskripsheni",
      upgradeTitle: "Duka lako liko kwenye jaribio.",
      upgradeBody: "Njia za malipo na bei ya mwezi vinafuata mipangilio ya admin.",
      settingsTitle: "Maelezo ya mipangilio",
      settingsBody: "Taarifa za duka na njia za malipo huonekana hapa moja kwa moja.",
    },
    ln: {
      title: "Dashboard ya Pharmacie",
      subtitle: "Kokamba stock, ordonnance mpe abonnement na tango ya solo.",
      refresh: "Zongisa sika",
      stock: "Stock na ngai",
      manageStock: "Bongisa stock",
      silentRefresh: "Ezali kozongisama malembe...",
      totalStock: "Stock nyonso",
      available: "Nkisi oyo ezali",
      responses: "Biyano epesami",
      avgResponse: "Ntango ya eyano ya moyenne",
      subscription: "Abonnement na ngai",
      paymentHistory: "Historique ya paiement",
      activityHistory: "Historique ya misala",
      availablePrescriptions: "Ba ordonnance oyo ezali",
      ocr: "Verification OCR",
      configuration: "Configuration",
      activate: "Koma actif",
      reactivate: "Zongisa abonnement",
      addMedication: "Bakisa nkisi",
      emptyStock: "Stock ezali pamba",
      emptyPrescription: "Ordonnance ezali te",
      searchPlaceholder: "Luka nkisi, dosage to ordonnance...",
      stockPage: "Page ya stock",
      prescriptionPage: "Page ya ordonnance",
      upgradeTitle: "Pharmacie na yo ezali na essai.",
      upgradeBody: "Ba paiement mpe motuya ya sanza ezali kokende na configuration ya admin.",
      settingsTitle: "Ba informations ya configuration",
      settingsBody: "Ba details ya pharmacie mpe paiement actifs emonanaka awa na tango ya solo.",
    },
  }[language];

  useEffect(() => {
    void loadDashboardData();
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
      await loadDashboardData(false, true);
    };

    const scheduleBackgroundRefresh = () => {
      const now = Date.now();
      const elapsed = now - lastBackgroundRefreshAtRef.current;
      if (elapsed >= 12000 && !refreshInFlightRef.current) {
        lastBackgroundRefreshAtRef.current = now;
        void refreshDashboardData();
        return;
      }
      if (backgroundRefreshTimerRef.current) {
        return;
      }
      backgroundRefreshTimerRef.current = window.setTimeout(() => {
        backgroundRefreshTimerRef.current = null;
        lastBackgroundRefreshAtRef.current = Date.now();
        void refreshDashboardData();
      }, Math.max(1800, 12000 - elapsed));
    };

    const connect = () => {
      if (shouldUsePollingFallback) {
        pollingTimer = window.setInterval(() => {
          scheduleBackgroundRefresh();
        }, 15000);
        return;
      }

      socket = new WebSocket(getChatWebSocketUrl("public-feed"));
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as { type?: string; event_type?: string };
          if (parsed.type === "feed.event" && parsed.event_type && PHARMACY_DASHBOARD_REFRESH_EVENTS.has(parsed.event_type)) {
            scheduleBackgroundRefresh();
          }
        } catch {
          // Ignore malformed feed payloads without forcing a full dashboard refresh.
        }
      };
      socket.onclose = () => {
        reconnectTimer = window.setTimeout(connect, 2500);
      };
    };

    connect();

    return () => {
      if (pollingTimer) {
        window.clearInterval(pollingTimer);
      }
      if (backgroundRefreshTimerRef.current) {
        window.clearTimeout(backgroundRefreshTimerRef.current);
      }
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, []);

  useEffect(() => {
    setStockPage(1);
    setPrescriptionPage(1);
  }, [searchTerm, activeSection]);

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearchTerm = deferredSearchTerm.trim().toLowerCase();

  useEffect(() => {
    if (activeSection === "activate") {
      setShowActivationForm(true);
    }
  }, [activeSection]);

  async function loadDashboardData(withLoader = true, silent = false) {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    if (withLoader || !stock.length) {
      setIsLoading(true);
    } else if (!silent) {
      setIsRefreshing(true);
    }

    try {
      const [stockData, dashboard, subscriptionData, paymentData, profile] = await Promise.all([
        fetchPharmacyStock(),
        fetchDashboard(),
        fetchPharmacySubscription().catch(() => null),
        fetchSubscriptionPayments().catch(() => []),
        fetchProfile(),
      ]);

      const currentPharmacyId = profile.profile?.pharmacy;
      const currentName = profile.profile?.pharmacy_name || profile.username || "Pharmacie";
      const pharmacyRegistrationDate =
        parseValidDate(profile.profile?.pharmacy_created_at) ??
        parseValidDate(profile.profile?.created_at);

      const prescriptionData = (dashboard.prescriptions ?? []).filter((item) => {
        const belongsToCurrentPharmacy = item.pharmacy === currentPharmacyId;
        const visibleGlobalStatuses = ["uploaded", "analyzing", "confirmed", "confirmed_unavailable", "searching", "confirmation_pending"];
        const visibleAssignedStatuses = ["pharmacy_selected", "preparing", "ready", "served", "patient_confirmed", "completed"];
        const canDisplayForPharmacy =
          belongsToCurrentPharmacy ||
          visibleGlobalStatuses.includes(item.status) ||
          (visibleAssignedStatuses.includes(item.status) && belongsToCurrentPharmacy);

        if (!canDisplayForPharmacy) {
          return false;
        }

        if (!pharmacyRegistrationDate) {
          return true;
        }

        const prescriptionCreatedAt = parseValidDate(item.created_at);
        if (!prescriptionCreatedAt) {
          return false;
        }

        return prescriptionCreatedAt >= pharmacyRegistrationDate;
      });

      const nextSnapshot = JSON.stringify({
        currentPharmacyId,
        currentName,
        profileImage: profile.profile?.pharmacy_image ?? null,
        profileMeta: [profile.profile?.address || profile.profile?.pharmacy_city || "", pharmacyRegistrationDate?.toISOString() ?? "", profile.profile?.last_seen ?? "", profile.profile?.pharmacy_is_online ?? profile.profile?.is_online ?? false, language],
        stock: stockData,
        prescriptions: prescriptionData.map((item) => [item.id, item.status, item.pharmacy, item.created_at, item.public_reference ?? null, item.pharmacy_name ?? null]),
        payments: paymentData,
        subscriptionStatus: subscriptionData?.subscription_status ?? null,
        rewardProgram: subscriptionData?.reward_program ?? null,
        kpis: {
          total_stock: stockData.length,
          available_medications: (stockData as StockItem[]).filter((item) => item.is_available).length,
          total_responses: dashboard.responses?.length ?? 0,
          avg_response_time: dashboard.kpis?.response_time_minutes ?? 0,
        },
      });

      if (nextSnapshot === lastSnapshotRef.current) {
        return;
      }

      lastSnapshotRef.current = nextSnapshot;
      startTransition(() => {
        setCurrentPharmacyId(currentPharmacyId ?? null);
        setProfileName(currentName);
        setProfileMeta(
          [
            formatPresenceLabel(profile.profile?.pharmacy_is_online ?? profile.profile?.is_online, profile.profile?.last_seen, language),
            profile.profile?.address || profile.profile?.pharmacy_city || "",
            pharmacyRegistrationDate ? `Inscrite le ${formatExactDateTime(pharmacyRegistrationDate, language)}` : "",
          ]
            .filter(Boolean)
            .join(" • ")
        );
        setProfileImageUrl(resolveMediaUrl(profile.profile?.pharmacy_image) ?? null);
        setProfileIsOnline(Boolean(profile.profile?.pharmacy_is_online ?? profile.profile?.is_online));
        setStock(stockData as StockItem[]);
        setPrescriptions(prescriptionData);
        setSubscription(subscriptionData);
        setPayments(paymentData as PaymentRecord[]);
        setKpis({
          total_stock: stockData.length,
          available_medications: (stockData as StockItem[]).filter((item) => item.is_available).length,
          total_responses: dashboard.responses?.length ?? 0,
          avg_response_time: dashboard.kpis?.response_time_minutes ?? 0,
        });
      });
    } catch (error) {
      void error;
      logClientError("Le chargement du tableau de bord pharmacie a echoue.");
    } finally {
      refreshInFlightRef.current = false;
      if (withLoader || !stock.length) {
        setIsLoading(false);
      }
      if (!silent) {
        setIsRefreshing(false);
      }
    }
  }

  async function handleOpenDocument(prescription: PrescriptionRecord) {
    const documentUrl = getPrescriptionDocumentUrl(prescription);
    if (!documentUrl) {
      return;
    }

    try {
      const protectedDocument = await fetchProtectedDocument(documentUrl);
      setDocumentViewer({
        src: protectedDocument.src,
        title: `${prescription.medication_name || "Ordonnance medicale"} • ${getPrescriptionReference(prescription)}`,
        contentType: protectedDocument.contentType,
        fileName: protectedDocument.fileName,
      });
    } catch (documentError) {
      void documentError;
      logClientError("L'ouverture du document ordonnance pharmacie a echoue.");
    }
  }

  async function handlePrescriptionServedConfirm(prescription: PrescriptionRecord) {
    if (!canPharmacyConfirmPrescription(prescription, currentPharmacyId)) {
      return;
    }

    const confirmed = window.confirm(
      `Confirmer que l'ordonnance ${getPrescriptionReference(prescription)} a bien ete servie ou classee ?`
    );
    if (!confirmed) {
      return;
    }

    setConfirmBusyId(prescription.id);
    try {
      await confirmPharmacyServedPrescription(prescription.id, {
        notes: `Ordonnance ${getPrescriptionReference(prescription)} confirmee comme servie depuis le dashboard pharmacie.`,
      });
      setCopyFeedback("Ordonnance marquee comme servie.");
      await loadDashboardData(false);
    } catch (confirmError) {
      void confirmError;
      logClientError("La confirmation de service ordonnance pharmacie a echoue.");
      setCopyFeedback("Impossible de confirmer cette ordonnance pour le moment.");
    } finally {
      setConfirmBusyId(null);
    }
  }

  function triggerProfileFlow() {
    if (onRequestProfileOpen) {
      onRequestProfileOpen();
      return;
    }
    window.dispatchEvent(new CustomEvent("open-profile-modal"));
  }

  function updateStockMetrics(nextStock: StockItem[]) {
    setKpis((current) => ({
      ...current,
      total_stock: nextStock.length,
      available_medications: nextStock.filter((item) => item.is_available).length,
    }));
  }

  async function handleStockQuantityAdjust(item: StockItem, delta: number) {
    const nextQuantity = Math.max(0, item.quantity + delta);
    if (nextQuantity === item.quantity) {
      return;
    }

    setStockActionBusyId(item.id);
    try {
      const payload = {
        quantity: nextQuantity,
        is_available: nextQuantity > 0,
      };
      await patchPharmacyStockItem(item.id, payload);
      setStock((current) => {
        const nextStock = current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                quantity: nextQuantity,
                is_available: nextQuantity > 0,
              }
            : entry
        );
        updateStockMetrics(nextStock);
        return nextStock;
      });
    } catch (error) {
      void error;
      logClientError("La mise a jour rapide du stock pharmacie a echoue.");
    } finally {
      setStockActionBusyId(null);
    }
  }

  async function handleStockDelete(item: StockItem) {
    if (!window.confirm(`Supprimer ${item.medication_name} du stock ?`)) {
      return;
    }

    setStockActionBusyId(item.id);
    try {
      await deletePharmacyStockItem(item.id);
      setStock((current) => {
        const nextStock = current.filter((entry) => entry.id !== item.id);
        updateStockMetrics(nextStock);
        return nextStock;
      });
    } catch (error) {
      void error;
      logClientError("La suppression rapide du stock pharmacie a echoue.");
    } finally {
      setStockActionBusyId(null);
    }
  }

  function handleStockEdit(item: StockItem) {
    setActiveSection("manage-stock");
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("pharmacy-stock:edit", {
          detail: {
            id: item.id,
            item,
          },
        })
      );
    }, 0);
  }

  function handleStockAdd() {
    setActiveSection("add-medication");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("pharmacy-stock:add"));
    }, 0);
  }

  function checkMedicationAvailability(prescription: PrescriptionRecord) {
    const medications = Array.isArray(prescription.extracted_medications) ? prescription.extracted_medications : [];
    let available = 0;
    let missing = 0;

    medications.forEach((med) => {
      const inStock = stock.some(
        (item) =>
          item.is_available &&
          (item.medication_name.toLowerCase().includes(med.name.toLowerCase()) ||
            med.name.toLowerCase().includes(item.medication_name.toLowerCase()))
      );
      if (inStock) {
        available += 1;
      } else {
        missing += 1;
      }
    });

    const total = medications.length;
    return {
      available,
      missing,
      matchPercentage: total > 0 ? (available / total) * 100 : 0,
    };
  }

  useEffect(() => {
    if (!activationSuccess && !activationError) {
      return;
    }

    const timer = window.setTimeout(() => {
      setActivationSuccess(null);
      setActivationError(null);
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [activationError, activationSuccess]);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }

    const timer = window.setTimeout(() => setCopyFeedback(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!shareMenuRef.current?.contains(event.target as Node)) {
        setIsShareMenuOpen(false);
      }
    }

    if (!isShareMenuOpen) {
      return;
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isShareMenuOpen]);

  const enabledPaymentMethods = (subscription?.payment_details?.payment_methods ?? []).filter((item) => item.enabled);
  const selectedPaymentMethod = enabledPaymentMethods.find((item) => item.code === activationForm.payment_method) ?? null;
  const isTrialSubscription = subscription?.subscription_status === "trial";
  const hasActiveSubscription =
    subscription?.subscription_status === "active" ||
    (subscription?.subscription_status === "trial" && (subscription?.days_remaining ?? 0) > 0);
  const servedPrescriptions = prescriptions.filter((item) => ["served", "completed", "patient_confirmed"].includes(item.status));

  async function handleActivationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!subscription) {
      return;
    }

    if (
      !activationForm.payer_name.trim() ||
      !activationForm.payer_address.trim() ||
      !activationForm.sender_phone.trim() ||
      !activationForm.payment_method.trim() ||
      !activationForm.transaction_reference.trim() ||
      !activationForm.proof_image
    ) {
      setActivationError("Veuillez renseigner le nom, l'adresse, la reference, le numero expediteur et la preuve de paiement.");
      return;
    }

    if (!selectedPaymentMethod?.account_number) {
      setActivationError("Le moyen de paiement selectionne est incomplet. Verifiez la configuration admin.");
      return;
    }

    setActivationBusy(true);
    setActivationError(null);
    setActivationSuccess(null);

    try {
      const createdPayment = await createSubscriptionPayment({
        amount_usd: Number(subscription.monthly_price_usd),
        amount_bif: Number(subscription.monthly_price_bif ?? 0),
        currency: selectedPaymentMethod.currency || "BIF",
        payment_method: activationForm.payment_method,
        sender_phone: activationForm.sender_phone.trim(),
        receiver_phone: selectedPaymentMethod.account_number,
        transaction_reference: activationForm.transaction_reference.trim(),
        payment_month: new Date().toISOString().slice(0, 10),
        proof_image: activationForm.proof_image,
        payer_name: activationForm.payer_name.trim(),
        payer_address: activationForm.payer_address.trim(),
      });

      setPayments((current) => [createdPayment as PaymentRecord, ...current]);
      setActivationSuccess("Votre preuve de paiement a ete envoyee. Elle apparait maintenant dans les demandes en attente.");
      setActivationForm({
        payer_name: "",
        payer_address: "",
        sender_phone: "",
        payment_method: "",
        transaction_reference: "",
        proof_image: null,
      });
      setShowActivationForm(false);
    } catch (error) {
      void error;
      logClientError("La creation du paiement d'abonnement a echoue.");
      setActivationError("Impossible d'envoyer la preuve de paiement pour le moment.");
    } finally {
      setActivationBusy(false);
    }
  }

  const filteredStock = useMemo(
    () =>
      stock.filter((item) =>
        buildSearchIndex(
          [
            item.medication_name,
            item.generic_name ?? "",
            item.dosage ?? "",
            item.unit,
            item.price,
            item.quantity,
            item.sale_scope === "wholesale" ? "gros" : "detail",
            item.sale_scope,
            item.currency,
            item.is_available ? "disponible" : "indisponible",
          ],
          [item.last_updated]
        ).includes(normalizedSearchTerm)
      ),
    [normalizedSearchTerm, stock]
  );

  const filteredPrescriptions = useMemo(
    () =>
      prescriptions.filter((prescription) =>
        buildSearchIndex(
          [
            prescription.public_reference,
            getPrescriptionReference(prescription),
            prescription.medication_name,
            prescription.patient_name,
            prescription.status,
            getPharmacyPrescriptionStatusLabel(prescription.status),
            prescription.geo_zone,
            ...(prescription.extracted_medications ?? []).flatMap((item) => [item.name, item.dosage ?? "", item.form ?? "", item.posology ?? ""]),
          ],
          [prescription.created_at]
        ).includes(normalizedSearchTerm)
      ),
    [normalizedSearchTerm, prescriptions]
  );
  const ocrPrescriptions = useMemo(
    () => filteredPrescriptions.filter((item) => Boolean(item.extracted_medications?.length)),
    [filteredPrescriptions]
  );

  const stockPageCount = Math.max(1, Math.ceil(filteredStock.length / STOCK_PAGE_SIZE));
  const prescriptionPageCount = Math.max(1, Math.ceil(filteredPrescriptions.length / PRESCRIPTION_PAGE_SIZE));
  const pagedStock = filteredStock.slice((stockPage - 1) * STOCK_PAGE_SIZE, stockPage * STOCK_PAGE_SIZE);
  const pagedPrescriptions = filteredPrescriptions.slice(
    (prescriptionPage - 1) * PRESCRIPTION_PAGE_SIZE,
    prescriptionPage * PRESCRIPTION_PAGE_SIZE
  );

  const metrics = [
    { label: labels.totalStock, value: kpis.total_stock },
    { label: labels.available, value: kpis.available_medications },
    { label: labels.responses, value: kpis.total_responses },
    { label: labels.avgResponse, value: `${kpis.avg_response_time} min` },
  ];

  const highlights = [
    {
      title: stock[0]?.medication_name || labels.stock,
      helper: labels.stock,
      meta: stock[0]?.dosage || undefined,
    },
    {
      title: prescriptions[0]?.medication_name || labels.availablePrescriptions,
      helper: labels.availablePrescriptions,
      meta: prescriptions[0] ? `${checkMedicationAvailability(prescriptions[0]).matchPercentage.toFixed(0)}%` : undefined,
    },
  ];

  const navSections = [
    {
      title: language === "en" ? "Management" : "Gestion",
      items: [
        { id: "pharm-dashboard", label: "Dashboard", active: activeSection === "dashboard", onClick: () => setActiveSection("dashboard") },
        { id: "pharm-stock", label: labels.stock, active: activeSection === "stock", onClick: () => setActiveSection("stock") },
        {
          id: "pharm-rx",
          label: labels.availablePrescriptions,
          active: activeSection === "prescriptions",
          onClick: () => setActiveSection("prescriptions"),
        },
        {
          id: "pharm-ocr",
          label: labels.ocr,
          active: activeSection === "ocr",
          onClick: () => setActiveSection("ocr"),
        },
        {
          id: "pharm-subscription",
          label: labels.subscription,
          active: activeSection === "subscription",
          onClick: () => setActiveSection("subscription"),
        },
        {
          id: "pharm-payments-history",
          label: labels.paymentHistory,
          active: activeSection === "payment-history",
          onClick: () => setActiveSection("payment-history"),
        },
        {
          id: "pharm-ambassador",
          label: "Ambassadeur",
          active: activeSection === "ambassador",
          onClick: () => setActiveSection("ambassador"),
        },
        {
          id: "pharm-activity-history",
          label: labels.activityHistory,
          active: activeSection === "activity-history",
          onClick: () => setActiveSection("activity-history"),
        },
      ],
    },
    {
      title: language === "en" ? "Actions" : "Actions",
      items: [
        {
          id: "pharm-manage-stock",
          label: labels.manageStock,
          active: activeSection === "manage-stock",
          onClick: () => setActiveSection(hasActiveSubscription ? "manage-stock" : "activate"),
        },
        {
          id: "pharm-activate",
          label: labels.activate,
          active: activeSection === "activate",
          onClick: () => setActiveSection("activate"),
        },
      ],
    },
  ];

  const footerSections = [
    {
      title: language === "en" ? "Profile" : "Profil",
      items: [
        {
          id: "pharm-configuration",
          label: labels.configuration,
          active: activeSection === "configuration",
          onClick: () => setActiveSection("configuration"),
        },
      ],
    },
  ];

  if (isLoading) {
    return <div className="loading-state">Chargement du dashboard...</div>;
  }

  return (
    <DashboardScaffold
      brand="PHARMIGO"
      pageTitle={labels.title}
      pageSubtitle={labels.subtitle}
      roleLabel="PHARMIGO PHARMACY"
      searchPlaceholder={labels.searchPlaceholder}
      searchValue={searchTerm}
      onSearchChange={setSearchTerm}
      profileLabel={profileName}
      profileMeta={isRefreshing ? labels.silentRefresh : profileMeta || labels.stock}
      profileImageUrl={profileImageUrl}
      profileIsOnline={profileIsOnline}
      navSections={navSections}
      footerSections={footerSections}
      metrics={metrics}
      highlights={highlights}
      topbarActions={
        <button
          className="dashboard-icon-button dashboard-refresh-button"
          onClick={() => void loadDashboardData()}
          aria-label={labels.refresh}
          title={labels.refresh}
          type="button"
        >
          <RefreshGlyph />
        </button>
      }
      heroActions={
        <>
          <button
            className="secondary-button dashboard-wide-action"
            onClick={() => {
              setActiveSection(hasActiveSubscription ? "manage-stock" : "activate");
            }}
            type="button"
          >
            {hasActiveSubscription ? labels.manageStock : labels.reactivate}
          </button>
        </>
      }
    >
      {activeSection === "dashboard" ? (
        <>
          <DashboardPanel
            title={labels.stock}
            description={language === "en" ? "Instant filtering with live stock updates." : "Filtrage instantane avec mise a jour en temps reel du stock."}
          >
            <div className="dashboard-stock-summary-actions">
              <button type="button" className="secondary-button" onClick={() => setActiveSection("manage-stock")}>
                {labels.manageStock}
              </button>
              <button type="button" className="primary-button" onClick={handleStockAdd}>
                {labels.addMedication}
              </button>
            </div>
            {pagedStock.length === 0 ? (
              <div className="empty-state">{labels.emptyStock}</div>
            ) : (
              <div className="stock-grid dashboard-stock-summary">
                {pagedStock.map((item) => (
                  <article key={item.id} className="stock-row-card dashboard-stock-row-card">
                    <div className="stock-row-main dashboard-stock-row-main">
                      <div className="stock-row-title">
                        <strong>{item.medication_name}</strong>
                        {item.generic_name ? <small>{item.generic_name}</small> : null}
                      </div>
                      <span className="stock-row-dosage">{item.dosage || "-"}</span>
                      <div className="stock-quantity-controls">
                        <button
                          type="button"
                          className="icon-button compact"
                          onClick={() => void handleStockQuantityAdjust(item, -1)}
                          disabled={stockActionBusyId === item.id || item.quantity <= 0}
                          aria-label={`Reduire la quantite de ${item.medication_name}`}
                        >
                          <MinusGlyph />
                        </button>
                        <strong>{item.quantity}</strong>
                        <button
                          type="button"
                          className="icon-button compact"
                          onClick={() => void handleStockQuantityAdjust(item, 1)}
                          disabled={stockActionBusyId === item.id}
                          aria-label={`Augmenter la quantite de ${item.medication_name}`}
                        >
                          <PlusGlyph />
                        </button>
                      </div>
                      <span className="stock-row-unit">{item.unit}</span>
                      <span className="badge info">{formatSaleScopeLabel(item.sale_scope)}</span>
                      <span className="stock-row-price">{formatCurrencyValue(item.price, item.currency)} / {item.unit}</span>
                      <span className={`badge ${item.is_available ? "success" : "warning"}`}>{item.is_available ? "Disponible" : "Indisponible"}</span>
                      <div className="stock-row-actions">
                        <button
                          type="button"
                          className="icon-button compact"
                          onClick={() => handleStockEdit(item)}
                          title="Modifier"
                          aria-label={`Modifier ${item.medication_name}`}
                          disabled={stockActionBusyId === item.id}
                        >
                          <PencilGlyph />
                        </button>
                        <button
                          type="button"
                          className="icon-button compact delete"
                          onClick={() => void handleStockDelete(item)}
                          title="Supprimer"
                          aria-label={`Supprimer ${item.medication_name}`}
                          disabled={stockActionBusyId === item.id}
                        >
                          <TrashGlyph />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <PaginationControls
              label={labels.stockPage}
              page={stockPage}
              totalPages={stockPageCount}
              onPageChange={setStockPage}
            />
          </DashboardPanel>

          <DashboardPanel
            title={labels.availablePrescriptions}
            description={language === "en" ? "Matching prescriptions connected to live stock." : "Ordonnances reliees au stock en temps reel."}
            className="dashboard-panel-span-2"
          >
            <AvailablePrescriptionList
              stock={stock}
              prescriptions={pagedPrescriptions}
              language={language}
              emptyText={labels.emptyPrescription}
              viewOriginalLabel="Voir l'ordonnance originale"
              onOpenDocument={handleOpenDocument}
              currentPharmacyId={currentPharmacyId}
              onConfirmPrescription={handlePrescriptionServedConfirm}
              confirmBusyId={confirmBusyId}
            />
            <PaginationControls
              label={labels.prescriptionPage}
              page={prescriptionPage}
              totalPages={prescriptionPageCount}
              onPageChange={setPrescriptionPage}
            />
          </DashboardPanel>
        </>
      ) : null}

      {activeSection === "stock" || activeSection === "manage-stock" || activeSection === "add-medication" ? (
        <DashboardPanel
          title={activeSection === "add-medication" ? labels.addMedication : labels.manageStock}
          description={language === "en" ? "Open the stock CRUD and keep search synced with the dashboard." : "Ouvrez le CRUD stock et gardez la recherche synchronisee avec le dashboard."}
          className="dashboard-panel-span-3"
        >
          {hasActiveSubscription ? (
            <>
              <PharmacyStockManager embedded onStockUpdated={() => void loadDashboardData(false)} />
            </>
          ) : (
            <div className="dashboard-summary-stack">
              <p className="form-feedback error">Votre abonnement a expire. Les fonctions de vente sont masquees tant que la reactivation n'est pas validee.</p>
              <button type="button" className="primary-button" onClick={() => setActiveSection("activate")}>
                {labels.reactivate}
              </button>
            </div>
          )}
        </DashboardPanel>
      ) : null}

      {activeSection === "prescriptions" ? (
        <DashboardPanel
          title={labels.availablePrescriptions}
          description={language === "en" ? "Original prescriptions remain available with their secure documents." : "Les ordonnances originales restent disponibles avec leurs documents securises."}
          className="dashboard-panel-span-3"
        >
          {hasActiveSubscription ? (
            <>
              <AvailablePrescriptionList
                stock={stock}
                prescriptions={pagedPrescriptions}
                language={language}
                emptyText={labels.emptyPrescription}
                viewOriginalLabel="Voir l'ordonnance originale"
                onOpenDocument={handleOpenDocument}
                currentPharmacyId={currentPharmacyId}
                onConfirmPrescription={handlePrescriptionServedConfirm}
                confirmBusyId={confirmBusyId}
              />
              <PaginationControls
                label={labels.prescriptionPage}
                page={prescriptionPage}
                totalPages={prescriptionPageCount}
                onPageChange={setPrescriptionPage}
              />
            </>
          ) : (
            <div className="dashboard-summary-stack">
              <p className="form-feedback error">Votre abonnement n'est plus actif. Reactivez-le pour servir de nouvelles ordonnances.</p>
              <button type="button" className="primary-button" onClick={() => setActiveSection("activate")}>
                {labels.reactivate}
              </button>
            </div>
          )}
        </DashboardPanel>
      ) : null}

      {activeSection === "ocr" ? (
        <DashboardPanel
          title={labels.ocr}
          description={language === "en" ? "Confirmed medicines stay available here with the same public references." : "Les medicaments confirmes restent disponibles ici avec les memes references publiques."}
          className="dashboard-panel-span-3"
        >
          {hasActiveSubscription ? (
            <>
              <PrescriptionOcrList
                stock={stock}
                prescriptions={ocrPrescriptions.slice((prescriptionPage - 1) * PRESCRIPTION_PAGE_SIZE, prescriptionPage * PRESCRIPTION_PAGE_SIZE)}
                emptyText={labels.emptyPrescription}
              />
              <PaginationControls
                label={labels.prescriptionPage}
                page={prescriptionPage}
                totalPages={Math.max(1, Math.ceil(ocrPrescriptions.length / PRESCRIPTION_PAGE_SIZE))}
                onPageChange={setPrescriptionPage}
              />
            </>
          ) : (
            <div className="dashboard-summary-stack">
              <p className="form-feedback error">Votre abonnement n'est plus actif. Reactivez-le pour analyser et servir les ordonnances.</p>
              <button type="button" className="primary-button" onClick={() => setActiveSection("activate")}>
                {labels.reactivate}
              </button>
            </div>
          )}
        </DashboardPanel>
      ) : null}

      {activeSection === "payment-history" ? (
        <DashboardPanel
          title={labels.paymentHistory}
          description={language === "en" ? "Subscription payment timeline and verification status." : "Suivi des paiements d'abonnement et de leur validation."}
          className="dashboard-panel-span-3"
        >
          {payments.length ? (
            <div className="pharmacy-message-feed">
              {payments.map((payment) => (
                <article key={`payment-history-${payment.id}`} className="landing-notification-item">
                  <strong>{payment.payment_method} - {payment.payment_status}</strong>
                  <p>{payment.amount_bif} {payment.currency}</p>
                  <small>{payment.transaction_reference || "Reference manquante"} • {formatExactDateTime(payment.created_at, language)}</small>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">Aucun paiement enregistre pour le moment.</div>
          )}
        </DashboardPanel>
      ) : null}

      {activeSection === "ambassador" ? (
        <DashboardPanel
          title="Section ambassadeur"
          description="Un seul lien unique par pharmacie pour parrainer, suivre et activer de nouvelles pharmacies dans le reseau."
          className="dashboard-panel-span-3 dashboard-keep-visible"
        >
          <div className="dashboard-summary-stack dashboard-ambassador-grid">
            <div className="dashboard-data-block dashboard-ambassador-stat">
              <span>Lien officiel de parrainage</span>
              <strong className="dashboard-mono-text">{subscription?.reward_program?.referral_link || "Lien indisponible"}</strong>
              <small>
                Ce lien unique contient deja votre code de parrainage. Toute nouvelle pharmacie inscrite via ce lien sera marquee comme
                parrainee par votre pharmacie.
              </small>
              <div className="dashboard-ambassador-link-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    void copyRewardValue(
                      subscription?.reward_program?.referral_link || "",
                      "Lien de parrainage copie !",
                      "Lien indisponible."
                    )
                  }
                >
                  Copier le lien de parrainage
                </button>
                <div ref={shareMenuRef} className="dashboard-ambassador-inline-actions">
                  <div className={`dashboard-ambassador-share-wrap${isShareMenuOpen ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="dashboard-ambassador-share-button"
                      aria-label="Partager le lien de parrainage"
                      title="Partager le lien de parrainage"
                      onClick={() => setIsShareMenuOpen((current) => !current)}
                    >
                      <ShareGlyph />
                    </button>
                    {isShareMenuOpen ? (
                      <div className="dashboard-ambassador-share-menu" role="menu" aria-label="Partager le lien de parrainage">
                        <button type="button" className="dashboard-ambassador-share-option" onClick={() => openSocialShare("whatsapp")}>
                          <span className="dashboard-ambassador-share-icon whatsapp"><WhatsAppGlyph /></span>
                          <span>WhatsApp</span>
                        </button>
                        <button type="button" className="dashboard-ambassador-share-option" onClick={() => openSocialShare("facebook")}>
                          <span className="dashboard-ambassador-share-icon facebook"><FacebookGlyph /></span>
                          <span>Facebook</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              {copyFeedback ? <p className="dashboard-ambassador-feedback">{copyFeedback}</p> : null}
            </div>
            <div className="dashboard-data-block dashboard-ambassador-stat">
              <span>Progression</span>
              <strong>
                {subscription?.reward_program?.validated_count ?? 0} / {subscription?.reward_program?.threshold ?? 20} pharmacies validees
              </strong>
              <div className="dashboard-chart-progress" aria-hidden="true">
                <span
                  className="dashboard-chart-progress-fill"
                  style={{ width: `${Math.round((subscription?.reward_program?.progress_ratio ?? 0) * 100)}%` }}
                />
              </div>
            </div>
            <div className="dashboard-data-block dashboard-ambassador-stat">
              <span>Evenements visibles</span>
              {(subscription?.reward_program?.events ?? []).length ? (
                <div className="dashboard-ambassador-event-list">
                  {(subscription?.reward_program?.events ?? []).map((eventItem) => (
                    <article key={eventItem.id} className="dashboard-ambassador-event-card">
                      <div className="dashboard-record-head">
                        <strong>{eventItem.title}</strong>
                        <span className={`badge ${eventItem.status === "active" ? "success" : eventItem.status === "upcoming" ? "info" : "warning"}`}>
                          {formatRewardEventStatus(eventItem.status)}
                        </span>
                      </div>
                      <p>{eventItem.summary}</p>
                      <small>
                        Activite minimale: {eventItem.min_activity_count} ordonnances • Limite appareil/jour: {eventItem.device_daily_limit}
                      </small>
                      <small>
                        {eventItem.start ? `Debut: ${formatExactDateTime(eventItem.start, language)}` : "Debut non defini"} •{" "}
                        {eventItem.end ? `Fin: ${formatExactDateTime(eventItem.end, language)}` : "Fin non definie"}
                      </small>
                    </article>
                  ))}
                </div>
              ) : (
                <p>Aucun evenement visible pour le moment.</p>
              )}
            </div>
            <div className="dashboard-data-block dashboard-data-block-info dashboard-ambassador-guide">
              <span>{subscription?.reward_program?.guide_title || "Guide officiel de la promotion ambassadeur PharmiGo"}</span>
              <p className="dashboard-ambassador-guide-body">
                {subscription?.reward_program?.instructions || "Aucune instruction definie pour l'evenement pour le moment."}
              </p>
              <div className="dashboard-ambassador-guide-summary">
                <div className="dashboard-ambassador-guide-chip">
                  <span>Seuil valide</span>
                  <strong>{subscription?.reward_program?.threshold ?? 20} pharmacies</strong>
                </div>
                <div className="dashboard-ambassador-guide-chip">
                  <span>Recompense</span>
                  <strong>+{subscription?.reward_program?.bonus_days ?? 90} jours gratuits</strong>
                </div>
              </div>
              <div className="dashboard-ambassador-guide-footer">
                <small>
                  {subscription?.reward_program?.event_window?.start ? `Debut: ${formatExactDateTime(subscription.reward_program.event_window.start, language)}` : "Debut non defini"}
                  {" • "}
                  {subscription?.reward_program?.event_window?.end ? `Fin: ${formatExactDateTime(subscription.reward_program.event_window.end, language)}` : "Fin non definie"}
                </small>
                <button
                  type="button"
                  className="dashboard-ambassador-guide-copy"
                  onClick={() =>
                    void copyRewardValue(
                      buildRewardGuideCopyText(subscription?.reward_program, language),
                      "Guide officiel copie !",
                      "Guide indisponible."
                    )
                  }
                >
                  Copier le guide
                </button>
              </div>
            </div>
            <div className="dashboard-record-list">
              {(subscription?.reward_program?.referrals ?? []).length ? (
                (subscription?.reward_program?.referrals ?? []).map((referral) => (
                  <article key={`pharm-referral-${referral.id}`} className="dashboard-record-card">
                    <div className="dashboard-record-head">
                      <div>
                        <strong>{referral.pharmacy_name || "Pharmacie filleule"}</strong>
                        <small>{formatExactDateTime(referral.created_at, language)}</small>
                      </div>
                      <span className={`badge ${referral.status === "validated" || referral.status === "rewarded" ? "success" : referral.status === "fraud_blocked" ? "warning" : "info"}`}>
                        {getReferralStatusLabel(referral.status)}
                      </span>
                    </div>
                    <div className="dashboard-summary-row">
                      <span>Ordonnances reelles traitees</span>
                      <strong>{referral.validated_activity_count}</strong>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">Aucun parrainage enregistre pour le moment.</div>
              )}
            </div>
          </div>
        </DashboardPanel>
      ) : null}

      {activeSection === "activity-history" ? (
        <DashboardPanel
          title={labels.activityHistory}
          description={language === "en" ? "Successfully served prescriptions and completed activity." : "Ordonnances servies avec succes et activites terminees."}
          className="dashboard-panel-span-3"
        >
          {servedPrescriptions.length ? (
            <div className="dashboard-record-list">
              {servedPrescriptions.map((prescription) => (
                <article key={`activity-${prescription.id}`} className="dashboard-record-card">
                  <div className="dashboard-record-head">
                    <div>
                      <strong>{prescription.medication_name}</strong>
                      <small>
                        <span className="public-reference-badge">{prescription.public_reference || `ORD-${String(prescription.id).padStart(6, "0")}`}</span>
                        {prescription.geo_zone ? ` • ${prescription.geo_zone}` : ""}
                      </small>
                    </div>
                    <span className="badge success">{prescription.status}</span>
                  </div>
                  <div className="stock-item-details">
                    <span>{formatExactDateTime(prescription.created_at, language)}</span>
                    <span>{prescription.pharmacy_name || profileName}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">Aucune ordonnance servie avec succes pour le moment.</div>
          )}
        </DashboardPanel>
      ) : null}

      {activeSection === "subscription" || activeSection === "activate" ? (
        <DashboardPanel
          title={activeSection === "activate" ? labels.activate : labels.subscription}
          description={language === "en" ? "Live subscription information and payment channels." : "Informations d'abonnement et moyens de paiement en direct."}
          className="dashboard-panel-span-3"
        >
          {subscription ? (
            <div className="subscription-info">
              <div className="subscription-status">
                <span className={`badge ${subscription.subscription_status === "active" ? "success" : subscription.subscription_status === "trial" ? "info" : "warning"}`}>
                  {subscription.subscription_status}
                </span>
                <span className="days-remaining">{subscription.days_remaining} jours restants</span>
              </div>
              <div className="subscription-pricing">
                <div className="price-row">
                  <span>Prix mensuel</span>
                  <span>${Number(subscription.monthly_price_usd).toFixed(2)} USD / {Number(subscription.monthly_price_bif ?? 0).toFixed(0)} BIF</span>
                </div>
                <div className="price-row">
                  <span>Taux utilise</span>
                  <span>1 USD = {Number(subscription.current_exchange_rate_bif).toFixed(0)} BIF</span>
                </div>
                <div className="price-row">
                  <span>Essai</span>
                  <span>{formatExactDateTime(subscription.trial_start_date, language)} → {formatExactDateTime(subscription.trial_end_date, language)}</span>
                </div>
              </div>
              {isTrialSubscription ? (
                <div className="subscription-upgrade-banner">
                  <strong>{labels.upgradeTitle}</strong>
                  <p>{labels.upgradeBody}</p>
                </div>
              ) : null}
              <div className="subscription-payment-box">
                {(subscription.payment_details?.payment_methods ?? []).filter((item) => item.enabled).map((method) => (
                  <p key={method.code}>
                    <strong>{method.label}</strong>: {method.account_number || "N/A"} {method.account_name ? `• ${method.account_name}` : ""}
                    {method.instructions ? ` • ${method.instructions}` : ""}
                  </p>
                ))}
              </div>
              {activationSuccess ? <p className="form-feedback success">{activationSuccess}</p> : null}
              {activationError ? <p className="form-feedback error">{activationError}</p> : null}
              {isTrialSubscription ? (
                <div className="subscription-activation-panel">
                  <div className="dashboard-panel-head">
                    <h3>Activer l'abonnement</h3>
                    <button type="button" className="primary-button" onClick={() => setShowActivationForm((current) => !current)}>
                      {showActivationForm ? "Fermer le formulaire" : "Activer l'abonnement"}
                    </button>
                  </div>
                  <p className="subscription-activation-copy">
                    Payez avec l'un des moyens ci-dessus, puis envoyez votre nom, votre adresse et la capture d'ecran du succes du paiement.
                  </p>
                  {showActivationForm ? (
                    <form className="subscription-activation-form" onSubmit={handleActivationSubmit}>
                      <div className="form-row">
                        <label>
                          <span>Nom du payeur</span>
                          <input value={activationForm.payer_name} onChange={(event) => setActivationForm((current) => ({ ...current, payer_name: event.target.value }))} />
                        </label>
                        <label>
                          <span>Adresse</span>
                          <input value={activationForm.payer_address} onChange={(event) => setActivationForm((current) => ({ ...current, payer_address: event.target.value }))} />
                        </label>
                      </div>
                      <div className="form-row">
                        <label>
                          <span>Numero expediteur</span>
                          <input value={activationForm.sender_phone} onChange={(event) => setActivationForm((current) => ({ ...current, sender_phone: event.target.value }))} />
                        </label>
                        <label>
                          <span>Moyen de paiement</span>
                          <select value={activationForm.payment_method} onChange={(event) => setActivationForm((current) => ({ ...current, payment_method: event.target.value }))}>
                            <option value="">Selectionnez</option>
                            {enabledPaymentMethods.map((method) => (
                              <option key={method.code} value={method.code}>
                                {method.label} ({method.currency})
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="form-row">
                        <label>
                          <span>Reference de transaction</span>
                          <input value={activationForm.transaction_reference} onChange={(event) => setActivationForm((current) => ({ ...current, transaction_reference: event.target.value }))} />
                        </label>
                        <label>
                          <span>Capture du paiement</span>
                          <input type="file" accept="image/*" onChange={(event) => setActivationForm((current) => ({ ...current, proof_image: event.target.files?.[0] ?? null }))} />
                        </label>
                      </div>
                      <div className="subscription-activation-summary">
                        <span>Montant attendu</span>
                        <strong>{Number(subscription.monthly_price_bif ?? 0).toFixed(0)} BIF / ${Number(subscription.monthly_price_usd).toFixed(2)} USD</strong>
                        <span>Reception</span>
                        <strong>{selectedPaymentMethod?.account_number || "Selectionnez un moyen"}</strong>
                      </div>
                      <button type="submit" className="primary-button" disabled={activationBusy}>
                        {activationBusy ? "Envoi..." : "Envoyer la preuve"}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
              {payments.length ? (
                <div className="pharmacy-message-feed">
                  {payments.slice(0, 4).map((payment) => (
                    <article key={payment.id} className="landing-notification-item">
                      <strong>{payment.payment_method} - {payment.payment_status}</strong>
                      <p>{payment.amount_bif} {payment.currency}</p>
                      <small>{payment.transaction_reference || "Ref. manquante"} • {formatExactDateTime(payment.created_at, language)}</small>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">Abonnement indisponible.</div>
          )}
        </DashboardPanel>
      ) : null}

      {activeSection === "configuration" ? (
        <DashboardPanel
          title={labels.settingsTitle}
          description={labels.settingsBody}
          className="dashboard-panel-span-3"
        >
          <div className="dashboard-summary-stack">
            <div className="dashboard-summary-row">
              <span>Nom</span>
              <strong>{profileName}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span>Adresse</span>
              <strong>{profileMeta || "Non renseignee"}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span>Stock synchronise</span>
              <strong>{kpis.total_stock}</strong>
            </div>
            <button type="button" className="primary-button" onClick={triggerProfileFlow}>
              Mon profil
            </button>
          </div>
        </DashboardPanel>
      ) : null}

      {documentViewer ? (
        <InAppDocumentViewer
          title={documentViewer.title}
          src={documentViewer.src}
          contentType={documentViewer.contentType}
          fileName={documentViewer.fileName}
          onClose={() => setDocumentViewer(null)}
        />
      ) : null}
    </DashboardScaffold>
  );
}

function PaginationControls({
  label,
  page,
  totalPages,
  onPageChange,
}: {
  label: string;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="dashboard-pagination">
      <span>{label}: {page}/{totalPages}</span>
      <div className="dashboard-pagination-actions">
        <button type="button" className="secondary-button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>
          Prec.
        </button>
        <button type="button" className="secondary-button" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
          Suiv.
        </button>
      </div>
    </div>
  );
}

function AvailablePrescriptionList({
  stock,
  prescriptions,
  language,
  emptyText,
  viewOriginalLabel,
  onOpenDocument,
  currentPharmacyId,
  onConfirmPrescription,
  confirmBusyId,
}: {
  stock: StockItem[];
  prescriptions: PrescriptionRecord[];
  language: "fr" | "en" | "rn" | "sw" | "ln";
  emptyText: string;
  viewOriginalLabel: string;
  onOpenDocument: (prescription: PrescriptionRecord) => void;
  currentPharmacyId: number | null;
  onConfirmPrescription: (prescription: PrescriptionRecord) => void;
  confirmBusyId: number | null;
}) {
  if (!prescriptions.length) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="dashboard-record-list dashboard-mobile-single-stack">
      {prescriptions.map((prescription) => {
        const medications = prescription.extracted_medications ?? [];
        const documentUrl = getPrescriptionDocumentUrl(prescription);
        const canConfirm = canPharmacyConfirmPrescription(prescription, currentPharmacyId);
        const available = medications.filter((med) =>
          stock.some(
            (item) =>
              item.is_available &&
              (item.medication_name.toLowerCase().includes(med.name.toLowerCase()) ||
                med.name.toLowerCase().includes(item.medication_name.toLowerCase()))
          )
        ).length;
        const total = medications.length;
        const matchPercentage = total ? (available / total) * 100 : 0;

        return (
          <article key={prescription.id} className="dashboard-record-card prescription-match-card">
            <div className="prescription-match-header">
              <div>
                <strong>{prescription.medication_name}</strong>
                <small><span className="public-reference-badge">{getPrescriptionReference(prescription)}</span></small>
                <small>{prescription.geo_zone ? `Zone: ${prescription.geo_zone}` : "Identite patient protegee"}</small>
                <small>{formatExactDateTime(prescription.created_at, language)}</small>
                <small>{prescription.pharmacy_name ? `Pharmacie choisie: ${prescription.pharmacy_name}` : "Pharmacie non selectionnee"}</small>
                <small>Statut: {getPharmacyPrescriptionStatusLabel(prescription.status)}</small>
              </div>
              <div className="match-indicator">
                <span className="match-percentage">{matchPercentage.toFixed(0)}%</span>
                <span className="match-details">{available} / {total}</span>
              </div>
            </div>
            {documentUrl ? (
              isImageDocument(documentUrl) ? (
                <button
                  type="button"
                  className="prescription-image-preview dashboard-document-preview button-reset"
                  onClick={() => onOpenDocument(prescription)}
                >
                  <img src={documentUrl} alt={`Ordonnance ${getPrescriptionReference(prescription)}`} />
                </button>
              ) : (
                <div className="prescription-document-panel dashboard-document-panel">
                  <p>Document original protege et disponible selon les autorisations de securite.</p>
                  <button type="button" className="secondary-button dashboard-document-action" onClick={() => onOpenDocument(prescription)} aria-label={viewOriginalLabel} title={viewOriginalLabel}>
                    <EyeGlyph />
                    <span>{viewOriginalLabel}</span>
                  </button>
                </div>
              )
            ) : (
              <div className="prescription-document-panel dashboard-document-panel">
                <p>Le document original n'est pas encore accessible pour cette ordonnance.</p>
              </div>
            )}
            {canConfirm ? (
              <div className="dashboard-record-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => onConfirmPrescription(prescription)}
                  disabled={confirmBusyId === prescription.id}
                >
                  <ConfirmGlyph />
                  <span>{confirmBusyId === prescription.id ? "Confirmation..." : "Confirmer ordonnance servie"}</span>
                </button>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function PrescriptionOcrList({
  stock,
  prescriptions,
  emptyText,
}: {
  stock: StockItem[];
  prescriptions: PrescriptionRecord[];
  emptyText: string;
}) {
  if (!prescriptions.length) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="dashboard-record-list dashboard-mobile-single-stack">
      {prescriptions.map((prescription) => {
        const medications = prescription.extracted_medications ?? [];
        const available = medications.filter((med) =>
          stock.some(
            (item) =>
              item.is_available &&
              (item.medication_name.toLowerCase().includes(med.name.toLowerCase()) ||
                med.name.toLowerCase().includes(item.medication_name.toLowerCase()))
          )
        ).length;
        const total = medications.length;

        return (
          <PublicPrescriptionSheet
            key={`ocr-${prescription.id}`}
            prescription={prescription}
            title={prescription.medication_name || "Ordonnance confirmee"}
            className="compact dashboard-prescription-sheet"
            footer={
              <div className="admin-prescription-footer">
                <span className="badge info">{prescription.status}</span>
                <span>{prescription.pharmacy_name || "Pharmacie non selectionnee"}</span>
                <span>{available} / {total || 0}</span>
                <span>{total ? `${((available / total) * 100).toFixed(0)}% en stock` : "0% en stock"}</span>
              </div>
            }
          />
        );
      })}
    </div>
  );
}
