import { lazy, Suspense, type ComponentType } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { useAuth } from '@/lib/auth'
import Shell from '@/components/Shell'
import Login from '@/pages/Login'
import { ForgotPassword, ResetPassword } from '@/pages/PasswordReset'
import { MessagesProvider } from '@/lib/messages'
import { useT } from '@/lib/i18n'

// Each page is its own chunk so the first screen loads fast; charts and CSV code only load when needed.
const page = <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await load())[name] as ComponentType<any> }))

const Home = page(() => import('@/pages/Home'), 'default')
const Approvals = page(() => import('@/pages/Approvals'), 'default')
const Users = page(() => import('@/pages/Simple'), 'Users')
const MessageReports = page(() => import('@/pages/MessageReports'), 'MessageReports')
const Platform = page(() => import('@/pages/Platform'), 'Platform')
const Branding = page(() => import('@/pages/Branding'), 'Branding')
const NotificationTemplates = page(() => import('@/pages/NotificationTemplates'), 'NotificationTemplates')
const AuditLog = page(() => import('@/pages/Simple'), 'AuditLog')
const ClassPage = page(() => import('@/pages/Channels'), 'ClassPage')
const Classes = page(() => import('@/pages/Manage'), 'Classes')
const ParentLinks = page(() => import('@/pages/Manage'), 'ParentLinks')
const RequestRole = page(() => import('@/pages/Manage'), 'RequestRole')
const DeliveryLog = page(() => import('@/pages/Settings'), 'DeliveryLog')
const NotificationSettings = page(() => import('@/pages/Settings'), 'NotificationSettings')
const Timetable = page(() => import('@/pages/Timetable'), 'default')
const ResultApprovals = page(() => import('@/pages/ResultApprovals'), 'default')
const ReportCard = page(() => import('@/pages/ReportCard'), 'default')
const Admissions = page(() => import('@/pages/Admissions'), 'default')
const Leave = page(() => import('@/pages/Leave'), 'default')
const Analytics = page(() => import('@/pages/Analytics'), 'default')
const ApprovalsCenter = page(() => import('@/pages/ApprovalsCenter'), 'default')
const Fees = page(() => import('@/pages/Fees'), 'default')
const Messages = page(() => import('@/pages/Messages'), 'default')
const Students = page(() => import('@/pages/Records'), 'Students')
const Waivers = page(() => import('@/pages/Records'), 'Waivers')
const Certificates = page(() => import('@/pages/Records'), 'Certificates')
const Documents = lazy(() => import('@/pages/Documents'))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'))
const SecuritySettings = lazy(() => import('@/pages/SecuritySettings'))
const McpPage = lazy(() => import('@/pages/Mcp'))
const SchoolPlan = lazy(() => import('@/pages/SchoolPlan'))
const DriveFiles = page(() => import('@/pages/DriveFiles'), 'DriveFiles')
const Cameras = page(() => import('@/pages/Cameras'), 'Cameras')
const StorageSettings = page(() => import('@/pages/Storage'), 'StorageSettings')
const Academic = lazy(() => import('@/pages/Academic'))
const IdCards = page(() => import('@/pages/IdCards'), 'IdCards')
const CertificateView = page(() => import('@/pages/Records'), 'CertificateView')

function Protected({ resource, action, any, children }: { resource?: string; action?: string; any?: [string, string][]; children: React.ReactNode }) {
  const { t } = useT()
  const { user, loading, can, signedOut } = useAuth()
  const loc = useLocation()
  if (loading) return <p className="p-6 text-muted-foreground">{t('Loading…')}</p>
  // Deep links survive login: remember where the user was going.
  // A deep link (say from a WhatsApp message) is remembered through sign-in. After an explicit sign-out it is not,
  // so the next person always starts at Home.
  if (!user) return <Navigate to="/login" replace state={signedOut ? undefined : { from: loc.pathname + loc.search }} />
  if (resource && action && !can(resource, action)) return <Navigate to="/" replace />
  if (any && !any.some(([r, a]) => can(r, a))) return <Navigate to="/" replace />
  return <>{children}</>
}

