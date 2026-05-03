import { usePreferences } from "../context/PreferencesContext";
import type { PrescriptionBotResult } from "../types";

interface OcrResultModalProps {
  ocrText: string;
  confidence: number;
  botResult: PrescriptionBotResult;
  onClose: () => void;
  onConfirm: () => void;
}

export default function OcrResultModal({ ocrText, confidence, botResult, onClose, onConfirm }: OcrResultModalProps) {
  const { language } = usePreferences();

  const labels = {
    fr: {
      title: "Résultat de l'analyse OCR",
      ocrLabel: "Texte extrait de l'ordonnance",
      confidenceLabel: "Confiance OCR",
      medicationsLabel: "Médicaments reconnus",
      noMedications: "Aucun médicament reconnu.",
      confirm: "Confirmer et chercher les pharmacies",
      cancel: "Annuler",
      dosage: "Dosage",
      quantity: "Qté",
    },
    en: {
      title: "OCR Analysis Result",
      ocrLabel: "Text extracted from prescription",
      confidenceLabel: "OCR Confidence",
      medicationsLabel: "Recognized medications",
      noMedications: "No medication recognized.",
      confirm: "Confirm and search pharmacies",
      cancel: "Cancel",
      dosage: "Dosage",
      quantity: "Qty",
    },
    rn: {
      title: "Ingaruka z'isesengura OCR",
      ocrLabel: "Texte yasohotse mu ordonnance",
      confidenceLabel: "Ikizigiro OCR",
      medicationsLabel: "Imiti yamenwe",
      noMedications: "Nta muti wamenwe.",
      confirm: "Emeza no gushaka amafarumasi",
      cancel: "Kureka",
      dosage: "Ingano",
      quantity: "Umubare",
    },
    sw: {
      title: "Matokeo ya Uchambuzi wa OCR",
      ocrLabel: "Maandishi yaliyotolewa kutoka preskripsheni",
      confidenceLabel: "Uhakika wa OCR",
      medicationsLabel: "Dawa zilizotambuliwa",
      noMedications: "Hakuna dawa iliyotambuliwa.",
      confirm: "Thibitisha na tafuta maduka ya dawa",
      cancel: "Ghairi",
      dosage: "Kipimo",
      quantity: "Idadi",
    },
    ln: {
      title: "Résultat ya analyse OCR",
      ocrLabel: "Texte oyo ebimaki na ordonnance",
      confidenceLabel: "Confiance OCR",
      medicationsLabel: "Ba kisi oyo bamoni",
      noMedications: "Nta kisi emoni.",
      confirm: "Simbisa mpe luka ba pharmacie",
      cancel: "Suka",
      dosage: "Dosage",
      quantity: "Quantité",
    },
  }[language];

  const medications = botResult.medications ?? [];
  const confidencePct = Math.round(confidence * 100);
  const canShowReadableText = Boolean(ocrText && botResult.raw_text_displayable && botResult.analysis_source === "gemini");

  return (
    <div className="ocr-modal-overlay" onClick={onClose}>
      <div className="ocr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ocr-modal-header">
          <h2>{labels.title}</h2>
          <button className="ocr-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="ocr-modal-body">
          <div className="ocr-section">
            <label className="ocr-section-label">
              {labels.confidenceLabel} — <strong>{confidencePct}%</strong>
            </label>
            <div className="ocr-confidence-bar">
              <div
                className="ocr-confidence-fill"
                style={{
                  width: `${confidencePct}%`,
                  background: confidencePct >= 70 ? "var(--color-success, #22c55e)" : "var(--color-warning, #f59e0b)",
                }}
              />
            </div>
          </div>

          {canShowReadableText ? (
            <div className="ocr-section">
              <label className="ocr-section-label">{labels.ocrLabel}</label>
              <pre className="ocr-text-block">{ocrText || "—"}</pre>
            </div>
          ) : null}

          <div className="ocr-section">
            <label className="ocr-section-label">{labels.medicationsLabel}</label>
            {medications.length === 0 ? (
              <p className="ocr-no-meds">{labels.noMedications}</p>
            ) : (
              <ul className="ocr-medications-list">
                {medications.map((med, i) => (
                  <li key={i} className="ocr-medication-item">
                    <strong>{med.name}</strong>
                    {med.generic_name && med.generic_name !== med.name && (
                      <span className="ocr-generic"> ({med.generic_name})</span>
                    )}
                    {med.dosage && (
                      <span className="ocr-detail"> · {labels.dosage}: {med.dosage}</span>
                    )}
                    {med.quantity && med.quantity > 1 && (
                      <span className="ocr-detail"> · {labels.quantity}: {med.quantity}</span>
                    )}
                    {med.confidence !== undefined && (
                      <span className="ocr-confidence-badge">
                        {Math.round(med.confidence * 100)}%
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="ocr-modal-footer">
          <button className="secondary-button" onClick={onClose}>{labels.cancel}</button>
          <button className="primary-button" onClick={onConfirm} disabled={medications.length === 0}>
            {labels.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
