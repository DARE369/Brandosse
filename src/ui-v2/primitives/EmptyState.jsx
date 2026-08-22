import styles from "./EmptyState.module.css";

/**
 * The "there is nothing here" pattern.
 *
 * DoC-9 requires that when a surface has no data it SHALL explain why and offer
 * the next action. An empty state with no way forward is a dead end, and a new
 * account is nothing *but* empty states — so this is the first impression the
 * product makes.
 *
 * That gives every empty state exactly two shapes:
 *
 *   `actions`   — the normal case. Something is missing and the user can fix it.
 *                 Pass real, working controls.
 *
 *   `noAction`  — the deliberate exception, given as a written reason. Renders
 *                 calm rather than prompting, because there is nothing to prompt
 *                 for. Only three reasons hold up:
 *                   · the empty state IS the good outcome ("No failures")
 *                   · the action is already on screen next to it, and the
 *                     description points at it ("Connect a platform below")
 *                   · this user genuinely cannot act (someone else must)
 *
 * One or the other is mandatory — `scripts/check-empty-states.cjs` fails the
 * build on an empty state that has neither, so "I forgot the action" cannot
 * pass as "there wasn't one". The reason string is the point: it makes the
 * exception a decision somebody wrote down.
 *
 * `dashed` is the prompting treatment — a placeholder outline for a slot the
 * user is expected to fill. It is ignored when `noAction` is set.
 */
export function EmptyState({ title, description, dashed = false, actions, noAction, className = "" }) {
  const calm = Boolean(noAction);
  const classes = [styles.wrap, dashed && !calm ? styles.dashed : "", calm ? styles.calm : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <div className={styles.title}>{title}</div>
      {description ? <div className={styles.desc}>{description}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
