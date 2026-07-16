"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SessionActions({
  sessionId,
  token,
  status,
}: {
  sessionId: string;
  token: string;
  status: string;
}) {
  const [copied, setCopied] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const router = useRouter();

  async function unlock() {
    if (!confirm("제출 잠금을 해제하면 응답자가 같은 링크로 답변을 이어서 수정할 수 있습니다. 해제할까요?")) return;
    setUnlocking(true);
    const res = await fetch(`/api/admin/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlock" }),
    });
    setUnlocking(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={() => {
          navigator.clipboard.writeText(`${location.origin}/i/${token}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="link-quiet"
      >
        {copied ? "복사됨 ✓" : "응답 링크 복사"}
      </button>
      {status === "submitted" && (
        <button onClick={unlock} disabled={unlocking} className="btn btn-ghost !min-h-9 !py-1.5 text-xs">
          {unlocking ? "해제 중…" : "수정 잠금 해제"}
        </button>
      )}
      <a href={`/api/admin/sessions/${sessionId}/export`} className="btn btn-primary !min-h-9 !py-1.5 text-xs">
        마크다운 내보내기
      </a>
    </div>
  );
}
