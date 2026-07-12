import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import type { EncryptedBlob } from './types';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const DEFAULT_ITERATIONS = 310_000;

export class CryptoService {
  deriveKey(masterPassword: string, salt: Buffer, iterations = DEFAULT_ITERATIONS): Buffer {
    return pbkdf2Sync(masterPassword, salt, iterations, KEY_LENGTH, 'sha256');
  }

  encrypt(plaintext: string, masterPassword: string, existingSalt?: Buffer): EncryptedBlob {
    const salt = existingSalt ?? randomBytes(SALT_LENGTH);
    const key = this.deriveKey(masterPassword, salt);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([encrypted, authTag]);

    return {
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      iterations: DEFAULT_ITERATIONS,
    };
  }

  decrypt(blob: EncryptedBlob, masterPassword: string): string {
    const salt = Buffer.from(blob.salt, 'base64');
    const iv = Buffer.from(blob.iv, 'base64');
    const data = Buffer.from(blob.ciphertext, 'base64');

    if (data.length < AUTH_TAG_LENGTH) {
      throw new Error('Invalid ciphertext');
    }

    const encrypted = data.subarray(0, data.length - AUTH_TAG_LENGTH);
    const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
    const key = this.deriveKey(masterPassword, salt, blob.iterations);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /** Re-encrypt with a new master password, preserving salt only if same password family not needed. */
  reencrypt(plaintext: string, newMasterPassword: string): EncryptedBlob {
    return this.encrypt(plaintext, newMasterPassword);
  }
}
