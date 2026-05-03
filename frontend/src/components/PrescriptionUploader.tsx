import { FormEvent, useRef, useState } from "react";
import axios from "axios";

import { parseApiError } from "../lib/apiErrors";
import { clearStoredAuthSession } from "../lib/auth";
import { usePreferences } from "../context/PreferencesContext";
import { submitPrescription } from "../services/api";
import type { AuthUser, Pharmacy, PrescriptionUploadReceipt } from "../types";

interface PrescriptionUploaderProps {
  pharmacies: Pharmacy[];
  currentUser?: AuthUser | null;
  onSuccess: (result: PrescriptionUploadReceipt) => void;
  onError?: (message: string | null) => void;
}

export default function PrescriptionUploader({ pharmacies, currentUser, onSuccess, onError }: PrescriptionUploaderProps) {
  void pharmacies;
  const { t, language } = usePreferences();
  const [file, setFile] = useState<File | null>(null);
  const [analysisText, setAnalysisText] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const labels = {
    fr: {
      title: "Publiez votre ordonnance en quelques secondes",
      body: "Ajoutez une photo nette ou un fichier PDF de votre ordonnance. Une fois publiee, elle devient visible par les pharmacies inscrites qui pourront vous repondre directement.",
      camera: "Prendre une photo",
      gallery: "Choisir dans la galerie",
      selected: "Fichier choisi",
      helper: "Formats acceptes : image ou PDF. Assurez-vous que le document soit bien lisible avant publication.",
      missingAccount: "Connectez-vous d'abord comme patient pour publier votre ordonnance.",
      missingFile: "Ajoutez d'abord une photo, un fichier ou un texte d'ordonnance.",
      noFile: "Aucun fichier",
      submitBusy: "Envoi...",
      submitIdle: "Publier sur la plateforme",
      textLabel: "Ou collez le texte de l'ordonnance",
      textPlaceholder: "Ex: Amoxicilline 500mg, Paracetamol 1g...",
      bestPractices: "Bonnes pratiques",
      bestPractice1: "Verifiez que le texte de l'ordonnance est net et complet.",
      bestPractice2: "Evitez les images sombres ou coupees.",
      bestPractice3: "Publiez uniquement une ordonnance medicale lisible.",
    },
    en: {
      title: "Add your prescription in one step",
      body: "Take a photo or choose the file from your phone, then publish it to the platform.",
      camera: "Take a photo",
      gallery: "Choose from gallery",
      selected: "Selected file",
      helper: "Image or PDF format. Connected pharmacies will see it right away.",
      missingAccount: "Sign in as a patient first to publish your prescription.",
      missingFile: "Please add a prescription photo, file, or text first.",
      noFile: "No file selected",
      submitBusy: "Sending...",
      submitIdle: "Publish to platform",
      textLabel: "Or paste the prescription text",
      textPlaceholder: "Ex: Amoxicilline 500mg, Paracetamol 1g...",
      bestPractices: "Best practices",
      bestPractice1: "Make sure the prescription text is clear and complete.",
      bestPractice2: "Avoid dark, blurry, or cropped images.",
      bestPractice3: "Publish only a readable medical prescription.",
    },
    rn: {
      title: "Shiramwo ordonnance yawe mu ntambwe imwe",
      body: "Fata ifoto canke uhitemwo fichier iri kuri telefone yawe, uce uyishira kuri plateforme.",
      camera: "Fata ifoto",
      gallery: "Hitamwo muri galerie",
      selected: "Fichier wahisemwo",
      helper: "Image canke PDF. Amafarumasi ahujwe azoca ayibona.",
      missingAccount: "Banza winjire nk'umurwayi kugira ushobore gushira ordonnance.",
      missingFile: "Banza wongereko ifoto, fichier canke texte y'ordonnance.",
      noFile: "Nta fichier yahisemwo",
      submitBusy: "Birarungikwa...",
      submitIdle: "Shira kuri plateforme",
      textLabel: "Canke ushiremwo texte y'ordonnance",
      textPlaceholder: "Ex: Amoxicilline 500mg, Paracetamol 1g...",
      bestPractices: "Ibikenewe gukurikizwa",
      bestPractice1: "Raba neza ko texte y'ordonnance isomeka kandi yuzuye.",
      bestPractice2: "Irinde amafoto yijimye canke acagaguye.",
      bestPractice3: "Shira gusa ordonnance ivurwa neza kandi isomeka.",
    },
    sw: {
      title: "Ongeza preskripsheni yako kwa hatua moja",
      body: "Piga picha au chagua faili kutoka kwenye simu yako, kisha uichapishe kwenye jukwaa.",
      camera: "Piga picha",
      gallery: "Chagua kwenye galerii",
      selected: "Faili iliyochaguliwa",
      helper: "Muundo wa picha au PDF. Maduka ya dawa yaliyounganishwa yataiona mara moja.",
      missingAccount: "Ingia kwanza kama mgonjwa ili utume preskripsheni.",
      missingFile: "Ongeza kwanza picha, faili, au maandishi ya preskripsheni.",
      noFile: "Hakuna faili iliyochaguliwa",
      submitBusy: "Inatuma...",
      submitIdle: "Tuma kwenye jukwaa",
      textLabel: "Au bandika maandishi ya preskripsheni",
      textPlaceholder: "Mf: Amoxicilline 500mg, Paracetamol 1g...",
      bestPractices: "Mwongozo mfupi",
      bestPractice1: "Hakikisha maandishi ya preskripsheni yako wazi na yamekamilika.",
      bestPractice2: "Epuka picha zenye giza au zilizokatika.",
      bestPractice3: "Tuma tu preskripsheni ya kitabibu inayosomeka.",
    },
    ln: {
      title: "Bakisa ordonnance na yo na etape moko",
      body: "Zwa foto to pona fichier na telefone na yo, sima tinda yango na plateforme.",
      camera: "Zwa foto",
      gallery: "Pona na galerie",
      selected: "Fichier oyo oponi",
      helper: "Format image to PDF. Ba pharmacie connectees bakomona yango mbala moko.",
      missingAccount: "Banda okota lokola patient mpo na kotinda ordonnance.",
      missingFile: "Bakisa naino foto, fichier to texte ya ordonnance.",
      noFile: "Fichier moko te eponami",
      submitBusy: "Ezali kotindama...",
      submitIdle: "Tinda na plateforme",
      textLabel: "To bakisa texte ya ordonnance",
      textPlaceholder: "Ex: Amoxicilline 500mg, Paracetamol 1g...",
      bestPractices: "Mibeko ya malamu",
      bestPractice1: "Tala ete texte ya ordonnance emonani malamu mpe ezali mobimba.",
      bestPractice2: "Kima ba image ya molili to oyo bakati.",
      bestPractice3: "Tinda kaka ordonnance ya monganga oyo ekoki kotangama.",
    },
  }[language];

  function buildPrescriptionTitle(fileName?: string) {
    if (!fileName) {
      return analysisText.trim() ? "Ordonnance medicale (texte)" : "Ordonnance medicale";
    }
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    const formatLabel = extension === "pdf" ? "PDF" : "image";
    return `Ordonnance medicale (${formatLabel})`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser || currentUser.profile?.role !== "patient") {
      setFileError(null);
      onError?.(labels.missingAccount);
      return;
    }
    if (!file && !analysisText.trim()) {
      setFileError(labels.missingFile);
      onError?.(labels.missingFile);
      return;
    }
    setBusy(true);
    setFileError(null);
    onError?.(null);
    window.dispatchEvent(new CustomEvent("prescription-upload:start"));

    try {
      const prescriptionTitle = buildPrescriptionTitle(file?.name);
      const result = await submitPrescription({
        patient_name: currentUser.username,
        patient_email: currentUser.email || `${currentUser.username}@pharmigo.local`,
        medication_name: prescriptionTitle,
        dosage: "Document medical joint",
        instructions: `Ordonnance publiee par ${currentUser.username}. Les pharmacies peuvent verifier le document et repondre directement depuis la plateforme.`,
        prescription_file: file,
        analysis_text: analysisText.trim(),
      });
      onSuccess(result);
      setFile(null);
      setAnalysisText("");
      if (cameraInputRef.current) {
        cameraInputRef.current.value = "";
      }
      if (galleryInputRef.current) {
        galleryInputRef.current.value = "";
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        clearStoredAuthSession();
        setFileError(null);
        onError?.(null);
        window.dispatchEvent(new CustomEvent("pharmigo-auth-expired"));
        return;
      }

      const parsedError = parseApiError(
        error,
        "L'envoi a echoue. Verifiez le document puis reessayez. Si le probleme persiste, relancez le service backend."
      );
      setFileError(parsedError.fieldErrors.prescription_file ?? null);
      onError?.(parsedError.message);
    } finally {
      window.dispatchEvent(new CustomEvent("prescription-upload:end"));
      setBusy(false);
    }
  }

  return (
    <form className="stack form-card" onSubmit={handleSubmit}>
      <div className="uploader-intro">
        <strong>{labels.title}</strong>
        <p>{labels.body}</p>
      </div>
      <div className="upload-guidance-card">
        <span>{labels.bestPractices}</span>
        <ul>
          <li>{labels.bestPractice1}</li>
          <li>{labels.bestPractice2}</li>
          <li>{labels.bestPractice3}</li>
        </ul>
      </div>
      <div className="upload-choice-row">
        <button type="button" className="secondary-button upload-choice-button" onClick={() => cameraInputRef.current?.click()}>
          {labels.camera}
        </button>
        <button type="button" className="secondary-button upload-choice-button" onClick={() => galleryInputRef.current?.click()}>
          {labels.gallery}
        </button>
      </div>
      <input
        ref={cameraInputRef}
        className="sr-only-file-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <input
        ref={galleryInputRef}
        className="sr-only-file-input"
        type="file"
        accept="image/*,.pdf"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <div className="upload-selected-file">
        <span>{labels.selected}</span>
        <strong>{file?.name ?? labels.noFile}</strong>
      </div>
      <label className="auth-field">
        <span>{labels.textLabel}</span>
        <textarea
          rows={4}
          value={analysisText}
          placeholder={labels.textPlaceholder}
          onChange={(event) => setAnalysisText(event.target.value)}
        />
      </label>
      {fileError ? <p className="field-error-summary field-error">{fileError}</p> : null}
      <p className="auth-helper-text">{labels.helper}</p>
      <button className="primary-button" disabled={busy} type="submit">
        {busy ? labels.submitBusy : labels.submitIdle || t("common.submit")}
      </button>
    </form>
  );
}
