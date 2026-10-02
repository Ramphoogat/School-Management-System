import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { toast } from 'sonner'
import { downloadFile, uploadFile } from '@/lib/api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AddFromLink } from '@/components/LinkImport'

export interface HwFile { id: string; name: string; size: number }
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Download links for files, with a remove button when the viewer may delete them. */
export function FileChips({ files, onChanged, canRemove }: { files: HwFile[]; onChanged?: () => void; canRemove?: boolean }) {
  if (!files.length) return null
  const remove = async (f: HwFile) => {
    try { await api(`/homework/files/${f.id}`, { method: 'DELETE' }); onChanged?.() } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
          <Paperclip className="size-3 shrink-0" />
          <button type="button" className="max-w-48 truncate underline-offset-2 hover:underline" title={f.name} onClick={() => downloadFile(`/homework/files/${f.id}`, f.name).catch((e) => toast.error(e.message))}>{f.name}</button>
          <span className="text-muted-foreground">{kb(f.size)}</span>
          {canRemove && <button type="button" aria-label={`Remove ${f.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => remove(f)}><X className="size-3" /></button>}
        </li>
      ))}
    </ul>
  )
}

/** File picker that uploads straight away. */
export function AttachButton({ assignmentId, label, onDone, allowLink = false }: { assignmentId: string; label: string; onDone: () => void; /** Also offer "From a link". For teachers only: students always upload from their own device. */ allowLink?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pick = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try { await uploadFile(`/homework/${assignmentId}/files`, file); onDone() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return (
    <>
      <input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt" onChange={(e) => pick(e.target.files?.[0])} />
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}><Paperclip className="mr-1 size-3" />{busy ? 'Uploading…' : label}</Button>
      {allowLink && <AddFromLink path={`/homework/${assignmentId}/files`} onDone={onDone} />}
    </>
  )
}
