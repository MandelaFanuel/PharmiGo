import { useEffect, useState } from "react";

import { confirmPrescriptionMedications, fetchPrescriptionRecommendations, searchPrescriptionPharmacies, selectPrescriptionPharmacy } from "../services/api";
import { usePreferences } from "../context/PreferencesContext";
import ModalTransition from "./ModalTransition";
import type { MatchedPharmacy, PrescriptionBotResult, PrescriptionRecord } from "../types";

interface PrescriptionAnalysisPopupProps {
  prescriptionId: number;
  result: PrescriptionBotResult;
  ocrText?: string | null;
  confidenceScore?: number;
  onClose: () => void;
  onPharmacySelected?: (pharmacyName: string) => void;
  onAnalysisUpdated?: (record: PrescriptionRecord) => void;
}

export default function PrescriptionAnalysisPopup({
  prescriptionId,
  result,
  ocrText,
  confidenceScore,
  onClose,
  onPharmacySelected,
  onAnalysisUpdated,
}: PrescriptionAnalysisPopupProps) {
  const { language } = usePreferences();
  const [busyPharmacyId, setBusyPharmacyId] = useState<number | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(result.message);
  const [editableMedications, setEditableMedications] = useState(result.medications ?? []);
  const [pharmacies, setPharmacies] = useState<MatchedPharmacy[]>(result.pharmacies ?? []);
  const [showRawText, setShowRawText] = useState(false);
  const [searchStep, setSearchStep] = useState<string | null>(null);
  const canShowReadableText = Boolean(ocrText && result.raw_text_displayable && result.analysis_source === "gemini");
  const dialogLabel = tr("Analyse de l'ordonnance", "Prescription analysis");
  const closeLabel = tr("Fermer", "Close");
  const analysisTitle = tr("Analyse instantanee", "Instant analysis");
  const technicalDetailLabel = tr("Detail technique", "Technical detail");

  function tr(fr: string, en: string, rn?: string, sw?: string, ln?: string) {
    if (language === "en") return en;
    if (language === "rn") return rn ?? fr;
    if (language === "sw") return sw ?? fr;
    if (language === "ln") return ln ?? fr;
    return fr;
  }

  useEffect(() => {
    setMessage(result.message);
    setEditableMedications(result.medications ?? []);
    setPharmacies(result.pharmacies ?? []);
    setSearchStep(null);
  }, [result]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  async function handleSelect(pharmacyId: number, pharmacyName: string) {
    setBusyPharmacyId(pharmacyId);
    setError(null);
    try {
      await selectPrescriptionPharmacy(prescriptionId, pharmacyId);
      onPharmacySelected?.(pharmacyName);
      onClose();
    } catch {
      setError("Impossible d'envoyer votre choix a la pharmacie pour le moment.");
    } finally {
      setBusyPharmacyId(null);
    }
  }

  async function handleConfirmMedications() {
    const normalizedMedications = editableMedications
      .map((medication) => ({
        ...medication,
        name: medication.name?.trim() ?? "",
        dosage: medication.dosage?.trim() ?? "",
        form: medication.form?.trim() ?? medication.unit?.trim() ?? "",
        posology: medication.posology?.trim() ?? "",
        quantity: Number(medication.quantity ?? 1) || 1,
      }))
      .filter((medication) => medication.name);

    const itemsToConfirm = normalizedMedications
      .filter((medication): medication is typeof medication & { id: number } => typeof medication.id === "number")
      .map((medication) => ({
        id: medication.id,
        confirmed: true,
        corrected_name: medication.name?.trim() || undefined,
        dosage: medication.dosage || undefined,
        form: medication.form || undefined,
        quantity: medication.quantity || 1,
        posology: medication.posology || undefined,
      }));

    const addedMedications = normalizedMedications
      .filter((medication) => typeof medication.id !== "number")
      .map((medication) => ({
        name: medication.name,
        dosage: medication.dosage || undefined,
        form: medication.form || undefined,
        quantity: medication.quantity || 1,
        posology: medication.posology || undefined,
      }));

    if (!itemsToConfirm.length && !addedMedications.length) {
      setError(tr("Aucun médicament exploitable n'est disponible pour confirmation.", "No usable medicine is available for confirmation."));
      return;
    }

    setIsConfirming(true);
    setIsSearching(true);
    setError(null);
    setSearchStep(tr("J'ai bien enregistré mes médicaments. Je recherche maintenant les pharmacies disponibles.", "I saved my medicines. I am now searching for available pharmacies."));
    try {
      const confirmedRecord = await confirmPrescriptionMedications(prescriptionId, itemsToConfirm, addedMedications);
      onAnalysisUpdated?.(confirmedRecord);

      const confirmedMedications = confirmedRecord.extracted_medications ?? normalizedMedications;
      setEditableMedications(confirmedMedications);

      const nextPharmacies = confirmedRecord.bot_result?.pharmacies ?? confirmedRecord.bot_result?.pharmacies ?? confirmedRecord.recommendations ?? [];
      if (nextPharmacies.length) {
        setPharmacies(nextPharmacies);
        setMessage(confirmedRecord.bot_result?.message ?? confirmedRecord.message ?? tr("Pharmacies trouvées.", "Pharmacies found."));
      } else {
        const searchResult = await searchPrescriptionPharmacies(prescriptionId);
        const searchPharmacies = searchResult.recommendations ?? searchResult.pharmacies;
        setPharmacies(searchPharmacies);
        setMessage(
          searchResult.message ??
            (searchResult.total_pharmacies > 0
              ? tr(
                  `${searchResult.total_pharmacies} pharmacie(s) ont été trouvée(s) pour mes médicaments.`,
                  `${searchResult.total_pharmacies} pharmacy(ies) were found for my medicines.`
                )
              : tr(
                  "Aucune pharmacie ne possède tous mes médicaments. Voici les disponibilités partielles.",
                  "No pharmacy has all my medicines. Here are the partial availabilities."
                ))
        );

        if (!searchPharmacies.length && searchResult.status === "searching") {
          const recommendationResult = await fetchPrescriptionRecommendations(prescriptionId);
          setPharmacies(recommendationResult.recommendations);
          setMessage(recommendationResult.message);
        }
      }
    } catch {
      setError(tr("Impossible de confirmer puis de rechercher les pharmacies pour le moment.", "Unable to confirm and search pharmacies right now."));
    } finally {
      setIsConfirming(false);
      setIsSearching(false);
    }
  }

  function updateMedication(index: number, field: "name" | "dosage" | "form" | "quantity" | "posology", value: string) {
    setEditableMedications((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: field === "quantity" ? Number(value || "1") || 1 : value,
            }
          : item
      )
    );
  }

  function removeMedication(index: number) {
    setEditableMedications((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function addMedication() {
    setEditableMedications((current) => [
      ...current,
      {
        name: "",
        dosage: "",
        form: "",
        quantity: 1,
        posology: "",
        confidence: 1,
        needs_review: true,
      },
    ]);
  }

  function formatMoney(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return null;
    }
    return `${value.toFixed(2)} BIF`;
  }

  return (
    <ModalTransition overlayClassName="guardian-popup-overlay" panelClassName="guardian-popup-card" ariaLabel={dialogLabel} onBackdropClick={onClose}>
        <div className="guardian-popup-head">
          <div>
            <p className="guardian-popup-kicker">Assistant PharmiGo</p>
            <h3>{analysisTitle}</h3>
          </div>
          <button type="button" className="guardian-popup-close" onClick={onClose}>
            {closeLabel}
          </button>
        </div>

        <p className={`guardian-popup-message ${result.is_valid_prescription ? "success" : "error"}`}>
          {message}
        </p>

        {result.technical_error ? <p className="guardian-popup-inline-error">{technicalDetailLabel} : {result.technical_error}</p> : null}

        {editableMedications.length ? (
          <div className="guardian-popup-block">
            <div className="guardian-block-head">
              <h4>{result.needs_confirmation ? tr("Médicaments à confirmer", "Medicines to confirm") : tr("Médicaments détectés", "Detected medicines")}</h4>
              {result.needs_confirmation ? (
                <button type="button" className="guardian-popup-close guardian-inline-toggle" onClick={addMedication}>
                  {tr("Ajouter médicament", "Add medicine")}
                </button>
              ) : null}
            </div>
            <div className="guardian-medication-list">
              {editableMedications.map((medication, index) => (
                <div key={`${medication.name}-${index}`} className="guardian-medication-pill">
                  {result.needs_confirmation ? (
                    <div className="guardian-medication-grid">
                      <label className="guardian-medication-edit">
                        <span>{tr("Nom du médicament", "Medicine name")}</span>
                        <input value={medication.name} onChange={(event) => updateMedication(index, "name", event.target.value)} />
                      </label>
                      <label className="guardian-medication-edit">
                        <span>{tr("Dosage", "Dosage")}</span>
                        <input value={medication.dosage ?? ""} onChange={(event) => updateMedication(index, "dosage", event.target.value)} />
                      </label>
                      <label className="guardian-medication-edit">
                        <span>{tr("Forme", "Form")}</span>
                        <input value={medication.form ?? medication.unit ?? ""} onChange={(event) => updateMedication(index, "form", event.target.value)} />
                      </label>
                      <label className="guardian-medication-edit">
                        <span>{tr("Quantité", "Quantity")}</span>
                        <input type="number" min={1} value={medication.quantity ?? 1} onChange={(event) => updateMedication(index, "quantity", event.target.value)} />
                      </label>
                      <label className="guardian-medication-edit guardian-medication-edit-wide">
                        <span>{tr("Posologie", "Posology")}</span>
                        <input value={medication.posology ?? ""} onChange={(event) => updateMedication(index, "posology", event.target.value)} />
                      </label>
                      <button type="button" className="guardian-medication-remove" onClick={() => removeMedication(index)}>
                        {tr("Supprimer", "Remove")}
                      </button>
                    </div>
                  ) : (
                    <strong>{medication.name}</strong>
                  )}
                  <span>
                    {[
                      medication.generic_name && medication.generic_name !== medication.name ? medication.generic_name : null,
                      medication.dosage,
                      medication.form,
                      medication.quantity ? `Qté ${medication.quantity}` : null,
                      medication.unit,
                      medication.posology,
                      medication.needs_review ? "A confirmer" : null,
                    ]
                      .filter(Boolean)
                      .join(" • ") || "Ordonnance"}
                  </span>
                </div>
              ))}
            </div>
            {result.needs_confirmation ? (
              <p className="guardian-popup-subtle">
                {tr(
                  "Je peux corriger ici le nom, le dosage, la forme, la quantité ou la posologie avant de lancer automatiquement la recherche des pharmacies.",
                  "I can correct the medicine name, dosage, form, quantity, or posology here before automatically searching pharmacies."
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        {!editableMedications.length && result.needs_confirmation ? (
          <div className="guardian-popup-block">
            <h4>Verification manuelle requise</h4>
            <p className="guardian-popup-subtle">
              {tr(
                "Je n'ai pas pu analyser correctement l'ordonnance. Je peux confirmer les médicaments manuellement.",
                "I could not analyze the prescription correctly. I can confirm the medicines manually."
              )}
            </p>
            <div className="guardian-popup-actions">
              <button type="button" className="guardian-popup-close guardian-inline-toggle" onClick={addMedication}>
                {tr("Ajouter médicament", "Add medicine")}
              </button>
            </div>
          </div>
        ) : null}

        {canShowReadableText ? (
          <div className="guardian-popup-block">
            <div className="guardian-rawtext-head">
              <h4>{tr("Texte détecté par Gemini", "Text detected by Gemini")}</h4>
              <button type="button" className="guardian-popup-close guardian-inline-toggle" onClick={() => setShowRawText((current) => !current)}>
                {showRawText ? tr("Masquer le texte", "Hide text") : tr("Voir le texte détecté", "View detected text")}
              </button>
            </div>
            {typeof confidenceScore === "number" ? (
              <p className="guardian-popup-subtle">{tr("Confiance OCR/Gemini", "OCR/Gemini confidence")}: {(confidenceScore * 100).toFixed(0)}%</p>
            ) : null}
            {showRawText ? <pre className="guardian-ocr-text">{ocrText}</pre> : null}
          </div>
        ) : null}

        {result.needs_confirmation ? (
          <div className="guardian-popup-actions">
            <button
              type="button"
              className="pharmigo-primary-btn guardian-select-button"
              disabled={isConfirming || isSearching || !editableMedications.length}
              onClick={() => void handleConfirmMedications()}
            >
              {isConfirming ? tr("Validation...", "Saving...") : tr("Confirmer mes médicaments", "Confirm my medicines")}
            </button>
          </div>
        ) : null}

        {isSearching ? (
          <div className="guardian-popup-block guardian-popup-loading">
            <h4>{tr("Recherche des pharmacies", "Searching pharmacies")}</h4>
            <div className="guardian-loading-skeleton" />
            <div className="guardian-loading-skeleton short" />
            <p className="guardian-popup-subtle">{searchStep ?? tr("Je compare mes médicaments confirmés avec les stocks des pharmacies en temps réel.", "I am comparing my confirmed medicines with pharmacy stocks in real time.")}</p>
          </div>
        ) : null}

        {result.is_valid_prescription && pharmacies.length ? (
          <div className="guardian-popup-block">
            <h4>{tr("Pharmacies recommandées", "Recommended pharmacies")}</h4>
            <div className="guardian-pharmacy-grid">
              {pharmacies.map((pharmacy) => (
                <article key={pharmacy.pharmacy_id} className="guardian-pharmacy-card">
                  <div className="guardian-pharmacy-meta">
                    <strong>{pharmacy.name}</strong>
                    <span>{pharmacy.address}</span>
                    <span>{pharmacy.phone}</span>
                  </div>
                  <div className="guardian-pharmacy-stats">
                    <span>{tr("Disponibilité", "Availability")}: {pharmacy.availability === "complete" ? tr("Complète", "Complete") : tr("Partielle", "Partial")}</span>
                    <span>{tr("Match", "Match")} {(pharmacy.match_score * 100).toFixed(0)}%</span>
                    <span>
                      {pharmacy.distance != null ? `${pharmacy.distance.toFixed(1)} km` : tr("Distance à confirmer", "Distance pending")}
                    </span>
                    <span>{(pharmacy.estimated_total_price ?? pharmacy.estimated_price).toFixed(2)} BIF</span>
                    <span>{pharmacy.matched_count ?? pharmacy.available_medications.length} / {(pharmacy.matched_count ?? pharmacy.available_medications.length) + (pharmacy.missing_count ?? pharmacy.missing_medications.length)} {tr("médicaments", "medicines")}</span>
                  </div>
                  {pharmacy.matched_items?.length ? (
                    <div className="guardian-pharmacy-items">
                      <strong>{tr("Disponibles", "Available")}</strong>
                      {pharmacy.matched_items.map((item, itemIndex) => (
                        <div key={`${pharmacy.pharmacy_id}-matched-${itemIndex}`} className="guardian-pharmacy-item-detail">
                          <span>
                            <strong>{item.requested_medicine ?? item.medicine}</strong>
                            {item.matched_name && item.matched_name !== (item.requested_medicine ?? item.medicine) ? ` → ${item.matched_name}` : ""}
                          </span>
                          <span>
                            {[
                              item.dosage ? `${tr("Demandé", "Requested")} ${item.dosage}` : null,
                              item.matched_dosage ? `${tr("Stock", "Stock")} ${item.matched_dosage}` : null,
                              item.form ? `${tr("Forme", "Form")} ${item.form}` : null,
                              item.quantity ? `${tr("Qté", "Qty")} ${item.quantity}` : null,
                              item.quantity_available ? `${tr("Disponible", "Available")} ${item.quantity_available}${item.unit ? ` ${item.unit}` : ""}` : null,
                              formatMoney(item.price),
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </span>
                          {item.generic_name ? <span>{tr("Nom générique", "Generic name")}: {item.generic_name}</span> : null}
                          {item.posology ? <span>{tr("Posologie", "Posology")}: {item.posology}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {pharmacy.missing_items?.length ? (
                    <div className="guardian-pharmacy-items missing">
                      <strong>{tr("Manquants", "Missing")}</strong>
                      {pharmacy.missing_items.map((item, itemIndex) => (
                        <div key={`${pharmacy.pharmacy_id}-missing-${itemIndex}`} className="guardian-pharmacy-item-detail">
                          <span><strong>{item.medicine}</strong>{item.dosage ? ` • ${item.dosage}` : ""}</span>
                          <span>
                            {[
                              item.form ? `${tr("Forme", "Form")} ${item.form}` : null,
                              item.quantity ? `${tr("Qté", "Qty")} ${item.quantity}` : null,
                              item.posology ? `${tr("Posologie", "Posology")} ${item.posology}` : null,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="pharmigo-primary-btn guardian-select-button"
                    disabled={busyPharmacyId === pharmacy.pharmacy_id}
                    onClick={() => handleSelect(pharmacy.pharmacy_id, pharmacy.name)}
                  >
                    {busyPharmacyId === pharmacy.pharmacy_id ? tr("Transmission...", "Sending...") : tr("Choisir cette pharmacie", "Choose this pharmacy")}
                  </button>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="guardian-popup-inline-error">{error}</p> : null}
    </ModalTransition>
  );
}
