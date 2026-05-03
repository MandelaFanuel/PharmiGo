import { Link } from "react-router-dom";

import { usePreferences } from "../context/PreferencesContext";
import type { Pharmacy } from "../types";

interface PharmacyListProps {
  pharmacies: Pharmacy[];
}

export default function PharmacyList({ pharmacies }: PharmacyListProps) {
  const { t } = usePreferences();

  if (pharmacies.length === 0) {
    return <p className="empty-state">{t("common.empty")}</p>;
  }

  return (
    <div className="card-grid">
      {pharmacies.map((pharmacy) => (
        <article key={pharmacy.id} className="info-card">
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
      ))}
    </div>
  );
}
