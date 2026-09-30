// Calling codes, longest first so "+971" is not read as "+9". Covers the common school-community countries.
const CODES = [
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '52', '54', '55', '56', '57', '58',
  '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
  '212', '234', '254', '255', '256', '351', '353', '358', '380', '852', '880', '960', '961', '962', '965', '966', '968', '971', '972', '973', '974', '975', '977',
].sort((a, b) => b.length - a.length)

/** Splits "+91 98765 43210" into { code: "+91", number: "9876543210" }. Numbers without a "+" keep an empty code. */
export function splitPhone(raw?: string | null): { code: string; number: string } {
  const p = (raw ?? '').trim()
  if (!p) return { code: '', number: '' }
  const digits = p.replace(/[^\d]/g, '')
  if (!p.startsWith('+')) return { code: '', number: digits }
  const code = CODES.find((c) => digits.startsWith(c))
  return code ? { code: `+${code}`, number: digits.slice(code.length) } : { code: '', number: digits }
}
