export const ROLES = ['student', 'parent', 'teacher', 'clerk', 'principal', 'admin', 'superadmin'] as const
export type Role = (typeof ROLES)[number]

/** The roles that belong to a school. The super admin runs the platform and is not one of them. */
export const SCHOOL_ROLES = ROLES.filter((r) => r !== 'superadmin') as Exclude<Role, 'superadmin'>[]

export const SCOPES = ['own', 'own_child', 'own_class', 'school'] as const
export type Scope = (typeof SCOPES)[number]

/** permission = resource:action:scope */
export type Permission = `${string}:${string}:${Scope}`

export const PERMISSIONS: Record<Role, Permission[]> = {
  student: [
    'announcements:read:own_class', 'attendance:read:own', 'homework:read:own_class', 'homework:submit:own', 'resources:read:own_class',
    'results:read:own', 'fees:read:own', 'certificates:read:own', 'timetable:read:own', 'leave:request:own',
    'chat:write:own_class', 'voice:join:own_class', 'messages:write:own_class',
  ],
  parent: [
    'announcements:read:own_child', 'attendance:read:own_child', 'homework:read:own_child',
    'results:read:own_child', 'fees:read:own_child', 'fees:pay:own_child', 'certificates:read:own_child',
    'timetable:read:own_child', 'leave:request:own_child', 'messages:write:own_child', 'resources:read:own_child',
  ],
  teacher: [
    'announcements:write:own_class', 'attendance:write:own_class', 'attendance:bulk_write:own_class',
    'homework:write:own_class', 'homework:bulk_write:own_class', 'results:write:own_class',
    'results:bulk_write:own_class', 'timetable:read:own', 'leave:request:own',
    'chat:write:own_class', 'voice:join:own_class', 'voice:manage:own_class', 'messages:write:own_class', 'role_requests:request:school', 'timetable:read:own_class', 'resources:write:own_class',
  ],
  clerk: [
    'announcements:write:school', 'attendance:read:school', 'results:read:school',
    'fees:read:school', 'fees:write:school', 'fees:bulk_write:school', 'admissions:write:school',
    'admissions:bulk_write:school', 'timetable:read:school', 'leave:request:own',
    'role_requests:request:school', 'certificates:bulk_write:school', 'certificates:read:school', 'idcards:bulk_write:school', 'documents:write:school', 'resources:read:school', 'voice:join:school', 'voice:manage:school', 'messages:write:school',
  ],
  principal: [
    'announcements:write:school', 'attendance:read:school', 'homework:read:school',
    'results:read:school', 'results:approve:school', 'results:bulk_approve:school', 'fees:read:school', 'certificates:read:school', 'fees:approve:school',
    'fees:bulk_approve:school', 'fees:refund:school', 'admissions:approve:school', 'admissions:bulk_approve:school',
    'timetable:write:school', 'chat:write:school', 'voice:join:school', 'voice:manage:school', 'messages:write:school', 'messages:moderate:school', 'leave:approve:school', 'leave:bulk_approve:school',
    'users:manage:school', 'users:bulk_manage:school', 'role_requests:approve:school',
    'role_requests:bulk_approve:school', 'audit:read:school', 'classes:write:school', 'resources:read:school', 'academic:manage:school', 'documents:write:school', 'billing:read:school',
  ],
  admin: [
    'announcements:manage:school', 'attendance:read:school', 'homework:read:school',
    'results:read:school', 'fees:read:school', 'fees:refund:school', 'admissions:write:school',
    'admissions:approve:school', 'admissions:bulk_approve:school', 'timetable:write:school',
    'leave:read:school', 'users:manage:school', 'users:bulk_manage:school',
    'role_requests:approve:school', 'role_requests:bulk_approve:school',
    'audit:read:school', 'classes:write:school', 'messages:moderate:school', 'branding:manage:school', 'notifications:manage:school', 'voice:join:school', 'voice:manage:school', 'resources:read:school', 'academic:manage:school', 'documents:write:school', 'billing:read:school', 'school:export:school',
  ],
  // Runs the platform: creates and suspends schools. It has no access to any school's own data.
  superadmin: ['schools:manage:school'],
}

export interface Actor {
  id: string
  role: Role
  schoolId: string
  linkedStudentIds?: string[]
  classIds?: string[]
}

export interface Target {
  schoolId?: string
  studentId?: string
  classId?: string
}

export function hasPermission(role: Role, resource: string, action: string): Scope[] {
  const prefix = `${resource}:${action}:`
  return PERMISSIONS[role]
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length) as Scope)
}

export function inScope(actor: Actor, target: Target, scope: Scope): boolean {
  switch (scope) {
    case 'own':
      return !!target.studentId && target.studentId === actor.id
    case 'own_child':
      return !!target.studentId && (actor.linkedStudentIds ?? []).includes(target.studentId)
    case 'own_class':
      return !!target.classId && (actor.classIds ?? []).includes(target.classId)
    case 'school':
      return !!target.schoolId && target.schoolId === actor.schoolId
  }
}

/** allowed = hasPermission(role, resource, action) AND inScope(actor, target, scope) */
export function can(actor: Actor, resource: string, action: string, target: Target = {}): boolean {
  const scopes = hasPermission(actor.role, resource, action)
  return scopes.some((s) => inScope(actor, { schoolId: actor.schoolId, ...target }, s))
}

/** Target-independent check, for hiding UI the role can never use. */
export function roleCan(role: Role, resource: string, action: string): boolean {
  return hasPermission(role, resource, action).length > 0
}

/** Roles an actor may grant or revoke. Nobody edits their own role. */
export const GRANTABLE_ROLES: Partial<Record<Role, Role[]>> = {
  admin: [...SCHOOL_ROLES],
  principal: ['student', 'parent', 'teacher', 'clerk'],
}

export function canManageRole(
  actor: Pick<Actor, 'id' | 'role'>,
  targetUserId: string,
  targetRole: Role,
): boolean {
  if (actor.id === targetUserId) return false
  return (GRANTABLE_ROLES[actor.role] ?? []).includes(targetRole)
}
