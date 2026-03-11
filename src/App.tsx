import { useState, useCallback, useEffect, useRef } from 'react'
import type { Product, Theme, Platform } from './lib/deepResolver'
import { deepResolve } from './lib/deepResolver'
import { loadAllTokens } from './lib/tokenLoader'
import type { AllTokens } from './lib/tokenLoader'
import { buildZip, downloadBlob } from './lib/zipBuilder'
import type { CompileEntry } from './lib/zipBuilder'
import type { ResolvedToken } from './lib/deepResolver'
import { figmaDataToAllTokens, detectCollections } from './lib/figmaResolver'
import type { FigmaMessage, FigmaTokenMessage } from './lib/types'

// ─── Config ─────────────────────────────────────────────────────────────────

const PRODUCTS: { id: Product; label: string }[] = [
    { id: 'b2b', label: 'B2B' },
    { id: 'b2c', label: 'B2C' },
    { id: 'points', label: 'Points' },
]
const PLATFORMS: { id: Platform; label: string; icon: string }[] = [
    { id: 'web', label: 'Web', icon: '🌐' },
    { id: 'ios', label: 'iOS', icon: '🍎' },
    { id: 'android', label: 'Android', icon: '🤖' },
]
const THEMES: { id: Theme; label: string; icon: string }[] = [
    { id: 'light', label: 'Light', icon: '☀️' },
    { id: 'dark', label: 'Dark', icon: '🌙' },
]

type Status = 'idle' | 'loading' | 'success' | 'error'

const LS_TOKEN = 'tc_figma_token'
const LS_FILE_KEY = 'tc_figma_file_key'

