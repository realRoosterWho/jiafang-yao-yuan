#!/usr/bin/env python3
"""甲方要圆：静态页面 + 匿名游戏事件收集。只用标准库。

    python3 collector.py serve            # 默认 127.0.0.1:2504，前面挂 Cloudflare Tunnel
    python3 collector.py report           # 在终端里看汇总
    https://fullcircle.roosterwho.com/admin   # 带密码的数据后台（admin.py + admin.html）

不存 IP、不存 UA。每条事件只有：随机玩家 ID、会话 ID、事件名、游戏里的数字，
外加 Cloudflare 给的国家代码（CF-IPCountry，两位字母）。
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import threading
import time
from collections import defaultdict, deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import admin
import saves

HERE = Path(__file__).resolve().parent
HOST = os.environ.get("FC_HOST", "127.0.0.1")
PORT = int(os.environ.get("FC_PORT", "2504"))
PUBLIC = Path(os.environ.get("FC_PUBLIC", HERE / "public"))
DB_PATH = Path(os.environ.get("FC_DB", HERE / "data" / "events.db"))

EVENTS = {"open", "start", "deliver", "fail", "quit", "retry", "win"}
MAX_BODY = 4096
RATE = 120            # 每个来源每分钟最多这么多条（只在内存里按 IP 计数，不落盘）
STATIC = {"/": ("index.html", "text/html; charset=utf-8")}

_db_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY,
            ts REAL NOT NULL,            -- 服务器收到的 unix 时间
            pid TEXT NOT NULL,           -- 随机玩家 ID（浏览器本地生成）
            sid TEXT NOT NULL,           -- 一次打开页面
            seq INTEGER,
            ev TEXT NOT NULL,
            ms INTEGER,                  -- 距离打开页面的毫秒数
            country TEXT,
            data TEXT NOT NULL           -- JSON
        )"""
    )
    con.execute("CREATE INDEX IF NOT EXISTS events_ev ON events(ev, ts)")
    con.execute("CREATE INDEX IF NOT EXISTS events_pid ON events(pid)")
    saves.schema(con)
    return con


CON: sqlite3.Connection | None = None


def rate_ok(key: str) -> bool:
    now = time.monotonic()
    with _hits_lock:
        q = _hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= RATE:
            return False
        q.append(now)
        if len(_hits) > 5000:  # 防止无限增长
            for k in [k for k, v in _hits.items() if not v]:
                del _hits[k]
        return True


def clean_id(v) -> str | None:
    if isinstance(v, str) and 4 <= len(v) <= 40 and v.isalnum():
        return v
    return None


