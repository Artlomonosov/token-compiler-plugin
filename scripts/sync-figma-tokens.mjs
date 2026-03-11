#!/usr/bin/env node
/**
 * sync-figma-tokens.mjs
 * ---------------------
 * Fetches local variables from a Figma file via REST API
 * and writes resolved token files to out/ directory.
 *
 * Usage:
 *   FIGMA_TOKEN=xxx FIGMA_FILE_KEY=yyy node scripts/sync-figma-tokens.mjs
 *
 * Or with .env:
 *   node --env-file=.env scripts/sync-figma-tokens.mjs
 *
 * Outputs:
 *   out/web/b2b/light.css, out/web/b2b/dark.css, ...
 *   out/ios/b2b/light.swift, ...
 *   out/android/b2b/light.xml, ...
 */

import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ─── Config ────────────────────────────────────────────────────────────────────
const TOKEN = process.env.FIGMA_TOKEN
const FILE_KEY = process.env.FIGMA_FILE_KEY

if (!TOKEN || !FILE_KEY) {
    console.error('❌  Missing env vars. Set FIGMA_TOKEN and FIGMA_FILE_KEY.')
    console.error('    Example: FIGMA_TOKEN=figd_xxx FIGMA_FILE_KEY=AbCdEf1234 node scripts/sync-figma-tokens.mjs')
    process.exit(1)
}

// ─── Figma REST API ─────────────────────────────────────────────────────────────
async function fetchFigmaVariables() {
    const url = `https://api.figma.com/v1/files/${FILE_KEY}/variables/local`
    console.log(`📡  Fetching variables from Figma file: ${FILE_KEY}`)

    const res = await fetch(url, {
        headers: { 'X-Figma-Token': TOKEN },
    })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`Figma API error ${res.status}: ${text}`)
    }

    const json = await res.json()
    return json.meta // { variables, variableCollections }
}

// ─── Converters ────────────────────────────────────────────────────────────────

function toHex2(n) {
    return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')
}

