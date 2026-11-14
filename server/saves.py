"""甲方要圆：按名字存的云存档。

没有密码：同一个名字就是同一份存档。存的是每一单拿过的最高酬劳和最高星数（合并时取较大值），
加上解锁过的成就（合并时取并集）和无尽模式最好的一轮（合并时取酬劳高的那轮），
所以别人用了你的名字，最多让成绩变高，抹不掉你的进度。
名字不合适的可以在后台删掉。
"""
from __future__ import annotations

import json
import time
import unicodedata

NAME_MAX = 16
EXTRA_CHARS = set(" -_·.'")
MAX_ORDERS = 120
MAX_PAY = 1_000_000
MAX_ACH = 200
MAX_RUN_PAY = 100_000_000
MAX_RUN_ORDERS = 100_000


def schema(con) -> None:
    con.execute(
        """CREATE TABLE IF NOT EXISTS saves (
            key TEXT PRIMARY KEY,        -- 名字规范化后（NFKC + casefold），用来判断是不是同一个名字
            name TEXT NOT NULL,          -- 第一次起名时的写法，用来显示
            best TEXT NOT NULL,          -- JSON：{订单 id: 最高酬劳}
            created REAL NOT NULL,
            updated REAL NOT NULL,
            syncs INTEGER NOT NULL DEFAULT 0
        )"""
    )
    con.execute(
        """CREATE TABLE IF NOT EXISTS save_pids (   -- 哪些匿名玩家 ID 用过这个名字（一个人多台设备）
            key TEXT NOT NULL, pid TEXT NOT NULL, first REAL NOT NULL, last REAL NOT NULL,
            PRIMARY KEY (key, pid)
        )"""
    )
    con.execute("CREATE INDEX IF NOT EXISTS save_pids_pid ON save_pids(pid, last)")
    # 后加的一列：{"stars": {订单 id: 1-3}, "ach": [成就 id, ...], "endless": {"best": 酬劳, "n": 单数}}
    if "extra" not in {r[1] for r in con.execute("PRAGMA table_info(saves)")}:
        con.execute("ALTER TABLE saves ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'")


def clean_name(raw) -> tuple[str, str] | None:
    """返回 (显示名, key)；不合法返回 None。允许各国文字、数字、空格和 - _ · . '"""
    if not isinstance(raw, str):
        return None
    name = " ".join(unicodedata.normalize("NFKC", raw).split())
    if not 1 <= len(name) <= NAME_MAX:
        return None
    for ch in name:
        if not (ch.isalnum() or ch in EXTRA_CHARS):
            return None
    return name, name.casefold()


def clean_best(raw) -> dict[str, int]:
    out: dict[str, int] = {}
    if not isinstance(raw, dict):
        return out
    for k, v in list(raw.items())[:MAX_ORDERS]:
        if isinstance(k, str) and 1 <= len(k) <= 24 and k.replace("_", "").isalnum() \
                and isinstance(v, (int, float)) and not isinstance(v, bool) and 0 < v <= MAX_PAY:
            out[k] = int(v)
    return out


def clean_stars(raw) -> dict[str, int]:
    out: dict[str, int] = {}
    if not isinstance(raw, dict):
        return out
    for k, v in list(raw.items())[:MAX_ORDERS]:
        if isinstance(k, str) and 1 <= len(k) <= 24 and k.replace("_", "").isalnum() \
                and isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 3:
            out[k] = v
    return out


