/** Minimal argument parser: positionals plus --flag, --key value and --key=value. */
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[], booleanFlags: string[] = []): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (!booleanFlags.includes(name) && next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return { positionals, flags };
}

export const flagString = (args: ParsedArgs, name: string): string | undefined => {
  const v = args.flags[name];
  return typeof v === 'string' ? v : undefined;
};

export const flagNumber = (args: ParsedArgs, name: string): number | undefined => {
  const v = flagString(args, name);
  return v === undefined ? undefined : Number(v);
};

/** Runs a CLI main function, printing typed errors without a stack trace. */
export function runCli(main: () => Promise<number | void>): void {
  main()
    .then((code) => {
      process.exitCode = code ?? 0;
    })
    .catch((error: unknown) => {
      const e = error as Error;
      process.stderr.write(`${e.name ?? 'Error'}: ${e.message}\n`);
      if (process.env.LOG_LEVEL === 'debug' && e.stack) process.stderr.write(`${e.stack}\n`);
      process.exitCode = 1;
    });
}
