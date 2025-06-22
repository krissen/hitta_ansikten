#!/usr/bin/env python3
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

from faceid_db import ARCHIVE_DIR
from faceid_db import ATTEMPT_LOG_PATH as ATTEMPT_FILE
from faceid_db import LOGGING_PATH as LOG_FILE
from faceid_db import extract_face_labels, load_database

# ================== Laddning och grundstatistik ====================

def load_stats(logfile):
    stats = []
    with open(logfile, "r") as f:
        for line in f:
            try:
                stats.append(json.loads(line))
            except Exception:
                pass
    return stats

def load_multiple_stats(files):
    stats = []
    for f in files:
        label = Path(f).stem
        for line in open(f):
            try:
                entry = json.loads(line)
                entry["__sourcefile"] = label
                stats.append(entry)
            except Exception:
                pass
    return stats

def find_all_stats_files():
    files = []
    if ATTEMPT_FILE.exists():
        files.append(ATTEMPT_FILE)
    if ARCHIVE_DIR.exists():
        files += sorted(ARCHIVE_DIR.glob("attempt_stats*.jsonl"))
    return files

# ================== Statistik- och hjälpfunktioner ====================

def count_faces_per_name():
    known_faces, _, _ = load_database()
    return {name: len(entries) for name, entries in known_faces.items()}

def calc_ignored_fraction(stats):
    total = 0
    ignored = 0
    for entry in stats:
        used = entry.get("used_attempt")
        labels_per_attempt = entry.get("labels_per_attempt")
        if used is not None and labels_per_attempt and used < len(labels_per_attempt):
            for label in labels_per_attempt[used]:
                if isinstance(label, dict):
                    label = label.get("label", "")
                total += 1
                if label.strip().lower().endswith("ignorerad") or label.strip().lower() == "ign":
                    ignored += 1
    frac = (ignored / total) if total else 0
    return ignored, total, frac

def attempt_stats_table(stats):
    attempt_info = defaultdict(lambda: {"used": 0, "faces": 0, "time": 0.0, "total": 0})
    for entry in stats:
        attempts = entry.get("attempts", [])
        used = entry.get("used_attempt")
        for att in attempts:
            key = (
                att.get("model"),
                att.get("upsample"),
                att.get("scale_label"),
                att.get("scale_px"),
            )
            attempt_info[key]["total"] += 1
        if used is not None and attempts and used < len(attempts):
            setting = attempts[used]
            key = (
                setting.get("model"),
                setting.get("upsample"),
                setting.get("scale_label"),
                setting.get("scale_px"),
            )
            attempt_info[key]["used"] += 1
            attempt_info[key]["faces"] += setting.get("faces_found", 0)
            attempt_info[key]["time"] += setting.get("time_seconds", 0.0)
    from rich.table import Table
    table = Table(show_header=True, header_style="bold")
    table.add_column("Försök (modell, upsample, skala)", min_width=28)
    table.add_column("Använd", justify="right")
    table.add_column("Total", justify="right")
    table.add_column("Träff %", justify="right")
    table.add_column("Snitt ansikten", justify="right")
    table.add_column("Snitt tid", justify="right")
    for key, info in attempt_info.items():
        model, upsample, scale, px = key
        n_used = info["used"]
        n_total = info["total"]
        mean_faces = info["faces"] / n_used if n_used else 0
        mean_time = info["time"] / n_used if n_used else 0
        hit_rate = 100 * n_used / n_total if n_total else 0
        table.add_row(
            f"{model}, up={upsample}, {scale}({px})",
            str(n_used),
            str(n_total),
            f"{hit_rate:6.1f}%",
            f"{mean_faces:>6.2f}",
            f"{mean_time:>6.2f}s",
        )
    return table

