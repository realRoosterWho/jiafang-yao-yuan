"""甲方要圆：带密码的数据后台（collector.py 引入）。

密码放在环境变量 FC_ADMIN_PASSWORD（systemd 从 admin.env 读）。登录后发一个签名 cookie，
30 天有效；改密码会让所有旧 cookie 失效。
"""
from __future__ import annotations

import csv
import hashlib
import hmac
import html
import io
import json
import os
import re
import secrets
import statistics
import threading
import time

import saves
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import parse_qs

COOKIE = "fc_admin"
TTL = 30 * 86400
LOGIN_RATE = 10        # 每个来源 10 分钟内最多试这么多次密码
_tries: dict[str, deque] = defaultdict(deque)
_tries_lock = threading.Lock()


def _password() -> str:
    return os.environ.get("FC_ADMIN_PASSWORD", "")


def _secret(data_dir: Path) -> bytes:
    f = data_dir / "cookie-secret"
    try:
        return f.read_bytes()
    except OSError:
        data_dir.mkdir(parents=True, exist_ok=True)
        s = secrets.token_bytes(32)
        f.write_bytes(s)
        os.chmod(f, 0o600)
        return s


def _sign(secret: bytes, exp: int) -> str:
    pw = hashlib.sha256(_password().encode()).hexdigest()
    return hmac.new(secret, f"{exp}|{pw}".encode(), hashlib.sha256).hexdigest()


def make_cookie(data_dir: Path) -> str:
    exp = int(time.time()) + TTL
    return f"{COOKIE}={exp}.{_sign(_secret(data_dir), exp)}; Max-Age={TTL}; Path=/admin; HttpOnly; Secure; SameSite=Lax"


def clear_cookie() -> str:
    return f"{COOKIE}=; Max-Age=0; Path=/admin; HttpOnly; Secure; SameSite=Lax"


def authed(cookie_header: str | None, data_dir: Path) -> bool:
    if not _password() or not cookie_header:
        return False
    for part in cookie_header.split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE and "." in v:
            exp_s, sig = v.split(".", 1)
            if exp_s.isdigit() and int(exp_s) > time.time():
                return hmac.compare_digest(sig, _sign(_secret(data_dir), int(exp_s)))
    return False


def login_allowed(src: str) -> bool:
    now = time.monotonic()
    with _tries_lock:
        q = _tries[src]
        while q and now - q[0] > 600:
            q.popleft()
        if len(q) >= LOGIN_RATE:
            return False
        q.append(now)
        return True


def check_password(body: bytes) -> bool:
    pw = parse_qs(body.decode("utf-8", "replace")).get("password", [""])[0]
    real = _password()
    return bool(real) and hmac.compare_digest(pw.encode(), real.encode())


def login_page(error: str = "") -> bytes:
    err = f'<p class="err" role="alert">{html.escape(error)}</p>' if error else ""
    return f"""<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>甲方要圆 · 后台</title><style>
:root{{color-scheme:light;--bg:#fcfcfb;--card:#fff;--ink:#0b0b0b;--dim:#52514e;--line:#e2e1dc;--acc:#2a78d6;--err:#d03b3b}}
@media (prefers-color-scheme:dark){{:root{{color-scheme:dark;--bg:#1a1a19;--card:#232322;--ink:#f0efec;--dim:#c3c2b7;--line:#383835;--acc:#3987e5;--err:#e66767}}}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif}}
form{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;width:min(340px,calc(100vw - 32px));box-sizing:border-box}}
h1{{font-size:20px;margin:0 0 4px}}p{{margin:0 0 16px;color:var(--dim);font-size:14px}}
input{{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}}
button{{margin-top:12px;width:100%;font:inherit;font-weight:600;padding:10px;border:0;border-radius:8px;background:var(--acc);color:#fff;cursor:pointer}}
.err{{color:var(--err);margin:12px 0 0}}</style></head><body>
<form method="post" action="/admin/login"><h1>甲方要圆 · 数据后台</h1><p>输入团队密码</p>
<label for="pw" style="position:absolute;left:-9999px">密码</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">进入</button>{err}</form></body></html>""".encode()


