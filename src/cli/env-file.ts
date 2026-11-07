/**
 * Sets KEY=value in the text of a .env file: replaces the existing KEY= line, or appends one.
 * Every other line stays exactly as it was.
 */
export function upsertEnvLine(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, () => line);
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
}
