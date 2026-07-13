import * as vscode from 'vscode';
import { SecureClipboard } from './clipboard/SecureClipboard';
import { generatePassword } from './generator/PasswordGenerator';
import { assistBrowserLogin } from './ui/BrowserFill';
import { promptMasterPassword } from './ui/EntryEditor';
import { showEntryForm } from './ui/EntryFormPanel';
import { showTransientToast } from './ui/transientToast';
import { VaultEntryItem, VaultTreeProvider } from './ui/VaultTreeProvider';
import { VaultStatusBar } from './ui/VaultStatusBar';
import { VaultService, getDevVaultConfig } from './vault/VaultService';

let vault: VaultService | undefined;
let clipboard: SecureClipboard | undefined;
let treeProvider: VaultTreeProvider | undefined;
let statusBar: VaultStatusBar | undefined;

export function activate(context: vscode.ExtensionContext): void {
  vault = new VaultService(context);
  clipboard = new SecureClipboard();
  treeProvider = new VaultTreeProvider(vault);
  statusBar = new VaultStatusBar(vault, clipboard, context);

  void (async () => {
    await vault?.migrateFromLegacy();
    const restored = await vault?.tryRestoreSession();
    await vault?.updateContextKeys();
    treeProvider?.refresh();
    statusBar?.refresh();
    if (restored) {
      void vscode.window.setStatusBarMessage('DevVault unlocked from remembered session', 3000);
    }
  })();

  context.subscriptions.push(
    vault,
    clipboard,
    treeProvider,
    statusBar,
    vscode.window.createTreeView('devvault.vault', {
      treeDataProvider: treeProvider,
      showCollapseAll: false,
    }),
    vscode.commands.registerCommand('devvault.unlock', () => withVault((v) => unlockCommand(v))),
    vscode.commands.registerCommand('devvault.lock', () => withVault((v) => v.lock('Vault locked.'))),
    vscode.commands.registerCommand('devvault.add', () => withVault((v) => addCommand(v))),
    vscode.commands.registerCommand('devvault.edit', (item?: VaultEntryItem) =>
      withVault((v) => editCommand(v, item))
    ),
    vscode.commands.registerCommand('devvault.delete', (item?: VaultEntryItem) =>
      withVault((v) => deleteCommand(v, item))
    ),
    vscode.commands.registerCommand('devvault.entryActions', (item?: VaultEntryItem) =>
      withVault((v) => entryActionsCommand(v, item))
    ),
    vscode.commands.registerCommand('devvault.copyUsername', (item?: VaultEntryItem) =>
      withVault((v) => copyUsernameCommand(v, item))
    ),
    vscode.commands.registerCommand('devvault.copyPassword', (item?: VaultEntryItem) =>
      withVault((v) => copyPasswordCommand(v, item))
    ),
    vscode.commands.registerCommand('devvault.reveal', (item?: VaultEntryItem) =>
      withVault((v) => revealCommand(v, item))
    ),
    vscode.commands.registerCommand('devvault.fillForUrl', () => withVault((v) => fillForUrlCommand(v))),
    vscode.commands.registerCommand('devvault.openInBrowser', (item?: VaultEntryItem) =>
      withVault((v) => openInBrowserCommand(v, item))
    ),
    vscode.commands.registerCommand('devvault.generatePassword', () => generatePasswordCommand()),
    vscode.commands.registerCommand('devvault.refresh', () => treeProvider?.refresh()),
    vscode.commands.registerCommand('devvault.changeMasterPassword', () =>
      withVault((v) => changeMasterPasswordCommand(v))
    )
  );
}

export function deactivate(): void {
  vault?.dispose();
  clipboard?.dispose();
  treeProvider?.dispose();
  statusBar?.dispose();
  vault = undefined;
  clipboard = undefined;
  treeProvider = undefined;
  statusBar = undefined;
}

