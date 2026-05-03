import type { ReactNode } from "react";

import { formatExactDateTime } from "../lib/datetime";
import type { PrescriptionRecord } from "../types";

function formatReference(prescription: PrescriptionRecord) {
  return prescription.public_reference || `ORD-${String(prescription.id).padStart(6, "0")}`;
}

function getSelectedPharmacyName(prescription: PrescriptionRecord) {
  if (prescription.pharmacy_name) {
    return prescription.pharmacy_name;
  }

  const latestResponse = Array.isArray(prescription.responses) && prescription.responses.length
    ? [...prescription.responses].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0]
    : null;

  return latestResponse?.pharmacy_name || "";
}

export default function PublicPrescriptionSheet({
  prescription,
  title,
  footer,
  className,
}: {
  prescription: PrescriptionRecord;
  title?: string;
  footer?: ReactNode;
  className?: string;
}) {
  const medications = prescription.extracted_medications ?? [];
  const selectedPharmacyName = getSelectedPharmacyName(prescription);

  return (
    <article className={className ? `public-prescription-sheet ${className}` : "public-prescription-sheet"}>
      <header className="public-prescription-sheet-header">
        <div>
          <span className="public-prescription-sheet-kicker">Fiche ordonnance numerique</span>
          <strong>{title || prescription.medication_name || "Ordonnance confirmee"}</strong>
        </div>
        <span className="public-reference-badge">{formatReference(prescription)}</span>
      </header>

      <div className="public-prescription-sheet-meta">
        <span>Pseudonyme: {prescription.patient_name || "Patient"}</span>
        <span>Zone: {prescription.geo_zone || "Zone non renseignee"}</span>
        <span>Date: {formatExactDateTime(prescription.created_at, "fr")}</span>
        <span>Pharmacie choisie: {selectedPharmacyName || "En attente de selection"}</span>
      </div>

      <div className="public-prescription-sheet-body">
        <span className="public-prescription-sheet-label">Medicaments confirmes</span>
        {medications.length ? (
          <ul className="public-prescription-sheet-list">
            {medications.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong>
                <small>
                  {[item.dosage, item.form, item.posology].filter(Boolean).join(" • ") || "Details confirmes"}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="public-prescription-sheet-empty">La liste confirmee n'est pas encore disponible.</p>
        )}
      </div>

      {footer ? <div className="public-prescription-sheet-footer">{footer}</div> : null}
    </article>
  );
}
