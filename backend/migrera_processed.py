import json
from pathlib import Path

BASE_DIR = Path.home() / ".local" / "share" / "faceid"
OLD_PATH = BASE_DIR / "processed.txt"
NEW_PATH = BASE_DIR / "processed_files.jsonl"


def main():
    if not OLD_PATH.exists():
        print("Ingen gammal processed.txt-fil hittades.")
        return

    seen = set()
    out = []
    with open(OLD_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if isinstance(entry, dict) and "name" in entry:
                    key = (entry["name"], entry.get("hash"))
                    if key not in seen:
                        out.append(entry)
                        seen.add(key)
                    continue
            except Exception:
                pass
            # Om inte JSON: tolkas som filnamn
            if line not in seen:
                out.append({"name": line, "hash": None})
                seen.add((line, None))

    with open(NEW_PATH, "w") as f:
        for entry in out:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"Migrerat {len(out)} entries till {NEW_PATH}")


if __name__ == "__main__":
    main()
