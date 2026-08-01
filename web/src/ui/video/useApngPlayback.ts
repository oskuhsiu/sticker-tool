import { useCallback, useEffect, useRef, useState } from 'react';

export function useApngPlayback(args: {
  delaysMs: readonly number[];
  active: boolean;
}) {
  const { delaysMs, active } = args;
  const [playing, setPlaying] = useState(active);
  const [frameIndex, setFrameIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const stateRef = useRef({ frameIndex: 0, elapsedMs: 0, lastTime: 0 });
  const perLoopDurationMs = delaysMs.reduce((sum, delay) => sum + delay, 0);

  const restart = useCallback(() => {
    stateRef.current = { frameIndex: 0, elapsedMs: 0, lastTime: 0 };
    setFrameIndex(0);
    setElapsedMs(0);
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!active) {
      setPlaying(false);
      stateRef.current.lastTime = 0;
    } else {
      stateRef.current = { frameIndex: 0, elapsedMs: 0, lastTime: 0 };
      setFrameIndex(0);
      setElapsedMs(0);
      setPlaying(true);
    }
  }, [active]);

  useEffect(() => {
    if (!playing || !active || delaysMs.length === 0 || perLoopDurationMs <= 0) return;
    let request = 0;
    const tick = (time: number) => {
      const state = stateRef.current;
      if (state.lastTime === 0) state.lastTime = time;
      const delta = Math.min(100, Math.max(0, time - state.lastTime));
      state.lastTime = time;
      state.elapsedMs = (state.elapsedMs + delta) % perLoopDurationMs;
      let accumulated = 0;
      let nextFrame = 0;
      for (; nextFrame < delaysMs.length - 1; nextFrame++) {
        accumulated += delaysMs[nextFrame]!;
        if (state.elapsedMs < accumulated) break;
      }
      state.frameIndex = nextFrame;
      setFrameIndex(nextFrame);
      setElapsedMs(state.elapsedMs);
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(request);
      stateRef.current.lastTime = 0;
    };
  }, [active, delaysMs, perLoopDurationMs, playing]);

  return {
    playing,
    frameIndex,
    elapsedMs,
    perLoopDurationMs,
    progress: perLoopDurationMs > 0 ? elapsedMs / perLoopDurationMs : 0,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    restart,
  };
}
