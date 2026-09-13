/* =============================================================================
   image-slot.js — placeholder media box for .dc.html mockups.

   `<image-slot>` stands in for a real image while a mockup is being reviewed:
   it draws a neutral, theme-aware panel with the placeholder label, so a card
   reads as "a photo goes here" without shipping binary assets next to the
   mockup or hot-linking anything.

   Attributes:
     placeholder  text to show (usually the asset title)
     shape        "rect" (default) | "rounded" | "circle"
     radius       px radius, only meaningful with shape="rounded"

   It deliberately paints from the same CSS custom properties the mockups use
   (--bg-inset / --text-3 / --border), so it flips with the page theme instead
   of being a light-grey hole in a dark design.
   ============================================================================= */
(function () {
  "use strict";

  if (window.customElements && customElements.get("image-slot")) return;

  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ["placeholder", "shape", "radius"];
    }

    connectedCallback() {
      this.render();
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    render() {
      const shape = this.getAttribute("shape") || "rect";
      const radius = this.getAttribute("radius");
      const label = this.getAttribute("placeholder") || "";

      let borderRadius = "0";
      if (shape === "circle") borderRadius = "50%";
      else if (shape === "rounded") borderRadius = (radius || 10) + "px";

      Object.assign(this.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxSizing: "border-box",
        borderRadius: borderRadius,
        background:
          "var(--bg-inset, var(--color-bg-inset, #f1efe9))",
        border: "1px solid var(--border, var(--color-border, rgba(128,128,128,.2)))",
        color: "var(--text-3, var(--color-text-tertiary, #808080))",
      });

      this.textContent = "";

      // A faint diagonal hatch reads as "placeholder", not as "an image that
      // failed to load" — the distinction matters when reviewing empty states.
      const hatch = document.createElement("div");
      Object.assign(hatch.style, {
        position: "absolute",
        inset: "0",
        opacity: "0.35",
        backgroundImage:
          "repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 9px)",
        pointerEvents: "none",
      });

      const wrap = document.createElement("div");
      Object.assign(wrap.style, {
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px",
        boxSizing: "border-box",
      });

      const text = document.createElement("span");
      Object.assign(text.style, {
        position: "relative",
        fontSize: "10.5px",
        lineHeight: "1.35",
        fontWeight: "500",
        textAlign: "center",
        maxHeight: "100%",
        overflow: "hidden",
        opacity: "0.85",
      });
      text.textContent = label;

      wrap.appendChild(hatch);
      wrap.appendChild(text);
      this.appendChild(wrap);
    }
  }

  customElements.define("image-slot", ImageSlot);
})();
