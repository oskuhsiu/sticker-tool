#!/usr/bin/env node
// 把 prompt 寫進 / 讀出 PNG 的 iTXt chunk（鍵名 prompt，UTF-8）。零依賴（只用 node 內建）。
//
// 用法：
//   node png-prompt.mjs embed <檔.png> <prompt檔.txt>   # 把 prompt 檔內容寫進 PNG（覆寫原檔）
//   node png-prompt.mjs embed <檔.png> --text "<字串>"   # 直接給字串
//   node png-prompt.mjs read  <檔.png>                   # 印出 PNG 內的 prompt
//
// 為什麼用 iTXt 不用 EXIF：codex 出的是 PNG；PNG 的正統文字中繼資料是 text chunk
// （tEXt/zTXt/iTXt），iTXt 支援 UTF-8。EXIF 是 JPEG/TIFF 的東西，PNG 支援差。

import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const KEYWORD = 'prompt';

/** 切出所有 chunk 的位置資訊 */
function listChunks(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('不是合法 PNG');
  const out = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    out.push({ start: off, end: off + 12 + len, type, dataStart: off + 8, len });
    off += 12 + len;
  }
  return out;
}

/** 組一個 iTXt chunk（uncompressed）：keyword \0 cf cm lang\0 transkw\0 text */
function makeITXt(keyword, text) {
  const kw = Buffer.from(keyword, 'latin1');
  const txt = Buffer.from(text, 'utf8');
  // keyword + null + compressionFlag(0) + compressionMethod(0) + langTag null + transKeyword null + text
  const data = Buffer.concat([kw, Buffer.from([0, 0, 0, 0, 0]), txt]);
  const type = Buffer.from('iTXt', 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0, 0);
  return Buffer.concat([len, type, data, crc]);
}

/** 解析某個 text chunk 的 {keyword, text}（支援 tEXt / iTXt；其餘回 null） */
function parseText(buf, c) {
  const data = buf.subarray(c.dataStart, c.dataStart + c.len);
  const nul = data.indexOf(0);
  if (nul < 0) return null;
  const keyword = data.toString('latin1', 0, nul);
  if (c.type === 'tEXt') return { keyword, text: data.toString('latin1', nul + 1) };
  if (c.type === 'iTXt') {
    // nul, compFlag, compMethod, langTag\0, transKw\0, text
    let p = nul + 1;
    const compFlag = data[p++];
    p++; // compMethod
    const langEnd = data.indexOf(0, p);
    p = langEnd + 1;
    const transEnd = data.indexOf(0, p);
    p = transEnd + 1;
    const raw = data.subarray(p);
    const text = compFlag === 1 ? zlib.inflateSync(raw).toString('utf8') : raw.toString('utf8');
    return { keyword, text };
  }
  return null;
}

function embed(file, text) {
  const buf = readFileSync(file);
  const chunks = listChunks(buf);
  // 先剔除既有的 prompt text chunk（重複嵌入時保持乾淨）
  const drop = new Set();
  for (const c of chunks) {
    if (c.type === 'tEXt' || c.type === 'iTXt') {
      const t = parseText(buf, c);
      if (t && t.keyword === KEYWORD) drop.add(c.start);
    }
  }
  const iend = chunks.find((c) => c.type === 'IEND');
  if (!iend) throw new Error('PNG 缺 IEND');
  const parts = [];
  let cursor = 0;
  for (const c of chunks) {
    if (drop.has(c.start)) {
      parts.push(buf.subarray(cursor, c.start));
      cursor = c.end;
    }
  }
  parts.push(buf.subarray(cursor)); // 其餘（含 IEND）
  const cleaned = Buffer.concat(parts);
  // 在 IEND 前插入新 iTXt
  const c2 = listChunks(cleaned);
  const iend2 = c2.find((c) => c.type === 'IEND');
  const out = Buffer.concat([
    cleaned.subarray(0, iend2.start),
    makeITXt(KEYWORD, text),
    cleaned.subarray(iend2.start),
  ]);
  writeFileSync(file, out);
  return text.length;
}

function read(file) {
  const buf = readFileSync(file);
  for (const c of listChunks(buf)) {
    if (c.type === 'tEXt' || c.type === 'iTXt') {
      const t = parseText(buf, c);
      if (t && t.keyword === KEYWORD) return t.text;
    }
  }
  return null;
}

const [cmd, file, arg, arg2] = process.argv.slice(2);
try {
  if (cmd === 'embed') {
    const text = arg === '--text' ? arg2 ?? '' : readFileSync(arg, 'utf8');
    const n = embed(file, text);
    console.log(`✓ 已嵌入 prompt（${n} 字）→ iTXt[prompt] of ${file}`);
  } else if (cmd === 'read') {
    const t = read(file);
    if (t == null) {
      console.error('（此 PNG 沒有 iTXt[prompt]）');
      process.exit(2);
    }
    console.log(t);
  } else {
    console.error('用法：png-prompt.mjs embed <png> <prompt.txt>|--text "..."  |  read <png>');
    process.exit(1);
  }
} catch (e) {
  console.error('錯誤：', e.message);
  process.exit(1);
}
