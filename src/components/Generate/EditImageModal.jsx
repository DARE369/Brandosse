import React, { useEffect, useMemo, useRef, useState } from 'react';

export default function EditImageModal({
  isOpen,
  onClose,
  initialImage = null,
  libraryImages = [],
  onApplyEdit,
}) {
  const [sourceImage, setSourceImage] = useState(initialImage);
  const [instruction, setInstruction] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [resultImage, setResultImage] = useState(null);
  const [error, setError] = useState(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [dragging, setDragging] = useState(false);

  const fileInputRef = useRef(null);
  const instructionRef = useRef(null);
  const uploadedObjectUrlRef = useRef(null);

  const safeLibraryImages = useMemo(
    () => (Array.isArray(libraryImages) ? libraryImages : []),
    [libraryImages],
  );

  useEffect(() => {
    if (!isOpen) return;
    setSourceImage(initialImage);
    setInstruction('');
    setResultImage(null);
    setError(null);
    setShowLibrary(false);
  }, [initialImage, isOpen]);

  useEffect(() => {
    if (sourceImage && instructionRef.current) {
      instructionRef.current.focus();
    }
  }, [sourceImage]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [isOpen, onClose]);

  useEffect(
    () => () => {
      if (uploadedObjectUrlRef.current) {
        URL.revokeObjectURL(uploadedObjectUrlRef.current);
      }
    },
    [],
  );

  if (!isOpen) return null;

  const setUploadedSource = (file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    if (uploadedObjectUrlRef.current) {
      URL.revokeObjectURL(uploadedObjectUrlRef.current);
      uploadedObjectUrlRef.current = null;
    }
    const localUrl = URL.createObjectURL(file);
    uploadedObjectUrlRef.current = localUrl;
    setSourceImage({ url: localUrl, id: 'uploaded' });
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) setUploadedSource(file);
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) setUploadedSource(file);
    event.target.value = '';
  };

  const handleApply = async () => {
    if (!sourceImage?.url || !instruction.trim() || isApplying) return;
    setIsApplying(true);
    setError(null);

    try {
      const editedUrl = await onApplyEdit?.({
        imageUrl: sourceImage.url,
        instruction: instruction.trim(),
      });

      if (!editedUrl) {
        throw new Error('No edited image URL was returned.');
      }

      setResultImage(editedUrl);
    } catch (err) {
      setError(err?.message || 'Edit failed. Please try again.');
    } finally {
      setIsApplying(false);
    }
  };

  const acceptResult = () => {
    if (!resultImage) return;
    setSourceImage({ url: resultImage, id: 'edited' });
    setResultImage(null);
    setInstruction('');
  };

  return (
    <div
      className="eim-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eim-title"
      onClick={() => onClose?.()}
    >
      <div className="eim-modal" onClick={(event) => event.stopPropagation()}>
        <div className="eim-header">
          <div className="eim-header-left">
            <h2 className="eim-title" id="eim-title">Edit Image</h2>
          </div>
          <button className="eim-close" onClick={onClose} aria-label="Close" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="eim-body">
          <div className="eim-panel eim-panel--source">
            <div className="eim-panel-label">SOURCE IMAGE</div>

            {!sourceImage ? (
              <div
                className={`eim-dropzone${dragging ? ' dragging' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                aria-label="Upload image to edit"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                />
                <div className="eim-dropzone-content">
                  <svg className="eim-upload-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p className="eim-dropzone-text">Drop image here or click to upload</p>
                  <p className="eim-dropzone-hint">PNG, JPG, WEBP - max 10MB</p>
                </div>

                {safeLibraryImages.length > 0 && (
                  <button
                    className="eim-library-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowLibrary((open) => !open);
                    }}
                    type="button"
                  >
                    Pick from Library ({safeLibraryImages.length})
                  </button>
                )}
              </div>
            ) : (
              <div className="eim-image-preview">
                <img src={sourceImage.url} alt="Source to edit" />
                <button
                  className="eim-change-btn"
                  onClick={() => {
                    setSourceImage(null);
                    setResultImage(null);
                  }}
                  title="Change image"
                  type="button"
                >
                  Change image
                </button>
              </div>
            )}

            {showLibrary && safeLibraryImages.length > 0 && (
              <div className="eim-library-grid">
                <div className="eim-library-header">
                  <span>Your Library</span>
                  <button onClick={() => setShowLibrary(false)} type="button">x</button>
                </div>
                <div className="eim-library-items">
                  {safeLibraryImages.map((image, index) => (
                    <button
                      key={image.id ?? index}
                      className="eim-library-item"
                      onClick={() => {
                        setSourceImage(image);
                        setShowLibrary(false);
                      }}
                      type="button"
                    >
                      <img src={image.url} alt={`Library image ${index + 1}`} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="eim-panel eim-panel--controls">
            <div className="eim-panel-label">EDIT INSTRUCTION</div>

            <div className="eim-instruction-suggestions">
              {[
                'Change the background to a bright studio',
                'Remove the background completely',
                'Make the lighting more dramatic',
                'Add warm golden hour tones',
                'Keep product shadows natural',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  className="eim-suggestion-chip"
                  onClick={() => setInstruction(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <textarea
              ref={instructionRef}
              className="eim-instruction-textarea"
              placeholder={
                'Describe the edit you want to apply...\n' +
                'e.g. Change the background to a bright studio and keep product shadows natural.'
              }
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={5}
              disabled={isApplying}
            />

            {error && (
              <div className="eim-error" role="alert">{error}</div>
            )}

            <button
              className={`eim-apply-btn${!sourceImage || !instruction.trim() || isApplying ? ' disabled' : ''}`}
              onClick={handleApply}
              disabled={!sourceImage || !instruction.trim() || isApplying}
              type="button"
            >
              {isApplying ? (
                <>
                  <svg className="eim-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Applying Edit...
                </>
              ) : (
                <>Apply Edit</>
              )}
            </button>
          </div>

          <div className="eim-panel eim-panel--result">
            <div className="eim-panel-label">RESULT</div>

            {!resultImage ? (
              <div className="eim-result-placeholder">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <p>Edited image will appear here</p>
              </div>
            ) : (
              <div className="eim-result-preview">
                <img src={resultImage} alt="Edited result" />
                <div className="eim-result-actions">
                  <button className="eim-result-accept" onClick={acceptResult} type="button">
                    Use as source
                  </button>
                  <button
                    className="eim-result-download"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = resultImage;
                      link.download = 'edited-image.png';
                      link.click();
                    }}
                    type="button"
                  >
                    Download
                  </button>
                  <button className="eim-result-retry" onClick={() => setResultImage(null)} type="button">
                    Try again
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
