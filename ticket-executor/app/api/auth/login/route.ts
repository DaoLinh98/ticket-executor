import { NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  REMEMBER_MAX_AGE,
  authDisabled,
  passwordMatches,
  sessionToken,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/login — verify the shared password and establish a session.
// Body: { password: string, remember?: boolean }. Never echoes the password.
export async function POST(req: Request) {
  if (authDisabled()) return NextResponse.json({ ok: true });

  let body: { password?: unknown; remember?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.remember === true;

  if (!passwordMatches(password)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: AUTH_COOKIE,
    value: await sessionToken(),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    // "Remember me" -> persistent 30-day cookie; otherwise a session cookie.
    ...(remember ? { maxAge: REMEMBER_MAX_AGE } : {}),
  });
  return res;
}