def faces_grid_panel(stats=None):
    from rich.panel import Panel
    from rich.table import Table

    block_title_style = "bold green3"
    num_cols = 4
    num_rows = 5
    max_items = num_cols * num_rows
    face_counts = count_faces_per_name()
    ignored, total, frac = calc_ignored_fraction(stats)
    ignored_str = f"Ignored ({ignored}/{total}, {frac:.1%})" if total else "Ignored (0)"

    # Bygg lista av namn + count (sorterad fallande)
    items = sorted(face_counts.items(), key=lambda x: -x[1])[:max_items-1]
    while len(items) < max_items-1:
        items.append(("", ""))
    items.append(("Ignored", ignored_str))  # Sista rutan
    grid = []
    for row in range(num_rows):
        grid_row = []
        for col in range(num_cols):
            idx = col * num_rows + row
            name, cnt = items[idx] if idx < len(items) else ("", "")
            grid_row.append(f"{name} ({cnt})" if name and name != "Ignored" else cnt if name == "Ignored" else "")
        grid.append(grid_row)
    table = Table(show_header=False, box=None, pad_edge=False)
    for _ in range(num_cols):
        table.add_column(justify="left", ratio=1)
    for grid_row in grid:
        table.add_row(*grid_row)
    if not any(name for name, cnt in items):
        table.add_row(*["–"]*num_cols)
    return Panel(
        table,
        title=f"Vanligaste ansikten (topp {max_items-1} + Ignored)",
        title_align="left",
        border_style=block_title_style,
    )


def latest_images_with_names(stats, n=5):
    lines = []
    last = sorted(stats, key=lambda x: x.get("timestamp", ""), reverse=True)[:n]
    for entry in last:
        fname = Path(entry.get("filename", "")).name
        used = entry.get("used_attempt")
        labels_per_attempt = entry.get("labels_per_attempt")
        if used is not None and labels_per_attempt and used < len(labels_per_attempt):
            names = extract_face_labels(labels_per_attempt[used])
            namestr = ", ".join(names) if names else "-"
        else:
            namestr = "-"
        lines.append(f"{fname:<35} {namestr}")
    return "\n".join(lines)

def pie_chart_attempts(stats):
    from math import ceil
    attempt_use = Counter()
    total = 0
    for entry in stats:
        used = entry.get("used_attempt")
        if used is not None:
            attempt_use[used+1] += 1  # +1 för mänsklig numrering
            total += 1
    if total == 0:
        return "Inga attempts."
    chart = "Färg: attempt-index  |  #N: försök N\n"
    chars = ["◼️", "◻️", "⬛", "🟩", "🟦", "🟨", "🟧", "🟥", "🟪", "🟫"]
    sum_length = 24
    for i, (k, v) in enumerate(sorted(attempt_use.items())):
        length = ceil((v / total) * sum_length)
        desc = ""
        for entry in stats:
            u = entry.get("used_attempt")
            if u is not None and (u+1) == k:
                attempts = entry.get("attempts", [])
                if attempts and u < len(attempts):
                    att = attempts[u]
                    desc = f"{att.get('model')}, up={att.get('upsample')}, {att.get('scale_label')}({att.get('scale_px')})"
                    break
        chart += f"#{k}: {chars[i%len(chars)]*length} {v} ({v/total:.1%}) {desc}\n"
    return chart

# ================== Rich Dashboard (Live) ====================
def get_recent_log_lines(n=3, logfile=LOG_FILE):
    # Byt till rätt sökväg om nödvändigt
    try:
        with open(logfile, "r") as f:
            lines = f.readlines()
        return "".join(lines[-n:]).strip()
    except Exception:
        return "(Kunde inte läsa loggfilen)"

