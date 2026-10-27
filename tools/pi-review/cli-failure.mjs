/**
 * The CLI's error report ({error, aspect, code, hint, next}) from a failed
 * command's output: its aspect and code go on the activity event, so logs
 * and the viewer say what kind of failure it was. Only the validated aspect
 * and code are kept (never message text, which may quote source).
 */
export function cliFailure(output) {
  for (const line of String(output ?? '').split('\n').reverse()) {
    if (!line.startsWith('{') || !line.includes('"error"')) continue;
    try {
      const report = JSON.parse(line);
      if (typeof report.aspect === 'string' && typeof report.code === 'string' && /^[a-z_]{1,20}$/.test(report.aspect) && /^[A-Z_]{1,40}$/.test(report.code)) return { aspect: report.aspect, code: report.code };
    } catch { /* not a report */ }
  }
  return null;
}
