import { describe, expect, it } from 'vitest'
import { can, canManageRole, ROLES, type Actor } from './index'

const actor = (role: Actor['role'], extra: Partial<Actor> = {}): Actor => ({
  id: 'u1',
  role,
  schoolId: 's1',
  ...extra,
})

describe('permissions', () => {
  it('parent only reads linked children', () => {
    const p = actor('parent', { linkedStudentIds: ['st1'] })
    expect(can(p, 'attendance', 'read', { studentId: 'st1' })).toBe(true)
    expect(can(p, 'attendance', 'read', { studentId: 'st2' })).toBe(false)
  })
  it('teacher writes only own classes', () => {
    const t = actor('teacher', { classIds: ['c1'] })
    expect(can(t, 'attendance', 'write', { classId: 'c1' })).toBe(true)
    expect(can(t, 'attendance', 'write', { classId: 'c2' })).toBe(false)
  })
  it('only principal/admin approve role requests', () => {
    for (const r of ROLES) {
      expect(can(actor(r), 'role_requests', 'bulk_approve')).toBe(r === 'principal' || r === 'admin')
    }
  })
  it('cross-school target denied', () => {
    expect(can(actor('principal'), 'role_requests', 'approve', { schoolId: 's2' })).toBe(false)
  })
  it('role grant guardrails', () => {
    expect(canManageRole(actor('principal'), 'x', 'admin')).toBe(false)
    expect(canManageRole(actor('principal'), 'x', 'teacher')).toBe(true)
    expect(canManageRole(actor('admin'), 'x', 'principal')).toBe(true)
    expect(canManageRole(actor('admin'), 'u1', 'teacher')).toBe(false)
  })
})
