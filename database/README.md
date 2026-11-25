# EchoClass AI — Database Module

This folder contains the complete database layer for the EchoClass AI classroom assistant.

## Files

- **`schema.sql`**: Full, clean SQL DDL schema showing all tables, foreign keys, indexes, triggers, and full-text search tables.
- **`db.js`**: Core SQLite initialization logic using `better-sqlite3`. Enables WAL mode, busy timeout, and foreign keys.
- **`migrations.js`**: Automatic versioned schema migrations runner.
- **`echoclass.db`**: Local persistent SQLite database storage file.

## Schema Overview

| Table | Purpose |
|---|---|
| `users` | User accounts (teachers and students) with bcrypt password hashes and roles |
| `classrooms` | Classrooms created by teachers with unique 8-character join codes |
| `enrollments` | Student-classroom many-to-many relationship |
| `sessions` | Individual lecture sessions started by teachers |
| `captions` | Real-time captions from speech recognition or sign language gesture tracking |
| `captions_fts` | SQLite FTS5 virtual table for instant full-text search across all lecture captions |
| `flags` | Student feedback flags (`confusing`, `important`) on specific captions |
| `requests` | Live classroom student requests (`raise_hand`, `slow_down`, `repeat`, `louder`) |
| `vocab` | Custom classroom vocabulary phonetic corrections |
| `audit_log` | Security audit logging for authentication and administration events |
| `ai_summaries` | Cached AI lecture summaries and study notes |
| `ai_usage` | Daily quota limiter tracking for external AI calls |
