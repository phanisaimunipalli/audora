/**
 * Who is calling, and which organisation they act for.
 *
 * Authenticated routes take a Supabase access token as `Authorization: Bearer` (docs/BACKEND.md
 * §6). The token is verified against GoTrue itself (`GET /auth/v1/user`) rather than decoded here,
 * so key rotation, revocation and the project's own JWT settings all stay Supabase's business; the
 * server then reads the caller's organisation from `org_members` with the service-role `Db`.
 *
 * Dev escape hatch — LOCAL DEVELOPMENT ONLY. With `AUDORA_DEV_ORG=<org uuid>` in the environment,
 * a request that carries no bearer token acts as that organisation's owner, so the wizard and the
 * QA script can run against a local Supabase without a sign-in flow. It is ignored outright when
 * `NODE_ENV=production`: there, a missing token is a 401 whatever the environment says.
 *
 * Compiles under tsconfig.node.json (bundler) and tsconfig.server.json (NodeNext): relative
 * imports inside server/ carry the `.js` extension.
 */
import { DbError } from './db.js';
import type { Db } from './db.js';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface AuthUser {
  userId: string;
  email: string | null;
}

export interface OrgMembership {
  orgId: string;
  role: OrgRole;
}

/** The resolved caller of an authenticated route. `userId` is null only for the dev escape hatch. */
export interface Actor extends OrgMembership {
  userId: string | null;
  email: string | null;
  /** True when the actor came from `AUDORA_DEV_ORG` rather than a verified token. */
  dev: boolean;
}

export class AuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** The token out of an `Authorization` header, or null when there is none. */
export function bearerToken(authorization: string | undefined | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = m?.[1]?.trim();
  return token ? token : null;
}

/**
 * Verify a user's access token with Supabase Auth. The user's own token is the bearer; the `apikey`
 * is the anon key when the `Db` knows it, else the service key (GoTrue accepts either).
 */
export async function verifyUser(db: Db, bearer: string): Promise<AuthUser> {
  const token = bearerToken(bearer) ?? bearer.trim();
  if (!token) throw new AuthError(401, 'No access token');
  let r: Response;
  try {
    r = await db.fetch(`${db.url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: db.config.anonKey || db.config.serviceKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  } catch (e) {
    // GoTrue unreachable is not the caller's fault, so it must not read as a rejected token: the
    // same `DbError` the rest of the server raises for a transport failure, which routes map to 502.
    const reason = e instanceof Error ? e.message : String(e);
    const err = new DbError(502, { message: `GET /auth/v1/user: ${reason}`, code: 'FETCH_FAILED' }, 'GET', '/auth/v1/user');
    err.cause = e;
    throw err;
  }
  if (!r.ok) {
    let detail = '';
    try {
      const body = (await r.json()) as { msg?: string; message?: string; error_description?: string };
      detail = body.msg || body.message || body.error_description || '';
    } catch {
      /* no JSON body */
    }
    throw new AuthError(401, detail ? `Invalid access token: ${detail}` : 'Invalid access token');
  }
  const user = (await r.json()) as { id?: string; email?: string | null };
  if (!user.id) throw new AuthError(401, 'Invalid access token: no user id');
  return { userId: user.id, email: user.email ?? null };
}

/** The user's first organisation (oldest membership), or null when they belong to none. */
export async function memberOrg(db: Db, userId: string): Promise<OrgMembership | null> {
  const rows = await db.select<{ org_id: string; role: OrgRole }>('org_members', {
    filters: { user_id: userId },
    columns: 'org_id,role',
    order: { column: 'created_at', ascending: true },
    limit: 1,
  });
  const m = rows[0];
  return m ? { orgId: m.org_id, role: m.role } : null;
}

/** `AUDORA_DEV_ORG`, unless the process runs as production, where it is ignored. */
export function devOrg(env: Record<string, string | undefined>): string | null {
  if ((env.NODE_ENV || '').toLowerCase() === 'production') return null;
  const org = env.AUDORA_DEV_ORG?.trim();
  return org ? org : null;
}

/**
 * Resolve the caller of an authenticated route from its `Authorization` header: a verified user and
 * their organisation, or (no token, local development) the `AUDORA_DEV_ORG` owner. Throws
 * `AuthError` 401 without a usable token and 403 for a user who belongs to no organisation.
 */
export async function authenticate(db: Db, authorization: string | undefined | null, env: Record<string, string | undefined>): Promise<Actor> {
  const token = bearerToken(authorization);
  if (!token) {
    // A client that SENT an `Authorization` header and no usable token in it — an empty
    // `Bearer `, a token it just cleared — is asking to be told to sign in, not to be handed the
    // development organisation's owner. Only the absence of the header takes the dev escape hatch,
    // so the signed-out path can be tested locally at all.
    if (String(authorization ?? '').trim()) throw new AuthError(401, 'Sign in required');
    const org = devOrg(env);
    if (org) return { userId: null, email: null, orgId: org, role: 'owner', dev: true };
    throw new AuthError(401, 'Sign in required');
  }
  const user = await verifyUser(db, token);
  const membership = await memberOrg(db, user.userId);
  if (!membership) throw new AuthError(403, 'You are not a member of any organisation');
  return { ...user, ...membership, dev: false };
}

export interface CreatedOrg {
  id: string;
  name: string;
  slug: string;
}

/**
 * Create an organisation and make `userId` its owner — the first thing a new sign-up needs, and
 * what the QA script uses to get an org to point `AUDORA_DEV_ORG` at. If the membership insert
 * fails (a user id that is not in auth.users, say) the organisation row is removed again so a
 * retry with the same slug does not hit the unique index.
 */
export async function createOrgWithOwner(db: Db, name: string, slug: string, userId: string): Promise<CreatedOrg> {
  const [org] = await db.insert<CreatedOrg>('organizations', { name, slug });
  if (!org?.id) throw new Error('organizations insert returned no row');
  try {
    await db.insert('org_members', { org_id: org.id, user_id: userId, role: 'owner' });
  } catch (e) {
    await db.del('organizations', { id: org.id }).catch(() => undefined);
    throw e;
  }
  return { id: org.id, name: org.name, slug: org.slug };
}
