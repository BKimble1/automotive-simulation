/**
 * If a panel fails while drawing, the rest of the page (the car, the header, the other modes)
 * keeps working: the panel is replaced by a short notice with a way to carry on. The error is
 * still reported to the console, so tests and developers see it.
 */
import { Component, type ReactNode } from 'react';
import { useApp } from '../state/store';

interface State {
  error: Error | null;
}

export class PanelBoundary extends Component<{ children: ReactNode; resetKey: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('A panel failed:', error);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    // moving somewhere else gives the panel a fresh start
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice pe" role="alert">
        <span>This panel ran into a problem.</span>
        <button className="pbtn pbtn--text" onClick={() => (this.setState({ error: null }), useApp.getState().go({ mode: 'intro' }))}>
          Back to the start
        </button>
      </div>
    );
  }
}
