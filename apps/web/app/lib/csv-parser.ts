// Client-side pure TypeScript CSV parser and row validation utilities for React Web.

export interface CsvParseOptions {
  delimiter?: string;
  maxRows?: number;
  sanitizeFormula?: boolean;
}

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

export function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

export function sanitizeCsvFormula(value: string): string {
  if (!value) return value;
  const first = value.charAt(0);
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    return "'" + value;
  }
  return value;
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;

  if (tabCount > commaCount && tabCount > semiCount) return "\t";
  if (semiCount > commaCount && semiCount > tabCount) return ";";
  return ",";
}

export function parseCsv(text: string, options: CsvParseOptions = {}): CsvParseResult {
  const cleanText = stripBom(text);
  const delimiter = options.delimiter || detectDelimiter(cleanText);
  const maxRows = options.maxRows ?? 20000;
  const sanitize = options.sanitizeFormula ?? true;

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;
  const len = cleanText.length;

  while (i < len) {
    const char = cleanText[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && cleanText[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        currentRow.push(sanitize ? sanitizeCsvFormula(currentField.trim()) : currentField.trim());
        currentField = "";
        i++;
        continue;
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && i + 1 < len && cleanText[i + 1] === "\n") {
          i++;
        }
        currentRow.push(sanitize ? sanitizeCsvFormula(currentField.trim()) : currentField.trim());
        currentField = "";
        if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== "")) {
          rows.push(currentRow);
          if (rows.length >= maxRows + 1) {
            break;
          }
        }
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(sanitize ? sanitizeCsvFormula(currentField.trim()) : currentField.trim());
    if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== "")) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    return { headers: [], rows: [], totalRows: 0, truncated: false };
  }

  const headers = rows[0]!;
  const dataRows = rows.slice(1);
  const truncated = dataRows.length > maxRows;
  const finalRows = truncated ? dataRows.slice(0, maxRows) : dataRows;

  return {
    headers,
    rows: finalRows,
    totalRows: dataRows.length,
    truncated,
  };
}

const KEYWORD_ALIASES: Record<string, string[]> = {
  keyword: ["keyword", "keywords", "关键词", "搜索词", "search term", "query", "term"],
  rankThisWeek: ["rank", "current rank", "本周排名", "本期排名", "排名", "search frequency rank", "sfr", "position", "current_rank"],
  rankLastWeek: ["last week", "previous rank", "上周排名", "上期排名", "prior rank", "last_week_rank", "prev_rank"],
  rankDeltaAbsolute: ["delta", "change", "涨跌", "位移", "rank change", "movement", "rank_delta", "abs_change"],
};

const PRODUCT_ALIASES: Record<string, string[]> = {
  asin: ["asin", "商品编号", "商品id", "product id", "asin1", "item id", "listing id"],
  title: ["title", "product title", "商品标题", "标题", "name", "product name", "item name"],
  chartRank: ["rank", "chart rank", "榜单排名", "bsr", "position", "名次", "chart_rank", "bestseller rank"],
  price: ["price", "current price", "价格", "售价", "offer price", "list price", "current_price"],
  category: ["category", "类目", "分类", "department", "node", "category label", "category_label"],
  brand: ["brand", "品牌", "manufacturer", "seller"],
};

