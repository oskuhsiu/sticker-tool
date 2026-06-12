#!/usr/bin/env node
// openrouter.mjs — OpenRouter (openrouter.ai) 轉接器：把 agent 的請求送到
// OpenRouter 統一 API，並把回覆與用量帶回。零依賴，Node >= 20。
//
// 子指令：
//   chat    送出對話請求（預設子指令）
//   models  列出／搜尋可用模型（公開端點，不需 key）
//   check   診斷：key 來源、連線、額度
//
// 詳細參數見同 skill 的 SKILL.md 與 references/api.md。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://openrouter.ai/api/v1";
// key 來源優先序：env → 專案 .claude/openrouter.key（已 gitignore）→ ~/.config/openrouter/key
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const KEY_FILES = [
  join(SCRIPT_DIR, "..", "..", "..", "openrouter.key"),
  join(homedir(), ".config", "openrouter", "key"),
];

function out(s) { process.stdout.write(s); }
function note(s) { process.stderr.write(s + "\n"); }
function fail(msg, hint) {
  note(`[openrouter] 錯誤：${msg}`);
  if (hint) note(`[openrouter] 建議：${hint}`);
  process.exit(1);
}

function loadKey() {
  const env = (process.env.OPENROUTER_API_KEY || "").trim();
  if (env) return { key: env, source: "env OPENROUTER_API_KEY" };
  for (const f of KEY_FILES) {
    try {
      if (existsSync(f)) {
        const k = readFileSync(f, "utf8").trim();
        if (k) return { key: k, source: f };
      }
    } catch { /* 讀不到視同未設定 */ }
  }
  return null;
}

const KEY_HINT =
  "到 https://openrouter.ai/settings/keys 建立 key，然後擇一：" +
  `export OPENROUTER_API_KEY=...，或把 key 存進 ${KEY_FILES[0]}（chmod 600，已 gitignore）`;

// ---------- 參數解析 ----------
const argv = process.argv.slice(2);
let cmd = "chat";
if (["chat", "models", "check", "help", "--help", "-h"].includes(argv[0])) {
  cmd = argv.shift().replace(/^--?h(elp)?$/, "help");
}

function parseFlags(spec) {
  // spec: { "-m,--model": "value", "--online": "bool", ... }
  const lookup = {};
  for (const [names, kind] of Object.entries(spec))
    for (const n of names.split(",")) lookup[n] = { canon: names.split(",").pop(), kind };
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const hit = lookup[a];
    if (!hit) {
      if (a.startsWith("-")) fail(`不認得的參數 ${a}`, "跑 help 看用法");
      opts._.push(a);
      continue;
    }
    if (hit.kind === "bool") opts[hit.canon] = true;
    else {
      const v = argv[++i];
      if (v === undefined) fail(`${a} 需要值`);
      if (hit.kind === "list") (opts[hit.canon] ||= []).push(v);
      else opts[hit.canon] = v;
    }
  }
  return opts;
}

// ---------- HTTP ----------
async function call(path, { method = "GET", body, key, timeoutSec = 120 } = {}) {
  const headers = { "Content-Type": "application/json", "X-Title": "claude-code openrouter skill" };
  if (key) headers.Authorization = `Bearer ${key}`;
  const doFetch = () =>
    fetch(API + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutSec * 1000),
    });
  let res;
  try {
    res = await doFetch();
    if ([429, 500, 502, 503, 504].includes(res.status)) {
      note(`[openrouter] HTTP ${res.status}，2 秒後重試一次…`);
      await new Promise(r => setTimeout(r, 2000));
      res = await doFetch();
    }
  } catch (e) {
    if (e.name === "TimeoutError") fail(`請求逾時（${timeoutSec}s）`, "加 --timeout 放寬，或換較快的模型");
    note(`[openrouter] 網路錯誤（${e.cause?.code || e.message}），2 秒後重試一次…`);
    await new Promise(r => setTimeout(r, 2000));
    try { res = await doFetch(); }
    catch (e2) { fail(`連不上 openrouter.ai：${e2.cause?.code || e2.message}`, "檢查網路／代理"); }
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || data?.error) {
    const err = data?.error || {};
    const msg = err.message || text.slice(0, 300) || `HTTP ${res.status}`;
    const hints = {
      401: KEY_HINT,
      402: "OpenRouter 餘額不足，到 https://openrouter.ai/settings/credits 儲值",
      404: "模型 id 可能打錯或已下架——跑 `models <關鍵字>` 搜正確 id",
      429: "被限流——稍等再試，或換模型／加 :nitro",
    };
    fail(`HTTP ${res.status}：${msg}`, hints[res.status]);
  }
  return data;
}

