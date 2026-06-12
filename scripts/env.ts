// Shared constants for the repro scripts. Ports are uncommon on purpose so
// the sandbox never collides with a real local stack.
export const UPSTREAM_DB = 'postgresql://repro:repro@127.0.0.1:5599/repro';
export const ZERO_PORT = 4999;
export const ZERO_SERVER = `http://127.0.0.1:${ZERO_PORT}`;
export const QUERY_PORT = 4998;
export const QUERY_URL = `http://127.0.0.1:${QUERY_PORT}/query`;
