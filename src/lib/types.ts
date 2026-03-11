/** Shared Figma Variable data types (passed from code.ts to UI via postMessage) */

export interface FigmaColor { r: number; g: number; b: number; a: number }
export interface FigmaAlias { type: 'VARIABLE_ALIAS'; id: string }
export type FigmaVarValue = FigmaColor | number | string | boolean | FigmaAlias

export interface FigmaMode { modeId: string; name: string }

export interface FigmaCollection {
    id: string
    name: string
    modes: FigmaMode[]
    variableIds: string[]
}

export interface FigmaVariable {
    id: string
    name: string
    collectionId: string
    type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN'
    valuesByMode: Record<string, FigmaVarValue>
}

export interface FigmaTokenMessage {
    type: 'TOKENS_DATA'
    collections: FigmaCollection[]
    variables: FigmaVariable[]
}

export interface FigmaErrorMessage {
    type: 'ERROR'
    message: string
}

export type FigmaMessage = FigmaTokenMessage | FigmaErrorMessage
