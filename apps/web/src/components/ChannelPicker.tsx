import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { useT } from '@/lib/i18n'

export type Channel = 'email' | 'whatsapp' | 'in_app'
const LABEL: Record<Channel, string> = { email: 'Email', whatsapp: 'WhatsApp', in_app: 'In-app' }

/** Lets the sender choose how a message goes out. Recipients' own preferences and WhatsApp opt-in still apply. */
export function ChannelPicker({ value, onChange }: { value: Channel[]; onChange: (v: Channel[]) => void }) {
  const { t } = useT()
  const [avail, setAvail] = useState<Record<Channel, boolean> | null>(null)
  useEffect(() => { api<Record<Channel, boolean>>('/notifications/channels').then(setAvail).catch(() => setAvail(null)) }, [])

  const toggle = (c: Channel) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c])
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{t('Send via')}</legend>
      <div className="flex flex-wrap gap-4">
        {(Object.keys(LABEL) as Channel[]).map((c) => (
          <label key={c} className="flex items-center gap-2 text-sm">
            <Checkbox checked={value.includes(c)} onCheckedChange={() => toggle(c)} />
            {LABEL[c]}
            {avail && !avail[c] && <span className="text-xs text-muted-foreground">{t('(not set up yet)')}</span>}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('WhatsApp only reaches people who opted in. If it fails, email is used instead.')}</p>
    </fieldset>
  )
}
