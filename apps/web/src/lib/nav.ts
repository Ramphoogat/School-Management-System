import { SlidersHorizontal, Bell, Building2, LayoutTemplate, Palette, ShieldAlert, MessageSquare, Award, BadgeIndianRupee, BookUser, CalendarDays, CalendarRange, ChartColumn, ClipboardCheck, FileBadge, FileCheck, FolderOpen, IdCard, GraduationCap, Inbox, Link2, Mail, Plane, ScrollText, Settings, UserPlus, UserRoundCheck, Users, type LucideIcon, DatabaseZap, HardDrive, Camera, Cloud, Landmark, BookOpen, Shield, FolderArchive } from 'lucide-react'

export interface NavItem { to: string; label: string; icon: LucideIcon; group?: string }

/** The sidebar sections: related pages are kept together under one heading that opens and closes. */
export const NAV_GROUPS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'school', label: 'School', icon: Building2 },
  { id: 'people', label: 'People', icon: Users },
  { id: 'learning', label: 'Learning', icon: BookOpen },
  { id: 'finance', label: 'Fees and records', icon: Landmark },
  { id: 'messaging', label: 'Messaging', icon: MessageSquare },
  { id: 'storage', label: 'Storage', icon: FolderArchive },
  { id: 'security', label: 'Security', icon: Shield },
]

const GROUP_OF: Record<string, string> = {
  '/analytics': 'school', '/branding': 'school', '/academic': 'school',
  '/approvals': 'people', '/approvals-center': 'people', '/request-role': 'people', '/admissions': 'people', '/students': 'people', '/users': 'people', '/links': 'people', '/manage-links': 'people',
  '/classes': 'learning', '/timetable': 'learning', '/result-approvals': 'learning', '/report-card': 'learning', '/leave': 'learning',
  '/fees': 'finance', '/waivers': 'finance', '/certificates': 'finance', '/id-cards': 'finance',
  '/messages': 'messaging', '/notifications': 'messaging', '/notification-templates': 'messaging', '/message-reports': 'messaging', '/delivery-log': 'messaging', '/settings': 'messaging',
  '/storage': 'storage', '/documents': 'storage', '/drive': 'storage', '/school-plan': 'storage',
  '/security-settings': 'security', '/mcp': 'security', '/cameras': 'security', '/audit': 'security',
}

/** The pages a user may open. Built from permissions, so users never see things they cannot use. */
export function navItems(can: (r: string, a: string) => boolean, role?: string): NavItem[] {
  // The super admin runs the platform, so that is all they are offered.
  if (role === 'superadmin') return [{ to: '/platform', label: 'Schools', icon: Building2 }]
  const staffAdm = can('admissions', 'write') || can('admissions', 'approve')
  return [
    can('role_requests', 'approve') && { to: '/approvals', label: 'Role approvals', icon: ClipboardCheck },
    can('messages', 'write') && { to: '/messages', label: 'Messages', icon: MessageSquare },
    can('branding', 'manage') && { to: '/branding', label: 'School branding', icon: Palette },
    can('notifications', 'manage') && { to: '/notification-templates', label: 'Message templates', icon: LayoutTemplate },
    can('messages', 'moderate') && { to: '/message-reports', label: 'Message reports', icon: ShieldAlert },
    { to: '/timetable', label: 'Timetable', icon: CalendarDays },
    can('users', 'manage') && { to: '/approvals-center', label: 'Approvals center', icon: Inbox },
    can('users', 'manage') && { to: '/analytics', label: 'School overview', icon: ChartColumn },
    (can('leave', 'request') || can('leave', 'approve') || can('leave', 'read')) && { to: '/leave', label: 'Leave', icon: Plane },
    staffAdm && { to: '/admissions', label: 'Admissions', icon: UserRoundCheck },
    staffAdm && { to: '/students', label: 'Students', icon: BookUser },
    can('fees', 'read') && { to: '/fees', label: 'Fees', icon: BadgeIndianRupee },
    can('fees', 'approve') && { to: '/waivers', label: 'Fee waivers', icon: FileCheck },
    can('certificates', 'read') && { to: '/certificates', label: 'Certificates', icon: FileBadge },
    can('idcards', 'bulk_write') && { to: '/id-cards', label: 'ID cards', icon: IdCard },
    can('billing', 'read') && { to: '/school-plan', label: 'Plan and data', icon: DatabaseZap },
    can('drive', 'use') && { to: '/drive', label: 'Drive files', icon: Cloud },
    can('cameras', 'view') && { to: '/cameras', label: 'School cameras', icon: Camera },
    can('storage', 'manage') && { to: '/storage', label: 'Storage', icon: HardDrive },
    can('academic', 'manage') && { to: '/academic', label: 'Academic year', icon: CalendarRange },
    { to: '/documents', label: 'Documents', icon: FolderOpen },
    can('results', 'approve') && { to: '/result-approvals', label: 'Result approvals', icon: FileCheck },
    (role === 'student' || role === 'parent') && { to: '/report-card', label: 'Report card', icon: Award },
    can('role_requests', 'request') && { to: '/request-role', label: 'Request role', icon: UserPlus },
    can('admissions', 'write') && { to: '/links', label: 'Parent links', icon: Link2 },
    !can('admissions', 'write') && can('admissions', 'approve') && { to: '/manage-links', label: 'Parent links', icon: Link2 },
    (can('classes', 'write') || role === 'teacher') && { to: '/classes', label: 'Classes', icon: GraduationCap },
    can('users', 'manage') && { to: '/users', label: 'Users', icon: Users },
    can('notifications', 'manage') && { to: '/delivery-log', label: 'Delivery log', icon: Mail },
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/security-settings', label: 'Settings', icon: SlidersHorizontal },
    { to: '/settings', label: 'Notification settings', icon: Settings },
    can('audit', 'read') && { to: '/audit', label: 'Audit log', icon: ScrollText },
  ].filter(Boolean).map((i) => ({ ...(i as NavItem), group: GROUP_OF[(i as NavItem).to] ?? 'school' }))
}
