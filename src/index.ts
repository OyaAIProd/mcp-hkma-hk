interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Hong Kong Monetary Authority (HKMA) public open API MCP. Keyless.
 *
 * Base: https://api.hkma.gov.hk/public
 * Every list endpoint returns the same envelope:
 *   { header: { success, err_code, err_msg }, result: { datasize, records: [...] } }
 * Records live under result.records. Dates are YYYY-MM-DD (some series report
 * end_of_month as YYYY-MM). Pagination is offset/pagesize; date windows use
 * from/to (YYYY-MM-DD). lang is en|tc|sc and is required by a few datasets
 * (e.g. coin-cart-schedule).
 */


const BASE = 'https://api.hkma.gov.hk/public';
const UA = 'pipeworx-mcp-hkma-hk/1.0 (+https://pipeworx.io)';

// Verified-live endpoint paths (the part after /public/).
const P_INTERBANK_LIQUIDITY =
  'market-data-and-statistics/daily-monetary-statistics/daily-figures-interbank-liquidity';
const P_MONETARY_BASE =
  'market-data-and-statistics/daily-monetary-statistics/daily-figures-monetary-base';
const P_INTERBANK_IR_DAILY =
  'market-data-and-statistics/monthly-statistical-bulletin/er-ir/hk-interbank-ir-daily';
const P_EERI_DAILY = 'market-data-and-statistics/monthly-statistical-bulletin/er-ir/er-eeri-daily';

// Shared list-query params, reused across the generic + convenience tools.
const LIST_PARAMS = {
  pagesize: { type: 'integer', description: 'Records per page (default ~100). Max varies by dataset.' },
  offset: { type: 'integer', description: 'Zero-based record offset for pagination.' },
  from: { type: 'string', description: 'Start of date window, YYYY-MM-DD (or YYYY-MM for monthly series), e.g. "2026-01-01".' },
  to: { type: 'string', description: 'End of date window, YYYY-MM-DD (or YYYY-MM for monthly series), e.g. "2026-01-31".' },
  fields: { type: 'string', description: 'Comma-separated subset of columns to return, e.g. "end_of_date,hibor_overnight".' },
  sortby: { type: 'string', description: 'Column to sort by, e.g. "end_of_date".' },
  sortorder: { type: 'string', description: 'Sort direction: "asc" or "desc".' },
  lang: { type: 'string', description: 'Language of text fields: "en" (default), "tc", or "sc". Required by some datasets (e.g. coin-cart-schedule).' },
} as const;

const tools: McpToolExport['tools'] = [
  {
    name: 'hkma_dataset',
    description:
      'Fetch ANY HKMA public dataset by its endpoint path (the part after https://api.hkma.gov.hk/public/). ' +
      'Returns the uniform envelope: data rows are under result.records, total under result.datasize. ' +
      'Use this for any HKMA series not covered by a convenience tool. ' +
      'Verified example paths: ' +
      '"market-data-and-statistics/daily-monetary-statistics/daily-figures-interbank-liquidity" (daily HIBOR/aggregate balance/TWI), ' +
      '"market-data-and-statistics/daily-monetary-statistics/daily-figures-monetary-base" (monetary base components), ' +
      '"market-data-and-statistics/monthly-statistical-bulletin/er-ir/hk-interbank-ir-daily" (HIBOR fixings by tenor), ' +
      '"market-data-and-statistics/monthly-statistical-bulletin/er-ir/er-eeri-daily" (HKD exchange rates vs major currencies), ' +
      '"market-data-and-statistics/monthly-statistical-bulletin/er-ir/hkd-fer-daily" (HKD forward points), ' +
      '"market-data-and-statistics/monthly-statistical-bulletin/er-ir/composite-ir" (composite interest rate, monthly), ' +
      '"market-data-and-statistics/monthly-statistical-bulletin/banking/customer-deposits-by-currency", ' +
      '"coin-cart-schedule" (requires lang). ' +
      'Browse more at apidocs.hkma.gov.hk. Dates YYYY-MM-DD; paginate with offset/pagesize.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Endpoint path after /public/, no leading slash, e.g. "market-data-and-statistics/daily-monetary-statistics/daily-figures-interbank-liquidity".',
        },
        ...LIST_PARAMS,
      },
      required: ['path'],
    },
  },
  {
    name: 'interbank_liquidity',
    description:
      'Daily interbank liquidity figures: overnight & 1-month HIBOR, aggregate balance (opening/closing), ' +
      'discount window base rate, the convertibility undertaking strong/weak-side rates (7.75/7.85), and the ' +
      'trade-weighted index (TWI). One record per business day, most recent first. Use from/to to window the dates.',
    inputSchema: { type: 'object', properties: { ...LIST_PARAMS } },
  },
  {
    name: 'monetary_base',
    description:
      'Daily figures for the components of the Hong Kong Monetary Base: Certificates of Indebtedness, ' +
      'government notes & coins in circulation, aggregate balance (before/after discount window), and ' +
      'outstanding Exchange Fund Bills & Notes. One record per business day. Use from/to to window the dates.',
    inputSchema: { type: 'object', properties: { ...LIST_PARAMS } },
  },
  {
    name: 'interbank_interest_rates',
    description:
      'HKD interbank offered rates (HIBOR) by tenor: overnight, 1-week, 1/3/6/9/12-month, one record per day ' +
      '(end_of_day). Source is the Monthly Statistical Bulletin er-ir series. Use from/to to window the dates.',
    inputSchema: { type: 'object', properties: { ...LIST_PARAMS } },
  },
  {
    name: 'exchange_rates',
    description:
      'HKD market exchange rates vs major currencies (USD, GBP, JPY, CNY, EUR, AUD, CAD, SGD, etc.), ' +
      'one record per day (end_of_day). Source is the Monthly Statistical Bulletin er-ir er-eeri-daily series. ' +
      'Use from/to to window the dates.',
    inputSchema: { type: 'object', properties: { ...LIST_PARAMS } },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'hkma_dataset': {
      const path = reqStr(args, 'path', '"market-data-and-statistics/daily-monetary-statistics/daily-figures-interbank-liquidity"');
      return hkmaGet(path.replace(/^\/+|\/+$/g, ''), args);
    }
    case 'interbank_liquidity':
      return hkmaGet(P_INTERBANK_LIQUIDITY, args);
    case 'monetary_base':
      return hkmaGet(P_MONETARY_BASE, args);
    case 'interbank_interest_rates':
      return hkmaGet(P_INTERBANK_IR_DAILY, args);
    case 'exchange_rates':
      return hkmaGet(P_EERI_DAILY, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function hkmaGet(path: string, args: Record<string, unknown>): Promise<unknown> {
  const params = new URLSearchParams();
  for (const key of ['pagesize', 'offset', 'from', 'to', 'fields', 'sortby', 'sortorder', 'lang']) {
    const v = args[key];
    if (v != null && String(v).trim() !== '') params.set(key, String(v));
  }
  const qs = params.toString();
  const res = await fetch(`${BASE}/${path}${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HKMA: ${res.status} ${text.slice(0, 200)}`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HKMA: ${res.status} ${text.slice(0, 200)}`);
  }
  const header = (body as { header?: { success?: boolean; err_msg?: string } }).header;
  if (header && header.success === false) {
    throw new Error(`HKMA: ${header.err_msg ?? res.status} ${text.slice(0, 200)}`);
  }
  return body;
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
