import { useEffect, useState } from 'react';
import type { GridLayout } from '@core/types.js';
import { customGridIssue } from './defaults.js';

type NaturalSize = { url: string; width: number; height: number };

/**
 * Nominal, equal-cell preview for a sprite sheet.
 *
 * This is deliberately only a visual guide: the real cutter can move each
 * nominal line to a nearby transparent gutter after background processing.
 */
export function SheetCutPreview(props: { sheets: File[]; layout: GridLayout | null }) {
  const [urlState, setUrlState] = useState<{ files: File[]; urls: string[] }>({ files: [], urls: [] });
  const [naturalSizes, setNaturalSizes] = useState<Record<number, NaturalSize>>({});

  useEffect(() => {
    const urls = props.sheets.map((file) => URL.createObjectURL(file));
    setUrlState({ files: props.sheets, urls });
    setNaturalSizes({});
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [props.sheets]);

  const urlsReady = urlState.files.length === props.sheets.length
    && urlState.files.every((file, index) => file === props.sheets[index]);
  if (!props.layout || props.sheets.length === 0 || !urlsReady) return null;

  const { cols, rows, cellsPerSheet, count, sheets: expectedSheets } = props.layout;
  const gridIssue = customGridIssue({ cols, rows });
  if (gridIssue) {
    return (
      <section className="sheet-cut-preview" data-testid="sheet-cut-preview-rejected">
        <h3>切割示意無法顯示</h3>
        <p className="sheet-cut-preview-note">{gridIssue}</p>
      </section>
    );
  }
  const cellsInGrid = cols * rows;

  return (
    <section className="sheet-cut-preview" data-testid="sheet-cut-preview">
      <h3>切割示意（等分格）</h3>
      <p className="sheet-cut-preview-note">
        這是上傳後、處理前的 nominal 網格；正式切格會依透明縫微調切線。
      </p>
      <div className="sheet-cut-preview-list">
        {props.sheets.map((file, sheetIndex) => {
          const remaining = count - sheetIndex * cellsPerSheet;
          const activeCount = Math.max(0, Math.min(cellsPerSheet, remaining));
          const url = urlState.urls[sheetIndex]!;
          const loaded = naturalSizes[sheetIndex];
          // Keep a valid fallback while the image is loading. Once natural
          // dimensions are known, the SVG uses the image's own pixel viewBox
          // so text and cell coordinates scale with the actual source image.
          const imageWidth = loaded?.url === url ? loaded.width : cols;
          const imageHeight = loaded?.url === url ? loaded.height : rows;
          const cellWidth = imageWidth / cols;
          const cellHeight = imageHeight / rows;
          const labelFontSize = Math.min(
            72,
            cellWidth * 0.25,
            cellHeight * 0.32,
          );
          return (
            <figure
              className="sheet-cut-preview-card"
              key={`${file.name}-${sheetIndex}`}
              data-sheet-preview-index={sheetIndex}
            >
              <div className="sheet-cut-preview-media" data-sheet-preview-media>
                <img
                  data-sheet-preview-image
                  src={url}
                  alt={`${file.name} ${cols}×${rows} 切割示意`}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setNaturalSizes((previous) => ({
                      ...previous,
                      [sheetIndex]: { url, width: image.naturalWidth, height: image.naturalHeight },
                    }));
                  }}
                />
                <svg
                  data-sheet-preview-overlay
                  viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${file.name} 切割格線`}
                >
                  {Array.from({ length: cellsInGrid }, (_, cellIndex) => {
                    const column = cellIndex % cols;
                    const row = Math.floor(cellIndex / cols);
                    const active = cellIndex < activeCount;
                    const globalIndex = sheetIndex * cellsPerSheet + cellIndex;
                    const left = column * cellWidth;
                    const top = row * cellHeight;
                    return (
                      <g key={cellIndex} data-sheet-cut-cell-group data-active={active ? 'true' : 'false'}>
                        <rect
                          data-sheet-cut-cell
                          data-active={active ? 'true' : 'false'}
                          className={active ? 'active' : 'unused'}
                          x={left}
                          y={top}
                          width={cellWidth}
                          height={cellHeight}
                        />
                        {active && (
                          <text
                            data-sheet-cut-label
                            x={left + cellWidth * 0.06}
                            y={top + labelFontSize * 1.1}
                            fontSize={labelFontSize}
                            aria-label={`第 ${globalIndex + 1} 格`}
                          >
                            {String(globalIndex + 1).padStart(2, '0')}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
              <figcaption>
                {file.name} · {cols}×{rows} · {activeCount} 格
                {sheetIndex + 1 > expectedSheets ? '（超出目前版面）' : ''}
                {' · 正式切格會依透明縫微調切線'}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
