import { GetCurrentAuthUserResponse } from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import * as oidc from "openid-client";
import { clearSession, createSession, getOidcConfig, getSessionId, SESSION_COOKIE, SESSION_TTL, type SessionData } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const OIDC_COOKIE_TTL = 10 * 60 * 1000;

function origin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function safeReturnTo(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function setSecureCookie(res: Response, name: string, value: string, maxAge: number): void {
  res.cookie(name, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge });
}

async function upsertUser(claims: Record<string, unknown>) {
  const userData = {
    id: String(claims.sub),
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as string | null,
  };
  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({ target: usersTable.id, set: { ...userData, updatedAt: new Date() } })
    .returning();
  return user;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(GetCurrentAuthUserResponse.parse({ user: req.isAuthenticated() ? req.user : null }));
});

router.get("/login", async (req: Request, res: Response): Promise<void> => {
  const config = await getOidcConfig();
  const callbackUrl = `${origin(req)}/api/callback`;
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });
  setSecureCookie(res, "code_verifier", verifier, OIDC_COOKIE_TTL);
  setSecureCookie(res, "nonce", nonce, OIDC_COOKIE_TTL);
  setSecureCookie(res, "state", state, OIDC_COOKIE_TTL);
  setSecureCookie(res, "return_to", safeReturnTo(req.query.returnTo), OIDC_COOKIE_TTL);
  res.redirect(redirectTo.href);
});

router.get("/callback", async (req: Request, res: Response): Promise<void> => {
  const config = await getOidcConfig();
  const callbackUrl = `${origin(req)}/api/callback`;
  const verifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;
  if (!verifier || !expectedState) {
    logger.warn({ hasVerifier: !!verifier, hasState: !!expectedState }, "Sign-in callback is missing browser state");
    res.redirect("/api/login");
    return;
  }

  // req.url is relative to the router and omits /api. The token exchange must
  // use the exact redirect URI sent when starting authorization.
  const currentUrl = new URL(callbackUrl);
  currentUrl.search = new URL(req.url, origin(req)).search;
  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: verifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch (error) {
    logger.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Sign-in code exchange failed");
    res.redirect("/api/login");
    return;
  }

  const claims = tokens.claims();
  if (!claims?.sub) {
    res.redirect("/api/login");
    return;
  }
  const returnTo = safeReturnTo(req.cookies?.return_to);
  for (const name of ["code_verifier", "nonce", "state", "return_to"]) res.clearCookie(name, { path: "/" });
  const user = await upsertUser(claims as unknown as Record<string, unknown>);
  const now = Math.floor(Date.now() / 1000);
  const session: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };
  const sid = await createSession(session);
  setSecureCookie(res, SESSION_COOKIE, sid, SESSION_TTL);
  res.redirect(returnTo);
});

router.get("/logout", async (req: Request, res: Response): Promise<void> => {
  const config = await getOidcConfig();
  const siteOrigin = origin(req);
  const returnTo = safeReturnTo(req.query.returnTo);
  const sid = getSessionId(req);
  await clearSession(res, sid);
  const url = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: new URL(returnTo, `${siteOrigin}/`).href,
  });
  res.redirect(url.href);
});

export default router;
