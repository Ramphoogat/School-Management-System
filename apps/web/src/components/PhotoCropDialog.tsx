import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const VIEW_W = 240, VIEW_H = 300 // the crop window on screen, 4 wide by 5 tall like an ID photo
const OUT_W = 400, OUT_H = 500 // what is sent: small enough to stay well under the 1 MB limit

/**
 * Crop a chosen picture to an ID-photo shape before it is uploaded: drag to move it, slide to zoom. The result is a
 * 400 x 500 JPEG made in the browser, so the server only ever stores something small and the right shape.
 */
export function PhotoCropDialog({ file, name, onCancel, onSave }: { file: File | null; name: string; onCancel: () => void; onSave: (jpeg: File) => Promise<void> | void }) {
  const { t } = useT()
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 }) // top-left of the picture inside the window, in window pixels
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    setImg(null); setError(''); setZoom(1)
    if (!file) return
    const url = URL.createObjectURL(file)
    const el = new Image()
    el.onload = () => {
      setImg(el)
      const s = Math.max(VIEW_W / el.width, VIEW_H / el.height)
      setPos({ x: (VIEW_W - el.width * s) / 2, y: (VIEW_H - el.height * s) / 2 }) // centred to start
    }
    el.onerror = () => setError('That file could not be read as a picture.')
    el.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const base = img ? Math.max(VIEW_W / img.width, VIEW_H / img.height) : 1 // the scale that just fills the window
  const scale = base * zoom
  const clamp = (x: number, y: number) => img
    ? { x: Math.min(0, Math.max(VIEW_W - img.width * scale, x)), y: Math.min(0, Math.max(VIEW_H - img.height * scale, y)) }
    : { x, y }

  useEffect(() => {
    const c = canvas.current
    if (!c || !img) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    const p = clamp(pos.x, pos.y)
    ctx.drawImage(img, p.x, p.y, img.width * scale, img.height * scale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, pos, scale])

  const changeZoom = (z: number) => {
    if (!img) return
    // Zoom about the middle of the window, so the face stays put.
    const ratio = z / zoom
    const cx = VIEW_W / 2, cy = VIEW_H / 2
    const nx = cx - (cx - pos.x) * ratio, ny = cy - (cy - pos.y) * ratio
    setZoom(z)
    const s = base * z
    setPos({ x: Math.min(0, Math.max(VIEW_W - img.width * s, nx)), y: Math.min(0, Math.max(VIEW_H - img.height * s, ny)) })
  }

  const save = async () => {
    if (!img) return
    setBusy(true)
    try {
      const out = document.createElement('canvas')
      out.width = OUT_W; out.height = OUT_H
      const ctx = out.getContext('2d')!
      const k = OUT_W / VIEW_W
      const p = clamp(pos.x, pos.y)
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, OUT_W, OUT_H)
      ctx.drawImage(img, p.x * k, p.y * k, img.width * scale * k, img.height * scale * k)
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/jpeg', 0.85))
      if (!blob) throw new Error('Could not prepare the photo')
      await onSave(new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Photo for {name}', { name })}</DialogTitle>
          <DialogDescription>{t('Drag to position the face inside the frame, and use the slider to zoom.')}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : !img ? <p className="text-sm text-muted-foreground">{t('Loading…')}</p> : (
          <div className="space-y-3">
            <canvas
              ref={canvas} width={VIEW_W} height={VIEW_H}
              className="mx-auto block cursor-grab touch-none rounded-lg border bg-white active:cursor-grabbing"
              style={{ width: VIEW_W, height: VIEW_H }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y } }}
              onPointerMove={(e) => { const d = drag.current; if (d) setPos(clamp(d.ox + e.clientX - d.px, d.oy + e.clientY - d.py)) }}
              onPointerUp={() => { drag.current = null }}
              aria-label={t('Photo preview. Drag to move it.')}
            />
            <label className="flex items-center gap-3 text-sm">{t('Zoom')}<input type="range" aria-label={t('Zoom')} min={1} max={3} step={0.01} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} className="flex-1 accent-primary" />
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>{t('Cancel')}</Button>
          <Button onClick={save} disabled={busy || !img}>{busy ? 'Saving…' : 'Save photo'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
