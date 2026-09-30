import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, apiList, uploadFile } from '@/lib/api'
import { CutOffNotice } from '@/components/CutOffNotice'
import { AuthedImage } from '@/components/AuthedImage'
import { PhotoCropDialog } from '@/components/PhotoCropDialog'
import { BulkSelectionBar } from '@/components/BulkSelectionBar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pager, usePaged } from '@/components/Pager'
import { useT } from '@/lib/i18n'

interface Card { studentId: string; name: string; className: string; number: string; guardian: string | null; guardianPhone: string | null; hasPhoto: boolean; photoVersion: number | null }
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
interface Result { schoolName: string; cards: Card[]; succeeded: number; total: number; failed: { studentId: string; error?: string }[] }

export function IdCards() {
  const { t: tr } = useT()
  const [students, setStudents] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [total, setTotal] = useState(0)
  const paged = usePaged(students)
  const [photos, setPhotos] = useState<Map<string, number>>(new Map()) // student id -> version of their photo
  const [crop, setCrop] = useState<{ id: string; name: string; file: File } | null>(null)
  const forStudent = useRef<{ id: string; name: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const loadPhotos = useCallback(() => api<{ photos: { studentId: string; version: number }[] }>('/id-cards/photos').then((r) => setPhotos(new Map(r.photos.map((p) => [p.studentId, p.version])))).catch(() => undefined), [])
  useEffect(() => { void loadPhotos() }, [loadPhotos])

  const choosePhoto = (s: { id: string; name: string }) => { forStudent.current = s; fileInput.current?.click() }
  const savePhoto = async (jpeg: File) => {
    if (!crop) return
    await uploadFile(`/id-cards/photo/${crop.id}`, jpeg, undefined, true, 'PUT')
    toast.success(`Photo saved for ${crop.name}`)
    setCrop(null); await loadPhotos()
  }
  const removePhoto = async (s: { id: string; name: string }) => {
    if (!window.confirm(`Remove the photo of ${s.name}?`)) return
    try { await api(`/id-cards/photo/${s.id}`, { method: 'DELETE' }); await loadPhotos() } catch (e) { toast.error((e as Error).message) }
  }

  useEffect(() => {
    const t = setTimeout(() => apiList<any>(`/students?q=${encodeURIComponent(q)}`).then((r) => { setStudents(r.rows); setTotal(r.total) }).catch((e) => toast.error(e.message)), 250)
    return () => clearTimeout(t)
  }, [q])

  const allSel = students.length > 0 && students.every((s) => selected.has(s.id))
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const generate = async () => {
    setBusy(true)
    try {
      const r = await api<Result>('/id-cards/bulk', { body: { studentIds: [...selected] } })
      toast[r.failed.length ? 'warning' : 'success'](`${r.succeeded} of ${r.total} card(s) generated`)
      setResult(r); setSelected(new Set())
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => setResult(null)}>{tr('Back')}</Button>
          <Button size="sm" onClick={() => window.print()} disabled={result.cards.length === 0}>{tr('Print {length} card(s)', { length: result.cards.length })}</Button>
        </div>
        {result.failed.length > 0 && <div className="rounded-md border border-destructive/50 p-3 text-sm print:hidden"><p className="font-medium">{tr('Not generated:')}</p><ul className="list-disc pl-5">{result.failed.map((f) => <li key={f.studentId}><code>{f.studentId.slice(-8)}</code>: {f.error}</li>)}</ul></div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-3">
          {result.cards.map((c) => (
            <div key={c.studentId} className="break-inside-avoid overflow-hidden rounded-lg border">
              <div className="bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground">{result.schoolName}</div>
              <div className="flex items-center gap-4 p-4">
                <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-xl font-semibold">
                  <AuthedImage path={c.hasPhoto ? `/id-cards/photo/${c.studentId}?v=${c.photoVersion}` : null} alt={`Photo of ${c.name}`} className="h-full w-full object-cover" fallback={<span>{initials(c.name)}</span>} />
                </div>
                <div className="min-w-0 text-sm">
                  <p className="truncate text-base font-semibold">{c.name}</p>
                  <p>{tr('Class:')} {c.className || '—'}</p>
                  <p className="font-mono text-xs">{c.number}</p>
                </div>
              </div>
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">{c.guardian ? `Guardian: ${c.guardian}${c.guardianPhone ? `, ${c.guardianPhone}` : ''}` : 'Guardian: not on record'}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{tr('ID cards')}</h1>
        <p className="text-sm text-muted-foreground">{tr('Select students, generate their cards, then print the sheet.')}</p>
      </div>
      <Input className="sm:max-w-sm" placeholder={tr('Search by name or email')} value={q} onChange={(e) => setQ(e.target.value)} />
      {students.length === 0 ? <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{tr('No students found.')}</p> : (
        <>
          <Table>
            <TableHeader><TableRow><TableHead className="w-10"><Checkbox checked={allSel} onCheckedChange={() => setSelected(allSel ? new Set() : new Set(students.map((s) => s.id)))} aria-label={tr('Select all')} /></TableHead><TableHead>{tr('Photo')}</TableHead><TableHead>{tr('Student')}</TableHead><TableHead>{tr('Class')}</TableHead></TableRow></TableHeader>
            <TableBody>{paged.items.map((s) => <TableRow key={s.id}><TableCell><Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} aria-label={`Select ${s.name}`} /></TableCell><TableCell><div className="flex items-center gap-2"><span className="flex h-10 w-8 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted text-[10px] font-semibold"><AuthedImage path={photos.has(s.id) ? `/id-cards/photo/${s.id}?v=${photos.get(s.id)}` : null} alt="" className="h-full w-full object-cover" fallback={<span>{initials(s.name)}</span>} /></span><Button size="sm" variant="ghost" onClick={() => choosePhoto(s)}>{photos.has(s.id) ? 'Change' : 'Add photo'}</Button>{photos.has(s.id) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removePhoto(s)}>{tr('Remove')}</Button>}</div></TableCell><TableCell>{s.name}</TableCell><TableCell>{s.classes.map((c: any) => c.name).join(', ') || '—'}</TableCell></TableRow>)}</TableBody>
          </Table>
          <CutOffNotice shown={students.length} total={total} />
          <Pager {...paged.props} />
        </>
      )}
      <input ref={fileInput} type="file" hidden accept=".jpg,.jpeg,.png" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && forStudent.current) setCrop({ ...forStudent.current, file: f }) }} />
      <PhotoCropDialog file={crop?.file ?? null} name={crop?.name ?? ''} onCancel={() => setCrop(null)} onSave={savePhoto} />
      <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" onClick={generate} disabled={busy}>{busy ? 'Generating…' : 'Generate ID cards'}</Button>
      </BulkSelectionBar>
    </div>
  )
}
