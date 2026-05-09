export type BrowserCoordinates = {
  latitude: number;
  longitude: number;
};

export function supportsGeolocation() {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && "geolocation" in navigator;
}

export async function getGeolocationPermissionState(): Promise<PermissionState | null> {
  if (typeof navigator === "undefined" || !("permissions" in navigator) || typeof navigator.permissions?.query !== "function") {
    return null;
  }

  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state;
  } catch {
    return null;
  }
}

export function requestBrowserCoordinates(options?: PositionOptions): Promise<BrowserCoordinates> {
  return new Promise((resolve, reject) => {
    if (!supportsGeolocation()) {
      reject(new Error("unsupported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15 * 60 * 1000,
        ...options,
      }
    );
  });
}

export function describeGeolocationError(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = Number((error as { code?: unknown }).code);
    if (code === 1) {
      return "La localisation a ete refusee. Vous pouvez l'autoriser depuis les reglages du navigateur puis reessayer.";
    }
    if (code === 2) {
      return "La position n'est pas disponible pour le moment. Verifiez le GPS ou le reseau puis reessayez.";
    }
    if (code === 3) {
      return "La demande de localisation a pris trop de temps. Reessayez dans quelques instants.";
    }
  }

  if (error instanceof Error && error.message === "unsupported") {
    return "La geolocalisation n'est pas disponible sur cet appareil ou ce navigateur.";
  }

  return "Impossible de recuperer votre position pour le moment.";
}
