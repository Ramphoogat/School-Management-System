import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api, downloadFile, uploadFile } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AddFromLink } from '@/components/LinkImport'
import { useT } from '@/lib/i18n'

interface Doc { id: string; title: string; name: string; size: number; createdAt: string; uploadedBy: string }
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** School-wide documents (forms, circulars, policies). Everyone downloads; clerk, principal and admin publish. */
export default function Documents() {
  const { t } = useT()
  const [data, setData] = useState<{ canUpload: boolean; files: Doc[] } | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => api<{ canUpload: boolean; files: Doc[] }>('/documents').then(setData).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])

  const pick = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try { await uploadFile('/documents', file, title.trim() || undefined); setTitle(''); toast.success(t('Document published')); await load() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const remove = async (d: Doc) => {
    try { await api(`/documents/${d.id}`, { method: 'DELETE' }); await load() } catch (e) { toast.error((e as Error).message) }
  }

  if (!data) return <p className="text-muted-foreground">{t('Loading…')}</p>
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('Documents')}</h1>
        <p className="text-sm text-muted-foreground">{t('Forms, circulars and policies from the school office.')}</p>
      </div>
      {data.canUpload && (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-64" placeholder={t('Title (optional)')} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt" onChange={(e) => pick(e.target.files?.[0])} />
          <Button size="sm" disabled={busy} onClick={() => input.current?.click()}><Upload className="mr-1 size-4" />{busy ? 'Uploading…' : 'Publish a file'}</Button>
          <AddFromLink path="/documents" extra={title.trim() ? { title: title.trim() } : undefined} onDone={() => { setTitle(''); void load() }} />
          <span className="text-xs text-muted-foreground">{t('PDF, images, Word or text, up to 100 MB')}</span>
        </div>
      )}
      {data.files.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('No documents yet.')}{data.canUpload ? ' Publish the first one above.' : ' The school office publishes forms and circulars here.'}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.files.map((d) => (
            <li key={d.id} className="flex items-center gap-3 p-3">
              <FileText className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <button type="button" className="block max-w-full truncate text-left text-sm font-medium hover:underline" title={d.name} onClick={() => downloadFile(`/documents/${d.id}/file`, d.name).catch((e) => toast.error(e.message))}>{d.title}</button>
                <p className="text-xs text-muted-foreground">{d.name} · {kb(d.size)} · {d.uploadedBy} · {new Date(d.createdAt).toLocaleDateString()}</p>
              </div>
              {data.canUpload && <Button size="icon" variant="ghost" aria-label={`Remove ${d.title}`} onClick={() => remove(d)}><Trash2 className="size-4" /></Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
