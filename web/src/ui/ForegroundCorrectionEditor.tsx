import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  applyForegroundCorrection,
  createIncrementalKeepStroke,
  createKeepMask,
  mapClientToSource,
  maskBounds,
  redoMaskStroke,
  undoMaskStroke,
  type IncrementalKeepStroke,
  type KeepMask,
  type MaskRect,
  type MaskStrokeDiff,
} from '../webpipe/foregroundCorrection.js';
import type { Raster } from '../webpipe/raster.js';

type CorrectionTool = 'restore' | 'clear' | 'pan';
type CorrectionZoom = 'fit' | '100' | '200';
type PreviewBackground = 'checkerboard' | 'black' | 'white';

const HISTORY_MAX_ENTRIES = 64;
const HISTORY_MAX_BYTES = 16 * 1024 * 1024;

export interface ForegroundCorrectionEditorProps {
  readonly source: Raster;
  readonly automatic: Raster;
  readonly mask: KeepMask;
  readonly onMaskChange: (mask: KeepMask) => void;
  readonly sourceIdentity: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly status?: string;
  readonly diagnostics?: ReactNode;
  readonly onClearAll?: () => void;
}

interface BrushGesture {
  readonly kind: 'brush';
  readonly pointerId: number;
  readonly element: HTMLCanvasElement;
  readonly stroke: IncrementalKeepStroke;
  latestPoint: { x: number; y: number };
}

interface PanGesture {
  readonly kind: 'pan';
  readonly pointerId: number;
  readonly element: HTMLCanvasElement;
  readonly clientX: number;
  readonly clientY: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

type ActiveGesture = BrushGesture | PanGesture;

function rasterToCanvas(canvas: HTMLCanvasElement | null, raster: Raster): void {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  if (canvas.width !== raster.width) canvas.width = raster.width;
  if (canvas.height !== raster.height) canvas.height = raster.height;
  context.putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
}

function maskToOverlay(
  canvas: HTMLCanvasElement | null,
  mask: KeepMask,
  cursor?: { readonly x: number; readonly y: number; readonly radius: number },
): void {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  if (canvas.width !== mask.width) canvas.width = mask.width;
  if (canvas.height !== mask.height) canvas.height = mask.height;
  const data = new Uint8ClampedArray(mask.data.length * 4);
  for (let pixel = 0; pixel < mask.data.length; pixel++) {
    const offset = pixel * 4;
    data[offset] = 0;
    data[offset + 1] = 199;
    data[offset + 2] = 85;
    data[offset + 3] = Math.round(mask.data[pixel]! * 0.5);
  }
  context.putImageData(new ImageData(data, mask.width, mask.height), 0, 0);
  if (cursor) {
    context.save();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(cursor.x, cursor.y, cursor.radius, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = '#111111';
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }
}

function drawMaskDamage(
  baseCanvas: HTMLCanvasElement | null,
  overlayCanvas: HTMLCanvasElement | null,
  source: Raster,
  automatic: Raster,
  mask: KeepMask,
  rect: MaskRect,
): void {
  const base = baseCanvas?.getContext('2d');
  const overlay = overlayCanvas?.getContext('2d');
  if (!baseCanvas || !overlayCanvas || !base || !overlay || rect.width === 0 || rect.height === 0) return;
  const corrected = new Uint8ClampedArray(rect.width * rect.height * 4);
  const tint = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const sourcePixel = (rect.top + y) * source.width + rect.left + x;
      const sourceOffset = sourcePixel * 4;
      const outputOffset = (y * rect.width + x) * 4;
      const keep = mask.data[sourcePixel]!;
      if (keep === 0) {
        corrected.set(automatic.data.subarray(sourceOffset, sourceOffset + 4), outputOffset);
      } else if (keep === 255) {
        corrected.set(source.data.subarray(sourceOffset, sourceOffset + 4), outputOffset);
      } else {
        const strength = keep / 255;
        const automaticAlpha = automatic.data[sourceOffset + 3]!;
        const sourceAlpha = source.data[sourceOffset + 3]!;
        const outputAlpha = automaticAlpha + (sourceAlpha - automaticAlpha) * strength;
        for (let channel = 0; channel < 3; channel++) {
          const automaticPremultiplied = automatic.data[sourceOffset + channel]! * automaticAlpha;
          const sourcePremultiplied = source.data[sourceOffset + channel]! * sourceAlpha;
          const outputPremultiplied = automaticPremultiplied
            + (sourcePremultiplied - automaticPremultiplied) * strength;
          corrected[outputOffset + channel] = outputAlpha === 0 ? 0 : Math.round(outputPremultiplied / outputAlpha);
        }
        corrected[outputOffset + 3] = Math.round(outputAlpha);
      }
      tint[outputOffset + 1] = 199;
      tint[outputOffset + 2] = 85;
      tint[outputOffset + 3] = Math.round(keep * 0.5);
    }
  }
  base.putImageData(new ImageData(corrected, rect.width, rect.height), rect.left, rect.top);
  overlay.putImageData(new ImageData(tint, rect.width, rect.height), rect.left, rect.top);
}

