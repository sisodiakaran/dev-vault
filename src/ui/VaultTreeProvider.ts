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
    // Return [] so package.json viewsWelcome can render unlock / add CTAs.
    // Tree rows are only used once there are real vault entries.
    if (status === 'uninitialized' || status === 'locked') {
      return [];
    }

    const entries = this.vault.listMeta();
    if (entries.length === 0) {
      return [];
    }
    return entries.map((e) => new VaultEntryItem(e));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
