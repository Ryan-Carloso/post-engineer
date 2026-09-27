"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

//---------------
// Error boundary raiz (global-error): reporta erros de render do React ao
// Bugsink e oferece recarregar a página. Precisa renderizar <html>/<body>.
//---------------

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-lg font-semibold">Algo deu errado</h1>
          <p className="text-muted-foreground text-sm">
            O erro foi registrado no Bugsink.
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
