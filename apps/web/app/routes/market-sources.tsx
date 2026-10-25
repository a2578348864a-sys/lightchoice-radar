import { Link, useLoaderData } from "react-router";
import { useState, useRef } from "react";
import { marketPost } from "../lib/market-client";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";
import {
  parseCsv,
  suggestColumnMappings,
  mapAndValidateKeywordRows,
  mapAndValidateProductRows,
  type RowValidationError,
} from "../lib/csv-parser";

export const handle: Screen = { name: "市场来源" };

interface SourcesResponse {
  sources: Array<{
    id: string;
    label: string;
    producer: string;
    enabled: boolean;
    automation: string;
    uses: string[];
    evidence: string;
    notes?: string;
    unverifiedUses?: string[];
    revokedAt?: string;
    revokeReason?: string;
    permissionBasis: string;
  }>;
  counts?: {
    keywordSnapshots: number;
    keywordRows: number;
    chartSnapshots: number;
    products: number;
    signals: number;
    opportunities: number;
    alerts: number;
  };
}

interface OverviewWithSources extends SourcesResponse {
  modules: unknown[];
}

export async function loader({ request }: { request: Request }) {
  const data = await marketGet<OverviewWithSources>(request, "/api/market/overview").catch(() => null);
  return {
    sources: data?.sources ?? null,
    counts: data?.counts ?? null,
  };
}

export function meta() {
  return pageMeta({
    title: "市场来源与数据导入",
    description: "第四主线来源注册、许可、数据质量与个人市场数据导入工作台。",
    noindex: true,
    path: "/market/sources",
  });
}

const autoZh: Record<string, string> = {
  "manual-import-only": "仅人工导入（自动化未授权）",
  "authorized-periodic": "已授权周期采集",
  "blocked-no-license": "无许可（阻断）",
  "pending-credentials": "资格未取得",
};

export default function MarketSources() {
  const { sources, counts } = useLoaderData<typeof loader>();

  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="来源与数据导入" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">来源管理与数据导入工作台</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">
          支持 CSV 与 JSON 格式的合法市场数据导入、交互式字段映射与入库前预览校验。每个来源独立授权（存储/计算/模型外发/展示/导出），未授权用途直接拒绝。
        </p>
      </header>

      {/* Data Quality Overview Card */}
      {counts && (
        <section className="card mt-3 p-3.5" aria-label="数据质量概览">
          <h2 className="text-[13px] font-semibold text-ink">当前本地数据蓄积概览</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
            <div className="rounded bg-paper-2 p-2">
              <span className="block text-[11px] text-ink-3">关键词快照</span>
              <span className="text-[16px] font-bold text-ink">{counts.keywordSnapshots} 期</span>
              <span className="block text-[10.5px] text-ink-4">共 {counts.keywordRows} 词</span>
            </div>
            <div className="rounded bg-paper-2 p-2">
              <span className="block text-[11px] text-ink-3">榜单快照</span>
              <span className="text-[16px] font-bold text-ink">{counts.chartSnapshots} 期</span>
              <span className="block text-[10.5px] text-ink-4">{counts.products} 个 ASIN</span>
            </div>
            <div className="rounded bg-paper-2 p-2">
              <span className="block text-[11px] text-ink-3">市场变化信号</span>
              <span className="text-[16px] font-bold text-ink">{counts.signals} 条</span>
              <span className="block text-[10.5px] text-ink-4">确定性规则</span>
            </div>
            <div className="rounded bg-paper-2 p-2">
              <span className="block text-[11px] text-ink-3">研究候选 / 待办</span>
              <span className="text-[16px] font-bold text-ink">{counts.opportunities} 个</span>
              <span className="block text-[10.5px] text-ink-4">{counts.alerts} 条预警</span>
            </div>
          </div>
        </section>
      )}

      {/* Main Import Workbench */}
      <section className="mt-5" aria-label="市场数据导入工作台">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-1.5">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">个人市场数据文件导入工作台</h2>
            <p className="mt-0.5 text-[12px] text-ink-3">
              支持直接选择本地 CSV 文件，自动检测列名并提供字段映射、错误拦截与入库预览。
            </p>
          </div>
          <span className="text-[11.5px] text-ink-4">纯本地解析 · 零云端上传 · 幂等防重</span>
        </div>
        <ImportWorkbench sources={sources ?? []} />
      </section>

      {/* Registered Sources List */}
      <section className="mt-6" aria-label="注册来源清单">
        <h2 className="pb-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          已注册数据来源与许可状态（R2 状态机）
        </h2>
        {!sources ? (
          <p className="mt-2 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
            服务不可用或需要管理员会话。首次使用请通过 API <code className="text-[11.5px]">POST /api/market/sources/seed</code> 注册。
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {sources.map((s) => (
              <section key={s.id} className="card p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[13.5px] font-semibold text-ink">{s.label}</h3>
                  <Badge tone={s.revokedAt ? "hot" : s.enabled ? "ok" : "neutral"}>
                    {s.revokedAt ? "已撤销" : s.enabled ? "已启用" : "未启用"}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-3">数据生产者：{s.producer}</p>
                <p className="mt-0.5 text-[11.5px] text-ink-4">授权依据：{s.permissionBasis}</p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  自动化状态：{autoZh[s.automation] ?? s.automation} · 证据等级 {s.evidence}
                </p>
                <p className="mt-1 text-[11.5px] text-ink-4">
                  已授权用途（操作员私有研究授权）：{s.uses.length ? s.uses.join(" / ") : "无（全部关闭）"}
                </p>
                {s.unverifiedUses?.length ? (
                  <p className="mt-1 rounded bg-amber-soft px-2 py-1 text-[11.5px] text-amber-ink">
                    来源网站许可未核实（PERMISSION_UNVERIFIED）：{s.unverifiedUses.join(" / ")}——私有研究授权不升级为网站授权
                  </p>
                ) : null}
                {s.revokedAt && (
                  <p className="mt-1 rounded bg-paper-2 px-2 py-1 text-[11.5px] text-warn">
                    已于 {s.revokedAt.slice(0, 10)} 撤销：{s.revokeReason ?? "未注明"}——相关预警已失效、依赖机会进入待复核
                  </p>
                )}
                {s.notes && <p className="mt-1 text-[11.5px] text-ink-4">{s.notes}</p>}
              </section>
            ))}
          </div>
        )}
      </section>

      <nav className="mt-5 flex flex-wrap gap-1.5 text-[12px]">
        <Link to="/market" className="pill">← 返回总览</Link>
        <Link to="/market/keywords" className="pill">查看关键词需求 →</Link>
        <Link to="/market/products" className="pill">查看商品观测 →</Link>
        <Link to="/market/opportunities" className="pill">查看机会研究 →</Link>
      </nav>
    </div>
  );
}

