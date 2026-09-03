import type { Env as WorkerEnv } from '../src/types'
import type { D1Migration } from 'cloudflare:test'

// `cloudflare:test`'s `env` export is typed as the global `Cloudflare.Env`
// interface (populated by `wrangler types` in a full setup). This project
// declares its own bindings by hand instead — see src/types.ts — so this
// augmentation just points the ambient global at that same shape, plus the
// migrations array vitest.config.ts injects as a test-only binding.
declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

export {}
