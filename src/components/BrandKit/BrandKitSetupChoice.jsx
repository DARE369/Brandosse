import React, { useRef } from 'react';
import { FileJson, FileText, MessageSquare, PenLine, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import useBrandKitStore from '../../stores/BrandKitStore';
import styles from './BrandKit.module.css';

const ACCEPTED_DOC_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function validateDoc(file) {
  if (!file) return 'No file selected';
  if (!ACCEPTED_DOC_MIME.includes(file.type)) {
    return 'Please upload a PDF or Word document (.pdf, .doc, .docx).';
  }
  if (file.size > 20 * 1024 * 1024) {
    return 'File must be under 20MB.';
  }
  return null;
}

/**
 * Mockup's "Set up your brand kit" screen — 4 EQUAL first-class options in a
 * 2x2 grid (Upload / Guided / Manual / Import a kit file). Per
 * AS_IS_AUDIT.md §1.2, the old build had JSON-import as a small footer link
 * — promoted here to a 4th equal card per the task brief.
 */
export default function BrandKitSetupChoice({ onSelectPath }) {
  const fileRef = useRef(null);
  const importRef = useRef(null);
  const setSetupPath = useBrandKitStore((state) => state.setSetupPath);
  const startDocumentExtraction = useBrandKitStore((state) => state.startDocumentExtraction);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    const error = validateDoc(file);
    event.target.value = '';

    if (error) {
      toast.error(error);
      return;
    }

    setSetupPath('upload');
    await startDocumentExtraction();
    onSelectPath('upload', file);
  };

  const handleImportChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Invalid JSON payload');
      }
      onSelectPath('import', parsed);
    } catch (_err) {
      toast.error('Invalid JSON file. Please import a valid Brand Kit JSON export.');
    }
  };

  return (
    <div className={styles.choiceWrap}>
      <div className={styles.choiceHeader}>
        <span className={styles.choiceIcon} aria-hidden="true"><Sparkles size={18} /></span>
        <h1 className={styles.choiceTitle}>Set up your brand kit</h1>
        <p className={styles.choiceSubtitle}>
          Every path lands on an editable review form before anything is saved.
        </p>
      </div>

      <div className={styles.choiceGrid}>
        <button className={styles.choiceCard} type="button" onClick={() => fileRef.current?.click()}>
          <span className={styles.choiceCardIcon}><FileText size={18} /></span>
          <span className={styles.choiceCardTitleRow}>
            <span className={styles.choiceCardTitle}>Upload a document</span>
            <span className={styles.choiceCardBadge}>Recommended</span>
          </span>
          <p className={styles.choiceCardDesc}>
            Upload your brand guidelines or media kit and let AI extract your Brand Kit.
          </p>
          <span className={styles.choiceCardNote}>PDF or Word, up to 20MB</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className={styles.visuallyHidden}
          onChange={handleFileChange}
        />

        <button
          className={styles.choiceCard}
          type="button"
          onClick={() => {
            setSetupPath('conversational');
            onSelectPath('conversational');
          }}
        >
          <span className={styles.choiceCardIcon}><MessageSquare size={18} /></span>
          <span className={styles.choiceCardTitleRow}>
            <span className={styles.choiceCardTitle}>Guided conversation</span>
          </span>
          <p className={styles.choiceCardDesc}>
            Answer a few questions, one at a time, and build your kit conversationally.
          </p>
          <span className={styles.choiceCardNote}>~2 minutes</span>
        </button>

        <button
          className={styles.choiceCard}
          type="button"
          onClick={() => {
            setSetupPath('manual');
            onSelectPath('manual');
          }}
        >
          <span className={styles.choiceCardIcon}><PenLine size={18} /></span>
          <span className={styles.choiceCardTitleRow}>
            <span className={styles.choiceCardTitle}>Fill it out manually</span>
          </span>
          <p className={styles.choiceCardDesc}>
            Use the full form with complete control over every field.
          </p>
          <span className={styles.choiceCardNote}>Full control</span>
        </button>

        <button className={styles.choiceCard} type="button" onClick={() => importRef.current?.click()}>
          <span className={styles.choiceCardIcon}><FileJson size={18} /></span>
          <span className={styles.choiceCardTitleRow}>
            <span className={styles.choiceCardTitle}>Import a kit file</span>
          </span>
          <p className={styles.choiceCardDesc}>
            Already have a Brand Kit JSON export? Bring it in and review before saving.
          </p>
          <span className={styles.choiceCardNote}>.json export</span>
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          className={styles.visuallyHidden}
          onChange={handleImportChange}
        />
      </div>
    </div>
  );
}
