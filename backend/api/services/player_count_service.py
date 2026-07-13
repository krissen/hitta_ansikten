"""Player Count Service

GUI/API backing for the ``rakna_spelare.py`` CLI: resolve a folder/glob/date-span
input into image files and count how many images each named person appears in,
with over/under-representation statistics.

Shares the counting core (``compute_player_stats``) with the CLI so the numbers
never fork, and the file resolution with the shared ``file_resolver``.
"""

import logging
import os
import threading

from core.playerstats import (
    compute_player_stats,
    load_exclusion_config,
    resolve_always_markers,
    resolve_exclusion_sets,
    save_exclusion_config,
)

# Env vars that override the config; while any is set, "save as default" is a
# no-op for that field, so the GUI surfaces a warning.
_ENV_KEYS = (
    "RAKNA_TRANARE",
    "RAKNA_PUBLIK",
    "RAKNA_GRUPP",
    "RAKNA_ALWAYS_GRUPP",
    "RAKNA_ALWAYS_PUBLIK",
)

from .file_resolver import preset_extensions, resolve_files  # noqa: E402

logger = logging.getLogger(__name__)


class PlayerCountService:
    """Counts images per named person from resolved files."""

    def _exclusion_sets(
        self,
        tranare: list[str] | None,
        publik: list[str] | None,
        grupp: list[str] | None = None,
    ) -> tuple[set[str], set[str], set[str]]:
        """Resolve coach/audience/group sets.

        Delegates to the CLI's shared resolver so the GUI/API and the CLI agree:
        per-request overrides win, else env (RAKNA_*) / config file, with the
        built-in ALWAYS markers (Laget/FBK group photos, Klacken audience)
        always merged in.
        """
        return resolve_exclusion_sets(tranare=tranare, publik=publik, grupp=grupp)

    def get_exclusions(self) -> dict:
        """Return the currently resolved exclusion lists for the GUI editor.

        ``tranare``/``publik``/``grupp`` are the fully resolved sets (config/env
        + always-markers). ``always`` is the configured always-set (grupp/publik)
        — editable, no longer forced built-ins. ``env_active``/``env_keys`` tell
        the GUI when a RAKNA_* env var overrides the config (so "save as default"
        would be a no-op).
        """
        config = load_exclusion_config()
        tranare_set, publik_set, grupp_set = resolve_exclusion_sets()
        always_grupp, always_publik = resolve_always_markers(config)
        env_keys = [k for k in _ENV_KEYS if os.environ.get(k)]
        return {
            "tranare": sorted(tranare_set),
            "publik": sorted(publik_set),
            "grupp": sorted(grupp_set),
            "always": {
                "publik": sorted(always_publik),
                "grupp": sorted(always_grupp),
            },
            # Raw persisted lists (no env, no always-markers) — for targeted
            # saves that must not echo transient env values back into config.
            "config": {
                "tranare": sorted(config.get("tranare", [])),
                "publik": sorted(config.get("publik", [])),
                "grupp": sorted(config.get("grupp", [])),
            },
            "env_active": bool(env_keys),
            "env_keys": env_keys,
        }

    def save_exclusions(
        self,
        tranare: list[str] | None = None,
        publik: list[str] | None = None,
        grupp: list[str] | None = None,
        always_grupp: list[str] | None = None,
        always_publik: list[str] | None = None,
    ) -> dict:
        """Persist the exclusion lists to the config file, then return the newly
        resolved exclusions (``get_exclusions`` shape). ``None`` fields are left
        unchanged."""
        save_exclusion_config(
            tranare=tranare,
            publik=publik,
            grupp=grupp,
            always_grupp=always_grupp,
            always_publik=always_publik,
        )
        return self.get_exclusions()

    def count(
        self,
        roots: list[str] | None = None,
        globs: list[str] | None = None,
        extension_preset: str | None = None,
        extensions: list[str] | None = None,
        recursive: bool = True,
        date_from: str | None = None,
        date_to: str | None = None,
        gap_minutes: int = 30,
        baseline: str = "median",
        min_images: int = 3,
        per_match: bool = False,
        tranare: list[str] | None = None,
        publik: list[str] | None = None,
        grupp: list[str] | None = None,
        spelare: list[str] | None = None,
        session_tranare: list[str] | None = None,
        session_publik: list[str] | None = None,
        session_grupp: list[str] | None = None,
    ) -> dict:
        """Resolve files and compute player statistics.

        The ``session_*`` lists and ``spelare`` are per-request pins that win
        over everything (config/env/overrides, even always-markers): a pinned
        name is removed from all exclusion sets and added only to its pinned
        bucket. ``spelare`` pins to the players bucket and also bypasses the
        ``min_images`` threshold. They back the GUI's session-only right-click
        moves and are never persisted.

        Returns the dict from ``compute_player_stats`` plus ``files_resolved``.
        Raises ValueError when no folder/glob input is given.
        """
        roots = roots or []
        globs = globs or []
        if not roots and not globs:
            raise ValueError("Ange minst en mapp eller ett glob-mönster.")

        # Explicit extensions win over the preset; preset 'all'/None keeps everything.
        ext_list = extensions if extensions else preset_extensions(extension_preset)

        files = resolve_files(
            roots=roots,
            globs=globs,
            extensions=ext_list,
            recursive=recursive,
            date_from=date_from,
            date_to=date_to,
        )

        tranare_set, publik_set, grupp_set = self._exclusion_sets(tranare, publik, grupp)

        def _clean(names: list[str] | None) -> set[str]:
            return {n.strip() for n in (names or []) if n.strip()}

        force = _clean(spelare)
        pin_tranare = _clean(session_tranare)
        pin_publik = _clean(session_publik)
        pin_grupp = _clean(session_grupp)
        pinned = force | pin_tranare | pin_publik | pin_grupp
        if pinned:
            tranare_set = (tranare_set - pinned) | pin_tranare
            publik_set = (publik_set - pinned) | pin_publik
            grupp_set = (grupp_set - pinned) | pin_grupp

        stats = compute_player_stats(
            files,
            gap_minutes=gap_minutes,
            baseline_method=baseline,
            min_images=min_images,
            tranare_set=tranare_set,
            publik_set=publik_set,
            grupp_set=grupp_set,
            per_match=per_match,
            force_players=force or None,
        )
        stats["files_resolved"] = len(files)
        return stats


# Lazy singleton — construction is deferred so importing this module has no
# side effects at import time.
_player_count_service = None
_player_count_service_lock = threading.Lock()


def get_player_count_service() -> PlayerCountService:
    """Return the process-wide PlayerCountService, constructing it on first use."""
    global _player_count_service
    if _player_count_service is None:
        with _player_count_service_lock:
            if _player_count_service is None:
                _player_count_service = PlayerCountService()
    return _player_count_service
