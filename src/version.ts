/**
 * Application build version — entirely separate from the QR share-payload
 * schema version (`ShareableQRPayload.v`, see src/services/share/sharePayload.ts).
 * Bumping this has no effect on existing QR codes: the payload is decoded
 * from the URL itself, not from anything this app version number touches.
 */
export const APP_VERSION = 'V1.0.0'
