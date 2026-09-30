import type { Response } from 'express'
import type { PrismaService } from '../prisma/prisma.module'

export const LIST_LIMIT_MIN = 100
export const LIST_LIMIT_MAX = 5000
export const LIST_LIMIT_DEFAULT = 500

/** How many rows this school's long lists may send at once (set by the school's admin). */
export async function listLimit(prisma: PrismaService, schoolId: string): Promise<number> {
  const s = await prisma.school.findUnique({ where: { id: schoolId }, select: { listLimit: true } })
  const n = s?.listLimit ?? LIST_LIMIT_DEFAULT
  return Math.min(LIST_LIMIT_MAX, Math.max(LIST_LIMIT_MIN, n))
}

/** Lists are cut off at a fixed size. This tells the browser how many rows matched, so it can say when some are hidden. */
export function setTotal(res: Response, total: number) {
  res.setHeader('X-Total-Count', String(total))
}
