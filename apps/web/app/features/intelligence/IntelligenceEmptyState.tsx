import { Link } from "react-router";
import { EmptyState } from "../../components/ui/Page";

export function IntelligenceEmptyState({
  title = "当前暂无符合条件的新情报",
  message = "要么该筛选范围内暂无新增情报，要么现有条目被合规规则排除。系统坚持实证原则，不凑数量。",
  action,
}: {
  title?: string;
  message?: string;
  action?: { label: string; to?: string; onClick?: () => void };
}) {
  return (
    <div className="mt-4 rounded-sheet border border-line bg-surface p-6 text-center">
      <EmptyState
        title={title}
        action={
          action ? (
            action.to ? (
              <Link to={action.to} className="text-[13px] font-medium text-accent hover:underline">
                {action.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={action.onClick}
                className="text-[13px] font-medium text-accent hover:underline"
              >
                {action.label}
              </button>
            )
          ) : undefined
        }
      >
        {message}
      </EmptyState>
    </div>
  );
}
