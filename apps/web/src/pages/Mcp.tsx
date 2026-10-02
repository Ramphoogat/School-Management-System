import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Plug, Trash2 } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Connection { id: string; name: string; prefix: string; lastUsedAt: string | null; createdAt: string }
interface ToolInfo { name: string; description: string }

const copy = (text: string, done: string) => navigator.clipboard.writeText(text).then(() => toast.success(done), () => toast.error('Could not copy'))

/** Connect outside applications (an AI assistant, for example) to the school's data through MCP. */
export default function Mcp() {
  const { t } = useT()
  const [data, setData] = useState<{ connections: Connection[]; tools: ToolInfo[] } | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null)
  const url = apiUrl('/api/mcp')

  const load = useCallback(() => api<{ connections: Connection[]; tools: ToolInfo[] }>('/mcp/connections').then(setData).catch((e) => toast.error(e.message)), [])
  useEffect(() => { void load() }, [load])

  const create = async () => {
    setBusy(true)
    try {
      const r = await api<{ name: string; secret: string }>('/mcp/connections', { method: 'POST', body: { name } })
      setFresh({ name: r.name, secret: r.secret }); setName(''); await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async (c: Connection) => {
    if (!window.confirm(t('Disconnect {name}? It will stop working straight away.', { name: c.name }))) return
    try { await api(`/mcp/connections/${c.id}`, { method: 'DELETE' }); if (fresh?.name === c.name) setFresh(null); await load() } catch (e) { toast.error((e as Error).message) }
  }

  const snippet = (secret: string) => JSON.stringify({ mcpServers: { school: { type: 'http', url, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Plug className="h-6 w-6" />{t('MCP connections')}</h1>
        <p className="text-sm text-muted-foreground">{t('Connect an AI assistant or another application to your school. It reads your school’s data through MCP, as you, and can never see more than you can. It cannot change anything.')}</p>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-medium">{t('Server address')}</h2>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-sm">{url}</code>
          <Button size="icon" variant="outline" aria-label={t('Copy')} onClick={() => copy(url, t('Copied'))}><Copy className="h-4 w-4" /></Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-medium">{t('Connect an application')}</h2>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder={t('Name, e.g. Claude')} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <Button onClick={create} disabled={busy || name.trim().length < 2}>{t('Create connection')}</Button>
        </div>
        {fresh && (
          <div role="status" className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">{t('Copy this key now. It is shown only once.')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{fresh.secret}</code>
              <Button size="icon" variant="outline" aria-label={t('Copy')} onClick={() => copy(fresh.secret, t('Copied'))}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('Paste this into the application’s MCP settings:')}</p>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{snippet(fresh.secret)}</pre>
            <Button size="sm" variant="outline" onClick={() => copy(snippet(fresh.secret), t('Copied'))}><Copy className="mr-1.5 h-4 w-4" />{t('Copy settings')}</Button>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-medium">{t('Connected applications')}</h2>
        {data && data.connections.length === 0 && <p className="text-sm text-muted-foreground">{t('Nothing is connected yet.')}</p>}
        <ul className="divide-y">
          {data?.connections.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name} <span className="font-mono text-xs text-muted-foreground">{c.prefix}…</span></p>
                <p className="text-xs text-muted-foreground">{t('Made')} {new Date(c.createdAt).toLocaleDateString()} · {c.lastUsedAt ? `${t('Last used')} ${new Date(c.lastUsedAt).toLocaleString()}` : t('Never used')}</p>
              </div>
              <Button size="icon" variant="ghost" aria-label={`${t('Disconnect')} ${c.name}`} onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      </section>

      {data && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="font-medium">{t('What a connected application can do')}</h2>
          <ul className="space-y-1 text-sm">
            {data.tools.map((x) => <li key={x.name}><code className="text-xs">{x.name}</code> <span className="text-muted-foreground">{x.description}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  )
}
