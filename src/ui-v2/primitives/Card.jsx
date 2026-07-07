import styles from "./Card.module.css";

const PAD_CLASS = { none: styles.padNone, sm: styles.padSm, md: styles.padMd, lg: styles.padLg };

/** Generic surface container — the `#17181B`/`#FFFFFF` bordered box used everywhere in the mockups. */
export function Card({ padding = "md", className = "", children, ...rest }) {
  const classes = [styles.card, PAD_CLASS[padding] || styles.padMd, className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
