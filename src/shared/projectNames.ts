export type ProjectNameValidation = { ok: true; name: string } | { ok: false; key: 'projectNameInvalid' }

export function validateProjectName(value: string): ProjectNameValidation {
  if (typeof value !== 'string') return { ok: false, key: 'projectNameInvalid' }
  const name = value.trim()
  if (!name || name.length > 60 || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(value)
    || /[. ]$/.test(value) || name.endsWith('.') || name === '.' || name === '..'
    || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) {
    return { ok: false, key: 'projectNameInvalid' }
  }
  return { ok: true, name }
}
