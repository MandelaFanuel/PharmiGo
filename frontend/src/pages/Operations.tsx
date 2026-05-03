import { useEffect, useState } from "react";

import { usePreferences } from "../context/PreferencesContext";
import { fetchDashboard, fetchEndpointCatalog } from "../services/api";
import type { DashboardData, EndpointItem } from "../types";

export default function Operations() {
  const { t } = usePreferences();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [catalog, setCatalog] = useState<EndpointItem[]>([]);

  useEffect(() => {
    async function loadData() {
      const [dashboardData, endpointData] = await Promise.all([
        fetchDashboard(),
        fetchEndpointCatalog(),
      ]);
      setDashboard(dashboardData);
      setCatalog(endpointData);
    }

    void loadData();
  }, []);

  if (!dashboard) {
    return <p className="empty-state">{t("common.loading")}</p>;
  }

  return (
    <section className="stack">
      <div className="section-heading">
        <h2>{t("operations.title")}</h2>
        <p>{t("operations.subtitle")}</p>
      </div>

      <div className="two-column-grid">
        <article className="info-card">
          <h3>{t("section.prescriptions")}</h3>
          <div className="stack compact-stack">
            {dashboard.prescriptions.map((prescription) => (
              <div key={prescription.id} className="list-item">
                <strong>{prescription.medication_name}</strong>
                <span>{prescription.patient_name}</span>
                <span>{prescription.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="info-card">
          <h3>{t("section.responses")}</h3>
          <div className="stack compact-stack">
            {dashboard.responses.map((response) => (
              <div key={response.id} className="list-item">
                <strong>{response.pharmacy_name ?? response.pharmacy__name}</strong>
                <span>{response.availability_note}</span>
                <span>
                  {t("common.price")}: {response.total_price} | {t("common.eta")}: {response.estimated_minutes} min
                </span>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="two-column-grid">
        <article className="info-card">
          <h3>{t("operations.workflow")}</h3>
          <div className="journey-grid">
            {dashboard.journeys.patient.map((step) => (
              <span key={`patient-${step}`} className="workflow-pill">
                Patient: {step}
              </span>
            ))}
            {dashboard.journeys.pharmacy.map((step) => (
              <span key={`pharmacy-${step}`} className="workflow-pill alt">
                Pharmacie: {step}
              </span>
            ))}
          </div>
        </article>

        <article className="info-card">
          <h3>{t("section.endpoints")}</h3>
          <div className="stack compact-stack">
            {catalog.map((endpoint) => (
              <div key={endpoint.path} className="endpoint-row">
                <span className="badge">{endpoint.method}</span>
                <code>{endpoint.path}</code>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
