# DevVault

Secure credential storage, right where you code.

A local-only password manager for Cursor and VS Code. Store development credentials securely on your machine and copy them into the IDE browser when you need to log in.

> **Note:** VS Code/Cursor does not expose an API to autofill the built-in browser. DevVault copies credentials to the clipboard (with auto-clear) so you can paste them into login forms.

## Features

- **Local vault** — no cloud sync; data never leaves your machine
- **Master password** — AES-256-GCM encryption via PBKDF2 key derivation
- **OS SecretStorage** — encrypted payload stored through VS Code’s secure storage
- **Sidebar vault** — browse, add, edit, and delete entries
- **Quick fill** — match credentials by URL/domain and copy username/password
- **Password generator** — cryptographically strong passwords
- **Clipboard auto-clear** — secrets are wiped after a configurable delay
- **Idle lock** — vault locks after inactivity

## Install (local)

```bash
npm install
npm run package
npm run vsix
```

Install the generated `devvault-0.1.0.vsix` in Cursor/VS Code: **Extensions → … → Install from VSIX…**

### Development

1. Open this folder in Cursor/VS Code
2. Run `npm install` and `npm run watch`
3. Press **F5** to launch the Extension Development Host

## Usage

1. Open the **DevVault** icon in the activity bar
2. Run **DevVault: Unlock Vault** (first run creates a master password)
3. Click **+** to add an entry (name, URL, username, password, notes, tags)
4. Click an entry (or use the inline icons) to copy the password
5. Paste into the Cursor/VS Code built-in browser login form

### Login with the built-in browser

Cursor/VS Code does **not** allow extensions to type into the built-in browser. DevVault opens the page and copies credentials for paste:

1. Unlock the vault and pick an entry (status bar or sidebar)
2. Run **DevVault: Open in Browser & Login** (or click the globe icon on an entry)
3. Paste the username in the browser (`Cmd/Ctrl+V`), then choose **Copy Password** and paste that too

Status bar **Username** / **Password** also copy to the clipboard when you’re in the browser (they fill the editor only when a text file is focused).

### Useful commands

| Command | Description |
| --- | --- |
| `DevVault: Unlock Vault` | Unlock or create the vault |
| `DevVault: Lock Vault` | Lock and clear secrets from memory |
| `DevVault: Add Entry` | Create a credential |
| `DevVault: Fill for URL…` | Find entries by domain and copy |
| `DevVault: Generate Password` | Generate and copy a strong password |
| `DevVault: Change Master Password` | Re-encrypt the vault |

### Keyboard shortcuts

- **Fill for URL:** `Ctrl+Shift+Alt+F` / `Cmd+Shift+Alt+F`
- **Lock vault:** `Ctrl+Shift+Alt+L` / `Cmd+Shift+Alt+L`

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `devvault.clipboardClearSeconds` | `30` | Clear clipboard after N seconds |
| `devvault.idleLockMinutes` | `15` | Auto-lock after idle (0 = disabled) |
| `devvault.passwordLength` | `20` | Generated password length |
| `devvault.passwordIncludeSymbols` | `true` | Include symbols in generated passwords |

## Security model

- **Metadata** (name, URL, username, tags) is stored in VS Code `globalState` (not secret, but not passwords).
- **Passwords and notes** are encrypted with AES-256-GCM and stored via `SecretStorage` (backed by the OS keychain / Electron safeStorage).
- The master password is never persisted; it is held in memory only while the vault is unlocked.
- Locking or deactivating the extension clears in-memory secrets.
- There are **no network calls** related to the vault.

Keep a strong master password. Losing it means you cannot decrypt the vault.

## License

MIT
