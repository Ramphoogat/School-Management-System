/**
 * The wording of each notification. These are the defaults; a school's admin can override any of them (the overrides live
 * in the database). A template uses {placeholders}, and only the ones listed for that event are allowed.
 * Some events have a second, urgent wording that is used when the situation is urgent.
 */
export interface TemplateVar { name: string; help: string; sample: string }
export interface TemplateText { subject: string; body: string }
export interface TemplateDef {
  event: string
  label: string
  audience: string
  vars: TemplateVar[]
  normal: TemplateText
  /** Present when this event can be urgent. */
  urgent?: TemplateText
  /** Plain-language rule for when the urgent wording is used. */
  urgentWhen?: string
}

const v = (name: string, help: string, sample: string): TemplateVar => ({ name, help, sample })

export const TEMPLATES: TemplateDef[] = [
  {
    event: 'announcement.posted', label: 'Announcement', audience: 'Everyone the announcement is for',
    vars: [v('title', 'The announcement title', 'Sports day moved to Friday'), v('body', 'The announcement text', 'Please bring your sports kit and a water bottle.')],
    normal: { subject: '{title}', body: '{body}' },
    urgent: { subject: 'Urgent: {title}', body: '{body}' },
    urgentWhen: 'When whoever posts it marks the announcement as urgent.',
  },
  {
    event: 'homework.assigned', label: 'New homework', audience: 'Students in the class and their parents',
    vars: [v('title', 'The homework title', 'Fractions worksheet'), v('dueDate', 'When it is due', '2026-10-05')],
    normal: { subject: 'New homework: {title}', body: 'Due {dueDate}.' },
  },
  {
    event: 'attendance.marked', label: 'Absence alert', audience: 'Parents of an absent student',
    vars: [v('student', 'The student', 'Asha Rao'), v('date', 'The date', '2026-10-01')],
    normal: { subject: 'Absence alert', body: '{student} was marked absent on {date}.' },
  },
  {
    event: 'attendance.low', label: 'Low attendance', audience: 'The student and their parents',
    vars: [v('student', 'The student', 'Asha Rao'), v('percent', 'Attendance percentage', '68'), v('days', 'How many days are counted', '30'), v('threshold', 'The school threshold percentage', '75')],
    normal: { subject: 'Low attendance: {student}', body: 'Attendance over the last {days} days is {percent}%, below the school\'s {threshold}% threshold.' },
  },
  {
    event: 'leave.approved', label: 'Leave approved', audience: 'Whoever asked for the leave',
    vars: [v('student', 'Who the leave is for', 'Asha Rao'), v('dates', 'The dates', '2026-10-01 to 2026-10-02')],
    normal: { subject: 'Leave approved', body: 'Leave for {student} ({dates}) was approved.' },
  },
  {
    event: 'leave.rejected', label: 'Leave declined', audience: 'Whoever asked for the leave',
    vars: [v('student', 'Who the leave is for', 'Asha Rao'), v('dates', 'The dates', '2026-10-01 to 2026-10-02')],
    normal: { subject: 'Leave declined', body: 'Leave for {student} ({dates}) was declined.' },
  },
  {
    event: 'student.admitted', label: 'Admission confirmed', audience: 'The new student and their parent',
    vars: [v('student', 'The student', 'Asha Rao')],
    normal: { subject: 'Welcome to the school', body: '{student} has been admitted. Sign in with the details the school office gave you.' },
  },
  {
    event: 'fee.due', label: 'Fee due soon', audience: 'The student and their parents',
    vars: [v('title', 'The fee', 'Term 1 fee'), v('amount', 'Amount in rupees', '5000.00'), v('dueDate', 'Due date', '2026-10-05'), v('when', 'When, in words (tomorrow, in 3 days …)', 'in 3 days (2026-10-05)')],
    normal: { subject: 'Fee due soon', body: '{title}, Rs {amount}, is due {when}.' },
  },
  {
    event: 'fee.overdue', label: 'Fee overdue', audience: 'The student and their parents',
    vars: [v('title', 'The fee', 'Term 1 fee'), v('amount', 'Amount in rupees', '5000.00'), v('dueDate', 'Due date', '2026-09-01'), v('daysLate', 'Days overdue', '12')],
    normal: { subject: 'Fee overdue', body: '{title}, Rs {amount}, was due on {dueDate} and is {daysLate} day(s) overdue. Please pay at the school office or online.' },
    urgent: { subject: 'Urgent: fee overdue', body: '{title}, Rs {amount}, was due on {dueDate} and is now {daysLate} days overdue. Please pay as soon as you can or contact the school office.' },
    urgentWhen: 'When the fee is 30 or more days overdue.',
  },
  {
    event: 'fee.paid', label: 'Payment received', audience: 'The student and their parents',
    vars: [v('title', 'The fee', 'Term 1 fee'), v('amount', 'Amount in rupees', '5000.00')],
    normal: { subject: 'Payment received', body: 'Receipt: {title}, Rs {amount} paid. Thank you.' },
  },
  {
    event: 'fee.refunded', label: 'Fee refunded', audience: 'The student and their parents',
    vars: [v('title', 'The fee', 'Term 1 fee'), v('amount', 'Amount in rupees', '5000.00')],
    normal: { subject: 'Fee refunded', body: 'Rs {amount} of {title} has been refunded. Online refunds can take 5 to 7 working days to reach the account.' },
  },
  {
    event: 'results.submitted', label: 'Results awaiting approval', audience: 'The principal',
    vars: [v('exam', 'The exam', 'Unit Test 1')],
    normal: { subject: 'Results awaiting approval', body: '{exam} was submitted for approval.' },
  },
  {
    event: 'results.approved', label: 'Result published', audience: 'The student and their parents',
    vars: [v('exam', 'The exam', 'Unit Test 1'), v('subject', 'The subject', 'Maths'), v('score', 'The score, such as 42/50', '42/50')],
    normal: { subject: 'Result published: {subject}', body: '{exam} ({subject}): {score}.' },
  },
]

export const templateFor = (event: string) => TEMPLATES.find((t) => t.event === event)

export const SUBJECT_MAX = 150
export const BODY_MAX = 1500

const PLACEHOLDER = /\{(\w+)\}/g

/** The placeholders used in a text that this event does not offer. */
export function unknownPlaceholders(def: TemplateDef, text: string): string[] {
  const allowed = new Set(def.vars.map((x) => x.name))
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => !allowed.has(n)))]
}

/** Fill in a template. A placeholder with no value becomes empty rather than showing raw braces to a parent. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(PLACEHOLDER, (_, name: string) => String(vars[name] ?? ''))
}
