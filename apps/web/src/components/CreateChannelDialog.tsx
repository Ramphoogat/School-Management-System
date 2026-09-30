import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Hash, Volume2 } from 'lucide-react'
import { api } from '@/lib/api'
import { PICKABLE_ICONS } from '@/lib/channelIcons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/lib/i18n'

type Kind = 'text' | 'voice'

/** Adds a channel to a class: a text channel (its own chat) or a voice channel (a call room). */
export function CreateChannelDialog({ cls, onClose }: { cls: { id: string; name: string } | null; onClose: () => void }) {
  const { t } = useT()
  const nav = useNavigate()
  const [kind, setKind] = useState<Kind>('text')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('hash')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (cls) { setKind('text'); setName(''); setIcon('hash') } }, [cls])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!cls || !name.trim()) return
    setBusy(true)
    try {
      if (kind === 'text') {
        const ch = await api<{ id: string }>(`/classes/${cls.id}/channels`, { body: { name, icon } })
        window.dispatchEvent(new Event('classes-changed'))
        nav(`/classes/${cls.id}?channel=text&cid=${ch.id}`)
      } else {
        await api(`/voice/class/${cls.id}`, { body: { name } })
        nav(`/classes/${cls.id}?channel=voice`)
      }
      toast.success(t('Channel created'))
      onClose()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  const option = (k: Kind, Icon: typeof Hash, title: string, hint: string) => (
    <button type="button" onClick={() => setKind(k)}
      className={`flex flex-1 items-start gap-2 rounded-lg border p-3 text-left transition hover:bg-accent ${kind === k ? 'border-primary ring-2 ring-primary/40' : ''}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
    </button>
  )

  return (
    <Dialog open={!!cls} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Create channel')}</DialogTitle>
          <DialogDescription>{t('in {name}', { name: cls?.name })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex gap-2">
            {option('text', Hash, 'Text', 'Its own chat for the class')}
            {option('voice', Volume2, 'Voice', 'A room for calls')}
          </div>
          {kind === 'text' && (
            <div className="space-y-1">
              <span className="text-sm font-medium">{t('Icon')}</span>
              <div className="grid max-h-40 grid-cols-7 gap-1 overflow-y-auto rounded-lg border p-1.5" role="radiogroup" aria-label={t('Channel icon')}>
                {PICKABLE_ICONS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key} type="button" role="radio" aria-checked={icon === key} title={label} aria-label={label}
                    onClick={() => setIcon(key)}
                    className={`flex h-9 items-center justify-center rounded-md transition hover:bg-accent ${icon === key ? 'bg-primary text-primary-foreground hover:bg-primary' : 'text-muted-foreground'}`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="channel-name" className="text-sm font-medium">{t('Channel name')}</label>
            <Input id="channel-name" autoFocus maxLength={40} placeholder={kind === 'text' ? 'e.g. science-club' : 'e.g. study room'} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create channel'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
