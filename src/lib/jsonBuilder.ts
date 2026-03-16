import type { TokenTree } from './deepResolver'
import type { AllTokens } from './tokenLoader'
import type { Platform, Product } from './deepResolver'

/**
 * Deep merge two token trees.
 * Used to mix Theme tokens and Product tokens into a single tree.
 */
function mergeTrees(target: TokenTree, source: TokenTree): TokenTree {
    const output = { ...target }
    for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            const sourceVal = source[key]
            const targetVal = output[key]

            // If both are TokenTree objects (and not TokenNodes with $value)
            if (
                isTree(targetVal) &&
                isTree(sourceVal)
            ) {
                output[key] = mergeTrees(targetVal, sourceVal)
            } else {
                output[key] = sourceVal // Source overrides target
            }
        }
    }
    return output
}

function isTree(val: unknown): val is TokenTree {
    return typeof val === 'object' && val !== null && !('$value' in val)
}

/**
 * Builds the comprehensive DTCG JSON object for a single platform.
 * Structure:
 * {
 *   "platform": { ...platform tokens... },
 *   "b2b": {
 *     "light": { ...theme rules + b2b rules... },
 *     "dark": { ...theme rules + b2b rules... }
 *   },
 *   "b2c": { ... },
 *   "points": { ... }
 * }
 */
export function buildPlatformJson(
    tokens: AllTokens,
    platform: Platform
): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    // 1. Platform specific tokens
    const platformTree =
        platform === 'web'
            ? tokens.platformWeb
            : platform === 'ios'
                ? tokens.platformIos
                : tokens.platformAndroid

    if (Object.keys(platformTree).length > 0) {
        result['platform'] = platformTree
    }

    // 2. Add all products to this platform JSON
    const ALL_PRODUCTS: Product[] = ['b2b', 'b2c', 'points']

    for (const prod of ALL_PRODUCTS) {
        result[prod] = {}

        const prodTree =
            prod === 'b2b'
                ? tokens.productB2b
                : prod === 'b2c'
                    ? tokens.productB2c
                    : tokens.productPoints

        const themes = ['light', 'dark'] as const
        for (const theme of themes) {
            const themeTree = theme === 'light' ? tokens.themeLight : tokens.themeDark

            // Theme tokens act as the base for the product, and Product tokens override/extend them
            const merged = mergeTrees(themeTree, prodTree)

            ;(result[prod] as Record<string, unknown>)[theme] = merged
        }
    }

    return result
}
