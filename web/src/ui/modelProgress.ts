/**
 * 去背模型下載進度 → UI 字串（首次去背要抓 ~80MB，必須讓使用者看得到在動）。
 */

import { useEffect, useState } from 'react';
import { setModelProgress } from '../webpipe/removeBackground.js';

export function useModelProgress(): string | null {
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    setModelProgress((key, current, total) => {
      if (current >= total) {
        setStatus(null);
        return;
      }
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      const name = key.replace(/^fetch:/, '').split('/').pop() ?? key;
      setStatus(`下載去背資源 ${name}：${pct}%（首次使用需下載模型，之後走瀏覽器快取）`);
    });
    return () => setModelProgress(undefined);
  }, []);
  return status;
}
