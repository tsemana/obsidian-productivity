import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import open from "open";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");
const CALLBACK_PORT_START = 8914;
const CALLBACK_PORT_END = 8924;
const AUTH_TIMEOUT_MS = 120_000;

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export async function fetchAuthorizedEmail(accessToken: string): Promise<string> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch authorized account identity (${res.status}): ${await res.text()}`);
  }

  const data = await res.json() as { email?: string; email_verified?: boolean };
  if (!data.email || data.email_verified !== true) {
    throw new Error("Authorized Google account did not return a verified email address.");
  }

  return data.email;
}

/** Build the Google OAuth consent URL */
export function generateAuthUrl(
  clientId: string,
  redirectUri: string,
  email: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
    login_hint: email,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params}`;
}

/** Exchange an authorization code for tokens */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/** Use a refresh token to get a fresh access token */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && body.includes("invalid_grant")) {
      throw new Error(
        "Refresh token has been revoked. Run account_register again to re-authorize.",
      );
    }
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/**
 * Orchestrate the full OAuth2 authorization flow for an account.
 * Opens browser → catches callback → exchanges code → returns tokens.
 */
export async function authorizeAccount(
  email: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenResponse> {
  const state = randomBytes(16).toString("hex");

  const { code, port, server } = await new Promise<{ code: string; port: number; server: import("node:http").Server }>(
    (resolve, reject) => {
      let boundPort: number;
      let resolved = false;

      const httpServer = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const authCode = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const returnedState = url.searchParams.get("state");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>");
          if (!resolved) {
            resolved = true;
            reject(new Error(`OAuth authorization failed: ${error}`));
          }
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>State mismatch</h2><p>Possible CSRF attack. Try again.</p></body></html>");
          if (!resolved) {
            resolved = true;
            reject(new Error("OAuth state mismatch — possible CSRF attack. Try again."));
          }
          return;
        }

        if (!authCode) {
          res.writeHead(400);
          res.end("Missing authorization code");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p></body></html>");

        if (!resolved) {
          resolved = true;
          resolve({ code: authCode, port: boundPort, server: httpServer });
        }
      });

      let port = CALLBACK_PORT_START;
      const tryListen = () => {
        httpServer.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && port < CALLBACK_PORT_END) {
            port++;
            tryListen();
          } else if (!resolved) {
            resolved = true;
            reject(new Error(`Cannot start OAuth callback server: ${err.message}`));
          }
        });

        httpServer.listen(port, "127.0.0.1", () => {
          boundPort = port;

          // Server is listening — open browser
          const redirectUri = `http://localhost:${boundPort}/callback`;
          const authUrl = generateAuthUrl(clientId, redirectUri, email, state);
          console.error(`Opening browser for OAuth consent (${email})...`);
          open(authUrl).catch(() => {
            console.error(`Could not open browser. Please visit:\n${authUrl}`);
          });
        });
      };
      tryListen();

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          httpServer.close();
          reject(new Error("OAuth authorization timed out after 120 seconds. Run account_register again."));
        }
      }, AUTH_TIMEOUT_MS);
    },
  );

  // Exchange code for tokens
  const redirectUri = `http://localhost:${port}/callback`;
  const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);

  // Shut down the callback server
  server.close();

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token received. This can happen if the account was previously authorized. " +
      "Revoke app access at https://myaccount.google.com/permissions and try again.",
    );
  }

  return tokens;
}
