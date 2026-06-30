import React from 'react';
import StudioCard from './StudioCard';

/* ─────────────────────────────────────────────────────────────────────────────
   StudioResultGrid — result grid (shimmer placeholders + cards)
   Renders only when there are generations or a generation is in progress.
   ───────────────────────────────────────────────────────────────────────────── */
export default function StudioResultGrid({
  activeGenerations,
  isGenerating,
  shimmerCount,
  aspectRatioCss,
  selectedGenerationId,
  onOpenCard,
  onUseForPost,
}) {
  const topPickId = activeGenerations.find((g) => g.status === 'completed')?.id;

  return (
    <div
      className="studio-grid"
      style={{ '--card-ratio': aspectRatioCss }}
    >
      {/* Shimmer placeholders when gen starts but DB rows don't exist yet */}
      {isGenerating && activeGenerations.length === 0
        ? Array.from({ length: shimmerCount }).map((_, i) => (
            <div key={`ph-${i}`} className="studio-card studio-card--shimmer" aria-hidden="true" />
          ))
        : null}

      {activeGenerations.map((gen) => (
        <StudioCard
          key={gen.id}
          generation={gen}
          selected={gen.id === selectedGenerationId}
          isTopPick={gen.id === topPickId}
          onOpen={() => onOpenCard(gen)}
          onUseForPost={() => onUseForPost(gen)}
        />
      ))}

      {/* empty — suggestions are shown above the grid when canvas is empty */}
    </div>
  );
}
