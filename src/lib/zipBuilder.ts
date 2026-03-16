import JSZip from 'jszip'
import type { AllTokens } from './tokenLoader'
import type { Platform } from './deepResolver'
import { buildPlatformJson } from './jsonBuilder'

export async function buildJsonZip(
    tokens: AllTokens,
    platforms: Set<Platform>,
    exportBase: boolean
): Promise<Blob> {
    const zip = new JSZip()

    // 1. Export base.json if requested
    if (exportBase && Object.keys(tokens.base).length > 0) {
        zip.file('base.json', JSON.stringify(tokens.base, null, 2))
    }

    // 2. Export platform JSONs
    for (const plat of platforms) {
        const platformObj = buildPlatformJson(tokens, plat)
        zip.file(`${plat}.json`, JSON.stringify(platformObj, null, 2))
    }

    return zip.generateAsync({ type: 'blob' })
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
