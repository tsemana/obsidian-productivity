export interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
}
export declare function fetchAuthorizedEmail(accessToken: string): Promise<string>;
/** Build the Google OAuth consent URL */
export declare function generateAuthUrl(clientId: string, redirectUri: string, email: string, state: string): string;
/** Exchange an authorization code for tokens */
export declare function exchangeCodeForTokens(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<TokenResponse>;
/** Use a refresh token to get a fresh access token */
export declare function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<TokenResponse>;
/**
 * Orchestrate the full OAuth2 authorization flow for an account.
 * Opens browser → catches callback → exchanges code → returns tokens.
 */
export declare function authorizeAccount(email: string, clientId: string, clientSecret: string): Promise<TokenResponse>;
//# sourceMappingURL=google-oauth.d.ts.map