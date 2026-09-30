import type { PrismaService } from '../prisma/prisma.module'

export interface Band { minPercent: number; grade: string }

/** Used until a school sets its own scale. */
export const DEFAULT_BANDS: Band[] = [
  { minPercent: 90, grade: 'A+' }, { minPercent: 80, grade: 'A' }, { minPercent: 70, grade: 'B' },
  { minPercent: 60, grade: 'C' }, { minPercent: 50, grade: 'D' }, { minPercent: 40, grade: 'E' }, { minPercent: 0, grade: 'F' },
]

export async function loadBands(prisma: PrismaService, schoolId: string): Promise<Band[]> {
  const rows = await prisma.gradeBand.findMany({ where: { schoolId }, orderBy: { minPercent: 'desc' }, select: { minPercent: true, grade: true } })
  return rows.length ? rows : DEFAULT_BANDS
}

/** The grade for a percentage: the highest band whose minimum it reaches. Bands must be sorted high to low. */
export const gradeFrom = (bands: Band[], pct: number) => (bands.find((b) => pct >= b.minPercent) ?? bands[bands.length - 1]).grade
