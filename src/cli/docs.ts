import { createRag } from '../index.js';
import { flagNumber, flagString, parseArgs, runCli } from './args.js';
import { countsLine } from './format.js';

const USAGE = `Usage:
  npm run docs -- create <path|url> [--id <id>] [--collection <name>] [--title <text>] [--no-visual]
  npm run docs -- get <id>
  npm run docs -- list [--collection <name>] [--format <ext>] [--title-contains <text>] [--limit n] [--offset n]
  npm run docs -- chunks <id>
  npm run docs -- update <id> [--source <path|url>] [--title <text>] [--collection <name>]
  npm run docs -- delete <id> --yes
  npm run docs -- delete-collection <name> --yes
Without --yes, delete commands only print what would be deleted.`;

const sourceOf = (value: string) =>
  /^https?:\/\//i.test(value) ? { url: value } : { path: value };

/** CRUD CLI over the configured store. Write commands print graph counts before and after. */
runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ['yes', 'no-visual', 'json']);
  const [command, target] = args.positionals;
  if (!command || command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return command ? 0 : 1;
  }
  const rag = await createRag({ llm: 'none', visual: !args.flags['no-visual'] });
  const out = (value: unknown) =>
    process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
  const writeCommand = async (fn: () => Promise<unknown>) => {
    out(`counts before: ${countsLine(await rag.store.counts())}`);
    out(await fn());
    out(`counts after:  ${countsLine(await rag.store.counts())}`);
  };
  try {
    switch (command) {
      case 'create':
        if (!target) throw new Error('create needs a path or URL');
        await writeCommand(() =>
          rag.documents.create({
            source: sourceOf(target),
            ...(flagString(args, 'id') ? { id: flagString(args, 'id')! } : {}),
            ...(flagString(args, 'collection')
              ? { collection: flagString(args, 'collection')! }
              : {}),
            ...(flagString(args, 'title') ? { title: flagString(args, 'title')! } : {}),
          }),
        );
        return 0;
      case 'get': {
        const doc = await rag.documents.get(target ?? '');
        if (!doc) {
          out(`No document with id '${target}'.`);
          return 1;
        }
        out(doc);
        return 0;
      }
      case 'list': {
        const docs = await rag.documents.list({
          ...(flagString(args, 'collection')
            ? { collection: flagString(args, 'collection')! }
            : {}),
          ...(flagString(args, 'format') ? { format: flagString(args, 'format')! } : {}),
          ...(flagString(args, 'title-contains')
            ? { titleContains: flagString(args, 'title-contains')! }
            : {}),
          limit: flagNumber(args, 'limit') ?? 50,
          offset: flagNumber(args, 'offset') ?? 0,
        });
        out(
          docs
            .map(
              (d) =>
                `${d.id}  v${d.version}  ${d.collection}  ${d.format}  ${d.updatedAt}  ${d.title}`,
            )
            .join('\n') || '(no documents)',
        );
        return 0;
      }
      case 'chunks': {
        const chunks = await rag.documents.chunks(target ?? '');
        out(
          chunks
            .map(
              (c) =>
                `${c.chunkIndex}\t${c.id.slice(0, 12)}\t${c.tokenCount} tok\t${c.section}\t${JSON.stringify(c.locator)}`,
            )
            .join('\n'),
        );
        return 0;
      }
      case 'update': {
        if (!target) throw new Error('update needs an id');
        const source = flagString(args, 'source');
        await writeCommand(() =>
          rag.documents.update(target, {
            ...(source ? { source: sourceOf(source) } : {}),
            ...(flagString(args, 'title') ? { title: flagString(args, 'title')! } : {}),
            ...(flagString(args, 'collection')
              ? { collection: flagString(args, 'collection')! }
              : {}),
          }),
        );
        return 0;
      }
      case 'delete':
        if (!target) throw new Error('delete needs an id');
        await writeCommand(() =>
          rag.documents.delete(target, { confirm: args.flags.yes === true }),
        );
        if (!args.flags.yes) out('Dry run: nothing was deleted. Add --yes to delete.');
        return 0;
      case 'delete-collection':
        if (!target) throw new Error('delete-collection needs a collection name');
        await writeCommand(() =>
          rag.documents.deleteCollection(target, { confirm: args.flags.yes === true }),
        );
        if (!args.flags.yes) out('Dry run: nothing was deleted. Add --yes to delete.');
        return 0;
      default:
        out(USAGE);
        return 1;
    }
  } finally {
    await rag.close();
  }
});
