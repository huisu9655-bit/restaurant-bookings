#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import csv
import io
import re
import secrets
import sqlite3
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional, Tuple


DEFAULT_SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/1xmMdtK8ndT5fJn9ULvlTA3MLFdqm-m4jstmu4Xc4jWs/edit?gid=0#gid=0"
)


def utc_iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def generate_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(3)}"


def normalize_text(value) -> str:
    return str(value or "").strip()


def parse_int_metric(raw: str) -> int:
    s = normalize_text(raw).replace('"', "")
    if not s:
        return 0
    s = s.replace(" ", "")
    lower = s.lower()
    # examples: 122.8k, 11,6k, 50k, 9240, 25,8k
    m = re.fullmatch(r"([0-9]+(?:[.,][0-9]+)?)k", lower)
    if m:
        num = m.group(1)
        if "," in num and "." not in num:
            num = num.replace(",", ".")
        else:
            num = num.replace(",", "")
        try:
            return int(round(float(num) * 1000))
        except ValueError:
            return 0
    m = re.fullmatch(r"([0-9]+(?:[.,][0-9]+)?)m", lower)
    if m:
        num = m.group(1)
        if "," in num and "." not in num:
            num = num.replace(",", ".")
        else:
            num = num.replace(",", "")
        try:
            return int(round(float(num) * 1_000_000))
        except ValueError:
            return 0
    s = s.replace(",", "")
    try:
        return int(float(s))
    except ValueError:
        return 0


def parse_budget_wan(raw: str) -> float:
    s = normalize_text(raw)
    if not s:
        return 0.0
    if "不收费" in s or "免费" in s:
        return 0.0
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)", s.replace(",", ""))
    if not m:
        return 0.0
    try:
        return float(m.group(1))
    except ValueError:
        return 0.0


def to_iso_date(value: str, *, prefer_day_first: bool = True) -> str:
    s = normalize_text(value)
    if not s:
        return ""
    s = s.replace("号", "").replace("日", "")
    # YYYY/MM/DD or YYYY-MM-DD
    m = re.search(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}"
    # DD/MM/YYYY or MM/DD/YYYY
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        # Google Sheet 里可能混用 dd/mm/yyyy 与 mm/dd/yyyy；用 >12 做启发式判断。
        if a > 12 and b <= 12:
            d, mo = a, b
        elif b > 12 and a <= 12:
            mo, d = a, b
        elif prefer_day_first:
            d, mo = a, b
        else:
            mo, d = a, b
        return f"{y:04d}-{mo:02d}-{d:02d}"
    # Chinese: YYYY年M月D
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return ""


def parse_day_month_with_year(value: str, *, year: int, prefer_day_first: bool = True) -> str:
    s = normalize_text(value)
    if not s:
        return ""
    m = re.search(r"(\d{1,2})/(\d{1,2})", s)
    if not m:
        return ""
    a, b = int(m.group(1)), int(m.group(2))
    # 这里更倾向把 11/7 当作 11 日 7 月（越南/中文常见写法）。
    if a > 12 and b <= 12:
        d, mo = a, b
    elif b > 12 and a <= 12:
        # 极少情况混用 mm/dd
        mo, d = a, b
    elif prefer_day_first:
        d, mo = a, b
    else:
        mo, d = a, b
    return f"{year:04d}-{mo:02d}-{d:02d}"


def parse_post_date(value: str, *, context_year: Optional[int], fallback_year: Optional[int]) -> str:
    raw = normalize_text(value)
    if not raw:
        return ""
    iso = to_iso_date(raw)
    if iso:
        return iso
    year = context_year or fallback_year
    if not year:
        return ""
    # examples: 11/7, 18/7 hoặc 20/7
    return parse_day_month_with_year(raw, year=year, prefer_day_first=True)


