import { getApiOrigin } from "../config/endpoints";
import type { Pharmacy } from "../types";

export function resolveMediaUrl(path?: string | null) {
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

export function resolvePharmacyProfileImageUrl(pharmacy?: Pick<Pharmacy, "id" | "profile_image"> | null) {
  if (!pharmacy?.profile_image) {
    return null;
  }

  if (pharmacy.profile_image.includes("/api/pharmacies/")) {
    return resolveMediaUrl(pharmacy.profile_image);
  }

  const explicitOrigin = import.meta.env.VITE_API_ORIGIN || getApiOrigin();
  const proxyPath = `/api/pharmacies/${pharmacy.id}/profile-image/`;
  if (explicitOrigin) {
    return `${explicitOrigin.replace(/\/$/, "")}${proxyPath}`;
  }

  return proxyPath;
}
