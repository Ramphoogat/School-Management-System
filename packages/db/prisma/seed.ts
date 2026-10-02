import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const ROLES: Role[] = ['student', 'parent', 'teacher', 'clerk', 'principal', 'admin']

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10)

  let school = await prisma.school.findFirst()
  if (!school) school = await prisma.school.create({ data: { name: 'Demo School' } })

  const users: Record<string, { id: string }> = {}
  for (const role of ROLES) {
    const email = `${role}@school.test`
    users[role] = await prisma.user.upsert({
      where: { schoolId_email: { schoolId: school.id, email } },
      update: {},
      create: {
        schoolId: school.id,
        email,
        name: `Demo ${role[0].toUpperCase()}${role.slice(1)}`,
        role,
        passwordHash,
      },
    })
  }

  const cls = await prisma.class.upsert({
    where: { schoolId_name: { schoolId: school.id, name: 'Grade 8-A' } },
    update: {},
    create: { schoolId: school.id, name: 'Grade 8-A' },
  })

  for (const [role, u] of [['student', users.student], ['teacher', users.teacher]] as const) {
    await prisma.classMember.upsert({
      where: { classId_userId: { classId: cls.id, userId: u.id } },
      update: {},
      create: { classId: cls.id, userId: u.id, roleInClass: role },
    })
  }

  for (const type of ['announcements', 'attendance', 'homework', 'chat', 'voice', 'resources', 'books', 'grades']) {
    await prisma.channel.upsert({
      where: { classId_type: { classId: cls.id, type } },
      update: {},
      create: { classId: cls.id, type, name: type },
    })
  }

  await prisma.parentStudentLink.upsert({
    where: { parentId_studentId: { parentId: users.parent.id, studentId: users.student.id } },
    update: {},
    create: {
      schoolId: school.id,
      parentId: users.parent.id,
      studentId: users.student.id,
      relationship: 'mother',
      status: 'approved',
      approvedById: users.principal.id,
    },
  })

  // Sample pending role requests so the approval queue is not empty.
  const existing = await prisma.roleRequest.count({ where: { schoolId: school.id } })
  if (existing === 0) {
    for (let i = 1; i <= 8; i++) {
      const u = await prisma.user.upsert({
        where: { schoolId_email: { schoolId: school.id, email: `newstaff${i}@school.test` } },
        update: {},
        create: {
          schoolId: school.id,
          email: `newstaff${i}@school.test`,
          name: `New Staff ${i}`,
          role: 'student',
          passwordHash,
        },
      })
      await prisma.roleRequest.create({
        data: {
          schoolId: school.id,
          targetUserId: u.id,
          requestedRole: i % 2 ? 'teacher' : 'clerk',
          requestedById: users.clerk.id,
          note: 'New hire',
        },
      })
    }
  }

  console.log('Seeded. Demo logins: <role>@school.test / password123')
}

main().finally(() => prisma.$disconnect())
