import { neon } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const url = process.env.DATABASE_URL;
  if (!url) return Response.json({ error: "DB未設定" }, { status: 500 });

  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const sql = neon(url);
  const [rows, countRows] = await Promise.all([
    sql`
      SELECT id, body, username, created_at
      FROM feedback
      ORDER BY created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `,
    sql`SELECT COUNT(*)::int AS total FROM feedback`,
  ]);

  const total = (countRows[0] as { total: number }).total;

  return Response.json({
    items: rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

export async function POST(request: Request) {
  const { body, userId, username } = await request.json();

  if (!body || typeof body !== "string" || body.trim().length === 0) {
    return Response.json({ error: "内容を入力してください。" }, { status: 400 });
  }
  const trimmed = body.trim();
  if (trimmed.length > 1000) {
    return Response.json({ error: "1000文字以内で入力してください。" }, { status: 400 });
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    return Response.json({ error: "DB未設定" }, { status: 500 });
  }

  const sql = neon(url);
  await sql`
    INSERT INTO feedback (body, user_id, username)
    VALUES (${trimmed}, ${userId ?? null}, ${username ?? null})
  `;

  return Response.json({ ok: true });
}
