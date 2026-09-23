export function isAllowedEmail(email: string, domain: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${domain.toLowerCase()}`);
}
