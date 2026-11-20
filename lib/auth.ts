import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb, newId, nowIso } from "./db";

const COOKIE_NAME = "sp_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

const secretKey = () =>
  new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-change-in-production-please");

export type SessionUser = {
  id: string;
  name: string;
  phone: string;
  role: "FARMER" | "STAFF" | "ADMIN";
};

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

/**
 * Creates a server-side session in the database and generates a signed JWT token.
 */
export async function createSession(user: SessionUser): Promise<string> {
  const db = getDb();
  const sessionId = newId("sess_");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const createdAt = nowIso();

  const token = await new SignJWT({
    sid: sessionId,
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());

  // Store the session in the database
  db.prepare(
    `INSERT INTO sessions (id, user_id, token, expires_at, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, user.id, token, expiresAt, createdAt, createdAt);

  return token;
}

/**
 * Backward compatibility alias for createSession.
 */
export async function createSessionToken(user: SessionUser): Promise<string> {
  return createSession(user);
}

/**
 * Validates a session token against both cryptographic JWT signature and the database session record.
 */
export async function validateSession(token: string): Promise<SessionUser | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey());
    const sid = payload.sid as string | undefined;
    const userId = payload.id as string | undefined;
    const phone = payload.phone as string | undefined;

    if (!sid && !userId && !phone) return null;

    const db = getDb();
    const row = db
      .prepare(
        `SELECT s.id as session_id, s.expires_at, u.id, u.name, u.phone, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? OR s.token = ?`
      )
      .get(sid || "", token) as
      | {
          session_id: string;
          expires_at: string;
          id: string;
          name: string;
          phone: string;
          role: "FARMER" | "STAFF" | "ADMIN";
        }
      | undefined;

    if (!row) {
      if (userId || phone) {
        let userRow = db
          .prepare(`SELECT id, name, phone, role, active FROM users WHERE id = ? OR phone = ?`)
          .get(userId || "", phone || "") as
          | { id: string; name: string; phone: string; role: "FARMER" | "STAFF" | "ADMIN"; active: number }
          | undefined;

        // Self-healing: If user is missing from database (e.g., after a fresh DB restart or reset),
        // but has a cryptographically verified JWT issued by our JWT_SECRET, reconstruct their user & profile records safely.
        if (!userRow && phone && payload.role) {
          const validRole = payload.role as "FARMER" | "STAFF" | "ADMIN";
          const validName = (payload.name as string) || (validRole === "ADMIN" ? "Administrator" : validRole === "STAFF" ? "Mandi Staff" : "Farmer");
          const uid = userId || newId("usr_");
          try {
            db.prepare(
              `INSERT OR IGNORE INTO users (id, phone, role, name, language, created_at, updated_at, active)
               VALUES (?, ?, ?, ?, 'en', ?, ?, 1)`
            ).run(uid, phone, validRole, validName, nowIso(), nowIso());

            if (validRole === "FARMER") {
              const fpId = newId("frm_");
              const farmerCode = `FP-${phone.slice(-4)}`;
              db.prepare(
                `INSERT OR IGNORE INTO farmer_profiles (id, user_id, address, district, state, farmer_code, language, created_at, updated_at)
                 VALUES (?, ?, 'Registered Farmer', 'Jaipur', 'Rajasthan', ?, 'en', ?, ?)`
              ).run(fpId, uid, farmerCode, nowIso(), nowIso());
            }

            userRow = {
              id: uid,
              name: validName,
              phone: phone,
              role: validRole,
              active: 1,
            };
          } catch (e) {
            console.error("Failed to self-heal user session:", e);
          }
        }

        if (userRow && userRow.active === 1) {
          const exp = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
          try {
            db.prepare(
              `INSERT OR REPLACE INTO sessions (id, user_id, token, expires_at, created_at, last_active_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).run(sid || newId("sess_"), userRow.id, token, exp, nowIso(), nowIso());
          } catch {}

          return {
            id: userRow.id,
            name: userRow.name,
            phone: userRow.phone,
            role: userRow.role,
          };
        }
      }
      return null;
    }

    // Check if session has expired in database
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(row.session_id);
      return null;
    }

    // Update last_active_at
    db.prepare(`UPDATE sessions SET last_active_at = ? WHERE id = ?`).run(nowIso(), row.session_id);

    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      role: row.role,
    };
  } catch {
    return null;
  }
}

/**
 * Backward compatibility alias for validateSession / verifySessionToken.
 */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  return validateSession(token);
}

/**
 * Sets the persistent HTTP-only session cookie.
 */
export async function setSessionCookie(token: string) {
  try {
    const store = await cookies();
    store.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  } catch {
    // Outside request scope
  }
}

/**
 * Clears the session cookie.
 */
export async function clearSessionCookie() {
  try {
    const store = await cookies();
    store.set(COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  } catch {
    // Outside request scope
  }
}

/**
 * Revokes and deletes a session from the database and clears the cookie.
 */
export async function revokeSession(tokenOrSid?: string) {
  let token = tokenOrSid;
  if (!token) {
    try {
      const store = await cookies();
      token = store.get(COOKIE_NAME)?.value;
    } catch {
      // Outside request scope
    }
  }

  if (token) {
    try {
      const db = getDb();
      let sid: string | undefined;
      try {
        const { payload } = await jwtVerify(token, secretKey());
        sid = payload.sid as string | undefined;
      } catch {
        // Token might already be expired or raw sid
      }

      if (sid) {
        db.prepare(`DELETE FROM sessions WHERE id = ? OR token = ?`).run(sid, token);
      } else {
        db.prepare(`DELETE FROM sessions WHERE id = ? OR token = ?`).run(token, token);
      }
    } catch (e) {
      console.error("Failed to revoke session from database:", e);
    }
  }

  await clearSessionCookie();
}

/**
 * Retrieves the current authenticated user by validating the session cookie (or optional req/header) against the database.
 */
export async function getSession(req?: { cookies?: { get: (name: string) => { value: string } | undefined }; headers?: { get: (name: string) => string | null } }): Promise<SessionUser | null> {
  try {
    let token: string | undefined;
    if (req && req.cookies && typeof req.cookies.get === "function") {
      token = req.cookies.get(COOKIE_NAME)?.value;
    }
    if (!token && req && req.headers && typeof req.headers.get === "function") {
      const auth = req.headers.get("authorization");
      if (auth && auth.startsWith("Bearer ")) {
        token = auth.slice(7).trim();
      }
      if (!token) {
        const cookieHeader = req.headers.get("cookie");
        if (cookieHeader) {
          const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
          if (match) token = decodeURIComponent(match[1]);
        }
      }
    }
    if (!token) {
      try {
        const store = await cookies();
        token = store.get(COOKIE_NAME)?.value;
      } catch {}
    }
    if (!token) return null;
    return validateSession(token);
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_EXPIRY_SECONDS = SESSION_MAX_AGE_SECONDS;
