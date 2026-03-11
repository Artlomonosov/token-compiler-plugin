/// <reference types="@figma/plugin-typings" />
/**
 * code.ts — Figma Plugin Sandbox
 * Runs inside Figma's environment (NOT in the browser).
 * Reads local variables and sends them to the UI iframe.
 */


figma.showUI(__html__, {
    width: 720,
    height: 900,
    title: 'Token Compiler',
    themeColors: true,
})

interface UIMessage {
    type: 'REQUEST_TOKENS' | 'CLOSE'
}

figma.ui.onmessage = (msg: UIMessage) => {
    if (msg.type === 'CLOSE') {
        figma.closePlugin()
        return
    }

    if (msg.type === 'REQUEST_TOKENS') {
        try {
            const collections = figma.variables.getLocalVariableCollections()
            const variables = figma.variables.getLocalVariables()

            figma.ui.postMessage({
                type: 'TOKENS_DATA',
                collections: collections.map(c => ({
                    id: c.id,
                    name: c.name,
                    modes: c.modes,
                    variableIds: c.variableIds,
                })),
                variables: variables.map(v => ({
                    id: v.id,
                    name: v.name,
                    collectionId: v.variableCollectionId,
                    type: v.resolvedType,
                    valuesByMode: v.valuesByMode,
                })),
            })
        } catch (err: unknown) {
            figma.ui.postMessage({
                type: 'ERROR',
                message: err instanceof Error ? err.message : String(err),
            })
        }
    }
}