# ---------- 统计 ----------

def order_names(public: Path) -> tuple[list[str], dict[str, str]]:
    try:
        src = (public / "index.html").read_text("utf-8")
    except OSError:
        return [], {}
    m = re.search(r"const ORDER = \[([^\]]*)\]", src)
    order = re.findall(r"'([a-z]+)'", m.group(1)) if m else []
    block = src[src.find("const MATS = {"):src.find("const ORDER")]
    names = dict(re.findall(r"^\s+([a-z]+): \{ name: '([^']+)'", block, re.M))
    return order, names


def adventure_order(public: Path) -> list[str]:
    """冒险模式的单子顺序：index.html 里 const ADVENTURE = [ ['wood', ...], ... ] 每行第一个 id。"""
    try:
        src = (public / "index.html").read_text("utf-8")
    except OSError:
        return []
    start = src.find("const ADVENTURE = [")
    if start < 0:
        return []
    block = src[start:src.find("\n];", start)]
    return re.findall(r"^\s+\['([a-z]+)',", block, re.M)


def current_order(public: Path) -> tuple[list[str], dict[str, str], int]:
    """游戏里实际的顺序：先是冒险模式（ADVENTURE）那几单，再是 ORDER 里剩下的，跟 index.html 里重排的规则一样。
    返回 (顺序, 名字, 冒险模式几单)。"""
    order, names = order_names(public)
    adv = [x for x in adventure_order(public) if x in order]
    return adv + [x for x in order if x not in adv], names, len(adv)


def _where(days: float, loops: str) -> tuple[str, list]:
    w, a = ["1=1"], []
    if days > 0:
        w.append("ts >= ?")
        a.append(time.time() - days * 86400)
    if loops == "first":
        w.append("(json_extract(data,'$.loop') IS NULL OR json_extract(data,'$.loop') = 0)")
    return " AND ".join(w), a


def parse_filters(query: str) -> tuple[float, str]:
    q = parse_qs(query)
    try:
        days = float(q.get("days", ["0"])[0])
    except ValueError:
        days = 0
    loops = "all" if q.get("loops", ["first"])[0] == "all" else "first"
    return max(0.0, min(days, 3650)), loops


INTRO_STEPS = [
    ("new", "打开游戏"), ("lang", "选语言"), ("begin", "点开封面"), ("cut_end", "播片放完"), ("tut", "进新手关"),
    ("tut_lift", "按住石头"), ("tut_turn", "拎过虚线"), ("tut_drop", "转好朝下"), ("tut_hit", "砸中凸起"), ("tut_ready", "够圆了"),
    ("tut_done", "交了新手关"), ("contract", "看到合同"), ("signed", "签了合同"), ("first_start", "开第 1 单"), ("first_deliver", "交了第 1 单"),
]
INTRO_AT = {"lang": "选语言", "cutscene": "播片", "tutorial": "新手关", "handoff": "过场", "contract": "合同"}
INTRO_ST = {"press": "还没按住", "lift": "没拎过线", "turn": "没转好", "drop": "转好了没松手", "ready": "够圆了没交"}


