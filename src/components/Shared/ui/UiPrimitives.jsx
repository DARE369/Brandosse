import React, { useEffect, useId, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import StatusBadge from '../StatusBadge';

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

function prefixed(prefix, value) {
  return value ? `${prefix}-${value}` : '';
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container) {
  if (!container) return [];

  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('aria-hidden');
  });
}

function useDialogFocus(open) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;

    previousFocusRef.current = document.activeElement;
    const frameId = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const firstFocusable = getFocusableElements(dialog)[0];
      (firstFocusable || dialog)?.focus?.({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.focus && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, [open]);

  return dialogRef;
}

function handleDialogKeyDown(event, dialogRef, onClose) {
  if (event.key === 'Escape') {
    onClose?.();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusableElements = getFocusableElements(dialogRef.current);
  if (focusableElements.length === 0) {
    event.preventDefault();
    dialogRef.current?.focus?.({ preventScroll: true });
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

export function UiButton({
  as: Component = 'button',
  variant = 'secondary',
  tone = 'neutral',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  type = 'button',
  ...props
}) {
  const isNativeButton = Component === 'button';
  const isDisabled = disabled || loading;

  return (
    <Component
      className={cx(
        'ui-button',
        prefixed('ui-button', variant),
        prefixed('ui-button-tone', tone),
        prefixed('ui-button', size),
        loading && 'is-loading',
        className
      )}
      disabled={isNativeButton ? isDisabled : undefined}
      aria-disabled={!isNativeButton && isDisabled ? 'true' : undefined}
      aria-busy={loading || undefined}
      type={isNativeButton ? type : undefined}
      {...props}
    >
      {loading ? <Loader2 size={16} className="ui-spin" aria-hidden="true" /> : null}
      <span className="ui-button-content">{children}</span>
    </Component>
  );
}

export function UiIconButton({
  as: Component = 'button',
  variant = 'ghost',
  tone = 'neutral',
  size = 'md',
  loading = false,
  disabled = false,
  ariaLabel,
  title,
  className = '',
  children,
  type = 'button',
  ...props
}) {
  const isNativeButton = Component === 'button';
  const label = ariaLabel || title || 'Icon button';
  const isDisabled = disabled || loading;

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && !ariaLabel && !title && typeof console !== 'undefined') {
      console.warn('[UiIconButton] Provide ariaLabel or title for a meaningful accessible name.');
    }
  }, [ariaLabel, title]);

  return (
    <Component
      className={cx(
        'ui-icon-button',
        prefixed('ui-icon-button', variant),
        prefixed('ui-icon-button-tone', tone),
        prefixed('ui-icon-button', size),
        loading && 'is-loading',
        className
      )}
      disabled={isNativeButton ? isDisabled : undefined}
      aria-disabled={!isNativeButton && isDisabled ? 'true' : undefined}
      aria-busy={loading || undefined}
      aria-label={label}
      title={title}
      type={isNativeButton ? type : undefined}
      {...props}
    >
      {loading ? <Loader2 size={16} className="ui-spin" aria-hidden="true" /> : children}
    </Component>
  );
}

