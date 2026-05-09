import { type FormEvent, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import DashboardScaffold, { DashboardPanel, EyeGlyph, RefreshGlyph } from "./DashboardScaffold";
import InAppDocumentViewer from "./InAppDocumentViewer";
import PublicPrescriptionSheet from "./PublicPrescriptionSheet";
import { getApiOrigin, getChatWebSocketUrl } from "../config/endpoints";
import { usePreferences } from "../context/PreferencesContext";
import { formatExactDateTime } from "../lib/datetime";
import { logClientError } from "../lib/logger";
import {
  banPharmacy,
  banUser,
  broadcastNotifications,
  deletePharmacyAccount,
  deleteUserAccount,
  fetchAdminDashboard,
  fetchProtectedDocument,
  fetchProfile,
  updateAdminProfile,
  updatePharmacySubscriptionStatus,
  updateAdminSettings,
  updateSubscriptionPaymentStatus,
  unbanPharmacy,
  unbanUser,
} from "../services/api";
import type {
  AdminDashboardAISettings,
  AdminDashboardData,
  AuthUser,
  PaymentMethodConfig,
  Pharmacy,
  PrescriptionRecord,
} from "../types";

type AdminSection =
  | "dashboard"
  | "pharmacies"
  | "patients"
  | "prescriptions"
  | "ocr"
  | "settings"
  | "status"
  | "active-system"
  | "payments"
  | "payment-modes"
  | "subscriptions"
  | "ai-pharmigo"
  | "configurations";

const PHARMACY_PAGE_SIZE = 4;

const SEARCH_LOCALES = ["fr-FR", "en-US", "sw-TZ"] as const;

function ActionIconButton({
  label,
  title,
  tone,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  tone?: "default" | "danger" | "success" | "warning";
  onClick: () => void;
  children: ReactNode;
}) {
  const toneClass = tone && tone !== "default" ? ` dashboard-action-icon-button-${tone}` : "";
  return (
    <button
      type="button"
      className={`dashboard-action-icon-button${toneClass}`}
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
    >
      {children}
    </button>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5 9.5 17 19 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BanIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 15.5 15.5 8.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M9 7V5h6v2m-7 3v7m4-7v7m4-7v7M7 7l1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SuspendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6v12M15 6v12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4l10-10-4-4L4 16v4Zm9.5-13.5 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  return path.startsWith("/") ? path : `/${path}`;
}

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

function getPrescriptionReference(prescription: PrescriptionRecord) {
  return prescription.public_reference || `ORD-${String(prescription.id).padStart(6, "0")}`;
}

function getConfirmedMedicationSummary(prescription: PrescriptionRecord) {
  return (prescription.extracted_medications ?? [])
    .filter((item) => item.confirmed)
    .flatMap((item) => [item.name, item.generic_name, item.dosage, item.form, item.posology, item.quantity, item.unit]);
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

function paginateItems<T>(items: T[], page: number, pageSize = PHARMACY_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { totalPages, safePage, pagedItems };
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

type AdminProfileFormState = {
  username: string;
  email: string;
  profile_image: File | null;
};

type PaymentProofPreview = {
  url: string;
  pharmacyName: string;
  transactionReference?: string;
};

type DocumentViewerState = {
  src: string;
  title: string;
};

export default function AdminDashboard() {
  const { language } = usePreferences();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [hasAdminAccess, setHasAdminAccess] = useState<boolean | null>(null);
  const [trialDays, setTrialDays] = useState("180");
  const [monthlyPriceUsd, setMonthlyPriceUsd] = useState("5");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([]);
  const [aiSettings, setAiSettings] = useState<AdminDashboardAISettings>({
    human_layer: true,
    learning_passif: true,
    fallback_ai: true,
    memory_engine: false,
    semantic_search: false,
    local_reasoning: false,
  });
  const [activeSection, setActiveSection] = useState<AdminSection>("dashboard");
  const [searchTerm, setSearchTerm] = useState("");
  const [pharmacyPage, setPharmacyPage] = useState(1);
  const [patientPage, setPatientPage] = useState(1);
  const [prescriptionPage, setPrescriptionPage] = useState(1);
  const [statusPage, setStatusPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [adminProfile, setAdminProfile] = useState<AuthUser | null>(null);
  const [adminProfileForm, setAdminProfileForm] = useState<AdminProfileFormState>({
    username: "",
    email: "",
    profile_image: null,
  });
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastAudience, setBroadcastAudience] = useState<"all" | "patients" | "pharmacies">("all");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofPreview, setProofPreview] = useState<PaymentProofPreview | null>(null);
  const [documentViewer, setDocumentViewer] = useState<DocumentViewerState | null>(null);
  const refreshInFlightRef = useRef(false);

  const labels = {
    fr: {
      title: "Dashboard Admin",
      subtitle: "Hub central de pilotage global, analytics temps reel et actions d'administration.",
      refresh: "Actualiser",
      users: "Utilisateurs",
      pharmacies: "Pharmacies",
      patients: "Patients",
      prescriptions: "Ordonnances",
      ocr: "Verification OCR",
      trials: "Essais actifs",
      activeSubs: "Abonnements actifs",
      limited: "Comptes limites",
      settings: "Parametres globaux",
      trialDuration: "Duree globale de l'essai gratuit",
      monthlyPrice: "Prix mensuel global (USD)",
      paymentMethods: "Moyens de paiement",
      paymentLabel: "Libelle",
      paymentCurrency: "Devise",
      paymentNumber: "Numero de reception",
      paymentOwner: "Titulaire",
      paymentInstructions: "Instructions",
      paymentEnabled: "Actif",
      addMethod: "Ajouter un moyen",
      apply: "Appliquer au systeme",
      status: "Statut des pharmacies",
      payments: "Historique des paiements",
      subscriptions: "Historique des abonnements",
      activity: "Active System",
      configurations: "Configurations",
      broadcast: "Notification globale",
      send: "Envoyer",
      performance: "Performances des pharmacies",
      chatbot: "Metriques chatbot",
      listLabel: "Liste",
      recentNotifications: "Notifications recentes",
      recentNotificationsHint: "Alertes systeme, paiements et evenements critiques actualises en temps reel.",
    },
    en: {
      title: "Admin Dashboard",
      subtitle: "Central hub for global operations, live analytics, and admin actions.",
      refresh: "Refresh",
      users: "Users",
      pharmacies: "Pharmacies",
      patients: "Patients",
      prescriptions: "Original prescriptions",
      ocr: "OCR verification",
      trials: "Active trials",
      activeSubs: "Active subscriptions",
      limited: "Limited accounts",
      settings: "Global settings",
      trialDuration: "Global free trial duration",
      monthlyPrice: "Global monthly price (USD)",
      paymentMethods: "Payment methods",
      paymentLabel: "Label",
      paymentCurrency: "Currency",
      paymentNumber: "Receiver number",
      paymentOwner: "Account holder",
      paymentInstructions: "Instructions",
      paymentEnabled: "Enabled",
      addMethod: "Add method",
      apply: "Apply system-wide",
      status: "Pharmacy status",
      payments: "Payment history",
      subscriptions: "Subscription history",
      activity: "Active System",
      configurations: "Configurations",
      broadcast: "Global notification",
      send: "Send",
      performance: "Pharmacy performance",
      chatbot: "Chatbot metrics",
      listLabel: "List",
      recentNotifications: "Recent notifications",
      recentNotificationsHint: "System alerts, payments, and critical events refreshed in real time.",
    },
    rn: {
      title: "Dashboard Admin",
      subtitle: "Hub yo kugenzura, analytics z'igihe nyaco n'ibikorwa vya admin.",
      refresh: "Subiramwo",
      users: "Abakoresha",
      pharmacies: "Farumasi",
      patients: "Abarwayi",
      prescriptions: "Ordonnance",
      ocr: "Verification OCR",
      trials: "Essai zikora",
      activeSubs: "Abonnement zikora",
      limited: "Konti zifise imipaka",
      settings: "Amasetingi rusangi",
      trialDuration: "Igihe c'essai ku bose",
      monthlyPrice: "Igiciro c'ukwezi cose (USD)",
      paymentMethods: "Uburyo bwo kwishura",
      paymentLabel: "Izina",
      paymentCurrency: "Amahera",
      paymentNumber: "Nimero yakira",
      paymentOwner: "Nyene konti",
      paymentInstructions: "Insiguro",
      paymentEnabled: "Birakora",
      addMethod: "Ongerako uburyo",
      apply: "Shira kuri systeme",
      status: "Uko farumasi zimeze",
      payments: "Amateka y'ukwishyura",
      subscriptions: "Amateka y'abonnement",
      activity: "Systeme ikora",
      configurations: "Configurations",
      broadcast: "Notification kuri bose",
      send: "Rungika",
      performance: "Uko ba pharmacie bakora",
      chatbot: "Ibipimo vya chatbot",
      listLabel: "Urutonde",
      recentNotifications: "Notifications ziheruka",
      recentNotificationsHint: "Alerte za systeme, paiements n'ibintu bihambaye bishasha mu kanya nyako.",
    },
    sw: {
      title: "Dashboard ya Admin",
      subtitle: "Kitovu cha usimamizi, analytics za wakati halisi na vitendo vya admin.",
      refresh: "Onyesha upya",
      users: "Watumiaji",
      pharmacies: "Maduka ya dawa",
      patients: "Wagonjwa",
      prescriptions: "Preskripsheni halisi",
      ocr: "Uhakiki wa OCR",
      trials: "Majaribio hai",
      activeSubs: "Usajili hai",
      limited: "Akaunti zenye kikomo",
      settings: "Mipangilio ya jumla",
      trialDuration: "Muda wa majaribio ya bure",
      monthlyPrice: "Bei ya mwezi kwa wote (USD)",
      paymentMethods: "Njia za malipo",
      paymentLabel: "Jina",
      paymentCurrency: "Sarafu",
      paymentNumber: "Namba ya kupokea",
      paymentOwner: "Mmiliki wa akaunti",
      paymentInstructions: "Maelekezo",
      paymentEnabled: "Imewezeshwa",
      addMethod: "Ongeza njia",
      apply: "Tumia kwenye mfumo",
      status: "Hali ya maduka ya dawa",
      payments: "Historia ya malipo",
      subscriptions: "Historia ya usajili",
      activity: "Mfumo unaofanya kazi",
      configurations: "Mipangilio",
      broadcast: "Arifa ya wote",
      send: "Tuma",
      performance: "Utendaji wa maduka ya dawa",
      chatbot: "Vipimo vya chatbot",
      listLabel: "Orodha",
      recentNotifications: "Arifa za karibuni",
      recentNotificationsHint: "Arifa za mfumo, malipo na matukio muhimu zinasasishwa kwa wakati halisi.",
    },
    ln: {
      title: "Dashboard ya Admin",
      subtitle: "Hub ya botambwisi, analytics ya tango ya solo mpe action ya admin.",
      refresh: "Zongisa sika",
      users: "Ba utilisateur",
      pharmacies: "Ba pharmacie",
      patients: "Ba patient",
      prescriptions: "POrdonnances",
      ocr: "Verification OCR",
      trials: "Ba essai actifs",
      activeSubs: "Ba abonnement actifs",
      limited: "Ba compte limite",
      settings: "Parametre ya mobimba",
      trialDuration: "Ntango ya essai gratuit",
      monthlyPrice: "Motuya ya sanza nyonso (USD)",
      paymentMethods: "Ba moyen ya paiement",
      paymentLabel: "Kombo",
      paymentCurrency: "Devise",
      paymentNumber: "Numero ya kozwa",
      paymentOwner: "Nkolo ya compte",
      paymentInstructions: "Malako",
      paymentEnabled: "Ezali kosala",
      addMethod: "Bakisa moyen",
      apply: "Tia yango na systeme",
      status: "Etat ya pharmacie",
      payments: "Historique ya paiement",
      subscriptions: "Historique ya abonnement",
      activity: "Systeme actif",
      configurations: "Configurations",
      broadcast: "Notification ya bato nyonso",
      send: "Tinda",
      performance: "Performance ya ba pharmacie",
      chatbot: "Mesure ya chatbot",
      listLabel: "Liste",
      recentNotifications: "Ba notifications ya sika",
      recentNotificationsHint: "Alerte ya systeme, paiement mpe ba evenements importants ezongaka na tango ya solo.",
    },
  }[language];

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pollingTimer: number | null = null;
    let cancelled = false;
    const shouldUsePollingFallback =
      import.meta.env.DEV ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    const connect = () => {
      if (shouldUsePollingFallback) {
        pollingTimer = window.setInterval(() => {
          void loadDashboard(false);
        }, 15000);
        return;
      }

      socket = new WebSocket(getChatWebSocketUrl("public-feed"));
      socket.onmessage = () => {
        void loadDashboard(false);
      };
      socket.onclose = () => {
        reconnectTimer = window.setTimeout(connect, 2500);
      };
    };

    const bootstrap = async () => {
      try {
        const profile = await fetchProfile();
        if (cancelled) {
          return;
        }

        setAdminProfile(profile);
        setAdminProfileForm({
          username: profile.username ?? "",
          email: profile.email ?? "",
          profile_image: null,
        });

        const allowed = Boolean(profile.is_staff || profile.profile?.role === "admin");
        setHasAdminAccess(allowed);

        if (!allowed) {
          setError("Acces administrateur requis.");
          return;
        }

        await loadDashboard();
        if (!cancelled) {
          connect();
        }
      } catch (profileError) {
        if (!cancelled) {
          void profileError;
          logClientError("L'initialisation du tableau de bord admin a echoue.");
          setHasAdminAccess(false);
          setError("Acces administrateur requis.");
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
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
    if (data?.settings?.trial_period_days) {
      setTrialDays(String(data.settings.trial_period_days));
    }
    if (typeof data?.settings?.monthly_price_usd === "number") {
      setMonthlyPriceUsd(String(data.settings.monthly_price_usd));
    }
    setPaymentMethods(data?.settings?.payment_methods ?? []);
  }, [data?.settings]);

  useEffect(() => {
    if (data?.ai_settings) {
      setAiSettings(data.ai_settings);
    }
  }, [data?.ai_settings]);

  useEffect(() => {
    setPharmacyPage(1);
    setPatientPage(1);
    setPrescriptionPage(1);
    setStatusPage(1);
    setPaymentPage(1);
  }, [searchTerm]);

  const deferredSearchTerm = useDeferredValue(searchTerm);

  const storedUserName = (() => {
    try {
      const raw = localStorage.getItem("pharmigo.currentUser");
      if (!raw) {
        return "Admin";
      }
      const parsed = JSON.parse(raw) as { username?: string };
      return parsed.username?.trim() || "Admin";
    } catch {
      return "Admin";
    }
  })();

  async function loadAdminProfile() {
    try {
      const profile = await fetchProfile();
      setAdminProfile(profile);
      setAdminProfileForm({
        username: profile.username ?? "",
        email: profile.email ?? "",
        profile_image: null,
      });
    } catch (profileError) {
      void profileError;
      logClientError("Le chargement du profil admin a echoue.");
    }
  }

  async function loadDashboard(withLoader = true, force = false) {
    if (refreshInFlightRef.current && !force) {
      return;
    }

    refreshInFlightRef.current = true;
    if (withLoader) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const payload = await fetchAdminDashboard();
      setData(payload);
    } catch (loadError) {
      void loadError;
      logClientError("Le chargement du tableau de bord admin a echoue.");
      setError("Impossible de charger le dashboard admin.");
    } finally {
      refreshInFlightRef.current = false;
      if (withLoader) {
        setIsLoading(false);
      }
    }
  }

  async function handleRefresh() {
    setFeedback(null);
    setError(null);
    await Promise.all([loadAdminProfile(), loadDashboard(true, true)]);
  }

  async function handleOpenDocument(prescription: PrescriptionRecord) {
    const documentUrl = getPrescriptionDocumentUrl(prescription);
    if (!documentUrl) {
      setError("Le document original n'est pas encore disponible pour cette ordonnance.");
      return;
    }

    try {
      setError(null);
      setFeedback(null);
      const sourceUrl = await fetchProtectedDocument(documentUrl);
      setDocumentViewer({
        src: sourceUrl,
        title: `${prescription.medication_name || "Ordonnance medicale"} • ${getPrescriptionReference(prescription)}`,
      });
    } catch (documentError) {
      void documentError;
      logClientError("L'ouverture du document ordonnance admin a echoue.");
      setError("Impossible d'ouvrir l'ordonnance originale pour le moment.");
    }
  }

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number.parseInt(trialDays, 10);
    const parsedPrice = Number.parseFloat(monthlyPriceUsd);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError("Veuillez saisir une duree d'essai valide.");
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setError("Veuillez saisir un prix mensuel valide.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const payload = await updateAdminSettings({
        trial_period_days: parsed,
        monthly_price_usd: parsedPrice,
        payment_methods: paymentMethods,
      });
      setData(payload);
      setFeedback("La configuration globale a ete mise a jour.");
    } catch (saveError) {
      void saveError;
      logClientError("La mise a jour des reglages admin a echoue.");
      setError("Impossible de mettre a jour la configuration globale.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAISettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const payload = await updateAdminSettings({
        ai_settings: aiSettings,
      });
      setData(payload);
      setFeedback("La configuration IA PharmiGo a ete mise a jour.");
    } catch (saveError) {
      void saveError;
      logClientError("La mise a jour des reglages IA admin a echoue.");
      setError("Impossible de mettre a jour la configuration IA PharmiGo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleBroadcastSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      setError("Le titre et le message sont obligatoires.");
      return;
    }

    setIsSending(true);
    setError(null);
    setFeedback(null);
    try {
      await broadcastNotifications({
        title: broadcastTitle.trim(),
        message: broadcastMessage.trim(),
        audience: broadcastAudience,
      });
      setBroadcastTitle("");
      setBroadcastMessage("");
      setFeedback("La notification globale a ete envoyee.");
      void loadDashboard(false);
    } catch (sendError) {
      void sendError;
      logClientError("L'envoi de la notification globale a echoue.");
      setError("Impossible d'envoyer la notification globale.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleAdminProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminProfileForm.username.trim()) {
      setError("Le nom d'utilisateur admin est obligatoire.");
      return;
    }

    setIsProfileSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const updated = await updateAdminProfile({
        username: adminProfileForm.username.trim(),
        email: adminProfileForm.email.trim(),
        profile_image: adminProfileForm.profile_image,
      });
      setAdminProfile(updated);
      setAdminProfileForm({
        username: updated.username ?? "",
        email: updated.email ?? "",
        profile_image: null,
      });
      setFeedback("Le profil admin a ete mis a jour.");
    } catch (profileError) {
      void profileError;
      logClientError("La mise a jour du profil admin a echoue.");
      setError("Impossible de mettre a jour le profil admin.");
    } finally {
      setIsProfileSaving(false);
    }
  }

  async function toggleUserBan(userId: number, isActive: boolean) {
    try {
      if (isActive) {
        await banUser(userId);
      } else {
        await unbanUser(userId);
      }
      void loadDashboard(false);
    } catch (actionError) {
      void actionError;
      logClientError("La modification du statut utilisateur a echoue.");
      setError("Impossible de modifier le statut utilisateur.");
    }
  }

  async function togglePharmacyBan(pharmacyId: number, isActive: boolean) {
    try {
      if (isActive) {
        await banPharmacy(pharmacyId);
      } else {
        await unbanPharmacy(pharmacyId);
      }
      void loadDashboard(false);
    } catch (actionError) {
      void actionError;
      logClientError("La modification du statut pharmacie a echoue.");
      setError("Impossible de modifier le statut pharmacie.");
    }
  }

  async function handleSubscriptionStatusChange(pharmacyId: number, subscriptionStatus: "active" | "trial" | "suspended") {
    try {
      setError(null);
      setFeedback(null);
      await updatePharmacySubscriptionStatus(pharmacyId, subscriptionStatus);
      setData((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          subscriptions: current.subscriptions.map((item) =>
            item.pharmacy_id === pharmacyId
              ? {
                ...item,
                subscription_status: subscriptionStatus,
              }
              : item
          ),
          pharmacies: current.pharmacies.map((item) =>
            item.id === pharmacyId
              ? {
                ...item,
                subscription_status: subscriptionStatus,
                is_official: subscriptionStatus === "active",
              }
              : item
          ),
        };
      });
      setFeedback("Le statut de la pharmacie a ete mis a jour.");
      void loadDashboard(false);
    } catch (actionError) {
      void actionError;
      logClientError("La mise a jour de l'abonnement pharmacie a echoue.");
      setError("Impossible de modifier le statut d'abonnement.");
    }
  }

  async function handleDeleteUser(userId: number) {
    if (!window.confirm("Supprimer definitivement cet utilisateur ?")) {
      return;
    }

    try {
      await deleteUserAccount(userId);
      setFeedback("Le compte utilisateur a ete supprime.");
      void loadDashboard(false);
    } catch (actionError) {
      void actionError;
      logClientError("La suppression du compte utilisateur a echoue.");
      setError("Impossible de supprimer cet utilisateur.");
    }
  }

  async function handleDeletePharmacy(pharmacyId: number) {
    if (!window.confirm("Supprimer definitivement cette pharmacie ?")) {
      return;
    }

    try {
      await deletePharmacyAccount(pharmacyId);
      setFeedback("La pharmacie a ete supprimee.");
      void loadDashboard(false);
    } catch (actionError) {
      void actionError;
      logClientError("La suppression de la pharmacie a echoue.");
      setError("Impossible de supprimer cette pharmacie.");
    }
  }

  function updatePaymentMethod(index: number, field: keyof PaymentMethodConfig, value: string | boolean) {
    setPaymentMethods((current) =>
      current.map((method, methodIndex) => (methodIndex === index ? { ...method, [field]: value } : method))
    );
  }

  function addPaymentMethod() {
    setPaymentMethods((current) => [
      ...current,
      {
        code: `manual_${current.length + 1}`,
        label: "",
        currency: "BIF",
        enabled: true,
        account_name: "",
        account_number: "",
        instructions: "",
      },
    ]);
  }

  function removePaymentMethod(index: number) {
    setPaymentMethods((current) => current.filter((_, methodIndex) => methodIndex !== index));
  }

  async function handlePaymentStatusChange(paymentId: number, pharmacyId: number | undefined, paymentStatus: "verified" | "rejected") {
    const previousData = data;

    setError(null);
    setFeedback(null);
    setData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        payments: current.payments.map((item) =>
          item.id === paymentId
            ? {
              ...item,
              payment_status: paymentStatus,
              verified_at: paymentStatus === "verified" ? new Date().toISOString() : item.verified_at ?? null,
            }
            : item
        ),
        subscriptions:
          paymentStatus === "verified" && pharmacyId
            ? current.subscriptions.map((item) =>
              item.pharmacy_id === pharmacyId
                ? {
                  ...item,
                  subscription_status: "active",
                  is_trial_active: false,
                  days_remaining: Math.max(item.days_remaining, 30),
                }
                : item
            )
            : current.subscriptions,
        pharmacies:
          paymentStatus === "verified" && pharmacyId
            ? current.pharmacies.map((item) =>
              item.id === pharmacyId
                ? {
                  ...item,
                  subscription_status: "active",
                  is_official: true,
                }
                : item
            )
            : current.pharmacies,
      };
    });

    try {
      await updateSubscriptionPaymentStatus(paymentId, paymentStatus);
      setFeedback(paymentStatus === "verified" ? "La preuve de paiement a ete approuvee." : "La preuve de paiement a ete rejetee.");
      void loadDashboard(false);
    } catch (actionError) {
      void actionError;
      logClientError("La validation du paiement d'abonnement a echoue.");
      setData(previousData);
      setError("Impossible de modifier le statut de paiement.");
    }
  }

  const normalizedSearchTerm = deferredSearchTerm.trim().toLowerCase();
  const pharmacyLookup = new Map((data?.pharmacies ?? []).map((item) => [item.id, item] as const));
  const userRows = useMemo(
    () =>
      (data?.users ?? []).filter((item) =>
        buildSearchIndex([item.username, item.email, item.role, item.pharmacy_name ?? ""]).includes(normalizedSearchTerm)
      ),
    [data?.users, normalizedSearchTerm]
  );
  const patientRows = userRows.filter((item) => item.role === "patient");
  const pharmacyRows = useMemo(
    () =>
      (data?.pharmacies ?? []).filter((item) =>
        buildSearchIndex([item.name, item.city, item.address, item.phone_number, item.email]).includes(normalizedSearchTerm)
      ),
    [data?.pharmacies, normalizedSearchTerm]
  );
  const filteredPrescriptions = useMemo(
    () =>
      (data?.prescriptions ?? []).filter((item) =>
        buildSearchIndex(
          [
            getPrescriptionReference(item),
            item.public_reference,
            item.patient_name,
            item.medication_name,
            item.status,
            item.pharmacy_name,
            item.geo_zone,
            ...getConfirmedMedicationSummary(item),
          ],
          [item.created_at]
        ).includes(normalizedSearchTerm)
      ),
    [data?.prescriptions, normalizedSearchTerm]
  );
  const filteredOcrPrescriptions = useMemo(
    () => filteredPrescriptions.filter((item) => Boolean(getConfirmedMedicationSummary(item).length)),
    [filteredPrescriptions]
  );
  const filteredPayments = useMemo(
    () =>
      (data?.payments ?? []).filter((item) =>
        buildSearchIndex(
          [item.pharmacy_name, item.payment_method, item.payment_status, item.currency, item.transaction_reference, item.amount_bif, item.amount_usd],
          [item.created_at]
        ).includes(normalizedSearchTerm)
      ),
    [data?.payments, normalizedSearchTerm]
  );
  const filteredSubscriptions = useMemo(
    () =>
      (data?.subscriptions ?? []).filter((item) =>
        buildSearchIndex([item.pharmacy_name, item.subscription_status], [item.trial_start_date, item.trial_end_date]).includes(normalizedSearchTerm)
      ),
    [data?.subscriptions, normalizedSearchTerm]
  );
  const pendingPayments = filteredPayments.filter((item) => item.payment_status === "pending");
  const activeSubscriptions = filteredSubscriptions.filter((item) => item.subscription_status === "active");
  const archivedSubscriptions = filteredSubscriptions.filter((item) => item.subscription_status !== "active");
  const onlinePharmacyIds = new Set(
    [
      ...(data?.responses ?? []).map((item) => item.pharmacy).filter((item): item is number => typeof item === "number"),
      ...(data?.messages ?? []).flatMap((item) => [item.pharmacy, item.sender_pharmacy]).filter((item): item is number => typeof item === "number"),
    ]
  );

  const { totalPages: pharmacyPageCount, safePage: safePharmacyPage, pagedItems: pagedPharmacies } = paginateItems(pharmacyRows, pharmacyPage);
  const { totalPages: patientPageCount, safePage: safePatientPage, pagedItems: pagedPatients } = paginateItems(patientRows, patientPage);
  const { totalPages: prescriptionPageCount, safePage: safePrescriptionPage, pagedItems: pagedPrescriptions } = paginateItems(filteredPrescriptions, prescriptionPage);
  const { totalPages: statusPageCount, safePage: safeStatusPage, pagedItems: pagedSubscriptions } = paginateItems(archivedSubscriptions, statusPage);
  const { totalPages: paymentPageCount, safePage: safePaymentPage, pagedItems: pagedPayments } = paginateItems(filteredPayments, paymentPage);

  const topPharmacies = [...(data?.pharmacies ?? [])]
    .sort((left, right) => (right.response_count ?? 0) + (right.prescription_count ?? 0) - ((left.response_count ?? 0) + (left.prescription_count ?? 0)))
    .slice(0, 6);

  const pharmacyBars = topPharmacies.map((item) => ({
    label: item.name.length > 12 ? `${item.name.slice(0, 12)}…` : item.name,
    value: (item.response_count ?? 0) + (item.prescription_count ?? 0),
  }));

  const chatbotMetrics = data?.chatbot_metrics;
  const learningBefore = Math.round((chatbotMetrics?.average_confidence_before ?? 0) * 100);
  const learningAfter = Math.round((chatbotMetrics?.average_confidence_after ?? 0) * 100);
  const donutSegments = [
    { label: "Actifs", value: data?.summary.active_paid_pharmacies ?? 0, colorClass: "blue" },
    { label: "Essais", value: data?.summary.trial_pharmacies ?? 0, colorClass: "pink" },
    { label: "Limites", value: data?.summary.expired_or_limited_pharmacies ?? 0, colorClass: "amber" },
  ];

  const navSections = [
    {
      title: language === "en" ? "Control" : "Pilotage",
      items: [
        { id: "admin-dashboard", label: "Dashboard", active: activeSection === "dashboard", onClick: () => setActiveSection("dashboard") },
        { id: "admin-pharmacies", label: labels.pharmacies, active: activeSection === "pharmacies", onClick: () => setActiveSection("pharmacies") },
        { id: "admin-patients", label: labels.patients, active: activeSection === "patients", onClick: () => setActiveSection("patients") },
        { id: "admin-prescriptions", label: labels.prescriptions, active: activeSection === "prescriptions", onClick: () => setActiveSection("prescriptions") },
        { id: "admin-ocr", label: labels.ocr, active: activeSection === "ocr", onClick: () => setActiveSection("ocr") },
      ],
    },
    {
      title: language === "en" ? "System" : "Systeme",
      items: [
        { id: "admin-settings", label: labels.settings, active: activeSection === "settings", onClick: () => setActiveSection("settings") },
        { id: "admin-ai", label: "IA PharmiGo", active: activeSection === "ai-pharmigo", onClick: () => setActiveSection("ai-pharmigo") },
        { id: "admin-status", label: labels.status, active: activeSection === "status", onClick: () => setActiveSection("status") },
        { id: "admin-active", label: labels.activity, active: activeSection === "active-system", onClick: () => setActiveSection("active-system") },
        { id: "admin-config", label: labels.configurations, active: activeSection === "configurations", onClick: () => setActiveSection("configurations") },
      ],
    },
    {
      title: language === "en" ? "Finance" : "Finance",
      items: [
        { id: "admin-payment-modes", label: labels.paymentMethods, active: activeSection === "payment-modes", onClick: () => setActiveSection("payment-modes") },
        { id: "admin-payments", label: labels.payments, active: activeSection === "payments", onClick: () => setActiveSection("payments") },
        { id: "admin-subs", label: labels.subscriptions, active: activeSection === "subscriptions", onClick: () => setActiveSection("subscriptions") },
      ],
    },
  ];

  const metrics = [
    { label: labels.users, value: data?.summary.users_total ?? 0 },
    { label: labels.pharmacies, value: data?.summary.pharmacies_total ?? 0 },
    { label: labels.prescriptions, value: data?.summary.prescriptions_total ?? 0 },
    { label: labels.trials, value: data?.summary.trial_pharmacies ?? 0 },
    { label: labels.activeSubs, value: data?.summary.active_paid_pharmacies ?? 0 },
    { label: labels.limited, value: data?.summary.expired_or_limited_pharmacies ?? 0 },
    { label: "Ordonnances perdues", value: data?.summary.lost_prescriptions_total ?? 0 },
  ];

  const highlights = [
    {
      title: `${chatbotMetrics?.learning_events_total ?? 0}`,
      helper: labels.chatbot,
      meta: `${chatbotMetrics?.success_rate ?? 0}%`,
    },
    {
      title: `${data?.summary.payments_total ?? 0}`,
      helper: labels.payments,
      meta: labels.activeSubs,
    },
  ];

  if (isLoading && !data) {
    return <div className="loading-state">Chargement du dashboard admin...</div>;
  }

  if (hasAdminAccess === false) {
    return <div className="loading-state">Acces administrateur requis.</div>;
  }

  return (
    <DashboardScaffold
      brand="PHARMIGO"
      pageTitle={labels.title}
      pageSubtitle={labels.subtitle}
      roleLabel="PHARMIGO ADMIN"
      searchPlaceholder={language === "en" ? "Search name, date, month, payment, prescription..." : "Rechercher nom, date, mois, paiement, ordonnance..."}
      searchValue={searchTerm}
      onSearchChange={setSearchTerm}
      profileLabel={adminProfile?.username || storedUserName}
      profileMeta={adminProfile ? `${formatPresenceLabel(adminProfile.profile?.is_online, adminProfile.profile?.last_seen, language)} • Controle global` : "Controle global"}
      profileImageUrl={resolveMediaUrl(adminProfile?.profile?.profile_image) ?? null}
      profileIsOnline={Boolean(adminProfile?.profile?.is_online)}
      navSections={navSections}
      metrics={metrics}
      highlights={highlights}
      topbarActions={
        <button className="dashboard-icon-button dashboard-refresh-button" type="button" onClick={() => void handleRefresh()} aria-label={labels.refresh} title={labels.refresh}>
          <RefreshGlyph />
        </button>
      }
    >
      {error ? <p className="form-feedback error">{error}</p> : null}
      {feedback ? <p className="form-feedback success">{feedback}</p> : null}

      {activeSection === "dashboard" ? (
        <>
          <DashboardPanel title={labels.performance} description="Vue generale inspirée d'un centre de controle moderne." className="dashboard-panel-span-2">
            <div className="dashboard-chart-grid">
              <DonutCard title={labels.status} segments={donutSegments} />
              <BarChartCard title={labels.performance} bars={pharmacyBars} />
            </div>
          </DashboardPanel>
          <DashboardPanel title={labels.chatbot} description="Apprentissage, precision et taux d'echec en temps reel.">
            <MetricTrendCard
              before={learningBefore}
              after={learningAfter}
              successRate={chatbotMetrics?.success_rate ?? 0}
              failureRate={chatbotMetrics?.failure_rate ?? 0}
            />
          </DashboardPanel>
          <DashboardPanel title={labels.activity} description="Chronologie simple du systeme recent." className="dashboard-panel-span-3">
            <LineChartCard
              values={[
                data?.summary.notifications_total ?? 0,
                data?.summary.messages_total ?? 0,
                data?.summary.responses_total ?? 0,
                data?.summary.payments_total ?? 0,
                chatbotMetrics?.learning_events_total ?? 0,
                data?.summary.prescriptions_total ?? 0,
              ]}
              labels={["Notif", "Msgs", "Reponses", "Paiements", "Learn", "Rx"]}
            />
          </DashboardPanel>
        </>
      ) : null}

      {activeSection === "pharmacies" ? (
        <DashboardPanel title={labels.pharmacies} description="Pagination de 4 pharmacies avec photo de profil, actions et statut synchronises." className="dashboard-panel-span-3">
          <div className="admin-table-grid dashboard-mobile-single-stack">
            {pagedPharmacies.map((pharmacy) => (
              <AdminPharmacyCard
                key={pharmacy.id}
                pharmacy={pharmacy}
                subscription={filteredSubscriptions.find((item) => item.pharmacy_id === pharmacy.id)}
                isOnline={onlinePharmacyIds.has(pharmacy.id)}
                language={language}
                onToggleBan={togglePharmacyBan}
                onSubscriptionStatusChange={handleSubscriptionStatusChange}
                onDelete={handleDeletePharmacy}
              />
            ))}
          </div>
          <PaginationControls page={safePharmacyPage} totalPages={pharmacyPageCount} onPageChange={setPharmacyPage} />
        </DashboardPanel>
      ) : null}

      {activeSection === "patients" ? (
        <DashboardPanel title={labels.patients} description="Liste patient avec recherche en temps reel et pagination de 4." className="dashboard-panel-span-3">
          <div className="admin-table-grid dashboard-mobile-single-stack">
            {pagedPatients.map((patient) => (
              <article key={patient.id} className="admin-data-card">
                <strong>{patient.username}</strong>
                <span className={`badge ${patient.is_staff ? "info" : "neutral"}`}>{patient.role}</span>
                <p>{patient.email || "Sans email"}</p>
                <div className="admin-card-actions">
                  <ActionIconButton
                    label={patient.is_active === false ? "Reactiver l'utilisateur" : "Desactiver l'utilisateur"}
                    title={patient.is_active === false ? "Reactiver" : "Desactiver"}
                    tone={patient.is_active === false ? "success" : "warning"}
                    onClick={() => void toggleUserBan(patient.id, patient.is_active !== false)}
                  >
                    <BanIcon />
                  </ActionIconButton>
                  <ActionIconButton label="Supprimer l'utilisateur" title="Supprimer" tone="danger" onClick={() => void handleDeleteUser(patient.id)}>
                    <TrashIcon />
                  </ActionIconButton>
                </div>
              </article>
            ))}
          </div>
          <PaginationControls page={safePatientPage} totalPages={patientPageCount} onPageChange={setPatientPage} />
        </DashboardPanel>
      ) : null}

      {activeSection === "prescriptions" ? (
        <DashboardPanel title={labels.prescriptions} description="Ordonnances originales privees, avec recherche temps reel par reference, patient et pharmacie." className="dashboard-panel-span-3">
          <div className="admin-table-grid dashboard-mobile-single-stack">
            {pagedPrescriptions.map((prescription) => (
              <article key={prescription.id} className="dashboard-record-card">
                <div className="dashboard-record-head">
                  <div>
                    <strong>{prescription.medication_name || "Ordonnance medicale"}</strong>
                    <small>
                      <span className="public-reference-badge">{getPrescriptionReference(prescription)}</span> {formatExactDateTime(prescription.created_at, language)}
                    </small>
                  </div>
                  <span className="badge info">{prescription.status}</span>
                </div>
                <div className="dashboard-data-block dashboard-data-block-info">
                  <span>Pharmacie choisie</span>
                  <p>{prescription.pharmacy_name || "En attente de selection"}</p>
                  <small>{prescription.geo_zone || "Zone non renseignee"}</small>
                </div>
                {getPrescriptionDocumentUrl(prescription) ? (
                  isImageDocument(getPrescriptionDocumentUrl(prescription)) ? (
                    <button
                      type="button"
                      className="prescription-image-preview dashboard-document-preview button-reset"
                      onClick={() => void handleOpenDocument(prescription)}
                    >
                      <img src={getPrescriptionDocumentUrl(prescription) ?? ""} alt={`Ordonnance ${getPrescriptionReference(prescription)}`} />
                    </button>
                  ) : (
                    <div className="prescription-document-panel dashboard-document-panel">
                      <p>Document original securise et disponible pour verification administrative.</p>
                      <button type="button" className="secondary-button dashboard-document-action" onClick={() => void handleOpenDocument(prescription)} aria-label="Voir l'ordonnance originale" title="Voir l'ordonnance originale">
                        <EyeGlyph />
                        <span>Voir l'ordonnance originale</span>
                      </button>
                    </div>
                  )
                ) : (
                  <div className="prescription-document-panel dashboard-document-panel">
                    <p>Le document original n'est pas encore disponible pour cette ordonnance.</p>
                  </div>
                )}
              </article>
            ))}
          </div>
          <PaginationControls page={safePrescriptionPage} totalPages={prescriptionPageCount} onPageChange={setPrescriptionPage} />
        </DashboardPanel>
      ) : null}

      {activeSection === "ocr" ? (
        <DashboardPanel title={labels.ocr} description="Medicaments confirmes et analyse OCR relies aux memes references publiques." className="dashboard-panel-span-3">
          <div className="admin-table-grid dashboard-mobile-single-stack">
            {paginateItems(filteredOcrPrescriptions, prescriptionPage).pagedItems.map((prescription) => (
              <PublicPrescriptionSheet
                key={prescription.id}
                prescription={prescription}
                title={prescription.medication_name || "Ordonnance medicale"}
                className="compact dashboard-prescription-sheet"
                footer={
                  <div className="admin-prescription-footer">
                    <span className="badge info">{prescription.status}</span>
                    <span>{prescription.pharmacy_name || "Pharmacie en attente de selection"}</span>
                    <span>{prescription.geo_zone || "Zone non renseignee"}</span>
                    <span>{new Date(prescription.created_at).toLocaleString()}</span>
                  </div>
                }
              />
            ))}
          </div>
          <PaginationControls
            page={paginateItems(filteredOcrPrescriptions, prescriptionPage).safePage}
            totalPages={paginateItems(filteredOcrPrescriptions, prescriptionPage).totalPages}
            onPageChange={setPrescriptionPage}
          />
        </DashboardPanel>
      ) : null}

      {activeSection === "settings" ? (
        <DashboardPanel title={labels.settings} description="Ajustement du prix mensuel et de la duree d'essai globale." className="dashboard-panel-span-3 dashboard-keep-visible">
          <form className="admin-settings-form" onSubmit={handleSettingsSubmit}>
            <label>
              <span>{labels.trialDuration}</span>
              <input type="number" min="1" value={trialDays} onChange={(event) => setTrialDays(event.target.value)} />
            </label>
            <label>
              <span>{labels.monthlyPrice}</span>
              <input type="number" min="0.01" step="0.01" value={monthlyPriceUsd} onChange={(event) => setMonthlyPriceUsd(event.target.value)} />
            </label>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving ? "Mise a jour..." : labels.apply}
            </button>
          </form>
        </DashboardPanel>
      ) : null}

      {activeSection === "ai-pharmigo" ? (
        <DashboardPanel title="IA PharmiGo" description="Pilotage de la couche humaine, du fallback et de l'apprentissage passif." className="dashboard-panel-span-3 dashboard-keep-visible">
          <div className="admin-ai-grid">
            <form className="admin-settings-form admin-ai-settings-form" onSubmit={handleAISettingsSubmit}>
              <div className="admin-ai-toggle-list">
                {[
                  ["human_layer", "Human Layer"],
                  ["learning_passif", "Learning passif"],
                  ["fallback_ai", "Fallback intelligent"],
                  ["memory_engine", "Memory Engine"],
                  ["semantic_search", "Semantic Search"],
                  ["local_reasoning", "Local Reasoning"],
                ].map(([key, label]) => (
                  <label key={key} className="admin-ai-toggle">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(aiSettings[key as keyof AdminDashboardAISettings])}
                      onChange={(event) =>
                        setAiSettings((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <button type="submit" className="primary-button" disabled={isSaving}>
                {isSaving ? "Mise a jour..." : "Enregistrer la configuration IA"}
              </button>
            </form>

            <div className="admin-ai-stack">
              <div className="admin-ai-health-card">
                <div className="dashboard-panel-head">
                  <h3>Sante Gemini</h3>
                </div>
                <div className="admin-ai-health-grid">
                  <div>
                    <span>Service</span>
                    <strong>{data?.ai_health?.gemini_enabled ? "Active" : "Desactive"}</strong>
                  </div>
                  <div>
                    <span>Cle API</span>
                    <strong>{data?.ai_health?.gemini_configured ? "Configuree" : "Manquante"}</strong>
                  </div>
                  <div>
                    <span>Disponibilite</span>
                    <strong>{data?.ai_health?.gemini_available ? "Disponible" : "Indisponible"}</strong>
                  </div>
                  <div>
                    <span>Modele</span>
                    <strong>{data?.ai_health?.gemini_model || "N/A"}</strong>
                  </div>
                </div>
              </div>

              <div className="admin-ai-lists">
                <section className="admin-ai-list-card">
                  <div className="dashboard-panel-head">
                    <h3>Audit d'apprentissage</h3>
                    <small>{data?.ai_learning_audit?.length ?? 0} entrees</small>
                  </div>
                  <div className="admin-ai-list">
                    {(data?.ai_learning_audit ?? []).length ? (
                      (data?.ai_learning_audit ?? []).map((item) => (
                        <article key={item.id} className="admin-ai-list-item">
                          <div className="admin-ai-list-head">
                            <strong>{item.detected_intent || "intent inconnu"}</strong>
                            <span>{new Date(item.created_at).toLocaleString()}</span>
                          </div>
                          <p>{item.original_text}</p>
                          <small>Source: {item.source} • confiance: {Math.round((item.confidence_after ?? 0) * 100)}%</small>
                        </article>
                      ))
                    ) : (
                      <div className="empty-state">Aucune observation d'apprentissage pour le moment.</div>
                    )}
                  </div>
                </section>

                <section className="admin-ai-list-card">
                  <div className="dashboard-panel-head">
                    <h3>Logs IA recents</h3>
                    <small>{data?.ai_recent_logs?.length ?? 0} evenements</small>
                  </div>
                  <div className="admin-ai-list">
                    {(data?.ai_recent_logs ?? []).length ? (
                      (data?.ai_recent_logs ?? []).map((item) => (
                        <article key={item.id} className="admin-ai-list-item">
                          <div className="admin-ai-list-head">
                            <strong>{item.event_type}</strong>
                            <span className={`badge ${item.severity === "error" ? "warning" : item.severity === "warning" ? "info" : "success"}`}>
                              {item.severity}
                            </span>
                          </div>
                          <p>{item.message}</p>
                          <small>{new Date(item.created_at).toLocaleString()}</small>
                        </article>
                      ))
                    ) : (
                      <div className="empty-state">Aucun log IA recent.</div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </DashboardPanel>
      ) : null}

      {activeSection === "payment-modes" ? (
        <DashboardPanel title={labels.paymentMethods} description="Ajustez manuellement les modes de paiement utilises dans tout le systeme." className="dashboard-panel-span-3 dashboard-keep-visible">
          <form className="admin-payment-methods" onSubmit={handleSettingsSubmit}>
            <div className="dashboard-panel-head">
              <h3>{labels.paymentMethods}</h3>
              <button type="button" className="secondary-button" onClick={addPaymentMethod}>
                {labels.addMethod}
              </button>
            </div>
            <div className="admin-payment-layout">
              <aside className="admin-payment-current">
                <h4>Moyen de paiement actuel</h4>
                <div className="admin-payment-current-list">
                  {paymentMethods.filter((method) => method.enabled).length ? (
                    paymentMethods
                      .filter((method) => method.enabled)
                      .map((method, index) => (
                        <article key={`${method.code}-active-${index}`} className="admin-payment-current-card">
                          <strong>{method.label}</strong>
                          <span>{method.currency}</span>
                          <p>{method.account_name}</p>
                          <small>{method.account_number}</small>
                        </article>
                      ))
                  ) : (
                    <p className="admin-payment-empty">Aucun moyen actif pour le moment.</p>
                  )}
                </div>
              </aside>
              <div className="admin-payment-method-list">
                {paymentMethods.map((method, index) => (
                  <div key={`${method.code}-${index}`} className="admin-payment-method-card">
                    <div className="form-row">
                      <label>
                        <span>{labels.paymentLabel}</span>
                        <input value={method.label} onChange={(event) => updatePaymentMethod(index, "label", event.target.value)} />
                      </label>
                      <label>
                        <span>Code</span>
                        <input value={method.code} onChange={(event) => updatePaymentMethod(index, "code", event.target.value)} />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        <span>{labels.paymentCurrency}</span>
                        <input value={method.currency} onChange={(event) => updatePaymentMethod(index, "currency", event.target.value.toUpperCase())} />
                      </label>
                      <label>
                        <span>{labels.paymentNumber}</span>
                        <input value={method.account_number} onChange={(event) => updatePaymentMethod(index, "account_number", event.target.value)} />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        <span>{labels.paymentOwner}</span>
                        <input value={method.account_name} onChange={(event) => updatePaymentMethod(index, "account_name", event.target.value)} />
                      </label>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={method.enabled} onChange={(event) => updatePaymentMethod(index, "enabled", event.target.checked)} />
                        <span>{labels.paymentEnabled}</span>
                      </label>
                    </div>
                    <label>
                      <span>{labels.paymentInstructions}</span>
                      <textarea value={method.instructions} onChange={(event) => updatePaymentMethod(index, "instructions", event.target.value)} rows={3} />
                    </label>
                    <ActionIconButton label="Supprimer ce mode de paiement" title="Supprimer" tone="danger" onClick={() => removePaymentMethod(index)}>
                      <TrashIcon />
                    </ActionIconButton>
                  </div>
                ))}
              </div>
            </div>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving ? "Mise a jour..." : labels.apply}
            </button>
          </form>
        </DashboardPanel>
      ) : null}

      {activeSection === "status" || activeSection === "subscriptions" ? (
        <DashboardPanel title={labels.subscriptions} description="Abonnements recents et passes avec activation, essai ou desactivation immediate." className="dashboard-panel-span-3">
          <div className="admin-subscription-sections">
            <section className="admin-subscription-block">
              <div className="dashboard-panel-head">
                <h3>Demandes en attente</h3>
                <small>{pendingPayments.length} preuve(s) a traiter</small>
              </div>
              <div className="admin-table-grid">
                {pendingPayments.length ? pendingPayments.map((payment) => (
                  <article key={`pending-${payment.id}`} className="admin-data-card">
                    <strong>{payment.pharmacy_name}</strong>
                    <span className="badge info">{payment.payment_status}</span>
                    <p>{payment.amount_bif} {payment.currency} • {payment.payment_method}</p>
                    <small>Ref: {payment.transaction_reference || "Non renseignee"}</small>
                    <small>Nom: {payment.payer_name || "Non renseigne"}</small>
                    <small>Adresse: {payment.payer_address || "Non renseignee"}</small>
                    <small>Expediteur: {payment.sender_phone || "Non renseigne"}</small>
                    {payment.proof_image ? (
                      <button
                        type="button"
                        className="secondary-button inline-button"
                        onClick={() =>
                          setProofPreview({
                            url: resolveMediaUrl(payment.proof_image) ?? payment.proof_image ?? "",
                            pharmacyName: payment.pharmacy_name,
                            transactionReference: payment.transaction_reference,
                          })
                        }
                      >
                        Voir la preuve
                      </button>
                    ) : null}
                    <div className="admin-card-actions">
                      <button type="button" className="primary-button" onClick={() => void handlePaymentStatusChange(payment.id, payment.pharmacy_id, "verified")}>
                        Approuver
                      </button>
                      <button type="button" className="notification-inline-action danger" onClick={() => void handlePaymentStatusChange(payment.id, payment.pharmacy_id, "rejected")}>
                        Rejeter
                      </button>
                    </div>
                  </article>
                )) : <div className="empty-state">Aucune demande d'activation en attente.</div>}
              </div>
            </section>

            <section className="admin-subscription-block">
              <div className="dashboard-panel-head">
                <h3>Abonnements actifs</h3>
                <small>{activeSubscriptions.length} pharmacie(s) active(s)</small>
              </div>
              <div className="admin-table-grid">
                {activeSubscriptions.length ? activeSubscriptions.map((subscription) => (
                  <article key={`active-${subscription.id}`} className="admin-data-card admin-pharmacy-dashboard-card admin-subscription-pharmacy-card">
                    <div className="admin-card-header">
                      <div className="admin-profile-chip">
                        {pharmacyLookup.get(subscription.pharmacy_id)?.profile_image ? (
                          <img
                            src={resolveMediaUrl(pharmacyLookup.get(subscription.pharmacy_id)?.profile_image) ?? ""}
                            alt={subscription.pharmacy_name}
                            className="admin-profile-chip-image"
                          />
                        ) : (
                          <div className="admin-profile-chip-fallback">{subscription.pharmacy_name.slice(0, 1).toUpperCase()}</div>
                        )}
                        <div>
                          <strong>{subscription.pharmacy_name}</strong>
                          <small>{pharmacyLookup.get(subscription.pharmacy_id)?.phone_number || "Numero indisponible"}</small>
                        </div>
                      </div>
                      <span className="badge success">{subscription.subscription_status}</span>
                    </div>
                    <div className="admin-pharmacy-dashboard-details">
                      <p>{formatExactDateTime(subscription.trial_start_date, language)} → {formatExactDateTime(subscription.trial_end_date, language)}</p>
                      <small>{subscription.days_remaining} jours restants</small>
                    </div>
                    <div className="admin-card-actions">
                      <ActionIconButton label="Suspendre l'abonnement" title="Suspendre" tone="warning" onClick={() => void handleSubscriptionStatusChange(subscription.pharmacy_id, "suspended")}>
                        <SuspendIcon />
                      </ActionIconButton>
                    </div>
                  </article>
                )) : <div className="empty-state">Aucun abonnement actif pour le moment.</div>}
              </div>
            </section>

            <section className="admin-subscription-block">
              <div className="dashboard-panel-head">
                <h3>Historique des abonnements</h3>
                <small>{archivedSubscriptions.length} entree(s) • {data?.summary.lost_prescriptions_total ?? 0} opportunite(s) perdue(s)</small>
              </div>
              <div className="admin-table-grid">
                {pagedSubscriptions.map((subscription) => (
                  <article key={subscription.id} className="admin-data-card admin-pharmacy-dashboard-card admin-subscription-pharmacy-card">
                    <div className="admin-card-header">
                      <div className="admin-profile-chip">
                        {pharmacyLookup.get(subscription.pharmacy_id)?.profile_image ? (
                          <img
                            src={resolveMediaUrl(pharmacyLookup.get(subscription.pharmacy_id)?.profile_image) ?? ""}
                            alt={subscription.pharmacy_name}
                            className="admin-profile-chip-image"
                          />
                        ) : (
                          <div className="admin-profile-chip-fallback">{subscription.pharmacy_name.slice(0, 1).toUpperCase()}</div>
                        )}
                        <div>
                          <strong>{subscription.pharmacy_name}</strong>
                          <small>{pharmacyLookup.get(subscription.pharmacy_id)?.phone_number || "Numero indisponible"}</small>
                        </div>
                      </div>
                      <span className={`badge ${subscription.subscription_status === "active" ? "success" : subscription.subscription_status === "trial" ? "info" : "warning"}`}>
                        {subscription.subscription_status}
                      </span>
                    </div>
                    <div className="admin-pharmacy-dashboard-details">
                      <p>{formatExactDateTime(subscription.trial_start_date, language)} → {formatExactDateTime(subscription.trial_end_date, language)}</p>
                      <small>{subscription.days_remaining} jours restants</small>
                      {subscription.lost_prescriptions_count > 0 ? (
                        <small>{subscription.lost_prescriptions_count} ordonnance(s) recente(s) compatible(s) perdues</small>
                      ) : null}
                    </div>
                    <div className="admin-card-actions">
                      <ActionIconButton
                        label={subscription.subscription_status === "active" ? "Suspendre l'abonnement" : "Activer l'abonnement"}
                        title={subscription.subscription_status === "active" ? "Suspendre" : "Activer"}
                        tone={subscription.subscription_status === "active" ? "warning" : "success"}
                        onClick={() => void handleSubscriptionStatusChange(subscription.pharmacy_id, subscription.subscription_status === "active" ? "suspended" : "active")}
                      >
                        {subscription.subscription_status === "active" ? <SuspendIcon /> : <CheckIcon />}
                      </ActionIconButton>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
          <PaginationControls page={safeStatusPage} totalPages={statusPageCount} onPageChange={setStatusPage} />
        </DashboardPanel>
      ) : null}

      {activeSection === "payments" ? (
        <DashboardPanel title={labels.payments} description="Historique recent des paiements verifies, en attente ou rejetes avec pagination de 4." className="dashboard-panel-span-3">
          <div className="admin-table-grid">
            {pagedPayments.map((payment) => (
              <article key={payment.id} className="admin-data-card">
                <strong>{payment.pharmacy_name}</strong>
                <span className={`badge ${payment.payment_status === "verified" ? "success" : payment.payment_status === "pending" ? "info" : "warning"}`}>
                  {payment.payment_status}
                </span>
                <p>{payment.amount_bif} {payment.currency}</p>
                <small>{payment.payment_method} • {new Date(payment.created_at).toLocaleString()}</small>
                <small>Ref: {payment.transaction_reference || "Non renseignee"}</small>
                {payment.verified_by_name ? <small>Valide par: {payment.verified_by_name}</small> : null}
              </article>
            ))}
          </div>
          <PaginationControls page={safePaymentPage} totalPages={paymentPageCount} onPageChange={setPaymentPage} />
        </DashboardPanel>
      ) : null}

      {activeSection === "active-system" ? (
        <DashboardPanel title={labels.broadcast} description="Envoyez une notification globale a tous, aux pharmacies ou aux patients." className="dashboard-panel-span-3 dashboard-keep-visible">
          <form className="admin-broadcast-form" onSubmit={handleBroadcastSubmit}>
            <label>
              <span>Titre</span>
              <input value={broadcastTitle} onChange={(event) => setBroadcastTitle(event.target.value)} />
            </label>
            <label>
              <span>Audience</span>
              <select value={broadcastAudience} onChange={(event) => setBroadcastAudience(event.target.value as "all" | "patients" | "pharmacies")}>
                <option value="all">Tous</option>
                <option value="pharmacies">Pharmacies</option>
                <option value="patients">Patients</option>
              </select>
            </label>
            <label className="admin-broadcast-wide">
              <span>Message</span>
              <textarea rows={4} value={broadcastMessage} onChange={(event) => setBroadcastMessage(event.target.value)} />
            </label>
            <button type="submit" className="primary-button" disabled={isSending}>
              {isSending ? "Envoi..." : labels.send}
            </button>
          </form>
        </DashboardPanel>
      ) : null}

      {activeSection === "configurations" ? (
        <DashboardPanel title="Profil admin" description="Modifiez directement les informations et la photo de profil de l'administrateur." className="dashboard-panel-span-3 dashboard-keep-visible">
          <form className="admin-settings-form" onSubmit={handleAdminProfileSubmit}>
            <label>
              <span>Nom d'utilisateur</span>
              <input value={adminProfileForm.username} onChange={(event) => setAdminProfileForm((current) => ({ ...current, username: event.target.value }))} />
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={adminProfileForm.email} onChange={(event) => setAdminProfileForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label>
              <span>Photo de profil</span>
              <input type="file" accept="image/*" onChange={(event) => setAdminProfileForm((current) => ({ ...current, profile_image: event.target.files?.[0] ?? null }))} />
            </label>
            <button type="submit" className="primary-button" disabled={isProfileSaving}>
              {isProfileSaving ? "Enregistrement..." : "Enregistrer le profil"}
            </button>
          </form>
        </DashboardPanel>
      ) : null}

      {proofPreview ? (
        <div className="guardian-popup-overlay" role="dialog" aria-modal="true" aria-label="Preuve de paiement" onClick={() => setProofPreview(null)}>
          <div className="guardian-popup-card guardian-popup-loader-card admin-proof-modal" onClick={(event) => event.stopPropagation()}>
            <div className="guardian-popup-head">
              <div>
                <p className="guardian-popup-kicker">Preuve de paiement</p>
                <h3>{proofPreview.pharmacyName}</h3>
                {proofPreview.transactionReference ? <p className="guardian-popup-subtle">Reference: {proofPreview.transactionReference}</p> : null}
              </div>
              <button type="button" className="guardian-popup-close" onClick={() => setProofPreview(null)}>
                Fermer
              </button>
            </div>
            <div className="admin-proof-modal-frame">
              <img src={proofPreview.url} alt={`Preuve de paiement ${proofPreview.pharmacyName}`} className="admin-proof-modal-image" />
            </div>
          </div>
        </div>
      ) : null}

      {documentViewer ? (
        <InAppDocumentViewer
          title={documentViewer.title}
          src={documentViewer.src}
          onClose={() => setDocumentViewer(null)}
        />
      ) : null}
    </DashboardScaffold>
  );
}

function PaginationControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="dashboard-pagination">
      <span>{page}/{totalPages}</span>
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

function AdminPharmacyCard({
  pharmacy,
  subscription,
  isOnline,
  language,
  onToggleBan,
  onSubscriptionStatusChange,
  onDelete,
}: {
  pharmacy: Pharmacy;
  subscription?: AdminDashboardData["subscriptions"][number];
  isOnline: boolean;
  language: "fr" | "en" | "rn" | "sw" | "ln";
  onToggleBan: (pharmacyId: number, isActive: boolean) => Promise<void>;
  onSubscriptionStatusChange: (pharmacyId: number, subscriptionStatus: "active" | "trial" | "suspended") => Promise<void>;
  onDelete: (pharmacyId: number) => Promise<void>;
}) {
  const subscriptionStatus = subscription?.subscription_status ?? "trial";
  const subscriptionBadgeClass =
    subscriptionStatus === "active" ? "success" : subscriptionStatus === "trial" ? "info" : "warning";
  const subscriptionLabel =
    subscriptionStatus === "active"
      ? "Verifiee"
      : subscriptionStatus === "trial"
        ? `Trial period${typeof subscription?.days_remaining === "number" ? ` · ${subscription.days_remaining} j` : ""}`
        : "Suspendue";

  return (
    <article className="admin-data-card admin-pharmacy-dashboard-card">
      <div className="admin-card-header">
        <div className="admin-profile-chip">
          {pharmacy.profile_image ? (
            <img src={resolveMediaUrl(pharmacy.profile_image) ?? ""} alt={pharmacy.name} className="admin-profile-chip-image" />
          ) : (
            <div className="admin-profile-chip-fallback">{pharmacy.name.slice(0, 1).toUpperCase()}</div>
          )}
          <div>
            <div className="admin-name-row">
              <strong>{pharmacy.name}</strong>
              <span className={isOnline ? "admin-online-dot online" : "admin-online-dot"} aria-label={isOnline ? "En ligne" : "Hors ligne"} />
            </div>
            <small>{pharmacy.phone_number}</small>
          </div>
        </div>
        <div className="admin-pharmacy-status-row">
          <span className={`badge ${pharmacy.is_active === false ? "warning" : "success"}`}>{pharmacy.is_active === false ? "Bannie" : "Active"}</span>
          <span className={`badge ${subscriptionBadgeClass}`}>{subscriptionLabel}</span>
        </div>
      </div>
      <div className="admin-pharmacy-dashboard-details">
        <p>{pharmacy.city}</p>
        <p>{pharmacy.address}</p>
        <small>Inscription: {formatExactDateTime(pharmacy.created_at, language)}</small>
        <small>Abonnement: {subscriptionStatus}</small>
      </div>
      <div className="admin-card-actions admin-card-actions-rail" role="toolbar" aria-label={`Actions pour ${pharmacy.name}`}>
        <ActionIconButton
          label={subscriptionStatus === "active" ? "Pharmacie deja active" : "Activer la pharmacie"}
          title={subscriptionStatus === "active" ? "Activee" : "Activer"}
          tone="success"
          onClick={() => void onSubscriptionStatusChange(pharmacy.id, "active")}
        >
          <CheckIcon />
        </ActionIconButton>
        <ActionIconButton
          label={subscriptionStatus === "suspended" ? "Pharmacie deja suspendue" : "Suspendre la pharmacie"}
          title={subscriptionStatus === "suspended" ? "Suspendue" : "Suspendre"}
          tone="warning"
          onClick={() => void onSubscriptionStatusChange(pharmacy.id, "suspended")}
        >
          <SuspendIcon />
        </ActionIconButton>
        <ActionIconButton
          label={pharmacy.is_active === false ? "Reactiver la pharmacie" : "Bannir la pharmacie"}
          title={pharmacy.is_active === false ? "Reactiver" : "Bannir"}
          tone={pharmacy.is_active === false ? "success" : "warning"}
          onClick={() => void onToggleBan(pharmacy.id, pharmacy.is_active !== false)}
        >
          <BanIcon />
        </ActionIconButton>
        <ActionIconButton label="Supprimer la pharmacie" title="Supprimer" tone="danger" onClick={() => void onDelete(pharmacy.id)}>
          <TrashIcon />
        </ActionIconButton>
      </div>
    </article>
  );
}

function BarChartCard({
  title,
  bars,
}: {
  title: string;
  bars: Array<{ label: string; value: number }>;
}) {
  const maxValue = Math.max(1, ...bars.map((item) => item.value));

  return (
    <div className="admin-graph-card admin-performance-card">
      <div className="admin-graph-head">
        <strong>{title}</strong>
      </div>
      <div className="admin-performance-bars">
        {bars.map((bar) => (
          <div key={bar.label} className="admin-performance-bar-row">
            <div className="admin-performance-bar-head">
              <span>{bar.label}</span>
              <strong>{bar.value}</strong>
            </div>
            <div className="admin-performance-bar-track" aria-hidden="true">
              <div className="admin-performance-bar-fill" style={{ width: `${(bar.value / maxValue) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChartCard({
  values,
  labels,
}: {
  values: number[];
  labels: string[];
}) {
  const maxValue = Math.max(1, ...values);
  const areaPoints = `0,100 ${values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - (value / maxValue) * 100;
      return `${x},${y}`;
    })
    .join(" ")} 100,100`;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - (value / maxValue) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="admin-graph-card admin-graph-card-wide admin-activity-card">
      <div className="admin-activity-chart-shell">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="admin-line-chart">
          <defs>
            <linearGradient id="admin-activity-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(76, 111, 255, 0.32)" />
              <stop offset="100%" stopColor="rgba(76, 111, 255, 0.04)" />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} className="admin-line-area" />
          <polyline points={points} className="admin-line-path" />
          {values.map((value, index) => {
            const x = (index / Math.max(values.length - 1, 1)) * 100;
            const y = 100 - (value / maxValue) * 100;
            return <circle key={`${labels[index]}-${index}`} cx={x} cy={y} r="2.1" className="admin-line-point" />;
          })}
        </svg>
        <div className="admin-line-labels admin-activity-labels">
          {labels.map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>
      </div>
      <div className="admin-activity-summary">
        {labels.map((label, index) => (
          <div key={`${label}-summary`} className="admin-activity-summary-item">
            <span>{label}</span>
            <strong>{values[index] ?? 0}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function DonutCard({
  title,
  segments,
}: {
  title: string;
  segments: Array<{ label: string; value: number; colorClass: string }>;
}) {
  const total = Math.max(1, segments.reduce((sum, segment) => sum + segment.value, 0));
  let offset = 0;

  return (
    <div className="admin-graph-card">
      <div className="admin-graph-head">
        <strong>{title}</strong>
      </div>
      <div className="admin-donut-layout">
        <svg viewBox="0 0 42 42" className="admin-donut-chart">
          <circle cx="21" cy="21" r="15.9155" className="admin-donut-track" />
          {segments.map((segment) => {
            const strokeDasharray = `${(segment.value / total) * 100} ${100 - (segment.value / total) * 100}`;
            const circle = (
              <circle
                key={segment.label}
                cx="21"
                cy="21"
                r="15.9155"
                className={`admin-donut-segment ${segment.colorClass}`}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={25 - offset}
              />
            );
            offset += (segment.value / total) * 100;
            return circle;
          })}
        </svg>
        <div className="admin-donut-legend">
          {segments.map((segment) => (
            <div key={segment.label} className="admin-donut-legend-row">
              <span className={`admin-donut-dot ${segment.colorClass}`} />
              <span>{segment.label}</span>
              <strong>{segment.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricTrendCard({
  before,
  after,
  successRate,
  failureRate,
}: {
  before: number;
  after: number;
  successRate: number;
  failureRate: number;
}) {
  return (
    <div className="dashboard-summary-stack">
      <div className="dashboard-summary-row">
        <span>Precision avant apprentissage</span>
        <strong>{before}%</strong>
      </div>
      <div className="dashboard-summary-row">
        <span>Precision apres apprentissage</span>
        <strong>{after}%</strong>
      </div>
      <div className="dashboard-summary-row">
        <span>Taux de succes</span>
        <strong>{successRate}%</strong>
      </div>
      <div className="dashboard-summary-row">
        <span>Taux d'echec</span>
        <strong>{failureRate}%</strong>
      </div>
    </div>
  );
}
