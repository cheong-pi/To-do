import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./TodayView.module.css";
import type { WordEntry } from "./wordBank";

type AppLanguage = "ko" | "en";

type WordProgressRecord = {
  en: string;
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  lastSeenAt: string | null;
  nextReviewAt: string;
  lastResult: "studied" | "correct" | "wrong";
};

type StudiedResult = {
  en: string;
  result: "studied" | "correct" | "wrong";
};

type WordsTabProps = {
  isActive: boolean;
  language: AppLanguage;
  dataResetToken: number;
};

const learnedWordsStorageKey = "dont-forget-learned-words";

export default function WordsTab({ isActive, language, dataResetToken }: WordsTabProps) {
  const [wordBank, setWordBank] = useState<WordEntry[] | null>(null);
  const [wordProgress, setWordProgress] = useState<WordProgressRecord[]>(() => loadWordProgress());
  const [dailyWordCount, setDailyWordCount] = useState(20);
  const [deck, setDeck] = useState<WordEntry[]>([]);
  const [wordPhase, setWordPhase] = useState<"study" | "quiz">("study");
  const [wordIndex, setWordIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [selectedMeaning, setSelectedMeaning] = useState("");
  const [typedAnswer, setTypedAnswer] = useState("");
  const [checkedMeaning, setCheckedMeaning] = useState<"correct" | "wrong" | null>(null);
  const [knownWords, setKnownWords] = useState<string[]>([]);
  const [reviewWords, setReviewWords] = useState<string[]>([]);
  const [studiedResults, setStudiedResults] = useState<StudiedResult[]>([]);
  const [showLearnedWords, setShowLearnedWords] = useState(false);

  const currentWord = deck[wordIndex];
  const quizType = wordPhase === "quiz" ? getWordQuizType(wordIndex) : "meaning";
  const isSpellingQuiz = wordPhase === "quiz" && quizType === "spelling";
  const isFinished = wordPhase === "quiz" && wordIndex >= deck.length;
  const progressRate = deck.length === 0 ? 0 : Math.round((wordIndex / deck.length) * 100);
  const learnedWordCount = wordProgress.filter((record) => record.seenCount > 0).length;
  const progressedWordItems = studiedResults
    .map((result) => {
      const word = wordBank?.find((item) => item.en === result.en);
      return word ? { ...word, result: result.result } : null;
    })
    .filter((word): word is WordEntry & StudiedResult => Boolean(word));

  const meaningOptions = useMemo(() => {
    if (!currentWord || !wordBank) return [];
    const otherMeanings = shuffleWords(wordBank.filter((word) => word.en !== currentWord.en))
      .slice(0, 3)
      .map((word) => word.ko);
    return shuffleWords([currentWord.ko, ...otherMeanings]);
  }, [currentWord, wordBank]);

  useEffect(() => {
    if (!isActive || wordBank) return;

    let isMounted = true;
    void import("./wordBank").then((module) => {
      if (!isMounted) return;
      setWordBank(module.seedWords);
      setDeck(buildWordDeck(dailyWordCount, loadWordProgress(), module.seedWords));
    });

    return () => {
      isMounted = false;
    };
  }, [dailyWordCount, isActive, wordBank]);

  useEffect(() => {
    saveWordProgress(wordProgress);
  }, [wordProgress]);

  useEffect(() => {
    if (dataResetToken === 0) return;
    setWordProgress([]);
    setDeck(wordBank ? buildWordDeck(dailyWordCount, [], wordBank) : []);
    resetWordSession();
  }, [dailyWordCount, dataResetToken, wordBank]);

  function resetWordSession() {
    setWordPhase("study");
    setWordIndex(0);
    setIsFlipped(false);
    setSelectedMeaning("");
    setTypedAnswer("");
    setCheckedMeaning(null);
    setKnownWords([]);
    setReviewWords([]);
    setStudiedResults([]);
  }

  function resetAnswerState() {
    setIsFlipped(false);
    setSelectedMeaning("");
    setTypedAnswer("");
    setCheckedMeaning(null);
  }

  function extendDeck(currentDeck: WordEntry[], count: number) {
    if (!wordBank) return currentDeck;
    const currentWords = new Set(currentDeck.map((word) => word.en));
    const extraWords = buildWordDeck(count + currentDeck.length, wordProgress, wordBank, currentWords).slice(0, count);
    return [...currentDeck, ...extraWords];
  }

  function resizeDailyDeck(count: number) {
    if (!wordBank) return;
    const safeCount = clampTimerValue(count, 1, wordBank.length);
    setDailyWordCount(safeCount);
    const protectedCount = Math.min(deck.length, getProtectedWordCount(wordPhase, wordIndex));
    let nextDeck = deck;
    let firstNewWordIndex: number | null = null;

    if (safeCount <= protectedCount) {
      nextDeck = deck.slice(0, protectedCount);
    } else if (safeCount <= deck.length) {
      nextDeck = deck.slice(0, safeCount);
    } else {
      firstNewWordIndex = deck.length;
      nextDeck = extendDeck(deck, safeCount - deck.length);
    }

    setDeck(nextDeck);

    if (firstNewWordIndex !== null && wordPhase === "quiz") {
      setWordPhase("study");
      setWordIndex(firstNewWordIndex);
      resetAnswerState();
    }
  }

  function restart(count = dailyWordCount) {
    if (!wordBank) return;
    const safeCount = clampTimerValue(count, 1, wordBank.length);
    setDailyWordCount(safeCount);
    setDeck(buildWordDeck(safeCount, wordProgress, wordBank));
    resetWordSession();
  }

  function restartReviewOnly() {
    if (!wordBank) return;
    const reviewDeck = deck.filter((word) => reviewWords.includes(word.en));
    setDeck(reviewDeck.length > 0 ? shuffleWords(reviewDeck) : buildWordDeck(dailyWordCount, wordProgress, wordBank));
    resetWordSession();
  }

  function goNextStudyWord() {
    if (!currentWord) return;
    setStudiedResults((current) => upsertStudiedResult(current, currentWord.en, "studied"));
    setIsFlipped(false);
    if (wordIndex + 1 >= deck.length) {
      setWordPhase("quiz");
      setWordIndex(0);
      return;
    }
    setWordIndex((current) => current + 1);
  }

  function checkMeaning() {
    if (!currentWord) return;
    const normalizedTypedAnswer = typedAnswer.trim().toLowerCase();
    const isCorrect =
      quizType === "meaning"
        ? selectedMeaning === currentWord.ko
        : normalizedTypedAnswer.length > 0 && normalizedTypedAnswer === currentWord.en.toLowerCase();
    if (quizType === "meaning" && !selectedMeaning) return;
    if (quizType === "spelling" && !normalizedTypedAnswer) return;

    setCheckedMeaning(isCorrect ? "correct" : "wrong");
    setIsFlipped(true);
    setWordProgress((current) => updateWordProgress(current, currentWord.en, isCorrect ? "correct" : "wrong"));
    if (isCorrect) {
      setKnownWords((current) => [...current, currentWord.en]);
      setStudiedResults((current) => upsertStudiedResult(current, currentWord.en, "correct"));
      return;
    }

    setReviewWords((current) => [...current, currentWord.en]);
    setStudiedResults((current) => upsertStudiedResult(current, currentWord.en, "wrong"));
  }

  function goNextWord() {
    resetAnswerState();
    window.setTimeout(() => setWordIndex((current) => current + 1), 140);
  }

  function speakWord(word: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.86;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className={styles.mainPanel} hidden={!isActive}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{language === "ko" ? "단어 학습" : "Word Study"}</h2>
        </div>
        <label className={styles.wordCountControl}>
          <span>{language === "ko" ? "오늘" : "Today"}</span>
          <input
            type="number"
            min="1"
            max={wordBank?.length ?? dailyWordCount}
            value={dailyWordCount}
            disabled={!wordBank}
            onChange={(event) => resizeDailyDeck(Number(event.target.value))}
          />
          <span>{language === "ko" ? `개 · 전체 ${wordBank?.length ?? 0}개` : `words · total ${wordBank?.length ?? 0}`}</span>
        </label>
      </div>

      {!wordBank ? (
        <div className={styles.vocabDone}>
          <strong>{language === "ko" ? "단어장 불러오는 중" : "Loading Word Study"}</strong>
        </div>
      ) : !isFinished && currentWord ? (
        <div className={styles.flashWrap}>
          <div className={styles.flashCounter}>{wordIndex + 1} / {deck.length}</div>
          <div className={styles.flashProgress}>
            <i style={{ width: `${progressRate}%` }} />
          </div>
          <button
            type="button"
            className={`${styles.flashCard} ${isFlipped ? styles.flippedCard : ""}`}
            onClick={() => {
              if (wordPhase === "study" || checkedMeaning) setIsFlipped((current) => !current);
            }}
          >
            <span className={styles.flashFace}>
              {!isSpellingQuiz && (
                <span
                  role="button"
                  tabIndex={0}
                  className={styles.speakButton}
                  aria-label={language === "ko" ? `${currentWord.en} 발음 듣기` : `Listen to ${currentWord.en}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    speakWord(currentWord.en);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    speakWord(currentWord.en);
                  }}
                >
                  sound
                </span>
              )}
              <i>{currentWord.pos}</i>
              <strong>{isSpellingQuiz ? currentWord.ko : currentWord.en}</strong>
              <em>
                {wordPhase === "study"
                  ? language === "ko"
                    ? "카드를 눌러 뜻과 예문을 확인하세요."
                    : "Tap the card to see the meaning and example."
                  : isSpellingQuiz
                    ? language === "ko"
                      ? "뜻을 보고 영어 단어를 입력하세요."
                      : "Read the meaning and type the English word."
                    : language === "ko"
                      ? "알맞은 뜻을 고른 뒤 확인하세요."
                      : "Choose the matching meaning, then check."}
              </em>
            </span>
            <span className={`${styles.flashFace} ${styles.flashBack}`}>
              <span
                role="button"
                tabIndex={0}
                className={styles.speakButton}
                aria-label={language === "ko" ? `${currentWord.en} 발음 듣기` : `Listen to ${currentWord.en}`}
                onClick={(event) => {
                  event.stopPropagation();
                  speakWord(currentWord.en);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  speakWord(currentWord.en);
                }}
              >
                sound
              </span>
              <strong>{isSpellingQuiz ? currentWord.en : currentWord.ko}</strong>
              <em>
                {wordPhase === "study"
                  ? currentWord.ex
                  : `${checkedMeaning === "correct" ? (language === "ko" ? "맞았어요." : "Correct.") : language === "ko" ? "다음에 다시 볼 단어예요." : "You will review this word again."} ${currentWord.ex}`}
              </em>
            </span>
          </button>

          {wordPhase === "quiz" && (
            <>
              {quizType === "meaning" ? (
                <div className={styles.meaningGrid} aria-label={language === "ko" ? "뜻 선택" : "Meaning options"}>
                  {meaningOptions.map((meaning) => (
                    <button
                      key={meaning}
                      type="button"
                      disabled={Boolean(checkedMeaning)}
                      className={[
                        selectedMeaning === meaning ? styles.selectedMeaning : "",
                        checkedMeaning && meaning === currentWord.ko ? styles.correctMeaning : "",
                        checkedMeaning === "wrong" && selectedMeaning === meaning ? styles.wrongMeaning : ""
                      ].join(" ")}
                      onClick={() => setSelectedMeaning(meaning)}
                    >
                      {meaning}
                    </button>
                  ))}
                </div>
              ) : (
                <label className={styles.spellingQuiz}>
                  <span>{currentWord.ko}</span>
                  <input
                    value={typedAnswer}
                    disabled={Boolean(checkedMeaning)}
                    placeholder={language === "ko" ? "영어 단어 입력" : "Type the English word"}
                    onChange={(event) => setTypedAnswer(event.target.value)}
                  />
                  {checkedMeaning === "wrong" && <em>{language === "ko" ? "정답" : "Answer"}: {currentWord.en}</em>}
                </label>
              )}
            </>
          )}

          <div className={styles.flashActions}>
            {wordPhase === "study" ? (
              <button type="button" onClick={goNextStudyWord}>
                {wordIndex + 1 >= deck.length ? (language === "ko" ? "퀴즈 시작하기" : "Start Quiz") : language === "ko" ? "다음 단어 확인하기" : "Next Word"}
              </button>
            ) : checkedMeaning ? (
              <button type="button" onClick={goNextWord}>{language === "ko" ? "다음" : "Next"}</button>
            ) : (
              <button type="button" disabled={quizType === "meaning" ? !selectedMeaning : !typedAnswer.trim()} onClick={checkMeaning}>{language === "ko" ? "확인" : "Check"}</button>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.vocabDone}>
          <strong>{language === "ko" ? "학습 완료" : "Done"}</strong>
          <span>{language === "ko" ? `오늘 ${deck.length}개 · 맞음 ${knownWords.length} · 다시 볼 단어 ${reviewWords.length} · 누적 ${learnedWordCount}개` : `Today ${deck.length} · Correct ${knownWords.length} · Review ${reviewWords.length} · Learned ${learnedWordCount}`}</span>
          <div className={styles.flashActions}>
            {reviewWords.length > 0 && <button type="button" onClick={restartReviewOnly}>{language === "ko" ? "복습만 다시" : "Review Only"}</button>}
            <button type="button" onClick={() => restart()}>{language === "ko" ? "새로 시작" : "Restart"}</button>
          </div>
        </div>
      )}

      <div className={styles.learnedWordsPanel}>
        <button type="button" onClick={() => setShowLearnedWords((current) => !current)}>
          {showLearnedWords ? (language === "ko" ? "진행 단어 닫기" : "Hide Progress Words") : language === "ko" ? `진행 단어 ${studiedResults.length}개` : `Progress Words ${studiedResults.length}`}
        </button>
        {showLearnedWords && (
          <div className={styles.learnedWordsList}>
            {progressedWordItems.length > 0 ? (
              progressedWordItems.map((word) => (
                <span key={word.en}>
                  <strong>{word.en}</strong>
                  <em>{word.ko}</em>
                  {word.result === "correct" && <b className={styles.correctWordMark}>{language === "ko" ? "맞음" : "Correct"}</b>}
                  {word.result === "wrong" && <b className={styles.wrongWordMark}>{language === "ko" ? "틀림" : "Wrong"}</b>}
                  {word.result === "studied" && <b>{language === "ko" ? "학습" : "Studied"}</b>}
                </span>
              ))
            ) : (
              <p>{language === "ko" ? "아직 진행한 단어가 없어요." : "No words studied yet."}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function clampTimerValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(date: string, amount: number) {
  const currentDate = new Date(`${date}T00:00:00`);
  currentDate.setDate(currentDate.getDate() + amount);
  return getLocalDateKey(currentDate);
}

function daysBetween(from: string, to: string) {
  const fromTime = new Date(`${from}T00:00:00`).getTime();
  const toTime = new Date(`${to}T00:00:00`).getTime();
  return Math.round((toTime - fromTime) / 86_400_000);
}

function shuffleWords<T>(words: T[]) {
  return [...words].sort(() => Math.random() - 0.5);
}

function buildWordDeck(count: number, progress: WordProgressRecord[], wordBank: WordEntry[], excludeWords = new Set<string>()) {
  const safeCount = clampTimerValue(count, 1, wordBank.length);
  const today = getLocalDateKey();
  const progressMap = new Map(progress.map((record) => [record.en, record]));
  const reviewTargetCount = Math.min(Math.round(safeCount / 3), safeCount);
  const dueReviewWords = wordBank.filter((word) => {
    if (excludeWords.has(word.en)) return false;
    const record = progressMap.get(word.en);
    if (!record || record.seenCount <= 0) return false;
    return record.nextReviewAt <= today;
  });
  const recentReviewWords = wordBank.filter((word) => {
    if (excludeWords.has(word.en)) return false;
    const record = progressMap.get(word.en);
    if (!record || record.seenCount <= 0) return false;
    return daysBetween(record.lastSeenAt ?? today, today) <= 3;
  });
  const newWords = wordBank.filter((word) => !excludeWords.has(word.en) && !progressMap.has(word.en));
  const learnedWords = wordBank.filter((word) => !excludeWords.has(word.en) && progressMap.has(word.en));
  const deck: WordEntry[] = [];

  addUniqueWords(deck, shuffleWords(dueReviewWords), reviewTargetCount);
  addUniqueWords(deck, shuffleWords(recentReviewWords), reviewTargetCount);
  addUniqueWords(deck, shuffleWords(newWords), safeCount);
  addUniqueWords(deck, shuffleWords(learnedWords), safeCount);
  addUniqueWords(deck, shuffleWords(wordBank.filter((word) => !excludeWords.has(word.en))), safeCount);

  return deck.slice(0, safeCount);
}

function addUniqueWords(target: WordEntry[], source: WordEntry[], maxCount: number) {
  const existingWords = new Set(target.map((word) => word.en));
  for (const word of source) {
    if (target.length >= maxCount) return;
    if (existingWords.has(word.en)) continue;
    target.push(word);
    existingWords.add(word.en);
  }
}

function getProtectedWordCount(wordPhase: "study" | "quiz", wordIndex: number) {
  if (wordPhase === "study") return wordIndex + 1;
  return Number.POSITIVE_INFINITY;
}

function getWordQuizType(wordIndex: number): "meaning" | "spelling" {
  return wordIndex % 2 === 0 ? "spelling" : "meaning";
}

function updateWordProgress(records: WordProgressRecord[], en: string, result: "studied" | "correct" | "wrong") {
  const today = getLocalDateKey();
  const existing = records.find((record) => record.en === en);
  const baseRecord: WordProgressRecord = existing ?? {
    en,
    seenCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lastSeenAt: null,
    nextReviewAt: today,
    lastResult: "studied"
  };
  const updatedRecord: WordProgressRecord = {
    ...baseRecord,
    seenCount: baseRecord.seenCount + 1,
    correctCount: baseRecord.correctCount + (result === "correct" ? 1 : 0),
    wrongCount: baseRecord.wrongCount + (result === "wrong" ? 1 : 0),
    lastSeenAt: today,
    nextReviewAt: scheduleNextWordReview(today, result, baseRecord.correctCount, baseRecord.wrongCount),
    lastResult: result
  };

  if (!existing) return [...records, updatedRecord];
  return records.map((record) => (record.en === en ? updatedRecord : record));
}

function scheduleNextWordReview(today: string, result: "studied" | "correct" | "wrong", correctCount: number, wrongCount: number) {
  if (result === "wrong") return shiftDate(today, 1);
  if (result === "studied") return shiftDate(today, 1 + Math.floor(Math.random() * 3));
  if (wrongCount > 0) return shiftDate(today, 1 + Math.floor(Math.random() * 2));
  if (correctCount < 2) return shiftDate(today, 1 + Math.floor(Math.random() * 3));
  return shiftDate(today, 2 + Math.floor(Math.random() * 2));
}

function loadWordProgress() {
  try {
    const rawValue = window.localStorage.getItem(learnedWordsStorageKey);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    if (parsed.every((value) => typeof value === "string")) {
      return parsed.map((en) => ({
        en,
        seenCount: 1,
        correctCount: 1,
        wrongCount: 0,
        lastSeenAt: shiftDate(getLocalDateKey(), -1),
        nextReviewAt: shiftDate(getLocalDateKey(), 1),
        lastResult: "correct" as const
      }));
    }
    return parsed.filter(isWordProgressRecord);
  } catch {
    return [];
  }
}

function saveWordProgress(words: WordProgressRecord[]) {
  try {
    window.localStorage.setItem(learnedWordsStorageKey, JSON.stringify(words));
  } catch {
    // Local word progress should never block the study flow.
  }
}

function isWordProgressRecord(value: unknown): value is WordProgressRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<WordProgressRecord>;
  return (
    typeof record.en === "string" &&
    typeof record.seenCount === "number" &&
    typeof record.correctCount === "number" &&
    typeof record.wrongCount === "number" &&
    typeof record.nextReviewAt === "string" &&
    (record.lastResult === "studied" || record.lastResult === "correct" || record.lastResult === "wrong")
  );
}

function upsertStudiedResult(results: StudiedResult[], en: string, result: StudiedResult["result"]) {
  const existingIndex = results.findIndex((item) => item.en === en);
  if (existingIndex < 0) return [...results, { en, result }];
  return results.map((item, index) => (index === existingIndex ? { en, result } : item));
}
