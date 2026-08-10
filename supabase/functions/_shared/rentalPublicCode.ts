// Public session codes are bearer capabilities used only to poll a single
// rental status. They are not activation codes and must have enough entropy to
// resist guessing while a checkout is pending.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;
const BYTE_LIMIT = 256 - (256 % ALPHABET.length);

export function createRentalPublicCode(
  fillRandom: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  let value = "";
  while (value.length < CODE_LENGTH) {
    const bytes = fillRandom(new Uint8Array(32));
    for (const byte of bytes) {
      // Rejection sampling avoids modulo bias while mapping bytes to symbols.
      if (byte >= BYTE_LIMIT) continue;
      value += ALPHABET[byte % ALPHABET.length];
      if (value.length === CODE_LENGTH) break;
    }
  }
  return `CHG-${value}`;
}

export function isRentalPublicCode(value: unknown): value is string {
  return typeof value === "string" && /^CHG-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,32}$/.test(value);
}
