export interface ApprovalRequest {
  requestId: string
  tool: string
  input: unknown
}

export interface ApprovalResult {
  approved: boolean
  reason?: string
}

export type LeaderApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalResult>

export interface GrantedPath {
  path: string
  toolName: string
  grantedBy: string
  grantedAt: number
}

/**
 * Permission bridge between team leader and worker agents.
 *
 * Workers can request per-call approval or check pre-granted paths.
 * Extracted from cc_code's leaderPermissionBridge.ts + TeamAllowedPath patterns.
 */
export class PermissionBridge {
  private leaderHandler: LeaderApprovalHandler | null = null
  private readonly allowedPaths: GrantedPath[] = []

  get hasLeaderHandler(): boolean { return this.leaderHandler !== null }

  registerLeaderHandler(handler: LeaderApprovalHandler): void {
    this.leaderHandler = handler
  }

  unregisterLeaderHandler(): void {
    this.leaderHandler = null
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    if (!this.leaderHandler) {
      return { approved: false, reason: 'auto-denied: no handler registered for this team' }
    }
    return this.leaderHandler(request)
  }

  grantPath(opts: { path: string; toolName: string; grantedBy: string }): void {
    const idx = this.allowedPaths.findIndex(p => p.path === opts.path && p.toolName === opts.toolName)
    if (idx !== -1) this.allowedPaths.splice(idx, 1)
    this.allowedPaths.push({ ...opts, grantedAt: Date.now() })
  }

  getAllowedPaths(): GrantedPath[] { return [...this.allowedPaths] }

  isPathPermitted(filePath: string, toolName: string): boolean {
    return this.allowedPaths.some(p => p.toolName === toolName && filePath.startsWith(p.path))
  }
}
