import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api, downloadFile, uploadFile } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

interface Res { id: string; name: string; size: number; createdAt: string; uploadedBy: string }
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** A class's shared documents. The class teacher uploads and removes; everyone who can see the class downloads. */
export function Resources({ classId }: { classId: string }) {
  const { t } = useT()
  const [data, setData] = useState<{ canUpload: boolean; files: Res[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => api<{ canUpload: boolean; files: Res[] }>(`/resources/class/${classId}`).then(setData).catch((e) => toast.error(e.message)), [classId])
  useEffect(() => { load() }, [load])

  const pick = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try { await uploadFile(`/resources/class/${classId}`, file); toast.success(t('File shared')); await load() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const remove = async (f: Res) => {
    try { await api(`/resources/files/${f.id}`, { method: 'DELETE' }); await load() } catch (e) { toast.error((e as Error).message) }
  }

  if (!data) return <p className="text-muted-foreground">{t('Loading…')}</p>
  return (
    <div className="max-w-2xl space-y-4">
      {data.canUpload && (
        <div className="flex items-center gap-3">
          <input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt" onChange={(e) => pick(e.target.files?.[0])} />
          <Button size="sm" disabled={busy} onClick={() => input.current?.click()}><Upload className="mr-1 size-4" />{busy ? 'Uploading…' : 'Share a file'}</Button>
          <span className="text-xs text-muted-foreground">{t('PDF, images, Word or text, up to 10 MB')}</span>
        </div>
      )}
      {data.files.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('No files shared yet.')}{data.canUpload ? ' Share notes or worksheets above.' : ' Your teacher shares notes and worksheets here.'}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 p-3">
              <FileText className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <button type="button" className="block max-w-full truncate text-left text-sm font-medium hover:underline" title={f.name} onClick={() => downloadFile(`/resources/files/${f.id}`, f.name).catch((e) => toast.error(e.message))}>{f.name}</button>
                <p className="text-xs text-muted-foreground">{kb(f.size)} · {f.uploadedBy} · {new Date(f.createdAt).toLocaleDateString()}</p>
              </div>
              {data.canUpload && <Button size="icon" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => remove(f)}><Trash2 className="size-4" /></Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
