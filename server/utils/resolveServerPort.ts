/**
 * Resolves the TCP port the Express API binds to, from `SERVER_PORT`.
 *
 * Deliberately a hard failure rather than a default, mirroring the same throw
 * in `vite.config.ts`. A silent fallback would let the Vite `/api` proxy point
 * at a port nothing is listening on, which surfaces much later as an
 * unexplained 500 in the browser instead of a one-line startup error.
 * @returns The validated port number from `process.env.SERVER_PORT`
 * @throws {Error} When `SERVER_PORT` is unset/empty, or is not an integer in 1..65535
 */
export function resolveServerPort(): number {
  const rawServerPort = process.env.SERVER_PORT;
  if (!rawServerPort) {
    throw new Error("SERVER_PORT is not defined in environment variables");
  }

  const parsedServerPort = Number.parseInt(rawServerPort, 10);
  const portIsAnInteger = Number.isInteger(parsedServerPort);
  const portIsAboveZero = parsedServerPort > 0;
  const portIsWithinRange = parsedServerPort <= 65535;
  const portIsUsable = portIsAnInteger && portIsAboveZero && portIsWithinRange;

  if (!portIsUsable) {
    throw new Error(`SERVER_PORT is not a valid TCP port: "${rawServerPort}"`);
  }

  return parsedServerPort;
}
