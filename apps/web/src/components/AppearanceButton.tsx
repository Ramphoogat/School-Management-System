import { useState } from 'react'
import { Palette } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { AppearanceDialog } from '@/components/AppearanceDialog'
import { Button } from '@/components/ui/button'

/** The same Appearance button and dialog as the signed-in sidebar, for pages outside the app shell (sign-in). */
export function AppearanceButton() {
  const [open, setOpen] = useState(false)
  const { t } = useT()
  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} title={t('Appearance')} aria-label={t('Appearance')}>
        <Palette className="h-4 w-4" />
      </Button>
      <AppearanceDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
