import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import ModalTransition from "../components/ModalTransition";
import { usePreferences } from "../context/PreferencesContext";
import { resolvePharmacyProfileImageUrl } from "../lib/media";
import { fetchPharmacy } from "../services/api";
import type { Pharmacy } from "../types";

export default function PharmacyDetail() {
  const { t } = usePreferences();
  const { id = "" } = useParams();
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    async function loadPharmacy() {
      if (!id) {
        return;
      }
      try {
        const data = await fetchPharmacy(id);
        setPharmacy(data);
      } catch {
        setPharmacy(null);
      }
    }

    void loadPharmacy();
  }, [id]);

  if (!pharmacy) {
    return <p className="empty-state">{t("common.loading")}</p>;
  }

  const imageUrl = resolvePharmacyProfileImageUrl(pharmacy);

  return (
    <>
      <section className="stack">
        <div className="section-heading">
          <h2>{t("pharmacy.detail")}</h2>
          <p>{pharmacy.city}</p>
        </div>
        <article className="info-card pharmacy-detail-card">
          {imageUrl ? (
            <button
              type="button"
              className="pharmacy-list-image-button pharmacy-detail-image-button"
              onClick={() => setPreviewOpen(true)}
              aria-label={`Agrandir l'image de ${pharmacy.name}`}
            >
              <img src={imageUrl} alt={pharmacy.name} className="pharmacy-detail-image" loading="lazy" />
            </button>
          ) : null}
          <h3>{pharmacy.name}</h3>
          <p><strong>Adresse:</strong> {pharmacy.address}</p>
          <p><strong>Telephone:</strong> {pharmacy.phone_number}</p>
          <p><strong>Email:</strong> {pharmacy.email || "N/A"}</p>
          <p><strong>Horaires:</strong> {pharmacy.opening_hours}</p>
          <p><strong>Service:</strong> {pharmacy.delivery_supported ? t("common.delivery") : t("common.pickup")}</p>
        </article>
        <Link className="secondary-button" to="/upload-prescription">
          {t("hero.ctaSecondary")}
        </Link>
      </section>

      {previewOpen && imageUrl ? (
        <ModalTransition
          overlayClassName="prescription-lightbox"
          panelClassName="prescription-lightbox-dialog"
          ariaLabel={pharmacy.name}
          onBackdropClick={() => setPreviewOpen(false)}
        >
          <button type="button" className="prescription-lightbox-close" onClick={() => setPreviewOpen(false)}>
            Fermer
          </button>
          <img src={imageUrl} alt={pharmacy.name} />
        </ModalTransition>
      ) : null}
    </>
  );
}
