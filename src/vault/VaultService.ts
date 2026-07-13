import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { showTransientToast } from '../ui/transientToast';
import { CryptoService } from './CryptoService';
import type {
  EncryptedBlob,
  VaultEntry,
  VaultEntryMeta,
  VaultEntrySecrets,
  VaultIndex,
  VaultPayload,
  VaultStatus,
} from './types';

const SECRET_KEY = 'devvault.vault.encrypted';
const INDEX_KEY = 'devvault.vault.index';
const SETUP_FLAG_KEY = 'devvault.vault.initialized';
const SESSION_PASSWORD_KEY = 'devvault.session.masterPassword';
const SESSION_EXPIRES_KEY = 'devvault.session.expiresAt';

/** Legacy keys from the DevPass rename — migrated once on activate. */
const LEGACY_SECRET_KEY = 'devpass.vault.encrypted';
const LEGACY_INDEX_KEY = 'devpass.vault.index';
const LEGACY_SETUP_FLAG_KEY = 'devpass.vault.initialized';

export class VaultService {
  private readonly crypto = new CryptoService();
  private masterPassword: string | undefined;
  private secretsCache: Record<string, VaultEntrySecrets> = {};
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private sessionExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Move vault data from DevPass keys if present. */
  async migrateFromLegacy(): Promise<void> {
    const already = this.context.globalState.get<boolean>(SETUP_FLAG_KEY);
    if (already) {
      return;
    }
    const legacyInitialized = this.context.globalState.get<boolean>(LEGACY_SETUP_FLAG_KEY);
    if (!legacyInitialized) {
      return;
    }

    const legacyIndex = this.context.globalState.get<VaultIndex>(LEGACY_INDEX_KEY);
    if (legacyIndex) {
      await this.context.globalState.update(INDEX_KEY, legacyIndex);
    }
    await this.context.globalState.update(SETUP_FLAG_KEY, true);

    const legacySecret = await this.context.secrets.get(LEGACY_SECRET_KEY);
    if (legacySecret) {
      await this.context.secrets.store(SECRET_KEY, legacySecret);
      await this.context.secrets.delete(LEGACY_SECRET_KEY);
    }

    await this.context.globalState.update(LEGACY_INDEX_KEY, undefined);
    await this.context.globalState.update(LEGACY_SETUP_FLAG_KEY, undefined);
  }

  get status(): VaultStatus {
    if (!this.context.globalState.get<boolean>(SETUP_FLAG_KEY)) {
      return 'uninitialized';
    }
    return this.masterPassword ? 'unlocked' : 'locked';
  }

  get isUnlocked(): boolean {
    return this.status === 'unlocked';
  }