// ---------- chat ----------
async function cmdChat() {
  const o = parseFlags({
    "-m,--model": "value", "-p,--prompt": "value", "-f,--prompt-file": "value",
    "-s,--system": "value", "-i,--image": "list", "-o,--out": "value",
    "--temperature": "value", "--max-tokens": "value", "--effort": "value",
    "--json-schema": "value", "--extra": "value", "--timeout": "value",
    "--online": "bool", "--json": "bool",
  });
  const auth = loadKey();
  if (!auth) fail("找不到 API key", KEY_HINT);

  let prompt = o["--prompt"];
  if (!prompt && o["--prompt-file"]) prompt = readFileSync(o["--prompt-file"], "utf8");
  if (!prompt && !process.stdin.isTTY) {
    prompt = "";
    for await (const chunk of process.stdin) prompt += chunk;
    prompt = prompt.trim() || undefined;
  }
  if (!prompt) fail("沒有 prompt", "用 -p \"文字\"、-f 檔案，或由 stdin 餵入");

  let model = o["--model"] || "openrouter/auto";
  if (o["--online"] && !model.includes(":")) model += ":online";

  let content = prompt;
  if (o["--image"]?.length) {
    const mimes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
    content = [{ type: "text", text: prompt }];
    for (const p of o["--image"]) {
      const mime = mimes[extname(p).toLowerCase()];
      if (!mime) fail(`不支援的圖片格式：${p}`, "用 png/jpg/webp/gif");
      const b64 = readFileSync(p).toString("base64");
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
    }
  }

  const messages = [];
  if (o["--system"]) messages.push({ role: "system", content: o["--system"] });
  messages.push({ role: "user", content });

  const body = { model, messages, usage: { include: true } };
  if (o["--temperature"]) body.temperature = Number(o["--temperature"]);
  if (o["--max-tokens"]) body.max_tokens = Number(o["--max-tokens"]);
  if (o["--effort"]) body.reasoning = { effort: o["--effort"] };
  if (o["--json-schema"]) {
    body.response_format = { type: "json_schema", json_schema: JSON.parse(readFileSync(o["--json-schema"], "utf8")) };
  }
  if (o["--extra"]) Object.assign(body, JSON.parse(o["--extra"]));

  const t0 = Date.now();
  const data = await call("/chat/completions", {
    method: "POST", body, key: auth.key, timeoutSec: Number(o["--timeout"] || 120),
  });

  if (o["--json"]) { out(JSON.stringify(data, null, 2) + "\n"); return; }

  const choice = data.choices?.[0] || {};
  const msg = choice.message || {};
  const text = msg.content ?? "";

  // 部分模型（如圖像生成模型）會在 message.images 回傳 base64 圖片
  (msg.images || []).forEach((img, i) => {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(img?.image_url?.url || "");
    if (!m) return;
    const f = `openrouter-image-${i + 1}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
    writeFileSync(f, Buffer.from(m[2], "base64"));
    note(`[openrouter] 模型回傳圖片 → ${f}`);
  });

  if (text) {
    out(text.endsWith("\n") ? text : text + "\n");
    if (o["--out"]) writeFileSync(o["--out"], text);
  } else {
    note("[openrouter] 注意：回覆正文是空的" + (msg.reasoning ? "（只有 reasoning）" : "") + "，用 --json 看原始回應");
  }

  const u = data.usage || {};
  const cost = u.cost != null ? ` cost=$${Number(u.cost).toPrecision(3)}` : "";
  const finish = choice.finish_reason && choice.finish_reason !== "stop" ? ` finish=${choice.finish_reason}!` : "";
  note(`[openrouter] model=${data.model} in=${u.prompt_tokens ?? "?"} out=${u.completion_tokens ?? "?"}${cost}${finish} ${(Date.now() - t0) / 1000}s`);
  if (choice.finish_reason === "length") note("[openrouter] 回覆因 max_tokens 被截斷，視需要加 --max-tokens");
}

// ---------- models ----------
async function cmdModels() {
  const o = parseFlags({ "--json": "bool" });
  const term = (o._[0] || "").toLowerCase();
  const data = await call("/models");
  let list = data.data || [];
  if (term) list = list.filter(m => (m.id + " " + (m.name || "")).toLowerCase().includes(term));
  list.sort((a, b) => a.id.localeCompare(b.id));
  if (o["--json"]) { out(JSON.stringify(list, null, 2) + "\n"); return; }
  const perM = v => (Number(v) * 1e6).toFixed(2);
  const rows = list.slice(0, 40).map(m =>
    `${m.id}  [ctx ${m.context_length}]  $${perM(m.pricing?.prompt)}/M in, $${perM(m.pricing?.completion)}/M out`);
  out(rows.join("\n") + "\n");
  note(`[openrouter] 符合 ${list.length} 個模型${list.length > 40 ? "（只列前 40，加關鍵字縮小範圍）" : ""}`);
}

// ---------- check ----------
async function cmdCheck() {
  const auth = loadKey();
  note(`key：${auth ? "已設定（來源：" + auth.source + "）" : "未設定"}`);
  const data = await call("/models");
  note(`連線：OK（可用模型 ${data.data?.length ?? "?"} 個）`);
  if (auth) {
    const k = await call("/key", { key: auth.key });
    const d = k.data || {};
    note(`額度：label=${d.label ?? "-"} usage=$${d.usage ?? "?"} limit=${d.limit == null ? "無上限" : "$" + d.limit}`);
  } else {
    note(`chat 不可用——${KEY_HINT}`);
  }
}

// ---------- help ----------
function cmdHelp() {
  out(`用法：openrouter.mjs <chat|models|check> [參數]

chat（預設）：
  -m, --model <id>        模型 id（預設 openrouter/auto）
  -p, --prompt <text>     提示詞；長文改用 -f 或 stdin
  -f, --prompt-file <p>   從檔案讀提示詞
  -s, --system <text>     system prompt
  -i, --image <path>      附圖（可重複；png/jpg/webp/gif）
  -o, --out <path>        回覆另存檔案
  --temperature / --max-tokens / --effort low|medium|high
  --json-schema <file>    structured outputs（response_format 的 json_schema 物件）
  --extra '<json>'        進階參數直接併入 request body
  --online                模型 id 加 :online（聯網搜尋）
  --json                  印原始 JSON 回應
  --timeout <sec>         預設 120

models [關鍵字] [--json]   搜尋模型 id 與價格（不需 key）
check                      診斷 key／連線／額度
`);
}

({ chat: cmdChat, models: cmdModels, check: cmdCheck, help: cmdHelp })[cmd]().catch(e => fail(e.message));
