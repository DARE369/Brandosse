import React from "react";

/**
 * Pagination props:
 * - page, pageSize, total, onPageChange
 */
export default function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="pagination">
      <button onClick={() => onPageChange(page - 1)} disabled={!canPrev}>Prev</button>
      <span>Page {page} / {totalPages}</span>
      <button onClick={() => onPageChange(page + 1)} disabled={!canNext}>Next</button>
    </div>
  );
}
