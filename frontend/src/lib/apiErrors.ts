import axios from "axios";

export type FormFieldErrors = Record<string, string>;

export type ParsedApiError = {
  message: string;
  fieldErrors: FormFieldErrors;
};

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlFallbackMessage(rawHtml: string, fallback: string) {
  const flattened = stripHtml(rawHtml);

  if (flattened.includes("Page not found at /api/auth/login/")) {
    return "Le service de connexion est indisponible pour le moment. Verifiez que le backend PharmiGo a bien ete redemarre avec les routes d'authentification actives.";
  }
  if (flattened.includes("Page not found at /api/auth/register/")) {
    return "Le service d'inscription est indisponible pour le moment. Verifiez que le backend PharmiGo a bien ete redemarre avec les routes d'authentification actives.";
  }
  if (flattened.includes("Page not found")) {
    return "Le service demande est introuvable sur le serveur. Verifiez la configuration ou redemarrez le backend.";
  }

  return fallback;
}

export function parseApiError(error: unknown, fallback: string): ParsedApiError {
  if (!axios.isAxiosError(error)) {
    return { message: fallback, fieldErrors: {} };
  }

  if (!error.response) {
    return {
      message: "Connexion au serveur impossible. Verifiez que le backend PharmiGo est demarre puis reessayez.",
      fieldErrors: {},
    };
  }

  const { data, status } = error.response;

  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.startsWith("<!DOCTYPE html>") || trimmed.startsWith("<html")) {
      return { message: htmlFallbackMessage(trimmed, fallback), fieldErrors: {} };
    }
    return { message: trimmed || fallback, fieldErrors: {} };
  }

  if (data && typeof data === "object") {
    const fieldErrors: FormFieldErrors = {};

    for (const [key, value] of Object.entries(data)) {
      if (key === "detail" && typeof value === "string") {
        continue;
      }
      if (Array.isArray(value) && typeof value[0] === "string") {
        fieldErrors[key] = value[0];
      } else if (typeof value === "string") {
        fieldErrors[key] = value;
      }
    }

    const message =
      (typeof (data as { detail?: unknown }).detail === "string" && (data as { detail?: string }).detail) ||
      Object.values(fieldErrors)[0] ||
      (status >= 500
        ? "Une erreur interne est survenue. Veuillez reessayer dans quelques instants."
        : fallback);

    return { message, fieldErrors };
  }

  return { message: fallback, fieldErrors: {} };
}
