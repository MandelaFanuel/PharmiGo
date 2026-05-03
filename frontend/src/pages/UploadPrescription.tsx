import { useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";

import NotificationToast from "../components/NotificationToast";
import PrescriptionUploader from "../components/PrescriptionUploader";
import { usePreferences } from "../context/PreferencesContext";
import { clearStoredAuthSession } from "../lib/auth";
import { fetchPharmacies, fetchProfile } from "../services/api";
import type { AuthUser, Pharmacy } from "../types";

type PrescriptionUploaderProps = ComponentProps<typeof PrescriptionUploader>;
type UploadSuccess = Parameters<NonNullable<PrescriptionUploaderProps["onSuccess"]>>[0];

function getStringValue(source: unknown, keys: string[]): string {
  if (!source || typeof source !== "object") return "";

  const record = source as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number") {
      return String(value);
    }
  }

  return "";
}

function formatPrescription(record: UploadSuccess) {
  const rawText =
    getStringValue(record, [
      "ocr_text",
      "ocrText",
      "extracted_text",
      "extractedText",
      "raw_text",
      "rawText",
      "text",
      "content",
      "medication_name",
      "medicationName",
      "name",
    ]) || "";

  const clean = rawText.replace(/\s+/g, " ").trim();

  const center =
    clean.match(/CENTRE\s+MEDICAL\s+.*?(?=\s+T[ée]l|\s+ORDONNANCE|\s+Nom\s+et\s+pr[ée]nom|$)/i)?.[0]?.trim() ||
    "CENTRE MEDICAL";

  const phone =
    clean.match(/T[ée]l\s*:?\s*\+?\d[\d\s/.-]+/i)?.[0]?.trim() || "";

  const patient =
    clean.match(/Nom\s+et\s+pr[ée]nom\s+.*?(?=\s+[A-Z][a-zA-Z]+\s+\d|\s+Difowax|\s+ORDONNANCE|$)/i)?.[0]?.trim() ||
    "";

  const medication =
    clean.match(/Difowax/i)?.[0]?.trim() ||
    getStringValue(record, ["medication_name", "medicationName", "name"]);

  const dosage =
    clean.match(/Difowax\s+.*?(?=$)/i)?.[0]?.replace(/^Difowax\s*/i, "").trim() ||
    clean.match(/\d+\s*H\s*\d+\s*gues?.*?(Jr|Jour)?/i)?.[0]?.trim() ||
    "";

  return {
    center,
    phone,
    title: "ORDONNANCE MEDICALE",
    patient,
    medication,
    dosage,
  };
}

export default function UploadPrescription() {
  const { t } = usePreferences();
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [success, setSuccess] = useState<UploadSuccess | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    async function loadPage() {
      const [pharmacyData, userData] = await Promise.all([
        fetchPharmacies(),
        fetchProfile().catch(() => null),
      ]);

      setPharmacies(pharmacyData);
      setCurrentUser(userData);
    }

    void loadPage();
  }, []);

  useEffect(() => {
    function handleAuthExpired() {
      clearStoredAuthSession();
      setCurrentUser(null);
    }

    window.addEventListener("pharmigo-auth-expired", handleAuthExpired);
    return () => {
      window.removeEventListener("pharmigo-auth-expired", handleAuthExpired);
    };
  }, []);

  const formatted = useMemo(() => {
    return success ? formatPrescription(success) : null;
  }, [success]);

  const medicationName = success
    ? getStringValue(success, ["medication_name", "medicationName", "name"]) || "ordonnance"
    : "";

  const status = success
    ? getStringValue(success, ["status", "state"]) || "envoyée"
    : "";

  return (
    <section className="stack">
      <div className="section-heading">
        <h2>{t("upload.title")}</h2>
        <p>{t("upload.subtitle")}</p>
      </div>

      {success ? (
        <>
          <NotificationToast
            message={`${t("upload.success")} ${medicationName}. ${t("common.status")}: ${status}.`}
          />

          {formatted ? (
            <div className="prescription-card">
              <h3 className="rx-center">{formatted.center}</h3>

              {formatted.phone ? (
                <p className="rx-phone">{formatted.phone}</p>
              ) : null}

              <h4 className="rx-title">{formatted.title}</h4>

              {formatted.patient ? (
                <p className="rx-patient">{formatted.patient}</p>
              ) : null}

              {formatted.medication ? (
                <div className="rx-medication">
                  <strong>Médicament :</strong>
                  <span>{formatted.medication}</span>
                </div>
              ) : null}

              {formatted.dosage ? (
                <div className="rx-dosage">
                  <strong>Posologie :</strong>
                  <span>{formatted.dosage}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <PrescriptionUploader
        pharmacies={pharmacies}
        currentUser={currentUser}
        onSuccess={setSuccess}
      />
    </section>
  );
}
