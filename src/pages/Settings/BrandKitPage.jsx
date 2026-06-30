"use client";

// src/pages/Settings/BrandKitPage.jsx
import React, { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import useBrandKitStore from '../../stores/BrandKitStore';
import UserNavbar from '../../components/User/UserNavbar';
import UserSidebar from '../../components/User/UserSidebar';
import AuthLoadingOverlay from '../../components/Shared/AuthLoadingOverlay';
import BrandKitSetupChoice from '../../components/BrandKit/BrandKitSetupChoice';
import BrandKitExtractLoader from '../../components/BrandKit/BrandKitExtractLoader';
import BrandKitConversation from '../../components/BrandKit/BrandKitConversation';
import BrandKitReviewForm from '../../components/BrandKit/BrandKitReviewForm';
import BrandKitDashboard from '../../components/BrandKit/BrandKitDashboard';
import BrandKitDiffModal from '../../components/BrandKit/BrandKitDiffModal';
export default function BrandKitPage() {
  const { user } = useAuth();
  const { navigate } = useAppNavigation();

  const {
    brandKit,
    assets,
    isLoading,
    error,
    loadBrandKit,
    setExtractedDraft,
    clearExtractedDraft,
    openDiffModal,
    closeDiffModal,
    applyDiff,
    diffData,
    isDiffModalOpen,
  } = useBrandKitStore();

  const [screen, setScreen] = useState('choice');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [extractMode, setExtractMode] = useState('setup');
  const [reviewMode, setReviewMode] = useState('manual');
  const [conversationPrefilled, setConversationPrefilled] = useState({});
  const [conversationMissingFields, setConversationMissingFields] = useState([]);
  const [initialReviewTab, setInitialReviewTab] = useState('Basics');

  useEffect(() => {
    if (user?.id) {
      loadBrandKit(user.id);
    }
  }, [user?.id, loadBrandKit]);

  useEffect(() => {
    if (user) return;
    navigate('/login', { replace: true });
  }, [navigate, user]);

  useEffect(() => {
    if (!brandKit) return;

    if (brandKit.setup_completed) {
      if (screen === 'choice') {
        setScreen('dashboard');
      }
      return;
    }

    if (!brandKit.setup_completed && screen === 'dashboard') {
      setScreen('choice');
    }
  }, [brandKit, screen]);

  if (!user) {
    return (
      <AuthLoadingOverlay
        title="Redirecting to sign in"
        description="Open Brand Kit after signing in."
      />
    );
  }

  const handleSelectPath = (path, payload = null) => {
    if (path === 'upload') {
      setExtractMode('setup');
      setUploadedFile(payload);
      setScreen('extracting');
      return;
    }

    if (path === 'conversational') {
      clearExtractedDraft();
      setReviewMode('conversational');
      setConversationPrefilled({});
      setConversationMissingFields([]);
      setScreen('conversational');
      return;
    }

    if (path === 'manual') {
      clearExtractedDraft();
      setReviewMode('manual');
      setInitialReviewTab('Basics');
      setScreen('review');
      return;
    }

    if (path === 'import' && payload) {
      setExtractedDraft(payload, {}, []);
      setReviewMode('manual');
      setInitialReviewTab('Basics');
      setScreen('review');
    }
  };

  const handleExtractionComplete = (extractedData, confidenceMap = {}, _missingTier1Fields = []) => {
    if (extractMode === 'update') {
      openDiffModal(brandKit || {}, extractedData || {}, confidenceMap || {});
      setScreen('dashboard');
      setUploadedFile(null);
      return;
    }

    setReviewMode('extracted');
    setInitialReviewTab('Basics');
    setScreen('review');
    setUploadedFile(null);
  };

  const handleFallbackToConversation = (missingFields = [], prefilled = {}) => {
    setReviewMode('conversational');
    setConversationMissingFields(missingFields);
    setConversationPrefilled(prefilled || {});
    setScreen('conversational');
    setUploadedFile(null);
  };

  const handleConversationComplete = (collectedData = {}, confidenceMap = {}) => {
    setExtractedDraft(collectedData, confidenceMap, []);
    setReviewMode('conversational');
    setInitialReviewTab('Basics');
    setScreen('review');
  };

  const handleSaved = () => {
    clearExtractedDraft();
    setScreen('dashboard');
  };

  const renderScreen = () => {
    if (isLoading && !brandKit) {
      return <div className="bk-page-loading">Loading Brand Kit...</div>;
    }

    if (screen === 'choice') {
      return <BrandKitSetupChoice onSelectPath={handleSelectPath} />;
    }

    if (screen === 'extracting') {
      return (
        <BrandKitExtractLoader
          file={uploadedFile}
          mode={extractMode}
          onComplete={handleExtractionComplete}
          onFallbackToConversational={handleFallbackToConversation}
          onCancel={() => {
            setUploadedFile(null);
            setScreen(brandKit?.setup_completed ? 'dashboard' : 'choice');
          }}
        />
      );
    }

    if (screen === 'conversational') {
      return (
        <BrandKitConversation
          prefilled={conversationPrefilled}
          initialMissingFields={conversationMissingFields}
          onComplete={handleConversationComplete}
        />
      );
    }

    if (screen === 'review') {
      return (
        <BrandKitReviewForm
          userId={user.id}
          mode={reviewMode}
          initialTab={initialReviewTab}
          onSaved={handleSaved}
        />
      );
    }

    return (
      <BrandKitDashboard
        brandKit={brandKit}
        assetsCount={assets?.length || 0}
        onOpenManualEdit={() => {
          setReviewMode('manual');
          setInitialReviewTab('Basics');
          setScreen('review');
        }}
        onEditSection={(section) => {
          setReviewMode('manual');
          setInitialReviewTab(section);
          setScreen('review');
        }}
        onUploadUpdatedDocument={(file) => {
          setExtractMode('update');
          setUploadedFile(file);
          setScreen('extracting');
        }}
      />
    );
  };

  return (
    <div className="dashboard-shell">
      <UserNavbar />
      <UserSidebar />

      <main className="dashboard-content bk-dashboard-content">
        <div className="bk-page">
          {error && <div className="bk-error-banner" role="alert">{error}</div>}
          {renderScreen()}
        </div>
      </main>

      {isDiffModalOpen && diffData && (
        <BrandKitDiffModal
          existingKit={diffData.existingKit}
          newKit={diffData.newKit}
          newConfidenceMap={diffData.newConfidenceMap}
          onApply={async (merged) => {
            await applyDiff(merged, user.id);
          }}
          onCancel={closeDiffModal}
        />
      )}

      <Toaster position="top-center" />
    </div>
  );
}
