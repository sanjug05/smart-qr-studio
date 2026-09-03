import { applyD1Migrations, env } from 'cloudflare:test'

// Runs once before the test suite: creates the dynamic_qr table in the
// ephemeral, per-run local D1 instance Miniflare provides for tests. This
// never touches a real (local dev or remote) database.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
