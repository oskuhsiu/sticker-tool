import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cacheAutomaticRaster,
  cachedAutomaticRaster,
  compatibleKeepMask,
  invalidateAutomaticCorrections,
  type ForegroundCorrectionRecord,
  type ForegroundCorrectionRecords,
} from '../webpipe/backgroundCorrection.js';
import type {
  BackgroundRemovalJob,
  BackgroundRemovalRender,
  PreparedBackgroundRemovalSession,
  WebBackgroundRemovalMode,
} from '../webpipe/backgroundRemovalJob.js';
import {
  createKeepMask,
  maskBounds,
  type KeepMask,
} from '../webpipe/foregroundCorrection.js';
import type { Raster } from '../webpipe/raster.js';
import { ForegroundCorrectionEditor } from './ForegroundCorrectionEditor.jsx';
import type { ForegroundCorrectionSourceItem } from './correctionSources.js';

export interface ForegroundCorrectionWorkspaceProps {
  readonly mode: WebBackgroundRemovalMode;
  readonly configurationIdentity: string;
  readonly items: readonly ForegroundCorrectionSourceItem[];
  readonly records: ForegroundCorrectionRecords;
  readonly onRecordsChange: (records: Map<string, ForegroundCorrectionRecord>) => void;
  readonly createJob: (signal: AbortSignal) => Promise<BackgroundRemovalJob>;
  /** Reuse one calibration over up to three stratified source items. */
  readonly sharedCalibration?: boolean;
  readonly disabled?: boolean;
  readonly onDirty?: () => void;
  readonly prepareAutomatic?: (args: {
    item: ForegroundCorrectionSourceItem;
    source: Raster;
    job: BackgroundRemovalJob;
    session: PreparedBackgroundRemovalSession;
    signal: AbortSignal;
    onProgress: (status: string) => void;
  }) => Promise<BackgroundRemovalRender>;
}

interface WorkspaceResources {
  configurationIdentity: string;
  itemsIdentity: string;
  job: BackgroundRemovalJob | null;
  jobPromise: Promise<BackgroundRemovalJob> | null;
  sharedSession: PreparedBackgroundRemovalSession | null;
  sharedSessionPromise: Promise<PreparedBackgroundRemovalSession> | null;
  abort: AbortController;
}

function stratifiedItems(items: readonly ForegroundCorrectionSourceItem[]): ForegroundCorrectionSourceItem[] {
  if (items.length <= 3) return [...items];
  return [items[0]!, items[Math.round((items.length - 1) / 2)]!, items[items.length - 1]!];
}

function edited(record: ForegroundCorrectionRecord | undefined): boolean {
  return record?.keepMask ? maskBounds(record.keepMask) !== null : false;
}

const MAX_AUTOMATIC_CACHE_BYTES = 64 * 1024 * 1024;

function boundAutomaticCache(
  records: Map<string, ForegroundCorrectionRecord>,
  protectedIdentity: string,
): Map<string, ForegroundCorrectionRecord> {
  let bytes = [...records.values()].reduce(
    (sum, record) => sum + (record.automaticCompressed?.byteLength ?? 0),
    0,
  );
  if (bytes <= MAX_AUTOMATIC_CACHE_BYTES) return records;
  const next = new Map(records);
  for (const [identity, record] of next) {
    if (bytes <= MAX_AUTOMATIC_CACHE_BYTES) break;
    if (identity === protectedIdentity || !record.automaticCompressed) continue;
    bytes -= record.automaticCompressed.byteLength;
    const { automaticCompressed: _compressed, automaticByteLength: _bytes, ...withoutAutomatic } = record;
    next.set(identity, withoutAutomatic);
  }
  return next;
}

