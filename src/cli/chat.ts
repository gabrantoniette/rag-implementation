import { createRag } from '../index.js';
import { startChatServer } from '../web/server.js';
import { flagNumber, parseArgs, runCli } from './args.js';

/**
 * npm run chat -- [--port 4317]
 * Serves the chat page on http://127.0.0.1:<port>/ (local only). The library loads on the first
 * request; without OPENROUTER_API_KEY the page runs retrieval only.
 */
runCli(async () => {
  const args = parseArgs(process.argv.slice(2));
  const port = flagNumber(args, 'port') ?? 4317;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write('Usage: npm run chat -- [--port 4317]\n');
    return 1;
  }
  const server = await startChatServer({
    createRag: () => createRag({ service: 'rag-chat' }),
    port,
  });
  process.stdout.write(`Chat page: ${server.url}\nPress Ctrl+C to stop.\n`);
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await server.close();
  return 0;
});
