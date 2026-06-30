"use client";

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  fetchClientReviewPreview,
  submitClientReviewAction,
} from '../../org/services/pipelineService';
export default function ClientReviewPage({ clientReviewToken }) {
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null);
  const [comment, setComment] = useState('');
  const [completed, setCompleted] = useState(false);
  const [submittingAction, setSubmittingAction] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const data = await fetchClientReviewPreview(clientReviewToken);
        if (!cancelled) {
          setReview(data);
        }
      } catch (error) {
        if (!cancelled) {
          setReview({ error: error?.message || 'Unable to load review' });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [clientReviewToken]);

  const handleAction = async (action) => {
    try {
      setSubmittingAction(action);
      await submitClientReviewAction({
        client_review_token: clientReviewToken,
        action,
        comment: comment.trim() || undefined,
      });
      setCompleted(true);
      toast.success(action === 'approve' ? 'Content approved' : 'Feedback submitted');
    } catch (error) {
      toast.error(error?.message || 'Review action failed');
    } finally {
      setSubmittingAction('');
    }
  };

  return (
    <main className="client-review-page">
      <div className="client-review-shell">
        <div className="client-review-header">
          <span>SocialAI</span>
          <h1>Content Review</h1>
        </div>

        {loading ? (
          <div className="client-review-card client-review-state" role="status">Loading review...</div>
        ) : review?.error ? (
          <div className="client-review-card client-review-state" role="alert">
            <strong>Review unavailable</strong>
            <p>{review.error}</p>
          </div>
        ) : review?.completed ? (
          <div className="client-review-card client-review-state">
            <strong>This review has been completed.</strong>
            <p>Thank you for your time.</p>
          </div>
        ) : completed ? (
          <div className="client-review-card client-review-state">
            <strong>This review has been completed.</strong>
            <p>Thank you for your time.</p>
          </div>
        ) : (
          <>
            <div className="client-review-card">
              {review?.media_url ? (
                <img src={review.media_url} alt={review.title || 'Review content'} className="client-review-media" />
              ) : null}
              <strong>{review?.title || 'Content preview'}</strong>
              <p>{review?.caption || 'No caption provided.'}</p>
            </div>

            <div className="client-review-card client-review-actions-card">
              <div className="client-review-action-row">
                <button
                  type="button"
                  className="client-review-primary"
                  onClick={() => handleAction('approve')}
                  disabled={!!submittingAction}
                >
                  {submittingAction === 'approve' ? 'Approving...' : 'Approve'}
                </button>
                <button
                  type="button"
                  className="client-review-secondary"
                  onClick={() => handleAction('request_revision')}
                  disabled={!!submittingAction}
                >
                  {submittingAction === 'request_revision' ? 'Submitting...' : 'Request Changes'}
                </button>
              </div>
              <label className="client-review-feedback">
                <span>Feedback</span>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Optional review feedback"
                  rows={5}
                  disabled={!!submittingAction}
                />
              </label>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
