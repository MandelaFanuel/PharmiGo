import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import DashboardScaffold, { DashboardPanel, EyeGlyph, RefreshGlyph } from "./DashboardScaffold";
import InAppDocumentViewer from "./InAppDocumentViewer";
import PublicPrescriptionSheet from "./PublicPrescriptionSheet";
import { getChatWebSocketUrl } from "../config/endpoints";
import { getApiOrigin } from "../config/endpoints";
import { usePreferences } from "../context/PreferencesContext";
import { getStoredAuthToken } from "../lib/auth";
import { formatExactDateTime } from "../lib/datetime";
import { logClientError } from "../lib/logger";
import { fetchDashboard, fetchProfile, fetchProtectedDocument } from "../services/api";
import type { DashboardData, PrescriptionRecord } from "../types";

type KPIShape = {
  total_prescriptions: number;
  active_prescriptions: number;
  completed_prescriptions: number;
  avg_response_time: number;
};

type PatientSection = "dashboard" | "prescriptions" | "ocr" | "history" | "new-prescription" | "configuration";

const PAGE_SIZE = 4;
const SEARCH_LOCALES = ["fr-FR", "en-US", "sw-TZ"] as const;
const PATIENT_DASHBOARD_REFRESH_EVENTS = new Set([
  "prescription.created",
  "prescription.confirmed",
  "prescription.search.completed",
  "prescription.pharmacy_selected",
  "prescription.served",
  "prescription.patient_confirmation",
  "notification.broadcast",
  "profile.updated",
]);

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

