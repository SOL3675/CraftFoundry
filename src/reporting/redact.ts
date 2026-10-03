const secretKey = /token|password|passwd|secret|authorization|accesskey|credential|sessionid/i;

export function redactText(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[^\s"',;]+/gi, '$1[REDACTED]')
    .replace(/((?:token|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|session[_-]?id)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@');
}

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[REDACTED]' : redact(item)]));
  }
  return value;
}
