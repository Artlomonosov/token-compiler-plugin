/**
 * ZIP Builder
 * Uses JSZip to create an output.zip with structure:
 *   /[platform]/[product]/[theme].[ext]
 *
 * Supported platforms:
 *   web    → .css
 *   ios    → .swift
 *   android → .xml
 */

import JSZip from 'jszip'
import type { ResolvedToken } from './deepResolver'
import type { Product, Theme, Platform } from './deepResolver'
import { formatWeb, formatIOS, formatAndroidXML } from './formatters'

export interface CompileEntry {
    product: Product
    theme: Theme
    platform: Platform
    tokens: ResolvedToken[]
}

const EXT: Record<Platform, string> = {
    web: 'css',
    ios: 'swift',
    android: 'xml',
}

function getContent(entry: CompileEntry): string {
    const { product, theme, platform, tokens } = entry
    switch (platform) {
        case 'web':
            return formatWeb(tokens, product, theme, platform)
        case 'ios':
            return formatIOS(tokens, product, theme, platform)
        case 'android':
            return formatAndroidXML(tokens, product, theme, platform)
    }
}

export async function buildZip(entries: CompileEntry[]): Promise<Blob> {
    const zip = new JSZip()

    for (const entry of entries) {
        const { product, theme, platform } = entry
        const ext = EXT[platform]
        const path = `${platform}/${product}/${theme}.${ext}`
        const content = getContent(entry)
        zip.file(path, content)
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
