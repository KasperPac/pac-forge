import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: `${error.name}: ${error.message}` };
  }

  componentDidCatch(error: Error) {
    console.error("Route load error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <AlertTriangle className="h-6 w-6" />
            <span className="font-mono text-sm">Something went wrong</span>
            {this.state.errorMessage && (
              <span className="max-w-md break-all font-mono text-xs text-destructive">
                {this.state.errorMessage}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
