#!/usr/bin/env python3
"""card.py — OpenRouter model card 系統（零依賴，python3 stdlib）。

把某個 OpenRouter 模型的呼叫參數快照成 card（JSON），之後用 card 執行請求：

  create <模型頁URL或id>   抓模型能力與計價，寫成 cards/<alias>.json（不需 key）
  list / show <alias>      檢視已建的 card
  run <alias> ...          依 card 執行：video 卡走非同步 job（submit→poll→下載），
                           chat 卡走 chat/completions
  job <alias> --id <jobid> 續抓先前 --no-wait 送出的影片 job

進度訊息走 stderr；成果（card 路徑、回覆正文、影片檔路徑）走 stdout。
"""
import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://openrouter.ai/api/v1"
SKILL_DIR = Path(__file__).resolve().parent.parent
CARDS_DIR = SKILL_DIR / "cards"
# key 來源優先序：env → 專案 .claude/openrouter.key（已 gitignore）→ ~/.config/openrouter/key
KEY_FILES = [SKILL_DIR.parent.parent / "openrouter.key",
             Path.home() / ".config" / "openrouter" / "key"]
KEY_HINT = ("到 https://openrouter.ai/settings/keys 建立 key，然後擇一：export OPENROUTER_API_KEY=... "
            f"或把 key 存進 {KEY_FILES[0]}（chmod 600，已 gitignore）")


def note(msg):
    print(msg, file=sys.stderr)


def die(msg, hint=None):
    note(f"[card] 錯誤：{msg}")
    if hint:
        note(f"[card] 建議：{hint}")
    sys.exit(1)


def load_key(required=True):
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    for f in KEY_FILES:
        if key:
            break
        if f.exists():
            key = f.read_text().strip()
    if not key and required:
        die("找不到 API key", KEY_HINT)
    return key or None


def http(path_or_url, *, method="GET", body=None, key=None, timeout=120, raw=False):
    url = path_or_url if path_or_url.startswith("http") else API + path_or_url
    headers = {"Content-Type": "application/json", "X-Title": "claude-code openrouter skill"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                payload = res.read()
        except (urllib.error.URLError, OSError) as e:
            if isinstance(e, urllib.error.HTTPError):
                raise
            note(f"[card] 網路錯誤（{getattr(e, 'reason', e)}），2 秒後重試一次…")
            time.sleep(2)
            req2 = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req2, timeout=timeout) as res:
                payload = res.read()
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(text).get("error", {}).get("message", text[:300])
        except Exception:
            msg = text[:300]
        hints = {401: KEY_HINT,
                 402: "OpenRouter 餘額不足，到 https://openrouter.ai/settings/credits 儲值",
                 404: "模型 id 或 job id 可能不對",
                 429: "被限流——稍候再試"}
        die(f"HTTP {e.code}：{msg}", hints.get(e.code))
    except urllib.error.URLError as e:
        die(f"連不上 openrouter.ai：{e.reason}", "檢查網路／代理")
    return payload if raw else json.loads(payload)


