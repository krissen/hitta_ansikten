"""
Database Management Service

Provides database management operations for the workspace.
Ports functionality from hantera_ansikten.py to API-friendly format.
"""

import fnmatch
import hashlib
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add parent directory to path to import CLI modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from faceid_db import load_attempt_log, load_database, save_database

logger = logging.getLogger(__name__)


class ManagementService:
    """Service for database management operations"""

    def __init__(self):
        # Database state (loaded on demand)
        self.known_faces = {}
        self.ignored_faces = []
        self.hard_negatives = {}
        self.processed_files = []
        self.reload_database()

    def reload_database(self):
        """Reload database from disk"""
        logger.info("[ManagementService] Reloading database from disk")
        self.known_faces, self.ignored_faces, self.hard_negatives, self.processed_files = load_database()

    def save(self):
        """Save database to disk (atomic write with file locking)"""
        logger.info("[ManagementService] Saving database to disk")
        save_database(self.known_faces, self.ignored_faces, self.hard_negatives, self.processed_files)

    async def get_database_state(self) -> Dict[str, Any]:
        """
        Get current database state

        Returns:
        - people: List of {name, encoding_count}
        - ignored_count: Number of ignored encodings
        - hard_negatives_count: Number of hard negative examples
        - processed_files_count: Number of processed files
        """
        self.reload_database()  # Always reload for fresh data

        people = [
            {"name": name, "encoding_count": len(encodings)}
            for name, encodings in sorted(self.known_faces.items())
        ]

        return {
            "people": people,
            "ignored_count": len(self.ignored_faces),
            "hard_negatives_count": sum(len(v) for v in self.hard_negatives.values()),
            "processed_files_count": len(self.processed_files),
        }

    async def rename_person(self, old_name: str, new_name: str) -> Dict[str, Any]:
        """
        Rename person in database

        Args:
        - old_name: Current person name
        - new_name: New person name

        Raises:
        - ValueError if old_name doesn't exist or new_name already exists
        """
        self.reload_database()

        if old_name not in self.known_faces:
            raise ValueError(f"Person '{old_name}' not found")

        if new_name in self.known_faces:
            raise ValueError(f"Person '{new_name}' already exists (use merge instead)")

        # Rename by moving encodings
        self.known_faces[new_name] = self.known_faces.pop(old_name)
        self.save()

        logger.info(f"[ManagementService] Renamed '{old_name}' to '{new_name}'")

        return {
            "status": "success",
            "message": f"Renamed '{old_name}' to '{new_name}'",
            "new_state": await self.get_database_state(),
        }

    async def merge_people(self, source_names: List[str], target_name: str) -> Dict[str, Any]:
        """
        Merge multiple people into target name

        Args:
        - source_names: List of person names to merge
        - target_name: Result name (can be one of source_names or new name)

        Deduplicates encodings by encoding_hash to avoid duplicates.
        """
        self.reload_database()

        # Validate all source names exist
        for name in source_names:
            if name not in self.known_faces:
                raise ValueError(f"Person '{name}' not found")

        # Collect all encodings
        encodings = []

        # If target already exists, include its encodings
        if target_name in self.known_faces:
            encodings.extend(self.known_faces[target_name])

        # Add encodings from all source names
        for name in source_names:
            if name in self.known_faces:
                encodings.extend(self.known_faces[name])

        # Deduplicate by encoding_hash
        seen = set()
        encodings_unique = []

        for enc in encodings:
            # Get encoding hash for deduplication
            if isinstance(enc, dict):
                enc_hash = enc.get('encoding_hash')
            else:
                # Legacy numpy array - compute hash
                try:
                    enc_hash = hashlib.sha1(enc.tobytes()).hexdigest()
                except (AttributeError, ValueError):
                    enc_hash = None

            # Skip if we've seen this exact encoding before
            if enc_hash and enc_hash in seen:
                continue

            if enc_hash:
                seen.add(enc_hash)
            encodings_unique.append(enc)

        # Set target encodings
        self.known_faces[target_name] = encodings_unique

        # Remove source names (except target if it was in sources)
        for name in source_names:
            if name != target_name and name in self.known_faces:
                del self.known_faces[name]

        self.save()

        logger.info(f"[ManagementService] Merged {source_names} into '{target_name}' ({len(encodings_unique)} unique encodings)")

        return {
            "status": "success",
            "message": f"Merged {len(source_names)} people into '{target_name}' ({len(encodings_unique)} unique encodings)",
            "new_state": await self.get_database_state(),
        }

    async def delete_person(self, name: str) -> Dict[str, Any]:
        """
        Delete person from database

        Args:
        - name: Person name to delete

        Raises:
        - ValueError if person doesn't exist
        """
        self.reload_database()

        if name not in self.known_faces:
            raise ValueError(f"Person '{name}' not found")

        encoding_count = len(self.known_faces[name])
        del self.known_faces[name]
        self.save()

        logger.info(f"[ManagementService] Deleted '{name}' ({encoding_count} encodings)")

        return {
            "status": "success",
            "message": f"Deleted '{name}' ({encoding_count} encodings)",
            "new_state": await self.get_database_state(),
        }

    async def move_to_ignore(self, name: str) -> Dict[str, Any]:
        """
        Move person's encodings to ignored list

        Args:
        - name: Person name to move to ignored

        Raises:
        - ValueError if person doesn't exist
        """
        self.reload_database()

        if name not in self.known_faces:
            raise ValueError(f"Person '{name}' not found")

        encoding_count = len(self.known_faces[name])
        self.ignored_faces.extend(self.known_faces[name])
        del self.known_faces[name]
        self.save()

        logger.info(f"[ManagementService] Moved '{name}' to ignored ({encoding_count} encodings)")

        return {
            "status": "success",
            "message": f"Moved '{name}' to ignored ({encoding_count} encodings)",
            "new_state": await self.get_database_state(),
        }

    async def move_from_ignore(self, count: int, target_name: str) -> Dict[str, Any]:
        """
        Move encodings from ignored list to person

        Args:
        - count: Number of encodings to move (or -1 for all)
        - target_name: Person name to receive encodings

        Raises:
        - ValueError if count is invalid
        """
        self.reload_database()

        if count == -1:
            count = len(self.ignored_faces)

        if count < 1:
            raise ValueError("Count must be at least 1 (or -1 for all)")

        if count > len(self.ignored_faces):
            raise ValueError(f"Only {len(self.ignored_faces)} ignored encodings available")

        # Get encodings to move
        to_move = self.ignored_faces[:count]
        self.ignored_faces = self.ignored_faces[count:]

        # Add to target person
        if target_name not in self.known_faces:
            self.known_faces[target_name] = []
        self.known_faces[target_name].extend(to_move)

        self.save()

        logger.info(f"[ManagementService] Moved {count} encodings from ignored to '{target_name}'")

        return {
            "status": "success",
            "message": f"Moved {count} encodings from ignored to '{target_name}'",
            "new_state": await self.get_database_state(),
        }

    async def undo_file(self, filename_pattern: str) -> Dict[str, Any]:
        """
        Undo processing for file(s) matching pattern

        Args:
        - filename_pattern: Exact filename or glob pattern (e.g., "2024*.NEF")

        Returns information about how many encodings were removed.
        Supports glob patterns via fnmatch.
        """
        self.reload_database()

        # Find matching files
        matched_files = [
            pf
            for pf in self.processed_files
            if fnmatch.fnmatch((pf["name"] if isinstance(pf, dict) else pf), filename_pattern)
        ]

        if not matched_files:
            return {
                "status": "success",
                "message": f"No files match pattern '{filename_pattern}'",
                "new_state": await self.get_database_state(),
            }

        # Load attempt log to find what was added by these files
        log = load_attempt_log()

        removed_total = 0
        names_to_remove = set(
            pf["name"] if isinstance(pf, dict) else pf for pf in matched_files
        )

        # Remove from processed files
        self.processed_files = [
            pf
            for pf in self.processed_files
            if (pf["name"] if isinstance(pf, dict) else pf) not in names_to_remove
        ]

        # Remove encodings added by these files
        for target_name in names_to_remove:
            for entry in reversed(log):
                if Path(entry.get("filename", "")).name == target_name:
                    labels_per_attempt = entry.get("labels_per_attempt", [])
                    for labels in labels_per_attempt:
                        for label in labels:
                            if isinstance(label, dict):
                                label = label.get("label", "")
                            parts = label.split("\n")
                            if len(parts) == 2:
                                name = parts[1]
                                if name == "ignorerad":
                                    if self.ignored_faces:
                                        self.ignored_faces.pop()
                                        removed_total += 1
                                else:
                                    if name in self.known_faces and self.known_faces[name]:
                                        self.known_faces[name].pop()
                                        removed_total += 1

        self.save()

        logger.info(f"[ManagementService] Undid {len(matched_files)} files, removed {removed_total} encodings")

        return {
            "status": "success",
            "message": f"Undid {len(matched_files)} files, removed {removed_total} encodings",
            "files_undone": [pf["name"] if isinstance(pf, dict) else pf for pf in matched_files],
            "new_state": await self.get_database_state(),
        }

    async def purge_encodings(self, name: str, count: int) -> Dict[str, Any]:
        """
        Remove last X encodings from person or ignore list

        Args:
        - name: Person name or "ignore"
        - count: Number of encodings to remove from end

        Raises:
        - ValueError if name not found or count invalid
        """
        self.reload_database()

        if count < 1:
            raise ValueError("Count must be at least 1")

        if name == "ignore":
            if count > len(self.ignored_faces):
                raise ValueError(f"Only {len(self.ignored_faces)} ignored encodings available")

            self.ignored_faces = self.ignored_faces[:-count] if count < len(self.ignored_faces) else []
            self.save()

            logger.info(f"[ManagementService] Purged {count} encodings from ignored")

            return {
                "status": "success",
                "message": f"Purged {count} encodings from ignored",
                "new_state": await self.get_database_state(),
            }

        elif name in self.known_faces:
            if count > len(self.known_faces[name]):
                raise ValueError(f"Only {len(self.known_faces[name])} encodings available for '{name}'")

            self.known_faces[name] = self.known_faces[name][:-count] if count < len(self.known_faces[name]) else []
            self.save()

            logger.info(f"[ManagementService] Purged {count} encodings from '{name}'")

            return {
                "status": "success",
                "message": f"Purged {count} encodings from '{name}'",
                "new_state": await self.get_database_state(),
            }

        else:
            raise ValueError(f"Person '{name}' not found")

    async def get_recent_files(self, n: int = 10) -> List[Dict[str, str]]:
        """
        Get last N processed files

        Args:
        - n: Number of files to return (default 10)

        Returns list of {name, hash} dicts
        """
        self.reload_database()

        recent = list(reversed(self.processed_files[-n:]))

        # Ensure each entry is a dict
        result = []
        for entry in recent:
            if isinstance(entry, dict):
                result.append({"name": entry.get("name", ""), "hash": entry.get("hash", "")})
            else:
                # Legacy format: just filename string
                result.append({"name": entry, "hash": ""})

        return result


# Singleton instance
management_service = ManagementService()
