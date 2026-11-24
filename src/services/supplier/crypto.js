import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export class FulfillmentCipher {
  constructor(key) {
    this.key = typeof key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(key) ? Buffer.from(key, 'base64') : null;
    if (this.key?.length !== 32) this.key = null;
  }
  get ready() { return Boolean(this.key); }
  seal(value, context) {
    if (!this.ready) throw new Error('FULFILLMENT_KEY_REQUIRED');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64')).join('.');
  }
  open(value, context) {
    try {
      const [iv, tag, data] = value.split('.').map(s => Buffer.from(s, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8'));
    } catch { throw new Error('FULFILLMENT_DECRYPT_FAILED'); }
  }
}