function hexColor(color: readonly [number, number, number]): string {
  return `#${color.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function ForegroundCorrectionWorkspace(props: ForegroundCorrectionWorkspaceProps) {
  const [selectedIdentity, setSelectedIdentity] = useState(props.items[0]?.identity ?? '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<{
    identity: string;
    source: Raster;
    automatic: Raster;
  } | null>(null);
  const recordsRef = useRef(props.records);
  const resourcesRef = useRef<WorkspaceResources | null>(null);
  recordsRef.current = props.records;

  const itemsIdentity = useMemo(
    () => props.items.map((item) => item.identity).join('\u001f'),
    [props.items],
  );
  const itemByIdentity = useMemo(
    () => new Map(props.items.map((item) => [item.identity, item])),
    [props.items],
  );
  const selectedItem = itemByIdentity.get(selectedIdentity) ?? props.items[0];
  const selectedRecord = selectedItem ? props.records.get(selectedItem.identity) : undefined;
  const selectedMask = useMemo(
    () => selectedRecord?.keepMask
      ?? (selectedRecord ? createKeepMask(selectedRecord.width, selectedRecord.height) : null),
    [selectedRecord?.height, selectedRecord?.keepMask, selectedRecord?.width],
  );
  const editedCount = [...props.records.values()].filter((record) => edited(record)).length;

  const emitRecords = (next: Map<string, ForegroundCorrectionRecord>, dirty = true): void => {
    recordsRef.current = next;
    props.onRecordsChange(next);
    if (dirty) props.onDirty?.();
  };

  const disposeSlot = (resources: WorkspaceResources): void => {
    if (resourcesRef.current === resources) resourcesRef.current = null;
    if (!resources) return;
    resources.abort.abort();
    const disposal = resources.job
      ? resources.job.dispose()
      : resources.jobPromise?.then((job) => job.dispose());
    if (disposal) void disposal.catch(() => undefined);
  };

  const disposeResources = (): void => {
    const resources = resourcesRef.current;
    if (resources) disposeSlot(resources);
  };

  useEffect(() => {
    const first = props.items[0]?.identity ?? '';
    if (!itemByIdentity.has(selectedIdentity)) setSelectedIdentity(first);
  }, [itemByIdentity, props.items, selectedIdentity]);

  useEffect(() => {
    let cancelled = false;
    if (
      !selectedItem
      || !selectedRecord
      || selectedRecord.automaticConfigurationIdentity !== props.configurationIdentity
    ) {
      setActivePreview(null);
      return () => { cancelled = true; };
    }
    const automatic = cachedAutomaticRaster(selectedRecord);
    if (!automatic) {
      setActivePreview(null);
      return () => { cancelled = true; };
    }
    void selectedItem.load().then((source) => {
      if (!cancelled && source.width === automatic.width && source.height === automatic.height) {
        setActivePreview({ identity: selectedItem.identity, source, automatic });
      }
    }, () => {
      if (!cancelled) setActivePreview(null);
    });
    return () => { cancelled = true; };
  }, [props.configurationIdentity, selectedItem, selectedRecord?.automaticCompressed]);

  useEffect(() => {
    const allowed = new Set(props.items.map((item) => item.identity));
    const next = new Map([...recordsRef.current].filter(([identity]) => allowed.has(identity)));
    if (next.size !== recordsRef.current.size) emitRecords(next);
    // Only source-list identity should prune records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsIdentity]);

  useEffect(() => {
    disposeResources();
    if (recordsRef.current.size > 0) emitRecords(invalidateAutomaticCorrections(recordsRef.current));
    setStatus(null);
    // Keep masks survive setting changes; immutable automatic snapshots do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.configurationIdentity, itemsIdentity]);

  useEffect(() => () => disposeResources(), []);

  const resources = (): NonNullable<typeof resourcesRef.current> => {
    const existing = resourcesRef.current;
    if (
      existing
      && existing.configurationIdentity === props.configurationIdentity
      && existing.itemsIdentity === itemsIdentity
    ) return existing;
    disposeResources();
    const created = {
      configurationIdentity: props.configurationIdentity,
      itemsIdentity,
      job: null,
      jobPromise: null,
      sharedSession: null,
      sharedSessionPromise: null,
      abort: new AbortController(),
    };
    resourcesRef.current = created;
    return created;
  };

  const getJob = async (current: WorkspaceResources): Promise<BackgroundRemovalJob> => {
    if (current.abort.signal.aborted || resourcesRef.current !== current) throw new DOMException('Aborted', 'AbortError');
    if (current.job) return current.job;
    current.jobPromise ??= props.createJob(current.abort.signal);
    try {
      current.job = await current.jobPromise;
      if (current.abort.signal.aborted || resourcesRef.current !== current) throw new DOMException('Aborted', 'AbortError');
      return current.job;
    } catch (error) {
      current.jobPromise = null;
      throw error;
    }
  };

  const loadSource = async (item: ForegroundCorrectionSourceItem): Promise<Raster> => item.load();

  const getSession = async (
    current: WorkspaceResources,
    item: ForegroundCorrectionSourceItem,
    source: Raster,
  ): Promise<PreparedBackgroundRemovalSession> => {
    const job = await getJob(current);
    if (!props.sharedCalibration) return job.prepare([source], current.abort.signal);
    if (current.sharedSession) return current.sharedSession;
    if (!current.sharedSessionPromise) {
      current.sharedSessionPromise = (async () => {
        const calibration = await Promise.all(stratifiedItems(props.items).map(loadSource));
        if (current.abort.signal.aborted || resourcesRef.current !== current) throw new DOMException('Aborted', 'AbortError');
        return job.prepare(calibration, current.abort.signal);
      })();
    }
    try {
      current.sharedSession = await current.sharedSessionPromise;
      if (current.abort.signal.aborted || resourcesRef.current !== current) throw new DOMException('Aborted', 'AbortError');
      return current.sharedSession;
    } catch (error) {
      current.sharedSessionPromise = null;
      throw error;
    }
  };

  const prepareOne = async (
    current: WorkspaceResources,
    item: ForegroundCorrectionSourceItem,
    ordinal?: { index: number; total: number },
  ): Promise<void> => {
    const source = await loadSource(item);
    if (current.abort.signal.aborted || resourcesRef.current !== current) throw new DOMException('Aborted', 'AbortError');
    const session = await getSession(current, item, source);
    if (current.abort.signal.aborted || resourcesRef.current !== current) throw new DOMException('Aborted', 'AbortError');
    setStatus(ordinal
      ? `準備 ${ordinal.index}/${ordinal.total}：${item.label}`
      : `準備：${item.label}`);
    const job = await getJob(current);
    const automatic = props.prepareAutomatic
      ? await props.prepareAutomatic({
          item,
          source,
          job,
          session,
          signal: current.abort.signal,
          onProgress: setStatus,
        })
      : await session.remove(source, current.abort.signal);
    if (current.abort.signal.aborted || resourcesRef.current !== current) throw new DOMException('Aborted', 'AbortError');
    const previous = recordsRef.current.get(item.identity);
    const keepMask = compatibleKeepMask(previous, source, item.identity);
    const next = new Map(recordsRef.current);
    next.set(item.identity, {
      sourceIdentity: item.identity,
      label: item.label,
      width: source.width,
      height: source.height,
      ...(maskBounds(keepMask) ? { keepMask } : {}),
      ...cacheAutomaticRaster(automatic.raster),
      automaticConfigurationIdentity: props.configurationIdentity,
      sessionIdentity: automatic.sessionIdentity,
      ...(automatic.diagnostics ? { diagnostics: automatic.diagnostics } : {}),
    });
    if (item.identity === selectedIdentity) {
      setActivePreview({ identity: item.identity, source, automatic: automatic.raster });
    }
    emitRecords(boundAutomaticCache(next, item.identity), false);
  };

  const runPreparation = async (all: boolean): Promise<void> => {
    if (busy || props.disabled || props.mode === 'none') return;
    const targets = all ? props.items : selectedItem ? [selectedItem] : [];
    if (targets.length === 0) return;
    setBusy(true);
    setStatus(null);
    const current = resources();
    try {
      for (let index = 0; index < targets.length; index++) {
        await prepareOne(current, targets[index]!, { index: index + 1, total: targets.length });
      }
      setStatus(`自動去背已準備：${targets.length} 個來源；現在可用 Restore Original 修正。`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setStatus('準備已取消。');
      else setStatus(`準備失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Automatic preview bytes are retained; model workers and prepared
      // sessions are not. Always-mounted hidden tabs must not pin one model
      // runtime per workflow after preparation completes.
      disposeSlot(current);
      setBusy(false);
    }
  };

  const changeMask = (identity: string, mask: KeepMask): void => {
    const record = recordsRef.current.get(identity);
    if (!record) return;
    const next = new Map(recordsRef.current);
    if (maskBounds(mask)) next.set(identity, { ...record, keepMask: mask });
    else {
      const { keepMask: _mask, ...withoutMask } = record;
      next.set(identity, withoutMask);
    }
    emitRecords(next);
  };

  const clearAll = (): void => {
    const next = new Map<string, ForegroundCorrectionRecord>();
    for (const [identity, record] of recordsRef.current) {
      next.set(identity, {
        ...record,
        keepMask: undefined,
      });
    }
    emitRecords(next);
  };

  const copyCurrentToAll = async (): Promise<void> => {
    if (!selectedItem || !selectedRecord || !edited(selectedRecord) || busy) return;
    setBusy(true);
    try {
      if (!selectedRecord.keepMask) return;
      const compatible: Array<{ item: ForegroundCorrectionSourceItem; source: Raster }> = [];
      const skipped: Array<{ item: ForegroundCorrectionSourceItem; source: Raster }> = [];
      for (const item of props.items) {
        const source = await loadSource(item);
        (source.width === selectedRecord.width && source.height === selectedRecord.height
          ? compatible
          : skipped).push({ item, source });
      }
      const targetLabels = compatible.map(({ item }) => item.label).join('、');
      const summary = `將目前座標的修正複製到 ${compatible.length} 個來源：${targetLabels}`
        + (skipped.length ? `\n略過 ${skipped.length} 個尺寸不同來源。` : '')
        + '\n這是座標複製，不是動態追蹤。確定套用？';
      if (!globalThis.confirm(summary)) return;
      const next = new Map(recordsRef.current);
      for (const { item, source } of compatible) {
        const previous = next.get(item.identity);
        next.set(item.identity, {
          ...(previous ?? {
            sourceIdentity: item.identity,
            label: item.label,
            width: source.width,
            height: source.height,
          }),
          // Keep masks are immutable by convention; sharing identical bulk
          // copies avoids one full-frame allocation per animation frame.
          keepMask: selectedRecord.keepMask,
        });
      }
      emitRecords(next);
      setStatus(`已座標複製到 ${compatible.length} 個來源；未使用追蹤。`);
    } finally {
      setBusy(false);
    }
  };

  if (props.mode === 'none' || props.items.length === 0) return null;
  const diagnostics = selectedRecord?.diagnostics;
  return (
    <section className="foreground-correction-workspace" aria-label="前景保留與還原">
      <h3>保留／還原原始內容</h3>
      <p className="tab-desc">
        先準備自動去背預覽，再用 Restore Original 畫回被誤刪的文字、手指或裝飾。Clear Correction
        只會回到自動去背結果，不會繼續挖透明。
      </p>
      <div className="run-row">
        <label>
          編輯來源
          <select
            aria-label="還原筆刷來源"
            value={selectedItem?.identity ?? ''}
            disabled={busy || props.disabled}
            onChange={(event) => setSelectedIdentity(event.target.value)}
          >
            {props.items.map((item) => (
              <option key={item.identity} value={item.identity}>
                {edited(props.records.get(item.identity)) ? '● ' : ''}{item.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy || props.disabled || !selectedItem} onClick={() => void runPreparation(false)}>
          {selectedRecord?.automaticCompressed ? '重新準備目前來源' : '準備目前來源'}
        </button>
        <button className="btn" disabled={busy || props.disabled} onClick={() => void runPreparation(true)}>
          準備全部來源
        </button>
        {props.items.length > 1 && (
          <button
            className="btn"
            disabled={busy || props.disabled || !selectedRecord || !edited(selectedRecord)}
            onClick={() => void copyCurrentToAll()}
          >
            複製目前修正到全部來源…
          </button>
        )}
        {busy && <button className="btn" onClick={() => disposeResources()}>取消準備</button>}
        <span className="model-status">已修正 {editedCount}/{props.items.length}</span>
      </div>
      {status && <p className="model-status" role="status">{status}</p>}
      {selectedItem && selectedRecord && selectedMask && activePreview?.identity === selectedItem.identity && (
        <ForegroundCorrectionEditor
          key={selectedItem.identity}
          source={activePreview.source}
          automatic={activePreview.automatic}
          mask={selectedMask}
          onMaskChange={(mask) => changeMask(selectedItem.identity, mask)}
          sourceIdentity={selectedItem.identity}
          label={selectedItem.label}
          disabled={busy || props.disabled}
          status={`自動結果版本：${selectedRecord.sessionIdentity ?? 'unknown'}`}
          diagnostics={diagnostics && (
            <>
              {diagnostics.detectedColor && `背景 ${hexColor(diagnostics.detectedColor)}；`}
              {`信心 ${Math.round(diagnostics.confidence * 100)}%；`}
              {diagnostics.warnings.map((warning) => <span key={warning}> ⚠ {warning}</span>)}
            </>
          )}
          onClearAll={clearAll}
        />
      )}
    </section>
  );
}
