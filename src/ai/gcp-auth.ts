/**
 * GCP auth stub for web app.
 * The Chrome extension uses chrome.identity.launchWebAuthFlow for OAuth.
 * The web app version will use standard OAuth2 popup (Phase 4).
 *
 * These stubs are graceful — they return error state instead of throwing,
 * so the UI can show a helpful message instead of crashing.
 */

export async function connectGCP(
  _clientId: string,
  _projectId: string,
): Promise<void> {
  console.warn('[Chess DNA] GCP OAuth not available yet — coming in Phase 4');
  throw new Error(
    'GCP podcast generation is not yet available in the web app. This feature is coming soon!',
  );
}

export async function getGCPAccessToken(_clientId?: string): Promise<string> {
  throw new Error(
    'GCP podcast generation is not yet available in the web app. This feature is coming soon!',
  );
}

export async function revokeGCPToken(): Promise<void> {
  // no-op — nothing to revoke
}

export function hasGCPTokens(): boolean {
  return false;
}