def clean_ach(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    out = []
    for a in raw[:MAX_ACH]:
        if isinstance(a, str) and 1 <= len(a) <= 32 and a.replace("_", "").isalnum() and a.isascii() and a not in out:
            out.append(a)
    return out


def clean_endless(raw) -> dict[str, int]:
    """无尽模式最好的一轮：{"best": 这一轮的总酬劳, "n": 交了几单}；没有或不合法返回 {"best": 0, "n": 0}"""
    ok = lambda v, hi: isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= hi
    if isinstance(raw, dict) and ok(raw.get("best"), MAX_RUN_PAY) and ok(raw.get("n"), MAX_RUN_ORDERS):
        return {"best": int(raw["best"]), "n": int(raw["n"])}
    return {"best": 0, "n": 0}


def _extra(raw) -> dict:
    try:
        e = json.loads(raw or "{}")
    except ValueError:
        e = {}
    return e if isinstance(e, dict) else {}


def load_extra(raw) -> tuple[dict[str, int], list[str]]:
    e = _extra(raw)
    return clean_stars(e.get("stars")), clean_ach(e.get("ach"))


def load_endless(raw) -> dict[str, int]:
    return clean_endless(_extra(raw).get("endless"))


def sync(con, raw_name, pid: str | None, raw_best, raw_stars=None, raw_ach=None, raw_endless=None) -> dict | None:
    """把客户端的进度合并进这个名字的存档，返回合并后的 {name, best, stars, ach, endless}。名字不合法返回 None。"""
    nk = clean_name(raw_name)
    if not nk:
        return None
    name, key = nk
    incoming, now = clean_best(raw_best), time.time()
    in_stars, in_ach, in_end = clean_stars(raw_stars), clean_ach(raw_ach), clean_endless(raw_endless)
    row = con.execute("SELECT name, best, extra FROM saves WHERE key = ?", (key,)).fetchone()
    if row:
        name, best = row[0], json.loads(row[1])
        stars, ach = load_extra(row[2])
        endless = load_endless(row[2])
        if in_end["best"] > endless["best"]:
            endless = in_end
        for k, v in incoming.items():
            if v > best.get(k, 0):
                best[k] = v
        for k, v in in_stars.items():
            if v > stars.get(k, 0):
                stars[k] = v
        ach += [a for a in in_ach if a not in ach]
        ach = ach[:MAX_ACH]
        con.execute("UPDATE saves SET best = ?, extra = ?, updated = ?, syncs = syncs + 1 WHERE key = ?",
                    (json.dumps(best, separators=(",", ":")),
                     json.dumps({"stars": stars, "ach": ach, "endless": endless}, separators=(",", ":")), now, key))
    else:
        best, stars, ach, endless = incoming, in_stars, in_ach, in_end
        con.execute("INSERT INTO saves (key, name, best, extra, created, updated, syncs) VALUES (?,?,?,?,?,?,1)",
                    (key, name, json.dumps(best, separators=(",", ":")),
                     json.dumps({"stars": stars, "ach": ach, "endless": endless}, separators=(",", ":")), now, now))
    if pid:
        con.execute("""INSERT INTO save_pids (key, pid, first, last) VALUES (?,?,?,?)
                       ON CONFLICT(key, pid) DO UPDATE SET last = excluded.last""", (key, pid, now, now))
    con.commit()
    return {"name": name, "best": best, "stars": stars, "ach": ach, "endless": endless}


def star_total(best: dict, stars: dict, known) -> int:
    """交付过的单按记下的星数算；有星级以前交付的单没有记录，那时交付就是到了达标线，算三星。"""
    return sum(stars.get(k) or 3 for k, v in best.items() if k in known and v > 0)


def names_by_pid(con) -> dict[str, str]:
    """每个匿名玩家 ID 最近用的名字。"""
    out: dict[str, str] = {}
    for pid, name in con.execute("""SELECT sp.pid, s.name FROM save_pids sp JOIN saves s ON s.key = sp.key
                                    ORDER BY sp.last"""):
        out[pid] = name
    return out


def players(con, order: list[str], limit: int = 300) -> list[dict]:
    idx = {k: i for i, k in enumerate(order)}
    rows = con.execute("""
        SELECT s.key, s.name, s.best, s.extra, s.created, s.updated, s.syncs,
               (SELECT COUNT(*) FROM save_pids sp WHERE sp.key = s.key),
               (SELECT MAX(e.ts) FROM events e JOIN save_pids sp ON sp.pid = e.pid WHERE sp.key = s.key)
        FROM saves s ORDER BY s.updated DESC LIMIT ?""", (limit,)).fetchall()
    out = []
    for key, name, best, extra, created, updated, syncs, devices, last_play in rows:
        b = json.loads(best)
        stars, ach = load_extra(extra)
        done = [idx[k] for k, v in b.items() if v > 0 and k in idx]
        out.append({"key": key, "name": name, "delivered": len(done), "furthest": max(done) if done else None,
                    "total": sum(v for k, v in b.items() if k in idx), "stars": star_total(b, stars, idx),
                    "ach": len(ach), "endless": load_endless(extra)["best"], "devices": devices, "created": created,
                    "last": max(x for x in (updated, last_play) if x)})
    return out


def delete(con, key: str) -> bool:
    if not isinstance(key, str) or not key:
        return False
    n = con.execute("DELETE FROM saves WHERE key = ?", (key,)).rowcount
    con.execute("DELETE FROM save_pids WHERE key = ?", (key,))
    con.commit()
    return n > 0


def leaderboard(con, order: list[str], me=None, limit: int = 50) -> dict:
    """公开排行榜（无尽模式）：每个名字取最好的一轮，按这一轮的总酬劳排，同分看交的单数，再看谁先存的。只给名字和成绩。"""
    rows = []
    for key, name, extra, created in con.execute("SELECT key, name, extra, created FROM saves"):
        e = load_endless(extra)
        if e["best"] > 0:
            rows.append((e["best"], e["n"], -created, key, name))
    rows.sort(reverse=True)
    board = [{"rank": i + 1, "name": r[4], "total": r[0], "delivered": r[1], "_key": r[3]}
             for i, r in enumerate(rows)]
    nk = clean_name(me) if me else None
    mine = next((dict(p) for p in board if nk and p["_key"] == nk[1]), None)
    strip = lambda p: {k: v for k, v in p.items() if k != "_key"}
    return {"top": [strip(p) for p in board[:limit]], "me": strip(mine) if mine else None,
            "players": len(board), "total_orders": len(order), "mode": "endless"}
