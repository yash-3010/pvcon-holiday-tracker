/** A business-rule violation that is safe to show to the user. */
export class DomainError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(code: string, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
