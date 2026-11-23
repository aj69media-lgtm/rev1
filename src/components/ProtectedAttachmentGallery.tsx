import React, { useEffect, useState } from 'react';
import {
  Camera,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Lock,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { apiRequest, getApiToken } from '../lib/api';

export interface ProtectedAttachmentRecord {
  id: number;
  entity_type: string;
  entity_id: number;
  project_id?: number | null;
  category?: string;
  caption?: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  is_locked: number;
  is_amended?: number;
  amendment_note?: string;
  uploaded_by?: number | null;
  uploaded_by_name?: string;
  created_at?: string;
  is_image?: boolean;
}

export interface PendingAttachmentDraft {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  dataUrl: string;
  caption: string;
  category: string;
  isImage: boolean;
}

export async function readAndCompressFileToBase64(
  file: File,
  defaultCategory = 'Evidence'
): Promise<PendingAttachmentDraft> {
  const isImg = file.type.startsWith('image/');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      if (!isImg) {
        resolve(raw);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const maxDim = 1400;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(raw);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.onerror = () => reject(new Error(`Unable to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: file.name || `photo-${Date.now()}.jpg`,
    mimeType: isImg ? 'image/jpeg' : file.type || 'application/octet-stream',
    fileSize: file.size,
    dataUrl,
    caption: '',
    category: defaultCategory,
    isImage: isImg,
  };
}

export async function downloadProtectedAttachment(att: Pick<ProtectedAttachmentRecord, 'id' | 'file_name'>): Promise<void> {
  const token = getApiToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/api/attachments/${att.id}/file?download=1`, { headers });
  if (!res.ok) {
    throw new Error(`Unable to download ${att.file_name} (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = att.file_name || `attachment-${att.id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const ProtectedImage: React.FC<{
  attachmentId: number;
  alt: string;
  className?: string;
}> = ({ attachmentId, alt, className = 'h-24 w-32 object-cover' }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    const token = getApiToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    setFailed(false);
    fetch(`/api/attachments/${attachmentId}/file`, { headers })
      .then((res) => {
        if (!res.ok) throw new Error('Image fetch failed');
        return res.blob();
      })
      .then((blob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachmentId]);

  if (failed) {
    return (
      <div className={`flex flex-col items-center justify-center bg-slate-100 text-slate-400 p-2 ${className}`}>
        <ImageIcon className="h-5 w-5" />
        <span className="mt-1 text-[10px] truncate max-w-full">{alt}</span>
      </div>
    );
  }

  if (!blobUrl) {
    return <div className={`animate-pulse bg-slate-100 ${className}`} />;
  }

  return <img src={blobUrl} alt={alt} className={className} referrerPolicy="no-referrer" />;
};

export const ProtectedAttachmentGallery: React.FC<{
  attachments: ProtectedAttachmentRecord[];
  canDelete?: boolean;
  onDeleted?: () => void;
  emptyText?: string;
  compact?: boolean;
}> = ({
  attachments,
  canDelete = false,
  onDeleted,
  emptyText = 'No attachments uploaded.',
  compact = false,
}) => {
  const [lightboxAtt, setLightboxAtt] = useState<ProtectedAttachmentRecord | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [errMsg, setErrMsg] = useState('');

  if (!attachments || attachments.length === 0) {
    return <div className="text-xs text-slate-500">{emptyText}</div>;
  }

  const images = attachments.filter((a) => a.is_image || String(a.mime_type || '').startsWith('image/'));
  const docs = attachments.filter((a) => !(a.is_image || String(a.mime_type || '').startsWith('image/')));

  const handleDelete = async (att: ProtectedAttachmentRecord) => {
    setErrMsg('');
    setDeletingId(att.id);
    try {
      await apiRequest(`/api/attachments/${att.id}`, { method: 'DELETE' });
      onDeleted?.();
    } catch (err: any) {
      setErrMsg(err?.message || 'Unable to delete attachment');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-2.5">
      {errMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {errMsg}
        </div>
      )}

      {images.length > 0 && (
        <div className={`grid gap-2.5 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {images.map((att) => (
            <div
              key={att.id}
              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white text-xs"
            >
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setLightboxAtt(att);
                }}
                className="relative block w-full text-left"
                title="Click to enlarge"
              >
                <ProtectedImage
                  attachmentId={att.id}
                  alt={att.caption || att.file_name}
                  className={`${compact ? 'h-20' : 'h-28'} w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]`}
                />
                <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] text-white">
                  <Eye className="h-3 w-3" />
                  View
                </div>
              </button>
              <div className="border-t border-slate-100 p-2 space-y-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="truncate font-medium text-slate-800" title={att.file_name}>
                    {att.caption || att.file_name}
                  </span>
                  {att.is_locked === 1 && (
                    <span title="Locked evidence" className="text-emerald-700 shrink-0">
                      <Lock className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span className="truncate">
                    {att.category || 'Photo'}
                    {att.is_amended ? ' · Amended' : ''}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => downloadProtectedAttachment(att)}
                      className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      title="Download"
                    >
                      <Download className="h-3 w-3" />
                    </button>
                    {canDelete && att.is_locked !== 1 && (
                      <button
                        type="button"
                        disabled={deletingId === att.id}
                        onClick={() => handleDelete(att)}
                        className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        title="Remove attachment"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs">
          {docs.map((att) => (
            <div key={att.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">{att.file_name}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {att.category || 'Document'} · {(Number(att.file_size || 0) / 1024).toFixed(1)} KB
                    {att.is_locked === 1 ? ' · Locked' : ''}
                    {att.is_amended ? ` · Amended (${att.amendment_note || 'Authorized'})` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => downloadProtectedAttachment(att)}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="h-3 w-3" />
                  Download
                </button>
                {canDelete && att.is_locked !== 1 && (
                  <button
                    type="button"
                    disabled={deletingId === att.id}
                    onClick={() => handleDelete(att)}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    title="Delete document"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightboxAtt && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4"
          onClick={() => setLightboxAtt(null)}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3 text-xs">
              <div className="min-w-0">
                <div className="font-semibold truncate">{lightboxAtt.caption || lightboxAtt.file_name}</div>
                <div className="text-[11px] text-slate-400 truncate">
                  {lightboxAtt.file_name} · Uploaded by {lightboxAtt.uploaded_by_name || 'Staff'}
                  {lightboxAtt.is_locked === 1 ? ' · Immutable Locked Evidence' : ''}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="font-mono text-[11px] px-1.5 tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => downloadProtectedAttachment(lightboxAtt)}
                  className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 hover:bg-slate-800 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxAtt(null)}
                  className="rounded border border-slate-700 p-1 hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center bg-slate-950 p-4">
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }} className="transition-transform">
                <ProtectedImage
                  attachmentId={lightboxAtt.id}
                  alt={lightboxAtt.file_name}
                  className="max-h-[74vh] max-w-full rounded object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const EvidenceFilePicker: React.FC<{
  label: string;
  helperText?: string;
  items: PendingAttachmentDraft[];
  onChange: (next: PendingAttachmentDraft[]) => void;
  imagesOnly?: boolean;
  maxFiles?: number;
  defaultCategory?: string;
  requiredMark?: boolean;
}> = ({
  label,
  helperText,
  items,
  onChange,
  imagesOnly = false,
  maxFiles = 10,
  defaultCategory = 'Evidence',
  requiredMark = false,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError('');
    setBusy(true);
    try {
      const remaining = Math.max(0, maxFiles - items.length);
      const selected = Array.from(fileList).slice(0, remaining);
      const converted = await Promise.all(selected.map((f) => readAndCompressFileToBase64(f, defaultCategory)));
      onChange([...items, ...converted].slice(0, maxFiles));
    } catch (err: any) {
      setError(err?.message || 'Unable to process selected files');
    } finally {
      setBusy(false);
    }
  };

  const acceptAttr = imagesOnly
    ? 'image/jpeg,image/png,image/webp'
    : 'image/jpeg,image/png,image/webp,application/pdf,.xlsx,.xls,.csv,.docx';

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-slate-800">
          {label} {requiredMark && <span className="text-red-600">*</span>}{' '}
          <span className="font-mono text-[11px] text-slate-500">
            ({items.length}/{maxFiles})
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap">
            <Camera className="h-3.5 w-3.5 text-amber-600" />
            <span>{busy ? 'Reading...' : 'Take Photo'}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap">
            <Upload className="h-3.5 w-3.5 text-slate-600" />
            <span>{imagesOnly ? 'Upload Photos' : 'Upload Files'}</span>
            <input
              type="file"
              accept={acceptAttr}
              multiple
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {helperText && <p className="text-[11px] text-slate-500">{helperText}</p>}
      {error && <p className="text-[11px] text-red-600">{error}</p>}

      {items.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 rounded-md border border-slate-200 bg-white p-2"
            >
              {item.isImage ? (
                <img
                  src={item.dataUrl}
                  alt={item.fileName}
                  className="h-11 w-14 shrink-0 rounded border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-11 w-14 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-500">
                  <FileText className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="truncate font-medium text-slate-800">{item.fileName}</div>
                <input
                  value={item.caption}
                  onChange={(e) =>
                    onChange(items.map((it) => (it.id === item.id ? { ...it, caption: e.target.value } : it)))
                  }
                  placeholder="Optional caption / receipt reference note..."
                  className="w-full rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700"
                />
              </div>
              <button
                type="button"
                onClick={() => onChange(items.filter((it) => it.id !== item.id))}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0"
                title="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
