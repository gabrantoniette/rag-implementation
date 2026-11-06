export interface PreflightState {
  lokiReady: boolean;
  grafanaHealthy: boolean;
  token: string;
  docker: boolean;
  chrome: boolean;
}

/** Why each scenario cannot run, or null when it can. The first missing need is the reason. */
export function uncovered(
  p: PreflightState,
): Record<'grafana' | 'playwright' | 'security', string | null> {
  const grafana = !p.docker
    ? 'Docker is not available (the Grafana MCP runs in a container)'
    : !p.lokiReady
      ? 'Loki is not ready at http://127.0.0.1:3100 (npm run obs:up)'
      : !p.grafanaHealthy
        ? 'Grafana is not healthy at http://127.0.0.1:3000 (npm run obs:up)'
        : !p.token
          ? 'GRAFANA_SERVICE_ACCOUNT_TOKEN is empty (npm run obs:token)'
          : null;
  return {
    grafana,
    playwright: p.chrome ? null : 'Google Chrome is not installed (npx playwright install chrome)',
    security: p.docker ? null : 'Docker is not available (cannot read the published ports)',
  };
}