def extract_month_day(text: str) -> Optional[Tuple[int, int]]:
    s = normalize_text(text)
    m = re.search(r"(\d{1,2})月(\d{1,2})", s)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def parse_visit_date_and_window(
    visit_raw: str, *, context_year: Optional[int], fallback_year: Optional[int]
) -> Tuple[str, str]:
    raw = normalize_text(visit_raw)
    if not raw:
        return "", ""

    iso = to_iso_date(raw)
    if not iso:
        md = extract_month_day(raw)
        if md:
            mo, d = md
            year = context_year or fallback_year
            if year:
                iso = f"{year:04d}-{mo:02d}-{d:02d}"

    window = raw
    if iso:
        window = raw
        window = re.sub(r"(\d{4}[/-]\d{1,2}[/-]\d{1,2})", "", window, count=1)
        window = re.sub(r"(\d{1,2}/\d{1,2}/\d{4})", "", window, count=1)
        window = re.sub(r"(\d{4}年\d{1,2}月\d{1,2})", "", window, count=1)
        window = re.sub(r"(\d{1,2}月\d{1,2})", "", window, count=1)
        window = window.replace("号", "").replace("日", "")
        window = re.sub(r"^[\s，,。\.、\-—:：]+", "", window)
        window = window.strip()

    return iso, window


def parse_tiktok_handle(profile_url: str) -> str:
    s = normalize_text(profile_url)
    if not s:
        return ""
    m = re.search(r"tiktok\.com/@([^/?#]+)", s)
    if not m:
        return ""
    handle = m.group(1).strip().lstrip("@")
    return f"@{handle}" if handle else ""


def normalize_contact_method(raw: str) -> str:
    s = normalize_text(raw)
    if not s:
        return ""
    s_lower = s.lower()
    if s_lower in {"zalo", "tiktok", "ig", "instagram", "fb", "facebook"}:
        return "ig" if s_lower == "instagram" else s_lower
    return s


@dataclass
class ImportRow:
    seq: str
    profile_url: str
    contact_raw: str
    price_raw: str
    video_rights: str
    service_detail: str
    visit_raw: str
    post_date_raw: str
    video_link: str
    views_raw: str
    likes_raw: str
    comments_raw: str
    saves_raw: str
    shares_raw: str


@dataclass
class InfluencerOnlyRow:
    profile_url: str
    contact_raw: str
    notes: str


def normalize_header_cell(value: str) -> str:
    return normalize_text(value).replace("\n", "").replace("\r", "").replace(" ", "")


def detect_sheet_mode(header_row: list[str]) -> str:
    header = [normalize_header_cell(cell) for cell in header_row]
    header_blob = ",".join([h for h in header if h])
    if "到访时间" in header_blob or "到访日期" in header_blob:
        return "booking"
    if "视频发布日期" in header_blob and "视频链接" in header_blob and "到访时间" not in header_blob:
        return "walkin"
    return "booking"


def detect_columns(header_row: list[str]) -> dict:
    header = [normalize_header_cell(cell) for cell in header_row]

    def find_col(*needles: str) -> Optional[int]:
        for i, h in enumerate(header):
            if not h:
                continue
            for n in needles:
                if n and n in h:
                    return i
        return None

    return {
        "id": find_col("ID", "链接", "主页"),
        "contact": find_col("联系方式", "联系"),
        "price": find_col("价格", "报价"),
        "service": find_col("具体服务", "服务"),
        "rights": find_col("视频授权", "授权"),
        "visit": find_col("到访时间", "到访"),
        "post": find_col("视频发布日期", "发布日期"),
        "video": find_col("视频链接", "链接"),
        "result": find_col("视频结果", "结果"),
        "note": find_col("备注"),
    }


def is_tiktok_profile_url(value: str) -> bool:
    s = normalize_text(value)
    return "tiktok.com/@" in s


