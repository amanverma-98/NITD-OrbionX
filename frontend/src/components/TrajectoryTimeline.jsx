import { useEffect, useMemo, useState } from 'react';

export default function TrajectoryTimeline({
  points = [],
  selectedIndex = 0,
  onChangeIndex,
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  const maxIndex = Math.max(0, points.length - 1);
  const safeIndex = Math.max(0, Math.min(selectedIndex, maxIndex));
  const selectedPoint = points[safeIndex] || null;

  const localLabel = useMemo(() => {
    if (!selectedPoint?.timestamp) return '—';
    const parsed = new Date(selectedPoint.timestamp);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
  }, [selectedPoint]);

  useEffect(() => {
    if (!isPlaying || maxIndex === 0) return undefined;

    const timer = setInterval(() => {
      onChangeIndex((prev) => {
        const next = prev + 1;
        return next > maxIndex ? 0 : next;
      });
    }, 550);

    return () => clearInterval(timer);
  }, [isPlaying, maxIndex, onChangeIndex]);

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2.5 space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400 uppercase tracking-wide">Trajectory Time</span>
        <button
          type="button"
          onClick={() => setIsPlaying((prev) => !prev)}
          className="px-2 py-1 rounded border border-slate-600 text-cyan-300 hover:border-cyan-400 transition"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={maxIndex}
        value={safeIndex}
        onChange={(e) => onChangeIndex(Number(e.target.value))}
        className="w-full h-2 accent-cyan-500"
      />

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded bg-slate-950/50 p-2">
          <div className="text-slate-500 uppercase">Index</div>
          <div className="text-cyan-300 font-mono">{safeIndex}/{maxIndex}</div>
        </div>
        <div className="rounded bg-slate-950/50 p-2">
          <div className="text-slate-500 uppercase">Offset</div>
          <div className="text-emerald-300 font-mono">T+{selectedPoint?.time_offset_minutes ?? (safeIndex * 10)}m</div>
        </div>
      </div>

      <div className="text-[11px] text-slate-300 rounded bg-slate-950/50 p-2 leading-snug">
        <div className="text-cyan-300">{localLabel}</div>
      </div>
    </div>
  );
}
