import * as vscode from 'vscode';
import { showTransientToast } from '../ui/transientToast';
import { getDevVaultConfig } from '../vault/VaultService';

export class SecureClipboard {
  private clearTimer: ReturnType<typeof setTimeout> | undefined;
  private lastWritten: string | undefined;

  /**
   * @param notify When true (default), shows a toast. Pass false when the caller
   *   already shows its own confirmation (e.g. browser login flow).
   */
  async copy(value: string, label: string, options?: { notify?: boolean }): Promise<void> {
    await vscode.env.clipboard.writeText(value);
    this.lastWritten = value;

    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
    }

    const seconds = getDevVaultConfig().get<number>('clipboardClearSeconds', 30);

    this.clearTimer = setTimeout(() => {
      void this.clearIfUnchanged(value);
    }, seconds * 1000);

    if (options?.notify !== false) {
      showTransientToast(`DevVault: ${label} copied — clipboard clears in ${seconds}s`);
    }
  }

  private async clearIfUnchanged(expected: string): Promise<void> {
    this.clearTimer = undefined;
    try {
      const current = await vscode.env.clipboard.readText();
      if (current === expected && this.lastWritten === expected) {
        await vscode.env.clipboard.writeText('');
        this.lastWritten = undefined;
        void vscode.window.setStatusBarMessage('DevVault: clipboard cleared', 2000);
      }
    } catch {
      // Clipboard may be unavailable; ignore
    }
  }

  dispose(): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = undefined;
    }
    this.lastWritten = undefined;
  }
}