def extract_influencer_only_rows(csv_text: str) -> list[InfluencerOnlyRow]:
    cols = None
    rows = []
    current = None
    buffer_notes: list[str] = []

    def flush():
        nonlocal current, buffer_notes
        if not current:
            buffer_notes = []
            return
        notes = "\n".join([n for n in buffer_notes if normalize_text(n)]).strip()
        rows.append(
            InfluencerOnlyRow(
                profile_url=current.get("profile_url", ""),
                contact_raw=current.get("contact_raw", ""),
                notes=notes,
            )
        )
        current = None
        buffer_notes = []

    for row in read_rows(csv_text):
        first = normalize_text(row[0])
        if cols is None and (first and ("ID" in first or "序号" in first or "链接" in first)):
            cols = detect_columns(row)
            continue
        if cols is None:
            # fallback: use default positions (A empty, B=ID, D=联系方式)
            cols = {"id": 1, "contact": 3, "price": 4, "rights": 5, "service": 6, "visit": 7, "post": 8, "video": 9, "result": 10, "note": None}

        id_col = cols.get("id")
        profile_url = normalize_text(row[id_col]) if isinstance(id_col, int) and id_col < len(row) else ""
        if is_tiktok_profile_url(profile_url):
            # new influencer begins
            flush()
            contact_col = cols.get("contact")
            contact_raw = normalize_text(row[contact_col]) if isinstance(contact_col, int) and contact_col < len(row) else ""
            current = {"profile_url": profile_url, "contact_raw": contact_raw}

            # capture meaningful columns as notes (不覆盖联系方式)
            note_parts = []
            for key, label in [
                ("price", "价格"),
                ("rights", "视频授权"),
                ("service", "具体服务"),
                ("visit", "到访时间"),
                ("post", "视频发布日期"),
                ("video", "视频链接"),
                ("result", "视频结果"),
                ("note", "备注"),
            ]:
                idx = cols.get(key)
                if not isinstance(idx, int) or idx >= len(row):
                    continue
                val = normalize_text(row[idx])
                if val and (key != "video" or "tiktok.com/" not in val):
                    note_parts.append(f"{label}：{val}")
            if note_parts:
                buffer_notes.extend(note_parts)
            continue

        # lines without profile url: treat as continuation notes for previous influencer
        if current:
            extra = " ".join([normalize_text(cell) for cell in row if normalize_text(cell)])
            if extra:
                buffer_notes.append(extra)

    flush()
    # remove duplicates by profile_url
    seen = set()
    unique = []
    for r in rows:
        key = normalize_text(r.profile_url)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(r)
    return unique


def fetch_csv_text(sheet_url: str, gid: str) -> str:
    m = re.search(r"/d/([a-zA-Z0-9-_]+)", sheet_url)
    if not m:
        raise SystemExit("无法从链接解析 Google Sheet ID")
    sheet_id = m.group(1)
    export_url = (
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={urllib.parse.quote(str(gid))}"
    )
    with urllib.request.urlopen(export_url) as resp:
        raw = resp.read()
    return raw.decode("utf-8", errors="replace")


def read_rows(csv_text: str) -> Iterator[list[str]]:
    reader = csv.reader(io.StringIO(csv_text))
    for row in reader:
        row = list(row)
        if len(row) < 15:
            row = row + [""] * (15 - len(row))
        yield row[:15]


def extract_import_rows(csv_text: str) -> Iterator[Tuple[Optional[int], ImportRow]]:
    context_year: Optional[int] = None
    mode: Optional[str] = None
    for row in read_rows(csv_text):
        first = normalize_text(row[0])
        if first and ("序号" in first or first.lower() == "no" or first.lower() == "index"):
            mode = detect_sheet_mode(row)
            continue
        if not first:
            # context line: ",21/12/2023,..."
            maybe_date = normalize_text(row[1])
            iso = to_iso_date(maybe_date)
            if iso:
                context_year = int(iso[:4])
            continue
        if not re.fullmatch(r"\d+", first):
            continue

        active_mode = mode or "booking"
        if active_mode == "walkin":
            # walk-in sheet columns: 序号,ID,图片,视频发布日期,视频链接,视频结果/备注,...
            yield context_year, ImportRow(
                seq=first,
                profile_url=row[1],
                contact_raw="",
                price_raw="",
                video_rights="",
                service_detail="",
                visit_raw=row[5],
                post_date_raw=row[3],
                video_link=row[4],
                views_raw=row[10],
                likes_raw=row[11],
                comments_raw=row[12],
                saves_raw=row[13],
                shares_raw=row[14],
            )
            continue

        yield context_year, ImportRow(
            seq=first,
            profile_url=row[1],
            contact_raw=row[3],
            price_raw=row[4],
            video_rights=row[5],
            service_detail=row[6],
            visit_raw=row[7],
            post_date_raw=row[8],
            video_link=row[9],
            views_raw=row[10],
            likes_raw=row[11],
            comments_raw=row[12],
            saves_raw=row[13],
            shares_raw=row[14],
        )