async function withVault<T>(fn: (v: VaultService) => Promise<T> | T): Promise<T | undefined> {
  if (!vault) {
    void vscode.window.showErrorMessage('DevVault is not ready');
    return undefined;
  }
  try {
    return await fn(vault);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DevVault: ${message}`);
    return undefined;
  }
}

async function ensureUnlocked(v: VaultService): Promise<boolean> {
  if (v.isUnlocked) {
    return true;
  }
  await unlockCommand(v);
  return v.isUnlocked;
}

async function unlockCommand(v: VaultService): Promise<void> {
  if (v.isUnlocked) {
    showTransientToast('Vault is already unlocked');
    return;
  }

  if (v.status === 'uninitialized') {
    const confirm = await vscode.window.showInformationMessage(
      'Create a new local DevVault vault? A master password encrypts all credentials on this machine.',
      { modal: true },
      'Create Vault'
    );
    if (confirm !== 'Create Vault') {
      return;
    }
    const password = await promptMasterPassword('DevVault: Create Master Password', true);
    if (!password) {
      return;
    }
    await v.setup(password);
    showTransientToast('DevVault vault created and unlocked');
    return;
  }

  const password = await promptMasterPassword('DevVault: Unlock Vault');
  if (!password) {
    return;
  }
  await v.unlock(password);
  showTransientToast('Vault unlocked');
}

async function addCommand(v: VaultService): Promise<void> {
  if (!(await ensureUnlocked(v))) {
    return;
  }
  const input = await showEntryForm('add');
  if (!input) {
    return;
  }
  const created = await v.addEntry(input);
  await statusBar?.setActiveEntry(created.id);
  showTransientToast(`Added “${input.name}”`);
}

async function resolveEntry(
  v: VaultService,
  item?: VaultEntryItem
): Promise<ReturnType<VaultService['getEntry']>> {
  if (!(await ensureUnlocked(v))) {
    return undefined;
  }
  if (item?.entry) {
    return v.getEntry(item.entry.id);
  }
  const picked = await pickEntry(v);
  if (!picked) {
    return undefined;
  }
  return v.getEntry(picked.id);
}

async function pickEntry(v: VaultService, filterUrl?: string) {
  const entries = filterUrl ? v.findByUrl(filterUrl) : v.listMeta();
  if (entries.length === 0) {
    showTransientToast(
      filterUrl ? `No entries match “${filterUrl}”` : 'No entries in vault'
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    entries.map((e) => ({
      label: e.name,
      description: e.username,
      detail: e.url,
      entry: e,
    })),
    {
      title: filterUrl ? `DevVault: Entries for ${filterUrl}` : 'DevVault: Select Entry',
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    }
  );
  return picked?.entry;
}

async function editCommand(v: VaultService, item?: VaultEntryItem): Promise<void> {
  const entry = await resolveEntry(v, item);
  if (!entry) {
    return;
  }
  const input = await showEntryForm('edit', entry);
  if (!input) {
    return;
  }
  await v.updateEntry(entry.id, input);
  showTransientToast(`Updated “${input.name}”`);
}

async function entryActionsCommand(v: VaultService, item?: VaultEntryItem): Promise<void> {
  const entry = await resolveEntry(v, item);
  if (!entry) {
    return;
  }

  const target = item ?? new VaultEntryItem(entry);
  type ActionId = 'copyUsername' | 'copyPassword' | 'openInBrowser' | 'reveal' | 'edit' | 'delete';
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(account) Copy Username', id: 'copyUsername' as ActionId },
      { label: '$(key) Copy Password', id: 'copyPassword' as ActionId },
      { label: '$(link-external) Open in Browser & Login', id: 'openInBrowser' as ActionId },
      { label: '$(eye) Reveal Password', id: 'reveal' as ActionId },
      { label: '$(edit) Edit Entry', id: 'edit' as ActionId },
      { label: '$(trash) Delete Entry', id: 'delete' as ActionId },
    ],
    {
      title: entry.name,
      placeHolder: 'Choose an action',
    }
  );
  if (!picked) {
    return;
  }

  switch (picked.id) {
    case 'copyUsername':
      await copyUsernameCommand(v, target);
      break;
    case 'copyPassword':
      await copyPasswordCommand(v, target);
      break;
    case 'openInBrowser':
      await openInBrowserCommand(v, target);
      break;
    case 'reveal':
      await revealCommand(v, target);
      break;
    case 'edit':
      await editCommand(v, target);
      break;
    case 'delete':
      await deleteCommand(v, target);
      break;
  }
}

async function deleteCommand(v: VaultService, item?: VaultEntryItem): Promise<void> {
  const entry = await resolveEntry(v, item);
  if (!entry) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Delete “${entry.name}”? This cannot be undone.`,
    { modal: true },
    'Delete'
  );
  if (confirm !== 'Delete') {
    return;
  }
  await v.deleteEntry(entry.id);
  await statusBar?.clearActiveEntryIf(entry.id);
  showTransientToast(`Deleted “${entry.name}”`);
}

