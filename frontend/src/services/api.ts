import axios from "axios";

import { API_ENDPOINTS, getApiBaseUrl } from "../config/endpoints";
import { clearStoredAuthSession, getStoredAuthToken } from "../lib/auth";
import { logClientError } from "../lib/logger";
import type {
  AdminDashboardData,
  AppConfig,
  AuthResponse,
  ChatBotMessage,
  ChatBotPayload,
  ChatBotResponse,
  ChatMessage,
  DashboardData,
  EndpointItem,
  MatchedPharmacy,
  Notification,
  Pharmacy,
  PrescriptionRecommendationsResponse,
  PrescriptionAnalysisTaskResult,
  PrescriptionPayload,
  PrescriptionUploadReceipt,
  PrescriptionRecord,
  PrescriptionResponse,
} from "../types";

const api = axios.create({
  baseURL: getApiBaseUrl(),
});

async function postWithFallback<T>(primaryUrl: string, fallbackUrl: string, body: unknown, headers?: Record<string, string>) {
  try {
    const { data } = await api.post<T>(primaryUrl, body, headers ? { headers } : undefined);
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      const { data } = await api.post<T>(fallbackUrl, body, headers ? { headers } : undefined);
      return data;
    }
    throw error;
  }
}

api.interceptors.request.use((config) => {
  const token = getStoredAuthToken();
  if (token) {
    config.headers.Authorization = `Token ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const requestUrl = String(error.config?.url ?? "");
      const isAuthRequest =
        requestUrl.includes("/auth/login/") ||
        requestUrl.includes("/login/") ||
        requestUrl.includes("/auth/register/") ||
        requestUrl.includes("/register/") ||
        requestUrl.includes("/password-reset/");

      if (!isAuthRequest) {
        clearStoredAuthSession();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("pharmigo-auth-expired"));
        }
      }
    }

    return Promise.reject(error);
  }
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseNumeric(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizePharmacy(value: unknown): Pharmacy {
  if (!isRecord(value)) {
    throw new Error("Invalid pharmacy data format");
  }

  const subscriptionStatus =
    typeof value.subscription_status === "string"
      ? value.subscription_status
      : typeof value.status === "string"
        ? value.status
        : typeof value.account_status === "string"
          ? value.account_status
          : null;

  const deliverySupported =
    typeof value.delivery_supported === "boolean"
      ? value.delivery_supported
      : typeof value.delivery_available === "boolean"
        ? value.delivery_available
        : false;

  return {
    id: typeof value.id === "number" ? value.id : 0,
    name: typeof value.name === "string" ? value.name : "Pharmacie inconnue",
    profile_image: typeof value.profile_image === "string" || value.profile_image === null ? value.profile_image : null,
    city: typeof value.city === "string" ? value.city : "",
    address: typeof value.address === "string" ? value.address : "",
    phone_number: typeof value.phone_number === "string" ? value.phone_number : "",
    email: typeof value.email === "string" ? value.email : "",
    opening_hours: typeof value.opening_hours === "string" ? value.opening_hours : "",
    delivery_supported: deliverySupported,
    delivery_available: deliverySupported,
    latitude: typeof value.latitude === "number" || value.latitude === null ? value.latitude : null,
    longitude: typeof value.longitude === "number" || value.longitude === null ? value.longitude : null,
    created_at: typeof value.created_at === "string" ? value.created_at : new Date().toISOString(),
    is_active: typeof value.is_active === "boolean" ? value.is_active : true,
    is_online: typeof value.is_online === "boolean" ? value.is_online : false,
    last_seen: typeof value.last_seen === "string" || value.last_seen === null ? value.last_seen : null,
    subscription_status: subscriptionStatus,
    trial_days_remaining: typeof value.trial_days_remaining === "number" ? value.trial_days_remaining : null,
    is_official:
      typeof value.is_official === "boolean"
        ? value.is_official
        : typeof subscriptionStatus === "string"
          ? subscriptionStatus === "active"
          : false,
    cover_image: typeof value.cover_image === "string" ? value.cover_image : "",
    logo: typeof value.logo === "string" ? value.logo : "",
    rating: typeof value.rating === "number" ? value.rating : 0,
    distance_km: typeof value.distance_km === "number" ? value.distance_km : 0,
    is_open: typeof value.is_open === "boolean" ? value.is_open : true,
    response_time_minutes:
      typeof value.response_time_minutes === "number" ? value.response_time_minutes : 30,
    prescription_count: typeof value.prescription_count === "number" ? value.prescription_count : 0,
    response_count: typeof value.response_count === "number" ? value.response_count : 0,
    comment_count: typeof value.comment_count === "number" ? value.comment_count : 0,
    comments: Array.isArray(value.comments) ? (value.comments as Pharmacy["comments"]) : [],
    like_count: typeof value.like_count === "number" ? value.like_count : 0,
    share_count: typeof value.share_count === "number" ? value.share_count : 0,
    viewer_has_liked: typeof value.viewer_has_liked === "boolean" ? value.viewer_has_liked : false,
    viewer_has_shared: typeof value.viewer_has_shared === "boolean" ? value.viewer_has_shared : false,
  };
}

function normalizeAppConfig(value: unknown): AppConfig {
  if (!isRecord(value)) {
    return mockConfig;
  }

  const product = isRecord(value.product) ? value.product : {};

  return {
    product: {
      name: typeof product.name === "string" && product.name.trim() ? product.name : mockConfig.product.name,
      vision: typeof product.vision === "string" ? product.vision : mockConfig.product.vision,
      countries: Array.isArray(product.countries)
        ? product.countries.filter((item): item is string => typeof item === "string")
        : mockConfig.product.countries,
    },
    actors: Array.isArray(value.actors)
      ? value.actors.filter((item): item is string => typeof item === "string")
      : mockConfig.actors,
    features: Array.isArray(value.features)
      ? value.features.filter((item): item is string => typeof item === "string")
      : mockConfig.features,
    security: Array.isArray(value.security)
      ? value.security.filter((item): item is string => typeof item === "string")
      : mockConfig.security,
    evolution: Array.isArray(value.evolution)
      ? value.evolution.filter((item): item is string => typeof item === "string")
      : mockConfig.evolution,
    languages: Array.isArray(value.languages)
      ? value.languages.filter((item): item is string => typeof item === "string")
      : mockConfig.languages,
    themes: Array.isArray(value.themes)
      ? value.themes.filter((item): item is string => typeof item === "string")
      : mockConfig.themes,
  };
}

function normalizeDashboard(value: unknown): DashboardData {
  if (!isRecord(value)) {
    return {
      kpis: {
        response_time_minutes: 0,
        resolution_rate: 0,
        satisfaction_score: 0,
        active_pharmacies: 0,
        live_prescriptions: 0,
        confirmed_quotes: 0,
      },
      journeys: {
        patient: [],
        pharmacy: [],
      },
      pharmacies: [],
      prescriptions: [],
      responses: [],
      notifications: [],
      messages: [],
    };
  }

  return {
    kpis: isRecord(value.kpis)
      ? {
        response_time_minutes:
          typeof value.kpis.response_time_minutes === "number"
            ? value.kpis.response_time_minutes
            : 0,
        resolution_rate:
          typeof value.kpis.resolution_rate === "number"
            ? value.kpis.resolution_rate
            : 0,
        satisfaction_score:
          typeof value.kpis.satisfaction_score === "number"
            ? value.kpis.satisfaction_score
            : 0,
        active_pharmacies:
          typeof value.kpis.active_pharmacies === "number"
            ? value.kpis.active_pharmacies
            : 0,
        live_prescriptions:
          typeof value.kpis.live_prescriptions === "number"
            ? value.kpis.live_prescriptions
            : 0,
        confirmed_quotes:
          typeof value.kpis.confirmed_quotes === "number"
            ? value.kpis.confirmed_quotes
            : 0,
      }
      : {
        response_time_minutes: 0,
        resolution_rate: 0,
        satisfaction_score: 0,
        active_pharmacies: 0,
        live_prescriptions: 0,
        confirmed_quotes: 0,
      },
    journeys: isRecord(value.journeys)
      ? {
        patient: Array.isArray(value.journeys.patient)
          ? value.journeys.patient.filter((item): item is string => typeof item === "string")
          : [],
        pharmacy: Array.isArray(value.journeys.pharmacy)
          ? value.journeys.pharmacy.filter((item): item is string => typeof item === "string")
          : [],
      }
      : {
        patient: [],
        pharmacy: [],
      },
    pharmacies: Array.isArray(value.pharmacies)
      ? value.pharmacies.flatMap((item) => {
        try {
          return [normalizePharmacy(item)];
        } catch {
          return [];
        }
      })
      : [],
    prescriptions: Array.isArray(value.prescriptions)
      ? value.prescriptions.filter((item): item is DashboardData["prescriptions"][number] => isRecord(item))
      : [],
    responses: Array.isArray(value.responses)
      ? value.responses.filter((item): item is DashboardData["responses"][number] => isRecord(item))
      : [],
    notifications: Array.isArray(value.notifications)
      ? value.notifications.filter((item): item is Notification => isRecord(item))
      : [],
    messages: Array.isArray(value.messages)
      ? value.messages.filter((item): item is ChatMessage => isRecord(item))
      : [],
  };
}


const emptyDashboard: DashboardData = {
  kpis: {
    response_time_minutes: 0,
    resolution_rate: 0,
    satisfaction_score: 0,
    active_pharmacies: 0,
    live_prescriptions: 0,
    confirmed_quotes: 0,
  },
  journeys: {
    patient: [],
    pharmacy: [],
  },
  pharmacies: [],
  prescriptions: [],
  responses: [],
  notifications: [],
  messages: [],
};

const mockConfig: AppConfig = {
  product: {
    name: "PharmiGo",
    vision: "Digitaliser la recherche de medicaments et diffuser les ordonnances en temps reel.",
    countries: ["RDC", "Burundi"],
  },
  actors: ["Patient", "Pharmacie", "Administrateur", "IA", "Blockchain"],
  features: ["Upload ordonnance", "Diffusion temps reel", "Reponses pharmacies", "Chat", "Notifications"],
  security: ["Authentification", "Chiffrement", "Protection des donnees medicales"],
  evolution: ["Paiement", "Livraison", "Teleconsultation"],
  languages: ["fr", "en", "rn", "sw", "ln"],
  themes: ["light", "dark", "system"],
};

const mockEndpoints: EndpointItem[] = [
  { name: "dashboard", method: "GET", path: "/api/dashboard/" },
  { name: "admin_dashboard", method: "GET,PATCH", path: "/api/admin/dashboard/" },
  { name: "pharmacies", method: "GET,POST", path: "/api/pharmacies/" },
  { name: "prescriptions", method: "GET,POST", path: "/api/prescriptions/" },
  { name: "prescription_responses", method: "GET,POST", path: "/api/prescription-responses/" },
  { name: "messages", method: "GET,POST", path: "/api/messages/" },
  { name: "notifications", method: "GET,POST", path: "/api/notifications/" },
];

export async function fetchAppConfig(): Promise<AppConfig> {
  try {
    const { data } = await api.get<AppConfig>(API_ENDPOINTS.appConfig);
    return normalizeAppConfig(data);
  } catch {
    return mockConfig;
  }
}

export async function fetchDashboard(): Promise<DashboardData> {
  try {
    const { data } = await api.get<DashboardData>(API_ENDPOINTS.dashboard);
    return normalizeDashboard(data);
  } catch {
    return emptyDashboard;
  }
}

export async function fetchAdminDashboard(): Promise<AdminDashboardData> {
  const { data } = await api.get<AdminDashboardData>(API_ENDPOINTS.adminDashboard);
  return data;
}

export async function updateAdminSettings(payload: {
  trial_period_days?: number;
  monthly_price_usd?: number;
  payment_methods?: Array<{
    code: string;
    label: string;
    currency: string;
    enabled: boolean;
    account_name: string;
    account_number: string;
    instructions: string;
  }>;
  ai_settings?: {
    human_layer?: boolean;
    learning_passif?: boolean;
    fallback_ai?: boolean;
    memory_engine?: boolean;
    semantic_search?: boolean;
    local_reasoning?: boolean;
  };
}): Promise<AdminDashboardData> {
  const { data } = await api.patch<AdminDashboardData>(API_ENDPOINTS.adminDashboard, {
    ...payload,
  });
  return data;
}

export async function fetchEndpointCatalog(): Promise<EndpointItem[]> {
  try {
    const { data } = await api.get<EndpointItem[]>(API_ENDPOINTS.endpoints);
    return data;
  } catch {
    return mockEndpoints;
  }
}

export async function fetchPharmacies(): Promise<Pharmacy[]> {
  try {
    const { data } = await api.get<Pharmacy[]>(API_ENDPOINTS.pharmacies);
    return Array.isArray(data) ? data.map((item) => normalizePharmacy(item)) : [];
  } catch (error) {
    void error;
    logClientError("Impossible de charger la liste des pharmacies.");
    return [];
  }
}

export async function fetchPharmacy(id: string): Promise<Pharmacy> {
  try {
    const { data } = await api.get<Pharmacy>(`${API_ENDPOINTS.pharmacies}${id}/`);
    return normalizePharmacy(data);
  } catch (error) {
    void error;
    logClientError("Impossible de charger la fiche pharmacie.");
    // Return a default pharmacy object to prevent crashes
    return {
      id: 0,
      name: "Pharmacie indisponible",
      profile_image: null,
      city: "",
      address: "",
      phone_number: "",
      email: "",
      opening_hours: "",
      delivery_supported: false,
      delivery_available: false,
      latitude: null,
      longitude: null,
      created_at: new Date().toISOString(),
      cover_image: "",
      logo: "",
      rating: 0,
      distance_km: 0,
      is_open: false,
      response_time_minutes: 30,
    };
  }
}

export async function fetchNotifications(): Promise<Notification[]> {
  try {
    const { data } = await api.get<Notification[]>(API_ENDPOINTS.notifications);
    return data;
  } catch {
    return [];
  }
}

export async function markNotificationAsRead(notificationId: number): Promise<Notification> {
  const { data } = await api.patch<Notification>(`${API_ENDPOINTS.notifications}${notificationId}/`, {
    is_read: true,
  });
  return data;
}

export async function markAllNotificationsAsRead(): Promise<void> {
  await api.patch(`${API_ENDPOINTS.notifications}mark-all-read/`);
}

export async function deleteNotification(notificationId: number): Promise<void> {
  await api.delete(`${API_ENDPOINTS.notifications}${notificationId}/`);
}

export async function deleteAllNotifications(): Promise<void> {
  await api.delete(`${API_ENDPOINTS.notifications}clear-all/`);
}

export async function sendPresenceHeartbeat(): Promise<void> {
  await api.post(API_ENDPOINTS.presenceHeartbeat);
}

export async function sendPresenceOffline(): Promise<void> {
  await api.post(API_ENDPOINTS.presenceOffline);
}

export async function logout(): Promise<void> {
  await api.post(API_ENDPOINTS.authLogout);
}

export async function fetchMessages(): Promise<ChatMessage[]> {
  try {
    const { data } = await api.get<ChatMessage[]>(API_ENDPOINTS.messages);
    return data;
  } catch {
    return [];
  }
}

export async function fetchPrescriptions(): Promise<PrescriptionRecord[]> {
  try {
    const { data } = await api.get<PrescriptionRecord[]>(API_ENDPOINTS.prescriptions);
    return data;
  } catch {
    return [];
  }
}

export async function fetchPharmacyStock() {
  const { data } = await api.get(`${API_ENDPOINTS.prescriptions}pharmacy-stock/`);
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((item) => {
    if (!isRecord(item)) {
      return item;
    }
    return {
      ...item,
      quantity: parseNumeric(item.quantity, 0),
      price: parseNumeric(item.price, 0),
      is_available: typeof item.is_available === "boolean" ? item.is_available : Boolean(item.is_available),
    };
  });
}

export async function createPharmacyStockItem(payload: object) {
  const { data } = await api.post(`${API_ENDPOINTS.prescriptions}pharmacy-stock/`, payload);
  return data;
}

export async function updatePharmacyStockItem(id: number, payload: object) {
  const { data } = await api.put(`${API_ENDPOINTS.prescriptions}pharmacy-stock/${id}/`, payload);
  return data;
}

export async function patchPharmacyStockItem(id: number, payload: object) {
  const { data } = await api.patch(`${API_ENDPOINTS.prescriptions}pharmacy-stock/${id}/`, payload);
  return data;
}

export async function deletePharmacyStockItem(id: number) {
  await api.delete(`${API_ENDPOINTS.prescriptions}pharmacy-stock/${id}/`);
}

export async function fetchPrescriptionResponses(): Promise<PrescriptionResponse[]> {
  try {
    const { data } = await api.get<PrescriptionResponse[]>(API_ENDPOINTS.prescriptionResponses);
    return data;
  } catch {
    return [];
  }
}

export async function postMessage(
  payload: Pick<ChatMessage, "sender_name" | "sender_role" | "message" | "pharmacy" | "recipient_user">
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(API_ENDPOINTS.messages, payload);
  return data;
}

export async function submitPrescription(payload: PrescriptionPayload): Promise<PrescriptionUploadReceipt> {
  const formData = new FormData();
  const token = getStoredAuthToken();
  formData.append("patient_name", payload.patient_name || payload.medication_name || "");
  formData.append("patient_email", payload.patient_email || "");
  formData.append("medication_name", payload.medication_name || "Ordonnance medicale");
  formData.append("dosage", payload.dosage || "Analyse ordonnance");
  formData.append("instructions", payload.instructions || "Ordonnance soumise depuis PharmiGo.");

  if (payload.analysis_text?.trim()) {
    formData.append("analysis_text", payload.analysis_text.trim());
  }

  if (payload.prescription_file instanceof File) {
    // Send as prescription_image if it's an image, otherwise as prescription_file
    if (payload.prescription_file.type.startsWith("image/")) {
      formData.append("prescription_image", payload.prescription_file);
    } else {
      formData.append("prescription_file", payload.prescription_file);
    }
  }

  const { data } = await api.post<PrescriptionUploadReceipt>(API_ENDPOINTS.uploadPrescription, formData, {
    headers: token ? { Authorization: `Token ${token}` } : undefined,
  });
  return data;
}

export async function fetchPrescriptionAnalysisTask(taskId: string): Promise<PrescriptionAnalysisTaskResult> {
  const { data } = await api.get<PrescriptionAnalysisTaskResult>(`${API_ENDPOINTS.prescriptionAnalysis}${taskId}/`);
  return data;
}

export async function selectPrescriptionPharmacy(
  prescriptionId: number,
  pharmacyId: number
): Promise<{ prescription_id: number; public_reference?: string; selected_pharmacy: MatchedPharmacy | { id: number; name: string; address: string }; status: string }> {
  const { data } = await api.post(
    `${API_ENDPOINTS.prescriptions}${prescriptionId}/select-pharmacy/`,
    { pharmacy_id: pharmacyId }
  );
  return data;
}

export async function confirmPrescriptionMedications(
  prescriptionId: number,
  medications: Array<{
    id: number;
    confirmed: boolean;
    corrected_name?: string;
    dosage?: string;
    form?: string;
    quantity?: number;
    posology?: string;
  }>,
  addedMedications: Array<{
    name: string;
    dosage?: string;
    form?: string;
    quantity?: number;
    posology?: string;
  }> = []
): Promise<PrescriptionRecord> {
  const { data } = await api.post<PrescriptionRecord>(API_ENDPOINTS.confirmPrescription, {
    prescription_id: prescriptionId,
    medications,
    added_medications: addedMedications,
  });
  return data;
}

export async function searchPrescriptionPharmacies(
  prescriptionId: number
): Promise<{ prescription_id: number; pharmacies: MatchedPharmacy[]; recommendations?: MatchedPharmacy[]; total_pharmacies: number; status?: string; message?: string }> {
  const { data } = await api.get<{ prescription_id: number; pharmacies: MatchedPharmacy[]; recommendations?: MatchedPharmacy[]; total_pharmacies: number; status?: string; message?: string }>(
    `${API_ENDPOINTS.prescriptions}${prescriptionId}/search-pharmacies/`
  );
  return data;
}

export async function fetchPrescriptionRecommendations(
  prescriptionId: number
): Promise<PrescriptionRecommendationsResponse> {
  const { data } = await api.get<PrescriptionRecommendationsResponse>(
    `${API_ENDPOINTS.prescriptions}${prescriptionId}/recommendations/`
  );
  return data;
}

export async function login(payload: { email: string; password: string }): Promise<AuthResponse> {
  return postWithFallback<AuthResponse>(API_ENDPOINTS.authLogin, API_ENDPOINTS.authLoginFallback, payload);
}

export async function register(payload: {
  account_type: "patient" | "pharmacy";
  username?: string;
  phone_number?: string;
  birth_date?: string;
  gender?: "male" | "female" | "other" | "";
  email?: string;
  password: string;
  pharmacy_name?: string;
  address?: string;
  pharmacy_image?: File | null;
  latitude?: number;
  longitude?: number;
  location_city?: string;
  location_country?: string;
}): Promise<AuthResponse> {
  let body: FormData | typeof payload = payload;
  if (payload.account_type === "pharmacy" && payload.pharmacy_image) {
    const formData = new FormData();
    formData.append("account_type", payload.account_type);
    formData.append("password", payload.password);
    formData.append("pharmacy_name", payload.pharmacy_name ?? "");
    formData.append("phone_number", payload.phone_number ?? "");
    formData.append("email", payload.email ?? "");
    formData.append("address", payload.address ?? "");
    if (typeof payload.latitude === "number") {
      formData.append("latitude", String(payload.latitude));
    }
    if (typeof payload.longitude === "number") {
      formData.append("longitude", String(payload.longitude));
    }
    if (payload.location_city) {
      formData.append("location_city", payload.location_city);
    }
    if (payload.location_country) {
      formData.append("location_country", payload.location_country);
    }
    formData.append("pharmacy_image", payload.pharmacy_image);
    body = formData;
  }

  return postWithFallback<AuthResponse>(API_ENDPOINTS.authRegister, API_ENDPOINTS.authRegisterFallback, body);
}

export async function loginWithGoogle(payload: { credential: string }): Promise<AuthResponse> {
  return postWithFallback<AuthResponse>(API_ENDPOINTS.authGoogle, API_ENDPOINTS.authGoogleFallback, payload);
}

export async function verifyEmail(payload: { token: string }): Promise<{ message: string; user: AuthResponse["user"] }> {
  return postWithFallback<{ message: string; user: AuthResponse["user"] }>(
    API_ENDPOINTS.authVerifyEmail,
    API_ENDPOINTS.authVerifyEmailFallback,
    payload
  );
}

export async function resendVerificationEmail(payload: { email: string }): Promise<{ message: string; email_delivery_mode?: "smtp" | "console_preview"; debug_verification_token?: string }> {
  return postWithFallback<{ message: string; email_delivery_mode?: "smtp" | "console_preview"; debug_verification_token?: string }>(
    API_ENDPOINTS.authResendVerificationEmail,
    API_ENDPOINTS.authResendVerificationEmailFallback,
    payload
  );
}

export async function requestPasswordReset(payload: { email: string }): Promise<{ message: string }> {
  return postWithFallback<{ message: string }>(
    API_ENDPOINTS.authPasswordReset,
    API_ENDPOINTS.authPasswordResetFallback,
    payload
  );
}

export async function confirmPasswordReset(payload: {
  uid: string;
  token: string;
  new_password: string;
}): Promise<{ message: string }> {
  return postWithFallback<{ message: string }>(
    API_ENDPOINTS.authPasswordResetConfirm,
    API_ENDPOINTS.authPasswordResetConfirmFallback,
    payload
  );
}

export async function fetchProfile(): Promise<AuthResponse["user"]> {
  const { data } = await api.get<AuthResponse["user"]>(API_ENDPOINTS.profile);
  return data;
}

export async function fetchProtectedDocument(documentUrl: string): Promise<string> {
  const { data, headers } = await api.get<Blob>(documentUrl, {
    responseType: "blob",
  });
  const contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : undefined;
  const blob = data instanceof Blob ? data : new Blob([data], { type: contentType });
  return URL.createObjectURL(blob);
}

export async function updatePatientProfile(payload: { username: string; phone_number: string; email?: string }): Promise<AuthResponse["user"]> {
  const { data } = await api.patch<AuthResponse["user"]>(API_ENDPOINTS.profile, payload);
  return data;
}

export async function updateProfileLocation(payload: {
  latitude: number;
  longitude: number;
  location_city?: string;
  location_country?: string;
}): Promise<AuthResponse["user"]> {
  const { data } = await api.patch<AuthResponse["user"]>(API_ENDPOINTS.profile, payload);
  return data;
}

export async function updateAdminProfile(payload: {
  username: string;
  email: string;
  profile_image?: File | null;
}): Promise<AuthResponse["user"]> {
  const formData = new FormData();
  formData.append("username", payload.username);
  formData.append("email", payload.email);
  if (payload.profile_image) {
    formData.append("profile_image", payload.profile_image);
  }

  const { data } = await api.patch<AuthResponse["user"]>(API_ENDPOINTS.profile, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

export async function updatePharmacyProfile(payload: {
  pharmacy_name: string;
  address: string;
  city: string;
  phone_number: string;
  email: string;
  opening_hours: string;
  delivery_supported: boolean;
  pharmacy_image?: File | null;
}): Promise<AuthResponse["user"]> {
  const formData = new FormData();
  formData.append("pharmacy_name", payload.pharmacy_name);
  formData.append("address", payload.address);
  formData.append("city", payload.city);
  formData.append("phone_number", payload.phone_number);
  formData.append("email", payload.email);
  formData.append("opening_hours", payload.opening_hours);
  formData.append("delivery_supported", payload.delivery_supported ? "true" : "false");
  if (payload.pharmacy_image) {
    formData.append("pharmacy_image", payload.pharmacy_image);
  }

  const { data } = await api.patch<AuthResponse["user"]>(API_ENDPOINTS.profile, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

export async function fetchPharmacySubscription() {
  const { data } = await api.get(`${API_ENDPOINTS.pharmacies}subscription/`);
  return data;
}

export async function fetchSubscriptionPayments() {
  const { data } = await api.get(`${API_ENDPOINTS.pharmacies}payments/`);
  return Array.isArray(data) ? data : [];
}

export async function createSubscriptionPayment(payload: {
  amount_usd: number;
  amount_bif: number;
  currency: string;
  payment_method: string;
  sender_phone: string;
  receiver_phone: string;
  transaction_reference: string;
  payment_month: string;
  proof_image: File;
  payer_name?: string;
  payer_address?: string;
}) {
  const formData = new FormData();
  formData.append("amount_usd", String(payload.amount_usd));
  formData.append("amount_bif", String(payload.amount_bif));
  formData.append("currency", payload.currency);
  formData.append("payment_method", payload.payment_method);
  formData.append("sender_phone", payload.sender_phone);
  formData.append("receiver_phone", payload.receiver_phone);
  formData.append("transaction_reference", payload.transaction_reference);
  formData.append("payment_month", payload.payment_month);
  formData.append("proof_image", payload.proof_image);
  if (payload.payer_name) {
    formData.append("payer_name", payload.payer_name);
  }
  if (payload.payer_address) {
    formData.append("payer_address", payload.payer_address);
  }

  const { data } = await api.post(`${API_ENDPOINTS.pharmacies}payments/`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

export async function updateSubscriptionPaymentStatus(
  paymentId: number,
  payment_status: "pending" | "verified" | "rejected"
) {
  const { data } = await api.patch(`${API_ENDPOINTS.pharmacies}payments/${paymentId}/`, {
    payment_status,
  });
  return data;
}

export async function submitPrescriptionResponse(payload: {
  prescription: number;
  availability_note: string;
  estimated_minutes: number;
  total_price: string;
  status?: string;
}): Promise<PrescriptionResponse> {
  const { data } = await api.post<PrescriptionResponse>(API_ENDPOINTS.prescriptionResponses, {
    ...payload,
    status: payload.status ?? "quoted",
  });
  return data;
}

export async function updatePrescriptionEngagement(
  prescriptionId: number,
  action: "like" | "share"
): Promise<PrescriptionRecord> {
  const { data } = await api.post<PrescriptionRecord>(`${API_ENDPOINTS.prescriptions}${prescriptionId}/engagement/`, {
    action,
  });
  return data;
}

export async function postPrescriptionComment(
  prescriptionId: number,
  body: string
): Promise<PrescriptionRecord> {
  const { data } = await api.post<PrescriptionRecord>(`${API_ENDPOINTS.prescriptions}${prescriptionId}/comments/`, {
    body,
  });
  return data;
}

export async function updatePharmacyEngagement(
  pharmacyId: number,
  action: "like" | "share"
): Promise<Pharmacy> {
  const { data } = await api.post<Pharmacy>(`${API_ENDPOINTS.pharmacies}${pharmacyId}/engagement/`, {
    action,
  });
  return data;
}

export async function postPharmacyComment(
  pharmacyId: number,
  body: string
): Promise<Pharmacy> {
  const { data } = await api.post<Pharmacy>(`${API_ENDPOINTS.pharmacies}${pharmacyId}/comments/`, {
    body,
  });
  return data;
}

export async function banUser(userId: number) {
  const { data } = await api.post(`${API_ENDPOINTS.users}${userId}/ban/`);
  return data;
}

export async function unbanUser(userId: number) {
  const { data } = await api.post(`${API_ENDPOINTS.users}${userId}/unban/`);
  return data;
}

export async function banPharmacy(pharmacyId: number) {
  const { data } = await api.post(`${API_ENDPOINTS.pharmacies}${pharmacyId}/ban/`);
  return data;
}

export async function unbanPharmacy(pharmacyId: number) {
  const { data } = await api.post(`${API_ENDPOINTS.pharmacies}${pharmacyId}/unban/`);
  return data;
}

export async function updatePharmacySubscriptionStatus(
  pharmacyId: number,
  subscription_status: "active" | "trial" | "suspended" | "cancelled" | "expired"
) {
  const { data } = await api.post(`${API_ENDPOINTS.pharmacies}${pharmacyId}/subscription-status/`, {
    subscription_status,
  });
  return data;
}

export async function deleteUserAccount(userId: number) {
  const { data } = await api.delete(`${API_ENDPOINTS.users}${userId}/delete-account/`);
  return data;
}

export async function deletePharmacyAccount(pharmacyId: number) {
  const { data } = await api.delete(`${API_ENDPOINTS.pharmacies}${pharmacyId}/delete-account/`);
  return data;
}

export async function broadcastNotifications(payload: {
  title: string;
  message: string;
  audience: "all" | "patients" | "pharmacies";
}) {
  const { data } = await api.post(`${API_ENDPOINTS.notifications}broadcast/`, payload);
  return data;
}

// Fonctions pour le ChatBot PharmiGo
export async function fetchChatMessages(): Promise<ChatBotMessage[]> {
  try {
    // Utiliser l'endpoint chatbot pour récupérer les messages
    const response = await api.get(API_ENDPOINTS.chatbotMessages);
    return Array.isArray(response.data) ? response.data.map(normalizeChatBotMessage) : [];
  } catch {
    return [];
  }
}

export async function sendChatMessage(payload: ChatBotPayload): Promise<ChatBotResponse> {
  const { data } = await api.post<ChatBotResponse>(API_ENDPOINTS.chatbotMessage, payload);
  return data;
}

export async function askChatbotQuestion(
  question: string,
  language?: "fr" | "en" | "rn" | "sw" | "ln"
): Promise<{ question: string; answer: string }> {
  const data = await sendChatMessage({
    message: question,
    language,
  });
  return {
    question,
    answer: data.answer || data.message || "",
  };
}

function normalizeChatBotMessage(value: unknown): ChatBotMessage {
  if (!isRecord(value)) {
    throw new Error("Invalid chatbot message format");
  }

  return {
    id: typeof value.id === "number" ? value.id : 0,
    sender: value.sender === "user" ? "user" : "bot",
    message: typeof value.message === "string" ? value.message : "",
    created_at: typeof value.created_at === "string" ? value.created_at : new Date().toISOString(),
  };
}