def ensure_store(conn: sqlite3.Connection, store_id: str) -> Tuple[str, str]:
    cur = conn.execute("SELECT id, name FROM stores WHERE id = ?", (store_id,))
    row = cur.fetchone()
    if not row:
        raise SystemExit(f"未找到门店 storeId={store_id}，请先在系统里创建或传入正确 storeId")
    return row[0], row[1]


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column in cols:
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def find_influencer_by_handle(conn: sqlite3.Connection, handle: str):
    if not handle:
        return None
    cur = conn.execute("SELECT * FROM influencers WHERE handle = ? LIMIT 1", (handle,))
    return cur.fetchone()


def create_or_patch_influencer(
    conn: sqlite3.Connection, *, handle: str, contact_raw: str, profile_url: str, notes: str = ""
):
    existing = find_influencer_by_handle(conn, handle)
    now = utc_iso_now()
    display_name = handle.lstrip("@") if handle else "未命名达人"
    profile_link = normalize_text(profile_url)
    notes_text = normalize_text(notes)

    contact_method = normalize_contact_method(contact_raw)
    contact_info = ""
    if contact_method and re.fullmatch(r"[0-9\s+()-]{6,}", contact_method):
        contact_info = contact_method
        contact_method = ""

    if existing:
        # patch missing fields only
        updates = {}
        if not normalize_text(existing["displayName"]) and display_name:
            updates["displayName"] = display_name
        if not normalize_text(existing["handle"]) and handle:
            updates["handle"] = handle
        if not normalize_text(existing["contactMethod"]) and contact_method:
            updates["contactMethod"] = contact_method
        if not normalize_text(existing["contactInfo"]) and contact_info:
            updates["contactInfo"] = contact_info
        if "profileLink" in existing.keys() and not normalize_text(existing["profileLink"]) and profile_link:
            updates["profileLink"] = profile_link
        if "notes" in existing.keys() and not normalize_text(existing["notes"]) and notes_text:
            updates["notes"] = notes_text
        if updates:
            updates["updatedAt"] = now
            sets = ", ".join([f"{k} = :{k}" for k in updates.keys()])
            payload = dict(updates)
            payload["id"] = existing["id"]
            conn.execute(f"UPDATE influencers SET {sets} WHERE id = :id", payload)
            cur = conn.execute("SELECT * FROM influencers WHERE id = ?", (existing["id"],))
            return cur.fetchone(), True, False
        return existing, False, False

    inf_id = generate_id("inf")
    conn.execute(
        """
        INSERT INTO influencers (
          id, displayName, handle, avatarData, contactMethod, contactInfo, notes, profileLink, createdAt, updatedAt
        ) VALUES (
          ?, ?, ?, '', ?, ?, '', ?, ?, ?
        )
        """,
        (inf_id, display_name, handle, contact_method, contact_info, profile_link, now, now),
    )
    if notes_text:
        conn.execute("UPDATE influencers SET notes = ? WHERE id = ?", (notes_text, inf_id))
    cur = conn.execute("SELECT * FROM influencers WHERE id = ?", (inf_id,))
    return cur.fetchone(), False, True


def find_booking_by_video_link(conn: sqlite3.Connection, video_link: str):
    link = normalize_text(video_link)
    if not link:
        return None
    cur = conn.execute("SELECT * FROM bookings WHERE videoLink = ? LIMIT 1", (link,))
    return cur.fetchone()


def build_import_tag(external_key: str) -> str:
    key = normalize_text(external_key)
    return f"[import:{key}]" if key else ""


def find_booking(
    conn: sqlite3.Connection,
    *,
    video_link: str,
    handle: str,
    post_date: str,
    store_id: str,
    source_type: str,
    external_key: str,
):
    link = normalize_text(video_link)
    ext = normalize_text(external_key)
    if ext:
        placeholder = f"import:{ext}"
        tag = build_import_tag(ext)
        cur = conn.execute(
            "SELECT * FROM bookings WHERE videoLink = ? OR notes LIKE ? LIMIT 1",
            (placeholder, f"%{tag}%"),
        )
        row = cur.fetchone()
        if row:
            return row
    if link:
        row = find_booking_by_video_link(conn, link)
        if row:
            return row
    # Fallback for rows without videoLink (walk-in sheet often has blanks)
    h = normalize_text(handle)
    p = normalize_text(post_date)
    s = normalize_text(store_id)
    t = normalize_text(source_type)
    if h and s and t:
        cur = conn.execute(
            "SELECT * FROM bookings WHERE handle = ? AND postDate = ? AND storeId = ? AND sourceType = ? LIMIT 1",
            (h, p, s, t),
        )
        return cur.fetchone()
    return None


