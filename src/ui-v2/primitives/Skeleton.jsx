import styles from "./Skeleton.module.css";

/** Shimmering placeholder block used for every loading state across the mockups. */
export function Skeleton({ width = "100%", height = "16px", radius, style = {}, className = "" }) {
  const classes = [styles.skeleton, className].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}
