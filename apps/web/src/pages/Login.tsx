import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { SCHOOL_ROLES } from '@school/permissions'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { forgetSlug, logoSrc, useTenant } from '@/lib/tenant'
import { AppearanceButton } from '@/components/AppearanceButton'
import { LanguagePicker } from '@/components/LanguagePicker'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Every school role, in the order people expect. The platform's super admin is deliberately not here.
const ROLE_ORDER = ['student', 'parent', 'teacher', 'clerk', 'principal', 'admin']
const ROLES = ROLE_ORDER.filter((r) => (SCHOOL_ROLES as string[]).includes(r))

export default function Login() {
  const { user, login } = useAuth()
  const tenant = useTenant()
  const { t } = useT()
  const nav = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [role, setRole] = useState<string | null>(null)

  if (user) return <Navigate to={from} replace />

  // An address for a school that does not exist or is switched off.
  if (tenant.state === 'missing') {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle role="heading" aria-level={1}>{t('School not available')}</CardTitle><CardDescription>{t('This school address is not in use, or the school is not active right now. Check the link you were given.')}</CardDescription></CardHeader>
          <CardContent><Button variant="outline" onClick={() => { forgetSlug(); window.location.assign(window.location.pathname) }}>{t('Go to the general sign-in')}</Button></CardContent>
        </Card>
      </div>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // On a school's own page the role is part of signing in. The general page also serves the platform's super admin, who has no role button.
    if (!role && tenant.state !== 'none') return toast.error(t('Choose your role first'))
    setBusy(true)
    try {
      await login(email, password, role ?? undefined)
      nav(from, { replace: true })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-root isolate relative flex min-h-dvh items-center justify-center p-4">
      <div className="wallpaper-layer" aria-hidden />
      <div className="absolute right-4 top-4 flex items-center gap-1"><LanguagePicker /><AppearanceButton /></div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          {tenant.brand?.logo && <img src={logoSrc(tenant.brand)!} alt="" className="mb-2 h-12 w-12 rounded-lg object-contain" />}
          <CardTitle role="heading" aria-level={1}>{tenant.brand?.name ?? t('School Platform')}</CardTitle>
          <CardDescription>{tenant.brand?.tagline ?? t('Sign in to your workspace')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-y-1.5">
            <p className="text-sm font-medium" id="role-label">{t('I am a')}</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="role-label">
              {ROLES.map((r) => (
                <Button
                  key={r} type="button" size="sm" role="radio" aria-checked={role === r}
                  variant={role === r ? 'default' : 'outline'} className="capitalize"
                  onClick={() => {
                    setRole(r)
                    // Handy while developing: fill in that role's demo account. Never on a real school's page.
                    if (tenant.state === 'none' && import.meta.env.DEV) { setEmail(`${r}@school.test`); setPassword('password123') }
                  }}
                >
                  {t(r)}
                </Button>
              ))}
            </div>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <Input type="email" placeholder={t('Email')} aria-label={t('Email')} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder={t('Password')}
                aria-label={t('Password')}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? t('Hide password') : t('Show password')}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t('Signing in…') : t('Sign in')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
