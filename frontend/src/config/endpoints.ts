export const API_ENDPOINTS = {
  authRegister: "/auth/register/",
  authLogin: "/auth/login/",
  authGoogle: "/auth/google/",
  authLogout: "/auth/logout/",
  authVerifyEmail: "/auth/verify-email/",
  authResendVerificationEmail: "/auth/resend-verification-email/",
  authPasswordReset: "/auth/password-reset/",
  authPasswordResetConfirm: "/auth/password-reset/confirm/",
  authRegisterFallback: "/register/",
  authLoginFallback: "/login/",
  authGoogleFallback: "/google/",
  authVerifyEmailFallback: "/verify-email/",
  authResendVerificationEmailFallback: "/resend-verification-email/",
  authPasswordResetFallback: "/password-reset/",
  authPasswordResetConfirmFallback: "/password-reset/confirm/",
  profile: "/profile/",
  health: "/health/",
  appConfig: "/app-config/",
  dashboard: "/dashboard/",
  adminDashboard: "/admin/dashboard/",
  endpoints: "/endpoints/",
  users: "/users/",
  pharmacies: "/pharmacies/",
  prescriptions: "/prescriptions/",
  uploadPrescription: "/upload-prescription/",
  confirmPrescription: "/confirm-prescription/",
  prescriptionAnalysis: "/prescription-analysis/",
  prescriptionResponses: "/prescription-responses/",
  messages: "/messages/",
  notifications: "/notifications/",
  presenceHeartbeat: "/presence/heartbeat/",
  presenceOffline: "/presence/offline/",
  chatbotWelcome: "/pharmigo/chatbot/welcome/",
  chatbotMessage: "/pharmigo/chatbot/message/",
  chatbotMessages: "/pharmigo/chatbot/messages/",
} as const;

const PRODUCTION_API_BASE_URL = "https://pharmigo-backend.onrender.com/api";
const PRODUCTION_API_ORIGIN = "https://pharmigo-backend.onrender.com";
const PRODUCTION_FRONTEND_HOSTS = new Set(["pharmigo.vercel.app", "pharmigo.jo3.org"]);

function isProductionFrontendHost() {
  return typeof window !== "undefined" && PRODUCTION_FRONTEND_HOSTS.has(window.location.hostname);
}

export function getApiBaseUrl() {
  const explicitBase = import.meta.env.VITE_API_BASE_URL;
  if (explicitBase) {
    return explicitBase;
  }

  if (isProductionFrontendHost()) {
    return PRODUCTION_API_BASE_URL;
  }

  return "/api";
}

export function getApiOrigin() {
  const explicitOrigin = import.meta.env.VITE_API_ORIGIN;
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const apiBaseUrl = getApiBaseUrl();
  if (apiBaseUrl) {
    try {
      return new URL(apiBaseUrl, window.location.origin).origin;
    } catch {
      return typeof window !== "undefined" ? window.location.origin : null;
    }
  }

  if (isProductionFrontendHost()) {
    return PRODUCTION_API_ORIGIN;
  }

  return typeof window !== "undefined" ? window.location.origin : null;
}

export function getChatWebSocketUrl(roomName: string) {
  const explicitBase = import.meta.env.VITE_WS_BASE_URL;
  if (explicitBase) {
    const normalizedBase = explicitBase.replace(/\/$/, "");
    if (/^wss?:\/\//.test(normalizedBase)) {
      if (/\/ws$/i.test(normalizedBase)) {
        return `${normalizedBase}/chat/${roomName}/`;
      }
      return `${normalizedBase}/ws/chat/${roomName}/`;
    }
    if (normalizedBase === "/ws" || normalizedBase === "ws") {
      return `/ws/chat/${roomName}/`;
    }
    return `${normalizedBase}/ws/chat/${roomName}/`;
  }

  if (isProductionFrontendHost()) {
    return `wss://pharmigo-backend.onrender.com/ws/chat/${roomName}/`;
  }

  const apiOrigin = getApiOrigin();
  if (apiOrigin) {
    const protocol = apiOrigin.startsWith("https://") ? "wss" : "ws";
    return `${apiOrigin.replace(/^https?/, protocol)}/ws/chat/${roomName}/`;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.host || "localhost:3001";
  return `${protocol}://${host}/ws/chat/${roomName}/`;
}
