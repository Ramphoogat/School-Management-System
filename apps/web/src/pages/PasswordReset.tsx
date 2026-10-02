import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { resolveSlug } from '@/lib/tenant'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function Frame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="app-root isolate relative flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">{children}</CardContent>
      </Card>
    </main>
  )
}

/** "I forgot my password": asks for a link by email. The answer is the same whether or not the address has an account. */
export function ForgotPassword() {
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/auth/forgot-password', { body: { email: email.trim(), school: resolveSlug() ?? undefined } })
      setSent(true)
    } catch (err) {
      toast.error((err as Error).message) // for example "Too many password reset requests. Try again in 40 minutes."
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Frame title={t('Check your email')} description={t('If that address belongs to an account, we have sent a link to choose a new password. It works once and lasts 60 minutes.')}>
        <p className="text-sm text-muted-foreground">{t('Nothing arrived? Look in your spam folder, or ask your school office to reset it for you.')}</p>
        <Button asChild variant="outline" className="w-full"><Link to="/login">{t('Back to sign in')}</Link></Button>
      </Frame>
    )
  }
  return (
    <Frame title={t('Forgot your password?')} description={t('Enter your email and we will send you a link to choose a new one.')}>
      <form onSubmit={submit} className="space-y-3">
        <Input type="email" placeholder={t('Email')} aria-label={t('Email')} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Button type="submit" className="w-full" disabled={busy || !email.trim()}>{busy ? t('Sending…') : t('Send the link')}</Button>
      </form>
      <Button asChild variant="ghost" className="w-full"><Link to="/login">{t('Back to sign in')}</Link></Button>
    </Frame>
  )
}

/** Opened from the email link. Chooses the new password, then sends the person to sign in. */
export function ResetPassword() {
  const { t } = useT()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const token = params.get('token') ?? ''
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const tooShort = pw.length < 8
  const mismatch = again.length > 0 && again !== pw

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (tooShort || pw !== again) return
    setBusy(true)
    try {
      await api('/auth/reset-password', { body: { token, newPassword: pw } })
      toast.success(t('Password changed. Sign in with your new password.'))
      nav('/login', { replace: true })
    } catch (err) {
      setFailed(true)
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!token || failed) {
    return (
      <Frame title={t('This link cannot be used')} description={t('It may have expired or been used already. Ask for a new one.')}>
        <Button asChild className="w-full"><Link to="/forgot-password">{t('Get a new link')}</Link></Button>
      </Frame>
    )
  }
  return (
    <Frame title={t('Choose a new password')} description={t('Use at least 8 characters. You will be signed out on every device.')}>
      <form onSubmit={submit} className="space-y-3">
        <Input type="password" placeholder={t('New password (8+ characters)')} aria-label={t('New password')} autoComplete="new-password" value={pw} maxLength={72} onChange={(e) => setPw(e.target.value)} required />
        <Input type="password" placeholder={t('Type it again')} aria-label={t('Type the new password again')} autoComplete="new-password" value={again} maxLength={72} onChange={(e) => setAgain(e.target.value)} required aria-invalid={mismatch} />
        {mismatch && <p role="alert" className="text-xs text-destructive">{t('The two passwords do not match.')}</p>}
        <Button type="submit" className="w-full" disabled={busy || tooShort || pw !== again}>{busy ? t('Saving…') : t('Change password')}</Button>
      </form>
    </Frame>
  )
}
