import * as vscode from 'vscode';
import { getDevVaultConfig } from '../vault/VaultService';

export class SecureClipboard {
  private clearTimer: ReturnType<typeof setTimeout> | undefined;
  private lastWritten: string | undefined;

  async copy(value: string, label: string): Promise<void> {
    await vscode.env.clipboard.writeText(value);
    this.lastWritten = value;

    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
    }

    const seconds = getDevVaultConfig().get<number>('clipboardClearSeconds', 30);

    this.clearTimer = setTimeout(() => {
      void this.clearIfUnchanged(value);
    }, seconds * 1000);

    void vscode.window.setStatusBarMessage(
      `DevVault: ${label} copied — clipboard clears in ${seconds}s`,
      seconds * 1000
    );
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
