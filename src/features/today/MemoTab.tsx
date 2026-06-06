import { useEffect, useState, type FormEvent } from "react";
import styles from "./TodayView.module.css";

type AppLanguage = "ko" | "en";

type Memo = {
  id: string;
  content: string;
  createdAt: string;
};

type MemoTabProps = {
  isActive: boolean;
  language: AppLanguage;
};

const memoStorageKey = "dont-forget-memos";

export default function MemoTab({ isActive, language }: MemoTabProps) {
  const [memos, setMemos] = useState<Memo[]>(() => loadStoredMemos());
  const [content, setContent] = useState("");

  useEffect(() => {
    saveStoredMemos(memos);
  }, [memos]);

  function addMemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    setMemos((current) => [
      { id: `memo-${Date.now()}`, content: trimmedContent, createdAt: new Date().toISOString() },
      ...current
    ]);
    setContent("");
  }

  return (
    <section className={styles.mainPanel} hidden={!isActive}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{language === "ko" ? "메모" : "Memo"} <span className={styles.titleCount}>{memos.length}</span></h2>
        </div>
      </div>

      <form className={styles.memoComposer} onSubmit={addMemo}>
        <textarea
          value={content}
          maxLength={600}
          placeholder={language === "ko" ? "예: 다음 병원 예약에 필요한 서류 확인하기" : "e.g. Documents needed for the next appointment"}
          onChange={(event) => setContent(event.target.value)}
        />
        <button type="submit">{language === "ko" ? "메모 추가" : "Add Memo"}</button>
      </form>

      <div className={styles.memoList}>
        {memos.length > 0 ? (
          memos.map((memo) => (
            <article key={memo.id} className={styles.memoItem}>
              <p>{memo.content}</p>
              <div>
                <time>{formatMemoTime(memo.createdAt, language)}</time>
                <button type="button" onClick={() => setMemos((current) => current.filter((item) => item.id !== memo.id))}>
                  {language === "ko" ? "삭제" : "Delete"}
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className={styles.emptyMemo}>{language === "ko" ? "아직 메모가 없어요." : "No memos yet."}</p>
        )}
      </div>
    </section>
  );
}

function loadStoredMemos() {
  try {
    const rawValue = window.localStorage.getItem(memoStorageKey);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.filter(isMemo) : [];
  } catch {
    return [];
  }
}

function saveStoredMemos(memos: Memo[]) {
  try {
    window.localStorage.setItem(memoStorageKey, JSON.stringify(memos));
  } catch {
    // Memo persistence should never block the app.
  }
}

function isMemo(value: unknown): value is Memo {
  if (!value || typeof value !== "object") return false;
  const memo = value as Partial<Memo>;
  return typeof memo.id === "string" && typeof memo.content === "string" && typeof memo.createdAt === "string";
}

function formatMemoTime(value: string, language: AppLanguage) {
  return new Date(value).toLocaleString(language === "ko" ? "ko-KR" : "en-US", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
