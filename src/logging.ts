import { LokiTransport } from './adapters/loki.js';
import { type AppConfig, secretValues } from './core/config.js';
import { type Logger, createLogger } from './core/logger.js';

export type ServiceName = 'rag-cli' | 'rag-chat';

/**
 * The application logger: terminal lines always, plus Loki when LOKI_URL is set, with the
 * labels service, domain and env. Secrets from .env are scrubbed from both outputs.
 * Light on purpose (no model imports) so small CLIs such as feedback can use it.
 */
export function createAppLogger(config: AppConfig, service: ServiceName): Logger {
  const { env, domain } = config;
  return createLogger({
    level: env.LOG_LEVEL,
    secrets: secretValues(env),
    ...(env.LOKI_URL
      ? {
          transport: new LokiTransport({ url: env.LOKI_URL }),
          labels: { service, domain: domain.name, env: env.LOG_ENV },
        }
      : {}),
  });
}
