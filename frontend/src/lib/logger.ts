export function logClientError(message: string) {
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_CLIENT_LOGS === "true") {
    console.error(`[PharmiGo] ${message}`);
  }
}
