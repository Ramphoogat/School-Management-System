import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

export function BulkSelectionBar({
  count,
  onClear,
  children,
}: {
  count: number
  onClear: () => void
  children: ReactNode
}) {
  const { t } = useT()
  if (count === 0) return null
  return (
    <div className="sticky bottom-4 z-10 mx-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-lg border bg-background px-4 py-2 shadow-lg">
      <span className="text-sm font-medium">{t('{count} selected', { count })}</span>
      {children}
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t('Clear')}</Button>
    </div>
  )
}
