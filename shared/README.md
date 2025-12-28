# Shared Types and Protocols

This directory contains shared type definitions and API contracts used by both frontend and backend.

## Contents

- `types.py` - Python type definitions for shared data structures
- `types.ts` - TypeScript type definitions for frontend (mirrors Python types)
- `api-protocol.md` - API contract documentation between frontend and backend

## Usage

When adding new features that span frontend and backend:

1. Define shared types here first
2. Update both Python and TypeScript definitions
3. Document API endpoints in api-protocol.md
4. Use these types in both frontend and backend code

This ensures type safety and consistency across the monorepo.
