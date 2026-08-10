import { useMemo, useState } from 'react';
import notebookSource from '../../../examples/colab/sticker-tool-birefnet-colab.ipynb?raw';
import {
  colabBirefnetEndpointHost,
  createColabBirefnetConnectionConfig,
  normalizeColabBirefnetEndpointUrl,
} from '../webpipe/colabBirefnet.js';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';

const NOTEBOOK_FILENAME = 'sticker-tool-birefnet-colab.ipynb';
const COLAB_URL = 'https://colab.research.google.com/github/oskuhsiu/sticker-tool/blob/master/examples/colab/sticker-tool-birefnet-colab.ipynb';

function endpointPreview(value: string): string | null {
  try {
    return colabBirefnetEndpointHost(normalizeColabBirefnetEndpointUrl(value));
  } catch {
    return null;
  }
}

export function ColabBirefnetGuide() {
  const { connection, setConnection, forgetConnection } = useColabBirefnetConnection();
  const [endpointUrl, setEndpointUrl] = useState('');
  const [sessionKey, setSessionKey] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const endpointHost = useMemo(() => endpointPreview(endpointUrl), [endpointUrl]);

  function downloadNotebook() {
    const url = URL.createObjectURL(new Blob([notebookSource], { type: 'application/x-ipynb+json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = NOTEBOOK_FILENAME;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function configureConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setNotice('');
    try {
      const config = createColabBirefnetConnectionConfig({ endpointUrl, sessionKey });
      setConnection(config);
      setSessionKey('');
      setNotice(`已設定 ${colabBirefnetEndpointHost(config.endpointUrl)}；session key 只留在本次頁面記憶體。`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  function forget() {
    forgetConnection();
    setNotice('已清除本次頁面的 Colab endpoint 與 session key。');
    setFormError('');
  }

  return (
    <main className="colab-guide" data-page="colab-birefnet">
      <a className="colab-guide-back" href="#/">← 回 sticker-tool</a>
      <header className="colab-guide-header">
        <p className="colab-guide-eyebrow">使用自己的臨時運算資源</p>
        <h1>在 Google Colab 啟動多模型去背</h1>
        <p>
          Notebook 可一次選一個去背模型，並先用內建測試圖量測實際速度；你確認可接受後，才啟動臨時 HTTPS endpoint。
          原始影片不會上傳，sticker-tool 只依序送出每張已裁切的 PNG。
        </p>
      </header>

      <section className="colab-guide-card colab-guide-warning">
        <h2>這不是永久服務</h2>
        <p>
          免費 Colab 沒有保證或無限執行時間，會有 idle timeout，單一 runtime 最長通常不超過 12 小時。
          Notebook 或最後一格停止後，臨時 URL 立即失效；下次要重新 Run All 並貼回新的 URL 與 session key。
        </p>
        <p>
          Cloudflare Quick Tunnel 是隨機公開網址，因此 Notebook 會另外產生本次 runtime 專用 session key。
          網站只接受 <code>*.trycloudflare.com/remove</code>，禁止 redirect，且不會把連線資料寫入 storage、URL、下載檔、log 或 Project ZIP。
        </p>
      </section>

      <section className="colab-guide-card">
        <h2>1. 開啟 Notebook</h2>
        <div className="colab-guide-actions">
          <a className="btn primary" href={COLAB_URL} target="_blank" rel="noreferrer">
            直接在 Colab 開啟
          </a>
          <button className="btn" type="button" onClick={downloadNotebook}>
            下載 Notebook（.ipynb）
          </button>
        </div>
        <p className="tab-desc">
          若「直接開啟」尚未看到最新版，先下載檔案，再到
          <a href="https://colab.research.google.com/" target="_blank" rel="noreferrer"> Colab</a>
          的 Upload 分頁上傳。Notebook 不需要 Google Drive、雲端 API key 或 tunnel 帳號。
        </p>
      </section>

      <section className="colab-guide-card">
        <h2>2. 選模型與運算裝置</h2>
        <p>Notebook 第一個設定格提供 <code>MODEL_CHOICE</code>。同一時間只會載入一個模型：</p>
        <ul>
          <li><strong>BiRefNet lite：</strong>較省記憶體、啟動與推論通常較快；細小或複雜邊界可能不如較大的模型。</li>
          <li><strong>BiRefNet full：</strong>一般用途的大型版本，通常比 lite 慢且占用更多 VRAM。</li>
          <li><strong>BiRefNet dynamic：</strong>保留來源長寬比並以最長邊限制推論尺寸，適合非正方形 crop；仍可能漏掉細線、文字或半透明特效。</li>
          <li><strong>BiRefNet matting：</strong>偏向產生柔和 alpha 與毛髮等細緻邊緣；不代表每種素材都比 segmentation 模型乾淨。</li>
          <li><strong>BEN2：</strong>通用前景分離模型，可作為 BiRefNet 以外的品質比較；速度與邊界表現依素材而異。</li>
          <li><strong>MODNet Portrait：</strong>輕量人物 matting，只適合真人肖像，不應當成一般角色／物件模型。</li>
          <li><strong>IS-Net general / anime：</strong>general 是通用顯著物件分離；anime 偏向動漫與插畫。選錯領域可能降低結果品質。</li>
          <li><strong>U2Net / U2NetP：</strong>成熟的通用基準；U2NetP 更小、更快，但通常犧牲細節與複雜邊界。</li>
          <li><strong>RMBG 2.0（條件式提供）：</strong>釘選 revision 使用 BRIA 的 <code>bria-rmbg-2.0</code> 自訂授權；本 Notebook 只開放非商用評估。請先接受 gated 條款，並於 Colab Secrets 設定 <code>HF_TOKEN</code>；商業權利需另行確認。</li>
          <li><strong>auto / gpu / cpu：</strong>auto 有 CUDA 就用 GPU，否則使用 CPU；gpu 在無 CUDA 時會直接報錯。</li>
          <li><strong>輸入尺寸：</strong>固定尺寸模型使用正方形輸入；dynamic 以設定值作為最長邊上限，並將寬高調整到模型需要的倍數。</li>
          <li><strong>1 / 3 benchmark runs：</strong>第一次先跑 1 次；要較穩定的中位數再選 3 次。</li>
        </ul>
        <p className="tab-desc">
          所有選項都只輸出前景 mask，不保證保留文字、細線、透明材質、發光、煙霧或其他特效；請以實際 crop 預覽判斷。
          需要文字 prompt、trimap、乾淨背景（clean plate）或跨 frame 影片狀態的模型，不是這個逐張、無狀態 API 的下拉選項。
        </p>
        <p className="tab-desc">
          Colab 可能預裝與這組固定版本衝突的 Google ADK、Gradio 與 FastHTML。安裝格會先移除這三個
          Notebook 完全不使用的套件；只影響本次臨時 runtime，刪除 runtime 後即還原。
        </p>
      </section>

      <section className="colab-guide-card">
        <h2>3. 先跑 astronaut 測試圖</h2>
        <p>
          Notebook 使用 scikit-image 內建的經典 <code>astronaut</code> 測試圖，顯示原圖、灰階 mask、
          透明合成結果、實際推論尺寸，以及模型載入時間與每張 crop 的實測秒數。這一步不需要你的圖片。
        </p>
        <p>
          回到影片頁查看「master 時間點 × 裁切格數」。大約推論時間是
          <code> benchmark 中位數 × 請求數</code>，還沒包含影片解碼、PNG 上傳與 APNG 編碼。
          若 CPU 結果太慢，就停在 benchmark，改選 GPU 或降低模型／輸入尺寸。
        </p>
      </section>

      <section className="colab-guide-card">
        <h2>4. 啟動 API 並貼回連線資料</h2>
        <ol>
          <li>只有 benchmark 可接受時，才執行最後一格。</li>
          <li>保持最後一格持續執行；不要關閉或停止 Colab runtime。</li>
          <li>複製輸出的 <strong>Endpoint URL</strong> 與 <strong>Session key</strong> 到下方表單。</li>
          <li>回「影片 → APNG」，選擇 Colab 多模型去背，先用 1 格 × 10 時間點測試。</li>
          <li>完成後停止最後一格，並在 Colab 選 Disconnect and delete runtime。</li>
        </ol>
      </section>

      <section className="colab-guide-card">
        <h2>在同一張 T4 切換模型</h2>
        <ol>
          <li>先停止最後一個正在執行的 API cell，等目前請求結束；不要在一批處理途中切換。</li>
          <li>回到設定格修改 <code>MODEL_CHOICE</code>，再選 <strong>Runtime → Run all</strong>。</li>
          <li>不需要 disconnect 或 delete runtime；已下載的套件與模型 weights cache 會留在同一個 runtime，若新模型尚未下載才會補抓。</li>
          <li>Run all 會只載入新選的那一個模型，並建立新的 tunnel 與 session key。</li>
          <li>把新的 <strong>Endpoint URL</strong> 與 <strong>Session key</strong> 重新貼到下方表單；舊連線資料不能沿用。</li>
        </ol>
        <p className="tab-desc">
          一次只載入一個模型可控制 T4 VRAM 用量。請先完成或取消整批工作，再切換模型並重跑；不要讓同一批 crop 混用不同模型。
        </p>
      </section>

      <section className="colab-guide-card">
        <h2>只為本次頁面設定 Colab session</h2>
        <form className="colab-connection-form" onSubmit={configureConnection}>
          <label>
            <span>Endpoint URL</span>
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://random-words.trycloudflare.com/remove"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Session key</span>
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder="Notebook 最後一格輸出的隨機值"
              value={sessionKey}
              onChange={(event) => setSessionKey(event.target.value)}
              required
            />
          </label>
          <button className="btn primary" type="submit">
            {endpointHost ? `只在本次頁面使用 ${endpointHost}` : '只在本次頁面使用此 Colab session'}
          </button>
        </form>
        {formError && <p className="colab-form-error" role="alert">{formError}</p>}
        {notice && <p className="colab-form-notice" role="status">{notice}</p>}
        {connection && (
          <div className="colab-connection-active">
            <span>本次頁面已設定：<strong>{colabBirefnetEndpointHost(connection.config.endpointUrl)}</strong></span>
            <button className="btn small" type="button" onClick={forget}>清除這次頁面的設定</button>
          </div>
        )}
      </section>

      <section className="colab-guide-card colab-guide-warning">
        <h2>資料與效能邊界</h2>
        <ul>
          <li>每次只上傳一張裁切格；不會上傳原始影片、音訊、完整來源 frame 或 Project ZIP。</li>
          <li>請求會依序執行，不會自動 retry；CPU runtime 上大量 crop 可能需要很久。</li>
          <li>取消會停止排入下一張 crop；已送出的當次推論仍可能在 Colab 完成。</li>
          <li>Colab 與 Quick Tunnel 都是第三方服務，使用者要自行評估是否適合處理素材。</li>
        </ul>
        <p className="tab-desc">
          參考：
          <a href="https://research.google.com/colaboratory/faq.html" target="_blank" rel="noreferrer"> Colab resource limits</a>、
          <a href="https://huggingface.co/ZhengPeng7/BiRefNet_lite" target="_blank" rel="noreferrer"> BiRefNet_lite</a>、
          <a href="https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/" target="_blank" rel="noreferrer"> Quick Tunnels</a>。
        </p>
      </section>
    </main>
  );
}
