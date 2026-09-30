/**
 * CSV helpers. Cells that start with = + - @ are prefixed with an apostrophe so a spreadsheet
 * never runs a name or note as a formula (CSV injection).
 */
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

/** Downloads a CSV. A byte-order mark makes Excel read accents and non-Latin names correctly. */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const blob = new Blob(['﻿', toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const stamp = () => new Date().toISOString().slice(0, 10)
