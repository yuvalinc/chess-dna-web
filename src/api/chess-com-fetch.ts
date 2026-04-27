/**
 * Centralized fetch wrapper for all chess.com PubAPI requests.
 *
 * Browser fetch() cannot set User-Agent or custom headers on cross-origin
 * requests without CORS approval from the server. Chess.com's PubAPI does
 * not allow custom headers, so adding them triggers preflight failures.
 *
 * Instead, the browser's default User-Agent (which identifies the browser)
 * is sent automatically. This wrapper exists as a single point of control
 * if chess.com adds header support in the future, or if the app moves to
 * a server-side proxy.
 */

export async function fetchChessCom(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(url, options);
}
