"use client";

import React, { useState } from "react";
import PixelModal from "./PixelModal";
import { getBackendUrl } from "../../lib/api";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
  username?: string;
}

export default function FeedbackModal({ isOpen, onClose, userId, username }: FeedbackModalProps) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleClose = () => {
    setBody("");
    setStatus("idle");
    setErrorMsg("");
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    try {
      const res = await fetch(`${getBackendUrl()}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, userId, username }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "送信に失敗しました。");
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setErrorMsg("サーバーとの通信に失敗しました。");
      setStatus("error");
    }
  };

  return (
    <PixelModal isOpen={isOpen} onClose={handleClose} title="目安箱 — ご意見・ご要望">
      {status === "done" ? (
        <div className="flex flex-col items-center gap-4 py-4">
          <span className="text-[#00e436] text-2xl select-none">✓</span>
          <p className="text-xs text-[#fff1e8] text-center leading-relaxed">
            ご意見をお送りいただきありがとうございます！<br />
            開発の参考にさせていただきます。
          </p>
          <button onClick={handleClose} className="pixel-btn pixel-btn-cyan text-xs py-1.5 px-4">
            閉じる
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-2xs text-[#83769c] leading-relaxed">
            バグ報告・機能要望・感想など、なんでもどうぞ。匿名で送信できます。
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[#ffec27] font-bold">
              内容 <span className="text-[#83769c] font-normal">({body.length}/1000)</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 1000))}
              placeholder="例: ○○機能を追加してほしい / △△のバグを発見しました"
              rows={5}
              className="pixel-input text-xs resize-none"
              required
            />
          </div>

          {status === "error" && (
            <div className="text-2xs text-[#ff004d] font-bold">⚠ {errorMsg}</div>
          )}

          <div className="flex justify-end gap-2 mt-1">
            <button type="button" onClick={handleClose} className="pixel-btn text-xs">
              キャンセル
            </button>
            <button
              type="submit"
              disabled={status === "sending" || body.trim().length === 0}
              className="pixel-btn pixel-btn-yellow text-xs disabled:opacity-50 disabled:pointer-events-none"
            >
              {status === "sending" ? "送信中…" : "送信する"}
            </button>
          </div>
        </form>
      )}
    </PixelModal>
  );
}