  async updateContextKeys(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'devvault.unlocked', this.isUnlocked);
    await vscode.commands.executeCommand(
      'setContext',
      'devvault.initialized',
      this.status !== 'uninitialized'
    );
  }

  touchActivity(): void {
    if (!this.isUnlocked) {
      return;
    }
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    const minutes = getDevVaultConfig().get<number>('idleLockMinutes', 15);
    if (minutes <= 0) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      // Keep remembered session so reload/restart can unlock within the remember window.
      void this.lock('Vault locked due to inactivity.', { clearRememberedSession: false });
    }, minutes * 60_000);
  }

  private clearSessionExpiryTimer(): void {
    if (this.sessionExpiryTimer) {
      clearTimeout(this.sessionExpiryTimer);
      this.sessionExpiryTimer = undefined;
    }
  }

  private scheduleSessionExpiry(expiresAt: number): void {
    this.clearSessionExpiryTimer();
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      return;
    }
    this.sessionExpiryTimer = setTimeout(() => {
      void this.lock('Remembered unlock expired. Enter your master password again.');
    }, remaining);
  }

  private async saveRememberedSession(masterPassword: string): Promise<void> {
    const hours = getDevVaultConfig().get<number>('rememberUnlockHours', 24);
    if (hours <= 0) {
      await this.clearRememberedSession();
      return;
    }
    const expiresAt = Date.now() + hours * 3_600_000;
    await this.context.secrets.store(SESSION_PASSWORD_KEY, masterPassword);
    await this.context.globalState.update(SESSION_EXPIRES_KEY, expiresAt);
    this.scheduleSessionExpiry(expiresAt);
  }

  private async clearRememberedSession(): Promise<void> {
    this.clearSessionExpiryTimer();
    await this.context.secrets.delete(SESSION_PASSWORD_KEY);
    await this.context.globalState.update(SESSION_EXPIRES_KEY, undefined);
  }

  /**
   * If a remembered unlock session is still valid, unlock silently.
   * Returns true when the vault was unlocked from the session.
   */
  async tryRestoreSession(): Promise<boolean> {
    if (this.status !== 'locked') {
      return false;
    }
    const hours = getDevVaultConfig().get<number>('rememberUnlockHours', 24);
    if (hours <= 0) {
      await this.clearRememberedSession();
      return false;
    }
    const expiresAt = this.context.globalState.get<number>(SESSION_EXPIRES_KEY);
    if (!expiresAt || Date.now() >= expiresAt) {
      await this.clearRememberedSession();
      return false;
    }
    const password = await this.context.secrets.get(SESSION_PASSWORD_KEY);
    if (!password) {
      await this.clearRememberedSession();
      return false;
    }
    try {
      await this.unlock(password, { persistSession: false });
      this.scheduleSessionExpiry(expiresAt);
      return true;
    } catch {
      await this.clearRememberedSession();
      return false;
    }
  }

  private getIndex(): VaultIndex {
    return (
      this.context.globalState.get<VaultIndex>(INDEX_KEY) ?? {
        version: 1,
        entries: [],
      }
    );
  }

  private async saveIndex(index: VaultIndex): Promise<void> {
    await this.context.globalState.update(INDEX_KEY, index);
  }

  private async loadEncryptedBlob(): Promise<EncryptedBlob | undefined> {
    const raw = await this.context.secrets.get(SECRET_KEY);
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as EncryptedBlob;
  }

  private async persistSecrets(masterPassword: string): Promise<void> {
    const payload: VaultPayload = {
      version: 1,
      entries: this.secretsCache,
    };
    const existing = await this.loadEncryptedBlob();
    const salt = existing ? Buffer.from(existing.salt, 'base64') : undefined;
    const blob = this.crypto.encrypt(JSON.stringify(payload), masterPassword, salt);
    await this.context.secrets.store(SECRET_KEY, JSON.stringify(blob));
  }

  async setup(masterPassword: string): Promise<void> {
    if (this.status !== 'uninitialized') {
      throw new Error('Vault is already initialized');
    }
    this.secretsCache = {};
    this.masterPassword = masterPassword;
    await this.persistSecrets(masterPassword);
    await this.saveIndex({ version: 1, entries: [] });
    await this.context.globalState.update(SETUP_FLAG_KEY, true);
    await this.saveRememberedSession(masterPassword);
    this.resetIdleTimer();
    await this.updateContextKeys();
    this._onDidChange.fire();
  }

  async unlock(
    masterPassword: string,
    options?: { persistSession?: boolean }
  ): Promise<void> {
    if (this.status === 'uninitialized') {
      throw new Error('Vault is not set up yet');
    }
    const blob = await this.loadEncryptedBlob();
    if (!blob) {
      throw new Error('Vault data is missing');
    }
    let payload: VaultPayload;
    try {
      const json = this.crypto.decrypt(blob, masterPassword);
      payload = JSON.parse(json) as VaultPayload;
    } catch {
      throw new Error('Incorrect master password');
    }
    this.masterPassword = masterPassword;
    this.secretsCache = payload.entries ?? {};
    if (options?.persistSession !== false) {
      await this.saveRememberedSession(masterPassword);
    }
    this.resetIdleTimer();
    await this.updateContextKeys();
    this._onDidChange.fire();
  }

  async lock(
    message?: string,
    options?: { clearRememberedSession?: boolean }
  ): Promise<void> {
    this.masterPassword = undefined;
    this.secretsCache = {};
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (options?.clearRememberedSession !== false) {
      await this.clearRememberedSession();
    } else {
      this.clearSessionExpiryTimer();
      const expiresAt = this.context.globalState.get<number>(SESSION_EXPIRES_KEY);
      if (expiresAt && expiresAt > Date.now()) {
        this.scheduleSessionExpiry(expiresAt);
      }
    }
    await this.updateContextKeys();
    this._onDidChange.fire();
    if (message) {
      showTransientToast(message);
    }
  }

  listMeta(): VaultEntryMeta[] {
    this.touchActivity();
    return [...this.getIndex().entries].sort((a, b) => a.name.localeCompare(b.name));
  }

  getEntry(id: string): VaultEntry | undefined {
    this.ensureUnlocked();
    this.touchActivity();
    const meta = this.getIndex().entries.find((e) => e.id === id);
    if (!meta) {
      return undefined;
    }
    const secrets = this.secretsCache[id] ?? { password: '', notes: '' };
    return { ...meta, ...secrets };
  }

  async addEntry(input: {
    name: string;
    url: string;
    username: string;
    password: string;
    notes?: string;
    tags?: string[];
  }): Promise<VaultEntry> {
    this.ensureUnlocked();
    this.touchActivity();
    const now = Date.now();
    const id = randomUUID();
    const meta: VaultEntryMeta = {
      id,
      name: input.name.trim(),
      url: input.url.trim(),
      username: input.username.trim(),
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    const secrets: VaultEntrySecrets = {
      password: input.password,
      notes: input.notes?.trim() ?? '',
    };

    const index = this.getIndex();
    index.entries.push(meta);
    this.secretsCache[id] = secrets;
    await this.saveIndex(index);
    await this.persistSecrets(this.masterPassword!);
    this._onDidChange.fire();
    return { ...meta, ...secrets };
  }

  async updateEntry(
    id: string,
    input: {
      name: string;
      url: string;
      username: string;
      password: string;
      notes?: string;
      tags?: string[];
    }
  ): Promise<VaultEntry> {
    this.ensureUnlocked();
    this.touchActivity();
    const index = this.getIndex();
    const idx = index.entries.findIndex((e) => e.id === id);
    if (idx < 0) {
      throw new Error('Entry not found');
    }
    const existing = index.entries[idx];
    const meta: VaultEntryMeta = {
      ...existing,
      name: input.name.trim(),
      url: input.url.trim(),
      username: input.username.trim(),
      tags: input.tags ?? existing.tags,
      updatedAt: Date.now(),
    };
    const secrets: VaultEntrySecrets = {
      password: input.password,
      notes: input.notes?.trim() ?? '',
    };
    index.entries[idx] = meta;
    this.secretsCache[id] = secrets;
    await this.saveIndex(index);
    await this.persistSecrets(this.masterPassword!);
    this._onDidChange.fire();
    return { ...meta, ...secrets };
  }

  async deleteEntry(id: string): Promise<void> {
    this.ensureUnlocked();
    this.touchActivity();
    const index = this.getIndex();
    index.entries = index.entries.filter((e) => e.id !== id);
    delete this.secretsCache[id];
    await this.saveIndex(index);
    await this.persistSecrets(this.masterPassword!);
    this._onDidChange.fire();
  }

  findByUrl(urlOrHost: string): VaultEntryMeta[] {
    this.ensureUnlocked();
    this.touchActivity();
    const needle = normalizeHost(urlOrHost);
    if (!needle) {
      return this.listMeta();
    }
    return this.listMeta().filter((e) => {
      const host = normalizeHost(e.url);
      return host === needle || host.endsWith(`.${needle}`) || needle.endsWith(`.${host}`) || e.url.includes(needle);
    });
  }

  async changeMasterPassword(currentPassword: string, newPassword: string): Promise<void> {
    if (this.status === 'uninitialized') {
      throw new Error('Vault is not set up yet');
    }
    // Verify current password by unlocking if locked, or comparing decrypt
    if (!this.isUnlocked) {
      await this.unlock(currentPassword);
    } else if (this.masterPassword !== currentPassword) {
      // Re-verify by attempting decrypt
      const blob = await this.loadEncryptedBlob();
      if (!blob) {
        throw new Error('Vault data is missing');
      }
      try {
        this.crypto.decrypt(blob, currentPassword);
      } catch {
        throw new Error('Incorrect master password');
      }
    }

    this.masterPassword = newPassword;
    const payload: VaultPayload = {
      version: 1,
      entries: this.secretsCache,
    };
    const blob = this.crypto.reencrypt(JSON.stringify(payload), newPassword);
    await this.context.secrets.store(SECRET_KEY, JSON.stringify(blob));
    await this.saveRememberedSession(newPassword);
    this.resetIdleTimer();
    this._onDidChange.fire();
  }

  private disposed = false;

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.masterPassword = undefined;
    this.secretsCache = {};
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    this.clearSessionExpiryTimer();
    this._onDidChange.dispose();
  }

  private ensureUnlocked(): void {
    if (!this.isUnlocked) {
      throw new Error('Vault is locked');
    }
  }
}

/** Workspace settings for DevVault (`devvault.*`). */
export function getDevVaultConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('devvault');
}

export function normalizeHost(urlOrHost: string): string {
  const raw = urlOrHost.trim().toLowerCase();
  if (!raw) {
    return '';
  }
  try {
    const withScheme = raw.includes('://') ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^www\./, '').split('/')[0] ?? raw;
  }
}