def create_or_update_booking(
    conn: sqlite3.Connection,
    *,
    store_id: str,
    store_name: str,
    influencer_row,
    visit_date: str,
    visit_window: str,
    service_detail: str,
    video_rights: str,
    post_date: str,
    video_link: str,
    budget_wan: float,
    notes: str,
    source_type: str,
    external_key: str,
    allow_update_store: bool,
    allow_update_existing: bool,
):
    effective_source_type = normalize_text(source_type) if normalize_text(source_type) in {"预约", "自来"} else "预约"
    effective_video_link = normalize_text(video_link)
    ext = normalize_text(external_key)
    if ext and not effective_video_link:
        effective_video_link = f"import:{ext}"
    tag = build_import_tag(ext)
    effective_notes = normalize_text(notes)
    if tag and tag not in effective_notes:
        effective_notes = f"{effective_notes}\n{tag}".strip() if effective_notes else tag

    existing = find_booking(
        conn,
        video_link=effective_video_link,
        handle=normalize_text(influencer_row["handle"]),
        post_date=normalize_text(post_date),
        store_id=store_id,
        source_type=effective_source_type,
        external_key=ext,
    )
    if existing:
        changed = False
        if allow_update_store and existing["storeId"] != store_id:
            conn.execute(
                "UPDATE bookings SET storeId = ?, storeName = ? WHERE id = ?",
                (store_id, store_name, existing["id"]),
            )
            conn.execute(
                "UPDATE traffic_logs SET storeName = ? WHERE bookingId = ?",
                (store_name, existing["id"]),
            )
            changed = True

        if allow_update_existing:
            updates = {}
            if tag and tag not in normalize_text(existing["notes"]):
                prev_notes = normalize_text(existing["notes"])
                updates["notes"] = f"{prev_notes}\n{tag}".strip() if prev_notes else tag
            if not normalize_text(existing["visitDate"]) and visit_date:
                updates["visitDate"] = visit_date
            if not normalize_text(existing["visitWindow"]) and visit_window:
                updates["visitWindow"] = visit_window
            if not normalize_text(existing["serviceDetail"]) and normalize_text(service_detail):
                updates["serviceDetail"] = normalize_text(service_detail)
            if not normalize_text(existing["videoRights"]) and normalize_text(video_rights):
                updates["videoRights"] = normalize_text(video_rights)
            if not normalize_text(existing["postDate"]) and post_date:
                updates["postDate"] = post_date
            if effective_source_type and normalize_text(existing["sourceType"]) != effective_source_type:
                updates["sourceType"] = effective_source_type
            if effective_video_link and (
                not normalize_text(existing["videoLink"]) or normalize_text(existing["videoLink"]).startswith("import:")
            ):
                updates["videoLink"] = effective_video_link
            if (existing["budgetMillionVND"] or 0) == 0 and float(budget_wan or 0) > 0:
                updates["budgetMillionVND"] = float(budget_wan or 0)
            if not normalize_text(existing["notes"]) and effective_notes:
                updates["notes"] = effective_notes
            if updates:
                sets = ", ".join([f"{k} = :{k}" for k in updates.keys()])
                payload = dict(updates)
                payload["id"] = existing["id"]
                conn.execute(f"UPDATE bookings SET {sets} WHERE id = :id", payload)
                changed = True

        if changed:
            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (existing["id"],))
            return cur.fetchone(), False, True
        return existing, False, False

    now = utc_iso_now()
    booking_id = generate_id("bk")
    conn.execute(
        """
        INSERT INTO bookings (
          id, storeId, storeName, influencerId, creatorName, handle, contactMethod, contactInfo,
          visitDate, visitWindow, sourceType, serviceDetail, videoRights, postDate, videoLink,
          budgetMillionVND, notes, createdAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?
        )
        """,
        (
            booking_id,
            store_id,
            store_name,
            influencer_row["id"],
            influencer_row["displayName"],
            influencer_row["handle"] or "",
            influencer_row["contactMethod"] or "",
            influencer_row["contactInfo"] or "",
            visit_date,
            visit_window,
            effective_source_type,
            normalize_text(service_detail),
            normalize_text(video_rights),
            post_date,
            effective_video_link,
            float(budget_wan or 0),
            effective_notes,
            now,
        ),
    )
    cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
    return cur.fetchone(), True, False


