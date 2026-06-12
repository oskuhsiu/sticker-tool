import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // 依賴（sharp/@imgly/upng-js…）保持 external，從 node_modules 解析；
  // 自家 src 打包進單一檔。native 模組必須 external。
  // shebang 由 entry（src/cli/index.ts 第一行）自動保留，毋須 banner。
  shims: false,
});
