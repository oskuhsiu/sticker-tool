/**
 * 手動排版：切好的影格逐格拖曳對位 → 播放測試 → 打包。
 * 自動對齊（grid + 場景精修）不理想時的人工出口：
 *   - 編輯畫布以 onion-skin 顯示「其他格的殘影」，拖曳目前格或方向鍵微調（Shift×10）。
 *   - 播放測試直接在畫布上輪播（含偏移），不必先編碼 APNG。
 *   - 打包把每格偏移烙進影格（畫布擴大到聯集範圍），交回上層走原本的 fit → APNG 流程。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { padRaster, toCanvas, type Raster } from '../webpipe/raster.js';

const GHOST_ALPHA = 0.18;
const CHECKER = 12;

interface Offset {
  x: number;
  y: number;
}

export function ManualLayout(props: {
  frames: Raster[];
  durationSec: number;
  busy: boolean;
  onPack: (frames: Raster[]) => void;
}) {
  const { frames, durationSec, busy, onPack } = props;
  const W = frames[0]?.width ?? 0;
  const H = frames[0]?.height ?? 0;
  const PAD = Math.max(24, Math.round(Math.max(W, H) * 0.15));

  const [offsets, setOffsets] = useState<Offset[]>(() => frames.map(() => ({ x: 0, y: 0 })));
  const [sel, setSel] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playIdx, setPlayIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; ox: number; oy: number } | null>(null);

  const sources = useMemo(() => frames.map((f) => toCanvas(f)), [frames]);

  // 播放：輪播計時器（含偏移直接畫，不經編碼）
  useEffect(() => {
    if (!playing) return;
    const delay = Math.max(20, (durationSec * 1000) / frames.length);
    const t = setInterval(() => setPlayIdx((i) => (i + 1) % frames.length), delay);
    return () => clearInterval(t);
  }, [playing, durationSec, frames.length]);

  // 重畫：棋盤底 + （播放＝當前格｜編輯＝其他格殘影 + 選取格實色）
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const CW = canvas.width;
    const CH = canvas.height;
    ctx.clearRect(0, 0, CW, CH);
    for (let y = 0; y < CH; y += CHECKER) {
      for (let x = 0; x < CW; x += CHECKER) {
        ctx.fillStyle = ((x / CHECKER + y / CHECKER) & 1) === 0 ? '#ffffff' : '#ececf0';
        ctx.fillRect(x, y, CHECKER, CHECKER);
      }
    }
    const draw = (i: number, alpha: number) => {
      const src = sources[i];
      const o = offsets[i];
      if (!src || !o) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(src, PAD + o.x, PAD + o.y);
    };
    if (playing) {
      draw(playIdx, 1);
    } else {
      for (let i = 0; i < sources.length; i++) if (i !== sel) draw(i, GHOST_ALPHA);
      draw(sel, 1);
    }
    ctx.globalAlpha = 1;
    // 原始畫布範圍參考線（偏移是相對它）
    ctx.strokeStyle = 'rgba(6,199,85,0.55)';
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(PAD + 0.5, PAD + 0.5, W, H);
    ctx.setLineDash([]);
  }, [sources, offsets, sel, playing, playIdx, PAD, W, H]);

  const nudge = (dx: number, dy: number) => {
    setOffsets((prev) => prev.map((o, i) => (i === sel ? { x: o.x + dx, y: o.y + dy } : o)));
  };

  const scaleOf = (canvas: HTMLCanvasElement): number => {
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? canvas.width / rect.width : 1;
  };

  const pack = () => {
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (const o of offsets) {
      if (o.x < minX) minX = o.x;
      if (o.y < minY) minY = o.y;
      if (o.x > maxX) maxX = o.x;
      if (o.y > maxY) maxY = o.y;
    }
    const shifted = frames.map((f, i) => {
      const o = offsets[i]!;
      return padRaster(f, {
        left: o.x - minX,
        right: maxX - o.x,
        top: o.y - minY,
        bottom: maxY - o.y,
      });
    });
    onPack(shifted);
  };

  const cur = offsets[sel] ?? { x: 0, y: 0 };
  const moved = offsets.filter((o) => o.x !== 0 || o.y !== 0).length;

  return (
    <details className="layout-editor" open>
      <summary>手動排版（拖曳對位 → 播放測試 → 打包）</summary>
      <p className="tab-desc">
        淡色殘影＝其他影格的位置。拖曳（或方向鍵，Shift×10）移動目前格使主體/場景對齊殘影；
        「播放測試」直接預覽；滿意後「以手動排版打包」產生 APNG。虛線框＝原始畫布範圍。
      </p>
      <div className="frame-strip">
        {frames.map((_, i) => (
          <button
            key={i}
            className={`btn small ${i === sel ? 'primary' : ''}`}
            onClick={() => {
              setSel(i);
              setPlaying(false);
            }}
            title={`第 ${i + 1} 格${offsets[i]!.x || offsets[i]!.y ? `（${offsets[i]!.x},${offsets[i]!.y}）` : ''}`}
          >
            {i + 1}
            {(offsets[i]!.x !== 0 || offsets[i]!.y !== 0) && '•'}
          </button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        className="layout-canvas"
        width={W + PAD * 2}
        height={H + PAD * 2}
        tabIndex={0}
        onPointerDown={(e) => {
          if (playing) return;
          const canvas = e.currentTarget;
          canvas.setPointerCapture(e.pointerId);
          const o = offsets[sel] ?? { x: 0, y: 0 };
          dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, ox: o.x, oy: o.y };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d || d.pointerId !== e.pointerId) return;
          const k = scaleOf(e.currentTarget);
          const nx = d.ox + Math.round((e.clientX - d.startX) * k);
          const ny = d.oy + Math.round((e.clientY - d.startY) * k);
          setOffsets((prev) => prev.map((o, i) => (i === sel ? { x: nx, y: ny } : o)));
        }}
        onPointerUp={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1;
          if (e.key === 'ArrowLeft') nudge(-step, 0);
          else if (e.key === 'ArrowRight') nudge(step, 0);
          else if (e.key === 'ArrowUp') nudge(0, -step);
          else if (e.key === 'ArrowDown') nudge(0, step);
          else return;
          e.preventDefault();
        }}
      />
      <div className="run-row">
        <span className="layout-status">
          第 {sel + 1}/{frames.length} 格　偏移 ({cur.x}, {cur.y})　已調 {moved} 格
        </span>
        <button className="btn small" onClick={() => setSel((s) => (s - 1 + frames.length) % frames.length)}>
          ← 上一格
        </button>
        <button className="btn small" onClick={() => setSel((s) => (s + 1) % frames.length)}>
          下一格 →
        </button>
        <button
          className="btn small"
          onClick={() => setOffsets((prev) => prev.map((o, i) => (i === sel ? { x: 0, y: 0 } : o)))}
        >
          重設本格
        </button>
        <button className="btn small" onClick={() => setOffsets(frames.map(() => ({ x: 0, y: 0 })))}>
          全部重設
        </button>
        <button
          className="btn"
          onClick={() => {
            setPlayIdx(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? '■ 停止' : '▶ 播放測試'}
        </button>
        <button className="btn primary" disabled={busy} onClick={pack}>
          {busy ? '處理中…' : '以手動排版打包'}
        </button>
      </div>
    </details>
  );
}