def upsert_traffic_for_booking(
    conn: sqlite3.Connection,
    *,
    booking_row,
    views: int,
    likes: int,
    comments: int,
    saves: int,
    shares: int,
    note: str,
):
    if max(views, likes, comments, saves, shares) <= 0:
        return False, False

    cur = conn.execute("SELECT * FROM traffic_logs WHERE bookingId = ? LIMIT 1", (booking_row["id"],))
    existing = cur.fetchone()
    now = utc_iso_now()
    if existing:
        next_post_date = normalize_text(booking_row["postDate"])
        next_video_link = normalize_text(booking_row["videoLink"])
        if (
            int(existing["views"] or 0) == int(views)
            and int(existing["likes"] or 0) == int(likes)
            and int(existing["comments"] or 0) == int(comments)
            and int(existing["saves"] or 0) == int(saves)
            and int(existing["shares"] or 0) == int(shares)
            and normalize_text(existing["postDate"]) == next_post_date
            and normalize_text(existing["videoLink"]) == next_video_link
            and normalize_text(existing["note"]) == normalize_text(note)
        ):
            return False, False
        conn.execute(
            """
            UPDATE traffic_logs
            SET views = ?, likes = ?, comments = ?, saves = ?, shares = ?,
                postDate = ?, videoLink = ?, note = ?, capturedAt = ?
            WHERE id = ?
            """,
            (
                views,
                likes,
                comments,
                saves,
                shares,
                next_post_date,
                next_video_link,
                note,
                now,
                existing["id"],
            ),
        )
        return False, True

    traffic_id = generate_id("traffic")
    conn.execute(
        """
        INSERT INTO traffic_logs (
          id, bookingId, influencerId, influencerName, storeName, sourceType, postDate, videoLink,
          views, likes, comments, saves, shares, note, capturedAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?
        )
        """,
        (
            traffic_id,
            booking_row["id"],
            booking_row["influencerId"],
            booking_row["creatorName"],
            booking_row["storeName"],
            booking_row["sourceType"],
            booking_row["postDate"],
            booking_row["videoLink"],
            views,
            likes,
            comments,
            saves,
            shares,
            note,
            now,
        ),
    )
    return True, False


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="从 Google Sheet 导入预约与流量到 data/app.db")
    parser.add_argument("--sheet-url", default=DEFAULT_SHEET_URL, help="Google Sheet 链接")
    parser.add_argument("--gid", default="0", help="Sheet gid")
    parser.add_argument(
        "--db",
        default=str(Path(__file__).resolve().parent.parent / "data" / "app.db"),
        help="SQLite DB 路径",
    )
    parser.add_argument("--store-id", default="store-mlzg", help="导入预约归属门店 id")
    parser.add_argument(
        "--update-store",
        action="store_true",
        help="若预约已存在（按 videoLink 匹配），更新其 storeId/storeName",
    )
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help="若预约已存在（按 videoLink 匹配），补全其空字段（不覆盖已有内容）",
    )
    parser.add_argument(
        "--source-type",
        default="auto",
        help="预约类型：auto/预约/自来（auto 会按表头判断）",
    )
    parser.add_argument("--only-influencers", action="store_true", help="只导入达人档案，不导入预约/流量")
    parser.add_argument("--apply", action="store_true", help="实际写入数据库（默认只 dry-run）")
    args = parser.parse_args(argv)

    csv_text = fetch_csv_text(args.sheet_url, args.gid)
    db_path = Path(args.db)
    if not db_path.exists():
        raise SystemExit(f"未找到数据库文件：{db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_column(conn, "influencers", "profileLink", "TEXT DEFAULT ''")
    store_id, store_name = ensure_store(conn, args.store_id)

    stats = {
        "influencers_created": 0,
        "influencers_patched": 0,
        "bookings_created": 0,
        "bookings_updated": 0,
        "bookings_skipped": 0,
        "traffic_created": 0,
        "traffic_updated": 0,
    }

    try:
        if args.apply:
            conn.execute("BEGIN")
        # 预先判断一次 sheet 模式（用于 auto sourceType）
        sheet_mode = "booking"
        for probe in read_rows(csv_text):
            probe_first = normalize_text(probe[0])
            if probe_first and ("序号" in probe_first or probe_first.lower() == "no" or probe_first.lower() == "index" or "ID" in probe_first):
                sheet_mode = detect_sheet_mode(probe)
                break

        if args.only_influencers:
            influencer_rows = extract_influencer_only_rows(csv_text)
            for row in influencer_rows:
                handle = parse_tiktok_handle(row.profile_url)
                _, patched, created = create_or_patch_influencer(
                    conn,
                    handle=handle,
                    contact_raw=row.contact_raw,
                    profile_url=row.profile_url,
                    notes=row.notes,
                )
                if created:
                    stats["influencers_created"] += 1
                elif patched:
                    stats["influencers_patched"] += 1
            if args.apply:
                conn.execute("COMMIT")
            print(
                "导入结果：\n"
                f"- 新增达人：{stats['influencers_created']}\n"
                f"- 补全达人信息：{stats['influencers_patched']}\n"
                + ("" if args.apply else "- (dry-run，未写入；加 --apply 才会写入)\n")
            )
            return 0

        for context_year, item in extract_import_rows(csv_text):
            handle = parse_tiktok_handle(item.profile_url)
            influencer_row, patched, created = create_or_patch_influencer(
                conn, handle=handle, contact_raw=item.contact_raw, profile_url=item.profile_url
            )
            if created:
                stats["influencers_created"] += 1
            elif patched:
                stats["influencers_patched"] += 1

            post_date = parse_post_date(item.post_date_raw, context_year=context_year, fallback_year=context_year)
            if sheet_mode == "walkin":
                visit_date, visit_window = "", ""
                notes = normalize_text(item.visit_raw)
                budget_wan = 0.0
            else:
                fallback_year = int(post_date[:4]) if post_date else context_year
                visit_date, visit_window = parse_visit_date_and_window(
                    item.visit_raw, context_year=context_year, fallback_year=fallback_year
                )
                notes = normalize_text(item.visit_raw)
                budget_wan = parse_budget_wan(item.price_raw)

            if args.source_type == "auto":
                source_type = "自来" if sheet_mode == "walkin" else "预约"
            else:
                source_type = args.source_type

            external_key = ""
            if sheet_mode == "walkin":
                external_key = f"walkin:{normalize_text(args.gid)}:{normalize_text(item.seq)}"

            booking_row, created_booking, store_updated = create_or_update_booking(
                conn,
                store_id=store_id,
                store_name=store_name,
                influencer_row=influencer_row,
                visit_date=visit_date,
                visit_window=visit_window,
                service_detail=item.service_detail,
                video_rights=item.video_rights,
                post_date=post_date,
                video_link=item.video_link,
                budget_wan=budget_wan,
                notes=notes,
                source_type=source_type,
                external_key=external_key,
                allow_update_store=args.update_store,
                allow_update_existing=args.update_existing,
            )
            if created_booking:
                stats["bookings_created"] += 1
            elif store_updated:
                stats["bookings_updated"] += 1
            else:
                stats["bookings_skipped"] += 1

            created_traffic, updated_traffic = upsert_traffic_for_booking(
                conn,
                booking_row=booking_row,
                views=parse_int_metric(item.views_raw),
                likes=parse_int_metric(item.likes_raw),
                comments=parse_int_metric(item.comments_raw),
                saves=parse_int_metric(item.saves_raw),
                shares=parse_int_metric(item.shares_raw),
                note="",
            )
            if created_traffic:
                stats["traffic_created"] += 1
            elif updated_traffic:
                stats["traffic_updated"] += 1

        if args.apply:
            conn.execute("COMMIT")
    except Exception:
        if args.apply:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()

    print(
        "导入结果：\n"
        f"- 门店：{store_name} ({store_id})\n"
        f"- 新增达人：{stats['influencers_created']}\n"
        f"- 补全达人信息：{stats['influencers_patched']}\n"
        f"- 新增预约：{stats['bookings_created']}\n"
        f"- 更新预约：{stats['bookings_updated']}\n"
        f"- 跳过已存在预约：{stats['bookings_skipped']}\n"
        f"- 新增流量：{stats['traffic_created']}\n"
        f"- 更新流量：{stats['traffic_updated']}\n"
        + ("" if args.apply else "- (dry-run，未写入；加 --apply 才会写入)\n")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
