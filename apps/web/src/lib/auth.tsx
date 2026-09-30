import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { roleCan, type Role } from '@school/permissions'
import { api, tokens } from './api'
import { resolveSlug } from './tenant'

export interface Me {
  id: string
  name: string
  email: string
  role: Role
  schoolId: string
  linkedStudentIds?: string[]
  mustChangePassword?: boolean
  /** The school this person belongs to, with its branding. Null for the platform's super admin. */
  school?: { slug: string | null; name: string; tagline: string | null; brandHue: number | null; logo: string | null } | null
}

interface AuthCtx {
  user: Me | null
  loading: boolean
  /** Signs in. If a role is given, the account must have that role or the sign-in is refused. */
  login: (email: string, password: string, expectedRole?: string) => Promise<void>
  logout: () => void
  /** True after an explicit sign-out, so the next sign-in starts at Home instead of the page the last person left. */
  signedOut: boolean
  reload: () => Promise<void>
  can: (resource: string, action: string) => boolean
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(!!tokens.access)
  const [signedOut, setSignedOut] = useState(false)

  useEffect(() => {
    if (!tokens.access) return
    api<Me>('/auth/me')
      .then(setUser)
      .catch(() => tokens.clear())
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string, expectedRole?: string) => {
    const t = await api<{ accessToken: string; refreshToken: string }>('/auth/login', { body: { email, password, school: resolveSlug() ?? undefined } })
    tokens.set(t.accessToken, t.refreshToken)
    const me = await api<Me>('/auth/me')
    if (expectedRole && me.role !== expectedRole) {
      // Right password, wrong role button: do not sign them in as someone they did not choose to be.
      tokens.clear()
      throw new Error(`This account is not a ${expectedRole}. Choose the role that is yours and try again.`)
    }
    setSignedOut(false)
    setUser(me)
  }, [])

  const reload = useCallback(async () => { setUser(await api<Me>('/auth/me')) }, [])

  const logout = useCallback(() => {
    tokens.clear()
    setUser(null)
    setSignedOut(true)
  }, [])

  // UI check only hides things; the API is authoritative.
  const can = useCallback((r: string, a: string) => !!user && roleCan(user.role, r, a), [user])

  return <Ctx.Provider value={{ user, loading, login, logout, signedOut, reload, can }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
