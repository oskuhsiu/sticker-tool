import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeApngFrames } from '../../webpipe/apng.js';
import { useApngPlayback } from './useApngPlayback.js';

export function ApngTimelinePlayer(props: {
  png: Uint8Array;
  active: boolean;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoded = useMemo(() => decodeApngFrames(props.png), [props.png]);
  const [visible, setVisible] = useState(true);
  const playback = useApngPlayback({ delaysMs: decoded.delaysMs, active: props.active && visible });

  useEffect(() => {
    const update = () => setVisible(
      document.visibilityState === 'visible' && containerRef.current?.offsetParent !== null,
    );
    update();
    document.addEventListener('visibilitychange', update);
    const tab = containerRef.current?.closest('[data-tab]');
    const observer = tab ? new MutationObserver(update) : null;
    if (tab && observer) observer.observe(tab, { attributes: true, attributeFilter: ['style', 'hidden'] });
    return () => {
      document.removeEventListener('visibilitychange', update);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const frame = decoded.frames[playback.frameIndex];
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
  }, [decoded.frames, playback.frameIndex]);

  return (
    <div className="apng-timeline-player" ref={containerRef}>
      <canvas ref={canvasRef} aria-label={props.label} />
      <div className="apng-player-status">
        第 {playback.frameIndex + 1}/{decoded.frames.length} 格 · {Math.round(playback.elapsedMs)}/{playback.perLoopDurationMs}ms
      </div>
      <progress max={1} value={playback.progress} aria-label="單輪播放進度" />
      <div className="run-row">
        <button className="btn small" onClick={playback.play} disabled={playback.playing}>播放</button>
        <button className="btn small" onClick={playback.pause} disabled={!playback.playing}>暫停</button>
        <button className="btn small" onClick={playback.restart}>重新開始</button>
      </div>
    </div>
  );
}
