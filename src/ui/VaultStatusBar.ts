import * as vscode from 'vscode';
import type { SecureClipboard } from '../clipboard/SecureClipboard';
import type { VaultEntryMeta } from '../vault/types';
import type { VaultService } from '../vault/VaultService';
import { assistBrowserLogin } from './BrowserFill';

const ACTIVE_ENTRY_KEY = 'devvault.statusBar.activeEntryId';

/**
 * Status-bar quick access: pick an entry, then copy username / password
 * for pasting into the built-in browser (no editor windows opened).
 */
export class VaultStatusBar implements vscode.Disposable {
  private readonly entryItem: vscode.StatusBarItem;
  private readonly usernameItem: vscode.StatusBarItem;
  private readonly passwordItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private activeEntryId: string | undefined;

  constructor(
    private readonly vault: VaultService,
    private readonly clipboard: SecureClipboard,
    private readonly context: vscode.ExtensionContext
  ) {
    this.activeEntryId = context.globalState.get<string>(ACTIVE_ENTRY_KEY);

    this.entryItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.usernameItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.passwordItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);

    this.entryItem.command = {
      command: 'devvault.statusBar.select',
      title: 'DevVault: Choose Entry',
    };
    this.usernameItem.command = {
      command: 'devvault.statusBar.fillUsername',
      title: 'DevVault: Copy Username',
    };
    this.passwordItem.command = {
      command: 'devvault.statusBar.fillPassword',
      title: 'DevVault: Copy Password',
    };

    this.disposables.push(
      this.entryItem,
      this.usernameItem,
      this.passwordItem,
      vault.onDidChange(() => this.refresh()),
      vscode.commands.registerCommand('devvault.statusBar.select', () => this.selectEntry()),
      vscode.commands.registerCommand('devvault.statusBar.fillUsername', () =>
        this.copyField('username')
      ),
      vscode.commands.registerCommand('devvault.statusBar.fillPassword', () =>
        this.copyField('password')
      ),
      vscode.commands.registerCommand('devvault.statusBar.copyUsername', () =>
        this.copyField('username')
      ),
      vscode.commands.registerCommand('devvault.statusBar.copyPassword', () =>
        this.copyField('password')
      )
    );

