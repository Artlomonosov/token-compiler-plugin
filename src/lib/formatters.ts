/**
 * Code formatters for Web (CSS), iOS (Swift), Android (XML).
 * Each formatter takes an array of ResolvedTokens and returns a string of output code.
 */

import type { ResolvedToken } from './deepResolver'

// ---------- helpers ----------

/** Convert token name to CSS var name: "bg-layer-first" → "--bg-layer-first", "Radius.control-m" → "--radius-control-m" */
function toCSSVar(name: string): string {
    return '--' + name.replace(/[.\s]/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()
}

/** Convert token name to Swift identifier: "bg-layer-first" → "bgLayerFirst" */
function toSwiftIdent(name: string): string {
    return name
        .replace(/[.\s]/g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '')
        .split('-')
        .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
        .join('')
}

/** Convert token name to Android XML resource name: "bg-layer-first" → "bg_layer_first" */
function toAndroidName(name: string): string {
    return name.replace(/[.\s]/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()
}

/** Format a hex colour for Swift UIColor */
function hexToSwiftUIColor(hex: string): string {
    // handle #rrggbb or #rrggbbaa
    const clean = hex.replace('#', '')
    let r = 0, g = 0, b = 0, a = 1
    if (clean.length === 6) {
        r = parseInt(clean.slice(0, 2), 16)
        g = parseInt(clean.slice(2, 4), 16)
        b = parseInt(clean.slice(4, 6), 16)
    } else if (clean.length === 8) {
        r = parseInt(clean.slice(0, 2), 16)
        g = parseInt(clean.slice(2, 4), 16)
        b = parseInt(clean.slice(4, 6), 16)
        a = parseInt(clean.slice(6, 8), 16) / 255
    }
    const rf = (r / 255).toFixed(3)
    const gf = (g / 255).toFixed(3)
    const bf = (b / 255).toFixed(3)
    const af = a.toFixed(3)
    return `UIColor(red: ${rf}, green: ${gf}, blue: ${bf}, alpha: ${af})`
}

/** Format a hex colour for Android XML */
function normalizeHex(hex: string): string {
    // Figma may output 6 or 8 char hex. Android XML wants #AARRGGBB or #RRGGBB.
    const clean = hex.replace('#', '')
    if (clean.length === 8) {
        // already has alpha (RRGGBBAA → AARRGGBB)
        const aa = clean.slice(6, 8)
        const rgb = clean.slice(0, 6)
        return `#${aa}${rgb}`.toUpperCase()
    }
    return `#${clean}`.toUpperCase()
}

// ---------- Web CSS formatter ----------

export function formatWeb(
    tokens: ResolvedToken[],
    product: string,
    theme: string,
    platform: string
): string {
    const lines: string[] = [
        `/* Token Compiler — ${product.toUpperCase()} / ${theme} / ${platform} */`,
        `/* Generated: ${new Date().toISOString()} */`,
        '',
        ':root {',
    ]
    for (const token of tokens) {
        const varName = toCSSVar(token.name)
        let val: string
        if (token.type === 'number') {
            val = `${token.value}px`
        } else if (token.type === 'text') {
            val = `"${token.value}"`
        } else {
            val = String(token.value)
        }
        lines.push(`  ${varName}: ${val};`)
    }
    lines.push('}')
    return lines.join('\n')
}

// ---------- iOS Swift formatter ----------

export function formatIOS(
    tokens: ResolvedToken[],
    product: string,
    theme: string,
    platform: string
): string {
    const structName = `${product.charAt(0).toUpperCase() + product.slice(1)}${theme.charAt(0).toUpperCase() + theme.slice(1)}Tokens`
    const lines: string[] = [
        `// Token Compiler — ${product.toUpperCase()} / ${theme} / ${platform}`,
        `// Generated: ${new Date().toISOString()}`,
        `// Swift 5.9+`,
        '',
        'import UIKit',
        '',
        `public struct ${structName} {`,
    ]

    for (const token of tokens) {
        const ident = toSwiftIdent(token.name)
        if (token.type === 'color') {
            const hex = String(token.value)
            if (hex.startsWith('#')) {
                lines.push(`  public static let ${ident}: UIColor = ${hexToSwiftUIColor(hex)}`)
            } else {
                lines.push(`  public static let ${ident}: String = "${token.value}"`)
            }
        } else if (token.type === 'number') {
            lines.push(`  public static let ${ident}: CGFloat = ${token.value}`)
        } else {
            lines.push(`  public static let ${ident}: String = "${token.value}"`)
        }
    }

    lines.push('}')
    return lines.join('\n')
}

// ---------- Android XML formatter ----------

export function formatAndroidXML(
    tokens: ResolvedToken[],
    product: string,
    theme: string,
    platform: string
): string {
    const lines: string[] = [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<!-- Token Compiler — ${product.toUpperCase()} / ${theme} / ${platform} -->`,
        `<!-- Generated: ${new Date().toISOString()} -->`,
        `<resources>`,
    ]

    for (const token of tokens) {
        const name = toAndroidName(token.name)
        if (token.type === 'color') {
            const hex = String(token.value)
            if (hex.startsWith('#')) {
                lines.push(`  <color name="${name}">${normalizeHex(hex)}</color>`)
            } else {
                lines.push(`  <!-- ${name}: ${token.value} -->`)
            }
        } else if (token.type === 'number') {
            lines.push(`  <dimen name="${name}">${token.value}dp</dimen>`)
        } else {
            lines.push(`  <string name="${name}">${token.value}</string>`)
        }
    }

    lines.push(`</resources>`)
    return lines.join('\n')
}
