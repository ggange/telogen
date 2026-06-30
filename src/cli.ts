import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { detectRoutes } from './router.js';
import { extractContent } from './visitor.js';
import { renderLlmsTxt, urlToTitle, type LlmsTxtEntry } from './llmstxt.js';
import { scanForAnnotations, renderAnnotationGuide } from './annotation-guide.js';

export interface CliFlags {
  out: string;
  skipDynamic: boolean;
  skipComponents: string[];
  help: boolean;
}

export function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = { out: 'public', skipDynamic: false, skipComponents: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) flags.out = argv[++i];
    else if (argv[i] === '--skip-dynamic') flags.skipDynamic = true;
    else if (argv[i] === '--skip-components' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      flags.skipComponents = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    }
    else if (argv[i] === '--help' || argv[i] === '-h') flags.help = true;
  }
  return flags;
}

export async function run(projectRoot: string, argv: string[]): Promise<void> {
  const flags = parseArgs(argv);

  if (flags.help) {
    console.log(`
agentify — generate AI-readable markdown from your Next.js source

Usage: npx agentify-cli [options]

Options:
  --out <dir>              Output directory (default: public)
  --skip-dynamic           Omit dynamic content placeholders
  --skip-components <list> Comma-separated JSX element names to exclude (e.g. NavBar,Sidebar)
  --help                   Show this help
`);
    return;
  }

  const { routes, skipped, router } = await detectRoutes(projectRoot);

  if (router === 'none') {
    throw new Error('no Next.js project found (missing app/ or pages/ directory)');
  }

  if (skipped.length > 0) {
    for (const f of skipped) {
      console.warn(`agentify: skipped dynamic route: ${path.relative(projectRoot, f)}`);
    }
  }

  if (routes.length === 0) {
    throw new Error('no static routes found — nothing to generate');
  }

  const outDir = path.resolve(projectRoot, flags.out);
  await fs.mkdir(outDir, { recursive: true });

  const skipSet = new Set(flags.skipComponents);

  // Process all routes in parallel
  const results = await Promise.all(
    routes.map(async (route) => {
      const content = await extractContent(route.filePath, skipSet.size > 0 ? skipSet : undefined);
      return { route, content };
    })
  );

  // Write .md files
  const llmsTxtEntries: LlmsTxtEntry[] = [];

  for (const { route, content } of results) {
    const mdFilename = route.url === '/' ? 'index.md' : `${route.url.slice(1)}.md`;
    const mdPath = path.join(outDir, mdFilename);
    await fs.mkdir(path.dirname(mdPath), { recursive: true });

    const md = renderMarkdown(content, route.url, flags.skipDynamic);
    await fs.writeFile(mdPath, md, 'utf-8');

    llmsTxtEntries.push({
      title: content.title ?? urlToTitle(route.url),
      mdUrl: `/${mdFilename}`,
      description: content.description,
      hasDynamicMetadata: content.hasDynamicMetadata,
    });
  }

  // Write llms.txt
  const llmsTxt = renderLlmsTxt(path.basename(projectRoot), llmsTxtEntries);
  await fs.writeFile(path.join(outDir, 'llms.txt'), llmsTxt, 'utf-8');

  console.log(
    `agentify: generated ${results.length} pages + llms.txt → ${path.relative(projectRoot, outDir)}/`
  );

  // Write ai-annotation-guide.md
  const annotations = await scanForAnnotations(projectRoot);
  const guide = renderAnnotationGuide(annotations);
  await fs.writeFile(path.join(projectRoot, 'ai-annotation-guide.md'), guide, 'utf-8');
  console.log('agentify: annotation guide → ai-annotation-guide.md');
}

function renderMarkdown(
  content: Awaited<ReturnType<typeof extractContent>>,
  url: string,
  skipDynamic: boolean
): string {
  const lines: string[] = [];

  if (content.title) lines.push(`# ${content.title}`, '');
  if (content.description) lines.push(content.description, '');

  if (content.isDynamic && !skipDynamic) {
    lines.push(`<!-- dynamic content — available at runtime via ${url} -->`);
  }

  for (const block of content.blocks) {
    if (block.type === 'heading' && block.level) {
      lines.push('#'.repeat(block.level) + ' ' + block.text, '');
    } else if (block.type === 'listitem') {
      lines.push('- ' + block.text);
    } else {
      lines.push(block.text, '');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

// Auto-execute only when run as the main script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.cwd(), process.argv.slice(2)).catch((err) => {
    console.error('agentify:', err.message);
    process.exit(1);
  });
}
