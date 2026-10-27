import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "../root";
import { useChangelogDot } from "../components/shell/Sidebar";
import { PhoneBar } from "../components/shell/PhoneBar";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import { edgeTtl } from "../lib/api.server";
import { webModules } from "../site-modules";
import { pageMeta } from "../lib/seo";
import { setFontPreference, useFontPreference, useStarred } from "../lib/local-state";
import { Select } from "../components/ui/Controls";
import { ThemeSwitch } from "../components/shell/ThemeSwitch";
import { Filings } from "../components/shell/Filings";
import {
  IconBookmark,
  IconChart,
  IconChevronRight,
  IconDoc,
  IconGrid,
  IconHeart,
  IconHistory,
  IconList,
  IconMessage,
  IconMoon,
  IconPlug,
  IconRadar,
  IconShield,
  IconUsers,
} from "../components/icons";

export const handle: Screen = { tab: "me", name: "我的" };

export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({ title: "我的 · 轻选情报中心", path: "/more", noindex: true });
}

type Row = { to: string; label: string; icon: ReactNode; detail?: ReactNode };

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h2 className="px-4 pb-2 pt-6 text-[13px] font-semibold text-ink-3">{title}</h2>}
      <ul className="card divide-y divide-line-soft overflow-hidden">{children}</ul>
    </section>
  );
}

function RowLink({ row, dot = false }: { row: Row; dot?: boolean }) {
  return (
    <li>
      <Link
        viewTransition
        to={row.to}
        className="flex min-h-[52px] items-center gap-3 px-4 text-[16px] font-medium text-ink transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk"
      >
        <span className="text-ink-3">{row.icon}</span>
        <span className="flex flex-1 items-center gap-2">
          {row.label}
          {dot && <span className="size-[7px] rounded-full bg-hot" aria-label="有新的更新" />}
        </span>
        {row.detail && <span className="text-[14px] font-normal text-ink-4">{row.detail}</span>}
        <IconChevronRight size={16} className="text-ink-4" />
      </Link>
    </li>
  );
}

export default function MorePage() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const changelogDot = useChangelogDot(root?.changelogVersion ?? null);
  const starred = useStarred();
  const font = useFontPreference();
  const [here, setHere] = useState(false);
  useEffect(() => setHere(true), []);

  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      <PhoneBar title="更多与设置" large />
      <h1 className="hidden pb-4 pt-1 text-[22px] font-bold text-ink lg:block">更多与设置</h1>

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-4 2xl:grid-cols-3">
        {/* Section 1: 情报中心 */}
        <Group title="情报中心四主线">
          <RowLink
            row={{
              to: "/all",
              label: "01 平台政策",
              icon: <IconList size={20} />,
              detail: "平台政策与监管召回",
            }}
          />
          <RowLink
            row={{
              to: "/industry",
              label: "02 行业动态",
              icon: <IconRadar size={20} />,
              detail: "行业动态与官方数据",
            }}
          />
          <RowLink
            row={{
              to: "/voc",
              label: "03 消费者原声",
              icon: <IconUsers size={20} />,
              detail: "真实原话 · 讨论证据",
            }}
          />
          <RowLink
            row={{
              to: "/market",
              label: "04 市场信号",
              icon: <IconChart size={20} />,
              detail: "确定性规则 · 需求与竞争",
            }}
          />
        </Group>

        {/* Section 2: 情报阅读与报告 */}
        <Group title="情报阅读与报告">
          <RowLink
            row={{
              to: "/leads",
              label: "政策线索",
              icon: <IconShield size={20} />,
              detail: "第三方报道待核实",
            }}
          />
          <RowLink
            row={{
              to: "/daily",
              label: "情报日报",
              icon: <IconDoc size={20} />,
              detail: "每日要闻 08:00",
            }}
          />
          <RowLink
            row={{
              to: "/weekly",
              label: "情报周报",
              icon: <IconDoc size={20} />,
              detail: "周度复盘 周一 10:00",
            }}
          />
          <RowLink
            row={{
              to: "/monthly",
              label: "情报月报",
              icon: <IconDoc size={20} />,
              detail: "月度研判 1 日 10:30",
            }}
          />
          <RowLink
            row={{
              to: "/starred",
              label: "收藏",
              icon: <IconBookmark size={20} />,
              detail: here && starred.length > 0 ? <span className="num">{starred.length}</span> : undefined,
            }}
          />
        </Group>

        {/* Section 3: 研究工具与管理 */}
        <Group title="研究工具与管理">
          <RowLink
            row={{
              to: "/market/workbench",
              label: "12 模块工程矩阵",
              icon: <IconChart size={20} />,
              detail: "能力与数据可用状态",
            }}
          />
          <RowLink
            row={{
              to: "/voc/evidence",
              label: "反馈证据库",
              icon: <IconUsers size={20} />,
              detail: "原始材料与上下文",
            }}
          />
          <RowLink
            row={{
              to: "/admin/sources",
              label: "信源监控看板",
              icon: <IconRadar size={20} />,
              detail: "调度与运行台账",
            }}
          />
          <RowLink
            row={{
              to: "/agent",
              label: "自动化工具接入",
              icon: <IconPlug size={20} />,
              detail: "MCP / RSS / API",
            }}
          />
        </Group>

        {/* Section 4: 个性化与偏好 */}
        <Group title="偏好与外观">
          <li className="flex min-h-[56px] items-center gap-3 px-4 text-[16px] font-medium text-ink">
            <span className="text-ink-3">
              <IconMoon size={20} />
            </span>
            <span className="flex-1">外观模式</span>
            <ThemeSwitch className="w-[126px]" />
          </li>
          <li className="flex min-h-[56px] items-center gap-3 px-4 text-[16px] font-medium text-ink">
            <span className="w-5 text-center text-ink-3" aria-hidden="true">
              Aa
            </span>
            <span className="flex-1">正文字体</span>
            <Select
              aria-label="字体"
              value={font ?? "system"}
              onChange={(e) => setFontPreference(e.target.value === "browser" ? "browser" : null)}
            >
              <option value="system">默认字体</option>
              <option value="browser">浏览器默认字体</option>
            </Select>
          </li>
        </Group>

        {/* Section 5: 关于与支持 */}
        <Group title="关于情报中心">
          <RowLink row={{ to: "/about", label: "关于", icon: <IconHeart size={20} /> }} />
          <RowLink
            row={{ to: "/changelog", label: "更新日志", icon: <IconHistory size={20} /> }}
            dot={changelogDot}
          />
          <RowLink row={{ to: "/feedback", label: "反馈", icon: <IconMessage size={20} /> }} />
        </Group>
      </div>

      <Filings className="mt-8 text-center text-[12px] text-ink-4" badgeSize={20} />
    </div>
  );
}
