/**
 * 產圖 Prompt（對應 CLI `prompt`，外加動態影格模式）。
 * 不呼叫任何 AI——產生 prompt 文字，貼到你慣用的產圖工具（ChatGPT/Gemini/Midjourney…），
 * 產出的組圖再回到「組圖切格」或「動態 APNG」分頁打包。
 */

import { useMemo, useState } from 'react';
import { STATIC_SPEC } from '@core/spec.js';
import { gridDimsFor, planGrid } from '@core/grid.js';
import { buildFramesPrompt, buildSheetPrompt } from '@core/prompt.js';
import type { GridLayout } from '@core/types.js';
import { CopyButton, Field, Row } from './common.jsx';

type Mode = 'sheet' | 'frames';

const DEFAULT_STYLE = 'flat cartoon, bold black outline, pastel palette';

export function PromptTab() {
  const [mode, setMode] = useState<Mode>('sheet');
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [count, setCount] = useState(8);
  const [frames, setFrames] = useState(16);
  const [motion, setMotion] = useState('waving hand');
  const [isCharacter, setIsCharacter] = useState(true);
  const [transparent, setTransparent] = useState(true);
  const [hasReference, setHasReference] = useState(true);
  const [variationsRaw, setVariationsRaw] = useState('');

  const output = useMemo((): { prompts: { title: string; text: string }[]; warnings: string[]; error?: string } => {
    const warnings: string[] = [];
    try {
      if (mode === 'frames') {
        const n = Math.min(20, Math.max(5, frames));
        if (n !== frames) warnings.push(`影格數已夾到 LINE 允許範圍（5–20）：${n}`);
        const dims = gridDimsFor(n);
        const layout: GridLayout = { count: n, cols: dims.cols, rows: dims.rows, sheets: 1, cellsPerSheet: n };
        const text = buildFramesPrompt({ style, layout, motion, isCharacter, transparent, hasReference });
        return { prompts: [{ title: `動態影格組圖（${dims.cols}×${dims.rows}，${n} 格）`, text }], warnings };
      }

      const decision = planGrid(count, { isCharacter, forceOversizeSet: false });
      warnings.push(...decision.warnings);
      if (decision.blocked) {
        return { prompts: [], warnings, error: decision.blockReason ?? '張數配置被擋下' };
      }
      const layout = decision.layout;
      const cellVariations = variationsRaw.split('\n').filter((s) => s.trim());
      const prompts: { title: string; text: string }[] = [];
      for (let s = 0; s < layout.sheets; s++) {
        const remaining = count - s * layout.cellsPerSheet;
        const thisCount = Math.min(layout.cellsPerSheet, remaining);
        const sheetLayout: GridLayout = {
          count: thisCount,
          cols: layout.cols,
          rows: layout.rows,
          sheets: 1,
          cellsPerSheet: thisCount,
        };
        const text = buildSheetPrompt({
          style,
          layout: sheetLayout,
          isCharacter,
          transparent,
          cellVariations: cellVariations.slice(s * layout.cellsPerSheet, s * layout.cellsPerSheet + thisCount),
          hasReference,
        });
        prompts.push({
          title:
            layout.sheets > 1
              ? `大圖 ${s + 1}/${layout.sheets}（${layout.cols}×${layout.rows}，${thisCount} 格）`
              : `組圖（${layout.cols}×${layout.rows}，${thisCount} 格）`,
          text,
        });
      }
      return { prompts, warnings };
    } catch (e) {
      return { prompts: [], warnings, error: e instanceof Error ? e.message : String(e) };
    }
  }, [mode, style, count, frames, motion, isCharacter, transparent, hasReference, variationsRaw]);

  return (
    <section>
      <p className="tab-desc">
        產生餵給外部 AI 產圖工具的 prompt（本站不產圖）。建議流程：附上角色參考圖 + 這段 prompt →
        產出組圖 → 回「組圖切格」（靜態）或「動態 APNG」（影格）分頁打包。
      </p>
      <div className="mode-switch">
        <label>
          <input type="radio" checked={mode === 'sheet'} onChange={() => setMode('sheet')} />
          靜態貼圖組圖
        </label>
        <label>
          <input type="radio" checked={mode === 'frames'} onChange={() => setMode('frames')} />
          動態影格組圖
        </label>
      </div>
      <Row>
        <Field label="風格描述" grow>
          <input value={style} onChange={(e) => setStyle(e.target.value)} />
        </Field>
        {mode === 'sheet' ? (
          <Field label="張數">
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {STATIC_SPEC.counts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <Field label="影格數（5–20）">
              <input type="number" min={5} max={20} value={frames} onChange={(e) => setFrames(Number(e.target.value))} />
            </Field>
            <Field label="動作描述" grow>
              <input value={motion} onChange={(e) => setMotion(e.target.value)} />
            </Field>
          </>
        )}
      </Row>
      <Row>
        <Field label="角色包（鎖同一角色）">
          <input type="checkbox" checked={isCharacter} onChange={(e) => setIsCharacter(e.target.checked)} />
        </Field>
        <Field label="透明背景（否則綠幕）">
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
        </Field>
        <Field label="會附角色參考圖">
          <input type="checkbox" checked={hasReference} onChange={(e) => setHasReference(e.target.checked)} />
        </Field>
      </Row>
      {mode === 'sheet' && (
        <details className="advanced">
          <summary>每格表情/姿勢（選用；每行一格，不足自動補通用變化）</summary>
          <textarea
            rows={5}
            placeholder={'happy smiling, waving hello\nangry with steam\n…'}
            value={variationsRaw}
            onChange={(e) => setVariationsRaw(e.target.value)}
          />
        </details>
      )}
      {output.warnings.map((w, i) => (
        <div key={i} className="v-issue v-warning">⚠ {w}</div>
      ))}
      {output.error && <div className="v-issue v-error">✗ {output.error}</div>}
      {output.prompts.map((p, i) => (
        <div key={i} className="prompt-block">
          <div className="prompt-head">
            <strong>{p.title}</strong>
            <CopyButton text={p.text} />
          </div>
          <pre>{p.text}</pre>
        </div>
      ))}
    </section>
  );
}
