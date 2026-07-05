import * as os from 'os';

const REPO_ISSUES_NEW = 'https://github.com/ggange/telogen/issues/new';
const BUG_TEMPLATE = 'bug_report.yml';
const MAX_ERRORS_IN_BODY = 3;

/**
 * Replaces absolute file paths in an error message with their basename so the
 * pre-filled issue URL never leaks usernames or directory layouts.
 *
 * Order matters: the home directory is erased first (it can contain spaces —
 * "C:\Users\Jane Doe" — which no token regex can catch), then quoted paths
 * (fs errors quote them, spaces allowed inside quotes), then UNC, drive, and
 * posix tokens. Relative specifiers ('./components/Button') and short route
 * URLs ('/blog/post') are deliberately left alone — they carry no user info
 * and stripping them destroys the report's usefulness.
 */
export function stripAbsolutePaths(message: string): string {
  let out = message;

  // Home directory → '~', both slash flavors, before any token matching.
  const home = os.homedir();
  if (home && home !== '/' && home !== '\\') {
    out = out.split(home).join('~');
    const altHome = home.includes('\\') ? home.replace(/\\/g, '/') : home.replace(/\//g, '\\');
    out = out.split(altHome).join('~');
  }

  return out
    // Quoted paths (≥2 separators): spaces are allowed inside the quotes
    .replace(/(["'])((?:[A-Za-z]:|~|\\\\)?[\\/][^"'\n]*[\\/][^"'\n]*)\1/g, (_m, q, p) => q + basenameOf(p) + q)
    // UNC paths: \\server\share\...
    .replace(/\\{2}[^\s'"`)\],]+/g, basenameOf)
    // Windows drive paths: C:\dir\file or C:/dir/file. The lookbehind and
    // the double-slash lookahead keep URL schemes (https://) out.
    .replace(/(?<![\w:/])[A-Za-z]:(?![\\/]{2})[\\/][^\s'"`)\],]+/g, basenameOf)
    // posix absolute paths, three or more segments. Two-segment tokens are
    // skipped on purpose: '/blog/post' is far more likely a route than a
    // sensitive path, and the home-directory pass above already removed the
    // part that could identify a user. The '.' in the lookbehind keeps
    // relative specifiers ('./x/y', '../x/y') intact.
    .replace(/(?<![:/\w.])\/(?:[^\s'"`)\],/]+\/){2,}[^\s'"`)\],/]*/g, basenameOf);
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * Builds the pre-filled GitHub issue URL printed after crashes. Body carries
 * environment info plus at most MAX_ERRORS_IN_BODY error messages (paths
 * stripped) — GitHub rejects URLs past ~8KB.
 */
export function buildIssueUrl(version: string, errors: string[]): string {
  const shown = errors.slice(0, MAX_ERRORS_IN_BODY).map(stripAbsolutePaths);
  const more = errors.length - shown.length;

  const bodyLines = [
    `**telogen:** v${version}`,
    `**node:** ${process.version}`,
    `**os:** ${os.platform()} ${os.release()}`,
    '',
    '**Errors:**',
    ...shown.map(e => '```\n' + e + '\n```'),
    ...(more > 0 ? [`…and ${more} more`] : []),
  ];

  const params = new URLSearchParams({
    template: BUG_TEMPLATE,
    title: `crash: ${stripAbsolutePaths(errors[0] ?? 'unknown error').slice(0, 80)}`,
    body: bodyLines.join('\n'),
  });

  return `${REPO_ISSUES_NEW}?${params.toString()}`;
}
