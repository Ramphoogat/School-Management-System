import { useState, type KeyboardEvent } from 'react'
import { Delete } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

type Op = '+' | '-' | '×' | '÷'

const compute = (a: number, b: number, op: Op) => {
  const r = op === '+' ? a + b : op === '-' ? a - b : op === '×' ? a * b : b === 0 ? NaN : a / b
  return Number.isFinite(r) ? Number(r.toFixed(10)) : NaN // trims 0.1 + 0.2 style noise
}
const show = (n: number) => (Number.isNaN(n) ? 'Cannot divide by zero' : String(n))

/** A plain four-function calculator for quick sums: fees, totals, change. No formulas are ever evaluated as text. */
export function Calculator() {
  const { t } = useT()
  const [display, setDisplay] = useState('0')
  const [acc, setAcc] = useState<number | null>(null)
  const [op, setOp] = useState<Op | null>(null)
  const [fresh, setFresh] = useState(true) // the next digit starts a new number
  const [error, setError] = useState(false)

  const value = () => Number(display)
  const reset = () => { setDisplay('0'); setAcc(null); setOp(null); setFresh(true); setError(false) }

  const digit = (d: string) => {
    if (error) return reset()
    if (fresh) { setDisplay(d); setFresh(false) }
    else if (display.replace(/[-.]/g, '').length < 15) setDisplay(display === '0' ? d : display + d)
  }
  const dot = () => {
    if (error) return reset()
    if (fresh) { setDisplay('0.'); setFresh(false) }
    else if (!display.includes('.')) setDisplay(display + '.')
  }
  const chooseOp = (next: Op) => {
    if (error) return
    if (acc !== null && op && !fresh) {
      const r = compute(acc, value(), op)
      if (Number.isNaN(r)) { setDisplay(show(r)); setError(true); setAcc(null); setOp(null); return }
      setAcc(r); setDisplay(show(r))
    } else setAcc(value())
    setOp(next); setFresh(true)
  }
  const equals = () => {
    if (error || acc === null || !op) return
    const r = compute(acc, value(), op)
    setDisplay(show(r)); setError(Number.isNaN(r)); setAcc(null); setOp(null); setFresh(true)
  }
  const percent = () => { if (!error) { setDisplay(show(compute(value(), 100, '÷'))); setFresh(true) } }
  const negate = () => { if (!error && display !== '0') setDisplay(display.startsWith('-') ? display.slice(1) : `-${display}`) }
  const back = () => {
    if (error) return reset()
    if (fresh) return
    setDisplay(display.length <= 1 || (display.length === 2 && display.startsWith('-')) ? '0' : display.slice(0, -1))
  }

  const onKey = (e: KeyboardEvent) => {
    const k = e.key
    if (/^\d$/.test(k)) digit(k)
    else if (k === '.' || k === ',') dot()
    else if (k === '+' || k === '-') chooseOp(k)
    else if (k === '*' || k === 'x') chooseOp('×')
    else if (k === '/') chooseOp('÷')
    else if (k === '%') percent()
    else if (k === 'Enter' || k === '=') equals()
    else if (k === 'Backspace') back()
    else if (k === 'Escape' || k === 'c' || k === 'C') reset()
    else return
    e.preventDefault()
  }

  const key = (label: React.ReactNode, onClick: () => void, cls = '', aria?: string) => (
    <Button type="button" variant="outline" onClick={onClick} aria-label={aria} className={`h-11 text-base ${cls}`}>{label}</Button>
  )
  const opKey = (o: Op) => key(o, () => chooseOp(o), op === o && fresh ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-primary', `Operator ${o}`)

  return (
    <div className="space-y-2 rounded-xl border bg-card p-3" role="group" aria-label={t('Calculator')} tabIndex={0} onKeyDown={onKey}>
      <div className="rounded-lg bg-muted px-3 py-2 text-right" aria-live="polite">
        <div className="h-4 truncate text-xs text-muted-foreground">{acc !== null && op ? `${acc} ${op}` : ''}</div>
        <div className={`truncate font-mono tabular-nums ${error ? 'text-sm text-destructive' : display.length > 12 ? 'text-xl' : 'text-3xl'}`}>{display}</div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {key('C', reset, 'text-destructive', 'Clear')}
        {key('±', negate, '', 'Plus or minus')}
        {key('%', percent, '', 'Percent')}
        {opKey('÷')}
        {key('7', () => digit('7'))}{key('8', () => digit('8'))}{key('9', () => digit('9'))}{opKey('×')}
        {key('4', () => digit('4'))}{key('5', () => digit('5'))}{key('6', () => digit('6'))}{opKey('-')}
        {key('1', () => digit('1'))}{key('2', () => digit('2'))}{key('3', () => digit('3'))}{opKey('+')}
        {key('0', () => digit('0'), 'col-span-1')}
        {key('.', dot, '', 'Decimal point')}
        {key(<Delete className="h-4 w-4" />, back, '', 'Backspace')}
        {key('=', equals, 'bg-primary text-primary-foreground hover:bg-primary/90', 'Equals')}
      </div>
      <p className="text-center text-[11px] text-muted-foreground">{t('Click the calculator, then type numbers and + − * / Enter')}</p>
    </div>
  )
}
