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

export function getApiOrigin() {
  const explicitBase = import.meta.env.VITE_API_BASE_URL;
  if (explicitBase) {
    try {
      return new URL(explicitBase, window.location.origin).origin;
    } catch {
      return typeof window !== "undefined" ? window.location.origin : null;
    }
  }
  return typeof window !== "undefined" ? window.location.origin : null;
}

export function getChatWebSocketUrl(roomName: string) {
  const explicitBase = import.meta.env.VITE_WS_BASE_URL;
  if (explicitBase) {
    return `${explicitBase.replace(/\/$/, "")}/ws/chat/${roomName}/`;
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
