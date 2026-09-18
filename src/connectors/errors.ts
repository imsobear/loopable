/**
 * Worth trying again: the service was unreachable, overloaded, or asked us to
 * slow down. Connectors raise this so the dispatcher can retry without knowing
 * anything about a particular service's status codes.
 */
export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

/**
 * Matched by name as well as by class, because the app and the dispatcher each
 * load their own copy of this module and instanceof would not survive the trip.
 */
export function isTransient(error: unknown): boolean {
  return error instanceof TransientError || (error as Error | null)?.name === "TransientError";
}
