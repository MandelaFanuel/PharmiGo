export type PhoneCountryCode = "cd" | "tz" | "bi";

export type PhoneCountry = {
  code: PhoneCountryCode;
  name: string;
  flag: string;
  dialCode: string;
  placeholder: string;
  regex: RegExp;
};

export const phoneCountries: PhoneCountry[] = [
  { code: "cd", name: "RDC", flag: "🇨🇩", dialCode: "+243", placeholder: "812345678", regex: /^\+243\d{9}$/ },
  { code: "tz", name: "Tanzanie", flag: "🇹🇿", dialCode: "+255", placeholder: "712345678", regex: /^\+255\d{9}$/ },
  { code: "bi", name: "Burundi", flag: "🇧🇮", dialCode: "+257", placeholder: "61234567", regex: /^\+257\d{8}$/ },
];

export const UNSUPPORTED_PHONE_MESSAGE = "Ce numero n'est pas admis, veuillez contacter l'admin sur +25769096758";

export function buildPhoneNumber(countryCode: PhoneCountryCode, localNumber: string) {
  const country = phoneCountries.find((item) => item.code === countryCode) ?? phoneCountries[0];
  const digits = localNumber.replace(/\D/g, "");
  return `${country.dialCode}${digits}`;
}

export function validateInternationalPhoneNumber(value: string) {
  const normalized = String(value ?? "").replace(/[^\d+]/g, "").trim();
  if (!normalized) {
    return "Le numero de telephone est obligatoire.";
  }

  const isSupported = phoneCountries.some((country) => country.regex.test(normalized));
  return isSupported ? null : UNSUPPORTED_PHONE_MESSAGE;
}

export function splitPhoneNumber(value: string | undefined | null): { countryCode: PhoneCountryCode; localNumber: string } {
  const normalized = String(value ?? "").trim();
  if (normalized.startsWith("+243")) {
    return { countryCode: "cd", localNumber: normalized.slice(4) };
  }
  if (normalized.startsWith("+255")) {
    return { countryCode: "tz", localNumber: normalized.slice(4) };
  }
  if (normalized.startsWith("+257")) {
    return { countryCode: "bi", localNumber: normalized.slice(4) };
  }
  return { countryCode: "bi", localNumber: normalized.replace(/\D/g, "") };
}
