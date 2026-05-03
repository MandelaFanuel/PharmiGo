import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { usePreferences } from "../context/PreferencesContext";
import { fetchPharmacy } from "../services/api";
import type { Pharmacy } from "../types";

export default function PharmacyDetail() {
  const { t } = usePreferences();
  const { id = "" } = useParams();
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);

  useEffect(() => {
    async function loadPharmacy() {
      if (!id) {
        return;
      }
      const data = await fetchPharmacy(id);
      setPharmacy(data);
    }

    void loadPharmacy();
  }, [id]);

  if (!pharmacy) {
    return <p className="empty-state">{t("common.loading")}</p>;
  }

  return (
    <section className="stack">
      <div className="section-heading">
        <h2>{t("pharmacy.detail")}</h2>
        <p>{pharmacy.city}</p>
      </div>
      <article className="info-card">
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
  );
}
