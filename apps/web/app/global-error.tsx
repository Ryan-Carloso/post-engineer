"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";

//---------------
// Root error boundary (global-error): reports React render errors to
// PostHog and offers a page reload. Must render <html>/<body>.
//---------------

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    logger.error("React render error (global-error boundary)", error, {
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-lg font-semibold">Algo deu errado</h1>
          <p className="text-muted-foreground text-sm">
            O erro foi registrado.
          </p>
          <button
            type="button"
            onClick={reset}
            className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
