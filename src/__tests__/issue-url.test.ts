import { describe, test, expect } from 'vitest';
import { buildIssueUrl, stripAbsolutePaths } from '../issue-url.js';

describe('stripAbsolutePaths', () => {
  test('replaces posix absolute paths with basenames', () => {
    expect(stripAbsolutePaths('failed to read /Users/jane/projects/site/app/page.tsx: EACCES'))
      .toBe('failed to read page.tsx: EACCES');
  });

  test('replaces Windows drive paths with basenames', () => {
    expect(stripAbsolutePaths('failed on C:\\Users\\jane\\site\\app\\page.tsx here'))
      .toBe('failed on page.tsx here');
  });

  test('leaves URLs untouched', () => {
    const msg = 'see https://github.com/ggange/telogen/issues for details';
    expect(stripAbsolutePaths(msg)).toBe(msg);
  });

  test('leaves single-segment route URLs like /about untouched', () => {
    expect(stripAbsolutePaths('route /about failed')).toBe('route /about failed');
  });
});

describe('buildIssueUrl', () => {
  test('includes template param, version, node and os info', () => {
    const url = buildIssueUrl('0.1.5', ['something broke']);
    expect(url).toContain('https://github.com/ggange/telogen/issues/new?');
    expect(url).toContain('template=bug_report.yml');
    const params = new URLSearchParams(url.split('?')[1]);
    const body = params.get('body')!;
    expect(body).toContain('**telogen:** v0.1.5');
    expect(body).toContain('**node:** ');
    expect(body).toContain('**os:** ');
    expect(body).toContain('something broke');
  });

  test('caps at 3 errors and reports the remainder count', () => {
    const errors = ['e1', 'e2', 'e3', 'e4', 'e5'];
    const params = new URLSearchParams(buildIssueUrl('0.1.5', errors).split('?')[1]);
    const body = params.get('body')!;
    expect(body).toContain('e1');
    expect(body).toContain('e3');
    expect(body).not.toContain('e4');
    expect(body).toContain('…and 2 more');
  });

  test('strips absolute paths from title and body', () => {
    const url = buildIssueUrl('0.1.5', ['crash in /Users/jane/secret-client/app/page.tsx']);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('title')).not.toContain('secret-client');
    expect(params.get('body')).not.toContain('secret-client');
  });
});
