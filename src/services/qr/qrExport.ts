import type QRCodeStyling from 'qr-code-styling'

function slugFilename(companyName: string, slug: string): string {
  const base = companyName.trim() ? companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'smart-qr'
  return `${base}-${slug}`
}

export async function downloadPng(instance: QRCodeStyling, companyName: string, slug: string): Promise<void> {
  await instance.download({ name: slugFilename(companyName, slug), extension: 'png' })
}

export async function downloadSvg(instance: QRCodeStyling, companyName: string, slug: string): Promise<void> {
  await instance.download({ name: slugFilename(companyName, slug), extension: 'svg' })
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
