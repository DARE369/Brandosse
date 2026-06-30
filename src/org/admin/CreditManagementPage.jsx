"use client";

import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useOrgContext } from '../hooks/useOrgContext';
import useOrgCredits from '../hooks/useOrgCredits';
import OrgEmptyState from '../components/OrgEmptyState';
import { reviewCreditRequest } from '../services/creditService';

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function toPositiveNumber(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue) || nextValue <= 0) return 0;
  return nextValue;
}

export default function CreditManagementPage() {
  const { organization } = useOrgContext();
  const {
    organizationCreditsUsed,
    organizationCreditPool,
    requests,
    loadingRequests,
    refreshRequests,
  } = useOrgCredits();
  const [actionBusy, setActionBusy] = useState('');
  const [decisionDrafts, setDecisionDrafts] = useState({});

  const pendingCount = useMemo(
    () => requests.filter((item) => item.status === 'pending').length,
    [requests],
  );

  const setDecisionDraft = (requestId, patch) => {
    setDecisionDrafts((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] || {}),
        ...patch,
      },
    }));
  };

  const resolveDraft = (request) => {
    const current = decisionDrafts[request.id] || {};
    const defaultAmount = Number(request.amount_requested || 0);
    return {
      amount: current.amount ?? (defaultAmount > 0 ? String(defaultAmount) : ''),
      note: current.note ?? '',
    };
  };

  const runAction = async (request, action) => {
    if (!request?.id) return;

    const draft = resolveDraft(request);
    const requestedAmount = Number(request.amount_requested || 0);
    const typedAmount = toPositiveNumber(draft.amount);
    const approvedAmount = action === 'approve'
      ? (typedAmount || requestedAmount)
      : action === 'partial'
        ? typedAmount
        : 0;

    if ((action === 'approve' || action === 'partial') && approvedAmount <= 0) {
      toast.error('Enter a positive approved amount before continuing.');
      return;
    }

    setActionBusy(`${request.id}:${action}`);
    try {
      await reviewCreditRequest({
        credit_request_id: request.id,
        action,
        amount_approved: action === 'deny' ? undefined : approvedAmount,
        admin_note: draft.note.trim() || undefined,
      });
      toast.success(
        action === 'deny'
          ? 'Request denied.'
          : action === 'partial'
            ? 'Partial approval saved.'
            : 'Request approved.',
      );
      await refreshRequests();
    } catch (error) {
      toast.error(error?.message || 'Could not apply this request action.');
    } finally {
      setActionBusy('');
    }
  };

  return (
    <section className="org-page">
      <div className="org-page-header">
        <div>
          <h1>Credit Management</h1>
          <p>Track the organization credit pool and resolve member credit requests.</p>
        </div>
      </div>

      <div className="org-stat-grid">
        <div className="org-stat-card">
          <span className="org-stat-title">Monthly Pool</span>
          <strong className="org-stat-value">{organizationCreditPool}</strong>
          <span className="org-stat-subtitle">{organization?.name || 'Organization'}</span>
        </div>
        <div className="org-stat-card">
          <span className="org-stat-title">Used</span>
          <strong className="org-stat-value">{organizationCreditsUsed}</strong>
          <span className="org-stat-subtitle">Current billing period</span>
        </div>
        <div className="org-stat-card">
          <span className="org-stat-title">Pending Requests</span>
          <strong className="org-stat-value">{pendingCount}</strong>
          <span className="org-stat-subtitle">Awaiting review</span>
        </div>
      </div>

      {loadingRequests ? (
        <div className="org-panel-loading">Loading credit requests...</div>
      ) : requests.length === 0 ? (
        <OrgEmptyState
          eyebrow="Credits"
          title="No credit requests yet"
          description="Requests for additional credits will appear here for review."
        />
      ) : (
        <div className="org-table-wrap">
          <table className="org-table">
            <thead>
              <tr>
                <th>Requested By</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Reviewed By</th>
                <th>Created</th>
                <th>Reviewed</th>
                <th>Admin Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const draft = resolveDraft(request);
                const pending = request.status === 'pending';
                const approveBusy = actionBusy === `${request.id}:approve`;
                const partialBusy = actionBusy === `${request.id}:partial`;
                const denyBusy = actionBusy === `${request.id}:deny`;
                return (
                  <tr key={request.id}>
                    <td>{request.requested_by_label || request.requested_by}</td>
                    <td>
                      <strong>{request.amount_requested}</strong>
                      {request.amount_approved ? <div>Approved: {request.amount_approved}</div> : null}
                    </td>
                    <td>{request.status}</td>
                    <td>{request.reason || '—'}</td>
                    <td>{request.reviewed_by_label || '—'}</td>
                    <td>{formatDateTime(request.created_at)}</td>
                    <td>{formatDateTime(request.reviewed_at)}</td>
                    <td>
                      {pending ? (
                        <div className="org-credit-grid">
                          <input
                            type="number"
                            min="1"
                            value={draft.amount}
                            onChange={(event) => setDecisionDraft(request.id, { amount: event.target.value })}
                            placeholder="Approved amount"
                          />
                          <input
                            type="text"
                            value={draft.note}
                            onChange={(event) => setDecisionDraft(request.id, { note: event.target.value })}
                            placeholder="Optional admin note"
                          />
                          <div className="org-credit-tags">
                            <button type="button" className="org-primary-button" disabled={Boolean(actionBusy)} onClick={() => void runAction(request, 'approve')}>
                              {approveBusy ? 'Saving...' : 'Approve'}
                            </button>
                            <button type="button" className="org-secondary-button" disabled={Boolean(actionBusy)} onClick={() => void runAction(request, 'partial')}>
                              {partialBusy ? 'Saving...' : 'Partial'}
                            </button>
                            <button type="button" className="org-secondary-button danger" disabled={Boolean(actionBusy)} onClick={() => void runAction(request, 'deny')}>
                              {denyBusy ? 'Saving...' : 'Deny'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span>{request.admin_note || '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
