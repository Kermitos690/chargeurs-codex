export const CUSTOMER_PASSWORD_MIN_LENGTH = 12;

export function signupNeedsEmailConfirmation(session: unknown): boolean {
  return !session;
}
