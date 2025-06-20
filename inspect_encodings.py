import pickle
from pathlib import Path

encodings_path = Path.home() / ".local/share/faceid/encodings.pkl"
target_files = {
    "250518_143900.NEF",
    "250518_143917.NEF",
    "250518_144109.NEF",
    "250518_144440.NEF",
    "250518_143718.NEF",
    "250518_144015.NEF",
    "250518_144155.NEF",
    "250518_144443.NEF",
    "250518_143909.NEF",
}

with open(encodings_path, "rb") as f:
    known_faces = pickle.load(f)

print("Söker efter encodings kopplade till dessa filer:")
for tf in target_files:
    print(f" - {tf}")

found = {tf: [] for tf in target_files}

for name, entries in known_faces.items():
    for entry in entries:
        if isinstance(entry, dict):
            file_field = entry.get("file")
            hash_field = entry.get("hash")
            # Jämför mot alla target_files
            if file_field in target_files:
                found[file_field].append((name, hash_field))
        # Om det bara är encoding-array: kan inte kopplas till fil
        # (Skriv ut ev. gamla format med print)

print("\nResultat:")
for tf in target_files:
    if found[tf]:
        print(f"{tf}:")
        for namn, h in found[tf]:
            print(f"  - Person: {namn} (hash: {h})")
    else:
        print(f"{tf}: INGEN encoding med denna fil")

print(
    "\nVill du även se alla encodings per person? Lägg till print(list(known_faces.keys())) osv."
)
