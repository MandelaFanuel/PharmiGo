import { useState } from "react";
import { Link } from "react-router-dom";

import ModalTransition from "./ModalTransition";
import { usePreferences } from "../context/PreferencesContext";
import { resolvePharmacyProfileImageUrl } from "../lib/media";
import type { Pharmacy } from "../types";

interface PharmacyListProps {
  pharmacies: Pharmacy[];
}

export default function PharmacyList({ pharmacies }: PharmacyListProps) {
  const { t } = usePreferences();
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);

  if (pharmacies.length === 0) {
    return <p className="empty-state">{t("common.empty")}</p>;
  }

  return (
    <>
      <div className="card-grid">
        {pharmacies.map((pharmacy) => {
          const imageUrl = resolvePharmacyProfileImageUrl(pharmacy);

          return (
            <article key={pharmacy.id} className="info-card pharmacy-list-card">
              {imageUrl ? (
                <button
                  type="button"
                  className="pharmacy-list-image-button"
                  onClick={() => setPreviewImage({ src: imageUrl, alt: pharmacy.name })}
                  aria-label={`Agrandir l'image de ${pharmacy.name}`}
                >
                  <img src={imageUrl} alt={pharmacy.name} className="pharmacy-list-image" loading="lazy" />
                </button>
              ) : null}

              <div className="card-row">
                <h3>{pharmacy.name}</h3>
                <span className={pharmacy.delivery_supported ? "badge success" : "badge"}>
                  {pharmacy.delivery_supported ? t("common.delivery") : t("common.pickup")}
                </span>
              </div>
              <p>{pharmacy.city}</p>
              <p>{pharmacy.address}</p>
              <p>{pharmacy.phone_number}</p>
              <p>{pharmacy.opening_hours}</p>
              <Link className="text-link" to={`/pharmacy/${pharmacy.id}`}>
                {t("common.viewDetails")}
              </Link>
            </article>
          );
        })}
      </div>

      {previewImage ? (
        <ModalTransition
          overlayClassName="prescription-lightbox"
          panelClassName="prescription-lightbox-dialog"
          ariaLabel={previewImage.alt}
          onBackdropClick={() => setPreviewImage(null)}
        >
          <button type="button" className="prescription-lightbox-close" onClick={() => setPreviewImage(null)}>
            Fermer
          </button>
          <img src={previewImage.src} alt={previewImage.alt} />
        </ModalTransition>
      ) : null}
    </>
  );
}