/* ------------------------------------------------ Main Import Workbench Component */

interface ImportWorkbenchProps {
  sources: Array<{ id: string; label: string; producer: string; enabled: boolean; uses: string[] }>;
}

function ImportWorkbench({ sources }: ImportWorkbenchProps) {
  const [activeTab, setActiveTab] = useState<"csv" | "json">("csv");
  const [dataType, setDataType] = useState<"keywords" | "chart">("keywords");
  const [sourceId, setSourceId] = useState(sources[0]?.id || "amz123-us-keywords");
  const [producer, setProducer] = useState("Amazon ABA（AMZ123 二手展示）");
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 10));
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [chartId, setChartId] = useState("amazon-us-bestsellers-beauty");
  const [categoryLabel, setCategoryLabel] = useState("Beauty & Personal Care");

  // Permissions state
  const [permStore, setPermStore] = useState(true);
  const [permCompute, setPermCompute] = useState(true);
  const [permDisplay, setPermDisplay] = useState(true);
  const [permModelSend, setPermModelSend] = useState(false);
  const [permExport, setPermExport] = useState(false);

  // File & parsed states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRawRows, setCsvRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [validCount, setValidCount] = useState(0);
  const [dupCount, setDupCount] = useState(0);
  const [errorRows, setErrorRows] = useState<RowValidationError[]>([]);
  const [previewRows, setPreviewRows] = useState<unknown[]>([]);

  // Execution states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; message: string; details?: unknown } | null>(null);

  // JSON mode state
  const [jsonInput, setJsonInput] = useState("");

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setSubmitResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setRawText(text);

      if (file.name.endsWith(".json")) {
        setActiveTab("json");
        setJsonInput(text);
        return;
      }

      // Parse CSV
      try {
        const parsed = parseCsv(text, { maxRows: 10000 });
        setCsvHeaders(parsed.headers);
        setCsvRawRows(parsed.rows);

        // Auto-guess mapping
        const suggested = suggestColumnMappings(parsed.headers, dataType === "keywords" ? "keywords" : "products");
        setMapping(suggested);

        // Pre-validate
        runValidation(parsed.rows, suggested, dataType);
      } catch (err: unknown) {
        setErrorRows([{ line: 1, field: "file", value: "", error: `CSV 解析失败: ${(err as Error).message}` }]);
      }
    };
    reader.readAsText(file);
  };

  const runValidation = (
    rows: string[][],
    curMapping: Record<string, number>,
    curDataType: "keywords" | "chart"
  ) => {
    if (curDataType === "keywords") {
      try {
        const res = mapAndValidateKeywordRows(rows, curMapping);
        setValidCount(res.validRows.length);
        setDupCount(res.duplicateCount);
        setErrorRows(res.errorRows.slice(0, 5));
        setPreviewRows(res.validRows.slice(0, 6));
      } catch (err: unknown) {
        setValidCount(0);
        setErrorRows([{ line: 1, field: "mapping", value: "", error: (err as Error).message }]);
        setPreviewRows([]);
      }
    } else {
      try {
        const res = mapAndValidateProductRows(rows, curMapping);
        setValidCount(res.validRows.length);
        setDupCount(res.duplicateCount);
        setErrorRows(res.errorRows.slice(0, 5));
        setPreviewRows(res.validRows.slice(0, 6));
      } catch (err: unknown) {
        setValidCount(0);
        setErrorRows([{ line: 1, field: "mapping", value: "", error: (err as Error).message }]);
        setPreviewRows([]);
      }
    }
  };

  const handleDataTypeChange = (type: "keywords" | "chart") => {
    setDataType(type);
    setSubmitResult(null);
    if (csvRawRows.length > 0) {
      const suggested = suggestColumnMappings(csvHeaders, type === "keywords" ? "keywords" : "products");
      setMapping(suggested);
      runValidation(csvRawRows, suggested, type);
    }
  };

  const handleMappingChange = (field: string, colIdx: number) => {
    const next = { ...mapping, [field]: colIdx };
    setMapping(next);
    if (csvRawRows.length > 0) {
      runValidation(csvRawRows, next, dataType);
    }
  };

  // Submit parsed data
  const handleConfirmImport = async () => {
    if (!permStore || !permCompute) {
      setSubmitResult({
        ok: false,
        message: "来源必须获得「私有研究存储 (store)」与「本地指标计算 (compute)」授权，否则拒绝写入数据库。",
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      if (activeTab === "csv") {
        const res = await marketPost<{
          ok: boolean;
          stored: number;
          revised: number;
          validRowsCount: number;
          refusal?: string;
          error?: string;
        }>("/api/market/import/csv", {
          kind: dataType,
          csvText: rawText,
          sourceId,
          producer,
          mapping,
          periodStart,
          periodEnd,
          observedAt,
          chartId,
          chartKind: "bestsellers",
          categoryLabel,
          complete: true,
        });

        if (res.status === 200 && res.body?.ok) {
          setSubmitResult({
            ok: true,
            message: `✅ 导入成功！新增入库 ${res.body.stored} 条记录，同周期修订 ${res.body.revised} 条记录，共处理 ${res.body.validRowsCount} 条有效行。`,
            details: res.body,
          });
        } else {
          setSubmitResult({
            ok: false,
            message: `❌ 导入被拒绝：${res.body?.refusal ?? res.body?.error ?? "来源许可不足或数据格式不符合规范"}`,
            details: res.body,
          });
        }
      } else {
        // JSON mode
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonInput);
        } catch {
          setSubmitResult({ ok: false, message: "❌ JSON 语法错误，请检查文本格式" });
          setIsSubmitting(false);
          return;
        }

        const path = dataType === "keywords" ? "/api/market/import/keywords" : "/api/market/import/chart";
        const res = await marketPost<{
          stored?: number;
          revised?: number;
          productsCreated?: number;
          refusal?: string;
          error?: string;
        }>(path, parsed);

        if (res.status === 200 && !res.body?.refusal) {
          setSubmitResult({
            ok: true,
            message: `✅ JSON 导入成功！${JSON.stringify(res.body)}`,
            details: res.body,
          });
        } else {
          setSubmitResult({
            ok: false,
            message: `❌ 导入拒绝：${res.body?.refusal ?? res.body?.error ?? "请求不合法"}`,
            details: res.body,
          });
        }
      }
    } catch (err: unknown) {
      setSubmitResult({ ok: false, message: `网络或服务异常：${(err as Error).message}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card mt-3 p-4">
      {/* Step 1: File selection & Mode Switch */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("csv")}
              className={`pill text-[12px] ${activeTab === "csv" ? "bg-accent text-paper font-semibold" : ""}`}
            >
              📄 本地 CSV 文件导入
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("json")}
              className={`pill text-[12px] ${activeTab === "json" ? "bg-accent text-paper font-semibold" : ""}`}
            >
              📋 粘贴 JSON 快照
            </button>
          </div>
          <div className="flex gap-1.5 text-[12px]">
            <button
              type="button"
              onClick={() => handleDataTypeChange("keywords")}
              className={`pill ${dataType === "keywords" ? "border-accent text-accent font-semibold" : ""}`}
            >
              关键词快照
            </button>
            <button
              type="button"
              onClick={() => handleDataTypeChange("chart")}
              className={`pill ${dataType === "chart" ? "border-accent text-accent font-semibold" : ""}`}
            >
              榜单商品快照
            </button>
          </div>
        </div>

        {/* Excel Help Banner */}
        <div className="rounded bg-paper-2 px-3 py-2 text-[11.5px] text-ink-3">
          💡 <strong>支持文件</strong>：标准 CSV 文本（逗号、制表符分隔，支持带引号文本）。若你拥有 Excel (.xlsx) 表格，请在 Excel 中选择「文件 → 另存为 → CSV (逗号分隔) (*.csv)」后选择导入。
        </div>

        {/* File Dropzone / Picker */}
        {activeTab === "csv" && (
          <div className="rounded border-2 border-dashed border-line p-4 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv,.json"
              onChange={handleFileChange}
              className="hidden"
              id="market-file-input"
            />
            <label
              htmlFor="market-file-input"
              className="inline-block cursor-pointer rounded bg-paper-2 px-4 py-2 text-[13px] font-medium text-ink hover:bg-paper-3"
            >
              {fileName ? `已选择：${fileName}` : "点击选择本地 CSV / 文本文件"}
            </label>
            <p className="mt-1 text-[11.5px] text-ink-4">
              {csvRawRows.length > 0 ? `已解析 ${csvRawRows.length} 行数据，${csvHeaders.length} 个字段列` : "支持拖拽或直接选择文件，浏览器本地秒级完成解析"}
            </p>
          </div>
        )}

        {/* JSON Mode Input */}
        {activeTab === "json" && (
          <div>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              rows={8}
              placeholder={
                dataType === "keywords"
                  ? '{\n  "sourceId": "amz123-us-keywords",\n  "periodStart": "2026-10-17",\n  "periodEnd": "2026-10-23",\n  "rows": [{ "keyword": "...", "rankThisWeek": 1, "rankLastWeek": 2 }]\n}'
                  : '{\n  "sourceId": "amazon-chart-manual",\n  "chartId": "amazon-us-bestsellers-beauty",\n  "rows": [{ "asin": "B0XXXXXXXX", "chartRank": 1, "price": "$11.97", "title": "..." }]\n}'
              }
              className="w-full rounded border border-line bg-paper px-2.5 py-2 font-mono text-[11.5px] text-ink"
            />
          </div>
        )}
      </div>

      {/* Step 2: Source & Metadata Configuration */}
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-[12.5px] font-semibold text-ink">来源属性与周期标注（防数据混淆）</h3>
        <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-[12px]">
          <div>
            <label className="block text-[11.5px] text-ink-3">数据来源通道</label>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.id})
                </option>
              ))}
              <option value="custom-generic-csv">自定义合法 CSV 导入 (custom-generic-csv)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] text-ink-3">数据生产者（声明版权/事实方）</label>
            <input
              type="text"
              value={producer}
              onChange={(e) => setProducer(e.target.value)}
              className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
            />
          </div>
          <div>
            <label className="block text-[11.5px] text-ink-3">观测/记录日期</label>
            <input
              type="date"
              value={observedAt}
              onChange={(e) => setObservedAt(e.target.value)}
              className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
            />
          </div>
        </div>

        {dataType === "keywords" ? (
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-[12px]">
            <div>
              <label className="block text-[11.5px] text-ink-3">周期开始日 (periodStart)</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
              />
            </div>
            <div>
              <label className="block text-[11.5px] text-ink-3">周期结束日 (periodEnd)</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
              />
            </div>
          </div>
        ) : (
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-[12px]">
            <div>
              <label className="block text-[11.5px] text-ink-3">所属榜单标识 (chartId)</label>
              <input
                type="text"
                value={chartId}
                onChange={(e) => setChartId(e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
              />
            </div>
            <div>
              <label className="block text-[11.5px] text-ink-3">所属类目标签 (categoryLabel)</label>
              <input
                type="text"
                value={categoryLabel}
                onChange={(e) => setCategoryLabel(e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
              />
            </div>
          </div>
        )}

        {/* Permissions Checklist */}
        <div className="mt-3 rounded bg-paper-2 p-2.5 text-[11.5px]">
          <span className="font-semibold text-ink">用途许可门禁（操作员授权确认）</span>
          <div className="mt-1 flex flex-wrap gap-4 text-ink-2">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={permStore} onChange={(e) => setPermStore(e.target.checked)} />
              <span>存储入库 (store)</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={permCompute} onChange={(e) => setPermCompute(e.target.checked)} />
              <span>指标与位移计算 (compute)</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={permDisplay} onChange={(e) => setPermDisplay(e.target.checked)} />
              <span>个人站内展示 (display)</span>
            </label>
            <label className="flex items-center gap-1 opacity-70 cursor-pointer">
              <input type="checkbox" checked={permModelSend} onChange={(e) => setPermModelSend(e.target.checked)} />
              <span>外部模型外发 (modelSend - 默认关)</span>
            </label>
            <label className="flex items-center gap-1 opacity-70 cursor-pointer">
              <input type="checkbox" checked={permExport} onChange={(e) => setPermExport(e.target.checked)} />
              <span>商业导出再分发 (export - 默认关)</span>
            </label>
          </div>
        </div>
      </div>

      {/* Step 3: Interactive Field Mapping (CSV mode only) */}
      {activeTab === "csv" && csvHeaders.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[12.5px] font-semibold text-ink">字段映射（系统已自动智能推测列名）</h3>
            <span className="text-[11.5px] text-ink-4">共 {csvHeaders.length} 列可用</span>
          </div>

          {dataType === "keywords" ? (
            <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4 text-[12px]">
              <div>
                <label className="block text-[11px] font-medium text-ink">关键词列 (必选)</label>
                <select
                  value={mapping.keyword ?? ""}
                  onChange={(e) => handleMappingChange("keyword", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
                >
                  <option value="">-- 请选择 --</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      列 {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-ink">本期排名列 (必选)</label>
                <select
                  value={mapping.rankThisWeek ?? ""}
                  onChange={(e) => handleMappingChange("rankThisWeek", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
                >
                  <option value="">-- 请选择 --</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      列 {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-ink-3">上期排名列 (可选)</label>
                <select
                  value={mapping.rankLastWeek ?? ""}
                  onChange={(e) => handleMappingChange("rankLastWeek", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
                >
                  <option value="">-- 无上期数据 --</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      列 {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-ink-3">位移/涨跌列 (可选)</label>
                <select
                  value={mapping.rankDeltaAbsolute ?? ""}
                  onChange={(e) => handleMappingChange("rankDeltaAbsolute", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
                >
                  <option value="">-- 自动按两周计算 --</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      列 {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-5 text-[12px]">
              <div>
                <label className="block text-[11px] font-medium text-ink">ASIN (必选)</label>
                <select
                  value={mapping.asin ?? ""}
                  onChange={(e) => handleMappingChange("asin", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
                >
                  <option value="">-- 请选择 --</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      列 {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-ink-3">榜单排名 (可选)</label>
                <select
                  value={mapping.chartRank ?? ""}
                  onChange={(e) => handleMappingChange("chartRank", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
                >
                  <option value="">-- 无排名 --</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      列 {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-ink-3">报价/价格 (可选)</label>
                <select
                  value={mapping.price ?? ""}
                  onChange={(e) => handleMappingChange("price", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
                >
                  <option value="">-- 无价格 --</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      列 {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-ink-3">商品标题 (可选)</label>
                <select
                  value={mapping.title ?? ""}
                  onChange={(e) => handleMappingChange("title", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
                >
                  <option value="">-- 无标题 --</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      列 {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-ink-3">类目 (可选)</label>
                <select
                  value={mapping.category ?? ""}
                  onChange={(e) => handleMappingChange("category", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-ink"
                >
                  <option value="">-- 继承默认类目 --</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      列 {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Pre-import Validation Stats & Sample Preview */}
      {activeTab === "csv" && csvRawRows.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <span className="font-semibold text-ink">校验与预览：</span>
            <span className="rounded bg-paper-2 px-2 py-0.5 text-ink-2">总解析 {csvRawRows.length} 行</span>
            <span className="rounded bg-ok-soft px-2 py-0.5 text-ok-ink font-medium">有效 {validCount} 行</span>
            {dupCount > 0 && (
              <span className="rounded bg-paper-2 px-2 py-0.5 text-ink-3">同表重复过滤 {dupCount} 行</span>
            )}
            {errorRows.length > 0 && (
              <span className="rounded bg-warn-soft px-2 py-0.5 text-warn font-medium">格式异常 {errorRows.length} 行</span>
            )}
          </div>

          {/* Error Callout */}
          {errorRows.length > 0 && (
            <div className="mt-2 rounded bg-paper-2 p-2.5 text-[11.5px] text-warn">
              <span className="font-semibold">⚠️ 发现格式不符合项（部分示例）：</span>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {errorRows.map((err, idx) => (
                  <li key={idx}>
                    第 {err.line} 行 [{err.field}]: &quot;{err.value}&quot; — {err.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sample Table Preview */}
          {previewRows.length > 0 && (
            <div className="mt-2.5 overflow-x-auto rounded border border-line">
              <table className="w-full text-left text-[11.5px]">
                <thead className="bg-paper-2 text-ink-3">
                  <tr>
                    {dataType === "keywords" ? (
                      <>
                        <th className="p-1.5 font-medium">关键词</th>
                        <th className="p-1.5 font-medium">本期排名</th>
                        <th className="p-1.5 font-medium">上期排名</th>
                        <th className="p-1.5 font-medium">位移变化</th>
                      </>
                    ) : (
                      <>
                        <th className="p-1.5 font-medium">ASIN</th>
                        <th className="p-1.5 font-medium">榜单排名</th>
                        <th className="p-1.5 font-medium">报价</th>
                        <th className="p-1.5 font-medium">商品标题</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-ink">
                  {previewRows.map((r: any, idx) => (
                    <tr key={idx} className="hover:bg-paper-2">
                      {dataType === "keywords" ? (
                        <>
                          <td className="p-1.5 font-medium">{(r as { keyword: string }).keyword}</td>
                          <td className="p-1.5">第 {(r as { rankThisWeek: number }).rankThisWeek} 名</td>
                          <td className="p-1.5">
                            {(r as { rankLastWeek: number | null }).rankLastWeek
                              ? `第 ${(r as { rankLastWeek: number }).rankLastWeek} 名`
                              : "-"}
                          </td>
                          <td className="p-1.5">
                            {(r as { rankDeltaAbsolute: number | null }).rankDeltaAbsolute ?? "-"}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-1.5 font-mono font-medium">{(r as { asin: string }).asin}</td>
                          <td className="p-1.5">
                            {(r as { chartRank: number | null }).chartRank
                              ? `第 ${(r as { chartRank: number }).chartRank} 名`
                              : "-"}
                          </td>
                          <td className="p-1.5">{(r as { price: string | null }).price ?? "-"}</td>
                          <td className="p-1.5 max-w-[200px] truncate text-ink-2">
                            {(r as { title: string | null }).title ?? "-"}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Step 5: Action Button & Result Feedback */}
      <div className="mt-4 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={isSubmitting || (activeTab === "csv" && validCount === 0)}
            className="rounded bg-accent px-4 py-1.5 text-[12.5px] font-medium text-paper shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "正在执行安全入库校验…" : "确认导入数据库（执行幂等入库）"}
          </button>
          <span className="text-[11.5px] text-ink-4">
            同对象同周期数据将执行修订；不会破坏前三主线数据库。
          </span>
        </div>

        {submitResult && (
          <div
            className={`mt-2.5 rounded p-3 text-[12px] ${
              submitResult.ok ? "bg-ok-soft text-ok-ink border border-ok/20" : "bg-warn-soft text-warn border border-warn/20"
            }`}
          >
            <p className="font-semibold">{submitResult.message}</p>
            {submitResult.ok && (
              <div className="mt-1.5 flex gap-2">
                <Link to="/market/keywords" className="pill bg-paper text-[11.5px]">
                  前往关键词研究验证 →
                </Link>
                <Link to="/market/products" className="pill bg-paper text-[11.5px]">
                  前往商品观测验证 →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
