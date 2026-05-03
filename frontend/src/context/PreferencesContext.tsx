import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { languageOptions, type Language, themeOptions, type ThemeMode, translations } from "../lib/i18n";

interface PreferencesContextValue {
  language: Language;
  setLanguage: (value: Language) => void;
  theme: ThemeMode;
  setTheme: (value: ThemeMode) => void;
  t: (key: string) => string;
  languageOptions: typeof languageOptions;
  themeOptions: typeof themeOptions;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

function initialLanguage(): Language {
  const saved = localStorage.getItem("pharmigo.language");
  return saved === "en" || saved === "rn" || saved === "sw" || saved === "ln" ? saved : "fr";
}

function initialTheme(): ThemeMode {
  const saved = localStorage.getItem("pharmigo.theme");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "light";
}

function resolveTheme(theme: ThemeMode) {
  if (theme !== "system") {
    return theme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    localStorage.setItem("pharmigo.language", language);
  }, [language]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(theme);
    localStorage.setItem("pharmigo.theme", theme);

    if (theme !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      document.documentElement.dataset.theme = resolveTheme("system");
    };
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, [theme]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      theme,
      setTheme,
      t: (key: string) => translations[language][key] ?? translations.fr[key] ?? key,
      languageOptions,
      themeOptions,
    }),
    [language, theme]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return context;
}
