import styles from "./Button.module.css";

const VARIANT_CLASS = {
  solid: styles.solid,
  subtle: styles.subtle,
  ghost: styles.ghost,
  danger: styles.danger,
  dangerSolid: styles.dangerSolid,
};

const SIZE_CLASS = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
};

/**
 * Base v2 button. `variant` covers every button style seen across the 4
 * mockups: solid (primary CTA), subtle (secondary action on dark/light
 * surface), ghost (tertiary/cancel), danger (outlined destructive), and
 * dangerSolid (confirmed destructive action, e.g. "Delete session").
 */
export function Button({
  variant = "solid",
  size = "md",
  disabled = false,
  className = "",
  children,
  ...rest
}) {
  const classes = [styles.btn, SIZE_CLASS[size] || styles.sizeMd, VARIANT_CLASS[variant] || styles.solid, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}
