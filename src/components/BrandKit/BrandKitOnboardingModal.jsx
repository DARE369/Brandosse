// src/components/BrandKit/BrandKitOnboardingModal.jsx
import React, { useEffect } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import useBrandKitStore from '../../stores/BrandKitStore';
import { useAppNavigation } from '../../Context/AppNavigationContext';

/**
 * Modal shown once per session when brand kit is not configured.
 * Trigger from GeneratePageV2 on mount.
 */
export default function BrandKitOnboardingModal({ userId, onClose }) {
  const { navigate } = useAppNavigation();
  const skipSetup = useBrandKitStore((state) => state.skipSetup);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleSetup = () => {
    onClose();
    navigate('/app/settings/brand-kit');
  };

  const handleSkip = async () => {
    if (userId) await skipSetup(userId);
    onClose();
  };

  return (
    <div className="bk-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="bk-modal-title">
      <div className="bk-modal">
        <div className="bk-modal-icon" aria-hidden="true">
          <Sparkles size={28} />
        </div>
        <h2 id="bk-modal-title">Get better results with a Brand Kit</h2>
        <p>
          Your Brand Kit teaches the AI your voice, visual style, and content guardrails.
          Every generation, images, captions, and hashtags, will match your brand.
        </p>
        <p className="bk-modal-time">Takes about 3 minutes. You can always edit it later.</p>
        <div className="bk-modal-actions">
          <button className="bk-modal-btn-primary" onClick={handleSetup} type="button">
            Set up Brand Kit
          </button>
          <button className="bk-modal-btn-secondary" onClick={handleSkip} type="button">
            Skip for now
          </button>
        </div>
        <p className="bk-modal-warning">
          <AlertTriangle size={14} aria-hidden="true" />
          Skipping will result in generic outputs.
        </p>
      </div>
    </div>
  );
}
