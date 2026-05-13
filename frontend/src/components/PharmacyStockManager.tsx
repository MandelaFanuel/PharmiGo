import { useEffect, useState } from "react";

import { logClientError } from "../lib/logger";
import { createPharmacyStockItem, deletePharmacyStockItem, fetchPharmacyStock, fetchProfile, patchPharmacyStockItem, updatePharmacyStockItem } from "../services/api";

interface MedicationStock {
  id: number;
  pharmacy_name: string;
  medication_name: string;
  generic_name: string | null;
  dosage: string | null;
  quantity: number;
  sale_scope: "retail" | "wholesale";
  unit: string;
  price: number;
  currency: "BIF" | "FC" | "TSH";
  last_updated: string;
  is_available: boolean;
}

const RETAIL_UNITS = ["comprimé", "gélule", "flacon", "ampoule", "tube", "boîte", "sachet"] as const;
const WHOLESALE_UNITS = ["carton", "caisse", "lot", "palette", "boîte"] as const;
const UNIT_ALIASES: Record<string, string> = {
  "comprimés": "comprimé",
  "gelules": "gélule",
  "gélules": "gélule",
  "flacons": "flacon",
  "ampoules": "ampoule",
  "tubes": "tube",
  "boites": "boîte",
  "boîtes": "boîte",
  "sachets": "sachet",
  "cartons": "carton",
  "caisses": "caisse",
  "lots": "lot",
  "palettes": "palette",
};

const PHONE_CURRENCY_MAP: Record<string, "BIF" | "FC" | "TSH"> = {
  "+257": "BIF",
  "+243": "FC",
  "+255": "TSH",
};

function inferCurrencyFromPhoneNumber(phoneNumber?: string | null): "BIF" | "FC" | "TSH" {
  const normalized = String(phoneNumber ?? "").trim();
  for (const [prefix, currency] of Object.entries(PHONE_CURRENCY_MAP)) {
    if (normalized.startsWith(prefix)) {
      return currency;
    }
  }
  return "BIF";
}

function getSaleScopeLabel(scope: "retail" | "wholesale") {
  return scope === "wholesale" ? "Gros" : "Détail";
}

function getUnitsForSaleScope(scope: "retail" | "wholesale") {
  return scope === "wholesale" ? WHOLESALE_UNITS : RETAIL_UNITS;
}

function normalizeUnitValue(unit?: string | null) {
  const normalized = String(unit ?? "").trim().toLowerCase();
  return UNIT_ALIASES[normalized] ?? normalized;
}

