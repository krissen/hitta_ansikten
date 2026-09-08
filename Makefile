# `make check` is the one command a session or a PR runs before treating
# something as done: the same grind `.pre-commit-config.yaml` enforces at
# commit time, run once more without --fix over the *whole* tree, plus both
# test suites. Full output goes to .check.log (gitignored); stdout stays a
# handful of lines on success and the tail of the log on failure.
#
# Deliberately re-runs the linters WITHOUT --fix on the whole tree, in
# addition to prek: `prek run --files <an untracked file>` with a --fix hook
# silently rewrites the file and reports Passed, because there is no index
# entry yet to diff against. A brand-new, still-untracked module would look
# clean here if this target only ran prek. `ruff check .` and `eslint .`
# with no fix flag give that file a real, failing verdict instead.
#
# Uses whatever `prek` is on PATH (brew, `git config prek.enabled true`'s
# only local prerequisite besides this file) rather than CI's pinned
# `pipx run --spec prek==0.5.2`: this target runs on a developer's own
# machine, which already has a specific prek install to keep in sync with
# by hand; the version pin matters for the reproducible CI checkout, not
# here.
LOG := $(CURDIR)/.check.log

.PHONY: check

check:
	@rm -f $(LOG)
	@{ echo "== prek --all-files =="; \
	   prek run --all-files; \
	} >>$(LOG) 2>&1 || { tail -40 $(LOG); exit 1; }
	@{ echo "== ruff check (no --fix, whole tree) =="; \
	   backend/.venv/bin/ruff check .; \
	} >>$(LOG) 2>&1 || { tail -30 $(LOG); exit 1; }
	@{ echo "== eslint (no --fix) =="; \
	   cd frontend && npx eslint .; \
	} >>$(LOG) 2>&1 || { tail -30 $(LOG); exit 1; }
	@{ echo "== backend pytest =="; \
	   cd backend && .venv/bin/python -m pytest -q; \
	} >>$(LOG) 2>&1 || { tail -30 $(LOG); exit 1; }
	@{ echo "== frontend vitest =="; \
	   cd frontend && npx vitest run --reporter=dot; \
	} >>$(LOG) 2>&1 || { tail -40 $(LOG); exit 1; }
	@tail -3 $(LOG)
