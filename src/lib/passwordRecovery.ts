/**
 * Password-reset links created before the move to an implicit recovery flow
 * can contain a PKCE code. That code is intentionally bound to the browser
 * that requested it and cannot be recovered safely on another device.
 *
 * Never expose the Supabase implementation detail to customers or admins.
 */
export function recoveryLinkErrorMessage(error?: string): string {
  if (/pkce code verifier/i.test(error ?? "")) {
    return "Ce lien a été ouvert dans un autre navigateur ou a été créé avec une ancienne configuration. Demandez un nouveau lien de réinitialisation.";
  }

  return "Ce lien est invalide, expiré ou a déjà été utilisé. Demandez un nouveau lien de réinitialisation.";
}
