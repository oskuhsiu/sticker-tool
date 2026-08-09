import { useEffect, useRef, useState } from 'react';
import { emojiFileName, stickerFileName } from '@core/naming.js';
import {
  moveVideoGuide,
  type VideoAxisCuts,
  type VideoGridPlan,
} from '@core/videoCrop.js';
import type { VideoOutputTarget } from '@core/videoProject.js';

type VideoGridZoom = 'fit' | '150' | '200';
type GuideAxis = 'x' | 'y';

interface ActiveGuide {
  axis: GuideAxis;
  index: number;
}

interface DragState extends ActiveGuide {
  pointerId: number;
  offset: number;
  element: SVGLineElement;
}

function cellFileName(target: VideoOutputTarget, index: number): string {
  return target === 'animated-emoji' ? emojiFileName(index + 1) : stickerFileName(index + 1);
}

export function VideoGridEditor(props: {
  png: Uint8Array;
  label: string;
  target: VideoOutputTarget;
  grid: VideoGridPlan;
  xCuts: VideoAxisCuts;
  yCuts: VideoAxisCuts;
  disabled: boolean;
  onXCuts: (cuts: number[]) => void;
  onYCuts: (cuts: number[]) => void;
  onRestoreEqual: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<VideoGridZoom>('fit');
  const [activeGuide, setActiveGuide] = useState<ActiveGuide | null>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(new Blob([props.png.slice().buffer], { type: 'image/png' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [props.png]);

  const cancelActiveDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.element.hasPointerCapture(drag.pointerId)) {
      drag.element.releasePointerCapture(drag.pointerId);
    }
  };

  useEffect(() => {
    if (props.disabled) cancelActiveDrag();
  }, [props.disabled]);

  useEffect(() => () => cancelActiveDrag(), []);

  useEffect(() => {
    setActiveGuide((current) => {
      if (!current) return null;
      const cuts = current.axis === 'x' ? props.xCuts : props.yCuts;
      return current.index < cuts.length ? current : null;
    });
  }, [props.xCuts, props.yCuts]);

  const sourcePosition = (axis: GuideAxis, clientX: number, clientY: number): number | null => {
    const bounds = mediaRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return axis === 'x'
      ? ((clientX - bounds.left) * props.grid.sourceWidth) / bounds.width
      : ((clientY - bounds.top) * props.grid.sourceHeight) / bounds.height;
  };

  const cutsFor = (axis: GuideAxis): VideoAxisCuts => axis === 'x' ? props.xCuts : props.yCuts;

  const sourceSizeFor = (axis: GuideAxis): number => (
    axis === 'x' ? props.grid.sourceWidth : props.grid.sourceHeight
  );

  const guideRange = (axis: GuideAxis, index: number): { min: number; max: number } => {
    const cuts = cutsFor(axis);
    return {
      min: index === 0 ? 0 : cuts[index - 1]! + 1,
      max: index === cuts.length - 1 ? sourceSizeFor(axis) : cuts[index + 1]! - 1,
    };
  };

  const guideLabel = (axis: GuideAxis, index: number): string => {
    const cuts = cutsFor(axis);
    if (axis === 'x') {
      if (index === 0) return '左邊界';
      if (index === cuts.length - 1) return '右邊界';
      return `垂直分隔線 ${index}`;
    }
    if (index === 0) return '上邊界';
    if (index === cuts.length - 1) return '下邊界';
    return `水平分隔線 ${index}`;
  };

  const updateCuts = (axis: GuideAxis, index: number, position: number) => {
    const next = moveVideoGuide(cutsFor(axis), index, position, sourceSizeFor(axis));
    if (axis === 'x') props.onXCuts(next);
    else props.onYCuts(next);
  };

  const beginDrag = (
    axis: GuideAxis,
    index: number,
    event: React.PointerEvent<SVGLineElement>,
  ) => {
    if (props.disabled) return;
    const pointerPosition = sourcePosition(axis, event.clientX, event.clientY);
    if (pointerPosition === null) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      axis,
      index,
      pointerId: event.pointerId,
      offset: pointerPosition - cutsFor(axis)[index]!,
      element: event.currentTarget,
    };
    setActiveGuide({ axis, index });
  };

  const continueDrag = (event: React.PointerEvent<SVGLineElement>) => {
    const drag = dragRef.current;
    if (props.disabled || !drag || drag.pointerId !== event.pointerId) return;
    const pointerPosition = sourcePosition(drag.axis, event.clientX, event.clientY);
    if (pointerPosition === null) return;
    updateCuts(drag.axis, drag.index, pointerPosition - drag.offset);
  };

  const finishDrag = (event: React.PointerEvent<SVGLineElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const nudgeGuide = (
    axis: GuideAxis,
    index: number,
    event: React.KeyboardEvent<SVGLineElement>,
  ) => {
    if (props.disabled) return;
    const step = event.shiftKey ? 10 : 1;
    let delta = 0;
    if (axis === 'x' && event.key === 'ArrowLeft') delta = -step;
    else if (axis === 'x' && event.key === 'ArrowRight') delta = step;
    else if (axis === 'y' && event.key === 'ArrowUp') delta = -step;
    else if (axis === 'y' && event.key === 'ArrowDown') delta = step;
    else return;
    event.preventDefault();
    setActiveGuide({ axis, index });
    updateCuts(axis, index, cutsFor(axis)[index]! + delta);
  };

  const guideStatus = (() => {
    if (!activeGuide) return '選取外框或內部分隔線以查看來源像素位置。';
    const cuts = cutsFor(activeGuide.axis);
    const value = cuts[activeGuide.index]!;
    const { min, max } = guideRange(activeGuide.axis, activeGuide.index);
    const coordinate = activeGuide.axis === 'x' ? 'x' : 'y';
    return `${guideLabel(activeGuide.axis, activeGuide.index)}：${coordinate} = ${value} px（可調 ${min}–${max} px）`;
  })();

  const mediaWidth = zoom === 'fit'
    ? '100%'
    : `${props.grid.sourceWidth * (Number(zoom) / 100)}px`;

  const renderGuide = (axis: GuideAxis, index: number, position: number) => {
    const { min, max } = guideRange(axis, index);
    const vertical = axis === 'x';
    const label = guideLabel(axis, index);
    const lineProps = vertical
      ? { x1: position, x2: position, y1: 0, y2: props.grid.sourceHeight }
      : { x1: 0, x2: props.grid.sourceWidth, y1: position, y2: position };
    return (
      <g className="video-grid-guide" key={`${axis}-${index}`}>
        <line className="video-grid-guide-visible" {...lineProps} />
        <line
          className="video-grid-guide-hit"
          {...lineProps}
          role="separator"
          tabIndex={props.disabled ? -1 : 0}
          aria-label={label}
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={position}
          aria-valuetext={`${position} source pixels`}
          aria-disabled={props.disabled || undefined}
          data-axis={axis}
          data-guide-index={index}
          onFocus={() => setActiveGuide({ axis, index })}
          onPointerDown={(event) => beginDrag(axis, index, event)}
          onPointerMove={continueDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
          }}
          onKeyDown={(event) => nudgeGuide(axis, index, event)}
        />
      </g>
    );
  };

  return (
    <figure className="video-grid-editor">
      <div className="video-grid-editor-toolbar">
        <div className="video-grid-zoom" role="group" aria-label="網格編輯器縮放">
          <span>縮放</span>
          {(['fit', '150', '200'] as const).map((value) => (
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
        <button type="button" className="btn small" disabled={props.disabled} onClick={props.onRestoreEqual}>
          恢復等分格線
        </button>
      </div>
      <div className="video-grid-editor-viewport" data-zoom={zoom}>
        <div ref={mediaRef} className="video-grid-editor-media" style={{ width: mediaWidth }}>
          {url && (
            <>
              <img
                src={url}
                width={props.grid.sourceWidth}
                height={props.grid.sourceHeight}
                alt={`${props.label}的影片格線編輯畫面`}
                draggable={false}
              />
              <svg
                viewBox={`0 0 ${props.grid.sourceWidth} ${props.grid.sourceHeight}`}
                aria-label="來源裁切格線"
              >
                {props.grid.rects.map((rect) => (
                  <g className="video-grid-cell" key={rect.id} data-cell-index={rect.index}>
                    <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} />
                    <text x={rect.left + 8} y={rect.top + 22}>{cellFileName(props.target, rect.index)}</text>
                  </g>
                ))}
                {props.xCuts.map((position, index) => renderGuide('x', index, position))}
                {props.yCuts.map((position, index) => renderGuide('y', index, position))}
              </svg>
            </>
          )}
        </div>
      </div>
      <figcaption>{props.label}</figcaption>
      <output className="video-grid-editor-status" role="status" aria-live="polite" aria-atomic="true">
        {guideStatus}
      </output>
    </figure>
  );
}
