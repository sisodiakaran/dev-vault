export interface VaultEntryMeta {
  id: string;
  name: string;
  url: string;
  username: string;
  tags: string[];
  updatedAt: number;
  createdAt: number;
}

export interface VaultEntrySecrets {
  password: string;
  notes: string;
}

export interface VaultEntry extends VaultEntryMeta, VaultEntrySecrets {}

export interface VaultIndex {
  version: 1;
  entries: VaultEntryMeta[];
}

/** Full decrypted vault payload stored encrypted in SecretStorage. */
export interface VaultPayload {
  version: 1;
  entries: Record<string, VaultEntrySecrets>;
}

export interface EncryptedBlob {
  /** base64 salt used for key derivation */
  salt: string;
  /** base64 IV */
  iv: string;
  /** base64 ciphertext */
  ciphertext: string;
  /** PBKDF2 iteration count */
  iterations: number;
}

export type VaultStatus = 'uninitialized' | 'locked' | 'unlocked';
