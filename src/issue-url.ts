import * as os from 'os';

const REPO_ISSUES_NEW = 'https://github.com/ggange/telogen/issues/new';
const BUG_TEMPLATE = 'bug_report.yml';
const MAX_ERRORS_IN_BODY = 3;

/**
 * Replaces absolute file paths in an error message with their basename so the
 * pre-filled issue URL never leaks usernames or directory layouts.
 * Handles posix (/Users/x/...) and Windows (C:\x\...) paths; leaves URLs
 * (scheme://) untouched because their slashes follow "//".
 */
export function stripAbsolutePaths(message: string): string {
  return message
    // Windows drive paths: C:\dir\file or C:/dir/file. The lookbehind and
    // the double-slash lookahead keep URL schemes (https://) out.
    .replace(/(?<![\w:/])[A-Za-z]:(?![\\/]{2})[\\/][^\s'"`)\],]+/g, basenameOf)
    // posix absolute paths (at least two segments, not preceded by ':' or '/')
    .replace(/(?<![:/\w])\/(?:[^\s'"`)\],/]+\/)+[^\s'"`)\],/]*/g, basenameOf);
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
