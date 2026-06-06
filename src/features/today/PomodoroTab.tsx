import { useEffect, useState } from "react";
import type { Task } from "../../types/task";
import styles from "./TodayView.module.css";

type AppLanguage = "ko" | "en";

type PomodoroTabProps = {
  tasks: Task[];
  selectedDate: string;
  isActive: boolean;
  language: AppLanguage;
};

type TimerSettings = {
  focusMinutes: number;
  breakMinutes: number;
  targetSets: number;
};

type TimerMode = "idle" | "focus" | "break" | "focusComplete" | "breakComplete" | "setsComplete";

type RunningTimerSession = {
  mode: "focus" | "break";
  endAt: number;
  completedSets: number;
  targetSets: number;
  focusTaskId: string;
};

const timerSettingsStorageKey = "dont-forget-timer-settings";
const runningTimerStorageKey = "dont-forget-running-timer";
const defaultTimerSettings: TimerSettings = {
  focusMinutes: 25,
  breakMinutes: 5,
  targetSets: 4
};

export default function PomodoroTab({ tasks, selectedDate, isActive, language }: PomodoroTabProps) {
  const [initialSettings] = useState(loadTimerSettings);
  const [initialSession] = useState(loadRunningTimerSession);
  const [focusMinutes, setFocusMinutes] = useState(initialSettings.focusMinutes);
  const [breakMinutes, setBreakMinutes] = useState(initialSettings.breakMinutes);
  const [targetSets, setTargetSets] = useState(initialSession?.targetSets ?? initialSettings.targetSets);
  const [completedSets, setCompletedSets] = useState(initialSession?.completedSets ?? 0);
  const [timerMode, setTimerMode] = useState<TimerMode>(initialSession?.mode ?? "idle");
  const [timerPreset, setTimerPreset] = useState<"focus" | "break">(initialSession?.mode ?? "focus");
  const [remainingSeconds, setRemainingSeconds] = useState(
    initialSession ? getRemainingSessionSeconds(initialSession.endAt) : initialSettings.focusMinutes * 60
  );
  const [isRunning, setIsRunning] = useState(Boolean(initialSession));
  const [focusTaskId, setFocusTaskId] = useState(initialSession?.focusTaskId ?? "");
  const [sessionEndAt, setSessionEndAt] = useState<number | null>(initialSession?.endAt ?? null);
  const isEditingSettings = timerMode === "idle";
  const isBreakTimer =
    timerMode === "break" ||
    timerMode === "breakComplete" ||
    (timerMode === "idle" && timerPreset === "break");
  const totalSeconds = isBreakTimer ? breakMinutes * 60 : focusMinutes * 60;
  const progressRate = totalSeconds <= 0 ? 0 : 1 - remainingSeconds / totalSeconds;
  const timerLabel = isBreakTimer ? (language === "ko" ? "휴식" : "Break") : language === "ko" ? "집중" : "Focus";
  const focusCandidates = tasks.filter((task) => !isTaskDoneOnDate(task, selectedDate) && task.status !== "cancelled");

  useEffect(() => {
    if (isActive || timerMode !== "focus") return;
    pauseTimer();
  }, [isActive, timerMode]);

  useEffect(() => {
    saveTimerSettings({ focusMinutes, breakMinutes, targetSets });
  }, [breakMinutes, focusMinutes, targetSets]);

  useEffect(() => {
    if (!isRunning || !sessionEndAt || (timerMode !== "focus" && timerMode !== "break")) {
      clearRunningTimerSession();
      return;
    }

    saveRunningTimerSession({
      mode: timerMode,
      endAt: sessionEndAt,
      completedSets,
      targetSets,
      focusTaskId
    });
  }, [completedSets, focusTaskId, isRunning, sessionEndAt, targetSets, timerMode]);

  useEffect(() => {
    if (!isEditingSettings) return;
    setRemainingSeconds(timerPreset === "break" ? breakMinutes * 60 : focusMinutes * 60);
  }, [breakMinutes, focusMinutes, isEditingSettings, timerPreset]);

  useEffect(() => {
    if (!isRunning) return;

    const timerId = window.setInterval(() => {
      const nextRemaining = sessionEndAt ? getRemainingSessionSeconds(sessionEndAt) : 0;
      setRemainingSeconds(() => {
        if (nextRemaining > 0) return nextRemaining;

        setIsRunning(false);
        setSessionEndAt(null);
        clearRunningTimerSession();
        if (timerMode === "focus") {
          const nextCompletedSets = Math.min(targetSets, completedSets + 1);
          setCompletedSets(nextCompletedSets);
          setTimerMode(nextCompletedSets >= targetSets ? "setsComplete" : "focusComplete");
          showTimerNotification(
            language === "ko" ? "집중 시간이 끝났어요" : "Focus time is over",
            nextCompletedSets >= targetSets
              ? language === "ko" ? "목표 세트를 완료했어요." : "You completed your target sets."
              : language === "ko" ? "휴식하거나 멈출 수 있어요." : "Start a break or stop the timer."
          );
        } else if (timerMode === "break") {
          setTimerMode("breakComplete");
          showTimerNotification(
            language === "ko" ? "휴식 시간이 끝났어요" : "Break time is over",
            language === "ko" ? "준비되면 다음 집중을 시작하세요." : "Start the next focus session when ready."
          );
        }
        return 0;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [completedSets, isRunning, language, sessionEndAt, targetSets, timerMode]);

  function startSelectedPreset() {
    startTimer(timerPreset, (timerPreset === "break" ? breakMinutes : focusMinutes) * 60);
  }

  function resetTimer() {
    setTimerMode("idle");
    setCompletedSets(0);
    setRemainingSeconds((timerPreset === "break" ? breakMinutes : focusMinutes) * 60);
    setIsRunning(false);
    setSessionEndAt(null);
    clearRunningTimerSession();
  }

  function startFocus() {
    setTimerPreset("focus");
    startTimer("focus", focusMinutes * 60);
  }

  function startBreak() {
    setTimerPreset("break");
    startTimer("break", breakMinutes * 60);
  }

  function addOneMoreSet() {
    setTargetSets((current) => Math.min(12, current + 1));
    startFocus();
  }

  function startTimer(mode: "focus" | "break", seconds: number) {
    const duration = Math.max(1, seconds);
    setTimerMode(mode);
    setRemainingSeconds(duration);
    setSessionEndAt(Date.now() + duration * 1000);
    setIsRunning(true);
  }

  function pauseTimer() {
    setIsRunning(false);
    setSessionEndAt(null);
    clearRunningTimerSession();
  }

  function toggleTimerRunning() {
    if (isRunning) {
      pauseTimer();
      return;
    }

    if (timerMode === "focus" || timerMode === "break") {
      startTimer(timerMode, remainingSeconds);
    }
  }

  return (
    <section className={styles.mainPanel} hidden={!isActive}>
      <h2>{language === "ko" ? "타이머" : "Timer"}</h2>
      <div className={styles.pomodoroPanel}>
        <div className={styles.pomoModes} aria-label={language === "ko" ? "타이머 모드" : "Timer mode"}>
          <button
            type="button"
            className={!isBreakTimer ? styles.activePomoMode : ""}
            onClick={() => {
              if (!isEditingSettings) return;
              setTimerPreset("focus");
              setRemainingSeconds(focusMinutes * 60);
            }}
          >
            {language === "ko" ? "집중" : "Focus"}
          </button>
          <button
            type="button"
            className={isBreakTimer ? styles.activePomoMode : ""}
            onClick={() => {
              if (!isEditingSettings) return;
              setTimerPreset("break");
              setRemainingSeconds(breakMinutes * 60);
            }}
          >
            {language === "ko" ? "휴식" : "Break"}
          </button>
        </div>

        <div className={styles.timerDisplay} aria-live="polite">
          <div className={styles.timerCircle}>
            <PomoRing progress={progressRate} />
            <div className={styles.timerCircleInner}>
              <strong>{formatTimerSeconds(remainingSeconds)}</strong>
              <span>{timerLabel}</span>
            </div>
          </div>
        </div>

        <div className={styles.timerSettings}>
          <TimerSetting
            label={language === "ko" ? "집중" : "Focus"}
            unit={language === "ko" ? "분" : "min"}
            value={focusMinutes}
            max={180}
            disabled={!isEditingSettings}
            onChange={(value) => setFocusMinutes(clampTimerValue(value, 1, 180))}
          />
          <TimerSetting
            label={language === "ko" ? "휴식" : "Break"}
            unit={language === "ko" ? "분" : "min"}
            value={breakMinutes}
            max={60}
            disabled={!isEditingSettings}
            onChange={(value) => setBreakMinutes(clampTimerValue(value, 1, 60))}
          />
          <TimerSetting
            label={language === "ko" ? "반복" : "Sets"}
            unit={language === "ko" ? "회" : "sets"}
            value={targetSets}
            max={12}
            disabled={!isEditingSettings}
            onChange={(value) => setTargetSets(clampTimerValue(value, 1, 12))}
          />
        </div>

        <div className={styles.timerActions}>
          {timerMode === "idle" ? (
            <>
              <button type="button" onClick={startSelectedPreset}>
                {remainingSeconds === 0 ? (language === "ko" ? "다시 시작" : "Restart") : language === "ko" ? "시작" : "Start"}
              </button>
              <button type="button" onClick={resetTimer}>{language === "ko" ? "리셋" : "Reset"}</button>
            </>
          ) : timerMode === "focus" || timerMode === "break" ? (
            <>
              <button type="button" onClick={toggleTimerRunning}>
                {isRunning ? (language === "ko" ? "잠깐 멈춤" : "Pause") : language === "ko" ? "다시 시작" : "Resume"}
              </button>
              <button type="button" onClick={resetTimer}>{language === "ko" ? "리셋" : "Reset"}</button>
            </>
          ) : timerMode === "focusComplete" ? (
            <>
              <button type="button" onClick={startBreak}>{language === "ko" ? "휴식하기" : "Start Break"}</button>
              <button type="button" onClick={resetTimer}>{language === "ko" ? "멈춤" : "Stop"}</button>
            </>
          ) : timerMode === "breakComplete" ? (
            <>
              <button type="button" onClick={startFocus}>{language === "ko" ? "집중 시작" : "Start Focus"}</button>
              <button type="button" onClick={resetTimer}>{language === "ko" ? "멈춤" : "Stop"}</button>
            </>
          ) : (
            <>
              <button type="button" onClick={addOneMoreSet}>{language === "ko" ? "1세트 더" : "One More Set"}</button>
              <button type="button" onClick={resetTimer}>{language === "ko" ? "멈춤" : "Stop"}</button>
            </>
          )}
        </div>

        <div className={styles.pomoDots}>
          {Array.from({ length: Math.min(targetSets, 12) }).map((_, index) => (
            <span key={index} className={index < completedSets ? styles.activePomoDot : ""} />
          ))}
          <strong>{language === "ko" ? `오늘 ${completedSets}회 집중` : `${completedSets} focus sessions today`}</strong>
        </div>

        <label className={styles.pomoFocus}>
          <span>{language === "ko" ? "지금 집중할 일" : "Focus Task"}</span>
          <select value={focusTaskId} onChange={(event) => setFocusTaskId(event.target.value)}>
            <option value="">{language === "ko" ? "선택 안 함" : "No task selected"}</option>
            {focusCandidates.map((task) => (
              <option key={task.id} value={task.id}>{task.title}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function TimerSetting({
  label,
  unit,
  value,
  max,
  disabled,
  onChange
}: {
  label: string;
  unit: string;
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min="1"
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <em>{unit}</em>
    </label>
  );
}

function PomoRing({ progress }: { progress: number }) {
  const size = 300;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <svg className={styles.pomoRing} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className={styles.pomoRingTrack} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} />
      <circle
        className={styles.pomoRingProgress}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
      />
    </svg>
  );
}

function isTaskDoneOnDate(task: Task, date: string) {
  if (task.repeatKind && task.repeatKind !== "none") return Boolean(task.completedDates?.includes(date));
  return task.status === "done";
}

function formatTimerSeconds(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}

function clampTimerValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function loadTimerSettings(): TimerSettings {
  try {
    const rawValue = window.localStorage.getItem(timerSettingsStorageKey);
    if (!rawValue) return defaultTimerSettings;
    const parsed = JSON.parse(rawValue) as Partial<TimerSettings>;
    return {
      focusMinutes: clampTimerValue(parsed.focusMinutes ?? defaultTimerSettings.focusMinutes, 1, 180),
      breakMinutes: clampTimerValue(parsed.breakMinutes ?? defaultTimerSettings.breakMinutes, 1, 60),
      targetSets: clampTimerValue(parsed.targetSets ?? defaultTimerSettings.targetSets, 1, 12)
    };
  } catch {
    return defaultTimerSettings;
  }
}

function saveTimerSettings(settings: TimerSettings) {
  try {
    window.localStorage.setItem(timerSettingsStorageKey, JSON.stringify(settings));
  } catch {
    // Timer settings persistence should never interrupt the timer.
  }
}

function loadRunningTimerSession(): RunningTimerSession | null {
  try {
    const rawValue = window.localStorage.getItem(runningTimerStorageKey);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue) as Partial<RunningTimerSession>;
    if (
      (parsed.mode !== "focus" && parsed.mode !== "break") ||
      typeof parsed.endAt !== "number" ||
      parsed.endAt <= Date.now()
    ) {
      clearRunningTimerSession();
      return null;
    }

    return {
      mode: parsed.mode,
      endAt: parsed.endAt,
      completedSets: clampTimerValue(parsed.completedSets ?? 0, 0, 12),
      targetSets: clampTimerValue(parsed.targetSets ?? defaultTimerSettings.targetSets, 1, 12),
      focusTaskId: typeof parsed.focusTaskId === "string" ? parsed.focusTaskId : ""
    };
  } catch {
    clearRunningTimerSession();
    return null;
  }
}

function saveRunningTimerSession(session: RunningTimerSession) {
  try {
    window.localStorage.setItem(runningTimerStorageKey, JSON.stringify(session));
  } catch {
    // An active timer still works even when temporary persistence is unavailable.
  }
}

function clearRunningTimerSession() {
  try {
    window.localStorage.removeItem(runningTimerStorageKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function getRemainingSessionSeconds(endAt: number) {
  return Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
}

function showTimerNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const notification = new Notification(title, {
    body,
    icon: "./icon.svg",
    tag: "dont-forget-timer"
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}
