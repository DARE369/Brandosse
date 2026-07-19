import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, Button } from '../../ui-v2';
import styles from './BrandKit.module.css';

export default function BrandKitSaveWarning({ missingFields = [], onComplete, onDismiss }) {
  return (
    <Modal
      open
      onClose={onDismiss}
      size="sm"
      title="Some important fields are empty"
      description="Without these fields, AI outputs may feel generic and less consistent with your brand."
      actions={
        <>
          <Button variant="ghost" onClick={onComplete}>Save anyway →</Button>
          <Button onClick={onDismiss}>Complete these fields</Button>
        </>
      }
    >
      <span className={styles.warningIcon} aria-hidden="true"><AlertTriangle size={18} /></span>
      <ul className={styles.warningFieldList}>
        {missingFields.map((field) => (
          <li key={field.key} className={styles.warningFieldItem}>
            <span className={styles.warningFieldDot} aria-hidden="true" />
            {field.label}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
