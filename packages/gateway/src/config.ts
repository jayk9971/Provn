export interface GatewayConfig {
  port: number;
  /**
   * Token the agent must present on /mcp. If unset, /mcp rejects every request (fail closed).
   */
  sessionToken: string | undefined;
  /** SQLite file path, or ":memory:" for tests. */
  dbPath: string;
  /** Path to policy.yaml. Defaults to the repo's policies/policy.yaml. */
  policyPath: string | undefined;
  /** Which WalletAdapter to use. "mock" never moves real money. */
  walletAdapter: WalletAdapterKind;
  /** QuickNode Stream/Webhook security token. If unset, /chain-events rejects everything. */
  quicknodeSecret?: string;
  /** ProvnVault address. Reconciliation watches USDC transfers out of it. */
  vaultAddress?: string;
  /** USDC ERC-20 address. Defaults to Arc testnet USDC. */
  usdcAddress?: string;
  /** How long an unmatched transfer waits for Provn's payment record before the vault is paused. */
  reconcileGraceMs?: number;
}

const WALLET_ADAPTERS = ["mock", "circle-dev", "local-vault"] as const;
export type WalletAdapterKind = (typeof WALLET_ADAPTERS)[number];

/** Read gateway settings from environment variables. See `.env.example`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const walletAdapter = env.WALLET_ADAPTER ?? "mock";
  if (!(WALLET_ADAPTERS as readonly string[]).includes(walletAdapter)) {
    throw new Error(
      `WALLET_ADAPTER must be "mock", "circle-dev" or "local-vault", got "${walletAdapter}"`,
    );
  }
  return {
    port: Number(env.GATEWAY_PORT ?? 3001),
    sessionToken: env.GATEWAY_SESSION_TOKEN || undefined,
    dbPath: env.GATEWAY_DB_PATH ?? "provn.db",
    policyPath: env.POLICY_PATH || undefined,
    walletAdapter: walletAdapter as WalletAdapterKind,
    quicknodeSecret: env.QUICKNODE_STREAM_SECRET || undefined,
    vaultAddress: env.VAULT_ADDRESS || undefined,
    usdcAddress: env.USDC_ADDRESS || undefined,
    reconcileGraceMs: env.RECONCILE_GRACE_MS ? Number(env.RECONCILE_GRACE_MS) : undefined,
  };
}
