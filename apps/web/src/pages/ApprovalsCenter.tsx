import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/lib/api'
import { useLiveRefresh } from '@/lib/live'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useT } from '@/lib/i18n'

interface Item { key: string; label: string; count: number; path: string }

export default function ApprovalsCenter() {
  const { t } = useT()
  const [data, setData] = useState<{ total: number; items: Item[] } | null>(null)
  const load = useCallback(() => api<{ total: number; items: Item[] }>('/approvals/summary').then(setData), [])
  useEffect(() => { void load() }, [load])
  useLiveRefresh(['todo'], load) // any change may move a count
  if (!data) return <p className="text-muted-foreground">{t('Loading…')}</p>
  const waiting = data.items.filter((i) => i.count > 0)
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('Approvals center')}</h1>
      <p className="text-muted-foreground">{data.total === 0 ? 'Nothing is waiting for you. All queues are clear.' : `${data.total} item(s) waiting across ${waiting.length} queue(s). Every queue supports select-all and bulk decisions.`}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map((i) => (
          <Link key={i.key} to={i.path}>
            <Card className={`h-full transition hover:bg-accent ${i.count === 0 ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-2">
                <CardDescription>{i.label}</CardDescription>
                <CardTitle className="flex items-center gap-2 text-3xl">{i.count}{i.count > 0 && <Badge>{t('Needs action')}</Badge>}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{i.count === 0 ? 'All clear' : 'Open the queue'}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