export default function PatientDashboard({
  onRequestNewPrescription,
  onRequestProfileOpen,
}: {
  onRequestNewPrescription?: () => void;
  onRequestProfileOpen?: () => void;
}) {
  const { language } = usePreferences();
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [profileName, setProfileName] = useState("Patient");
  const [profileMeta, setProfileMeta] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [profileIsOnline, setProfileIsOnline] = useState(false);
  const [activeSection, setActiveSection] = useState<PatientSection>("dashboard");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [kpis, setKpis] = useState<KPIShape>({
    total_prescriptions: 0,
    active_prescriptions: 0,
    completed_prescriptions: 0,
    avg_response_time: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [documentViewer, setDocumentViewer] = useState<{ src: string; title: string; contentType?: string | null; fileName?: string | null } | null>(null);
  const refreshInFlightRef = useRef(false);
  const backgroundRefreshTimerRef = useRef<number | null>(null);
  const lastBackgroundRefreshAtRef = useRef(0);
  const lastSnapshotRef = useRef("");

  const labels = {
    fr: {
      title: "Dashboard Patient",
      subtitle: "Suivi en temps reel des ordonnances, de l'analyse OCR et des confirmations.",
      refresh: "Actualiser",
      silentRefresh: "Mise a jour silencieuse...",
      total: "Total ordonnances",
      active: "En cours",
      completed: "Completees",
      response: "Temps de reponse moyen",
      list: "Ordonnances",
      history: "Historique",
      empty: "Aucune ordonnance pour le moment",
      ocr: "Verification OCR",
      meds: "Medicaments extraits",
      original: "Ordonnance originale",
      originalHint: "Document prive conserve tel qu'il a ete televerse.",
      selectedPharmacy: "Pharmacie choisie",
      viewOriginal: "Voir l'ordonnance originale",
      documentProtected: "Le document original reste protege jusqu'a l'autorisation d'acces.",
      newPrescription: "Nouvelle ordonnance",
      configuration: "Configuration",
      searchPlaceholder: "Rechercher une ordonnance, un statut ou un medicament...",
    },
    en: {
      title: "Patient Dashboard",
      subtitle: "Real-time tracking for prescriptions, OCR analysis, and confirmations.",
      refresh: "Refresh",
      silentRefresh: "Silent refresh...",
      total: "Total prescriptions",
      active: "In progress",
      completed: "Completed",
      response: "Average response time",
      list: "Prescriptions",
      history: "History",
      empty: "No prescriptions yet",
      ocr: "OCR verification",
      meds: "Extracted medicines",
      original: "Original prescription",
      originalHint: "Private document stored exactly as uploaded.",
      selectedPharmacy: "Selected pharmacy",
      viewOriginal: "Open original prescription",
      documentProtected: "The original document remains protected until access is granted.",
      newPrescription: "New prescription",
      configuration: "Configuration",
      searchPlaceholder: "Search prescription, status, or medicine...",
    },
    rn: {
      title: "Dashboard y'Umurwayi",
      subtitle: "Gukurikirana ordonnance, OCR n'ivyemezo mu kanya nyako.",
      refresh: "Subiramwo",
      silentRefresh: "Biriko biravugururwa bucece...",
      total: "Ordonnance zose",
      active: "Ziriko zirakorwa",
      completed: "Zaheze",
      response: "Igihe co kwishura",
      list: "Ordonnance",
      history: "Historique",
      empty: "Nta ordonnance iraboneka",
      ocr: "Verification OCR",
      meds: "Imiti yamenyekanye",
      original: "Ordonnance y'umwimerere",
      originalHint: "Dokima isanzwe ibikwa nk'uko yatewe.",
      selectedPharmacy: "Farumasi yatowe",
      viewOriginal: "Raba ordonnance y'umwimerere",
      documentProtected: "Dokima nyakuri irakingiwe gushika uburenganzira butanzwe.",
      newPrescription: "Ordonnance nshasha",
      configuration: "Configuration",
      searchPlaceholder: "Rondera ordonnance, statut canke umuti...",
    },
    sw: {
      title: "Dashboard ya Mgonjwa",
      subtitle: "Ufuatiliaji wa preskripsheni, OCR na uthibitisho kwa wakati halisi.",
      refresh: "Onyesha upya",
      silentRefresh: "Inasasishwa kimya kimya...",
      total: "Preskripsheni zote",
      active: "Zinazoendelea",
      completed: "Zimekamilika",
      response: "Muda wa wastani wa majibu",
      list: "Preskripsheni",
      history: "Historia",
      empty: "Bado hakuna preskripsheni",
      ocr: "Uhakiki wa OCR",
      meds: "Dawa zilizotolewa",
      original: "Preskripsheni halisi",
      originalHint: "Hati ya siri imehifadhiwa kama ilivyopakiwa.",
      selectedPharmacy: "Duka lililochaguliwa",
      viewOriginal: "Fungua preskripsheni halisi",
      documentProtected: "Hati halisi inalindwa hadi ruhusa itolewe.",
      newPrescription: "Preskripsheni mpya",
      configuration: "Mipangilio",
      searchPlaceholder: "Tafuta preskripsheni, hali au dawa...",
    },
    ln: {
      title: "Dashboard ya Mobeli",
      subtitle: "Kolanda ordonnance, OCR mpe ba confirmations na tango ya solo.",
      refresh: "Zongisa sika",
      silentRefresh: "Ezali kozongisama malembe...",
      total: "Ba ordonnance nyonso",
      active: "Ezali kokoba",
      completed: "Esili",
      response: "Ntango ya eyano ya moyenne",
      list: "Ba ordonnance",
      history: "Historique",
      empty: "Nanu ordonnance ezali te",
      ocr: "Verification OCR",
      meds: "Nkisi emonisami",
      original: "Ordonnance ya liboso",
      originalHint: "Document ya sekele ebombami ndenge batindaki yango.",
      selectedPharmacy: "Pharmacie oyo baponi",
      viewOriginal: "Mona ordonnance ya liboso",
      documentProtected: "Document ya solo ebombami kino nzela epesami.",
      newPrescription: "Ordonnance ya sika",
      configuration: "Configuration",
      searchPlaceholder: "Luka ordonnance, statut to nkisi...",
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
        }, 20000);
        return;
      }

      socket = new WebSocket(getChatWebSocketUrl("public-feed"));
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as { type?: string; event_type?: string };
          if (parsed.type === "feed.event" && parsed.event_type && PATIENT_DASHBOARD_REFRESH_EVENTS.has(parsed.event_type)) {
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
    setPage(1);
  }, [searchTerm, activeSection]);

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearchTerm = deferredSearchTerm.trim().toLowerCase();

  async function loadDashboardData(withLoader = true, silent = false) {
    if (!getStoredAuthToken()) {
      setPrescriptions([]);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    if (withLoader || !prescriptions.length) {
      setIsLoading(true);
    } else if (!silent) {
      setIsRefreshing(true);
    }

    try {
      const [profile, dashboard] = await Promise.all([fetchProfile(), fetchDashboard()]);
      const history = profile.history;
      const historyPrescriptions = history && Array.isArray(history.prescriptions) ? history.prescriptions : [];
      const nextSnapshot = JSON.stringify({
        profileName: profile.username || "Patient",
        profileImage: profile.profile?.profile_image ?? null,
        profileMeta: [profile.profile?.is_online ?? false, profile.profile?.last_seen ?? null, profile.profile?.phone_number ?? null, language],
        prescriptions: historyPrescriptions.map((item) => [item.id, item.status, item.created_at, item.pharmacy, item.public_reference, item.pharmacy_name ?? null]),
        kpis: buildKpis(historyPrescriptions, dashboard),
      });

      if (nextSnapshot === lastSnapshotRef.current) {
        return;
      }

      lastSnapshotRef.current = nextSnapshot;
      startTransition(() => {
        setProfileName(profile.username || "Patient");
        setProfileMeta([formatPresenceLabel(profile.profile?.is_online, profile.profile?.last_seen, language), profile.profile?.phone_number || ""].filter(Boolean).join(" • "));
        setProfileImageUrl(resolveMediaUrl(profile.profile?.profile_image) ?? null);
        setProfileIsOnline(Boolean(profile.profile?.is_online));
        setPrescriptions(historyPrescriptions);
        setKpis(buildKpis(historyPrescriptions, dashboard));
      });
    } catch (error) {
      void error;
      logClientError("Le chargement du tableau de bord patient a echoue.");
    } finally {
      refreshInFlightRef.current = false;
      if (withLoader || !prescriptions.length) {
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
      logClientError("L'ouverture du document ordonnance patient a echoue.");
    }
  }

  function triggerNewPrescriptionFlow() {
    if (onRequestNewPrescription) {
      onRequestNewPrescription();
      return;
    }
    window.dispatchEvent(new CustomEvent("open-upload-modal"));
  }

  function triggerProfileFlow() {
    if (onRequestProfileOpen) {
      onRequestProfileOpen();
      return;
    }
    window.dispatchEvent(new CustomEvent("open-profile-modal"));
  }

  function buildKpis(items: PrescriptionRecord[], dashboard: DashboardData): KPIShape {
    const completedStatuses = new Set(["completed", "served", "patient_confirmed"]);
    const completed = items.filter((item) => completedStatuses.has(item.status)).length;

    return {
      total_prescriptions: items.length,
      active_prescriptions: Math.max(items.length - completed, 0),
      completed_prescriptions: completed,
      avg_response_time: dashboard.kpis?.response_time_minutes ?? 0,
    };
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "completed":
      case "served":
        return "success";
      case "confirmed":
      case "confirmed_unavailable":
      case "searching":
      case "analyzing":
        return "info";
      case "pharmacy_selected":
      case "confirmation_pending":
        return "warning";
      default:
        return "neutral";
    }
  }

  function getStatusLabel(status: string): string {
    const labelMap: Record<string, string> = {
      completed: "Completee",
      served: "Deja servie",
      confirmed: "Confirmee",
      confirmed_unavailable: "Confirmee, medicaments introuvables",
      pharmacy_selected: "Pharmacie selectionnee",
      analyzing: "En analyse",
      searching: "Recherche en cours",
      confirmation_pending: "Confirmation requise",
      patient_confirmed: "Achat confirme",
    };
    return labelMap[status] ?? status;
  }

  const filteredPrescriptions = useMemo(
    () =>
      prescriptions.filter((prescription) =>
        buildSearchIndex(
          [
            prescription.public_reference,
            prescription.medication_name,
            prescription.status,
            getStatusLabel(prescription.status),
            prescription.ocr_text ?? "",
            prescription.pharmacy_name ?? "",
            ...(prescription.extracted_medications ?? []).flatMap((item) => [item.name, item.dosage ?? "", item.form ?? "", item.posology ?? ""]),
          ],
          [prescription.created_at]
        ).includes(normalizedSearchTerm)
      ),
    [normalizedSearchTerm, prescriptions]
  );

  const originalPrescriptions = useMemo(() => filteredPrescriptions, [filteredPrescriptions]);
  const ocrPrescriptions = useMemo(
    () => filteredPrescriptions.filter((item) => Boolean(item.extracted_medications?.length)),
    [filteredPrescriptions]
  );
  const historyPrescriptions = useMemo(() => filteredPrescriptions, [filteredPrescriptions]);
  const sectionPrescriptions =
    activeSection === "ocr" ? ocrPrescriptions : activeSection === "history" ? historyPrescriptions : originalPrescriptions;
  const totalPages = Math.max(1, Math.ceil(sectionPrescriptions.length / PAGE_SIZE));
  const pagedPrescriptions = sectionPrescriptions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const navSections = [
    {
      title: language === "en" ? "Overview" : "Vue generale",
      items: [
        { id: "patient-dashboard", label: "Dashboard", active: activeSection === "dashboard", onClick: () => setActiveSection("dashboard") },
        { id: "patient-prescriptions", label: labels.list, active: activeSection === "prescriptions", onClick: () => setActiveSection("prescriptions") },
        { id: "patient-ocr", label: labels.ocr, active: activeSection === "ocr", onClick: () => setActiveSection("ocr") },
        { id: "patient-history", label: labels.history, active: activeSection === "history", onClick: () => setActiveSection("history") },
        { id: "patient-new", label: labels.newPrescription, active: false, onClick: triggerNewPrescriptionFlow },
      ],
    },
  ];

  const footerSections = [
    {
      title: language === "en" ? "Profile" : "Profil",
      items: [
        { id: "patient-profile", label: "Mon profil", onClick: triggerProfileFlow },
        { id: "patient-config", label: labels.configuration, active: activeSection === "configuration", onClick: () => setActiveSection("configuration") },
      ],
    },
  ];

  const metrics = [
    { label: labels.total, value: kpis.total_prescriptions },
    { label: labels.active, value: kpis.active_prescriptions },
    { label: labels.completed, value: kpis.completed_prescriptions },
    { label: labels.response, value: `${kpis.avg_response_time} min` },
  ];

  const highlights = [
    {
      title: prescriptions[0]?.medication_name || labels.list,
      helper: labels.list,
      meta: prescriptions[0] ? getStatusLabel(prescriptions[0].status) : undefined,
    },
    {
      title: prescriptions.find((item) => item.ocr_text)?.medication_name || labels.ocr,
      helper: labels.ocr,
      meta: prescriptions.find((item) => typeof item.confidence_score === "number")?.confidence_score
        ? `${((prescriptions.find((item) => typeof item.confidence_score === "number")?.confidence_score ?? 0) * 100).toFixed(0)}%`
        : undefined,
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
      roleLabel="PHARMIGO PATIENT"
      searchPlaceholder={labels.searchPlaceholder}
      searchValue={searchTerm}
      onSearchChange={setSearchTerm}
      profileLabel={profileName}
      profileMeta={isRefreshing ? labels.silentRefresh : profileMeta || labels.list}
      profileImageUrl={profileImageUrl}
      profileIsOnline={profileIsOnline}
      navSections={navSections}
      footerSections={footerSections}
      metrics={metrics}
      highlights={highlights}
      topbarActions={
        <>
          <button
            className="dashboard-icon-button dashboard-refresh-button"
            onClick={() => void loadDashboardData()}
            aria-label={labels.refresh}
            title={labels.refresh}
            type="button"
          >
            <RefreshGlyph />
          </button>
        </>
      }
    >
      {activeSection === "dashboard" || activeSection === "prescriptions" ? (
        <DashboardPanel
          title={labels.list}
          description={language === "en" ? "Original uploaded prescriptions stored with private access." : "Ordonnances originales televersees et conservees avec acces prive."}
          className="dashboard-panel-span-3"
        >
          <OriginalPrescriptionCards
            prescriptions={pagedPrescriptions}
            language={language}
            emptyText={labels.empty}
            getStatusColor={getStatusColor}
            getStatusLabel={getStatusLabel}
            labels={labels}
            onOpenDocument={handleOpenDocument}
          />
          <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
        </DashboardPanel>
      ) : null}

      {activeSection === "ocr" ? (
        <DashboardPanel
          title={labels.ocr}
          description={language === "en" ? "Confirmed medicines remain tied to the same public reference." : "Les medicaments confirmes restent lies a la meme reference publique."}
          className="dashboard-panel-span-3"
        >
          <ConfirmedMedicationCards
            prescriptions={pagedPrescriptions}
            emptyText={labels.empty}
          />
          <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
        </DashboardPanel>
      ) : null}

      {activeSection === "history" ? (
        <DashboardPanel
          title={labels.history}
          description={language === "en" ? "Chronological history of your uploaded prescriptions and statuses." : "Historique chronologique de vos ordonnances televersees et de leurs statuts."}
          className="dashboard-panel-span-3"
        >
          <HistoryCards prescriptions={pagedPrescriptions} language={language} emptyText={labels.empty} getStatusColor={getStatusColor} getStatusLabel={getStatusLabel} selectedPharmacyLabel={labels.selectedPharmacy} />
          <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
        </DashboardPanel>
      ) : null}

      {activeSection === "new-prescription" ? (
        <DashboardPanel
          title={labels.newPrescription}
          description={language === "en" ? "Open the prescription publishing flow directly from the dashboard." : "Ouvrez directement la publication d'ordonnance depuis le dashboard."}
          className="dashboard-panel-span-3"
        >
          <div className="dashboard-action-stack">
            <button type="button" className="primary-button" onClick={triggerNewPrescriptionFlow}>
              {labels.newPrescription}
            </button>
          </div>
        </DashboardPanel>
      ) : null}

      {activeSection === "configuration" ? (
        <DashboardPanel
          title={labels.configuration}
          description={language === "en" ? "Identity data visible on your profile and dashboard." : "Donnees d'identite visibles sur votre profil et votre dashboard."}
          className="dashboard-panel-span-3"
        >
          <div className="dashboard-summary-stack">
            <div className="dashboard-summary-row">
              <span>Profil</span>
              <strong>{profileName}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span>Nom</span>
              <strong>{profileName}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span>Numero</span>
              <strong>{profileMeta || "Non renseigne"}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span>Ordonnances suivies</span>
              <strong>{kpis.total_prescriptions}</strong>
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

function OriginalPrescriptionCards({
  prescriptions,
  language,
  emptyText,
  getStatusColor,
  getStatusLabel,
  labels,
  onOpenDocument,
}: {
  prescriptions: PrescriptionRecord[];
  language: "fr" | "en" | "rn" | "sw" | "ln";
  emptyText: string;
  getStatusColor: (status: string) => string;
  getStatusLabel: (status: string) => string;
  labels: { original: string; originalHint: string; selectedPharmacy: string; viewOriginal: string; documentProtected: string };
  onOpenDocument: (prescription: PrescriptionRecord) => void;
}) {
  if (!prescriptions.length) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="dashboard-record-list dashboard-mobile-single-stack">
      {prescriptions.map((prescription) => {
        const documentUrl = getPrescriptionDocumentUrl(prescription);
        const selectedPharmacy = prescription.pharmacy_name || "En attente";
        return (
          <article key={prescription.id} className="dashboard-record-card">
            <div className="dashboard-record-head">
              <div>
                <strong>{prescription.medication_name}</strong>
                <small>
                  <span className="public-reference-badge">{getPrescriptionReference(prescription)}</span> {formatExactDateTime(prescription.created_at, language)}
                </small>
              </div>
              <span className={`badge ${getStatusColor(prescription.status)}`}>{getStatusLabel(prescription.status)}</span>
            </div>

            <div className="dashboard-data-block dashboard-data-block-info">
              <span>{labels.original}</span>
              <p>{labels.originalHint}</p>
              <small>{labels.selectedPharmacy}: {selectedPharmacy}</small>
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
                  <p>{labels.originalHint}</p>
                  <button type="button" className="secondary-button dashboard-document-action" onClick={() => onOpenDocument(prescription)} aria-label={labels.viewOriginal} title={labels.viewOriginal}>
                    <EyeGlyph />
                    <span>{labels.viewOriginal}</span>
                  </button>
                </div>
              )
            ) : (
              <div className="prescription-document-panel dashboard-document-panel">
                <p>{labels.documentProtected}</p>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ConfirmedMedicationCards({
  prescriptions,
  emptyText,
}: {
  prescriptions: PrescriptionRecord[];
  emptyText: string;
}) {
  if (!prescriptions.length) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="dashboard-record-list dashboard-mobile-single-stack">
      {prescriptions.map((prescription) => (
        <PublicPrescriptionSheet
          key={prescription.id}
          prescription={prescription}
          title={prescription.medication_name || "Ordonnance confirmee"}
          className="compact dashboard-prescription-sheet"
        />
      ))}
    </div>
  );
}

function HistoryCards({
  prescriptions,
  language,
  emptyText,
  getStatusColor,
  getStatusLabel,
  selectedPharmacyLabel,
}: {
  prescriptions: PrescriptionRecord[];
  language: "fr" | "en" | "rn" | "sw" | "ln";
  emptyText: string;
  getStatusColor: (status: string) => string;
  getStatusLabel: (status: string) => string;
  selectedPharmacyLabel: string;
}) {
  if (!prescriptions.length) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="dashboard-record-list dashboard-mobile-single-stack">
      {prescriptions.map((prescription) => (
        <article key={`history-${prescription.id}`} className="dashboard-record-card">
          <div className="dashboard-record-head">
            <div>
              <strong>{prescription.medication_name}</strong>
              <small>
                <span className="public-reference-badge">{getPrescriptionReference(prescription)}</span> {formatExactDateTime(prescription.created_at, language)}
              </small>
            </div>
            <span className={`badge ${getStatusColor(prescription.status)}`}>{getStatusLabel(prescription.status)}</span>
          </div>
          <div className="dashboard-data-block">
            <span>{selectedPharmacyLabel}</span>
            <p>{prescription.pharmacy_name || "En attente de selection"}</p>
          </div>
        </article>
      ))}
    </div>
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
