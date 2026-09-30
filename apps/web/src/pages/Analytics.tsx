import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import { inr } from '@/pages/Fees'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useT } from '@/lib/i18n'

interface Overview {
  people: Record<string, number>
  attendance: { today: { present: number; marked: number; percent: number | null }; trend: { date: string; percent: number | null; marked: number }[]; low: { id: string; name: string; percent: number; days: number }[] }
  results: { subjects: { subject: string; percent: number; entries: number }[] }
  fees: { billed: number; collected: number; outstanding: number; overdue: number; waived: number; collectionRate: number | null }
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <Card>
    <CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader>
    {sub && <CardContent className="text-xs text-muted-foreground">{sub}</CardContent>}
  </Card>
)

const tip = { contentStyle: { background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 } }

export default function Analytics() {
  const { t: tr } = useT()
  const [d, setD] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<Overview>('/analytics/overview').then(setD).catch((e) => setErr(e.message)) }, [])
  if (err) return <p className="text-destructive">{err}</p>
  if (!d) return <p className="text-muted-foreground">{tr('Loading…')}</p>

  const trend = d.attendance.trend.map((t) => ({ ...t, label: t.date.slice(5) }))
  const hasTrend = trend.some((t) => t.percent !== null)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{tr('School overview')}</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Students" value={String(d.people.student ?? 0)} sub={`${d.people.teacher ?? 0} teachers · ${d.people.classes} classes`} />
        <Stat label="Attendance today" value={d.attendance.today.percent === null ? 'Not marked' : `${d.attendance.today.percent}%`} sub={`${d.attendance.today.present} of ${d.attendance.today.marked} marked present`} />
        <Stat label="Fees collected" value={d.fees.collectionRate === null ? '—' : `${d.fees.collectionRate}%`} sub={`${inr(d.fees.collected)} of ${inr(d.fees.billed)}`} />
        <Stat label="Overdue fees" value={inr(d.fees.overdue)} sub={`${inr(d.fees.outstanding)} outstanding · ${inr(d.fees.waived)} waived`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{tr('Attendance, last 14 days')}</CardTitle><CardDescription>{tr('Percent present each day (days with no marks are blank)')}</CardDescription></CardHeader>
          <CardContent className="h-64">
            {hasTrend ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip {...tip} formatter={(v) => [`${v}%`, 'Present']} />
                  <Line type="monotone" dataKey="percent" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">{tr('No attendance has been marked in the last 14 days.')}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{tr('Average result by subject')}</CardTitle><CardDescription>{tr('Approved results only')}</CardDescription></CardHeader>
          <CardContent className="h-64">
            {d.results.subjects.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.results.subjects} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis type="category" dataKey="subject" width={80} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip {...tip} formatter={(v) => [`${v}%`, 'Average']} />
                  <Bar dataKey="percent" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={26} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">{tr('No approved results yet.')}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{tr('Students with low attendance')}</CardTitle><CardDescription>{tr('Under 75% over the last 30 days (3 or more days recorded)')}</CardDescription></CardHeader>
        <CardContent>
          {d.attendance.low.length === 0 ? <p className="text-sm text-muted-foreground">{tr('No students are below 75%.')}</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>{tr('Student')}</TableHead><TableHead>{tr('Present')}</TableHead><TableHead>{tr('Days recorded')}</TableHead></TableRow></TableHeader>
              <TableBody>{d.attendance.low.map((s) => <TableRow key={s.id}><TableCell>{s.name}</TableCell><TableCell>{s.percent}%</TableCell><TableCell>{s.days}</TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground"><Link to="/approvals-center" className="underline">{tr('Looking for things that need a decision? Open the approvals center.')}</Link></p>
    </div>
  )
}
