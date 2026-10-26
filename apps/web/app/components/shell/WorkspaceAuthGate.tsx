import type { ReactNode } from "react";
import { Link } from "react-router";

export interface WorkspaceAuthGateProps {
  error?: "UNAUTHORIZED" | "SERVICE_UNAVAILABLE" | "NOT_FOUND" | null;
  laneName: string;
  returnTo: string;
  children: ReactNode;
}

export function WorkspaceAuthGate({
  error,
  laneName,
  returnTo,
  children,
}: WorkspaceAuthGateProps) {
  if (error === "UNAUTHORIZED") {
    return (
      <div className="card mt-4 border border-amber/30 bg-amber-soft/20 p-5 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="text-[18px]">🔒</span>
          <h2 className="text-[15px] font-semibold text-ink">
            {laneName}需要管理员权限
          </h2>
        </div>
        <p className="mt-2 leading-relaxed text-ink-3">
          {laneName}为本地个人私有研究工作台，当前为未登录访客状态。
          为保证数据隐私与研究成果隔离，请以管理员身份登录后查看完整数据、证据库与分析看板。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            to={`/admin/login?returnTo=${encodeURIComponent(returnTo)}`}
            className="btn btn-primary flex items-center gap-1.5 px-4 py-2 text-[12.5px]"
          >
            立即登录管理员 →
          </Link>
          <span className="text-[11.5px] text-ink-4">
            零云端依赖 · 本地安全运行
          </span>
        </div>
      </div>
    );
  }

  if (error === "SERVICE_UNAVAILABLE") {
    return (
      <div className="card mt-4 border border-hot/30 bg-hot-soft/20 p-5 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="text-[18px]">⚠️</span>
          <h2 className="text-[15px] font-semibold text-ink">
            {laneName}后端服务暂不可达
          </h2>
        </div>
        <p className="mt-2 leading-relaxed text-ink-3">
          无法连接到本地 API 服务（端口 3001）或后端处理异常。
          请检查本机 API 进程与 PostgreSQL 数据库服务是否正常启动。
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