function getSafeStorage(key: string): string {
    try { return localStorage.getItem(key) ?? '' }
    catch { return '' }
}
function setSafeStorage(key: string, value: string) {
    try { localStorage.setItem(key, value) }
    catch { }
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
    // settings
    const [token, setToken] = useState(() => getSafeStorage(LS_TOKEN))
    const [fileKey, setFileKey] = useState(() => getSafeStorage(LS_FILE_KEY))
    const [showToken, setShowToken] = useState(false)

    // token source
    const [figmaTokens, setFigmaTokens] = useState<AllTokens | null>(null)
    const [figmaStatus, setFigmaStatus] = useState<Status>('idle')
    const [figmaMsg, setFigmaMsg] = useState('')
    const [figmaColNames, setFigmaColNames] = useState<string[]>([])

    // compilation
    const [selectedProducts, setSelectedProducts] = useState<Set<Product>>(new Set(['b2b']))
    const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set(['web']))
    const [selectedThemes, setSelectedThemes] = useState<Set<Theme>>(new Set(['light', 'dark']))
    const [status, setStatus] = useState<Status>('idle')
    const [statusMsg, setStatusMsg] = useState('Select products & platforms, then compile.')
    const [preview, setPreview] = useState<ResolvedToken[] | null>(null)
    const [previewLabel, setPreviewLabel] = useState('')

    const figmaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // persist credentials
    useEffect(() => { setSafeStorage(LS_TOKEN, token) }, [token])
    useEffect(() => { setSafeStorage(LS_FILE_KEY, fileKey) }, [fileKey])

    // listen for Figma plugin messages (when running inside Figma iframe)
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg: FigmaMessage | undefined = event.data?.pluginMessage
            if (!msg) return
            if (figmaTimeoutRef.current) clearTimeout(figmaTimeoutRef.current)

            if (msg.type === 'TOKENS_DATA') {
                applyFigmaData(msg as FigmaTokenMessage)
            }
            if (msg.type === 'ERROR') {
                setFigmaStatus('error')
                setFigmaMsg(`Plugin error: ${(msg as { type: string; message: string }).message}`)
            }
        }
        window.addEventListener('message', handler)
        return () => window.removeEventListener('message', handler)
    }, [])

    function applyFigmaData(msg: FigmaTokenMessage) {
        const allTokens = figmaDataToAllTokens(msg)
        const info = detectCollections(msg)
        setFigmaTokens(allTokens)
        setFigmaColNames(info.allNames)
        setFigmaStatus('success')
        const d = info.detected
        const names = [d.base, d.theme, d.product, d.platform].filter(Boolean).join(', ')
        setFigmaMsg(`✓ ${msg.variables.length} vars · ${msg.collections.length} collections${names ? ` (${names})` : ''}`)
    }

    // ── Fetch from Figma REST API (works in any browser, no plugin needed) ──────
    const handleFetchAPI = useCallback(async () => {
        if (!token.trim()) {
            setFigmaStatus('error')
            setFigmaMsg('Введи Figma Personal Access Token')
            return
        }
        if (!fileKey.trim()) {
            setFigmaStatus('error')
            setFigmaMsg('Введи File Key из URL файла Figma')
            return
        }

        setFigmaStatus('loading')
        setFigmaMsg('Запрашиваю переменные из Figma API…')

        try {
            const url = `https://api.figma.com/v1/files/${fileKey.trim()}/variables/local`
            const res = await fetch(url, { headers: { 'X-Figma-Token': token.trim() } })

            if (!res.ok) {
                const txt = await res.text()
                throw new Error(`${res.status} ${res.statusText}: ${txt.slice(0, 200)}`)
            }

            const json = await res.json()
            const { variables, variableCollections } = json.meta

            // Convert REST API format → FigmaTokenMessage format
            const collections = Object.values(variableCollections as Record<string, {
                id: string; name: string; modes: { modeId: string; name: string }[]; variableIds: string[]
            }>).map(c => ({ id: c.id, name: c.name, modes: c.modes, variableIds: c.variableIds }))

            const variablesArr = Object.values(variables as Record<string, {
                id: string; name: string; variableCollectionId: string;
                resolvedType: string; valuesByMode: Record<string, unknown>
            }>).map(v => ({
                id: v.id,
                name: v.name,
                collectionId: v.variableCollectionId,
                type: v.resolvedType as 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN',
                valuesByMode: v.valuesByMode as Record<string, import('./lib/types').FigmaVarValue>,
            }))

            applyFigmaData({ type: 'TOKENS_DATA', collections, variables: variablesArr })
        } catch (err) {
            setFigmaStatus('error')
            setFigmaMsg(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
        }
    }, [token, fileKey])

    // ── Sync via Figma plugin (when running inside Figma) ──────────────────────
    const handlePluginSync = useCallback(() => {
        setFigmaStatus('loading')
        setFigmaMsg('Запрашиваю переменные из Figma plugin…')
        parent.postMessage({ pluginMessage: { type: 'REQUEST_TOKENS' } }, '*')
        figmaTimeoutRef.current = setTimeout(() => {
            setFigmaStatus('error')
            setFigmaMsg('Нет ответа от плагина. Используй кнопку «Fetch via API» для standalone режима.')
        }, 3000)
    }, [])

    // ── Compile ────────────────────────────────────────────────────────────────
    const toggle = <T,>(set: Set<T>, id: T) => {
        const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); return next
    }

    const canCompile = selectedProducts.size > 0 && selectedPlatforms.size > 0 && selectedThemes.size > 0
    const source = figmaTokens ? '🔗 Figma API' : '📂 JSON'

    const handleCompile = useCallback(async () => {
        setStatus('loading'); setStatusMsg('Загружаю токены…'); setPreview(null)
        try {
            const tokens = figmaTokens ?? await loadAllTokens()
            setStatusMsg(`Резолвинг (${figmaTokens ? 'Figma' : 'JSON'})…`)
            const entries: CompileEntry[] = []
            let total = 0
            for (const product of selectedProducts) {
                for (const theme of selectedThemes) {
                    for (const platform of selectedPlatforms) {
                        const resolved = deepResolve(tokens, product, theme, platform)
                        entries.push({ product, theme, platform, tokens: resolved })
                        total += resolved.length
                        setPreview(resolved); setPreviewLabel(`${product} / ${theme} / ${platform}`)
                    }
                }
            }
            setStatusMsg('Собираю ZIP…')
            const blob = await buildZip(entries)
            downloadBlob(blob, 'tokens.zip')
            setStatus('success')
            setStatusMsg(`✓ ${entries.length} файлов · ${total} токенов · источник: ${source}`)
        } catch (err) {
            setStatus('error')
            setStatusMsg(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
        }
    }, [selectedProducts, selectedPlatforms, selectedThemes, figmaTokens, source])

    // ─── Render ──────────────────────────────────────────────────────────────────

    return (
        <div className="app">
            {/* Header */}
            <div className="header">
                <div className="header-icon">⚙️</div>
                <div>
                    <h1>Token Compiler</h1>
                    <p>Design tokens → CSS / Swift / Android XML</p>
                </div>
            </div>

            {/* ── Settings: Figma Credentials ── */}
            <div className="card">
                <div className="card-title">Figma — источник токенов</div>

                <div className="input-row">
                    <label className="input-label">Personal Access Token</label>
                    <div className="input-wrap">
                        <input
                            id="figma-token"
                            className="token-input"
                            type={showToken ? 'text' : 'password'}
                            placeholder="figd_xxxxxxxxxxxxxxxxxxxx"
                            value={token}
                            onChange={e => { setToken(e.target.value); setFigmaTokens(null) }}
                            spellCheck={false}
                            autoComplete="off"
                        />
                        <button
                            className="eye-btn"
                            onClick={() => setShowToken(v => !v)}
                            title={showToken ? 'Скрыть' : 'Показать'}
                        >
                            {showToken ? '🙈' : '👁️'}
                        </button>
                    </div>
                    <span className="input-hint">
                        Figma → Settings → Personal access tokens
                    </span>
                </div>

                <div className="input-row" style={{ marginTop: 12 }}>
                    <label className="input-label">File Key</label>
                    <input
                        id="figma-file-key"
                        className="token-input"
                        type="text"
                        placeholder="AbCdEfGhIjKlMnOp"
                        value={fileKey}
                        onChange={e => { setFileKey(e.target.value); setFigmaTokens(null) }}
                        spellCheck={false}
                    />
                    <span className="input-hint">
                        Из URL файла: figma.com/file/<strong>FILE_KEY</strong>/...
                    </span>
                </div>

                <div className="sync-row">
                    <button
                        className={`sync-btn primary ${figmaStatus === 'success' ? 'synced' : ''}`}
                        onClick={handleFetchAPI}
                        disabled={figmaStatus === 'loading'}
                    >
                        {figmaStatus === 'loading' ? '⏳ Загрузка…' : '🌐 Fetch via Figma API'}
                    </button>
                    <button
                        className="sync-btn"
                        onClick={handlePluginSync}
                        disabled={figmaStatus === 'loading'}
                        title="Только если плагин запущен внутри Figma"
                    >
                        🔌 Plugin sync
                    </button>
                </div>

                {/* status */}
                {figmaStatus !== 'idle' && (
                    <div className={`status ${figmaStatus}`} style={{ marginTop: 10 }}>
                        <span className="status-dot" />
                        {figmaMsg}
                    </div>
                )}

                {/* collection tags */}
                {figmaColNames.length > 0 && (
                    <div className="collections-list">
                        {figmaColNames.map(name => (
                            <span key={name} className="collection-tag">{name}</span>
                        ))}
                    </div>
                )}

                {/* fallback note */}
                {!figmaTokens && figmaStatus !== 'loading' && (
                    <div className="fallback-note">
                        📂 Без данных Figma — компиляция из <code>public/tokens/*.json</code>
                    </div>
                )}
            </div>

            {/* ── Products ── */}
            <div className="card">
                <div className="card-title">Продукты</div>
                <div className="checkbox-grid">
                    {PRODUCTS.map(p => (
                        <label
                            key={p.id}
                            className={`checkbox-item ${selectedProducts.has(p.id) ? 'checked' : ''}`}
                            onClick={() => setSelectedProducts(prev => toggle(prev, p.id))}
                        >
                            <span className="check-box" /><span className="item-label">{p.label}</span>
                            <span className="item-badge">●</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* ── Platforms ── */}
            <div className="card">
                <div className="card-title">Платформы</div>
                <div className="checkbox-grid">
                    {PLATFORMS.map(p => (
                        <label
                            key={p.id}
                            className={`checkbox-item ${selectedPlatforms.has(p.id) ? 'checked' : ''}`}
                            onClick={() => setSelectedPlatforms(prev => toggle(prev, p.id))}
                        >
                            <span className="check-box" /><span className="item-label">{p.icon} {p.label}</span>
                            <span className="item-badge">●</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* ── Themes ── */}
            <div className="card">
                <div className="card-title">Темы</div>
                <div className="theme-grid">
                    {THEMES.map(t => (
                        <button
                            key={t.id}
                            className={`theme-btn ${selectedThemes.has(t.id) ? 'active' : ''}`}
                            onClick={() => setSelectedThemes(prev => toggle(prev, t.id))}
                        >
                            {t.icon} {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Export ── */}
            <div className="card action-area">
                <div className="card-title">Экспорт</div>
                {canCompile && (
                    <div className="status idle" style={{ marginBottom: 4 }}>
                        <span className="status-dot" />
                        {selectedProducts.size * selectedThemes.size * selectedPlatforms.size} файл(а) · источник: <strong>{source}</strong>
                    </div>
                )}
                <button
                    className="compile-btn"
                    disabled={!canCompile || status === 'loading'}
                    onClick={handleCompile}
                >
                    {status === 'loading' ? '⏳ Компиляция…' : '📦 Compile & Download ZIP'}
                </button>
                <div className={`status ${status}`}>
                    <span className="status-dot" />{statusMsg}
                </div>

                {preview && preview.length > 0 && (
                    <>
                        <div className="divider" />
                        <div className="card-title" style={{ marginBottom: 8 }}>
                            Превью — {previewLabel} ({preview.length} токенов)
                        </div>
                        <div className="preview">
                            {preview.slice(0, 60).map((tok, i) => (
                                <div key={i} className="preview-token">
                                    <span className="preview-name">{tok.name}</span>
                                    <span className="preview-value">
                                        {typeof tok.value === 'string' && tok.value.startsWith('#') && (
                                            <span style={{
                                                display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                                                background: tok.value, marginRight: 5, verticalAlign: 'middle',
                                                border: '1px solid rgba(255,255,255,0.15)',
                                            }} />
                                        )}
                                        {String(tok.value)}
                                    </span>
                                </div>
                            ))}
                            {preview.length > 60 && (
                                <div style={{ color: 'var(--text-muted)', paddingTop: 6 }}>
                                    …и ещё {preview.length - 60} токенов
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            <div className="footer">Token Compiler v1.2 · Figma API + Plugin + JSON · Web / iOS / Android</div>
        </div>
    )
}