/** Home for everyone, except the super admin, whose home is the list of schools. */
function Landing() {
  const { user } = useAuth()
  return user?.role === 'superadmin' ? <Navigate to="/platform" replace /> : <Home />
}

export default function App() {
  const { t } = useT()
  return (
    <>
      <Suspense fallback={<p className="p-6 text-muted-foreground">{t('Loading…')}</p>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<Protected><MessagesProvider><Shell /></MessagesProvider></Protected>}>
            <Route path="/" element={<Landing />} />
            <Route path="/platform" element={<Protected resource="schools" action="manage"><Platform /></Protected>} />
            <Route path="/branding" element={<Protected resource="branding" action="manage"><Branding /></Protected>} />
            <Route path="/classes/:id" element={<ClassPage />} />
            <Route path="/approvals" element={<Protected resource="role_requests" action="approve"><Approvals /></Protected>} />
            <Route path="/users" element={<Protected resource="users" action="manage"><Users /></Protected>} />
            <Route path="/request-role" element={<Protected resource="role_requests" action="request"><RequestRole /></Protected>} />
            <Route path="/links" element={<Protected resource="admissions" action="write"><ParentLinks /></Protected>} />
            <Route path="/manage-links" element={<Protected resource="admissions" action="approve"><ParentLinks /></Protected>} />
            <Route path="/classes" element={<Protected><Classes /></Protected>} />
            <Route path="/result-approvals" element={<Protected resource="results" action="approve"><ResultApprovals /></Protected>} />
            <Route path="/report-card" element={<ReportCard />} />
            <Route path="/admissions" element={<Protected any={[['admissions', 'write'], ['admissions', 'approve']]}><Admissions /></Protected>} />
            <Route path="/students" element={<Protected any={[['admissions', 'write'], ['admissions', 'approve']]}><Students /></Protected>} />
            <Route path="/messages" element={<Protected resource="messages" action="write"><Messages /></Protected>} />
            <Route path="/notification-templates" element={<Protected resource="notifications" action="manage"><NotificationTemplates /></Protected>} />
            <Route path="/message-reports" element={<Protected resource="messages" action="moderate"><MessageReports /></Protected>} />
            <Route path="/fees" element={<Protected resource="fees" action="read"><Fees /></Protected>} />
            <Route path="/waivers" element={<Protected resource="fees" action="approve"><Waivers /></Protected>} />
            <Route path="/certificates" element={<Protected resource="certificates" action="read"><Certificates /></Protected>} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/mcp" element={<Protected resource="notifications" action="manage"><McpPage /></Protected>} />
            <Route path="/security-settings" element={<SecuritySettings />} />
            <Route path="/school-plan" element={<Protected resource="billing" action="read"><SchoolPlan /></Protected>} />
            <Route path="/drive" element={<Protected resource="drive" action="use"><DriveFiles /></Protected>} />
            <Route path="/cameras" element={<Protected resource="cameras" action="view"><Cameras /></Protected>} />
            <Route path="/storage" element={<Protected resource="storage" action="manage"><StorageSettings /></Protected>} />
            <Route path="/academic" element={<Protected resource="academic" action="manage"><Academic /></Protected>} />
            <Route path="/id-cards" element={<Protected resource="idcards" action="bulk_write"><IdCards /></Protected>} />
            <Route path="/certificates/:id" element={<Protected resource="certificates" action="read"><CertificateView /></Protected>} />
            <Route path="/leave" element={<Protected any={[['leave', 'request'], ['leave', 'approve'], ['leave', 'read']]}><Leave /></Protected>} />
            <Route path="/analytics" element={<Protected resource="users" action="manage"><Analytics /></Protected>} />
            <Route path="/approvals-center" element={<Protected resource="users" action="manage"><ApprovalsCenter /></Protected>} />
            <Route path="/timetable" element={<Timetable />} />
            <Route path="/settings" element={<NotificationSettings />} />
            <Route path="/delivery-log" element={<Protected resource="notifications" action="manage"><DeliveryLog /></Protected>} />
            <Route path="/audit" element={<Protected resource="audit" action="read"><AuditLog /></Protected>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
    </>
  )
}
