/** `setValueAs` for selects/number inputs whose empty option means "none". */
export const idOrNull = (value: unknown): number | null =>
  value === "" || value === null || value === undefined ? null : Number(value);

/** `setValueAs` for enum selects whose empty option means "not set". */
export const textOrNull = (value: unknown) => (value === "" || value === undefined ? null : value);