function normalizeStockItem(item: unknown): MedicationStock {
  const record = (item ?? {}) as Record<string, unknown>;
  const parseNumeric = (value: unknown, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
  };

  return {
    id: typeof record.id === "number" ? record.id : 0,
    pharmacy_name: typeof record.pharmacy_name === "string" ? record.pharmacy_name : "",
    medication_name: typeof record.medication_name === "string" ? record.medication_name : "",
    generic_name: typeof record.generic_name === "string" || record.generic_name === null ? record.generic_name : null,
    dosage: typeof record.dosage === "string" || record.dosage === null ? record.dosage : null,
    quantity: parseNumeric(record.quantity, 0),
    sale_scope: record.sale_scope === "wholesale" ? "wholesale" : "retail",
    unit: typeof record.unit === "string" ? normalizeUnitValue(record.unit) : "",
    price: parseNumeric(record.price, 0),
    currency: record.currency === "FC" || record.currency === "TSH" || record.currency === "BIF" ? record.currency : "BIF",
    last_updated: typeof record.last_updated === "string" ? record.last_updated : "",
    is_available: typeof record.is_available === "boolean" ? record.is_available : Boolean(record.is_available),
  };
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function MinusGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function PencilGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m4 20 4.1-.9L18.7 8.5a1.6 1.6 0 0 0 0-2.26l-.94-.94a1.6 1.6 0 0 0-2.26 0L4.9 15.9 4 20Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m13.9 6.9 3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 7.5h15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M9.5 3.75h5l.7 1.75H19a.75.75 0 0 1 .75.75v.5H4.25v-.5A.75.75 0 0 1 5 5.5h3.8l.7-1.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M7.5 7.5 8.4 19h7.2l.9-11.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 11v5.5M14 11v5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

interface MedicationForm {
  medication_name: string;
  generic_name: string;
  dosage: string;
  quantity: number;
  sale_scope: "retail" | "wholesale";
  unit: string;
  price: number;
  currency: "BIF" | "FC" | "TSH";
  is_available: boolean;
}

export default function PharmacyStockManager({
  embedded = false,
  onStockUpdated,
}: {
  embedded?: boolean;
  onStockUpdated?: () => void;
}) {
  const [stock, setStock] = useState<MedicationStock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyStockId, setBusyStockId] = useState<number | null>(null);
  const [detectedCurrency, setDetectedCurrency] = useState<"BIF" | "FC" | "TSH">("BIF");
  const [salesCapabilities, setSalesCapabilities] = useState<{ wholesale: boolean; retail: boolean }>({
    wholesale: false,
    retail: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<MedicationStock | null>(null);
  const [formData, setFormData] = useState<MedicationForm>({
    medication_name: "",
    generic_name: "",
    dosage: "",
    quantity: 1,
    sale_scope: "retail",
    unit: "comprimé",
    price: 0,
    currency: "BIF",
    is_available: true,
  });

  const availableSaleScopes = salesCapabilities.wholesale && salesCapabilities.retail
    ? (["retail", "wholesale"] as const)
    : salesCapabilities.wholesale
      ? (["wholesale"] as const)
      : (["retail"] as const);
  const availableUnits = getUnitsForSaleScope(formData.sale_scope);

  useEffect(() => {
    void loadStock();
    void loadCurrencyContext();
  }, []);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timer = window.setTimeout(() => setSuccess(null), 5000);
    return () => window.clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const handleAddRequest = () => {
      resetForm();
      setEditingItem(null);
      setShowForm(true);
    };

    const handleEditRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: number; item?: Partial<MedicationStock> }>).detail;
      if (!detail) {
        return;
      }

      const existing = typeof detail.id === "number" ? stock.find((entry) => entry.id === detail.id) : null;
      const source = existing ?? (detail.item ? normalizeStockItem(detail.item) : null);
      if (!source) {
        return;
      }

      handleEdit(source);
    };

    window.addEventListener("pharmacy-stock:add", handleAddRequest);
    window.addEventListener("pharmacy-stock:edit", handleEditRequest as EventListener);

    return () => {
      window.removeEventListener("pharmacy-stock:add", handleAddRequest);
      window.removeEventListener("pharmacy-stock:edit", handleEditRequest as EventListener);
    };
  }, [stock]);

  async function loadStock(notifyParent = false) {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchPharmacyStock();
      setStock((data as unknown[]).map((item) => normalizeStockItem(item)));
      if (notifyParent) {
        onStockUpdated?.();
      }
    } catch (err) {
      setError("Erreur lors du chargement du stock");
      void err;
      logClientError("Le chargement du stock a echoue.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadCurrencyContext() {
    try {
      const profile = await fetchProfile();
      const phoneNumber =
        profile.profile?.pharmacy_phone_number ||
        profile.profile?.phone_number ||
        "";
      const inferredCurrency = inferCurrencyFromPhoneNumber(phoneNumber);
      const wholesale = Boolean(profile.profile?.pharmacy_wholesale_supported);
      const retail = profile.profile?.pharmacy_retail_supported !== false;
      const allowedScopes = wholesale && retail ? ["retail", "wholesale"] : wholesale ? ["wholesale"] : ["retail"];
      const inferredScope: "retail" | "wholesale" = wholesale && !retail ? "wholesale" : "retail";
      setDetectedCurrency(inferredCurrency);
      setSalesCapabilities({ wholesale, retail });
      setFormData((current) => {
        const nextScope = allowedScopes.includes(current.sale_scope) ? current.sale_scope : inferredScope;
        return {
          ...current,
          currency: inferredCurrency,
          sale_scope: nextScope,
          unit: getUnitsForSaleScope(nextScope)[0],
        };
      });
    } catch (err) {
      void err;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (editingItem) {
        await updatePharmacyStockItem(editingItem.id, formData);
        setSuccess("Le medicament a ete mis a jour avec succes.");
      } else {
        await createPharmacyStockItem(formData);
        setSuccess("Le medicament a ete ajoute avec succes.");
      }

      await loadStock(true);
      setShowForm(false);
      setEditingItem(null);
      resetForm();
    } catch (err) {
      const payload = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
      const currencyError = Array.isArray(payload?.currency) ? String(payload?.currency[0]) : typeof payload?.currency === "string" ? payload.currency : null;
      const unitError = Array.isArray(payload?.unit) ? String(payload?.unit[0]) : typeof payload?.unit === "string" ? payload.unit : null;
      const saleScopeError = Array.isArray(payload?.sale_scope) ? String(payload?.sale_scope[0]) : typeof payload?.sale_scope === "string" ? payload.sale_scope : null;
      setError(currencyError || unitError || saleScopeError || "Erreur lors de l'enregistrement");
      void err;
      logClientError("L'enregistrement du stock a echoue.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer ce médicament ?")) {
      return;
    }

    setIsLoading(true);
    try {
      await deletePharmacyStockItem(id);
      setSuccess("Le medicament a ete supprime avec succes.");
      await loadStock(true);
    } catch (err) {
      setError("Erreur lors de la suppression");
      void err;
      logClientError("La suppression du stock a echoue.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleEdit(item: MedicationStock) {
    setEditingItem(item);
    setFormData({
      medication_name: item.medication_name,
      generic_name: item.generic_name || "",
      dosage: item.dosage || "",
      quantity: item.quantity,
      sale_scope: item.sale_scope,
      unit: item.unit,
      price: item.price,
      currency: item.currency,
      is_available: item.is_available,
    });
    setShowForm(true);
  }

  function resetForm() {
    setFormData({
      medication_name: "",
      generic_name: "",
      dosage: "",
      quantity: 1,
      sale_scope: salesCapabilities.wholesale && !salesCapabilities.retail ? "wholesale" : "retail",
      unit: salesCapabilities.wholesale && !salesCapabilities.retail ? "carton" : "comprimé",
      price: 0,
      currency: detectedCurrency,
      is_available: true,
    });
  }

  async function handleQuantityChange(item: MedicationStock, delta: number) {
    const nextQuantity = Math.max(0, item.quantity + delta);
    if (nextQuantity === item.quantity) {
      return;
    }

    setBusyStockId(item.id);
    setError(null);

    try {
      await patchPharmacyStockItem(item.id, {
        quantity: nextQuantity,
        is_available: nextQuantity > 0,
      });
      setStock((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                quantity: nextQuantity,
                is_available: nextQuantity > 0,
              }
            : entry
        )
      );
      setSuccess(delta > 0 ? "Quantite augmentee avec succes." : "Quantite diminuee avec succes.");
      await loadStock(true);
    } catch (err) {
      setError("Erreur lors de la mise a jour de la quantite");
      void err;
      logClientError("La mise a jour de la quantite a echoue.");
    } finally {
      setBusyStockId(null);
    }
  }

  return (
    <div className={embedded ? "pharmacy-stock-manager embedded" : "pharmacy-stock-manager"}>
      <div className="stock-header">
        <h2>Gestion du Stock</h2>
        <button
          className="primary-button"
          onClick={() => {
            resetForm();
            setEditingItem(null);
            setShowForm((current) => !current);
          }}
        >
          {showForm ? "Fermer" : "Ajouter un médicament"}
        </button>
      </div>

      {error ? <div className="error-message">{error}</div> : null}
      {success ? <div className="success-message">{success}</div> : null}

      {showForm ? (
        <div className="stock-form-card">
          <h3>{editingItem ? "Modifier" : "Ajouter"} un médicament</h3>
          <form onSubmit={handleSubmit} className="form-card">
            <div className="form-row">
              <label>
                <span>Nom du médicament *</span>
                <input type="text" value={formData.medication_name} onChange={(e) => setFormData({ ...formData, medication_name: e.target.value })} required />
              </label>
              <label>
                <span>Nom générique</span>
                <input type="text" value={formData.generic_name} onChange={(e) => setFormData({ ...formData, generic_name: e.target.value })} />
              </label>
            </div>

            <div className="form-row">
              <label>
                <span>Dosage</span>
                <input type="text" value={formData.dosage} onChange={(e) => setFormData({ ...formData, dosage: e.target.value })} placeholder="ex: 500mg" />
              </label>
              <label>
                <span>Quantité *</span>
                <input type="number" min="0" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value, 10) || 0 })} required />
              </label>
            </div>

            <div className="form-row">
              <label>
                <span>Type de vente</span>
                <select
                  value={formData.sale_scope}
                  onChange={(e) => {
                    const nextScope = e.target.value as "retail" | "wholesale";
                    setFormData({ ...formData, sale_scope: nextScope, unit: getUnitsForSaleScope(nextScope)[0] });
                  }}
                  disabled={availableSaleScopes.length === 1}
                >
                  {availableSaleScopes.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope === "wholesale" ? "Vente en gros" : "Vente au détail"}
                    </option>
                  ))}
                </select>
                <small>
                  {availableSaleScopes.length === 1
                    ? `Cette pharmacie vend uniquement en ${formData.sale_scope === "wholesale" ? "gros" : "detail"}.`
                    : "Choisissez si ce prix est en gros ou au détail."}
                </small>
              </label>
            </div>

            <div className="form-row">
              <label>
                <span>Catégorie / unité</span>
                <select value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })}>
                  {availableUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit.charAt(0).toUpperCase() + unit.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Prix par {formData.unit} ({formData.currency}) *</span>
                <div className="stock-price-row">
                  <select
                    value={formData.currency}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value as "BIF" | "FC" | "TSH" })}
                  >
                    <option value="BIF">BIF</option>
                    <option value="FC">FC</option>
                    <option value="TSH">TSH</option>
                  </select>
                  <input type="number" min="0" step="0.01" value={formData.price} onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} required />
                </div>
                <small>La devise doit correspondre au pays du numéro de telephone de la pharmacie.</small>
              </label>
            </div>

            <label className="checkbox-label">
              <input type="checkbox" checked={formData.is_available} onChange={(e) => setFormData({ ...formData, is_available: e.target.checked })} />
              <span>Disponible</span>
            </label>

            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setShowForm(false)}>
                Annuler
              </button>
              <button type="submit" className="primary-button" disabled={isLoading}>
                {isLoading ? "Enregistrement..." : editingItem ? "Modifier" : "Ajouter"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isLoading && !showForm ? (
        <div className="loading-state">Chargement...</div>
      ) : (
        <div className="stock-list">
          {stock.length === 0 ? (
            <div className="empty-state">Aucun médicament dans le stock</div>
          ) : (
            <div className="stock-card-list">
              {stock.map((item) => (
                <article key={item.id} className="stock-row-card">
                  <div className="stock-row-main">
                    <div className="stock-row-title">
                      <strong>{item.medication_name}</strong>
                      {item.generic_name ? <small>({item.generic_name})</small> : null}
                    </div>
                    <span className="stock-row-dosage">{item.dosage || "-"}</span>
                    <div className="stock-row-actions">
                      <button className="icon-button compact" onClick={() => handleEdit(item)} title="Modifier" aria-label={`Modifier ${item.medication_name}`} disabled={busyStockId === item.id}>
                        <PencilGlyph />
                      </button>
                      <button className="icon-button compact delete" onClick={() => void handleDelete(item.id)} title="Supprimer" aria-label={`Supprimer ${item.medication_name}`} disabled={busyStockId === item.id}>
                        <TrashGlyph />
                      </button>
                    </div>
                    <div className="stock-quantity-controls">
                      <button
                        type="button"
                        className="icon-button compact"
                        onClick={() => void handleQuantityChange(item, -1)}
                        disabled={isLoading || busyStockId === item.id || item.quantity <= 0}
                        aria-label={`Reduire la quantite de ${item.medication_name}`}
                      >
                        <MinusGlyph />
                      </button>
                      <strong>{item.quantity}</strong>
                      <button
                        type="button"
                        className="icon-button compact"
                        onClick={() => void handleQuantityChange(item, 1)}
                        disabled={isLoading || busyStockId === item.id}
                        aria-label={`Augmenter la quantite de ${item.medication_name}`}
                      >
                        <PlusGlyph />
                      </button>
                    </div>
                    <span className="stock-row-unit">{item.unit}</span>
                    <span className="badge info">{getSaleScopeLabel(item.sale_scope)}</span>
                    <span className="stock-row-price">{item.price.toFixed(2)} {item.currency}</span>
                    <span className={`badge ${item.is_available ? "success" : "warning"}`}>{item.is_available ? "Disponible" : "Indisponible"}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