def render_dashboard(stats):
    from rich.layout import Layout
    from rich.panel import Panel
    from rich.text import Text

    block_title_style = "bold green3"
    table = attempt_stats_table(stats)
    faces_panel = faces_grid_panel(stats)
    latest_panel = Panel(
        Text(latest_images_with_names(stats, n=3), style="", overflow="ellipsis"),
        title="Senaste 3 bilder (namn)",
        title_align="left",
        border_style=block_title_style,
    )
    log_panel = Panel(
        Text(get_recent_log_lines(), style="", overflow="ellipsis"),
        title="Senaste rader från loggen",
        title_align="left",
        border_style=block_title_style,
    )

    outer = Layout()
    inner = Layout()
    outer.split_column(Layout(inner, ratio=1))
    inner.split(
        Layout(
            Panel(table, title="Attempt-statistik", title_align="left", border_style=block_title_style),
            name="upper", ratio=2
        ),
        Layout(
            faces_panel if hasattr(faces_panel, 'border_style') else Panel(faces_panel.renderable, title=faces_panel.title, title_align="left", border_style=block_title_style),
            name="faces", ratio=1
        ),
        Layout(latest_panel, name="latest", ratio=1),
        Layout(log_panel, name="log", ratio=1),
    )
    return outer

def dashboard_mode(log_file):
    try:
        from rich.console import Console
        from rich.live import Live
    except ImportError:
        print("Du måste installera 'rich' för att köra dashboarden.")
        return
    import time

    console = Console()
    last_mtime = None
    stats = []
    with Live(render_dashboard(stats), refresh_per_second=2, console=console) as live:
        while True:
            try:
                mtime = os.path.getmtime(log_file)
                if last_mtime is None or mtime != last_mtime:
                    last_mtime = mtime
                    with open(log_file) as f:
                        stats = [json.loads(line) for line in f]
                    live.update(render_dashboard(stats))
                time.sleep(2)
            except KeyboardInterrupt:
                break
            except Exception as e:
                console.print(f"[röd]Fel i dashboard: {e}")
                time.sleep(2)

# ================== CLI Entry-point ====================

def analyze(stats, group_by_source=False):
    if group_by_source:
        sources = defaultdict(list)
        for entry in stats:
            sources[entry.get("__sourcefile", "current")].append(entry)
        for label, entries in sources.items():
            print(f"\n##### Statistik för databas: {label} #####")
            _analyze_single(entries)
    else:
        _analyze_single(stats)

