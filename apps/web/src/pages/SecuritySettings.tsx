import { Link } from 'react-router'
import { Plug, Bell, Camera, CalendarRange, DatabaseZap, HardDrive, KeyRound, Palette, ScrollText, Users, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useT } from '@/lib/i18n'
import { ChangePassword } from '@/pages/Settings'

interface Entry { to: string; label: string; hint: string; icon: LucideIcon; show: boolean }

/** One place to reach every setting: your own password up top, then the school's settings you are allowed to open. */
export default function SecuritySettings() {
  const { can } = useAuth()
  const { t } = useT()
  const groups: { title: string; items: Entry[] }[] = [
    { title: t('Your account'), items: [
      { to: '/settings', label: t('Notification settings'), hint: t('Channels, quiet hours and WhatsApp'), icon: Bell, show: true },
    ] },
    { title: t('School'), items: [
      { to: '/mcp', label: t('MCP connections'), hint: t('Connect AI assistants and other applications'), icon: Plug, show: can('notifications', 'manage') },
      { to: '/users', label: t('Users'), hint: t('Add, deactivate and reset passwords'), icon: Users, show: can('users', 'manage') },
      { to: '/audit', label: t('Audit log'), hint: t('Who did what, and when'), icon: ScrollText, show: can('audit', 'read') },
      { to: '/cameras', label: t('School cameras'), hint: t('Camera feeds and access'), icon: Camera, show: can('cameras', 'view') },
      { to: '/storage', label: t('Storage'), hint: t('Where files are kept'), icon: HardDrive, show: can('storage', 'manage') },
      { to: '/school-plan', label: t('Plan and data'), hint: t('Plan limits, import and export'), icon: DatabaseZap, show: can('billing', 'read') },
      { to: '/branding', label: t('School branding'), hint: t('Name, logo and colours'), icon: Palette, show: can('branding', 'manage') },
      { to: '/academic', label: t('Academic year'), hint: t('Terms and year set-up'), icon: CalendarRange, show: can('academic', 'manage') },
    ] },
  ]
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t('Settings')}</h1>
        <p className="text-sm text-muted-foreground">{t('Every setting in one place.')}</p>
      </div>
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4" />{t('Password')}</h2>
        <ChangePassword />
      </section>
      {groups.map((g) => {
        const items = g.items.filter((i) => i.show)
        return items.length === 0 ? null : (
          <section key={g.title} className="space-y-3">
            <h2 className="font-medium">{g.title}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((i) => (
                <li key={i.to}>
                  <Link to={i.to} className="flex items-start gap-3 rounded-xl border bg-card p-3 transition hover:bg-accent/50">
                    <i.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <span><span className="block text-sm font-medium">{i.label}</span><span className="block text-xs text-muted-foreground">{i.hint}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