function colorToHex({ r, g, b, a = 1 }) {
    const rgb = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`
    return a < 0.9999 ? `${rgb}${toHex2(a)}` : rgb
}

/**
 * Convert Figma REST API variables/collections to our AllTokens structure.
 * REST API format is slightly different from Plugin API:
 *  - variableCollections is an object keyed by collection ID
 *  - variables is an object keyed by variable ID
 *  - valuesByMode uses modeId keys
 *  - aliases use { type: 'VARIABLE_ALIAS', id: '...' }
 */
function buildAllTokens(meta) {
    const { variables, variableCollections } = meta

    // Build variable ID → variable map
    const varMap = new Map(Object.entries(variables))

    // Build collection ID → collection map
    const colMap = new Map(Object.entries(variableCollections))

    // Helper: flatten a set of variable IDs for a given mode into a TokenTree
    function buildTree(variableIds, modeId) {
        const tree = {}
        for (const varId of variableIds) {
            const variable = varMap.get(varId)
            if (!variable) continue

            const modeValue = variable.valuesByMode[modeId]
            if (modeValue === undefined) continue

            let $value, $type
            if (modeValue?.type === 'VARIABLE_ALIAS') {
                const refVar = varMap.get(modeValue.id)
                $value = refVar ? `{${refVar.name.replace(/\//g, '.')}}` : `UNRESOLVED:${modeValue.id}`
                $type = variable.resolvedType === 'COLOR' ? 'color' : variable.resolvedType === 'FLOAT' ? 'number' : 'text'
            } else if (modeValue !== null && typeof modeValue === 'object' && 'r' in modeValue) {
                $value = colorToHex(modeValue)
                $type = 'color'
            } else if (typeof modeValue === 'number') {
                $value = modeValue
                $type = 'number'
            } else {
                $value = String(modeValue)
                $type = 'text'
            }

            // Nest by '/' parts
            const parts = variable.name.split('/')
            let cur = tree
            for (let i = 0; i < parts.length - 1; i++) {
                if (typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
                cur = cur[parts[i]]
            }
            cur[parts[parts.length - 1]] = { $type, $value }
        }
        return tree
    }

    // Find collection by name pattern
    const findCol = (...names) =>
        [...colMap.values()].find(c => names.some(n => c.name.toLowerCase().includes(n.toLowerCase())))
    const findMode = (col, ...names) =>
        col?.modes.find(m => names.some(n => m.name.toLowerCase().includes(n.toLowerCase())))
    const modeId = (col, ...names) => findMode(col, ...names)?.modeId ?? ''
    const build = (col, mid) => (col && mid) ? buildTree(col.variableIds, mid) : {}

    const baseCol = findCol('base', 'primitive')
    const themeCol = findCol('theme', 'semantic')
    const productCol = findCol('product')
    const platformCol = findCol('platform')

    console.log(`📦  Collections found:`)
    console.log(`    Base:     ${baseCol?.name ?? '⚠️ not detected'}`)
    console.log(`    Theme:    ${themeCol?.name ?? '⚠️ not detected'}`)
    console.log(`    Product:  ${productCol?.name ?? '⚠️ not detected'}`)
    console.log(`    Platform: ${platformCol?.name ?? '⚠️ not detected'}`)

    return {
        base: build(baseCol, baseCol?.modes[0]?.modeId ?? ''),
        themeLight: build(themeCol, modeId(themeCol, 'light')),
        themeDark: build(themeCol, modeId(themeCol, 'dark')),
        productB2b: build(productCol, modeId(productCol, 'b2b')),
        productB2c: build(productCol, modeId(productCol, 'b2c')),
        productPoints: build(productCol, modeId(productCol, 'points', 'point')),
        platformWeb: build(platformCol, modeId(platformCol, 'web')),
        platformIos: build(platformCol, modeId(platformCol, 'ios')),
        platformAndroid: build(platformCol, modeId(platformCol, 'android')),
    }
}

// ─── Deep Resolver (Node port of src/lib/deepResolver.ts) ──────────────────────

function flattenTree(tree, prefix = '') {
    const map = new Map()
    for (const [key, val] of Object.entries(tree)) {
        if (key.startsWith('$')) continue
        if (val && typeof val === 'object' && '$value' in val) {
            map.set(prefix ? `${prefix}.${key}` : key, val)
        } else if (val && typeof val === 'object') {
            flattenTree(val, prefix ? `${prefix}.${key}` : key).forEach((v, k) => map.set(k, v))
        }
    }
    return map
}

function extractRef(value) {
    if (typeof value !== 'string') return null
    const m = value.match(/^\{(.+)\}$/)
    return m ? m[1] : null
}

function resolveValue(startValue, lookupMap, visited = new Set()) {
    const ref = extractRef(startValue)
    if (!ref) return { value: startValue, type: 'unknown' }
    if (visited.has(ref)) return { value: `CIRCULAR:${ref}`, type: 'error' }
    visited.add(ref)

    const node = lookupMap.get(ref)
    if (!node || node.$value === undefined) return { value: `UNRESOLVED:${ref}`, type: 'error' }

    if (extractRef(node.$value)) return resolveValue(node.$value, lookupMap, visited)
    return { value: node.$value, type: node.$type ?? 'unknown' }
}

function deepResolve(tokens, product, theme, platform) {
    const themeData = theme === 'light' ? tokens.themeLight : tokens.themeDark
    const platformData = platform === 'web' ? tokens.platformWeb
        : platform === 'ios' ? tokens.platformIos
            : tokens.platformAndroid
    const productData = product === 'b2b' ? tokens.productB2b
        : product === 'b2c' ? tokens.productB2c
            : tokens.productPoints

    const lookupMap = new Map()
    flattenTree(tokens.base).forEach((v, k) => lookupMap.set(k, v))
    flattenTree(themeData).forEach((v, k) => lookupMap.set(k, v))
    flattenTree(platformData).forEach((v, k) => lookupMap.set(k, v))

    const results = []
    for (const [name, node] of [...flattenTree(productData), ...flattenTree(platformData)]) {
        if (node.$value === undefined) continue
        const { value, type } = resolveValue(node.$value, lookupMap)
        results.push({ name, value, type: node.$type ?? type })
    }
    return results
}

// ─── Formatters ─────────────────────────────────────────────────────────────────

function toCSSVar(name) {
    return '--' + name.replace(/[.\s]/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()
}

function formatCSS(tokens, product, theme) {
    const lines = [`/* Token Compiler — ${product} / ${theme} / web */`, ':root {']
    for (const t of tokens) {
        const val = t.type === 'number' ? `${t.value}px` : t.type === 'text' ? `"${t.value}"` : String(t.value)
        lines.push(`  ${toCSSVar(t.name)}: ${val};`)
    }
    lines.push('}')
    return lines.join('\n')
}

function toSwift(name) {
    return name.replace(/[.\s]/g, '-').replace(/[^a-zA-Z0-9-]/g, '').split('-')
        .map((p, i) => i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

function hexToUIColor(hex) {
    const c = hex.replace('#', '')
    const r = (parseInt(c.slice(0, 2), 16) / 255).toFixed(3)
    const g = (parseInt(c.slice(2, 4), 16) / 255).toFixed(3)
    const b = (parseInt(c.slice(4, 6), 16) / 255).toFixed(3)
    const a = c.length === 8 ? (parseInt(c.slice(6, 8), 16) / 255).toFixed(3) : '1.000'
    return `UIColor(red: ${r}, green: ${g}, blue: ${b}, alpha: ${a})`
}

function formatSwift(tokens, product, theme) {
    const name = `${product.charAt(0).toUpperCase() + product.slice(1)}${theme.charAt(0).toUpperCase() + theme.slice(1)}Tokens`
    const lines = [`// Token Compiler — ${product} / ${theme} / ios`, 'import UIKit', '', `public struct ${name} {`]
    for (const t of tokens) {
        const id = toSwift(t.name)
        if (t.type === 'color' && String(t.value).startsWith('#'))
            lines.push(`  public static let ${id}: UIColor = ${hexToUIColor(String(t.value))}`)
        else if (t.type === 'number')
            lines.push(`  public static let ${id}: CGFloat = ${t.value}`)
        else
            lines.push(`  public static let ${id}: String = "${t.value}"`)
    }
    lines.push('}')
    return lines.join('\n')
}

function toXMLName(name) {
    return name.replace(/[.\s]/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()
}

function normalizeHex(hex) {
    const c = hex.replace('#', '')
    if (c.length === 8) return `#${c.slice(6)}${c.slice(0, 6)}`.toUpperCase()
    return `#${c}`.toUpperCase()
}

function formatXML(tokens, product, theme) {
    const lines = [`<?xml version="1.0" encoding="utf-8"?>`, `<!-- Token Compiler — ${product} / ${theme} / android -->`, '<resources>']
    for (const t of tokens) {
        const name = toXMLName(t.name)
        if (t.type === 'color' && String(t.value).startsWith('#'))
            lines.push(`  <color name="${name}">${normalizeHex(String(t.value))}</color>`)
        else if (t.type === 'number')
            lines.push(`  <dimen name="${name}">${t.value}dp</dimen>`)
        else
            lines.push(`  <string name="${name}">${t.value}</string>`)
    }
    lines.push('</resources>')
    return lines.join('\n')
}

// ─── Main ───────────────────────────────────────────────────────────────────────

const PRODUCTS = ['b2b', 'b2c', 'points']
const THEMES = ['light', 'dark']
const PLATFORMS = ['web', 'ios', 'android']
const EXT = { web: 'css', ios: 'swift', android: 'xml' }

try {
    const meta = await fetchFigmaVariables()
    const allTokens = buildAllTokens(meta)

    const totalVars = Object.keys(meta.variables).length
    console.log(`✓  Fetched ${totalVars} variables`)

    const outDir = join(ROOT, 'out')
    let fileCount = 0

    for (const product of PRODUCTS) {
        for (const theme of THEMES) {
            for (const platform of PLATFORMS) {
                const resolved = deepResolve(allTokens, product, theme, platform)
                if (resolved.length === 0) continue

                const content =
                    platform === 'web' ? formatCSS(resolved, product, theme)
                        : platform === 'ios' ? formatSwift(resolved, product, theme)
                            : formatXML(resolved, product, theme)

                const filePath = join(outDir, platform, product, `${theme}.${EXT[platform]}`)
                await mkdir(dirname(filePath), { recursive: true })
                await writeFile(filePath, content, 'utf-8')
                fileCount++
                console.log(`  ✓ out/${platform}/${product}/${theme}.${EXT[platform]} (${resolved.length} tokens)`)
            }
        }
    }

    console.log(`\n🎉  Done! ${fileCount} files written to out/`)
} catch (err) {
    console.error('❌  Error:', err.message)
    process.exit(1)
}
