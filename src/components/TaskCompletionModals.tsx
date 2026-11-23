import React, { useEffect, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ClipboardCheck,
  History,
  Lock,
  MessageSquare,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import { StatusLabel } from './Charts';
import {
  EvidenceFilePicker,
  PendingAttachmentDraft,
  ProtectedAttachmentGallery,
  ProtectedAttachmentRecord,
} from './ProtectedAttachmentGallery';

export function formatTaskStatusLabel(task: { status: string; completion_status?: string }): string {
  if (task.status === 'completed' || task.completion_status === 'verified') {
    return 'Completed — Verified';
  }
  if (task.status === 'for_review') {
    if (task.completion_status === 'additional_photos_requested') {
      return 'Awaiting Verification (More Photos Requested)';
    }
    return 'Completed — Awaiting Verification';
  }
  return task.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const TaskCompletionSubmitModal: React.FC<{
  task: any;
  onClose: () => void;
  onSubmitted: () => void;
}> = ({ task, onClose, onSubmitted }) => {
  const [completionDate, setCompletionDate] = useState(
    task?.completion_date || new Date().toISOString().slice(0, 10)
  );
  const [completionRemarks, setCompletionRemarks] = useState(task?.completion_remarks || '');
  const [photos, setPhotos] = useState<PendingAttachmentDraft[]>([]);
  const [docs, setDocs] = useState<PendingAttachmentDraft[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<ProtectedAttachmentRecord[]>(
    task?.attachments || []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/tasks/${task.id}/details`)
      .then((res) => {
        if (res.task?.attachments) setExistingAttachments(res.task.attachments);
      })
      .catch(() => {});
  }, [task.id]);

  const existingPhotoCount = existingAttachments.filter(
    (a) => a.entity_type === 'task_completion_photo'
  ).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!completionRemarks.trim()) {
      setError('Please describe the work completed before submitting.');
      return;
    }
    if (photos.length === 0 && existingPhotoCount === 0) {
      setError('At least one completion photograph is mandatory before marking this task completed.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest(`/api/tasks/${task.id}/submit-completion`, {
        method: 'POST',
        body: {
          completionDate,
          completionRemarks: completionRemarks.trim(),
          photosBase64: photos.map((p) => ({
            dataUrl: p.dataUrl,
            fileName: p.fileName,
            caption: p.caption || completionRemarks.trim().slice(0, 140),
          })),
          docsBase64: docs.map((d) => ({
            dataUrl: d.dataUrl,
            fileName: d.fileName,
            caption: d.caption,
          })),
        },
      });
      onSubmitted();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Unable to submit task completion');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="font-mono text-xs text-slate-500">
              {task.ref_number} · {task.project_name || 'Project Task'}
            </div>
            <h2 className="mt-0.5 font-display text-base font-bold text-slate-900">
              Submit Task Completion &amp; Photographic Proof
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
            <div className="font-semibold text-slate-900">{task.title}</div>
            {task.description && <p className="text-slate-600 whitespace-pre-line">{task.description}</p>}
            <div className="text-[11px] text-slate-500 pt-1">
              Assigned: <strong className="text-slate-700">{task.assigned_to_name || 'Unassigned'}</strong> · Deadline:{' '}
              <span className="font-mono">{task.deadline}</span>
            </div>
          </div>

          {task.verification_remarks && ['returned', 'additional_photos_requested'].includes(task.completion_status) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-amber-950">
              <strong>Supervisor Feedback:</strong> {task.verification_remarks}
            </div>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-red-700">{error}</div>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Actual Completion Date *</label>
              <input
                type="date"
                required
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
              />
            </div>
            <div className="flex items-end">
              <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
                Submitting moves task to <strong>Completed — Awaiting Verification</strong> until verified by a supervisor.
              </div>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Actual Completion Remarks *</label>
            <textarea
              required
              rows={3}
              value={completionRemarks}
              onChange={(e) => setCompletionRemarks(e.target.value)}
              placeholder="Summarize installed work, location, measurements, and field conditions..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>

          {existingPhotoCount > 0 && (
            <div className="space-y-1.5">
              <div className="font-medium text-slate-700">Previously Attached Proof ({existingPhotoCount})</div>
              <ProtectedAttachmentGallery attachments={existingAttachments} compact emptyText="" />
            </div>
          )}

          <EvidenceFilePicker
            label="Completion Photo Proofs"
            helperText="Required: Take a live site photo or upload clear before/after photographs (multiple photos allowed)."
            items={photos}
            onChange={setPhotos}
            imagesOnly
            maxFiles={10}
            defaultCategory="Completion Photo Proof"
            requiredMark={existingPhotoCount === 0}
          />

          <EvidenceFilePicker
            label="Supporting Documents (Optional)"
            helperText="Attach test reports, checklists, or inspection certificates if applicable."
            items={docs}
            onChange={setDocs}
            maxFiles={5}
            defaultCategory="Supporting Document"
          />

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Camera className="h-3.5 w-3.5" />
              {submitting ? 'Submitting Proof...' : 'Submit for Verification'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const TaskVerificationModal: React.FC<{
  taskId: number;
  onClose: () => void;
  onUpdated: () => void;
  onOpenResubmit?: (task: any) => void;
}> = ({ taskId, onClose, onUpdated, onOpenResubmit }) => {
  const { hasPerm } = useAuth();
  const [task, setTask] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Verification actions
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Authorized amendment panel
  const [showAmend, setShowAmend] = useState(false);
  const [amendNote, setAmendNote] = useState('');
  const [amendPhotos, setAmendPhotos] = useState<PendingAttachmentDraft[]>([]);
  const [amendDocs, setAmendDocs] = useState<PendingAttachmentDraft[]>([]);
  const [submittingAmend, setSubmittingAmend] = useState(false);

  // Comments
  const [commentText, setCommentText] = useState('');

  const loadDetails = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest(`/api/tasks/${taskId}/details`);
      setTask(res.task);
      setHistory(res.history || []);
      setComments(res.comments || []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load task verification details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetails();
  }, [taskId]);

  const canVerify = hasPerm('tasks', 'verify') || hasPerm('tasks', 'approve');
  const canAmend = hasPerm('tasks', 'amend_evidence') || canVerify;

  const attachments: ProtectedAttachmentRecord[] = task?.attachments || [];
  const photos = attachments.filter((a) => a.entity_type === 'task_completion_photo');
  const docs = attachments.filter((a) => a.entity_type === 'task_completion_doc');

  const handleVerifyDecision = async (
    decision: 'approve' | 'return_for_correction' | 'request_photos' | 'reject'
  ) => {
    setError('');
    setNotice('');
    if (decision !== 'approve' && !remarks.trim()) {
      setError('Please provide clear feedback or instructions before returning or requesting additional photos.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/api/tasks/${taskId}/verify`, {
        method: 'POST',
        body: { decision, remarks: remarks.trim() },
      });
      setRemarks('');
      setNotice(
        decision === 'approve'
          ? 'Task verified and marked Completed — Verified. Completion evidence is now locked.'
          : 'Verification feedback sent to the assigned team.'
      );
      await loadDetails();
      onUpdated();
    } catch (err: any) {
      setError(err?.message || 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAmendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!amendNote.trim()) {
      setError('Amendment reason is required.');
      return;
    }
    setSubmittingAmend(true);
    try {
      await apiRequest(`/api/tasks/${taskId}/amend-evidence`, {
        method: 'POST',
        body: {
          amendmentNote: amendNote.trim(),
          photosBase64: amendPhotos.map((p) => ({
            dataUrl: p.dataUrl,
            fileName: p.fileName,
            caption: p.caption,
          })),
          docsBase64: amendDocs.map((d) => ({
            dataUrl: d.dataUrl,
            fileName: d.fileName,
            caption: d.caption,
          })),
        },
      });
      setAmendNote('');
      setAmendPhotos([]);
      setAmendDocs([]);
      setShowAmend(false);
      setNotice('Supplemental/amended evidence locked and logged.');
      await loadDetails();
      onUpdated();
    } catch (err: any) {
      setError(err?.message || 'Unable to amend evidence');
    } finally {
      setSubmittingAmend(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    await apiRequest(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: { commentText: commentText.trim() },
    });
    setCommentText('');
    loadDetails();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-semibold text-slate-800">{task?.ref_number || `TSK-${taskId}`}</span>
              {task?.project_name && (
                <>
                  <span>·</span>
                  <span>{task.project_name}</span>
                </>
              )}
              {task && (
                <>
                  <span>·</span>
                  <StatusLabel status={task.status} labelOverride={formatTaskStatusLabel(task)} />
                </>
              )}
            </div>
            <h2 className="mt-0.5 font-display text-base font-bold text-slate-900">
              {task?.title || 'Task Completion Proof & Verification'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {loading ? (
            <div className="py-12 text-center text-slate-500">Loading completion evidence and history...</div>
          ) : (
            <>
              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-red-700">{error}</div>}
              {notice && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-emerald-700">
                  {notice}
                </div>
              )}

              {task && (
                <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <div className="text-[11px] text-slate-500">Task Instructions</div>
                    <div className="mt-0.5 text-slate-800 whitespace-pre-line">{task.description || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Assigned Personnel</div>
                    <div className="mt-0.5 font-medium text-slate-900">{task.assigned_to_name || 'Unassigned'}</div>
                    <div className="text-[11px] text-slate-500">Priority: {task.priority}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Deadline &amp; Completion Date</div>
                    <div className="mt-0.5 font-mono text-slate-900">Due: {task.deadline}</div>
                    {task.completion_date && (
                      <div className="font-mono text-emerald-700">Done: {task.completion_date}</div>
                    )}
                  </div>
                  {task.completion_remarks && (
                    <div className="sm:col-span-4 border-t border-slate-200 pt-2.5">
                      <span className="text-[11px] font-semibold text-slate-700">Submitted Completion Remarks:</span>{' '}
                      <span className="text-slate-800">{task.completion_remarks}</span>
                      {task.submitted_for_review_by_name && (
                        <span className="ml-2 text-[11px] text-slate-500">
                          (Submitted by {task.submitted_for_review_by_name})
                        </span>
                      )}
                    </div>
                  )}
                  {task.verification_remarks && (
                    <div className="sm:col-span-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800">
                      <strong>Supervisor Verification Notes:</strong> {task.verification_remarks}
                      {task.verified_by_name ? ` · Verified by ${task.verified_by_name}` : ''}
                    </div>
                  )}
                </div>
              )}

              {/* Completion Photo Gallery */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <ClipboardCheck className="h-4 w-4 text-amber-600" />
                    Completion Photographic Evidence ({photos.length})
                  </h3>
                  <div className="flex items-center gap-2">
                    {task?.evidence_locked === 1 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                        <Lock className="h-3.5 w-3.5" /> Evidence Locked
                      </span>
                    )}
                    {task?.status !== 'completed' && onOpenResubmit && hasPerm('tasks', 'edit') && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenResubmit(task);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
                      >
                        Upload / Update Completion Proof
                      </button>
                    )}
                  </div>
                </div>
                <ProtectedAttachmentGallery
                  attachments={photos}
                  canDelete={task?.status !== 'completed' && task?.evidence_locked !== 1 && hasPerm('tasks', 'edit')}
                  onDeleted={() => {
                    loadDetails();
                    onUpdated();
                  }}
                  emptyText="No completion photographs attached yet."
                />

                {docs.length > 0 && (
                  <div className="pt-2 space-y-1.5">
                    <div className="font-semibold text-slate-700">Supporting Documents ({docs.length})</div>
                    <ProtectedAttachmentGallery
                      attachments={docs}
                      canDelete={task?.status !== 'completed' && task?.evidence_locked !== 1 && hasPerm('tasks', 'edit')}
                      onDeleted={() => {
                        loadDetails();
                        onUpdated();
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Supervisor Verification Interface */}
              {task && task.status !== 'completed' && canVerify && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-700" />
                    Supervisor Completion Verification
                  </h3>
                  <textarea
                    rows={2}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Enter verification remarks, inspection notes, or required corrective action instructions..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={submitting || photos.length === 0}
                      onClick={() => handleVerifyDecision('approve')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verify &amp; Mark Completed
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleVerifyDecision('request_photos')}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap"
                    >
                      Request Additional Photos
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleVerifyDecision('return_for_correction')}
                      className="rounded-lg border border-red-300 bg-white px-3.5 py-2 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      Return for Correction
                    </button>
                  </div>
                </div>
              )}

              {/* Authorized Evidence Amendment Panel */}
              {task?.status === 'completed' && canAmend && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">Authorized Evidence Amendment</div>
                      <div className="text-[11px] text-slate-500">
                        Verified completion photos are locked. Authorized supervisors may append supplemental proof with
                        an audit reason.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAmend((v) => !v)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                    >
                      {showAmend ? 'Hide Amendment' : 'Amend / Add Proof'}
                    </button>
                  </div>

                  {showAmend && (
                    <form onSubmit={handleAmendSubmit} className="space-y-3 border-t border-slate-200 pt-3">
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Amendment Reason *</label>
                        <input
                          required
                          value={amendNote}
                          onChange={(e) => setAmendNote(e.target.value)}
                          placeholder="Reason for appending additional verification photos/docs..."
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5"
                        />
                      </div>
                      <EvidenceFilePicker
                        label="Amended / Supplemental Photos"
                        items={amendPhotos}
                        onChange={setAmendPhotos}
                        imagesOnly
                        defaultCategory="Amended Photo Proof"
                      />
                      <EvidenceFilePicker
                        label="Amended Supporting Documents"
                        items={amendDocs}
                        onChange={setAmendDocs}
                        defaultCategory="Amended Document"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={submittingAmend}
                          className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {submittingAmend ? 'Saving...' : 'Save Authorized Amendment'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* Completion History & Task Comments */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <History className="h-4 w-4 text-slate-500" />
                    Completion &amp; Verification History ({history.length})
                  </h3>
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white max-h-60 overflow-y-auto">
                    {history.length === 0 ? (
                      <div className="px-4 py-4 text-center text-slate-500">No verification events logged yet.</div>
                    ) : (
                      history.map((h) => (
                        <div key={h.id} className="px-3.5 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">
                              {String(h.action || '').replace(/_/g, ' ')}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">
                              {h.created_at ? new Date(h.created_at).toLocaleString() : ''}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {h.actor_name || 'System'} {h.actor_role ? `(${h.actor_role})` : ''} · {h.previous_status} →{' '}
                            {h.new_status}
                          </div>
                          {h.remarks && <div className="mt-1 text-slate-700">{h.remarks}</div>}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4 text-slate-500" />
                    Field &amp; Review Comments ({comments.length})
                  </h3>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-100">
                      {comments.length === 0 ? (
                        <div className="py-3 text-center text-slate-500">No comments yet.</div>
                      ) : (
                        comments.map((c) => (
                          <div key={c.id} className="py-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-slate-800">{c.author_name}</span>
                              <span className="font-mono text-slate-400">
                                {c.created_at ? new Date(c.created_at).toLocaleString() : ''}
                              </span>
                            </div>
                            <div className="text-slate-700 mt-0.5">{c.comment_text}</div>
                          </div>
                        ))
                      )}
                    </div>
                    {hasPerm('tasks', 'edit') && (
                      <form onSubmit={handleAddComment} className="flex gap-2 border-t border-slate-100 pt-2">
                        <input
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder="Add task comment..."
                          className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                        />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1 font-medium text-white hover:bg-slate-800"
                        >
                          <Send className="h-3 w-3" /> Send
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
