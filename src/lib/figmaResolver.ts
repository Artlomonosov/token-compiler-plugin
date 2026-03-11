/**
 * figmaResolver.ts
 * Converts raw Figma Variables API data into our AllTokens structure,
 * which can then be passed directly to deepResolve().
 *
 * Collection detection (case-insensitive name matching):
 *   "Base"     → base primitives (single mode)
 *   "Theme"    → Light / Dark modes
 *   "Product"  → b2b / b2c / points modes
 *   "Platform" → Web / iOS / Android modes
 */

import type { TokenTree } from './deepResolver'
import type { AllTokens } from './tokenLoader'
import type {
    FigmaCollection,
    FigmaVariable,
    FigmaVarValue,
    FigmaColor,
    FigmaAlias,
    FigmaTokenMessage,
} from './types'

// ---------- helpers ----------

function isAlias(v: FigmaVarValue): v is FigmaAlias {
    return typeof v === 'object' && v !== null && 'type' in v &&
        (v as FigmaAlias).type === 'VARIABLE_ALIAS'
}

function isColor(v: FigmaVarValue): v is FigmaColor {
    return typeof v === 'object' && v !== null && 'r' in v
}

function toHex2(n: number): string {
    return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')
}

function figmaColorToHex(c: FigmaColor): string {
    const rgb = `#${toHex2(c.r)}${toHex2(c.g)}${toHex2(c.b)}`
    return c.a < 0.9999 ? `${rgb}${toHex2(c.a)}` : rgb
}

function convertValue(
    value: FigmaVarValue,
    varType: string,
    varMap: Map<string, FigmaVariable>,
): { $value: string | number; $type: string } {
    if (isAlias(value)) {
        const refVar = varMap.get(value.id)
        if (refVar) {
            // "Color/Slate/850" → "{Color.Slate.850}"
            return {
                $value: `{${refVar.name.replace(/\//g, '.')}}`,
                $type: varType === 'COLOR' ? 'color' : varType === 'FLOAT' ? 'number' : 'text',
            }
        }
        return { $value: `UNRESOLVED:${value.id}`, $type: 'unknown' }
    }

    if (isColor(value)) return { $value: figmaColorToHex(value), $type: 'color' }
    if (typeof value === 'number') return { $value: value, $type: 'number' }
    return { $value: String(value), $type: 'text' }
}

/**
 * Build a TokenTree from a list of Figma variable IDs for a specific mode.
 * Variable names use "/" as separator → we nest them into the tree.
 */
function buildTokenTree(
    variableIds: string[],
    modeId: string,
    varMap: Map<string, FigmaVariable>,
): TokenTree {
    const tree: Record<string, unknown> = {}

    for (const varId of variableIds) {
        const variable = varMap.get(varId)
        if (!variable) continue

        const modeValue =
            variable.valuesByMode[modeId] ?? Object.values(variable.valuesByMode)[0]
        if (modeValue === undefined) continue

        const { $value, $type } = convertValue(modeValue, variable.type, varMap)

        // Nest by "/" parts: "Color/Slate/850" → tree["Color"]["Slate"]["850"]
        const parts = variable.name.split('/')
        let cur = tree
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i]
            if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}
            cur = cur[p] as Record<string, unknown>
        }
        cur[parts[parts.length - 1]] = { $type, $value }
    }

    return tree as TokenTree
}

// ---------- collection detection ----------

function findCol(
    collections: FigmaCollection[],
    names: string[],
): FigmaCollection | undefined {
    return collections.find(c =>
        names.some(n => c.name.toLowerCase().includes(n.toLowerCase())),
    )
}

function findMode(col: FigmaCollection, names: string[]) {
    return col.modes.find(m =>
        names.some(n => m.name.toLowerCase().includes(n.toLowerCase())),
    )
}

// ---------- public API ----------

export function figmaDataToAllTokens(data: FigmaTokenMessage): AllTokens {
    const varMap = new Map<string, FigmaVariable>()
    for (const v of data.variables) varMap.set(v.id, v)

    const empty = (): TokenTree => ({})

    const baseCol = findCol(data.collections, ['base', 'primitive'])
    const themeCol = findCol(data.collections, ['theme', 'semantic'])
    const productCol = findCol(data.collections, ['product'])
    const platformCol = findCol(data.collections, ['platform'])

    const modeId = (col: FigmaCollection | undefined, names: string[]) =>
        col ? (findMode(col, names)?.modeId ?? '') : ''

    const build = (col: FigmaCollection | undefined, mid: string) =>
        col && mid ? buildTokenTree(col.variableIds, mid, varMap) : empty()

    return {
        base: build(baseCol, baseCol?.modes[0]?.modeId ?? ''),
        themeLight: build(themeCol, modeId(themeCol, ['light'])),
        themeDark: build(themeCol, modeId(themeCol, ['dark'])),
        productB2b: build(productCol, modeId(productCol, ['b2b'])),
        productB2c: build(productCol, modeId(productCol, ['b2c'])),
        productPoints: build(productCol, modeId(productCol, ['points', 'point'])),
        platformWeb: build(platformCol, modeId(platformCol, ['web'])),
        platformIos: build(platformCol, modeId(platformCol, ['ios'])),
        platformAndroid: build(platformCol, modeId(platformCol, ['android'])),
    }
}

export interface CollectionInfo {
    allNames: string[]
    detected: { base?: string; theme?: string; product?: string; platform?: string }
}

export function detectCollections(data: FigmaTokenMessage): CollectionInfo {
    const { collections } = data
    return {
        allNames: collections.map(c => c.name),
        detected: {
            base: findCol(collections, ['base', 'primitive'])?.name,
            theme: findCol(collections, ['theme', 'semantic'])?.name,
            product: findCol(collections, ['product'])?.name,
            platform: findCol(collections, ['platform'])?.name,
        },
    }
}
