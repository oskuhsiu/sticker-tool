/**
 * sticker-tool web：既有四個 CLI workflow，加上獨立的影片轉 APNG 專案流程。
 * （init 不需要——網頁表單即設定檔；AI 產圖不內建——用 Prompt 分頁接外部工具。）
 */

import { useState } from 'react';
import { BuildTab } from './ui/BuildTab.jsx';
import { SheetTab } from './ui/SheetTab.jsx';
import { AnimTab } from './ui/AnimTab.jsx';
import { PromptTab } from './ui/PromptTab.jsx';
import { VideoTab } from './ui/VideoTab.jsx';

const TABS = [
  { key: 'build', label: '本機圖片打包', el: <BuildTab /> },
  { key: 'sheet', label: '組圖切格', el: <SheetTab /> },
  { key: 'anim', label: '動態 APNG', el: <AnimTab /> },
  { key: 'video', label: '影片 → APNG', el: <VideoTab /> },
  { key: 'prompt', label: '產圖 Prompt', el: <PromptTab /> },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function App() {
  const [tab, setTab] = useState<TabKey>('build');
  return (
    <div className="app">
      <header>
        <h1>sticker-tool</h1>
        <p>
          LINE 貼圖打包工具——去背、切格、縮放置中、描邊、疊字、APNG、上架包驗證。
          全程在你的瀏覽器內運算，圖片不會離開這台裝置。
        </p>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      {/* 全部掛載、只顯示當前分頁：切換分頁不丟已上傳檔案與處理結果 */}
      <main>
        {TABS.map((t) => (
          <div key={t.key} data-tab={t.key} style={{ display: t.key === tab ? 'block' : 'none' }}>
            {t.el}
          </div>
        ))}
      </main>
      <footer>
        <p>
          規格：靜態 ≤370×320、動態 ≤320×270（一邊 ≥270）、單檔 ≤1MB、偶數長寬、透明 PNG/APNG、循環 1–4。
          詳見 <a href="https://creator.line.me/zh-hant/guideline/sticker" target="_blank" rel="noreferrer">LINE Creators Market 規範</a>。
        </p>
      </footer>
    </div>
  );
}
