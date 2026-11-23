import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { formatCurrency } from '../lib/api';

export const StatusLabel: React.FC<{ status: string; labelOverride?: string }> = ({ status, labelOverride }) => {
  const normalized = (status || '').toLowerCase();
  let colorClass = 'text-slate-600';
  let Icon = Clock;

  if (
    [
      'completed',
      'approved',
      'passed',
      'ahead of schedule',
      'on schedule',
      'present',
      'operational',
      'delivered',
      'verified',
    ].includes(normalized)
  ) {
    colorClass = 'text-emerald-700';
    Icon = CheckCircle2;
  } else if (
    [
      'at risk',
      'pending',
      'pending_review',
      'submitted',
      'resubmitted',
      'under_review',
      'under review',
      'for_review',
      'for review',
      'in_progress',
      'in progress',
      'partially_approved',
      'partially approved',
      'partially_delivered',
      'partially delivered',
      'maintenance',
      'provisional',
      'under_technical_review',
      'under_cost_evaluation',
      'awaiting_management_approval',
      'awaiting_verification',
      'reinspection',
      'additional_photos_requested',
    ].includes(normalized)
  ) {
    colorClass = 'text-amber-700';
    Icon = AlertTriangle;
  } else if (
    [
      'delayed',
      'behind schedule',
      'overdue',
      'rejected',
      'failed',
      'absent',
      'cancelled',
      'repair',
      'returned',
      'for_correction',
      'correction_needed',
      'returned_for_correction',
    ].includes(normalized)
  ) {
    colorClass = 'text-red-700';
    Icon = AlertCircle;
  }

  const labelMap: Record<string, string> = {
    pending_review: 'Pending Review',
    for_correction: 'For Correction',
    correction_needed: 'For Correction',
    returned_for_correction: 'Returned for Correction',
    partially_approved: 'Partially Approved',
    partially_delivered: 'Partially Delivered',
    for_review: 'For Review',
    additional_photos_requested: 'More Photos Requested',
  };

  const label =
    labelOverride ||
    labelMap[normalized] ||
    status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${colorClass}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
};

