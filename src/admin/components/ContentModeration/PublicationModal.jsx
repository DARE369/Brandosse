import React, { useState } from "react";
import { X, Calendar, Send } from "lucide-react";
import { POST_STATUS } from "../../../constants/statuses";

export default function PublicationModal({ item, onClose, onConfirm }) {
  const [mode, setMode] = useState("schedule"); // 'schedule' | 'now'
  const [errorMessage, setErrorMessage] = useState("");
  const [formData, setFormData] = useState({
    caption: item.caption || item.metadata?.caption || "",
    hashtags: (item.hashtags || item.metadata?.hashtags || []).toString(),
    scheduleDate: "",
    scheduleTime: ""
  });

  const mediaUrl = item.media_url || item.storage_path;
  const isVideo = item.media_type === 'video';

  const handleSave = () => {
    if (mode === 'schedule' && (!formData.scheduleDate || !formData.scheduleTime)) {
      setErrorMessage("Please select a date and time.");
      return;
    }

    setErrorMessage("");
    
    let finalDate = new Date().toISOString();
    if (mode === 'schedule') {
      finalDate = new Date(`${formData.scheduleDate}T${formData.scheduleTime}`).toISOString();
    }

    onConfirm({
      ...item,
      caption: formData.caption,
      hashtags: formData.hashtags.split(',').map(t => t.trim()).filter(Boolean),
      scheduled_at: finalDate,
      // Publication modal only emits canonical post lifecycle statuses.
      status: mode === 'now' ? POST_STATUS.PUBLISHED : POST_STATUS.SCHEDULED
    });
  };

  return (
    <div className="modal-overlay">
      <div className="pub-modal-container">
        
        {/* LEFT: Controls */}
        <div className="pub-controls">
          <div className="pub-header">
            <h2>Publication Wizard</h2>
            <button onClick={onClose} type="button" aria-label="Close publication modal"><X size={20} /></button>
          </div>

          <div className="pub-tabs">
            <button 
              className={`pub-tab ${mode === 'schedule' ? 'active' : ''}`} 
              onClick={() => setMode('schedule')}
              type="button"
            >
              <Calendar size={14} /> Schedule
            </button>
            <button 
              className={`pub-tab ${mode === 'now' ? 'active' : ''}`} 
              onClick={() => setMode('now')}
              type="button"
            >
              <Send size={14} /> Post Now
            </button>
          </div>

          <div className="pub-form">
            {errorMessage ? <div className="admin-inline-alert admin-inline-alert-warning">{errorMessage}</div> : null}
            {mode === 'schedule' && (
              <div className="form-row-split">
                <div className="form-group">
                  <label>Date</label>
                  <input 
                    type="date" 
                    className="pub-input" 
                    value={formData.scheduleDate}
                    onChange={e => setFormData({...formData, scheduleDate: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Time</label>
                  <input 
                    type="time" 
                    className="pub-input"
                    value={formData.scheduleTime}
                    onChange={e => setFormData({...formData, scheduleTime: e.target.value})}
                  />
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Caption</label>
              <textarea 
                className="pub-textarea" 
                value={formData.caption}
                onChange={e => setFormData({...formData, caption: e.target.value})}
                placeholder="Write a caption..."
              />
            </div>
            
            <div className="form-group">
              <label>Hashtags</label>
              <input 
                className="pub-input" 
                value={formData.hashtags}
                onChange={e => setFormData({...formData, hashtags: e.target.value})}
                placeholder="#tech, #ai (comma separated)"
              />
            </div>
          </div>

          <div className="pub-footer">
            <button className="btn-secondary" onClick={onClose} type="button">Cancel</button>
            <button className="btn-primary" onClick={handleSave} type="button">
              {mode === 'now' ? 'Post Immediately' : 'Confirm Schedule'}
            </button>
          </div>
        </div>

        {/* RIGHT: Preview */}
        <div className="pub-preview">
          <div className="phone-mockup">
            <div className="phone-media">
              {isVideo ? (
                <video src={mediaUrl} controls className="media-fit" />
              ) : (
                <img src={mediaUrl} alt="Preview" className="media-fit" />
              )}
            </div>
            <div className="phone-caption">
              <p><strong>{item.profiles?.full_name || "Creator"}</strong> {formData.caption}</p>
              <p className="phone-tags">{formData.hashtags}</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
