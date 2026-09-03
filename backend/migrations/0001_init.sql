-- Dynamic QR — minimal schema (see /README.md → "Dynamic QR architecture").
--
-- One table is enough for this phase. Deliberately no `users`/`plans`/
-- `analytics` tables yet — see README → "Current limitations" for why.
--
-- `content` is a single JSON column shaped like the frontend's
-- `LandingContent` type (brand + destinations) — the same shape the
-- customer landing page already renders for Static QR, so both paths
-- converge on one presentation layer with no adapter object.
CREATE TABLE IF NOT EXISTS dynamic_qr (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Permanent, printed identifier. Appears in the QR URL
  -- (#/q/d.<public_id>) and must never change once created.
  public_id     TEXT NOT NULL UNIQUE,

  -- Nullable now (anonymous V1 ownership via management token only).
  -- Becomes a real foreign key to a future `users` table without a
  -- breaking migration — see README → "Future account migration".
  owner_id      TEXT,

  -- SHA-256 hex digest of the management token. The plaintext token is
  -- never stored anywhere, only returned once at creation time.
  token_hash    TEXT NOT NULL,

  -- 'active' | 'disabled'. Never hard-deleted — a removed public_id must
  -- never become reusable/ambiguous later.
  status        TEXT NOT NULL DEFAULT 'active',

  -- JSON-encoded DynamicQrContent (brand + destinations). Always replaced
  -- in one full statement on update — see src/routes/update.ts — so a
  -- reader never observes a partially-updated document.
  content       TEXT NOT NULL,

  -- Incremented on every successful publish. Not used for optimistic
  -- concurrency control in this phase, just an observable "has this
  -- changed" counter for support/debugging.
  version       INTEGER NOT NULL DEFAULT 1,

  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dynamic_qr_public_id ON dynamic_qr(public_id);
CREATE INDEX IF NOT EXISTS idx_dynamic_qr_owner_id ON dynamic_qr(owner_id);
