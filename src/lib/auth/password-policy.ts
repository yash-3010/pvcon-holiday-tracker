export interface PasswordPolicy {
  minLength: number;
}

/** bcrypt only uses the first 72 bytes, so longer passwords are rejected. */
export const PASSWORD_MAX_LENGTH = 72;

export function passwordProblems(password: string, policy: PasswordPolicy): string[] {
  const problems: string[] = [];
  if (password.length < policy.minLength) problems.push(`At least ${policy.minLength} characters`);
  if (password.length > PASSWORD_MAX_LENGTH) problems.push(`At most ${PASSWORD_MAX_LENGTH} characters`);
  if (!/[a-z]/.test(password)) problems.push("A lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("An uppercase letter");
  if (!/\d/.test(password)) problems.push("A number");
  return problems;
}