def to_image_url(path_or_url):
    """本地檔轉 data URL；http(s) 直接放行。
    注意：官方文件示範的是公開 HTTPS URL，data URL 未明文保證——若被 4xx 拒絕，
    把圖放到可公開存取的網址再試。"""
    if re.match(r"^https?://", path_or_url):
        return path_or_url
    p = Path(path_or_url)
    if not p.exists():
        die(f"找不到圖檔：{path_or_url}")
    mime = mimetypes.guess_type(p.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


def parse_model_ref(ref):
    m = re.match(r"^https?://openrouter\.ai/([\w.-]+/[\w.:-]+)", ref)
    return m.group(1) if m else ref


def card_path(alias):
    return CARDS_DIR / f"{alias}.json"


def load_card(alias):
    p = card_path(alias)
    if not p.exists():
        have = ", ".join(sorted(c.stem for c in CARDS_DIR.glob("*.json"))) or "（沒有任何 card）"
        die(f"沒有叫 {alias} 的 card", f"現有 card：{have}；用 create 子指令建立")
    return json.loads(p.read_text())


# ---------- create ----------
def cmd_create(args):
    model_id = parse_model_ref(args.model)
    alias = args.alias or model_id.split("/")[-1].split(":")[0]
    video_cat = {m["id"]: m for m in http("/videos/models")["data"]}
    card = {
        "alias": alias,
        "model": model_id,
        "source_url": f"https://openrouter.ai/{model_id}",
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "defaults": dict(kv.split("=", 1) for kv in args.default or []),
    }
    if model_id in video_cat:
        m = video_cat[model_id]
        card.update(kind="video", name=m.get("name"), description=m.get("description"),
                    capabilities={k: m.get(k) for k in (
                        "supported_resolutions", "supported_aspect_ratios", "supported_sizes",
                        "supported_durations", "supported_frame_images", "generate_audio", "seed",
                        "allowed_passthrough_parameters")},
                    pricing_skus=m.get("pricing_skus"))
    else:
        data = http(f"/models/{model_id}/endpoints").get("data")
        if not data:
            die(f"OpenRouter 上找不到模型 {model_id}",
                "影片模型查 /videos/models、一般模型查 /models；確認模型頁 URL 是否正確")
        ep = (data.get("endpoints") or [{}])[0]
        arch = data.get("architecture") or {}
        card.update(kind="chat", name=data.get("name"), description=data.get("description"),
                    architecture={"input_modalities": arch.get("input_modalities"),
                                  "output_modalities": arch.get("output_modalities")},
                    context_length=ep.get("context_length"),
                    supported_parameters=ep.get("supported_parameters"),
                    pricing=ep.get("pricing"))
        if "video" in (arch.get("output_modalities") or []):
            note("[card] 注意：這是影片模型但不在 /videos/models 目錄，run 可能不適用")
    CARDS_DIR.mkdir(parents=True, exist_ok=True)
    card_path(alias).write_text(json.dumps(card, ensure_ascii=False, indent=2))
    note(f"[card] kind={card['kind']} model={model_id}")
    if card["kind"] == "video":
        cap = card["capabilities"]
        note(f"[card] durations={cap.get('supported_durations')} sizes={len(cap.get('supported_sizes') or [])}種 "
             f"frame_images={cap.get('supported_frame_images')} audio={cap.get('generate_audio')}")
    print(card_path(alias))


# ---------- list / show ----------
def cmd_list(_args):
    cards = sorted(CARDS_DIR.glob("*.json"))
    if not cards:
        print("（還沒有任何 card；用 create 建立）")
        return
    for p in cards:
        c = json.loads(p.read_text())
        print(f"{c['alias']:20s} {c['kind']:5s} {c['model']}  （{c['fetched_at']} 快照）")


def cmd_show(args):
    print(json.dumps(load_card(args.alias), ensure_ascii=False, indent=2))


# ---------- run ----------
def pick_duration(card, want):
    allowed = (card.get("capabilities") or {}).get("supported_durations")
    if not allowed or want in allowed:
        return want
    nearest = min(allowed, key=lambda d: (abs(d - want), d))
    note(f"[card] 注意：{card['model']} 不支援 {want} 秒（支援 {allowed}），改用最接近的 {nearest} 秒")
    return nearest


def run_video(card, args, key):
    body = {"model": card["model"], "prompt": args.prompt}
    defaults = card.get("defaults", {})
    cap = card.get("capabilities") or {}

    duration = args.duration or defaults.get("duration")
    if duration:
        body["duration"] = pick_duration(card, int(duration))
    size = args.size or defaults.get("size")
    if size:
        if cap.get("supported_sizes") and size not in cap["supported_sizes"]:
            die(f"size {size} 不在支援清單", f"可用：{cap['supported_sizes']}")
        body["size"] = size
    elif args.resolution or defaults.get("resolution"):
        body["resolution"] = args.resolution or defaults.get("resolution")
        if args.aspect_ratio or defaults.get("aspect_ratio"):
            body["aspect_ratio"] = args.aspect_ratio or defaults.get("aspect_ratio")
    if args.seed is not None:
        body["seed"] = args.seed
    if args.no_audio or str(defaults.get("generate_audio", "")).lower() == "false":
        body["generate_audio"] = False

    frames = []
    if args.first_frame:
        frames.append({"type": "image_url", "image_url": {"url": to_image_url(args.first_frame)},
                       "frame_type": "first_frame"})
    if args.last_frame:
        frames.append({"type": "image_url", "image_url": {"url": to_image_url(args.last_frame)},
                       "frame_type": "last_frame"})
    if frames:
        body["frame_images"] = frames
    if args.ref:
        body["input_references"] = [{"type": "image_url", "image_url": {"url": to_image_url(r)}} for r in args.ref]
        if frames:
            note("[card] 注意：frame_images 與 input_references 並存時，API 以 frame_images 為準（image-to-video）")

    if args.passthrough:
        allowed = cap.get("allowed_passthrough_parameters") or []
        params = dict(kv.split("=", 1) for kv in args.passthrough)
        bad = [k for k in params if allowed and k not in allowed]
        if bad:
            die(f"passthrough 參數 {bad} 不在允許清單 {allowed}")
        body["provider"] = {"options": {card["model"].split("/")[0]: {"parameters": params}}}

    note(f"[card] 送出影片 job：model={body['model']} duration={body.get('duration')} "
         f"size={body.get('size') or body.get('resolution', 'auto')} refs={len(args.ref or [])} frames={len(frames)}")
    sub = http("/videos", method="POST", body=body, key=key)
    job_id = sub["id"]
    note(f"[card] job id={job_id} status={sub.get('status')}")
    if args.no_wait:
        print(job_id)
        note(f"[card] 之後用：card.py job {card['alias']} --id {job_id} 取回結果")
        return
    poll_and_download(card, job_id, key, args)


def poll_and_download(card, job_id, key, args):
    interval = args.poll_interval
    deadline = time.time() + args.timeout
    while True:
        if time.time() > deadline:
            die(f"等了 {args.timeout}s 還沒完成（job 仍在跑）",
                f"稍後用：card.py job {card['alias']} --id {job_id} 續抓")
        time.sleep(interval)
        st = http(f"/videos/{job_id}", key=key, timeout=60)
        status = st.get("status")
        note(f"[card] status={status}")
        if status == "completed":
            urls = st.get("unsigned_urls") or [f"{API}/videos/{job_id}/content?index=0"]
            out_dir = Path(args.out_dir)
            out_dir.mkdir(parents=True, exist_ok=True)
            for i, u in enumerate(urls):
                dest = out_dir / f"{card['alias']}-{job_id[:8]}{'-' + str(i) if i else ''}.mp4"
                dest.write_bytes(http(u, key=key, timeout=300, raw=True))
                print(dest)
            cost = (st.get("usage") or {}).get("cost")
            if cost is not None:
                note(f"[card] 本次費用：${cost}")
            return
        if status in ("failed", "cancelled", "expired"):
            die(f"job {status}：{st.get('error', '未提供原因')}")


def run_chat(card, args, key):
    content = args.prompt
    if args.ref:
        content = [{"type": "text", "text": args.prompt}] + [
            {"type": "image_url", "image_url": {"url": to_image_url(r)}} for r in args.ref]
    body = {"model": card["model"], "messages": [{"role": "user", "content": content}],
            "usage": {"include": True}}
    for k, v in (card.get("defaults") or {}).items():
        body.setdefault(k, json.loads(v) if re.match(r"^[\d.\[{]", str(v)) else v)
    data = http("/chat/completions", method="POST", body=body, key=key)
    u = data.get("usage", {})
    note(f"[card] model={data.get('model')} in={u.get('prompt_tokens')} out={u.get('completion_tokens')} "
         f"cost=${u.get('cost', '?')}")
    print((data.get("choices") or [{}])[0].get("message", {}).get("content", ""))


def cmd_run(args):
    card = load_card(args.alias)
    key = load_key()
    if not args.prompt and args.prompt_file:
        args.prompt = Path(args.prompt_file).read_text()
    if not args.prompt:
        die("沒有 prompt", '用 --prompt "文字" 或 --prompt-file 檔案')
    if card["kind"] == "video":
        run_video(card, args, key)
    else:
        run_chat(card, args, key)


def cmd_job(args):
    card = load_card(args.alias)
    poll_and_download(card, args.id, load_key(), args)


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser(prog="card.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("create", help="從模型頁 URL 或 id 建 card")
    c.add_argument("model")
    c.add_argument("--alias")
    c.add_argument("--default", action="append", metavar="K=V", help="card 預設參數，可重複")
    c.set_defaults(fn=cmd_create)

    sub.add_parser("list", help="列出 cards").set_defaults(fn=cmd_list)
    s = sub.add_parser("show", help="顯示 card 內容")
    s.add_argument("alias")
    s.set_defaults(fn=cmd_show)

    r = sub.add_parser("run", help="依 card 執行請求")
    r.add_argument("alias")
    r.add_argument("-p", "--prompt")
    r.add_argument("-f", "--prompt-file")
    r.add_argument("--ref", action="append", metavar="IMG", help="參考圖（reference-to-video / 看圖），可重複")
    r.add_argument("--first-frame", metavar="IMG")
    r.add_argument("--last-frame", metavar="IMG")
    r.add_argument("--duration", type=int)
    r.add_argument("--size", help="WxH，與 --resolution/--aspect-ratio 擇一")
    r.add_argument("--resolution")
    r.add_argument("--aspect-ratio")
    r.add_argument("--seed", type=int)
    r.add_argument("--no-audio", action="store_true")
    r.add_argument("--passthrough", action="append", metavar="K=V")
    r.add_argument("--out-dir", default=".")
    r.add_argument("--no-wait", action="store_true", help="只送出 job，不等結果")
    r.add_argument("--poll-interval", type=int, default=15)
    r.add_argument("--timeout", type=int, default=900, help="等待完成的秒數上限（預設 900）")
    r.set_defaults(fn=cmd_run)

    j = sub.add_parser("job", help="續抓先前的影片 job")
    j.add_argument("alias")
    j.add_argument("--id", required=True)
    j.add_argument("--out-dir", default=".")
    j.add_argument("--poll-interval", type=int, default=15)
    j.add_argument("--timeout", type=int, default=900)
    j.set_defaults(fn=cmd_job)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
