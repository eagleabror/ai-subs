export const nonnegativeInteger = (extra = {}) => ({
  type: Number, min: 0, validate: Number.isSafeInteger, ...extra,
});
