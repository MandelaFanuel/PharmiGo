export type SupportedLanguage = "fr" | "en" | "rn" | "sw" | "ln";

export function getLocaleForLanguage(language: SupportedLanguage = "fr") {
  switch (language) {
    case "en":
      return "en-US";
    case "sw":
      return "sw-TZ";
    case "ln":
      return "fr-CD";
    case "rn":
      return "fr-BI";
    default:
      return "fr-FR";
  }
}

export function formatExactDateTime(value?: string | Date | null, language: SupportedLanguage = "fr") {
  if (!value) {
    return "";
  }

  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(value);
  }

  return parsedDate.toLocaleString(getLocaleForLanguage(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
