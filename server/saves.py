"""甲方要圆：按名字存的云存档。

没有密码：同一个名字就是同一份存档。存的只是“每一单拿过的最高酬劳”，合并时取较大值，
所以别人用了你的名字，最多让成绩变高，抹不掉你的进度。名字不合适的可以在后台删掉。
"""
from __future__ import annotations

import json
import time
import unicodedata

NAME_MAX = 16
EXTRA_CHARS = set(" -_·.'")
MAX_ORDERS = 120
MAX_PAY = 1_000_000


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


def sync(con, raw_name, pid: str | None, raw_best) -> dict | None:
    """把客户端的进度合并进这个名字的存档，返回合并后的 {name, best}。名字不合法返回 None。"""
    nk = clean_name(raw_name)
    if not nk:
        return None
    name, key = nk
    incoming, now = clean_best(raw_best), time.time()
    row = con.execute("SELECT name, best FROM saves WHERE key = ?", (key,)).fetchone()
    if row:
        name, best = row[0], json.loads(row[1])
        for k, v in incoming.items():
            if v > best.get(k, 0):
                best[k] = v
        con.execute("UPDATE saves SET best = ?, updated = ?, syncs = syncs + 1 WHERE key = ?",
                    (json.dumps(best, separators=(",", ":")), now, key))
    else:
        best = incoming
        con.execute("INSERT INTO saves (key, name, best, created, updated, syncs) VALUES (?,?,?,?,?,1)",
                    (key, name, json.dumps(best, separators=(",", ":")), now, now))
    if pid:
        con.execute("""INSERT INTO save_pids (key, pid, first, last) VALUES (?,?,?,?)
                       ON CONFLICT(key, pid) DO UPDATE SET last = excluded.last""", (key, pid, now, now))
    con.commit()
    return {"name": name, "best": best}


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
        SELECT s.key, s.name, s.best, s.created, s.updated, s.syncs,
               (SELECT COUNT(*) FROM save_pids sp WHERE sp.key = s.key),
               (SELECT MAX(e.ts) FROM events e JOIN save_pids sp ON sp.pid = e.pid WHERE sp.key = s.key)
        FROM saves s ORDER BY s.updated DESC LIMIT ?""", (limit,)).fetchall()
    out = []
    for key, name, best, created, updated, syncs, devices, last_play in rows:
        b = json.loads(best)
        done = [idx[k] for k, v in b.items() if v > 0 and k in idx]
        out.append({"key": key, "name": name, "delivered": len(done), "furthest": max(done) if done else None,
                    "total": sum(b.values()), "devices": devices, "created": created,
                    "last": max(x for x in (updated, last_play) if x)})
    return out


def delete(con, key: str) -> bool:
    if not isinstance(key, str) or not key:
        return False
    n = con.execute("DELETE FROM saves WHERE key = ?", (key,)).rowcount
    con.execute("DELETE FROM save_pids WHERE key = ?", (key,))
    con.commit()
    return n > 0
