import React from "react";
import { ArrowRight, Star } from "lucide-react";
export default function CreditPackageCard({ creditPackage, purchasing, onPurchase }) {
  return (
    <article className={`ve-package-card ${creditPackage.popular ? "popular" : ""}`}>
      {creditPackage.popular ? (
        <span className="ve-popular-badge">
          <Star size={13} aria-hidden="true" />
          Most popular
        </span>
      ) : null}

      <div>
        <h3>{creditPackage.name}</h3>
        <strong>{creditPackage.price_display}</strong>
        <span>{creditPackage.credits} credits</span>
      </div>

      <p>{creditPackage.description}</p>

      <button className="ve-primary-btn" type="button" onClick={() => onPurchase(creditPackage)} disabled={Boolean(purchasing)}>
        <span>{purchasing === creditPackage.id ? "Redirecting..." : "Purchase"}</span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </article>
  );
}
