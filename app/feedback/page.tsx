"use client";

import React, { useEffect, useState, useCallback } from "react";

interface FeedbackItem {
  id: number;
  body: string;
  username: string | null;
  created_at: string;
}

interface FeedbackResponse {
  items: FeedbackItem[];
  total: number;
  page: number;
  totalPages: number;
}

function sanitize(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FeedbackListPage() {
  const [data, setData] = useState<FeedbackResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedback?page=${p}`);
      if (!res.ok) throw new Error("取得に失敗しました");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(page);
  }, [page, fetchPage]);

  return (
    <main className="min-h-screen bg-black text-white font-mono px-4 py-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">

        <header className="flex items-center justify-between border-b-4 border-[#29adff] pb-3">
          <h1 className="text-sm md:text-base font-bold tracking-widest text-[#29adff]">
            ▒ 目安箱 — 投稿一覧 ▒
          </h1>
          {data && (
            <span className="text-2xs text-[#83769c]">
              全 {data.total} 件
            </span>
          )}
        </header>

        {error && (
          <div className="text-xs text-[#ff004d] font-bold border-2 border-[#ff004d] p-3">
            ⚠ {error}
          </div>
        )}

        {loading && (
          <div className="text-xs text-[#83769c] text-center py-12 pixel-blink">
            ▒ 読み込み中…
          </div>
        )}

        {!loading && data?.items.length === 0 && (
          <div className="text-xs text-[#83769c] text-center py-12">
            まだ投稿がありません。
          </div>
        )}

        {!loading && data && data.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {data.items.map((item) => (
              <li
                key={item.id}
                className="border-2 border-[#5f574f] bg-[#1d2b53] p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] text-[#83769c]">
                  <span>
                    @{sanitize(item.username ?? "匿名")}
                  </span>
                  <span className="flex-shrink-0">{formatDate(item.created_at)}</span>
                </div>
                {/* dangerouslySetInnerHTML は使わず sanitize 済みテキストをそのまま表示 */}
                <p className="text-xs text-[#fff1e8] leading-relaxed whitespace-pre-wrap break-words">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        )}

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t-2 border-[#5f574f] pt-4 text-xs select-none">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => p - 1)}
              className="pixel-btn text-xs py-1 px-3 disabled:opacity-30 disabled:pointer-events-none"
            >
              ◀ 前へ
            </button>
            <span className="font-mono text-[#83769c] text-2xs">
              PAGE {data.page} / {data.totalPages}
            </span>
            <button
              type="button"
              disabled={page >= data.totalPages || loading}
              onClick={() => setPage(p => p + 1)}
              className="pixel-btn text-xs py-1 px-3 disabled:opacity-30 disabled:pointer-events-none"
            >
              次へ ▶
            </button>
          </div>
        )}

        <footer className="text-center text-[10px] text-[#5f574f] mt-4">
          <a href="/" className="pixel-btn text-[9px] py-0.5 px-2">
            ← ロビーへ戻る
          </a>
        </footer>
      </div>
    </main>
  );
}
