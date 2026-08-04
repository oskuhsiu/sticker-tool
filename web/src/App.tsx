/**
 * sticker-tool web：既有四個 CLI workflow，加上獨立的影片轉 APNG 專案流程。
 * （init 不需要——網頁表單即設定檔；AI 產圖不內建——用 Prompt 分頁接外部工具。）
 */

import { useEffect, useState } from 'react';
import { BuildTab } from './ui/BuildTab.jsx';
import { SheetTab } from './ui/SheetTab.jsx';
import { AnimTab } from './ui/AnimTab.jsx';
import { ColabBirefnetGuide } from './ui/ColabBirefnetGuide.jsx';
import { PromptTab } from './ui/PromptTab.jsx';
import { VideoTab } from './ui/VideoTab.jsx';
import { ColabBirefnetConnectionProvider } from './ui/colabBirefnetConnection.jsx';

const TABS = [
  { key: 'build', label: '本機圖片打包', el: <BuildTab /> },
  { key: 'sheet', label: '組圖切格', el: <SheetTab /> },
  { key: 'anim', label: '動態 APNG', el: <AnimTab /> },
  { key: 'video', label: '影片 → APNG', el: <VideoTab /> },
  { key: 'prompt', label: '產圖 Prompt', el: <PromptTab /> },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function isColabBirefnetGuideHash(hash = window.location.hash): boolean {
  return hash.replace(/^#\/?/, '') === 'colab-birefnet';
}

export function App() {
  const [tab, setTab] = useState<TabKey>('build');
  const [showColabBirefnetGuide, setShowColabBirefnetGuide] = useState(
    () => isColabBirefnetGuideHash(),
  );

  useEffect(() => {
    const handleHashChange = () => setShowColabBirefnetGuide(isColabBirefnetGuideHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <ColabBirefnetConnectionProvider>
      <div className="app">
        {/* Keep all workflows mounted while the independent guide is open. */}
        <div hidden={showColabBirefnetGuide}>
          <header>
            <h1>sticker-tool</h1>
            <p>
              LINE 貼圖與 Emoji 打包工具——去背、切格、縮放置中、描邊、疊字、APNG、全螢幕貼圖、上架包驗證。
              預設在瀏覽器內處理；只有你主動啟用自己的 Colab session 時，裁切格才會送到該臨時 endpoint。
            </p>
            <a className="app-guide-link" href="#/colab-birefnet">Colab + BiRefNet 教學</a>
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
              規格：一般靜態 ≤370×320、大貼圖 80×524–396×660、動態 ≤320×270（一邊 ≥270）、
              全螢幕 APNG ≤480×480（一邊須為 480）、Emoji 固定 180×180；貼圖與靜態 Emoji 單檔 ≤1MB，
              動態 Emoji 單檔 ≤300KB，透明 PNG/APNG；貼圖維持規格要求的偶數長寬。
              一般／大貼圖張數為 8／16／24／32／40；動態／全螢幕包為 8／16／24。
              Regular Emoji 為 8–40 張，使用三位數檔名、只有 tab.png 而沒有獨立 main.png。
              大貼圖、全螢幕包與 Emoji 另檢查 RGB 真彩色並拒絕索引色。
              詳見 <a href="https://creator.line.me/zh-hant/guideline/sticker" target="_blank" rel="noreferrer">一般貼圖規範</a>
              {' '}、<a href="https://creator.line.me/zh-hant/guideline/bigsticker/" target="_blank" rel="noreferrer">大貼圖規範</a>
              {' '}、<a href="https://creator.line.me/zh-hant/guideline/popupsticker/" target="_blank" rel="noreferrer">全螢幕貼圖規範</a>
              {' '}、<a href="https://creator.line.me/en/guideline/emoji/" target="_blank" rel="noreferrer">Emoji 規範</a>
              {' '}與 <a href="https://creator.line.me/en/guideline/animationemoji/" target="_blank" rel="noreferrer">動態 Emoji 規範</a>。
            </p>
          </footer>
        </div>
        {showColabBirefnetGuide && <ColabBirefnetGuide />}
      </div>
    </ColabBirefnetConnectionProvider>
  );
}
