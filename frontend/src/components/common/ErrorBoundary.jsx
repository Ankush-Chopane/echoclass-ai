import React from 'react';

/** Catches render errors so one broken page shows a message instead of a blank screen (class component: error boundaries have no hook form). */
export class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('UI error:', error, info?.componentStack); }
  componentDidUpdate(prev) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="max-w-xl mx-auto mt-10 p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200">
        <h1 className="text-lg font-bold mb-2">Something went wrong on this page</h1>
        <p className="text-sm mb-4">{this.state.error.message || 'Unexpected error.'} Your classes and transcripts are safe.</p>
        <button type="button" className="underline" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
