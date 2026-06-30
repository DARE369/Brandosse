import React, { useRef } from 'react';
import { FileJson, FileText, MessageSquare, PenLine, Sparkles, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import useBrandKitStore from '../../stores/BrandKitStore';

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
    <div className="bk-choice-screen">
      <div className="bk-choice-bg-grid" aria-hidden="true" />
      <div className="bk-choice-bg-glow" aria-hidden="true" />

      <div className="bk-choice-header">
        <span className="bk-choice-icon" aria-hidden="true"><Sparkles size={18} /></span>
        <h1 className="bk-choice-title">Set up your Brand Kit</h1>
        <p className="bk-choice-subtitle">
          Teach the AI your brand identity once. Every generation will reflect it automatically.
        </p>
      </div>

      <div className="bk-choice-primary">
        <div className="bk-choice-primary-content">
          <div className="bk-choice-primary-icon">
            <FileText size={20} />
          </div>
          <div className="bk-choice-primary-text">
            <div className="bk-choice-primary-heading">
              Upload brand document
              <span className="bk-choice-badge">Recommended</span>
            </div>
            <p className="bk-choice-primary-desc">
              The fastest path. Upload your guidelines or media kit and let AI extract your Brand Kit.
            </p>
            <p className="bk-choice-primary-note">
              Supports PDF and Word files up to 20MB.
            </p>
          </div>
          <button
            className="bk-btn-primary"
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            <Upload size={15} />
            Upload doc
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="bk-visually-hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      <div className="bk-choice-secondary-row">
        <button
          className="bk-choice-secondary-card"
          onClick={() => {
            setSetupPath('conversational');
            onSelectPath('conversational');
          }}
          type="button"
        >
          <div className="bk-choice-card-icon">
            <MessageSquare size={18} />
          </div>
          <div className="bk-choice-card-text">
            <span className="bk-choice-card-title">Guide me with AI</span>
            <span className="bk-choice-card-desc">
              Answer a few questions and build your kit conversationally.
            </span>
          </div>
          <span className="bk-choice-card-arrow">-&gt;</span>
        </button>

        <button
          className="bk-choice-secondary-card"
          onClick={() => {
            setSetupPath('manual');
            onSelectPath('manual');
          }}
          type="button"
        >
          <div className="bk-choice-card-icon">
            <PenLine size={18} />
          </div>
          <div className="bk-choice-card-text">
            <span className="bk-choice-card-title">Fill it myself</span>
            <span className="bk-choice-card-desc">
              Use the full manual form with complete control.
            </span>
          </div>
          <span className="bk-choice-card-arrow">-&gt;</span>
        </button>
      </div>

      <p className="bk-choice-footer-link">
        Already have a kit?{' '}
        <button className="bk-link" onClick={() => importRef.current?.click()} type="button">
          Import from JSON
        </button>
      </p>

      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        className="bk-visually-hidden"
        onChange={handleImportChange}
      />

      <div className="bk-choice-import-icon" aria-hidden="true">
        <FileJson size={14} />
      </div>
    </div>
  );
}
