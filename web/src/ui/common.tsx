/**
 * 共用 UI 元件：檔案選取（拖放）、處理紀錄、驗證報告、PNG 預覽。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ValidationResult } from '@core/types.js';

// ---------- 處理紀錄 ----------

export type LogLevel = 'info' | 'ok' | 'warn' | 'err' | 'step';

export interface LogLine {
  level: LogLevel;
  text: string;
}

export interface Logger {
  lines: LogLine[];
  log: (level: LogLevel, text: string) => void;
  clear: () => void;
}

export function useLogger(): Logger {
  const [lines, setLines] = useState<LogLine[]>([]);
  const log = useCallback((level: LogLevel, text: string) => {
    setLines((prev) => [...prev, { level, text }]);
  }, []);
  const clear = useCallback(() => setLines([]), []);
  return { lines, log, clear };
}

const LOG_ICON: Record<LogLevel, string> = {
  info: '·',
  ok: '✓',
  warn: '⚠',
  err: '✗',
  step: '▸',
};

export function LogPane({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines]);
  if (lines.length === 0) return null;
  return (
    <div className="log-pane" ref={ref}>
      {lines.map((l, i) => (
        <div key={i} className={`log-line log-${l.level}`}>
          <span className="log-icon">{LOG_ICON[l.level]}</span> {l.text}
        </div>
      ))}
    </div>
  );
}

// ---------- 驗證報告 ----------

export function ValidationView({ result }: { result: ValidationResult }) {
  if (result.issues.length === 0) {
    return <div className="validation ok">✓ 全部符合 LINE 規格</div>;
  }
  return (
    <div className={`validation ${result.ok ? 'warn' : 'fail'}`}>
      {result.issues.map((i, k) => (
        <div key={k} className={`v-issue v-${i.level}`}>
          {i.level === 'error' ? '✗' : '⚠'} {i.target ? `[${i.target}] ` : ''}
          {i.message}
        </div>
      ))}
    </div>
  );
}

// ---------- 檔案選取（拖放 + 點選） ----------

/** 檔名自然排序（01 < 2 < 10），與 CLI 讀目錄的順序一致 */
export function sortFiles(files: File[]): File[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function FilePick(props: {
  label: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  hint?: string;
}) {
  const { label, multiple = false, files, onChange, hint } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const accept = (list: FileList | null) => {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) return;
    onChange(sortFiles(multiple ? [...files, ...imgs] : imgs.slice(0, 1)));
  };

  return (
    <div
      className={`filepick ${over ? 'over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        accept(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          accept(e.currentTarget.files);
          e.currentTarget.value = '';
        }}
      />
      <div className="filepick-label">{label}</div>
      {files.length > 0 ? (
        <div className="filepick-files">
          {files.map((f, i) => (
            <span key={i} className="filepick-file">
              {f.name}
              <button
                className="filepick-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(files.filter((_, k) => k !== i));
                }}
                title="移除"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="filepick-hint">{hint ?? '拖放圖片到這裡，或點擊選取'}</div>
      )}
    </div>
  );
}

// ---------- PNG 預覽 ----------

export function PngPreview({ bytes, caption, big }: { bytes: Uint8Array; caption?: string; big?: boolean }) {
  const url = useMemo(
    () => URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' })),
    [bytes],
  );
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <figure className={`png-preview ${big ? 'big' : ''}`}>
      <img src={url} alt={caption ?? ''} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

// ---------- 小工具 ----------

export function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)}KB`;
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="form-row">{children}</div>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn small"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? '已複製 ✓' : '複製'}
    </button>
  );
}