def _analyze_single(stats):
    attempt_success = Counter()
    attempt_info = defaultdict(lambda: {"used": 0, "faces": 0, "time": 0.0, "total": 0})
    review_outcomes = Counter()
    scale_stats = defaultdict(lambda: {"used": 0, "total": 0, "time": 0.0, "faces": 0})
    upsample_stats = defaultdict(lambda: {"used": 0, "total": 0})
    label_stats = Counter()
    position_label_stats = defaultdict(Counter)

    for entry in stats:
        attempts = entry["attempts"]
        used = entry.get("used_attempt")
        review_results = entry.get("review_results")
        labels_per_attempt = entry.get("labels_per_attempt")

        if used is not None:
            setting = attempts[used]
            key = (
                setting.get("model"),
                setting.get("upsample"),
                setting.get("scale_label"),
                setting.get("scale_px"),
            )
            attempt_success[key] += 1
            scale_stats[setting.get("scale_label")]["used"] += 1
            upsample_stats[setting.get("upsample")]["used"] += 1

        for att in attempts:
            key = (
                att.get("model"),
                att.get("upsample"),
                att.get("scale_label"),
                att.get("scale_px"),
            )
            attempt_info[key]["total"] += 1
            scale_stats[att.get("scale_label")]["total"] += 1
            upsample_stats[att.get("upsample")]["total"] += 1
        if used is not None:
            setting = attempts[used]
            key = (
                setting.get("model"),
                setting.get("upsample"),
                setting.get("scale_label"),
                setting.get("scale_px"),
            )
            attempt_info[key]["used"] += 1
            attempt_info[key]["faces"] += setting.get("faces_found", 0)
            attempt_info[key]["time"] += setting.get("time_seconds", 0.0)
            scale_stats[setting.get("scale_label")]["faces"] += setting.get("faces_found", 0)
            scale_stats[setting.get("scale_label")]["time"] += setting.get("time_seconds", 0.0)

        if review_results and labels_per_attempt:
            for i, (result, labels) in enumerate(zip(review_results, labels_per_attempt)):
                review_outcomes[result] += 1
                for pos, label in enumerate(labels):
                    label_stats[label] += 1
                    position_label_stats[pos][label] += 1

    print("=== Hur ofta valdes varje attempt (modell, upsample, skala) ===")
    for key, count in attempt_success.most_common():
        model, upsample, scale, px = key
        print(f"  model={model}, upsample={upsample}, scale={scale} ({px}px): {count} gånger")

    print("\n=== Successrate per attempt-setup ===")
    for key, info in attempt_info.items():
        model, upsample, scale, px = key
        n_used = info["used"]
        n_total = info["total"]
        mean_faces = info["faces"] / n_used if n_used else 0
        mean_time = info["time"] / n_used if n_used else 0
        print(
            f"  model={model}, upsample={upsample}, scale={scale} ({px}px): "
            f"{n_used} av {n_total} ({100*n_used/n_total:.1f}%) | snitt ansikten {mean_faces:.2f}, snitt tid {mean_time:.2f}s"
        )

    print("\n=== Outcomes (review_results) ===")
    for res, count in review_outcomes.items():
        print(f"  {res:>12}: {count}")

    print("\n=== Label-statistik (totalt) ===")
    for label, count in label_stats.most_common(20):
        print(f"  {label:>20}: {count}")

    print("\n=== Användning per skala ===")
    for scale, info in scale_stats.items():
        n_used = info["used"]
        n_total = info["total"]
        mean_faces = info["faces"] / n_used if n_used else 0
        mean_time = info["time"] / n_used if n_used else 0
        print(
            f"  {scale}: {n_used} av {n_total} ({100*n_used/n_total:.1f}%) | snitt ansikten {mean_faces:.2f}, snitt tid {mean_time:.2f}s"
        )

    print("\n=== Användning per upsample ===")
    for upsample, info in upsample_stats.items():
        print(
            f"  upsample={upsample}: {info['used']} av {info['total']} ({100*info['used']/info['total']:.1f}%)"
        )

    print("\n=== Vanligaste etikett per ansiktsposition ===")
    for pos in sorted(position_label_stats):
        most_common = position_label_stats[pos].most_common(1)
        if most_common:
            label, count = most_common[0]
            print(f"  Ansikte {pos+1}: {label} ({count} st)")

# ================== CLI Main ====================

def main():
    if len(sys.argv) == 2 and sys.argv[1] in ["--dashboard", "dashboard"]:
        try:
            dashboard_mode(ATTEMPT_FILE)
        except ImportError:
            print("Du måste installera 'watchdog' och 'rich' för att använda dashboard.")
        return
    # Default: analysera nuvarande loggfil
    if len(sys.argv) == 1:
        if not ATTEMPT_FILE.exists():
            print(f"Ingen loggfil hittades: {ATTEMPT_FILE}")
            return
        stats = load_stats(ATTEMPT_FILE)
        if not stats:
            print("Inga loggar hittades.")
            return
        analyze(stats)
    # "all" => analysera alla arkiv + nuvarande
    elif sys.argv[1] == "all":
        files = find_all_stats_files()
        if not files:
            print("Inga statistikfiler hittades.")
            return
        print("Analyserar samtliga databaser:")
        for f in files:
            print("  -", f)
        stats = load_multiple_stats(files)
        analyze(stats, group_by_source=True)
    # "file ..." => analysera angivna filer (eller paths)
    else:
        files = [Path(arg) for arg in sys.argv[1:]]
        stats = load_multiple_stats(files)
        analyze(stats, group_by_source=True)

if __name__ == "__main__":
    main()

