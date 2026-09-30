import { useT } from '@/lib/i18n'

/** Shown when the server sent only part of a long list, so nobody thinks the missing rows do not exist. */
export function CutOffNotice({ shown, total }: { shown: number; total: number }) {
  const { t } = useT()
  if (total <= shown) return null
  return (
    <p role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
      {t('Showing the first {shown} of {total}. Use the search or filters to find the rest.', { shown, total })}
    </p>
  )
}
