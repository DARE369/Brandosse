import React, { useState } from "react";
import PreviewPane from "./PreviewPane";
import { X, Save } from "lucide-react";

export default function EditModal({ post, onClose, onSave }) {
  const [edited, setEdited] = useState(post);

  const handleChange = (e) => {
    setEdited({ ...edited, [e.target.name]: e.target.value });
  };

  return (
    <div className="modal-overlay">
      <div className="edit-modal-container">
        
        {/* Left: Form */}
        <div className="edit-form-col">
          <div className="modal-header">
            <h2 className="modal-title">Edit Content</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white" type="button" aria-label="Close edit modal">
              <X size={24} />
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Caption</label>
            <textarea 
              name="caption" 
              value={edited.caption} 
              onChange={handleChange} 
              className="form-textarea"
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Hashtags</label>
            <input 
              name="hashtags" 
              value={edited.hashtags} 
              onChange={handleChange} 
              className="form-input"
            />
          </div>

          <div className="modal-footer">
            <button onClick={onClose} className="btn-cancel" type="button">Cancel</button>
            <button onClick={() => onSave(edited)} className="btn-primary" type="button">
              <Save size={18} /> Save Changes
            </button>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="edit-preview-col">
          <PreviewPane post={edited} />
        </div>

      </div>
    </div>
  );
}
