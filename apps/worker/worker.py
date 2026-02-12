"""
B站热门视频在线人数采集服务

功能：
- 定时获取 B站热门视频列表
- 并发获取每个视频的在线观看人数
- 原子写入 JSON 文件供前端读取

致谢：
- 参考 https://github.com/nbt0/bilibili-online-ranking
"""

import asyncio
import json
import os
import random
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

import httpx

# B站 API 端点
POPULAR_API = "https://api.bilibili.com/x/web-interface/popular"
VIEW_API = "https://api.bilibili.com/x/web-interface/view"
ONLINE_API = "https://api.bilibili.com/x/player/online/total"


def _env_int(name: str, default: int) -> int:
    """从环境变量读取整数"""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _now_formatted() -> str:
    """获取当前 UTC+8 时间的格式化字符串"""
    utc_now = datetime.now(timezone.utc)
    beijing_time = utc_now.astimezone(timezone(timedelta(hours=8)))
    return beijing_time.strftime("%Y-%m-%d %H:%M:%S")


def _atomic_write_json(path: str, payload: dict[str, Any]) -> None:
    """原子写入 JSON 文件"""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


def _read_existing(path: str) -> Optional[dict[str, Any]]:
    """读取已有的 JSON 文件"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _safe_int(v: Any) -> Optional[int]:
    """安全转换为整数"""
    if v is None:
        return None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    if isinstance(v, str):
        s = v.strip()
        if s.isdigit():
            return int(s)
    return None


@dataclass
class Config:
    """配置类"""
    update_interval_sec: int
    output_path: str
    user_agent: str
    sessdata: str
    http_proxy: str
    max_items: int
    max_concurrency: int


def load_config() -> Config:
    """从环境变量加载配置"""
    return Config(
        update_interval_sec=max(5, _env_int("UPDATE_INTERVAL_SEC", 600)),
        output_path=os.getenv("OUTPUT_PATH", "../data/data.json"),
        user_agent=os.getenv(
            "USER_AGENT",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        ),
        sessdata=os.getenv("SESSDATA", "").strip(),
        http_proxy=os.getenv("HTTP_PROXY", "").strip(),
        max_items=max(1, _env_int("MAX_ITEMS", 50)),
        max_concurrency=max(1, _env_int("MAX_CONCURRENCY", 6)),
    )


def build_headers(cfg: Config) -> dict[str, str]:
    """构建请求头"""
    return {
        "User-Agent": cfg.user_agent,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.bilibili.com/",
        "Origin": "https://www.bilibili.com",
    }


def build_cookies(cfg: Config) -> dict[str, str]:
    """构建 Cookie"""
    cookies: dict[str, str] = {}
    if cfg.sessdata:
        cookies["SESSDATA"] = cfg.sessdata
    return cookies


class RateLimiter:
    """速率限制器"""

    def __init__(self, min_interval_sec: float) -> None:
        self._min_interval_sec = max(0.0, float(min_interval_sec))
        self._lock = asyncio.Lock()
        self._next_at = 0.0

    async def wait(self) -> None:
        if self._min_interval_sec <= 0:
            return
        async with self._lock:
            now = time.monotonic()
            if now < self._next_at:
                await asyncio.sleep(self._next_at - now)
                now = time.monotonic()
            self._next_at = now + self._min_interval_sec


async def _get_json_with_retry(
    client: httpx.AsyncClient,
    url: str,
    *,
    params: dict[str, Any] | None,
    limiter: RateLimiter | None,
    retries: int = 3,
    base_backoff_sec: float = 0.6,
) -> dict[str, Any]:
    """带重试的 GET 请求"""
    last_err: BaseException | None
    for attempt in range(retries):
        try:
            if limiter is not None:
                await limiter.wait()
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, dict):
                raise ValueError("response is not a json object")
            return data
        except Exception as e:
            last_err = e
            # 指数退避 + 随机抖动
            wait_sec = base_backoff_sec * (2 ** attempt) + random.random() * 0.2
            print(f"[worker] request failed (attempt {attempt + 1}/{retries}), retrying in {wait_sec:.2f}s: {e}", file=sys.stderr)
            await asyncio.sleep(wait_sec)
    raise RuntimeError(f"GET {url} failed after {retries} retries: {last_err}")


async def fetch_popular_videos(
    client: httpx.AsyncClient, cfg: Config, limiter: RateLimiter
) -> list[dict[str, Any]]:
    """获取热门视频列表"""
    raw = await _get_json_with_retry(
        client,
        POPULAR_API,
        params={"pn": 1, "ps": cfg.max_items},
        limiter=limiter,
    )
    if raw.get("code") != 0:
        raise RuntimeError(f"popular api error: code={raw.get('code')} message={raw.get('message')}")
    data = raw.get("data") or {}
    items = data.get("list") or []
    if not isinstance(items, list):
        raise RuntimeError("popular api: data.list is not a list")
    print(f"[worker] fetched {len(items)} popular videos")
    return items


async def enrich_video(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    limiter: RateLimiter,
    raw_item: dict[str, Any],
) -> dict[str, Any]:
    """获取单个视频的详细信息和在线人数"""
    bvid = raw_item.get("bvid")
    if not isinstance(bvid, str) or not bvid:
        raise RuntimeError("missing bvid")

    # 获取视频详情（包含 cid）
    async with sem:
        view_raw = await _get_json_with_retry(
            client, VIEW_API, params={"bvid": bvid}, limiter=limiter
        )

    view_data = (view_raw.get("data") or {}) if isinstance(view_raw, dict) else {}
    cid = _safe_int(view_data.get("cid"))

    # 标题
    title = raw_item.get("title") if isinstance(raw_item.get("title"), str) else view_data.get("title")
    if not isinstance(title, str):
        title = f"(untitled) {bvid}"

    # UP主
    owner = view_data.get("owner") if isinstance(view_data.get("owner"), dict) else raw_item.get("owner")

    # 播放量和弹幕数
    stat = view_data.get("stat") if isinstance(view_data.get("stat"), dict) else raw_item.get("stat")
    view = None
    danmaku = None
    if isinstance(stat, dict):
        view = _safe_int(stat.get("view"))
        danmaku = _safe_int(stat.get("danmaku"))

    # 封面图
    pic = raw_item.get("pic")
    if not isinstance(pic, str) or not pic:
        pic = view_data.get("pic")
    if not isinstance(pic, str):
        pic = ""

    # 发布时间 unix timestamp eg: 1770641792
    pubdate = view_data.get("pubdate")
    if not isinstance(pubdate, int):
        pubdate = raw_item.get("pubdate")
    if not isinstance(pubdate, int):
        pubdate = 0
    
    # 格式化时间
    pubdate = datetime.fromtimestamp(pubdate).strftime("%Y-%m-%d %H:%M:%S")

    # 在线人数 eg: 1000+ 1.7万+
    online_total = None
    # 获取在线人数
    online_count = None

    if cid:
        async with sem:
            online_raw = await _get_json_with_retry(
                client, ONLINE_API, params={"bvid": bvid, "cid": cid}, limiter=limiter
            )
        if online_raw.get("code") == 0:
            d = online_raw.get("data") or {}
            if isinstance(d, dict):
                online_total = d.get("total")
                online_count = _safe_int(d.get("count"))

    return {
        "bvid": bvid,
        "title": title,
        "pic": pic,
        "owner": owner,
        "online_total": online_total, # 文字转化后的 eg: 1.7万人
        "online_count": online_count, # 数字
        "view": view,
        "danmaku": danmaku,
        "pubdate": pubdate,
    }


async def build_payload(cfg: Config) -> dict[str, Any]:
    """构建完整的数据负载"""
    headers = build_headers(cfg)
    cookies = build_cookies(cfg)

    # 设置代理
    if cfg.http_proxy:
        os.environ.setdefault("HTTP_PROXY", cfg.http_proxy)
        os.environ.setdefault("HTTPS_PROXY", cfg.http_proxy)

    timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=10.0)
    limits = httpx.Limits(
        max_connections=cfg.max_concurrency * 2,
        max_keepalive_connections=cfg.max_concurrency * 2
    )

    async with httpx.AsyncClient(
        headers=headers,
        cookies=cookies,
        timeout=timeout,
        limits=limits,
        follow_redirects=True,
    ) as client:
        limiter = RateLimiter(0.8)  # 每次请求间隔 800ms
        popular_items = await fetch_popular_videos(client, cfg, limiter)

        sem = asyncio.Semaphore(cfg.max_concurrency)
        tasks = []
        for it in popular_items:
            if not isinstance(it, dict):
                continue
            tasks.append(enrich_video(client, sem, limiter, it))

        # 逐个收集结果，单条失败不影响整体
        enriched: list[dict[str, Any]] = []
        total = len(tasks)
        for i, coro in enumerate(asyncio.as_completed(tasks), start=1):
            try:
                enriched.append(await coro)
                if i % 10 == 0 or i == total:
                    print(f"[worker] progress: {i}/{total} videos processed")
            except Exception as e:
                print(f"[worker] single video failed: {e}", file=sys.stderr)
                continue

        # 按在线人数排序（None 放最后）
        def sort_key(x: dict[str, Any]) -> tuple[int, int]:
            online = x.get("online_count")
            o = online if isinstance(online, int) else -1
            return (0 if o >= 0 else 1, -(o if o >= 0 else 0))

        enriched.sort(key=sort_key)
        return {"updated_at": _now_formatted(), "items": enriched}


async def run_once(cfg: Config) -> None:
    """执行一次数据采集"""
    out_path = cfg.output_path
    existing = _read_existing(out_path) or {}
    existing_items = existing.get("items") if isinstance(existing.get("items"), list) else None

    try:
        payload = await build_payload(cfg)
        payload.pop("error", None)
        _atomic_write_json(out_path, payload)
        print(f"[worker] updated {out_path} items={len(payload.get('items') or [])} at={payload.get('updated_at')}")
    except Exception as e:
        print(f"[worker] fetch failed, time={_now_formatted()}, error={e}", file=sys.stderr)


async def scheduler(cfg: Config) -> None:
    """异步调度器，支持优雅退出"""
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop_event.set)

    print(
        f"[worker] starting "
        f"interval={cfg.update_interval_sec}s output={cfg.output_path} "
        f"items={cfg.max_items} concurrency={cfg.max_concurrency}"
    )

    while not stop_event.is_set():
        await run_once(cfg)
        sleep_sec = cfg.update_interval_sec
        print(f"[worker] sleeping {sleep_sec}s until next update...")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=sleep_sec)
        except asyncio.TimeoutError:
            pass  # 正常超时，继续下一轮

    print("[worker] shutting down gracefully")


def main() -> None:
    """主函数"""
    cfg = load_config()
    asyncio.run(scheduler(cfg))


if __name__ == "__main__":
    main()
