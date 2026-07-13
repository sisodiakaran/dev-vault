import * as vscode from 'vscode';
import type { SecureClipboard } from '../clipboard/SecureClipboard';
import type { VaultEntry } from '../vault/types';

/**
 * Open a URL in Cursor/VS Code's built-in browser when possible.
 * There is no public API to autofill form fields inside that browser.
 */
export async function openInIdeBrowser(url: string): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  const target = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  const attempts: Array<() => Thenable<unknown>> = [
    () => vscode.commands.executeCommand('workbench.action.browser.open', target),
    () => vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(target)),
    () => vscode.commands.executeCommand('simpleBrowser.show', target),
  ];

  for (const attempt of attempts) {
    try {
      await attempt();
      return true;
    } catch {
      // Try next command — not every host exposes every browser command.
    }
  }

  try {
    await vscode.env.openExternal(vscode.Uri.parse(target));
    return true;
  } catch {
    return false;
  }
}

/**
 * Guided login for the built-in browser:
 * open URL → copy username → user pastes → copy password → user pastes.
 */
export async function assistBrowserLogin(
  entry: VaultEntry,
  clipboard: SecureClipboard
): Promise<void> {
  if (entry.url.trim()) {
    const opened = await openInIdeBrowser(entry.url);
    if (!opened) {
      void vscode.window.showWarningMessage(
        `DevVault: Could not open browser for ${entry.url}`
      );
    }
  } else {
    void vscode.window.showInformationMessage(
      'DevVault: Entry has no URL — copy credentials and paste into the browser.'
    );
  }

  await clipboard.copy(entry.username, 'Username', { notify: false });

  const next = await vscode.window.showInformationMessage(
    `Username for “${entry.name}” is on the clipboard. Click the username field in the browser and paste (Cmd/Ctrl+V).`,
    'Copy Password',
    'Done'
  );

  if (next === 'Copy Password') {
    await clipboard.copy(entry.password, 'Password', { notify: false });
    void vscode.window.showInformationMessage(
      'Password copied — click the password field in the browser and paste (Cmd/Ctrl+V).'
    );
  }
}

/** True when we can safely insert into a normal text document. */
export function isEditableTextUri(uri: vscode.Uri | undefined): boolean {
  if (!uri) {
    return false;
  }
  return uri.scheme === 'file' || uri.scheme === 'untitled';
}
