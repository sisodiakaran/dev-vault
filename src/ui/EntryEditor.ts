import * as vscode from 'vscode';
import { generatePassword } from '../generator/PasswordGenerator';
import type { VaultEntry } from '../vault/types';
import { getDevVaultConfig } from '../vault/VaultService';

export async function promptMasterPassword(
  title: string,
  confirm = false
): Promise<string | undefined> {
  const password = await vscode.window.showInputBox({
    title,
    prompt: 'Enter master password',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.length < 8 ? 'Master password must be at least 8 characters' : undefined),
  });
  if (password === undefined) {
    return undefined;
  }
  if (!confirm) {
    return password;
  }
  const again = await vscode.window.showInputBox({
    title,
    prompt: 'Confirm master password',
    password: true,
    ignoreFocusOut: true,
  });
  if (again === undefined) {
    return undefined;
  }
  if (again !== password) {
    void vscode.window.showErrorMessage('Passwords do not match');
    return undefined;
  }
  return password;
}

export async function promptNewEntry(): Promise<
  | {
      name: string;
      url: string;
      username: string;
      password: string;
      notes: string;
      tags: string[];
    }
  | undefined
> {
  const name = await vscode.window.showInputBox({
    title: 'DevVault: Add Entry',
    prompt: 'Entry name (e.g. Staging Admin)',
    ignoreFocusOut: true,
    validateInput: (v) => (!v.trim() ? 'Name is required' : undefined),
  });
  if (name === undefined) {
    return undefined;
  }

  const url = await vscode.window.showInputBox({
    title: 'DevVault: Add Entry',
    prompt: 'URL or domain (e.g. https://localhost:3000 or staging.example.com)',
    ignoreFocusOut: true,
    placeHolder: 'https://localhost:3000',
  });
  if (url === undefined) {
    return undefined;
  }

  const username = await vscode.window.showInputBox({
    title: 'DevVault: Add Entry',
    prompt: 'Username or email',
    ignoreFocusOut: true,
  });
  if (username === undefined) {
    return undefined;
  }

  const password = await promptPasswordField('DevVault: Add Entry');
  if (password === undefined) {
    return undefined;
  }

  const notes = await vscode.window.showInputBox({
    title: 'DevVault: Add Entry',
    prompt: 'Notes (optional)',
    ignoreFocusOut: true,
  });
  if (notes === undefined) {
    return undefined;
  }

  const tagsRaw = await vscode.window.showInputBox({
    title: 'DevVault: Add Entry',
    prompt: 'Tags (comma-separated, optional)',
    ignoreFocusOut: true,
    placeHolder: 'staging, admin',
  });
  if (tagsRaw === undefined) {
    return undefined;
  }

  return {
    name,
    url,
    username,
    password,
    notes,
    tags: tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

export async function promptEditEntry(existing: VaultEntry): Promise<
  | {
      name: string;
      url: string;
      username: string;
      password: string;
      notes: string;
      tags: string[];
    }
  | undefined
> {
  const name = await vscode.window.showInputBox({
    title: 'DevVault: Edit Entry',
    prompt: 'Entry name',
    value: existing.name,
    ignoreFocusOut: true,
    validateInput: (v) => (!v.trim() ? 'Name is required' : undefined),
  });
  if (name === undefined) {
    return undefined;
  }

  const url = await vscode.window.showInputBox({
    title: 'DevVault: Edit Entry',
    prompt: 'URL or domain',
    value: existing.url,
    ignoreFocusOut: true,
  });
  if (url === undefined) {
    return undefined;
  }

  const username = await vscode.window.showInputBox({
    title: 'DevVault: Edit Entry',
    prompt: 'Username or email',
    value: existing.username,
    ignoreFocusOut: true,
  });
  if (username === undefined) {
    return undefined;
  }

  const password = await promptPasswordField('DevVault: Edit Entry', existing.password);
  if (password === undefined) {
    return undefined;
  }

  const notes = await vscode.window.showInputBox({
    title: 'DevVault: Edit Entry',
    prompt: 'Notes (optional)',
    value: existing.notes,
    ignoreFocusOut: true,
  });
  if (notes === undefined) {
    return undefined;
  }

  const tagsRaw = await vscode.window.showInputBox({
    title: 'DevVault: Edit Entry',
    prompt: 'Tags (comma-separated, optional)',
    value: existing.tags.join(', '),
    ignoreFocusOut: true,
  });
  if (tagsRaw === undefined) {
    return undefined;
  }

  return {
    name,
    url,
    username,
    password,
    notes,
    tags: tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

async function promptPasswordField(
  title: string,
  current?: string
): Promise<string | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(key) Enter password', id: 'enter' },
      { label: '$(shield) Generate password', id: 'generate' },
      ...(current !== undefined
        ? [{ label: '$(check) Keep current password', id: 'keep' }]
        : []),
    ],
    { title, ignoreFocusOut: true }
  );
  if (!choice) {
    return undefined;
  }
  if (choice.id === 'keep' && current !== undefined) {
    return current;
  }
  if (choice.id === 'generate') {
    const config = getDevVaultConfig();
    return generatePassword({
      length: config.get<number>('passwordLength', 20),
      includeSymbols: config.get<boolean>('passwordIncludeSymbols', true),
    });
  }
  return vscode.window.showInputBox({
    title,
    prompt: 'Password',
    password: true,
    ignoreFocusOut: true,
    value: current,
    validateInput: (v) => (!v ? 'Password is required' : undefined),
  });
}
