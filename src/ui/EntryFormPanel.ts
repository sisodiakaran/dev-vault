import * as vscode from 'vscode';
import { generatePassword } from '../generator/PasswordGenerator';
import type { VaultEntry } from '../vault/types';
import { getDevVaultConfig } from '../vault/VaultService';

export interface EntryFormResult {
  name: string;
  url: string;
  username: string;
  password: string;
  notes: string;
  tags: string[];
}

interface EntryFormSeed {
  name?: string;
  url?: string;
  username?: string;
  password?: string;
  notes?: string;
  tags?: string[];
}

/**
 * Single-step webview dialog for creating or editing a vault entry.
 */
export function showEntryForm(
  mode: 'add' | 'edit',
  existing?: VaultEntry
): Promise<EntryFormResult | undefined> {
  const seed: EntryFormSeed = existing
    ? {
        name: existing.name,
        url: existing.url,
        username: existing.username,
        password: existing.password,
        notes: existing.notes,
        tags: existing.tags,
      }
    : {};

  return new Promise((resolve) => {
    const title = mode === 'add' ? 'DevVault: Add Entry' : 'DevVault: Edit Entry';
    const panel = vscode.window.createWebviewPanel(
      'devvault.entryForm',
      title,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [],
      }
    );

    let settled = false;
    const finish = (value: EntryFormResult | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
      panel.dispose();
    };

    panel.webview.html = getHtml(panel.webview, mode, seed);

    panel.webview.onDidReceiveMessage((msg: { type: string; payload?: EntryFormResult }) => {
      if (msg.type === 'cancel') {
        finish(undefined);
        return;
      }
      if (msg.type === 'generate') {
        const config = getDevVaultConfig();
        const password = generatePassword({
          length: config.get<number>('passwordLength', 20),
          includeSymbols: config.get<boolean>('passwordIncludeSymbols', true),
        });
        void panel.webview.postMessage({ type: 'generated', password });
        return;
      }
      if (msg.type === 'save' && msg.payload) {
        const p = msg.payload;
        if (!p.name?.trim()) {
          void panel.webview.postMessage({ type: 'error', message: 'Name is required' });
          return;
        }
        if (!p.password) {
          void panel.webview.postMessage({ type: 'error', message: 'Password is required' });
          return;
        }
        finish({
          name: p.name.trim(),
          url: (p.url ?? '').trim(),
          username: (p.username ?? '').trim(),
          password: p.password,
          notes: (p.notes ?? '').trim(),
          tags: Array.isArray(p.tags)
            ? p.tags.map((t) => t.trim()).filter(Boolean)
            : String(p.tags ?? '')
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
        });
      }
    });

    panel.onDidDispose(() => finish(undefined));
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getHtml(
  webview: vscode.Webview,
  mode: 'add' | 'edit',
  seed: EntryFormSeed
): string {
  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const name = escapeHtml(seed.name ?? '');
  const url = escapeHtml(seed.url ?? '');
  const username = escapeHtml(seed.username ?? '');
  const password = escapeHtml(seed.password ?? '');
  const notes = escapeHtml(seed.notes ?? '');
  const tags = escapeHtml((seed.tags ?? []).join(', '));
  const submitLabel = mode === 'add' ? 'Add Entry' : 'Save Changes';
  const heading = mode === 'add' ? 'Add Entry' : 'Edit Entry';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(heading)}</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px 24px 28px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    h1 {
      margin: 0 0 4px;
      font-size: 1.25rem;
      font-weight: 600;
    }
    .sub {
      margin: 0 0 20px;
      opacity: 0.75;
      font-size: 0.9em;
    }
    form {
      display: grid;
      gap: 14px;
      max-width: 520px;
    }
    label {
      display: grid;
      gap: 6px;
      font-weight: 500;
    }
    .hint {
      font-weight: 400;
      opacity: 0.65;
      font-size: 0.85em;
    }
    input, textarea {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      font: inherit;
    }
    input:focus, textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    textarea {
      min-height: 72px;
      resize: vertical;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 8px;
      align-items: stretch;
    }
    .row input { grid-column: 1; }
    button {
      font: inherit;
      cursor: pointer;
      border: none;
      border-radius: 2px;
      padding: 7px 14px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 6px;
    }
    .error {
      min-height: 1.2em;
      color: var(--vscode-errorForeground);
      font-size: 0.9em;
    }
    .req::after {
      content: ' *';
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(heading)}</h1>
  <p class="sub">Fill in the fields below, then save.</p>
  <form id="form" autocomplete="off">
    <label>
      <span class="req">Name</span>
      <input id="name" name="name" value="${name}" required autofocus placeholder="Staging Admin" />
    </label>
    <label>
      <span>URL <span class="hint">(optional)</span></span>
      <input id="url" name="url" value="${url}" placeholder="https://localhost:3000" />
    </label>
    <label>
      <span>Username <span class="hint">(optional)</span></span>
      <input id="username" name="username" value="${username}" placeholder="admin@example.com" />
    </label>
    <label>
      <span class="req">Password</span>
      <div class="row">
        <input id="password" name="password" type="password" value="${password}" required />
        <button type="button" id="toggle" title="Show / hide">Show</button>
        <button type="button" id="generate" title="Generate password">Generate</button>
      </div>
    </label>
    <label>
      <span>Notes <span class="hint">(optional)</span></span>
      <textarea id="notes" name="notes" placeholder="Recovery codes, VPN notes…">${notes}</textarea>
    </label>
    <label>
      <span>Tags <span class="hint">(comma-separated, optional)</span></span>
      <input id="tags" name="tags" value="${tags}" placeholder="staging, admin" />
    </label>
    <div class="error" id="error" role="alert"></div>
    <div class="actions">
      <button type="submit" class="primary">${escapeHtml(submitLabel)}</button>
      <button type="button" id="cancel">Cancel</button>
    </div>
  </form>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('form');
    const password = document.getElementById('password');
    const toggle = document.getElementById('toggle');
    const generate = document.getElementById('generate');
    const cancel = document.getElementById('cancel');
    const error = document.getElementById('error');

    toggle.addEventListener('click', () => {
      const show = password.type === 'password';
      password.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
    });

    generate.addEventListener('click', () => {
      vscode.postMessage({ type: 'generate' });
    });

    cancel.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      error.textContent = '';
      const tagsRaw = document.getElementById('tags').value;
      vscode.postMessage({
        type: 'save',
        payload: {
          name: document.getElementById('name').value,
          url: document.getElementById('url').value,
          username: document.getElementById('username').value,
          password: password.value,
          notes: document.getElementById('notes').value,
          tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
        },
      });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'generated') {
        password.value = msg.password;
        password.type = 'text';
        toggle.textContent = 'Hide';
        password.focus();
      }
      if (msg.type === 'error') {
        error.textContent = msg.message || 'Something went wrong';
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        vscode.postMessage({ type: 'cancel' });
      }
    });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