async function copyUsernameCommand(v: VaultService, item?: VaultEntryItem): Promise<void> {
  const entry = await resolveEntry(v, item);
  if (!entry || !clipboard) {
    return;
  }
  await statusBar?.setActiveEntry(entry.id);
  await clipboard.copy(entry.username, 'Username');
}

async function copyPasswordCommand(v: VaultService, item?: VaultEntryItem): Promise<void> {
  const entry = await resolveEntry(v, item);
  if (!entry || !clipboard) {
    return;
  }
  await statusBar?.setActiveEntry(entry.id);
  await clipboard.copy(entry.password, 'Password');
}

async function revealCommand(v: VaultService, item?: VaultEntryItem): Promise<void> {
  const entry = await resolveEntry(v, item);
  if (!entry) {
    return;
  }
  const action = await vscode.window.showInformationMessage(
    `Password for “${entry.name}”: ${entry.password}`,
    'Copy Password',
    'Dismiss'
  );
  if (action === 'Copy Password' && clipboard) {
    await clipboard.copy(entry.password, 'Password');
  }
}

async function openInBrowserCommand(v: VaultService, item?: VaultEntryItem): Promise<void> {
  const entry = await resolveEntry(v, item);
  if (!entry || !clipboard) {
    return;
  }
  await statusBar?.setActiveEntry(entry.id);
  await assistBrowserLogin(entry, clipboard);
}

async function fillForUrlCommand(v: VaultService): Promise<void> {
  if (!(await ensureUnlocked(v))) {
    return;
  }

  const editorUrl = vscode.window.activeTextEditor?.document.getText(
    vscode.window.activeTextEditor.selection
  );
  const clipboardText = await vscode.env.clipboard.readText();
  const suggestion = guessUrl(editorUrl) || guessUrl(clipboardText) || '';

  const url = await vscode.window.showInputBox({
    title: 'DevVault: Fill for URL',
    prompt: 'Enter URL or domain to find matching credentials',
    value: suggestion,
    ignoreFocusOut: true,
    placeHolder: 'https://localhost:3000',
  });
  if (url === undefined) {
    return;
  }

  const entryMeta = await pickEntry(v, url.trim() || undefined);
  if (!entryMeta) {
    return;
  }
  const entry = v.getEntry(entryMeta.id);
  if (!entry || !clipboard) {
    return;
  }

  await statusBar?.setActiveEntry(entry.id);

  const action = await vscode.window.showQuickPick(
    [
      { label: '$(globe) Open in Browser & Login', id: 'browser' },
      { label: '$(account) Copy username', id: 'user' },
      { label: '$(lock) Copy password', id: 'pass' },
      { label: '$(files) Copy username, then password', id: 'both' },
    ],
    {
      title: `${entry.name} — ${entry.url}`,
      ignoreFocusOut: true,
    }
  );
  if (!action) {
    return;
  }

  if (action.id === 'browser') {
    await assistBrowserLogin(entry, clipboard);
    return;
  }

  if (action.id === 'user') {
    await clipboard.copy(entry.username, 'Username');
  }
  if (action.id === 'pass') {
    await clipboard.copy(entry.password, 'Password');
  }
  if (action.id === 'both') {
    await clipboard.copy(entry.username, 'Username', { notify: false });
    const next = await vscode.window.showInformationMessage(
      'Username copied. Paste it in the browser, then copy the password.',
      'Copy Password'
    );
    if (next === 'Copy Password') {
      await clipboard.copy(entry.password, 'Password');
    }
  }
}

async function generatePasswordCommand(): Promise<void> {
  const config = getDevVaultConfig();
  const password = generatePassword({
    length: config.get<number>('passwordLength', 20),
    includeSymbols: config.get<boolean>('passwordIncludeSymbols', true),
  });
  if (!clipboard) {
    return;
  }
  await clipboard.copy(password, 'Generated password');
}

async function changeMasterPasswordCommand(v: VaultService): Promise<void> {
  if (v.status === 'uninitialized') {
    void vscode.window.showErrorMessage('Create a vault first');
    return;
  }
  const current = await promptMasterPassword('DevVault: Current Master Password');
  if (!current) {
    return;
  }
  const next = await promptMasterPassword('DevVault: New Master Password', true);
  if (!next) {
    return;
  }
  await v.changeMasterPassword(current, next);
  showTransientToast('Master password changed');
}

function guessUrl(text: string | undefined): string {
  if (!text) {
    return '';
  }
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed) || /^localhost(:\d+)?/i.test(trimmed) || /\./.test(trimmed)) {
    return trimmed.split(/\s/)[0] ?? '';
  }
  return '';
}
