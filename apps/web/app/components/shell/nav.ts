// Site navigation in one place: the desktop sidebar's sections and the phone tab bar's tabs, the engine's
// and the site's modules'.
import type { ReactNode } from "react";
import { NAV, SITE } from "@aihot/site";
import { webModules } from "../../site-modules";
import {
  IconBolt, IconBookmark, IconChart, IconDoc, IconFlame, IconGrid, IconHeart, IconHistory, IconList, IconMessage, IconPlug, IconRadar, IconUser, IconUsers, IconShield,
} from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "情报中心",
    items: [
      { to: "/", label: "情报首页", icon: IconBolt, end: true },
      { to: "/all", label: "01 平台政策", icon: IconList },
      { to: "/industry", label: "02 行业动态", icon: IconRadar },
      { to: "/voc", label: "03 消费者原声", icon: IconUsers },
      { to: "/market", label: "04 市场信号", icon: IconChart },
    ],
  },
  {
    title: "情报阅读",
    items: [
      { to: "/leads", label: "政策线索", icon: IconShield },
      { to: "/daily", label: "情报日报", icon: IconDoc },
      { to: "/weekly", label: "情报周报", icon: IconDoc },
      { to: "/monthly", label: "情报月报", icon: IconDoc },
      { to: "/starred", label: "收藏", icon: IconBookmark },
    ],
  },
  {
    title: "研究与管理",
    items: [
      { to: "/voc/research", label: "研究工具", icon: IconGrid },
      { to: "/admin/sources", label: "来源监控", icon: IconRadar },
      { to: "/agent", label: "自动化工具接入", icon: IconPlug },
    ],
  },
  {
    title: "更多",
    items: [
      { to: "/about", label: "关于", icon: IconHeart },
      { to: "/changelog", label: "更新日志", icon: IconHistory, changelog: true },
      { to: "/feedback", label: "反馈", icon: IconMessage },
    ],
  },
];

/** Whether an engine page is a way in from the navigation (site.ts NAV.hidden); a hidden page still opens. */
export const inNav = (to: string) => !(NAV.hidden as readonly string[]).includes(to);

const UP = {
  "/hot": { name: "热点榜", back: "热点", tab: "hot" },
  "/topics": { name: "主题", back: "全部主题", tab: "me" },
  "/all": { name: "平台政策", back: "政策", tab: "policy" },
  "/industry": { name: "行业动态", back: "行业", tab: "industry" },
  "/voc": { name: "消费者原声", back: "原声", tab: "voc" },
  "/market": { name: "市场信号", back: "市场", tab: "market" },
  "/leads": { name: "政策线索", back: "线索", tab: "leads" },
} as const;

/**
 * Where pages under a navigation entry lead back up to: the entry, or 情报 in its place.
 */
export function navUp(entry: keyof typeof UP): { to: string; name: string; back: string; tab: TabKey; crumbs: Array<{ name: string; path: string }> } {
  if (!inNav(entry)) {
    const home = "情报";
    return { to: "/", name: home, back: home, tab: "featured", crumbs: [] };
  }
  return { to: entry, ...UP[entry], crumbs: [{ name: UP[entry].name, path: entry }] };
}

/**
 * The sidebar: the engine's sections with the modules' between 内容 and 更多.
 */
export function sidebar(): Array<{ title: string; items: NavItem[] }> {
  const [content, reading, research, more] = SECTIONS;
  const sections = [content!, reading!, research!].map((s) => ({ ...s, items: s.items.filter((i) => inNav(i.to)) }));
  for (const m of webModules()) {
    if (!m.sidebar) continue;
    const section = sections.find((s) => s.title === m.sidebar!.section);
    if (section) section.items.push(...m.sidebar.items);
    else sections.push({ title: m.sidebar.section, items: [...m.sidebar.items] });
  }
  return [...sections, more!];
}

/** A sidebar entry is lit on its pages; separate daily, weekly and monthly accurately. */
export function sidebarIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/daily") return /^\/daily(\/|$)/.test(pathname);
  if (item.to === "/weekly") return /^\/weekly(\/|$)/.test(pathname);
  if (item.to === "/monthly") return /^\/monthly(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The phone tab bar: 5 clear tabs.
 */
export type TabKey =
  | "featured"
  | "hot"
  | "daily"
  | "me"
  | "policy"
  | "industry"
  | "voc"
  | "market"
  | "leads"
  // A module's tab.
  | (string & {});

export interface Tab {
  key: TabKey;
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  changelog?: boolean;
}

const ENGINE_TABS: Tab[] = [
  { key: "featured", to: "/", label: "首页", icon: IconBolt },
  { key: "policy", to: "/all", label: "政策", icon: IconList },
  { key: "industry", to: "/industry", label: "行业", icon: IconRadar },
  { key: "market", to: "/market", label: "市场", icon: IconChart },
  { key: "me", to: "/more", label: "更多", icon: IconUser, changelog: true },
];

/** The tab bar: the engine's, the modules' before 更多. */
export function tabs(): Tab[] {
  return [...ENGINE_TABS.slice(0, -1).filter((t) => inNav(t.to)), ...webModules().flatMap((m) => m.tabs ?? []), ENGINE_TABS.at(-1)!];
}