def intro_funnel(con, where: str = "1=1", args: tuple = ()) -> dict:
    """新玩家（打开时一单都没交过）的开场流程：每一步有多少不重复玩家走到。重看开场（replay=1）不算。
    第 1 单只算这些新玩家里开过 / 交过冒险模式第一单（idx 0）的。"""
    q = lambda sql: con.execute(sql.replace("{W}", where), args).fetchall()
    new = {r[0] for r in q("SELECT DISTINCT pid FROM events WHERE {W} AND ev='open' AND json_extract(data,'$.delivered')=0")}
    by: dict[str, set] = {}
    for pid, s in q("SELECT pid, json_extract(data,'$.s') FROM events WHERE {W} AND ev='intro' AND COALESCE(json_extract(data,'$.replay'),0)=0"):
        by.setdefault(s, set()).add(pid)
    for ev, key in (("start", "first_start"), ("deliver", "first_deliver")):
        by[key] = {r[0] for r in q(f"SELECT DISTINCT pid FROM events WHERE {{W}} AND ev='{ev}' AND json_extract(data,'$.idx')=0 "
                                   "AND json_extract(data,'$.mode') IS NULL")} & new
    by["new"] = new
    steps = [{"k": k, "label": label, "n": len(by.get(k, ()))} for k, label in INTRO_STEPS]
    leave: dict[str, int] = {}
    for at, st in q("SELECT json_extract(data,'$.at'), json_extract(data,'$.st') FROM events WHERE {W} AND ev='intro' "
                    "AND json_extract(data,'$.s')='leave' AND COALESCE(json_extract(data,'$.replay'),0)=0"):
        k = INTRO_AT.get(at, at or "?") + (f"·{INTRO_ST.get(st, st)}" if st else "")
        leave[k] = leave.get(k, 0) + 1
    skips = q("SELECT COUNT(*) FROM events WHERE {W} AND ev='intro' AND json_extract(data,'$.s')='cut_end' AND json_extract(data,'$.skip')=1")[0][0]
    return {"steps": steps, "leave": [{"k": k, "n": n} for k, n in sorted(leave.items(), key=lambda x: -x[1])], "cut_skips": skips}


