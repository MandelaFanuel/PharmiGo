import type { AuthUser } from "../types";

const CURRENT_USER_KEY = "pharmigo.currentUser";
const AUTH_TOKEN_KEY = "pharmigo.authToken";
const SESSION_KEY_PREFIXES = ["pharmigo.lastReadMessageAt.", "pharmigo.savedContacts."];
let runtimeAuthToken: string | null = null;

export type AuthRole = "admin" | "pharmacy" | "patient";

export function getStoredCurrentUser(): AuthUser | null {
  if (!getStoredAuthToken()) {
    clearStoredAuthSession();
    return null;
  }

  const savedUser = localStorage.getItem(CURRENT_USER_KEY);
  if (!savedUser) {
    return null;
  }

  try {
    return JSON.parse(savedUser) as AuthUser;
  } catch {
    clearStoredAuthSession();
    return null;
  }
}

export function getStoredAuthToken(): string | null {
  if (runtimeAuthToken && runtimeAuthToken.trim()) {
    return runtimeAuthToken;
  }

  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token && token.trim()) {
    runtimeAuthToken = token;
    return token;
  }

  return null;
}

export function getUserRole(user: AuthUser | null | undefined): AuthRole | null {
  if (!user) {
    return null;
  }

  if (user.is_staff || user.profile?.role === "admin") {
    return "admin";
  }

  if (user.profile?.role === "pharmacy") {
    return "pharmacy";
  }

  if (user.profile?.role === "patient") {
    return "patient";
  }

  return null;
}

export function getDashboardPathForUser(user: AuthUser | null | undefined) {
  const role = getUserRole(user) ?? "patient";
  return `/?modal=dashboard&role=${role}`;
}

export function isEmailVerified(user: AuthUser | null | undefined) {
  if (!user) {
    return false;
  }
  if (user.is_staff || user.profile?.role === "admin") {
    return true;
  }
  return Boolean(user.profile?.email_verified);
}

export function clearStoredAuthSession() {
  runtimeAuthToken = null;
  localStorage.removeItem(CURRENT_USER_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY);

  Object.keys(localStorage).forEach((key) => {
    if (SESSION_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      localStorage.removeItem(key);
    }
  });
}

export function persistStoredCurrentUser(user: AuthUser | null) {
  if (!user) {
    clearStoredAuthSession();
    return;
  }

  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}

export function persistStoredAuthToken(token: string | null) {
  if (!token) {
    runtimeAuthToken = null;
    localStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }

  runtimeAuthToken = token;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function persistStoredAuthSession(user: AuthUser | null, token: string | null) {
  if (!user || !token) {
    clearStoredAuthSession();
    return;
  }

  persistStoredAuthToken(token);
  persistStoredCurrentUser(user);
}
