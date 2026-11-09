import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';

function ErrorFallback({ error, onRetry: showPageAgain }: { error: Error; onRetry: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // A page that crashed on a bad answer would draw the same cached answer again and crash again,
  // so trying again also forgets what was loaded. The pages ask the server afresh.
  const onRetry = () => {
    queryClient.removeQueries();
    showPageAgain();
  };
  return (
    <Card role="alert" className="mx-auto mt-6 max-w-xl space-y-4 p-6 text-center">
      <TriangleAlert className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-site-text">Something went wrong on this page</h2>
        <p className="text-sm text-site-muted">
          The rest of PBSI still works: use the menu to go somewhere else, or try this page again. If it keeps
          happening, please tell your administrator what you were doing.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Try again
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            navigate('/dashboard');
            onRetry();
          }}
        >
          Go to dashboard
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
      {/* The technical detail is for developers only; it is never shown on the live site. */}
      {import.meta.env.DEV && <pre className="overflow-x-auto rounded bg-muted p-3 text-left text-xs">{error.message}</pre>}
    </Card>
  );
}

interface Props {
  children: ReactNode;
  /** When this changes (the person went to another page), an error that is showing is cleared. */
  resetKey: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches a crash while a page is drawing (a bad response, a bug) so it replaces only the page
 * content, not the whole screen. The sidebar and top bar stay, and so does everything else the
 * person can do. It does not catch errors in event handlers or in requests (those are handled where
 * they happen), and it is not a reason to skip handling a failing request.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] a page crashed:', error, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) return <ErrorFallback error={this.state.error} onRetry={this.reset} />;
    return this.props.children;
  }
}
