import * as vscode from 'vscode';
import type { SecureClipboard } from '../clipboard/SecureClipboard';
import type { VaultEntryMeta } from '../vault/types';
import type { VaultService } from '../vault/VaultService';

const ACTIVE_ENTRY_KEY = 'devvault.statusBar.activeEntryId';

/**
 * Status-bar quick access with separate Username / Password copy actions.
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

    this.entryItem.command = 'devvault.statusBar.select';
    this.usernameItem.command = 'devvault.statusBar.copyUsername';
    this.passwordItem.command = 'devvault.statusBar.copyPassword';

    this.disposables.push(
      this.entryItem,
      this.usernameItem,
      this.passwordItem,
      vault.onDidChange(() => this.refresh()),
      vscode.commands.registerCommand('devvault.statusBar.select', () => this.selectEntry()),
      vscode.commands.registerCommand('devvault.statusBar.copyUsername', () =>
        this.copyField('username')
      ),
      vscode.commands.registerCommand('devvault.statusBar.copyPassword', () =>
        this.copyField('password')
      )
    );

    this.refresh();
  }

  /** Prefer this entry for status-bar copy actions (e.g. after tree copy). */
  async setActiveEntry(id: string | undefined): Promise<void> {
    this.activeEntryId = id;
    await this.context.globalState.update(ACTIVE_ENTRY_KEY, id);
    this.refresh();
  }

  refresh(): void {
    const status = this.vault.status;

    if (status === 'uninitialized') {
      this.entryItem.text = '$(shield) DevVault';
      this.entryItem.tooltip = 'DevVault: Set up vault';
      this.entryItem.show();
      this.usernameItem.hide();
      this.passwordItem.hide();
      return;
    }

    if (status === 'locked') {
      this.entryItem.text = '$(lock) DevVault';
      this.entryItem.tooltip = 'DevVault: Unlock vault';
      this.entryItem.show();
      this.usernameItem.hide();
      this.passwordItem.hide();
      return;
    }

    const entries = this.vault.listMeta();
    const active = this.resolveActive(entries);

    if (active) {
      this.entryItem.text = `$(key) ${truncate(active.name, 20)}`;
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
        ? `$(key) DevVault (${entries.length})`
        : '$(key) DevVault';
      this.entryItem.tooltip = entries.length
        ? 'Click to choose an entry'
        : 'No entries — click to add';
    }
    this.entryItem.show();

    // Always show separate labeled copy actions while unlocked.
    this.usernameItem.text = '$(account) Username';
    this.usernameItem.tooltip = active?.username
      ? `Copy username: ${active.username}`
      : 'Copy username (choose entry if needed)';
    this.usernameItem.show();

    this.passwordItem.text = '$(key) Password';
    this.passwordItem.tooltip = active
      ? `Copy password for ${active.name}`
      : 'Copy password (choose entry if needed)';
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

  /**
   * One row per entry; account / key buttons on the right copy
   * username and password separately (same pattern as the tree view).
   */
  private showEntryQuickPick(entries: VaultEntryMeta[]): Promise<void> {
    const copyUserBtn: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('account'),
      tooltip: 'Copy Username',
    };
    const copyPassBtn: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('key'),
      tooltip: 'Copy Password',
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
      buttons: [copyUserBtn, copyPassBtn],
      entry: e,
    }));
    items.push({
      label: 'Clear active entry',
      iconPath: new vscode.ThemeIcon('clear-all'),
      clear: true,
    });

    const qp = vscode.window.createQuickPick<EntryItem>();
    qp.title = 'DevVault: Choose Entry';
    qp.placeholder = 'Select entry · use icons to copy username or password';
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

      const buttonAction = (button: vscode.QuickInputButton): 'username' | 'password' => {
        const icon = button.iconPath;
        if (icon instanceof vscode.ThemeIcon && icon.id === 'account') {
          return 'username';
        }
        if (button.tooltip === 'Copy Username') {
          return 'username';
        }
        return 'password';
      };

      subs.push(
        qp.onDidTriggerItemButton(async (e) => {
          const entry = e.item.entry;
          if (!entry) {
            return;
          }
          const field = buttonAction(e.button);
          qp.hide();
          await this.setActiveEntry(entry.id);
          await this.copyFromEntry(entry.id, field);
          close();
        }),
        qp.onDidAccept(async () => {
          const selected = qp.selectedItems[0];
          if (!selected) {
            close();
            return;
          }
          if (selected.clear) {
            await this.setActiveEntry(undefined);
            close();
            return;
          }
          if (selected.entry) {
            // Selecting the row pins it for the status-bar Username / Password buttons.
            await this.setActiveEntry(selected.entry.id);
          }
          close();
        }),
        qp.onDidHide(() => close())
      );

      qp.show();
    });
  }

  private async copyField(field: 'username' | 'password'): Promise<void> {
    if (!this.vault.isUnlocked) {
      await vscode.commands.executeCommand('devvault.unlock');
      if (!this.vault.isUnlocked) {
        return;
      }
    }

    let entryId = this.activeEntryId;
    if (!entryId || !this.vault.getEntry(entryId)) {
      const entries = this.vault.listMeta();
      if (entries.length === 0) {
        void vscode.window.showInformationMessage('DevVault: No entries to copy');
        return;
      }
      // Reuse the same one-row-per-entry picker; user clicks the matching button.
      await this.showEntryQuickPick(entries);
      return;
    }

    await this.copyFromEntry(entryId, field);
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

    if (field === 'username') {
      await this.clipboard.copy(entry.username, 'Username');
    } else {
      await this.clipboard.copy(entry.password, 'Password');
    }
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
