import { projectRepository } from '@/services/storage/projectRepository'
import { dynamicQrService } from '@/services/dynamicQr'
import { cloudProjectRepository } from './firestoreAdapter'
import { createLibraryService } from './libraryService'

export { CloudConflictError } from './cloudProjectRepository'
export { DynamicQrOwnedByOtherError, isMigrationDismissed, dismissMigration } from './libraryService'
export type { BulkSaveResult, OpenResult } from './libraryService'
export { hasUnsavedChanges } from './cloudProject'

/** The wired-up cloud library: Firestore + the on-device buffer + Dynamic QR ownership claiming. */
export const libraryService = createLibraryService({
  cloud: cloudProjectRepository,
  local: projectRepository,
  claimDynamicQr: (publicId) => dynamicQrService.claim(publicId)
})

export { cloudProjectRepository }
