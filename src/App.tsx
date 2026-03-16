import { useState, useCallback, useEffect, useRef } from 'react'
import type { Platform } from './lib/deepResolver'
import { loadAllTokens } from './lib/tokenLoader'
import type { AllTokens } from './lib/tokenLoader'
import { buildJsonZip, downloadBlob } from './lib/zipBuilder'
import { figmaDataToAllTokens, detectCollections } from './lib/figmaResolver'
import type { FigmaMessage, FigmaTokenMessage } from './lib/types'

// ─── Config ─────────────────────────────────────────────────────────────────



const PLATFORMS: { id: Platform; label: string; icon: string }[] = [
    { id: 'web', label: 'Web', icon: '🌐' },
    { id: 'ios', label: 'iOS', icon: '🍎' },
    { id: 'android', label: 'Android', icon: '🤖' },
]
type Status = 'idle' | 'loading' | 'success' | 'error'

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
    // token source
    const [figmaTokens, setFigmaTokens] = useState<AllTokens | null>(null)
    const [figmaStatus, setFigmaStatus] = useState<Status>('idle')
    const [figmaMsg, setFigmaMsg] = useState('')
    const [figmaColNames, setFigmaColNames] = useState<string[]>([])

    // compilation
    const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set(['web', 'ios', 'android']))
    const [exportBase, setExportBase] = useState(true)
    const [status, setStatus] = useState<Status>('idle')
    const [statusMsg, setStatusMsg] = useState('Select platforms, then compile.')

    const figmaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    // ── Sync via Figma plugin (when running inside Figma) ──────────────────────
    const handlePluginSync = useCallback(() => {
        setFigmaStatus('loading')
        setFigmaMsg('Запрашиваю переменные…')
        parent.postMessage({ pluginMessage: { type: 'REQUEST_TOKENS' } }, '*')
        figmaTimeoutRef.current = setTimeout(() => {
            setFigmaStatus('error')
            setFigmaMsg('Нет ответа от плагина. Убедись, что плагин запущен внутри Figma.')
        }, 4000)
    }, [])

    // ── Compile ────────────────────────────────────────────────────────────────
    const toggle = <T,>(set: Set<T>, id: T) => {
        const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); return next
    }

    const canCompile = selectedPlatforms.size > 0
    const source = figmaTokens ? '🔗 Figma API' : '📂 JSON'

    const handleCompile = useCallback(async () => {
        setStatus('loading'); setStatusMsg('Загружаю токены…')
        try {
            const tokens = figmaTokens ?? await loadAllTokens()
            setStatusMsg('Собираю JSON Bundle…')

            const blob = await buildJsonZip(tokens, selectedPlatforms, exportBase)
            downloadBlob(blob, 'tokens.zip')

            setStatus('success')
            const fileCount = selectedPlatforms.size + (exportBase ? 1 : 0)
            setStatusMsg(`✓ ${fileCount} файлов (DTCG JSON) · источник: ${source}`)
        } catch (err) {
            setStatus('error')
            setStatusMsg(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
        }
    }, [selectedPlatforms, exportBase, figmaTokens, source])


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

            {/* ── Figma Sync ── */}
            <div className="card">
                <div className="card-title">Источник токенов</div>
                <button
                    className={`sync-btn primary full-width ${figmaStatus === 'success' ? 'synced' : ''}`}
                    onClick={handlePluginSync}
                    disabled={figmaStatus === 'loading'}
                >
                    {figmaStatus === 'loading' ? '⏳ Загрузка…' : '🔌 Plugin sync'}
                </button>

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
            </div>

            {/* ── Platforms & Base ── */}
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
                <div className="divider" style={{ margin: '14px 0' }} />
                <label
                    className={`checkbox-item ${exportBase ? 'checked' : ''}`}
                    onClick={() => setExportBase(b => !b)}
                    style={{ width: '100%' }}
                >
                    <span className="check-box" />
                    <span className="item-label">Export <strong>Base Primitives</strong> separately</span>
                </label>
            </div>



            {/* ── Export ── */}
            <div className="card action-area">
                <div className="card-title">Экспорт</div>
                {canCompile && (
                    <div className="status idle" style={{ marginBottom: 4 }}>
                        <span className="status-dot" />
                        {selectedPlatforms.size + (exportBase ? 1 : 0)} файл(а) DTCG JSON · источник: <strong>{source}</strong>
                    </div>
                )}
                <button
                    className="compile-btn"
                    disabled={!canCompile || status === 'loading'}
                    onClick={handleCompile}
                >
                    {status === 'loading' ? '⏳ Компиляция JSON…' : '📦 Generate JSON Bundle'}
                </button>
                <div className={`status ${status}`}>
                    <span className="status-dot" />{statusMsg}
                </div>
            </div>

            <div className="footer">Token Compiler v1.2 · Plugin sync</div>
        </div>
    )
}