export const CircularProgressRing: React.FC<{
  percentage: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  accentColor?: string;
}> = ({ percentage, size = 128, strokeWidth = 10, label = 'Complete', accentColor = '#D97706' }) => {
  const clamped = Math.max(0, Math.min(100, Number(percentage || 0)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={clamped >= 100 ? '#16A34A' : accentColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-mono text-xl font-semibold text-slate-900 tabular-nums">
          {clamped.toFixed(0)}%
        </span>
        <span className="text-[11px] font-medium text-slate-500">{label}</span>
      </div>
    </div>
  );
};

export const HorizontalComparisonChart: React.FC<{
  items: Array<{
    label: string;
    primaryValue: number;
    secondaryValue: number;
    tertiaryValue?: number;
  }>;
  primaryLabel: string;
  secondaryLabel: string;
  tertiaryLabel?: string;
  formatAs?: 'percent' | 'currency';
}> = ({ items, primaryLabel, secondaryLabel, tertiaryLabel, formatAs = 'percent' }) => {
  if (items.length === 0) {
    return <p className="py-8 text-center text-xs text-slate-500">No data available for comparison.</p>;
  }

  const maxVal =
    formatAs === 'percent'
      ? 100
      : Math.max(
          1,
          ...items.flatMap((i) => [i.primaryValue, i.secondaryValue + (i.tertiaryValue || 0)])
        );

  const fmt = (v: number) => (formatAs === 'percent' ? `${v.toFixed(1)}%` : formatCurrency(v));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-800" />
          {primaryLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-600" />
          {secondaryLabel}
        </span>
        {tertiaryLabel && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />
            {tertiaryLabel}
          </span>
        )}
      </div>
      <div className="space-y-3">
        {items.map((item) => {
          const pWidth = Math.min(100, (item.primaryValue / maxVal) * 100);
          const sWidth = Math.min(100, (item.secondaryValue / maxVal) * 100);
          const tWidth = item.tertiaryValue ? Math.min(100 - sWidth, (item.tertiaryValue / maxVal) * 100) : 0;
          return (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-800 truncate">{item.label}</span>
                <span className="font-mono text-slate-600 tabular-nums shrink-0">
                  {fmt(item.primaryValue)} / {fmt(item.secondaryValue)}
                  {item.tertiaryValue ? ` (+${fmt(item.tertiaryValue)} comm.)` : ''}
                </span>
              </div>
              <div className="space-y-1">
                <div className="h-2 w-full rounded bg-slate-100 overflow-hidden">
                  <div className="h-full bg-slate-800 rounded" style={{ width: `${pWidth}%` }} />
                </div>
                <div className="h-2 w-full rounded bg-slate-100 overflow-hidden flex">
                  <div className="h-full bg-amber-600" style={{ width: `${sWidth}%` }} />
                  {tWidth > 0 && <div className="h-full bg-slate-400" style={{ width: `${tWidth}%` }} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const SimpleBarChart: React.FC<{
  data: Array<{ label: string; value: number }>;
  formatAs?: 'currency' | 'count';
  barColor?: string;
}> = ({ data, formatAs = 'currency', barColor = '#0F172A' }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  if (data.length === 0) {
    return <p className="py-10 text-center text-xs text-slate-500">No records recorded yet.</p>;
  }

  const maxVal = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="w-full">
      <div className="flex h-44 items-end gap-2 border-b border-slate-200 pb-2 pt-4">
        {data.map((d, idx) => {
          const pct = Math.max(4, Math.round((d.value / maxVal) * 100));
          const displayVal = formatAs === 'currency' ? formatCurrency(d.value) : String(d.value);
          return (
            <div
              key={d.label}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(null)}
              className="group relative flex flex-1 flex-col items-center justify-end h-full min-w-[32px]"
            >
              {hovered === idx && (
                <div className="absolute -top-6 z-10 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-white shadow">
                  {displayVal}
                </div>
              )}
              <div
                className="w-full max-w-[38px] rounded-t transition-opacity group-hover:opacity-85"
                style={{ height: `${pct}%`, backgroundColor: barColor }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        {data.map((d) => (
          <div key={d.label} className="flex-1 truncate text-center text-[11px] text-slate-500 font-mono">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
};

export const BreakdownBarList: React.FC<{
  data: Array<{ label: string; value: number }>;
  formatAs?: 'currency' | 'count';
}> = ({ data, formatAs = 'currency' }) => {
  if (data.length === 0) {
    return <p className="py-8 text-center text-xs text-slate-500">No breakdown data available.</p>;
  }
  const total = Math.max(1, data.reduce((s, d) => s + d.value, 0));
  const colors = ['#0F172A', '#D97706', '#0284C7', '#16A34A', '#64748B', '#DC2626', '#7C3AED'];

  return (
    <div className="space-y-3">
      {data.map((d, idx) => {
        const pct = (d.value / total) * 100;
        return (
          <div key={d.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 truncate">{d.label}</span>
              <span className="font-mono text-slate-600 tabular-nums shrink-0">
                {formatAs === 'currency' ? formatCurrency(d.value) : d.value} · {pct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 w-full rounded bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${Math.max(2, pct)}%`, backgroundColor: colors[idx % colors.length] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const DonutChart: React.FC<{
  segments: Array<{ label: string; value: number; color: string }>;
  centerValue: string;
  centerLabel: string;
  centerSublabel?: string;
  size?: number;
  strokeWidth?: number;
}> = ({ segments, centerValue, centerLabel, centerSublabel, size = 168, strokeWidth = 24 }) => {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const nonZero = segments.filter((s) => s.value > 0);
  const gapPx = nonZero.length > 1 ? 3 : 0;

  let accumulated = 0;

  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
        />
        {total > 0 &&
          nonZero.map((seg) => {
            const segLen = (seg.value / total) * circumference;
            const visibleLen = Math.max(1, segLen - gapPx);
            const dashOffset = -accumulated;
            accumulated += segLen;
            return (
              <circle
                key={seg.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${visibleLen} ${circumference}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="butt"
              />
            );
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
        <span className="font-display text-lg font-bold text-slate-900 tabular-nums leading-tight">
          {centerValue}
        </span>
        <span className="text-[11px] font-medium text-slate-500 mt-0.5 leading-tight">{centerLabel}</span>
        {centerSublabel && (
          <span className="text-[10px] font-mono text-slate-500 tabular-nums mt-0.5">{centerSublabel}</span>
        )}
      </div>
    </div>
  );
};

