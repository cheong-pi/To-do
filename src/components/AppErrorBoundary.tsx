import { Component, type ErrorInfo, type ReactNode } from "react";
import "./AppErrorBoundary.css";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App render failed", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="app-error">
        <section>
          <strong>화면을 불러오지 못했어요.</strong>
          <p>저장된 데이터는 그대로입니다. 앱을 다시 불러와 주세요.</p>
          <button type="button" onClick={() => window.location.reload()}>
            다시 불러오기
          </button>
        </section>
      </main>
    );
  }
}
