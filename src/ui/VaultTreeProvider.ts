import * as vscode from 'vscode';
import type { VaultEntryMeta } from '../vault/types';
import type { VaultService } from '../vault/VaultService';

export class VaultEntryItem extends vscode.TreeItem {
  constructor(public readonly entry: VaultEntryMeta) {
    super(entry.name, vscode.TreeItemCollapsibleState.None);
    this.description = entry.username;
    this.tooltip = `${entry.name}\n${entry.url}\n${entry.username}`;
    this.contextValue = 'vaultEntry';
    this.iconPath = new vscode.ThemeIcon('key');
    this.command = {
      command: 'devvault.copyPassword',
      title: 'Copy Password',
      arguments: [this],
    };
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(message: string, icon: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'message';
  }
}

export class VaultTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly vault: VaultService) {
    vault.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const status = this.vault.status;
    if (status === 'uninitialized') {
      return [
        new MessageItem('Set up your vault to get started', 'shield'),
        Object.assign(new MessageItem('Run “DevVault: Unlock Vault”', 'unlock'), {
          command: {
            command: 'devvault.unlock',
            title: 'Unlock Vault',
          },
        }),
      ];
    }
    if (status === 'locked') {
      return [
        Object.assign(new MessageItem('Vault is locked', 'lock'), {
          command: {
            command: 'devvault.unlock',
            title: 'Unlock Vault',
          },
        }),
      ];
    }

    const entries = this.vault.listMeta();
    if (entries.length === 0) {
      return [
        Object.assign(new MessageItem('No entries yet — click + to add', 'info'), {
          command: {
            command: 'devvault.add',
            title: 'Add Entry',
          },
        }),
      ];
    }
    return entries.map((e) => new VaultEntryItem(e));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
