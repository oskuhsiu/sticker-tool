import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const here = path.dirname(fileURLToPath(import.meta.url));

// base './'：產物用相對路徑，GitHub Pages 的 project page（/repo/）或任何子路徑都能直接 serve。
export default defineConfig({
  base: './',
  plugins: [
    react(),
    // @imgly 去背的 onnx 模型 + wasm 自託管（同源），不依賴第三方 CDN、也不怕 COEP 擋跨域。
    viteStaticCopy({
      targets: [
        {
          src: path.join(here, 'node_modules/@imgly/background-removal-data/dist/*'),
          dest: 'imgly',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@core': path.join(here, '../src/core'),
    },
  },
  server: {
    fs: { allow: [path.join(here, '..')] },
  },
  build: {
    chunkSizeWarningLimit: 2500,
  },
});
