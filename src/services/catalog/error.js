export class LightStoreError extends Error {
  constructor(code, status) {
    super(`Light Store: ${code}`);
    this.name = 'LightStoreError';
    this.code = code;
    this.status = status;
  }
}
