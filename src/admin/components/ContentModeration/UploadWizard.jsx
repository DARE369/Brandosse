/**
 * @file UploadWizard.jsx
 * @description Guided multi-step wizard for uploading, editing, previewing, and scheduling new posts.
 * Includes user selection, platform targeting, and real-time media preview.
 */

import React, { useState } from "react";
import { X } from "lucide-react"; // for clean icon buttons

export default function UploadWizard({ onClose }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [metadata, setMetadata] = useState({
    caption: "",
    hashtags: "",
    schedule: "",
  });

  const users = ["Daniel", "Grace", "Emmanuel", "Chika"];
  const platforms = ["Instagram", "TikTok", "Facebook", "YouTube"];

  const handleFileChange = (e) => {
    const newFile = e.target.files[0];
    setFile(newFile);
    if (newFile) {
      const reader = new FileReader();
      reader.onload = () => setMediaPreview(reader.result);
      reader.readAsDataURL(newFile);
    }
  };

  const togglePlatform = (platform) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform]
    );
  };

  const next = () => setStep(step + 1);
  const back = () => setStep(step - 1);

  return (
    <div className="wizard-overlay">
      <div className="upload-wizard">
        <button className="wizard-close" onClick={onClose}>
          <X size={20} />
        </button>

        {/* Step 1: Select User & Platforms */}
        {step === 1 && (
          <div className="wizard-step">
            <h2>Select User & Platforms</h2>
            <label>User</label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <option value="">-- Select User --</option>
              {users.map((user) => (
                <option key={user}>{user}</option>
              ))}
            </select>

            {selectedUser && (
              <>
                <p className="subtext">Select Platforms to Post To:</p>
                <div className="platform-options">
                  {platforms.map((p) => (
                    <button
                      key={p}
                      className={`platform-btn ${
                        selectedPlatforms.includes(p) ? "active" : ""
                      }`}
                      onClick={() => togglePlatform(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="wizard-nav">
              <button
                disabled={!selectedUser || selectedPlatforms.length === 0}
                onClick={next}
              >
                Next
              </button>
              <button className="cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Upload Media */}
        {step === 2 && (
          <div className="wizard-step">
            <h2>Upload Media</h2>
            {mediaPreview ? (
              <div className="media-preview">
                {file.type.startsWith("video") ? (
                  <video controls src={mediaPreview}></video>
                ) : (
                  <img src={mediaPreview} alt="preview" />
                )}
                <button className="replace-btn">
                  <label>
                    Replace File
                    <input
                      type="file"
                      onChange={handleFileChange}
                      style={{ display: "none" }}
                    />
                  </label>
                </button>
              </div>
            ) : (
              <input type="file" onChange={handleFileChange} />
            )}
            <div className="wizard-nav">
              <button onClick={back}>Back</button>
              <button disabled={!file} onClick={next}>
                Next
              </button>
              <button className="cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Add Metadata */}
        {step === 3 && (
          <div className="wizard-step">
            <h2>Add Metadata</h2>
            <input
              placeholder="Caption"
              value={metadata.caption}
              onChange={(e) =>
                setMetadata({ ...metadata, caption: e.target.value })
              }
            />
            <input
              placeholder="Hashtags"
              value={metadata.hashtags}
              onChange={(e) =>
                setMetadata({ ...metadata, hashtags: e.target.value })
              }
            />
            <input
              type="datetime-local"
              value={metadata.schedule}
              onChange={(e) =>
                setMetadata({ ...metadata, schedule: e.target.value })
              }
            />
            <div className="wizard-nav">
              <button onClick={back}>Back</button>
              <button onClick={next}>Next</button>
              <button className="cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Confirm & Schedule */}
        {step === 4 && (
          <div className="wizard-step confirm">
            <h2>Confirm & Schedule</h2>
            <div className="confirm-summary">
              <p><strong>User:</strong> {selectedUser}</p>
              <p><strong>Platforms:</strong> {selectedPlatforms.join(", ")}</p>
              <p><strong>Caption:</strong> {metadata.caption}</p>
              <p><strong>Hashtags:</strong> {metadata.hashtags}</p>
              <p><strong>Schedule:</strong> {metadata.schedule}</p>
              {mediaPreview && (
                <div className="media-preview small">
                  {file.type.startsWith("video") ? (
                    <video src={mediaPreview} controls></video>
                  ) : (
                    <img src={mediaPreview} alt="preview" />
                  )}
                </div>
              )}
            </div>
            <div className="wizard-nav">
              <button onClick={back}>Back</button>
              <button className="confirm-btn" onClick={onClose}>
                Schedule Post
              </button>
              <button className="cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
