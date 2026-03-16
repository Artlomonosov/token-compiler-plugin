/**
 * Deep Resolver — resolves the full reference chain across all 4 token layers.
 *
 * Layers (in resolution order, lowest priority → highest):
 *   Base/Mode 1.json      — raw primitives (Color.*, Radius.*, Font Size.*, Gaps.*, Paddings.*)
 *   Theme/Light.json      — semantic tokens prefixed by product (b2b.*, b2c.*, point.*)
 *     + global theme tokens (text-main, …)
 *   Theme/Dark.json       — same keys, dark values
 *   Product/<name>.json   — final product layer, references {prefix.*} from theme
 *   Platform/<name>.json  — platform-specific typography, references {Font Size.*}
 *
 * Resolution strategy:
 *   Build a single flat lookup map for a given [theme, platform] combo:
 *     merge(Base, Theme[theme], Platform[platform])
 *   Then for each product token, walk {references} until a raw value is found.
 */

// --- Types ---
export type TokenValue = string | number
export interface TokenNode {
    $type?: string
    $value?: TokenValue
    $extensions?: unknown
    [key: string]: unknown
}
export type TokenTree = { [key: string]: TokenNode | TokenTree }

// Resolved flat token: name → { value, type }
export interface ResolvedToken {
    name: string     // e.g. "base", "bg-layer-first", "Radius.control-m"
    value: TokenValue
    type: string
}

// --- Helpers ---

/** Flatten a nested token tree to a dotted-path map: "Color.Slate.850" → node */
export function flattenTree(tree: TokenTree, prefix = ''): Map<string, TokenNode> {
    const map = new Map<string, TokenNode>()
    for (const [key, val] of Object.entries(tree)) {
        if (key.startsWith('$')) continue
        if (isTokenNode(val)) {
            map.set(prefix ? `${prefix}.${key}` : key, val as TokenNode)
        } else {
            const nested = flattenTree(val as TokenTree, prefix ? `${prefix}.${key}` : key)
            nested.forEach((v, k) => map.set(k, v))
        }
    }
    return map
}

function isTokenNode(val: unknown): boolean {
    if (typeof val !== 'object' || val === null) return false
    const obj = val as Record<string, unknown>
    return '$value' in obj
}

/** Extract reference path from "{Color.Slate.850}" → "Color.Slate.850" */
function extractRef(value: TokenValue): string | null {
    if (typeof value !== 'string') return null
    const m = value.match(/^\{(.+)\}$/)
    return m ? m[1] : null
}

/** Normalise a token reference key for lookup (handles spaces, special chars) */
function lookupKey(ref: string): string {
    return ref // keep as-is; map keys use the same format
}

// --- Main resolver ---

export interface DeepResolveOptions {
    base: TokenTree
    themeLight: TokenTree
    themeDark: TokenTree
    productB2b: TokenTree
    productB2c: TokenTree
    productPoints: TokenTree
    platformWeb: TokenTree
    platformIos: TokenTree
    platformAndroid: TokenTree
}

export type Product = 'b2b' | 'b2c' | 'points'
export type Theme = 'light' | 'dark'
export type Platform = 'web' | 'ios' | 'android'

export interface CompiledTokenSet {
    product: Product
    theme: Theme
    platform: Platform
    tokens: ResolvedToken[]
}

/**
 * Resolve a single reference value within a lookup map.
 * Follows chains with circular-reference protection.
 */
function resolveValue(
    startValue: TokenValue,
    lookupMap: Map<string, TokenNode>,
    visited = new Set<string>()
): { value: TokenValue; type: string } {
    const ref = extractRef(startValue)
    if (!ref) {
        return { value: startValue, type: 'unknown' }
    }

    const key = lookupKey(ref)
    if (visited.has(key)) {
        console.warn(`[DeepResolver] Circular reference detected: ${key}`)
        return { value: `CIRCULAR:${key}`, type: 'error' }
    }
    visited.add(key)

    const node = lookupMap.get(key)
    if (!node) {
        // Token references something not in the current set (e.g. missing in theme for a platform)
        return { value: `UNRESOLVED:${ref}`, type: 'error' }
    }

    const nodeValue = node.$value
    if (nodeValue === undefined) {
        return { value: `UNRESOLVED:${ref}`, type: 'error' }
    }

    // If this node's value is also a reference, keep resolving
    if (extractRef(nodeValue)) {
        return resolveValue(nodeValue, lookupMap, visited)
    }

    return { value: nodeValue, type: node.$type ?? 'unknown' }
}

/**
 * For a product file, the top-level keys are the token names.
 * References like {b2b.bg-layer-first} look up "b2b.bg-layer-first" in Theme.
 * References like {Color.Purple.500} look up "Color.Purple.500" in Base.
 * References like {text-main} look up "text-main" in Theme (global).
 */
export function deepResolve(
    options: DeepResolveOptions,
    product: Product,
    theme: Theme,
    platform: Platform
): ResolvedToken[] {
    // 1. Build the lookup map: Base + Theme + Platform merged
    const themeData = theme === 'light' ? options.themeLight : options.themeDark
    const platformData =
        platform === 'web'
            ? options.platformWeb
            : platform === 'ios'
                ? options.platformIos
                : options.platformAndroid

    const lookupMap = new Map<string, TokenNode>()

    // Base has highest raw value priority; merge order: base → theme → platform
    flattenTree(options.base).forEach((v, k) => lookupMap.set(k, v))
    flattenTree(themeData).forEach((v, k) => lookupMap.set(k, v))
    flattenTree(platformData).forEach((v, k) => lookupMap.set(k, v))

    // 2. Get product token tree
    const productData =
        product === 'b2b'
            ? options.productB2b
            : product === 'b2c'
                ? options.productB2c
                : options.productPoints

    // 3. Flatten product tokens and resolve each
    const productFlat = flattenTree(productData)
    const results: ResolvedToken[] = []

    for (const [tokenName, node] of productFlat.entries()) {
        if (node.$value === undefined) continue

        const { value, type } = resolveValue(node.$value, lookupMap)
        results.push({
            name: tokenName,
            value,
            type: node.$type ?? type,
        })
    }

    // 4. Also include platform tokens (typography, fonts, gaps)
    //    resolved within base + platform context
    const platformFlat = flattenTree(platformData)
    for (const [tokenName, node] of platformFlat.entries()) {
        if (node.$value === undefined) continue
        // Don't duplicate if already in product
        if (productFlat.has(tokenName)) continue

        const { value, type } = resolveValue(node.$value, lookupMap)
        results.push({
            name: tokenName,
            value,
            type: node.$type ?? type,
        })
    }

    return results
}

/**
 * Resolve Base collection tokens directly (without product/theme context).
 * Base tokens are raw primitives: Color.Slate.850, Radius.control-m, Font Size.body-l, etc.
 * References within Base (if any) are resolved within Base itself.
 */
export function resolveBaseTokens(options: DeepResolveOptions): ResolvedToken[] {
    // Build lookup map from Base only (self-referential resolution)
    const lookupMap = flattenTree(options.base)

    const results: ResolvedToken[] = []
    for (const [tokenName, node] of lookupMap.entries()) {
        if (node.$value === undefined) continue
        const { value, type } = resolveValue(node.$value, lookupMap)
        results.push({
            name: tokenName,
            value,
            type: node.$type ?? type,
        })
    }
    return results
}

