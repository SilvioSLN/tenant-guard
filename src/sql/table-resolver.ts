/**
 * TableResolver — resolves which tenant column to use for each table.
 *
 * Supports:
 * - A default column name for all tables
 * - Per-table column overrides
 * - Shared tables (excluded from tenant scoping)
 */

export interface TableResolverConfig {
  /** Default column name. Defaults to 'tenant_id'. */
  defaultColumn: string
  /** Per-table column overrides. Example: { orders: 'company_id' } */
  overrides?: Record<string, string>
  /** Tables that are shared across all tenants. */
  sharedTables?: string[]
}

export class TableResolver {
  private readonly defaultColumn: string
  private readonly overrides: Map<string, string>
  private readonly shared: Set<string>

  constructor(config: TableResolverConfig) {
    this.defaultColumn = config.defaultColumn
    this.overrides = new Map(
      Object.entries(config.overrides ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    )
    this.shared = new Set(
      (config.sharedTables ?? []).map((t) => t.toLowerCase()),
    )
  }

  private cleanTableName(tableName: string): { full: string; bare: string } {
    const stripped = tableName.replace(/["`]/g, '').toLowerCase()
    const parts = stripped.split('.')
    const bare = parts[parts.length - 1]!
    return { full: stripped, bare }
  }

  /**
   * Get the tenant column name for a given table.
   * Returns null if the table is shared (no tenant scoping).
   */
  getColumn(tableName: string): string | null {
    const { full, bare } = this.cleanTableName(tableName)

    if (this.shared.has(full) || this.shared.has(bare)) {
      return null
    }

    return this.overrides.get(full) ?? this.overrides.get(bare) ?? this.defaultColumn
  }

  /**
   * Check if a table is shared (excluded from tenant scoping).
   */
  isShared(tableName: string): boolean {
    const { full, bare } = this.cleanTableName(tableName)
    return this.shared.has(full) || this.shared.has(bare)
  }
}
