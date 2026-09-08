"use client";
/**
 * The failed-Quiz retry button (spec 4, ticket #93): a small client
 * component only for the Dutch (or English) confirmation dialog and the
 * inline result message -- everything else on this page stays a server
 * component. Calls the retryQuiz server action directly (passed in as a
 * prop, the standard way a Server Action reference is handed to a Client
 * Component) rather than posting a plain <form>, so the confirmation can
 * run before the request goes out.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/admin/forms";

export interface RetryButtonProps {
  quizId: string;
  label: string;
  confirmMessage: string;
  successMessage: string;
  errorMessages: Record<string, string>;
  action: (quizId: string) => Promise<ActionResult>;
}

export function RetryButton({ quizId, label, confirmMessage, successMessage, errorMessages, action }: RetryButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function onClick() {
    if (!window.confirm(confirmMessage)) return;

    startTransition(async () => {
      const result = await action(quizId);
      if (result.ok) {
        setMessage({ text: successMessage, ok: true });
        router.refresh();
      } else {
        const key = Object.values(result.errors)[0];
        setMessage({ text: errorMessages[key] ?? key, ok: false });
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={onClick} disabled={pending} className="border px-2 py-1">
        {label}
      </button>
      {message && <p className={message.ok ? "text-green-700" : "text-red-600"}>{message.text}</p>}
    </div>
  );
}