    this.refresh();
  }

  async setActiveEntry(id: string | undefined): Promise<void> {
    this.activeEntryId = id;
    await this.context.globalState.update(ACTIVE_ENTRY_KEY, id);
    this.refresh();
  }

  refresh(): void {
    const status = this.vault.status;

    if (status === 'uninitialized') {
      this.entryItem.text = '$(devvault-icon) DevVault';
      this.entryItem.tooltip = 'DevVault: Set up vault';
      this.entryItem.show();
      this.usernameItem.hide();
      this.passwordItem.hide();
      return;
    }

    if (status === 'locked') {
      this.entryItem.text = '$(devvault-icon) DevVault';
      this.entryItem.tooltip = 'DevVault: Unlock vault';
      this.entryItem.show();
      this.usernameItem.hide();
      this.passwordItem.hide();
      return;
    }

    const entries = this.vault.listMeta();
    const active = this.resolveActive(entries);

    if (active) {
      this.entryItem.text = `$(devvault-icon) ${truncate(active.name, 20)}`;
      this.entryItem.tooltip = [
        `Active: ${active.name}`,
        active.username ? `Username: ${active.username}` : undefined,
        active.url ? `URL: ${active.url}` : undefined,
        'Click to switch entry',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      this.entryItem.text = entries.length
        ? `$(devvault-icon) DevVault (${entries.length})`
        : '$(devvault-icon) DevVault';
      this.entryItem.tooltip = entries.length
        ? 'Click to choose an entry'
        : 'No entries — click to add';
    }
    this.entryItem.show();

    this.usernameItem.text = '$(account) Username';
    this.usernameItem.tooltip = active?.username
      ? `Copy username: ${active.username}`
      : 'Copy username to clipboard (paste in browser)';
    this.usernameItem.show();

    this.passwordItem.text = '$(lock) Password';
    this.passwordItem.tooltip = active
      ? `Copy password for ${active.name}`
      : 'Copy password to clipboard (paste in browser)';
    this.passwordItem.show();
  }

  private resolveActive(entries: VaultEntryMeta[]): VaultEntryMeta | undefined {
    if (!entries.length || !this.activeEntryId) {
      return undefined;
    }
    return entries.find((e) => e.id === this.activeEntryId);
  }

  private async selectEntry(): Promise<void> {
    if (this.vault.status === 'uninitialized' || this.vault.status === 'locked') {
      await vscode.commands.executeCommand('devvault.unlock');
      return;
    }

    const entries = this.vault.listMeta();
    if (entries.length === 0) {
      await vscode.commands.executeCommand('devvault.add');
      return;
    }

    await this.showEntryQuickPick(entries);
  }

  private showEntryQuickPick(
    entries: VaultEntryMeta[],
    preferredField?: 'username' | 'password'
  ): Promise<void> {
    const userBtn: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('account'),
      tooltip: 'Copy Username',
    };
    const passBtn: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('lock'),
      tooltip: 'Copy Password',
    };
    const browserBtn: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('globe'),
      tooltip: 'Open in Browser & Login',
    };

    type EntryItem = vscode.QuickPickItem & {
      entry?: VaultEntryMeta;
      clear?: boolean;
    };

    const items: EntryItem[] = entries.map((e) => ({
      label: e.name,
      description: e.username,
      detail: e.url || undefined,
      iconPath: new vscode.ThemeIcon('key'),
      buttons: [userBtn, passBtn, browserBtn],
      entry: e,
    }));
    items.push({
      label: 'Clear active entry',
      iconPath: new vscode.ThemeIcon('clear-all'),
      clear: true,
    });

    const qp = vscode.window.createQuickPick<EntryItem>();
    qp.title = preferredField
      ? `DevVault: Copy ${preferredField === 'username' ? 'Username' : 'Password'}`
      : 'DevVault: Choose Entry';
    qp.placeholder = preferredField
      ? `Select an entry to copy its ${preferredField}`
      : 'Select entry · icons copy or open browser login';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.ignoreFocusOut = true;
    qp.items = items;

    return new Promise((resolve) => {
      let settled = false;
      const subs: vscode.Disposable[] = [];
      const close = () => {
        if (settled) {
          return;
        }
        settled = true;
        for (const s of subs) {
          s.dispose();
        }
        qp.dispose();
        resolve();
      };

      const buttonAction = (
        button: vscode.QuickInputButton
      ): 'username' | 'password' | 'browser' => {
        const icon = button.iconPath;
        if (icon instanceof vscode.ThemeIcon) {
          if (icon.id === 'account') {
            return 'username';
          }
          if (icon.id === 'globe') {
            return 'browser';
          }
        }
        if (button.tooltip?.includes('Username')) {
          return 'username';
        }
        if (button.tooltip?.includes('Browser')) {
          return 'browser';
        }
        return 'password';
      };

      subs.push(
        qp.onDidTriggerItemButton(async (e) => {
          const entryMeta = e.item.entry;
          if (!entryMeta) {
            return;
          }
          const action = buttonAction(e.button);
          qp.hide();
          try {
            await this.setActiveEntry(entryMeta.id);
            if (action === 'browser') {
              const full = this.vault.getEntry(entryMeta.id);
              if (full) {
                await assistBrowserLogin(full, this.clipboard);
              }
            } else {
              await this.copyFromEntry(entryMeta.id, action);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            void vscode.window.showErrorMessage(`DevVault: ${message}`);
          }
          close();
        }),
        qp.onDidAccept(async () => {
          const selected = qp.selectedItems[0];
          if (!selected) {
            close();
            return;
          }
          try {
            if (selected.clear) {
              await this.setActiveEntry(undefined);
              close();
              return;
            }
            if (selected.entry) {
              await this.setActiveEntry(selected.entry.id);
              if (preferredField) {
                await this.copyFromEntry(selected.entry.id, preferredField);
                void vscode.window.showInformationMessage(
                  `DevVault: ${preferredField === 'username' ? 'Username' : 'Password'} copied — paste with Cmd/Ctrl+V.`
                );
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            void vscode.window.showErrorMessage(`DevVault: ${message}`);
          }
          close();
        }),
        qp.onDidHide(() => close())
      );

      qp.show();
    });
  }

  private async copyField(field: 'username' | 'password'): Promise<void> {
    try {
      if (!this.vault.isUnlocked) {
        await vscode.commands.executeCommand('devvault.unlock');
        if (!this.vault.isUnlocked) {
          return;
        }
      }

      const entryId = this.activeEntryId;
      const hasEntry = !!entryId && this.vault.listMeta().some((e) => e.id === entryId);
      if (!hasEntry || !entryId) {
        const entries = this.vault.listMeta();
        if (entries.length === 0) {
          void vscode.window.showInformationMessage('DevVault: No entries to copy');
          return;
        }
        await this.showEntryQuickPick(entries, field);
        return;
      }

      await this.copyFromEntry(entryId, field);
      void vscode.window.showInformationMessage(
        `DevVault: ${field === 'username' ? 'Username' : 'Password'} copied — paste in the browser with Cmd/Ctrl+V.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`DevVault: ${message}`);
    }
  }

  private async copyFromEntry(
    entryId: string,
    field: 'username' | 'password'
  ): Promise<void> {
    const entry = this.vault.getEntry(entryId);
    if (!entry) {
      void vscode.window.showWarningMessage('DevVault: Entry not found');
      await this.setActiveEntry(undefined);
      return;
    }

    const value = field === 'username' ? entry.username : entry.password;
    if (!value) {
      void vscode.window.showWarningMessage(
        `DevVault: ${field === 'username' ? 'Username' : 'Password'} is empty for this entry`
      );
      return;
    }

    await this.clipboard.copy(value, field === 'username' ? 'Username' : 'Password');
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
