// ======================================================
// PHARMIGO OCR PAGINATION (4 éléments par page)
// ======================================================

export const ITEMS_PER_PAGE = 4;

/**
 * Découpe une liste en pages
 */
export function paginate(items, currentPage = 1, itemsPerPage = ITEMS_PER_PAGE) {
  if (!Array.isArray(items)) return [];

  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;

  return items.slice(start, end);
}

/**
 * Calcule le nombre total de pages
 */
export function getTotalPages(items, itemsPerPage = ITEMS_PER_PAGE) {
  if (!Array.isArray(items) || items.length === 0) return 1;

  return Math.ceil(items.length / itemsPerPage);
}