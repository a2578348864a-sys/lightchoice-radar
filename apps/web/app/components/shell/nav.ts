// Site navigation in one place: the desktop sidebar's sections and the phone tab bar's tabs, the engine's
// and the site's modules'.
import type { ReactNode } from "react";
import { NAV, SITE, subjectAfter, withSubject } from "@aihot/site";
import { webModules } from "../../site-modules";
import {
  IconBolt, IconBookmark, IconChart, IconDoc, IconFlame, IconGrid, IconHeart, IconHistory, IconList, IconMessage, IconPlug, IconRadar, IconUser, IconUsers,
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
    title: "四条主线",
    items: [
      { to: "/", label: "情报首页", icon: IconBolt, end: true },
      { to: "/all", label: "01 平台政策", icon: IconList },
      { to: "/industry", label: "02 行业动态", icon: IconRadar },
      { to: "/voc", label: "03 消费者原声", icon: IconUsers },
      { to: "/market", label: "04 市场信号", icon: IconChart },
    ],
  },
  {
    title: "情报工具",
    items: [
      { to: "/leads", label: "政策线索", icon: IconRadar },
      { to: "/hot", label: "热点榜", icon: IconFlame },
      { to: "/daily", label: withSubject("日报"), icon: IconDoc },
      { to: "/topics", label: "主题", icon: IconGrid },
      { to: "/starred", label: "收藏", icon: IconBookmark },
    ],
  },
  {
    title: "更多",
    items: [
      { to: "/agent", label: "自动化工具接入", icon: IconPlug },
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
} as const;

/**
 * Where pages under a navigation entry lead back up to: the entry, or 精选 in its place while the site hides
 * it. `name` is for breadcrumbs and desktop back links (热点榜), `back` for the phone bar (热点), `tab` the
 * phone tab it sits under, `crumbs` its breadcrumb after the site's home.
 */
export function navUp(entry: keyof typeof UP): { to: string; name: string; back: string; tab: TabKey; crumbs: Array<{ name: string; path: string }> } {
  if (!inNav(entry)) {
    const home = SITE.name === "LightChoice Radar" ? "情报" : "精选";
    return { to: "/", name: home, back: home, tab: "featured", crumbs: [] };
  }
  return { to: entry, ...UP[entry], crumbs: [{ name: UP[entry].name, path: entry }] };
}

/**
 * The sidebar: the engine's sections with the modules' between 内容 and 更多; a module naming a section
 * that is already there adds to it.
 */
export function sidebar(): Array<{ title: string; items: NavItem[] }> {
  const [content, tools, more] = SECTIONS;
  const sections = [content!, tools!].map((s) => ({ ...s, items: s.items.filter((i) => inNav(i.to)) }));
  for (const m of webModules()) {
    if (!m.sidebar) continue;
    const section = sections.find((s) => s.title === m.sidebar!.section);
    if (section) section.items.push(...m.sidebar.items);
    else sections.push({ title: m.sidebar.section, items: [...m.sidebar.items] });
  }
  return [...sections, more!];
}

/** A sidebar entry is lit on its pages; 日报 also covers weekly and monthly reports. */
export function sidebarIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The phone tab bar: 全部 lives beside 精选 as a switch, 热点 and 日报 are tabs, and "我的" at /more holds
 * 收藏, 外观, the tools and the site's own pages. Which tab a page sits under is declared by the page
 * itself (components/shell/screens.ts).
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
  { key: "featured", to: "/", label: "情报", icon: IconBolt },
  { key: "policy", to: "/all", label: "政策", icon: IconList },
  { key: "industry", to: "/industry", label: "行业", icon: IconRadar },
  { key: "market", to: "/market", label: "市场", icon: IconChart },
  { key: "me", to: "/more", label: "我的", icon: IconUser, changelog: true },
];

/** The tab bar: the engine's, the modules' before 我的. */
export function tabs(): Tab[] {
  return [...ENGINE_TABS.slice(0, -1).filter((t) => inNav(t.to)), ...webModules().flatMap((m) => m.tabs ?? []), ENGINE_TABS.at(-1)!];
}
