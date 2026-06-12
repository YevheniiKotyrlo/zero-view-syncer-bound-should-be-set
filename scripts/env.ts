// Shared constants for the repro scripts. Ports are uncommon on purpose so
// the sandbox never collides with a real local stack.
export const UPSTREAM_DB = 'postgresql://repro:repro@127.0.0.1:5599/repro';

// Each leg gets its own port block: zero-cache binds more than its public
// port (the change-streamer takes a derived port), and anything left over
// from an earlier leg — or anything else alive on a CI runner — must never
// be able to EADDRINUSE the next leg's boot.
const LEG_PORT_BLOCKS: Record<string, number> = {
  'stock': 4910,
  'take-only': 4930,
  'zqlite-only': 4950,
  'both': 4970,
};

export interface LegPorts {
  zeroPort: number;
  zeroServer: string;
  queryPort: number;
  queryUrl: string;
}

export const computeLegPorts = (leg: string): LegPorts => {
  const base = LEG_PORT_BLOCKS[leg] ?? 4990;
  return {
    zeroPort: base,
    zeroServer: `http://127.0.0.1:${String(base)}`,
    queryPort: base + 8,
    queryUrl: `http://127.0.0.1:${String(base + 8)}/query`,
  };
};