export function UiCard({
  as: Component = 'section',
  variant = 'default',
  tone = 'neutral',
  padding = 'md',
  interactive = false,
  className = '',
  children,
  ...props
}) {
  return (
    <Component
      className={cx(
        'ui-card',
        prefixed('ui-card', variant),
        prefixed('ui-card-tone', tone),
        prefixed('ui-card-pad', padding),
        interactive && 'is-interactive',
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

export function UiPanel({
  as: Component = 'section',
  variant = 'default',
  padding = 'md',
  className = '',
  children,
  ...props
}) {
  return (
    <Component
      className={cx('ui-panel', prefixed('ui-panel', variant), prefixed('ui-panel-pad', padding), className)}
      {...props}
    >
      {children}
    </Component>
  );
}

export function UiBadge({
  as: Component = 'span',
  variant = 'soft',
  tone = 'neutral',
  size = 'sm',
  className = '',
  children,
  ...props
}) {
  return (
    <Component
      className={cx(
        'ui-badge',
        prefixed('ui-badge', variant),
        prefixed('ui-badge-tone', tone),
        prefixed('ui-badge', size),
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

export function UiStatusBadge({ status, size = 'md', className = '', ...props }) {
  return <StatusBadge status={status} size={size} className={cx('ui-status-badge', className)} {...props} />;
}

export function UiInput({
  id,
  label,
  hint,
  error,
  className = '',
  inputClassName = '',
  ariaLabel,
  ...props
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <label className={cx('ui-field', className)} htmlFor={inputId}>
      {label ? <span className="ui-field-label">{label}</span> : null}
      <input
        id={inputId}
        className={cx('ui-input', error && 'is-invalid', inputClassName)}
        aria-label={!label ? ariaLabel : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {hint ? <span id={hintId} className="ui-field-hint">{hint}</span> : null}
      {error ? <span id={errorId} className="ui-field-error">{error}</span> : null}
    </label>
  );
}

export function UiSelect({
  id,
  label,
  hint,
  error,
  className = '',
  selectClassName = '',
  ariaLabel,
  children,
  ...props
}) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <label className={cx('ui-field', className)} htmlFor={selectId}>
      {label ? <span className="ui-field-label">{label}</span> : null}
      <select
        id={selectId}
        className={cx('ui-select', error && 'is-invalid', selectClassName)}
        aria-label={!label ? ariaLabel : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...props}
      >
        {children}
      </select>
      {hint ? <span id={hintId} className="ui-field-hint">{hint}</span> : null}
      {error ? <span id={errorId} className="ui-field-error">{error}</span> : null}
    </label>
  );
}

export function UiTabs({
  tabs = [],
  value,
  onChange,
  size = 'md',
  ariaLabel = 'Tabs',
  className = '',
}) {
  return (
    <div className={cx('ui-tabs', prefixed('ui-tabs', size), className)} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            className={cx('ui-tab', selected && 'is-active')}
            role="tab"
            aria-selected={selected}
            disabled={tab.disabled}
            onClick={() => onChange?.(tab.value)}
          >
            {Icon ? <Icon size={16} aria-hidden="true" /> : null}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function UiModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className = '',
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus(open);

  if (!open) return null;

  return (
    <div
      className="ui-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      onKeyDown={(event) => {
        handleDialogKeyDown(event, dialogRef, onClose);
      }}
    >
      <section
        ref={dialogRef}
        className={cx('ui-modal', prefixed('ui-modal', size), className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="ui-dialog-header">
          <div>
            {title ? <h2 id={titleId} className="ui-dialog-title">{title}</h2> : null}
            {description ? <p id={descriptionId} className="ui-dialog-description">{description}</p> : null}
          </div>
          {onClose ? (
            <UiIconButton ariaLabel="Close dialog" variant="ghost" size="sm" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </UiIconButton>
          ) : null}
        </header>
        <div className="ui-dialog-body">{children}</div>
        {footer ? <footer className="ui-dialog-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function UiDrawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'right',
  className = '',
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus(open);

  if (!open) return null;

  return (
    <div
      className="ui-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      onKeyDown={(event) => {
        handleDialogKeyDown(event, dialogRef, onClose);
      }}
    >
      <aside
        ref={dialogRef}
        className={cx('ui-drawer', prefixed('ui-drawer', side), className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="ui-dialog-header">
          <div>
            {title ? <h2 id={titleId} className="ui-dialog-title">{title}</h2> : null}
            {description ? <p id={descriptionId} className="ui-dialog-description">{description}</p> : null}
          </div>
          {onClose ? (
            <UiIconButton ariaLabel="Close drawer" variant="ghost" size="sm" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </UiIconButton>
          ) : null}
        </header>
        <div className="ui-dialog-body">{children}</div>
        {footer ? <footer className="ui-dialog-footer">{footer}</footer> : null}
      </aside>
    </div>
  );
}

export function UiTable({ caption, columns, rows, rowKey, className = '', children, emptyText = 'No results found.' }) {
  const hasStructuredRows = Array.isArray(columns) && Array.isArray(rows);

  return (
    <div className={cx('ui-table-wrap', className)}>
      <table className="ui-table">
        {caption ? <caption>{caption}</caption> : null}
        {hasStructuredRows ? (
          <>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key || column.header} scope="col">{column.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row, index) => (
                <tr key={rowKey ? rowKey(row, index) : row.id || index}>
                  {columns.map((column) => (
                    <td key={column.key || column.header}>
                      {column.render ? column.render(row, index) : row[column.key]}
                    </td>
                  ))}
                </tr>
              )) : (
                <tr>
                  <td colSpan={columns.length} className="ui-table-empty">{emptyText}</td>
                </tr>
              )}
            </tbody>
          </>
        ) : children}
      </table>
    </div>
  );
}

export function UiEmptyState({
  eyebrow,
  icon,
  title = 'Nothing here yet',
  description,
  actions,
  className = '',
}) {
  return (
    <section className={cx('ui-empty-state', className)}>
      {eyebrow ? <p className="ui-empty-state-eyebrow">{eyebrow}</p> : null}
      {icon ? <div className="ui-empty-state-icon" aria-hidden="true">{icon}</div> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {actions ? <div className="ui-empty-state-actions">{actions}</div> : null}
    </section>
  );
}

export function UiPageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className = '',
}) {
  return (
    <header className={cx('ui-page-header', className)}>
      <div className="ui-page-header-copy">
        {eyebrow ? <p className="ui-page-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
        {meta ? <div className="ui-page-header-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="ui-page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function UiStatCard({
  label,
  value,
  description,
  trend,
  icon,
  tone = 'brand',
  className = '',
}) {
  return (
    <UiCard className={cx('ui-stat-card', prefixed('ui-stat-card-tone', tone), className)} padding="md">
      <div className="ui-stat-card-header">
        <span>{label}</span>
        {icon ? <span className="ui-stat-card-icon" aria-hidden="true">{icon}</span> : null}
      </div>
      <div className="ui-stat-card-value">{value}</div>
      {(description || trend) ? (
        <div className="ui-stat-card-footer">
          {description ? <span>{description}</span> : null}
          {trend ? <UiBadge tone={trend.tone || 'neutral'}>{trend.label}</UiBadge> : null}
        </div>
      ) : null}
    </UiCard>
  );
}
