/**
 * Token loader — fetches all JSON token files and returns parsed trees.
 * In development (Vite), files are served from /tokens/ (public directory).
 * The actual token files live in /tokens/ relative to the project root.
 */

import type { TokenTree } from './deepResolver'

async function loadJson(url: string): Promise<TokenTree> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to load token file: ${url} (${res.status})`)
    return res.json()
}

export interface AllTokens {
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

export async function loadAllTokens(): Promise<AllTokens> {
    const [
        base,
        themeLight,
        themeDark,
        productB2b,
        productB2c,
        productPoints,
        platformWeb,
        platformIos,
        platformAndroid,
    ] = await Promise.all([
        loadJson('./tokens/Base/Mode 1.json'),
        loadJson('./tokens/Theme/Light.json'),
        loadJson('./tokens/Theme/Dark.json'),
        loadJson('./tokens/Product/b2b.json'),
        loadJson('./tokens/Product/b2c.json'),
        loadJson('./tokens/Product/points.json'),
        loadJson('./tokens/Platform/Web.json'),
        loadJson('./tokens/Platform/iOS.json'),
        loadJson('./tokens/Platform/Android.json'),
    ])

    return {
        base,
        themeLight,
        themeDark,
        productB2b,
        productB2c,
        productPoints,
        platformWeb,
        platformIos,
        platformAndroid,
    }
}