def stats(con, public: Path, days: float, loops: str) -> dict:
    where, args = _where(days, loops)
    q = lambda sql, *extra: con.execute(sql.replace("{W}", where), (*args, *extra)).fetchall()
    order, names, n_adv = current_order(public)
    pos = {oid: i for i, oid in enumerate(order)}

    players, sessions = q("SELECT COUNT(DISTINCT pid), COUNT(DISTINCT sid) FROM events WHERE {W}")[0]
    durs = [r[0] / 1000 for r in q("SELECT MAX(ms) FROM events WHERE {W} AND ms IS NOT NULL GROUP BY sid") if r[0]]
    ev = dict(q("SELECT ev, COUNT(*) FROM events WHERE {W} GROUP BY ev"))

    per = {}
    for row in q("""
        SELECT json_extract(data,'$.order') o,
          SUM(ev='start'), COUNT(DISTINCT CASE WHEN ev='start' THEN pid END),
          SUM(ev='deliver'), COUNT(DISTINCT CASE WHEN ev='deliver' THEN pid END),
          SUM(ev='fail' AND json_extract(data,'$.reason')='shatter'),
          SUM(ev='fail' AND json_extract(data,'$.reason')='time'),
          SUM(ev='quit'),
          AVG(CASE WHEN ev='deliver' THEN json_extract(data,'$.used') END),
          AVG(CASE WHEN ev='deliver' THEN json_extract(data,'$.round') END),
          AVG(CASE WHEN ev IN ('deliver','fail','quit') THEN json_extract(data,'$.target') END),
          AVG(CASE WHEN ev IN ('deliver','fail','quit') THEN json_extract(data,'$.good') END),
          AVG(CASE WHEN ev IN ('deliver','fail','quit') THEN json_extract(data,'$.over') END),
          AVG(CASE WHEN ev='deliver' THEN json_extract(data,'$.pay') END),
          AVG(CASE WHEN ev='fail' THEN json_extract(data,'$.round') END)
        FROM events WHERE {W} AND ev IN ('start','deliver','fail','quit') AND json_extract(data,'$.order') IS NOT NULL
          AND json_extract(data,'$.mode') IS NULL   -- 无尽模式的单限时更短，不混进每单的统计
        GROUP BY o"""):
        per[row[0]] = dict(zip(["order", "starts", "players", "deliver", "deliver_players", "shatter", "time", "quit",
                           "avg_used", "avg_round", "avg_target", "avg_good", "avg_over", "avg_pay", "fail_round"], row))
    orders = []
    for i, oid in enumerate(order):
        o = per.get(oid) or {"order": oid, "starts": 0, "players": 0, "deliver": 0, "deliver_players": 0, "shatter": 0, "time": 0, "quit": 0}
        o["idx"] = i
        o["name"] = names.get(oid, oid)
        orders.append(o)

    daily = [dict(zip(["day", "players", "sessions"], r)) for r in q("""
        SELECT date(ts,'unixepoch','localtime') d, COUNT(DISTINCT pid), COUNT(DISTINCT sid)
        FROM events WHERE {W} GROUP BY d ORDER BY d""")]

    def split(expr, ev_name="open", limit=8):
        return [{"k": r[0], "n": r[1]} for r in q(f"""SELECT {expr} k, COUNT(DISTINCT pid) n FROM events
                WHERE {{W}} AND ev='{ev_name}' GROUP BY k ORDER BY n DESC LIMIT {limit}""")]

    furthest: dict[str, int] = {}
    for pid, oid in q("SELECT pid, json_extract(data,'$.order') FROM events WHERE {W} AND ev='deliver'"):
        if oid in pos:
            furthest[pid] = max(furthest.get(pid, -1), pos[oid])
    far_n: dict[int, int] = {}
    for i in furthest.values():
        far_n[i] = far_n.get(i, 0) + 1
    far = [{"k": k, "n": n} for k, n in sorted(far_n.items())]
    names = saves.names_by_pid(con)
    named = saves.players(con, order)
    iw, ia = _where(days, "all")   # 开场流程的事件不带轮次，不按轮次筛
    recent = [{"ts": r[0], "pid": r[1][:6], "name": names.get(r[1]), "ev": r[2], "country": r[3], "data": json.loads(r[4])}
              for r in q("SELECT ts, pid, ev, country, data FROM events WHERE {W} ORDER BY id DESC LIMIT 40")]

    return {
        "generated": time.time(), "filters": {"days": days, "loops": loops}, "total_orders": len(order),
        "parts": [{"name": "冒险模式", "from": 0, "to": n_adv}, {"name": "剩下的关卡", "from": n_adv, "to": len(order)}],
        "kpi": {"players": players, "sessions": sessions, "starts": ev.get("start", 0), "delivers": ev.get("deliver", 0),
                "fails": ev.get("fail", 0), "quits": ev.get("quit", 0), "wins": ev.get("win", 0),
                "winners": q("SELECT COUNT(DISTINCT pid) FROM events WHERE {W} AND ev='win'")[0][0],
                "median_session": statistics.median(durs) if durs else None,
                "named": len(named)},
        "saves": named,
        "orders": orders, "daily": daily, "furthest": far,
        "devices": {
            "input": split("CASE json_extract(data,'$.touch') WHEN 1 THEN '触屏' ELSE '鼠标/键盘' END"),
            "orient": split("CASE json_extract(data,'$.port') WHEN 1 THEN '竖屏' ELSE '横屏' END"),
            "lang": split("CASE json_extract(data,'$.lang') WHEN 'zh' THEN '中文' WHEN 'en' THEN 'English' ELSE '其他' END"),
            "country": split("COALESCE(country,'?')"),
            "ref": split("CASE WHEN COALESCE(json_extract(data,'$.ref'),'')='' THEN '直接打开' ELSE json_extract(data,'$.ref') END"),
        },
        "recent": recent,
        "intro": intro_funnel(con, iw, tuple(ia)),
        "extend": dict(zip(["n", "players", "delivered"], q(
            "SELECT SUM(ev='extend'), COUNT(DISTINCT CASE WHEN ev='extend' THEN pid END), "
            "SUM(ev='deliver' AND json_extract(data,'$.ext')=1) FROM events WHERE {W}")[0])),
    }


def events_csv(con, days: float, loops: str) -> bytes:
    where, args = _where(days, loops)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["time_utc", "player", "session", "seq", "event", "ms", "country", "data"])
    for ts, pid, sid, seq, ev, ms, country, data in con.execute(
            f"SELECT ts, pid, sid, seq, ev, ms, country, data FROM events WHERE {where} ORDER BY id", args):
        w.writerow([time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ts)), pid, sid, seq, ev, ms, country, data])
    return ("﻿" + buf.getvalue()).encode("utf-8")
