"""Face-recognition benchmark tooling.

This package is developer/evaluation tooling only. It is deliberately excluded
from the shipped application bundle (see ``ansikten-backend.spec``) and never
imported by the API server or the CLI.

All generated data (source index cache, feasibility reports, unresolved-hash
lists) lives under ``benchmarks/_data/`` which is gitignored — benchmark data
is never committed.
"""
