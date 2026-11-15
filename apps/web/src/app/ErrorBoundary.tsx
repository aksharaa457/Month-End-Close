import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";

/** Keeps a crash in one page from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[page error]", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-10 max-w-lg rounded-lg border border-destructive/40 bg-card p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 size-6 text-destructive" />
        <p className="font-semibold">This page hit an error</p>
        <p className="mt-1 text-sm text-muted-foreground">{this.state.error.message}</p>
        <Button className="mt-4" variant="outline" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