function diffChanged(diff: MaskStrokeDiff): boolean {
  return diff.before.some((value, index) => value !== diff.after[index]);
}

function boundedHistory(current: readonly MaskStrokeDiff[], added: MaskStrokeDiff): MaskStrokeDiff[] {
  const addedBytes = added.before.byteLength + added.after.byteLength;
  if (addedBytes > HISTORY_MAX_BYTES) return [];
  const next = [...current, added];
  let bytes = next.reduce((sum, diff) => sum + diff.before.byteLength + diff.after.byteLength, 0);
  while (next.length > 1 && (next.length > HISTORY_MAX_ENTRIES || bytes > HISTORY_MAX_BYTES)) {
    const removed = next.shift()!;
    bytes -= removed.before.byteLength + removed.after.byteLength;
  }
  return next;
}

export function ForegroundCorrectionEditor(props: ForegroundCorrectionEditorProps) {
  const disabled = props.disabled ?? false;
  const instructionsId = useId();
  const statusId = useId();
  const [tool, setTool] = useState<CorrectionTool>('restore');
  const [brushSize, setBrushSize] = useState(24);
  const [hardness, setHardness] = useState(80);
  const [zoom, setZoom] = useState<CorrectionZoom>('fit');
  const [background, setBackground] = useState<PreviewBackground>('checkerboard');
  const [showOverlay, setShowOverlay] = useState(true);
  const [canvasFocused, setCanvasFocused] = useState(false);
  const [keyboardCursor, setKeyboardCursor] = useState(() => ({
    x: Math.floor((props.source.width - 1) / 2),
    y: Math.floor((props.source.height - 1) / 2),
  }));
  const [undoStack, setUndoStack] = useState<MaskStrokeDiff[]>([]);
  const [redoStack, setRedoStack] = useState<MaskStrokeDiff[]>([]);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<ActiveGesture | null>(null);
  const maskRef = useRef(props.mask);
  const controlledMaskRef = useRef(props.mask);
  const publishedMaskRef = useRef<KeepMask | null>(null);

  const publishMask = (mask: KeepMask) => {
    maskRef.current = mask;
    publishedMaskRef.current = mask;
    props.onMaskChange(mask);
  };

  const renderMask = (mask: KeepMask, showKeyboardCursor = canvasFocused) => {
    const corrected = applyForegroundCorrection(props.source, props.automatic, mask);
    rasterToCanvas(baseCanvasRef.current, corrected);
    maskToOverlay(overlayCanvasRef.current, mask, showKeyboardCursor ? {
      ...keyboardCursor,
      radius: brushSize / 2,
    } : undefined);
  };

  const releaseGesture = (gesture: ActiveGesture) => {
    if (gesture.element.hasPointerCapture(gesture.pointerId)) {
      gesture.element.releasePointerCapture(gesture.pointerId);
    }
  };

  const cancelGesture = (restoreMask = true) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    if (restoreMask && gesture.kind === 'brush') renderMask(maskRef.current);
    releaseGesture(gesture);
  };

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
    cancelGesture(false);
    controlledMaskRef.current = props.mask;
    publishedMaskRef.current = null;
    maskRef.current = props.mask;
    setKeyboardCursor({
      x: Math.floor((props.source.width - 1) / 2),
      y: Math.floor((props.source.height - 1) / 2),
    });
    // History is scoped to an immutable source, not to ordinary controlled-mask updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sourceIdentity]);

  useEffect(() => {
    if (props.mask === controlledMaskRef.current) return;
    const ownPublication = props.mask === publishedMaskRef.current;
    controlledMaskRef.current = props.mask;
    publishedMaskRef.current = null;
    maskRef.current = props.mask;
    if (!ownPublication) {
      setUndoStack([]);
      setRedoStack([]);
      cancelGesture(false);
    }
    // A controlled replacement under the same source identity starts a new history epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mask]);

  useEffect(() => {
    if (disabled) cancelGesture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  useEffect(() => () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture) releaseGesture(gesture);
  }, []);

  useEffect(() => {
    renderMask(props.mask);
    // Canvas rendering is an effect of all preview and cursor inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.source, props.automatic, props.mask, canvasFocused, keyboardCursor, brushSize]);

  const sourcePoint = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const point = mapClientToSource(
      { x: event.clientX, y: event.clientY },
      {
        clientLeft: rect.left,
        clientTop: rect.top,
        cssWidth: rect.width,
        cssHeight: rect.height,
        backingWidth: props.source.width,
        backingHeight: props.source.height,
        zoom: 1,
        panX: 0,
        panY: 0,
        devicePixelRatio: globalThis.devicePixelRatio,
      },
    );
    return {
      x: Math.max(0, Math.min(props.source.width - 1, point.x)),
      y: Math.max(0, Math.min(props.source.height - 1, point.y)),
    };
  };

  const createBrushStroke = (mask: KeepMask): IncrementalKeepStroke => (
    createIncrementalKeepStroke(mask, {
      mode: tool === 'clear' ? 'clear' : 'restore',
      radius: brushSize / 2,
      hardness: hardness / 100,
    })
  );

  const recordStroke = (painted: { readonly mask: KeepMask; readonly diff: MaskStrokeDiff }) => {
    if (!diffChanged(painted.diff)) {
      renderMask(maskRef.current);
      return;
    }
    publishMask(painted.mask);
    setUndoStack((current) => boundedHistory(current, painted.diff));
    setRedoStack([]);
  };

  const beginGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'pan') {
      const viewport = viewportRef.current;
      if (!viewport) return;
      gestureRef.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        element: event.currentTarget,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      };
      return;
    }
    const point = sourcePoint(event);
    if (!point) return;
    maskToOverlay(overlayCanvasRef.current, maskRef.current);
    const stroke = createBrushStroke(maskRef.current);
    const damage = stroke.addPoint(point);
    gestureRef.current = {
      kind: 'brush',
      pointerId: event.pointerId,
      element: event.currentTarget,
      stroke,
      latestPoint: point,
    };
    drawMaskDamage(baseCanvasRef.current, overlayCanvasRef.current, props.source, props.automatic, stroke.mask, damage);
  };

  const continueGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || disabled) return;
    event.preventDefault();
    if (gesture.kind === 'pan') {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollLeft = gesture.scrollLeft - (event.clientX - gesture.clientX);
      viewport.scrollTop = gesture.scrollTop - (event.clientY - gesture.clientY);
      return;
    }
    const point = sourcePoint(event);
    if (!point) return;
    if (point.x === gesture.latestPoint.x && point.y === gesture.latestPoint.y) return;
    const damage = gesture.stroke.addPoint(point);
    gesture.latestPoint = point;
    drawMaskDamage(baseCanvasRef.current, overlayCanvasRef.current, props.source, props.automatic, gesture.stroke.mask, damage);
  };

  const finishGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    releaseGesture(gesture);
    if (gesture.kind === 'brush') recordStroke(gesture.stroke.finish());
  };

  const undo = () => {
    const diff = undoStack[undoStack.length - 1];
    if (!diff || disabled) return;
    publishMask(undoMaskStroke(maskRef.current, diff));
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => boundedHistory(current, diff));
  };

  const redo = () => {
    const diff = redoStack[redoStack.length - 1];
    if (!diff || disabled) return;
    publishMask(redoMaskStroke(maskRef.current, diff));
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => boundedHistory(current, diff));
  };

  const clearCurrent = () => {
    if (disabled || !maskBounds(maskRef.current)) return;
    const before = new Uint8Array(maskRef.current.data);
    const next = createKeepMask(maskRef.current.width, maskRef.current.height);
    const diff: MaskStrokeDiff = {
      width: next.width,
      height: next.height,
      rect: { left: 0, top: 0, width: next.width, height: next.height },
      before,
      after: new Uint8Array(next.data),
    };
    publishMask(next);
    setUndoStack((current) => boundedHistory(current, diff));
    setRedoStack([]);
  };

  const handleCanvasKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 10 : 1;
    let nextCursor = keyboardCursor;
    if (event.key === 'ArrowLeft') {
      nextCursor = { ...keyboardCursor, x: Math.max(0, keyboardCursor.x - step) };
    } else if (event.key === 'ArrowRight') {
      nextCursor = { ...keyboardCursor, x: Math.min(props.source.width - 1, keyboardCursor.x + step) };
    } else if (event.key === 'ArrowUp') {
      nextCursor = { ...keyboardCursor, y: Math.max(0, keyboardCursor.y - step) };
    } else if (event.key === 'ArrowDown') {
      nextCursor = { ...keyboardCursor, y: Math.min(props.source.height - 1, keyboardCursor.y + step) };
    } else if ((event.key === ' ' || event.key === 'Enter') && tool !== 'pan') {
      event.preventDefault();
      const stroke = createBrushStroke(maskRef.current);
      stroke.addPoint(keyboardCursor);
      recordStroke(stroke.finish());
      return;
    } else {
      return;
    }
    event.preventDefault();
    setKeyboardCursor(nextCursor);
  };

  const edited = maskBounds(props.mask) !== null;
  const mediaWidth = zoom === 'fit'
    ? '100%'
    : `${props.source.width * (zoom === '200' ? 2 : 1)}px`;

  return (
    <section className="foreground-correction-editor" aria-label={`${props.label} foreground correction editor`}>
      <div className="foreground-correction-toolbar">
        <div className="foreground-correction-tool-group" role="group" aria-label="Correction tool">
          {([
            ['restore', 'Restore Original'],
            ['clear', 'Clear Correction'],
            ['pan', 'Pan'],
          ] as const).map(([value, text]) => (
            <button
              key={value}
              type="button"
              className={`btn small ${tool === value ? 'primary' : ''}`}
              aria-pressed={tool === value}
              disabled={disabled}
              onClick={() => setTool(value)}
            >
              {text}
            </button>
          ))}
        </div>
        <label className="foreground-correction-range">
          Brush size
          <input
            type="range"
            min="1"
            max={Math.max(1, Math.min(256, Math.max(props.source.width, props.source.height)))}
            value={brushSize}
            disabled={disabled || tool === 'pan'}
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
          <output>{brushSize} px</output>
        </label>
        <label className="foreground-correction-range">
          Hardness
          <input
            type="range"
            min="0"
            max="100"
            value={hardness}
            disabled={disabled || tool === 'pan'}
            onChange={(event) => setHardness(Number(event.target.value))}
          />
          <output>{hardness}%</output>
        </label>
      </div>

      <div className="foreground-correction-toolbar">
        <div className="foreground-correction-tool-group" role="group" aria-label="Zoom">
          {(['fit', '100', '200'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`btn small ${zoom === value ? 'primary' : ''}`}
              aria-pressed={zoom === value}
              onClick={() => setZoom(value)}
            >
              {value === 'fit' ? 'Fit' : `${value}%`}
            </button>
          ))}
        </div>
        <label className="foreground-correction-toggle">
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(event) => setShowOverlay(event.target.checked)}
          />
          Correction overlay
        </label>
        <label className="foreground-correction-select">
          Preview background
          <select value={background} onChange={(event) => setBackground(event.target.value as PreviewBackground)}>
            <option value="checkerboard">Checkerboard</option>
            <option value="black">Black</option>
            <option value="white">White</option>
          </select>
        </label>
        <div className="foreground-correction-history">
          <button type="button" className="btn small" disabled={disabled || undoStack.length === 0} onClick={undo}>Undo</button>
          <button type="button" className="btn small" disabled={disabled || redoStack.length === 0} onClick={redo}>Redo</button>
          <button type="button" className="btn small" disabled={disabled || !edited} onClick={clearCurrent}>Clear current correction</button>
          {props.onClearAll && (
            <button
              type="button"
              className="btn small"
              disabled={disabled}
              onClick={() => {
                if (globalThis.confirm('Clear corrections for all items? This cannot be undone here.')) props.onClearAll?.();
              }}
            >
              Clear all corrections
            </button>
          )}
        </div>
      </div>

      <div
        ref={viewportRef}
        className="foreground-correction-viewport"
        data-background={background}
        data-tool={tool}
      >
        <div className="foreground-correction-media" style={{ width: mediaWidth }}>
          <canvas ref={baseCanvasRef} width={props.source.width} height={props.source.height} aria-hidden="true" />
          <canvas
            ref={overlayCanvasRef}
            width={props.source.width}
            height={props.source.height}
            className={showOverlay || canvasFocused ? '' : 'foreground-correction-overlay-hidden'}
            role="application"
            aria-roledescription="foreground correction paint canvas"
            aria-label={`${props.label} corrected preview. ${edited ? 'Edited' : 'Not edited'}.`}
            aria-describedby={`${instructionsId} ${statusId}`}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Space Enter"
            tabIndex={disabled ? -1 : 0}
            onPointerDown={beginGesture}
            onPointerMove={continueGesture}
            onPointerUp={finishGesture}
            onPointerCancel={() => cancelGesture()}
            onLostPointerCapture={(event) => {
              if (gestureRef.current?.pointerId === event.pointerId) cancelGesture();
            }}
            onFocus={() => setCanvasFocused(true)}
            onBlur={() => setCanvasFocused(false)}
            onKeyDown={handleCanvasKeyDown}
          />
        </div>
      </div>

      <p id={instructionsId} className="foreground-correction-status">
        Canvas keyboard controls: Arrow keys move the brush cursor by 1 pixel; hold Shift for 10 pixels.
        {' '}Space or Enter paints once with the selected Restore or Clear tool.
      </p>
      <p id={statusId} className="foreground-correction-status" role="status">
        {edited ? 'Edited — correction mask applied.' : 'Not edited — automatic result unchanged.'}
        {` Cursor ${keyboardCursor.x + 1}, ${keyboardCursor.y + 1}. ${tool === 'pan' ? 'Pan selected; choose Restore or Clear to keyboard-paint.' : `${tool === 'restore' ? 'Restore' : 'Clear'} brush selected.`}`}
        {props.status ? ` ${props.status}` : ''}
      </p>
      {props.diagnostics && <div className="foreground-correction-diagnostics">{props.diagnostics}</div>}
    </section>
  );
}
