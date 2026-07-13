import * as vscode from 'vscode';

/**
 * Show a notification that dismisses itself after `durationMs`.
 * Prefer this over `showInformationMessage` for non-action success feedback —
 * VS Code info toasts stay until the user closes them.
 */
export function showTransientToast(message: string, durationMs = 2500): void {
  void vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: message,
      cancellable: false,
    },
    async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    }
  );
}
