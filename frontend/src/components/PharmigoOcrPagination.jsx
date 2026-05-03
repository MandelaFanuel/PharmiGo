import { useMemo, useState } from "react";

const ITEMS_PER_PAGE = 4;

export default function PharmigoOcrPagination({
  medications = [],
  title = "Médicaments extraits",
  emptyMessage = "Aucun médicament extrait pour le moment.",
}) {
  const [currentPage, setCurrentPage] = useState(1);

  const safeMedications = Array.isArray(medications) ? medications : [];

  const totalPages = Math.max(
    1,
    Math.ceil(safeMedications.length / ITEMS_PER_PAGE)
  );

  const visibleMedications = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return safeMedications.slice(start, end);
  }, [safeMedications, currentPage]);

  const goToPage = (page) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  if (safeMedications.length === 0) {
    return (
      <section className="prescription-ocr-section">
        <div className="prescription-ocr-head">
          <h3>{title}</h3>
        </div>

        <div className="empty-state">
          {emptyMessage}
        </div>
      </section>
    );
  }

  return (
    <section className="prescription-ocr-section">
      <div className="prescription-ocr-head">
        <div>
          <h3>{title}</h3>
          <p>
            {safeMedications.length} résultat
            {safeMedications.length > 1 ? "s" : ""} détecté
            {safeMedications.length > 1 ? "s" : ""}
          </p>
        </div>

        <span className="badge info">
          4 par page
        </span>
      </div>

      <div className="prescription-ocr-medication-list">
        {visibleMedications.map((medication, index) => {
          const globalIndex = (currentPage - 1) * ITEMS_PER_PAGE + index + 1;

          const name =
            medication?.name ||
            medication?.medicament ||
            medication?.medicine ||
            medication?.nom ||
            `Médicament ${globalIndex}`;

          const dosage =
            medication?.dosage ||
            medication?.dose ||
            medication?.posologie ||
            medication?.instructions ||
            "Dosage non précisé";

          const quantity =
            medication?.quantity ||
            medication?.quantite ||
            medication?.qty ||
            "";

          const frequency =
            medication?.frequency ||
            medication?.frequence ||
            medication?.prise ||
            "";

          return (
            <article
              className="prescription-ocr-medication-card"
              key={`${name}-${globalIndex}`}
            >
              <div className="prescription-ocr-medication-index">
                {globalIndex}
              </div>

              <div className="prescription-ocr-medication-content">
                <strong>{name}</strong>

                <p>{dosage}</p>

                {(quantity || frequency) && (
                  <div className="prescription-ocr-medication-meta">
                    {quantity && <span>Quantité : {quantity}</span>}
                    {frequency && <span>Fréquence : {frequency}</span>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {totalPages > 1 && (
        <nav className="pharmigo-pagination" aria-label="Pagination OCR">
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            Précédent
          </button>

          <div className="pharmigo-pagination-pages">
            {Array.from({ length: totalPages }).map((_, index) => {
              const page = index + 1;

              return (
                <button
                  type="button"
                  key={page}
                  onClick={() => goToPage(page)}
                  className={currentPage === page ? "active" : ""}
                  aria-current={currentPage === page ? "page" : undefined}
                >
                  {page}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            Suivant
          </button>
        </nav>
      )}
    </section>
  );
}