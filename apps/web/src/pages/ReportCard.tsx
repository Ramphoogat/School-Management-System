import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n'
import { toast } from 'sonner'
import { api, downloadFile } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Card {
  student: { id: string; name: string }
  className: string
  results: { examId: string; exam: string; subject: string; date: string; score: number | null; maxMarks: number; absent: boolean; percent: number | null; grade: string | null }[]
  totalScore: number
  totalMax: number
  overallPercent: number | null
  overallGrade: string | null
}

export default function ReportCard() {
  const { t: tr, t } = useT()
  const { user } = useAuth()
  const ids = user?.role === 'parent' ? user.linkedStudentIds ?? [] : user ? [user.id] : []
  const [sid, setSid] = useState(ids[0] ?? '')
  const [card, setCard] = useState<Card | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [terms, setTerms] = useState<{ id: string; label: string }[]>([])
  const [termId, setTermId] = useState('')

  useEffect(() => {
    // Child names for the switcher.
    Promise.all(ids.map((id) => api<Card>(`/results/student/${id}`).then((c) => [id, c.student.name] as const).catch(() => [id, id] as const))).then((e) => setNames(Object.fromEntries(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')])
  useEffect(() => {
    api<{ years: { name: string; terms: { id: string; name: string }[] }[] }>('/academic').then((d) => setTerms(d.years.flatMap((y) => y.terms.map((t) => ({ id: t.id, label: `${y.name} · ${t.name}` }))))).catch(() => undefined)
  }, [])
  useEffect(() => { if (sid) api<Card>(`/results/student/${sid}${termId ? `?termId=${termId}` : ''}`).then(setCard).catch(() => setCard(null)) }, [sid, termId])

  if (ids.length === 0) return <p className="text-muted-foreground">{tr('No linked student yet. A clerk proposes the link and the principal or admin approves it.')}</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <h1 className="text-2xl font-semibold">{tr('Report card')}</h1>
        {ids.length > 1 && (
          <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label={t('Child')} value={sid} onChange={(e) => setSid(e.target.value)}>
            {ids.map((id) => <option key={id} value={id}>{names[id] ?? id}</option>)}
          </select>
        )}
        {terms.length > 0 && (
          <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={termId} onChange={(e) => setTermId(e.target.value)} aria-label={t('Term')}>
            <option value="">{t('All terms')}</option>
            {terms.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
        <Button className="ml-auto" size="sm" disabled={!card} onClick={() => downloadFile(`/results/student/${sid}/pdf${termId ? `?termId=${termId}` : ''}`, `Report card ${card?.student.name ?? ''}.pdf`).catch((e) => toast.error(e.message))}>{tr('Download PDF')}</Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>{tr('Print')}</Button>
      </div>
      {card && (
        <div className="max-w-3xl space-y-4">
          <div>
            <h2 className="text-xl font-semibold">{card.student.name}</h2>
            <p className="text-sm text-muted-foreground">{card.className}</p>
          </div>
          {card.results.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{termId ? 'No published results for this term.' : 'No published results yet. They appear here after the principal approves them.'}</p>
          ) : (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>{tr('Subject')}</TableHead><TableHead>{tr('Exam')}</TableHead><TableHead>{tr('Date')}</TableHead><TableHead>{tr('Score')}</TableHead><TableHead>%</TableHead><TableHead>{tr('Grade')}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {card.results.map((r) => (
                    <TableRow key={r.examId}>
                      <TableCell className="font-medium">{r.subject}</TableCell>
                      <TableCell>{r.exam}</TableCell>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.absent ? 'Absent' : `${r.score} / ${r.maxMarks}`}</TableCell>
                      <TableCell>{r.percent ?? '—'}</TableCell>
                      <TableCell>{r.grade ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center gap-3 rounded-md border p-3">
                <span className="text-sm">{tr('Overall: {totalScore} / {totalMax}', { totalScore: card.totalScore, totalMax: card.totalMax })}</span>
                {card.overallPercent !== null && <Badge>{tr('{overallPercent}% · Grade {overallGrade}', { overallPercent: card.overallPercent, overallGrade: card.overallGrade })}</Badge>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