def clean_data(d) -> dict:
    """只留下标量值，键名和字符串都截短。"""
    out = {}
    if not isinstance(d, dict):
        return out
    for k, v in list(d.items())[:24]:
        if not isinstance(k, str) or len(k) > 24:
            continue
        if isinstance(v, bool) or v is None or isinstance(v, (int, float)):
            out[k] = v
        elif isinstance(v, str):
            out[k] = v[:64]
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "fullcircle/1"
    sys_version = ""

    def log_message(self, fmt, *args):  # 默认的访问日志带 IP，关掉
        pass

    def log_request(self, code="-", size="-"):
        """只记页面和上报接口：方法、路径、状态码、事件名或拒收原因、浏览器大类。不记 IP。"""
        path = self.path.split("?", 1)[0]
        if path in ("/", "/api/event", "/api/save"):
            ua = self.headers.get("User-Agent") or ""
            fam = next((n for k, n in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("CriOS", "Chrome-iOS"),
                                       ("Chrome/", "Chrome"), ("Safari/", "Safari")) if k in ua), "other")
            mob = " mobile" if "Mobile" in ua else ""
            print(f"{self.command} {path} {code} {getattr(self, '_note', '')} [{fam}{mob}]".replace("  ", " "), flush=True)

    def _send(self, code: int, body: bytes = b"", ctype: str = "text/plain; charset=utf-8", extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _cors(self) -> dict:
        return {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400"}

    def _client(self) -> str:
        return self.headers.get("CF-Connecting-IP") or self.client_address[0]

    def _admin_get(self, path: str, query: str):
        noindex = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex"}
        ok = admin.authed(self.headers.get("Cookie"), DB_PATH.parent)
        if path in ("/admin", "/admin/"):
            if not ok:
                return self._send(200, admin.login_page(), "text/html; charset=utf-8", noindex)
            try:
                body = (HERE / "admin.html").read_bytes()
            except OSError:
                return self._send(500, b"missing admin.html")
            return self._send(200, body, "text/html; charset=utf-8", noindex)
        if not ok:
            return self._send(401, b"login required", extra=noindex)
        days, loops = admin.parse_filters(query)
        if path == "/admin/api/stats":
            with _db_lock:
                data = admin.stats(CON, PUBLIC, days, loops)
            return self._send(200, json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8", noindex)
        if path == "/admin/api/events.csv":
            with _db_lock:
                body = admin.events_csv(CON, days, loops)
            return self._send(200, body, "text/csv; charset=utf-8",
                              {**noindex, "Content-Disposition": 'attachment; filename="fullcircle-events.csv"'})
        return self._send(404, b"not found", extra=noindex)

    def _admin_post(self, path: str):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(min(max(n, 0), MAX_BODY))
        if path == "/admin/api/save/delete":
            if not admin.authed(self.headers.get("Cookie"), DB_PATH.parent):
                return self._send(401, b"login required")
            try:
                key = json.loads(body or b"{}").get("key")
            except (ValueError, AttributeError):
                key = None
            with _db_lock:
                ok = saves.delete(CON, key)
            return self._send(204 if ok else 404, extra={"Cache-Control": "no-store"})
        if path == "/admin/logout":
            return self._send(303, extra={"Location": "/admin", "Set-Cookie": admin.clear_cookie()})
        if path != "/admin/login":
            return self._send(404, b"not found")
        page = lambda msg: self._send(200, admin.login_page(msg), "text/html; charset=utf-8", {"Cache-Control": "no-store"})
        if not admin.login_allowed(self._client()):
            return page("试太多次了，十分钟后再来。")
        if not admin.check_password(body):
            return page("密码不对。")
        self._send(303, extra={"Location": "/admin", "Set-Cookie": admin.make_cookie(DB_PATH.parent)})

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/admin" or path.startswith("/admin/"):
            return self._admin_get(path, query)
        if path == "/healthz":
            return self._send(200, b"ok")
        hit = STATIC.get(path)
        if not hit:
            return self._send(404, b"not found")
        f = PUBLIC / hit[0]
        try:
            body = f.read_bytes()
        except OSError:
            return self._send(500, b"missing file")
        self._send(200, body, hit[1], {"Cache-Control": "no-cache"})

    do_HEAD = do_GET

    def do_OPTIONS(self):
        self._send(204, extra=self._cors())

    def do_POST(self):
        if self.path.startswith("/admin/"):
            return self._admin_post(self.path.split("?", 1)[0])
        if self.path.split("?", 1)[0] == "/api/save":
            return self._save()
        if self.path.split("?", 1)[0] != "/api/event":
            return self._send(404, b"not found")
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n <= 0 or n > MAX_BODY:
            self._note = f"bad-length:{n}"
            return self._send(413 if n > MAX_BODY else 400, b"bad length", extra=self._cors())
        raw = self.rfile.read(n)
        src = self._client()
        if not rate_ok(src):
            self._note = "rate-limited"
            return self._send(429, b"slow down", extra=self._cors())
        try:
            msg = json.loads(raw)
        except ValueError:
            self._note = f"bad-json:{raw[:40]!r}"
            return self._send(400, b"bad json", extra=self._cors())
        if not isinstance(msg, dict):
            self._note = "bad-json:not-object"
            return self._send(400, b"bad json", extra=self._cors())
        pid, sid, ev = clean_id(msg.get("pid")), clean_id(msg.get("sid")), msg.get("ev")
        if not pid or not sid or ev not in EVENTS:
            self._note = f"bad-event:{str(ev)[:16]} pid_ok={bool(pid)} sid_ok={bool(sid)}"
            return self._send(400, b"bad event", extra=self._cors())
        self._note = ev
        seq = msg.get("seq") if isinstance(msg.get("seq"), int) else None
        ms = msg.get("ms") if isinstance(msg.get("ms"), int) else None
        country = (self.headers.get("CF-IPCountry") or "")[:2] or None
        data = json.dumps(clean_data(msg.get("data")), ensure_ascii=False, separators=(",", ":"))
        with _db_lock:
            CON.execute("INSERT INTO events (ts, pid, sid, seq, ev, ms, country, data) VALUES (?,?,?,?,?,?,?,?)",
                        (time.time(), pid, sid, seq, ev, ms, country, data))
            CON.commit()
        self._send(204, extra=self._cors())

    def _save(self):
        """云存档：{name, pid, best} -> 合并后的 {name, best}。"""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n <= 0 or n > MAX_BODY:
            self._note = f"save-bad-length:{n}"
            return self._send(400, b"bad length", extra=self._cors())
        raw = self.rfile.read(n)
        if not rate_ok(self._client()):
            self._note = "save-rate-limited"
            return self._send(429, b"slow down", extra=self._cors())
        try:
            msg = json.loads(raw)
            assert isinstance(msg, dict)
        except (ValueError, AssertionError):
            self._note = "save-bad-json"
            return self._send(400, b"bad json", extra=self._cors())
        with _db_lock:
            out = saves.sync(CON, msg.get("name"), clean_id(msg.get("pid")), msg.get("best"))
        if out is None:
            self._note = "save-bad-name"
            return self._send(422, json.dumps({"error": "bad-name"}).encode(), "application/json", self._cors())
        self._note = f"save {len(out['best'])} orders"
        self._send(200, json.dumps(out, ensure_ascii=False).encode(), "application/json; charset=utf-8",
                   {**self._cors(), "Cache-Control": "no-store"})


def serve():
    global CON
    CON = db()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"fullcircle listening on {HOST}:{PORT}, db={DB_PATH}", flush=True)
    httpd.serve_forever()


def report():
    con = db()
    q = lambda sql, *a: con.execute(sql, a).fetchall()
    players, sessions = q("SELECT COUNT(DISTINCT pid), COUNT(DISTINCT sid) FROM events")[0]
    print(f"玩家 {players}，打开 {sessions} 次")
    for ev, n in q("SELECT ev, COUNT(*) FROM events GROUP BY ev ORDER BY 2 DESC"):
        print(f"  {ev:8} {n}")
    print("\n每一单（首轮）：开工 / 交付 / 失败(碎/超时) / 中途走 · 交付时平均用时 · 圆度")
    rows = q("""
        SELECT json_extract(data,'$.idx') i, json_extract(data,'$.order') o,
          SUM(ev='start'), SUM(ev='deliver'),
          SUM(ev='fail' AND json_extract(data,'$.reason')='shatter'),
          SUM(ev='fail' AND json_extract(data,'$.reason')='time'),
          SUM(ev='quit'),
          AVG(CASE WHEN ev='deliver' THEN json_extract(data,'$.used') END),
          AVG(CASE WHEN ev='deliver' THEN json_extract(data,'$.round') END)
        FROM events WHERE ev IN ('start','deliver','fail','quit') AND json_extract(data,'$.loop')=0
        GROUP BY i ORDER BY i""")
    for i, o, st, d, fs, ft, qu, used, rnd in rows:
        rate = f"{d / st:5.0%}" if st else "   - "
        print(f"  #{(i or 0) + 1:<3}{(o or '?'):<10} {st:>4} / {d:>4} / {fs:>3}+{ft:<3} / {qu:>3}   通过率 {rate}"
              f"   {used or 0:5.1f}s   {rnd or 0:.3f}")
    print("\n最远打到第几单（每个玩家）：")
    for far, n in q("""SELECT far, COUNT(*) FROM (SELECT pid, MAX(json_extract(data,'$.idx')) far FROM events
                       WHERE ev='deliver' GROUP BY pid) GROUP BY far ORDER BY far"""):
        print(f"  第 {far + 1:>2} 单  {n} 人")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"
    {"serve": serve, "report": report}.get(cmd, lambda: sys.exit(f"unknown command {cmd}"))()