export function suggestColumnMappings(
  headers: string[],
  kind: "keywords" | "products"
): Record<string, number> {
  const aliases = kind === "keywords" ? KEYWORD_ALIASES : PRODUCT_ALIASES;
  const result: Record<string, number> = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim().replace(/['"_\s-]+/g, " "));

  for (const [field, patterns] of Object.entries(aliases)) {
    for (let colIdx = 0; colIdx < lowerHeaders.length; colIdx++) {
      const header = lowerHeaders[colIdx]!;
      const matched = patterns.some((p) => {
        const cleanPattern = p.toLowerCase().replace(/['"_\s-]+/g, " ");
        return header === cleanPattern || header.includes(cleanPattern);
      });
      if (matched) {
        result[field] = colIdx;
        break;
      }
    }
  }

  return result;
}

export interface RowValidationError {
  line: number;
  field: string;
  value: string;
  error: string;
}

export interface MappedKeywordsResult {
  validRows: Array<{
    keyword: string;
    rankThisWeek: number;
    rankLastWeek: number | null;
    rankDeltaAbsolute: number | null;
  }>;
  errorRows: RowValidationError[];
  duplicateCount: number;
}

export function mapAndValidateKeywordRows(
  rows: string[][],
  mapping: { keyword?: number; rankThisWeek?: number; rankLastWeek?: number; rankDeltaAbsolute?: number }
): MappedKeywordsResult {
  const validRows: MappedKeywordsResult["validRows"] = [];
  const errorRows: RowValidationError[] = [];
  const seenKeywords = new Set<string>();
  let duplicateCount = 0;

  if (mapping.keyword == null || mapping.rankThisWeek == null) {
    throw new Error("关键词 (keyword) 和本期排名 (rankThisWeek) 是必选映射列");
  }

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const kwRaw = row[mapping.keyword!]?.trim() ?? "";
    const thisWeekRaw = row[mapping.rankThisWeek!]?.trim() ?? "";
    const lastWeekRaw = mapping.rankLastWeek != null ? row[mapping.rankLastWeek]?.trim() : undefined;
    const deltaRaw = mapping.rankDeltaAbsolute != null ? row[mapping.rankDeltaAbsolute]?.trim() : undefined;

    if (!kwRaw) {
      errorRows.push({ line, field: "keyword", value: kwRaw, error: "关键词为空" });
      return;
    }

    const thisWeek = Number(thisWeekRaw.replace(/,/g, ""));
    if (isNaN(thisWeek) || thisWeek < 1 || thisWeek > 250_000) {
      errorRows.push({
        line,
        field: "rankThisWeek",
        value: thisWeekRaw,
        error: "本期排名必须是 1 到 250,000 之间的整数",
      });
      return;
    }

    let lastWeek: number | null = null;
    if (lastWeekRaw && lastWeekRaw !== "-" && lastWeekRaw !== "N/A" && lastWeekRaw !== "") {
      const parsedLast = Number(lastWeekRaw.replace(/,/g, ""));
      if (!isNaN(parsedLast) && parsedLast >= 1 && parsedLast <= 250_000) {
        lastWeek = parsedLast;
      } else {
        errorRows.push({
          line,
          field: "rankLastWeek",
          value: lastWeekRaw,
          error: "上期排名格式不合法（应为 1..250,000 或留空）",
        });
        return;
      }
    }

    let delta: number | null = null;
    if (deltaRaw && deltaRaw !== "-" && deltaRaw !== "") {
      const parsedDelta = Number(deltaRaw.replace(/,/g, ""));
      if (!isNaN(parsedDelta)) {
        delta = Math.abs(parsedDelta);
      }
    }

    if (seenKeywords.has(kwRaw.toLowerCase())) {
      duplicateCount++;
      return;
    }
    seenKeywords.add(kwRaw.toLowerCase());

    validRows.push({
      keyword: kwRaw,
      rankThisWeek: Math.floor(thisWeek),
      rankLastWeek: lastWeek ? Math.floor(lastWeek) : null,
      rankDeltaAbsolute: delta ?? (lastWeek != null ? Math.abs(lastWeek - Math.floor(thisWeek)) : null),
    });
  });

  return { validRows, errorRows, duplicateCount };
}

export interface MappedProductRowsResult {
  validRows: Array<{
    asin: string;
    chartRank: number | null;
    price: string | null;
    title: string | null;
    category?: string | null;
  }>;
  errorRows: RowValidationError[];
  duplicateCount: number;
}

export function mapAndValidateProductRows(
  rows: string[][],
  mapping: { asin?: number; chartRank?: number; price?: number; title?: number; category?: number }
): MappedProductRowsResult {
  const validRows: MappedProductRowsResult["validRows"] = [];
  const errorRows: RowValidationError[] = [];
  const seenAsins = new Set<string>();
  let duplicateCount = 0;

  if (mapping.asin == null) {
    throw new Error("ASIN 是必选映射列");
  }

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const asinRaw = row[mapping.asin!]?.trim().toUpperCase() ?? "";
    const rankRaw = mapping.chartRank != null ? row[mapping.chartRank]?.trim() : undefined;
    const priceRaw = mapping.price != null ? row[mapping.price]?.trim() : undefined;
    const titleRaw = mapping.title != null ? row[mapping.title]?.trim() : undefined;
    const categoryRaw = mapping.category != null ? row[mapping.category]?.trim() : undefined;

    if (!/^[A-Z0-9]{10}$/.test(asinRaw)) {
      errorRows.push({
        line,
        field: "asin",
        value: asinRaw,
        error: "ASIN 必须为 10 位英文字母与数字组合",
      });
      return;
    }

    let chartRank: number | null = null;
    if (rankRaw && rankRaw !== "-" && rankRaw !== "N/A" && rankRaw !== "") {
      const parsedRank = Number(rankRaw.replace(/[^0-9]/g, ""));
      if (!isNaN(parsedRank) && parsedRank >= 1 && parsedRank <= 100_000) {
        chartRank = Math.floor(parsedRank);
      } else {
        errorRows.push({
          line,
          field: "chartRank",
          value: rankRaw,
          error: "榜单排名应为正整数",
        });
        return;
      }
    }

    let formattedPrice: string | null = null;
    if (priceRaw && priceRaw !== "-" && priceRaw !== "N/A" && priceRaw !== "") {
      const cleanPrice = priceRaw.replace(/[^0-9.]/g, "");
      if (cleanPrice && !isNaN(Number(cleanPrice))) {
        formattedPrice = `$${Number(cleanPrice).toFixed(2)}`;
      } else {
        formattedPrice = priceRaw;
      }
    }

    if (seenAsins.has(asinRaw)) {
      duplicateCount++;
      return;
    }
    seenAsins.add(asinRaw);

    validRows.push({
      asin: asinRaw,
      chartRank,
      price: formattedPrice,
      title: titleRaw || null,
      category: categoryRaw || null,
    });
  });

  return { validRows, errorRows, duplicateCount };
}
