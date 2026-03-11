/**
 * fix-figma-html.mjs
 *
 * Postbuild script that makes dist/index.html compatible with Figma plugin iframes:
 * 1. Extracts the LAST large inline <script> block (the main Vite bundle)
 *    (uses greedy + lastIndex approach to avoid early match on JSZip internal <\/script> strings)
 * 2. Strips type="module" crossorigin so Figma doesn't block it
 * 3. Moves the script to just before </body> so #root exists when React mounts
 *    (Important: inline scripts ignore `defer`, only external scripts support it)
 */

import fs from 'fs'

const filePath = 'dist/index.html'
let html = fs.readFileSync(filePath, 'utf-8')

// Find the main Vite bundle: the largest <script> block.
// We look for <script type="module" crossorigin> or <script defer> as the opener.
// The bundle ends at the VERY LAST </script> in the file (because the bundle is the last script).

const lastScriptClose = html.lastIndexOf('</script>')
if (lastScriptClose === -1) {
    console.error('❌ No </script> found in dist/index.html. Something is wrong with the build.')
    process.exit(1)
}

// Find the matching opening <script ...> that precedes the last </script>
// We search backwards for either <script type="module" crossorigin> or <script defer>
const beforeClose = html.slice(0, lastScriptClose)

let scriptOpenPos = beforeClose.lastIndexOf('<script type="module" crossorigin>')
let openTagLen = '<script type="module" crossorigin>'.length

if (scriptOpenPos === -1) {
    // Maybe already patched from a previous run (postbuild ran twice)
    scriptOpenPos = beforeClose.lastIndexOf('<script defer>')
    openTagLen = '<script defer>'.length
}

if (scriptOpenPos === -1) {
    // Check for plain <script> that's large (skip tiny ones like the error handler)
    // Find all <script> positions
    const positions = []
    let searchFrom = 0
    while (true) {
        const idx = beforeClose.indexOf('<script>', searchFrom)
        if (idx === -1) break
        positions.push(idx)
        searchFrom = idx + 1
    }
    if (positions.length > 0) {
        // The last one is the bundle (largest)
        scriptOpenPos = positions[positions.length - 1]
        openTagLen = '<script>'.length
    }
}

if (scriptOpenPos === -1) {
    console.error('❌ Could not find the main <script> opening tag. Skipping fix.')
    process.exit(0)
}

// Extract the inline script content
const scriptContent = html.slice(scriptOpenPos + openTagLen, lastScriptClose)
const scriptContentSize = scriptContent.length

// Remove the old script tag (opener + content + </script>)
const before = html.slice(0, scriptOpenPos)
const after = html.slice(lastScriptClose + '</script>'.length)
html = before + after

// Insert plain <script> before </body>
const bodyCloseIdx = html.lastIndexOf('</body>')
if (bodyCloseIdx === -1) {
    console.error('❌ No </body> found. Cannot inject script.')
    process.exit(1)
}

const plainScript = `<script>${scriptContent}</script>`
html = html.slice(0, bodyCloseIdx) + plainScript + '\n' + html.slice(bodyCloseIdx)

fs.writeFileSync(filePath, html)
console.log(`✓ Moved ${Math.round(scriptContentSize / 1024)}KB inline script to end of <body>`)
console.log('✓ dist/index.html patched for Figma compatibility')
