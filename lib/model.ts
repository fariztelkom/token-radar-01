// Fitted value model for the token launch radar.
//
// Everything here is derived from the sealed snapshot: comparable market-cap/TVL multiples are fitted
// from the protocols that already record a token, then applied to pre-token protocols with a growth,
// tenure and size adjustment. No protocol name is ever special-cased, and no value is read from the
// clock or from outside the snapshot. Both runs of the program therefore produce the same board.

/** One protocol as the sealed snapshot records it. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every knob the fitted model uses, exposed to the page so the arithmetic is auditable. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  global_floor: number;
  global_cap: number;
  category_floor: number;
  category_cap: number;
  chain_floor: number;
  chain_cap: number;
  comp_floor: number;
  comp_cap: number;
  category_weight: number;
  chain_weight: number;
  min_category_comps: number;
  min_chain_comps: number;
  size_reference_tvl: number;
  size_weight: number;
  size_floor: number;
  size_cap: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -60,
  growth_cap: 120,
  growth_weight: 0.5,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  global_floor: 0.02,
  global_cap: 4,
  category_floor: 0.15,
  category_cap: 6,
  chain_floor: 0.4,
  chain_cap: 3,
  comp_floor: 0.01,
  comp_cap: 8,
  category_weight: 0.7,
  chain_weight: 0.5,
  min_category_comps: 4,
  min_chain_comps: 6,
  size_reference_tvl: 100_000_000,
  size_weight: 0.12,
  size_floor: 0.55,
  size_cap: 1.35,
};

export const MODEL_VERSION = 'radar-fitted-2';

/** Pre-token protocols below the watchlist floor the early radar may add, largest TVL first. */
export const EARLY_ROWS = 220;

/** Live-token protocols carried in the comparison view. */
export const LIVE_ROWS = 28;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One ranked row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  /** The comp actually applied: fitted comparable times the size tilt. */
  comp_multiple: number;
  comp_source: string;
  model: {
    model_version: string;
    age_days: number | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    size_tilt: number;
    comparable_multiple: number;
    fitted_comp: number;
    comp_source: string;
  };
  farm_steps: string[];
}

/** The compact row the dashboard renders from data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  comp_multiple: number;
  comp_source: string;
  growth_multiplier: number;
  maturity_multiplier: number;
  size_tilt: number;
  farm_steps: string[];
}

/** A protocol whose token already trades: shown as the market's own value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Multiples fitted from the snapshot's own live-token protocols. */
export interface Comparables {
  global: number;
  byCategory: Map<string, number>;
  byChain: Map<string, number>;
  count: number;
}

/** Everything the dashboard needs, in one compact object. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  comparables: { count: number; global: number; category_count: number; chain_count: number };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else the fallback. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp a number to an inclusive range. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Median of a numeric array; the array may be unsorted, the caller need not sort it. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from the snapshot day to a listing day; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Records no token at all: no market cap, no CoinGecko id and no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether the board may rank a protocol: no recorded token, not an exchange or a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Fit market-cap/TVL multiples from protocols whose token already trades. */
export function fitComparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const byCategory = new Map<string, number[]>();
  const byChain = new Map<string, number[]>();
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 1_000_000) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
    for (const chain of p.chains) {
      const list = byChain.get(chain) ?? [];
      list.push(ratio);
      byChain.set(chain, list);
    }
  }
  const global = clamp(median(ratios), model.global_floor, model.global_cap);
  const category = new Map<string, number>();
  for (const [name, list] of byCategory) {
    if (list.length >= model.min_category_comps) {
      category.set(name, clamp(median(list), global * model.category_floor, global * model.category_cap));
    }
  }
  const chain = new Map<string, number>();
  for (const [name, list] of byChain) {
    if (list.length >= model.min_chain_comps) {
      chain.set(name, clamp(median(list), global * model.chain_floor, global * model.chain_cap));
    }
  }
  return { global, byCategory: category, byChain: chain, count: ratios.length };
}

/** The value of one pre-token protocol under the fitted comparables. */
export interface ValueResult {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  comp: number;
  compSource: string;
  sizeTilt: number;
  effectiveComp: number;
}

/** Apply the fitted model to one protocol. */
export function valueOf(p: SnapshotProtocol, asOf: string, comps: Comparables, model: ModelConstants = MODEL): ValueResult {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = clamp(1 + (growthPct / 100) * model.growth_weight, 0.4, 2.2);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;

  const category = p.category ?? 'Unclassified';
  const catComp = comps.byCategory.get(category);
  const chainComps = p.chains.map((c) => comps.byChain.get(c)).filter((v): v is number => v !== undefined);
  const chainComp = chainComps.length > 0 ? median(chainComps) : undefined;

  let comp: number;
  let compSource: string;
  if (catComp !== undefined) {
    comp = model.category_weight * catComp + (1 - model.category_weight) * comps.global;
    compSource = `category ${category} (${catComp.toFixed(2)}x), shrunk to global`;
  } else if (chainComp !== undefined) {
    comp = model.chain_weight * chainComp + (1 - model.chain_weight) * comps.global;
    compSource = `chain comp (${chainComp.toFixed(2)}x), shrunk to global`;
  } else {
    comp = comps.global;
    compSource = 'global median mcap/TVL';
  }
  comp = clamp(comp, model.comp_floor, model.comp_cap);

  const sizeTilt = clamp(
    1 - model.size_weight * Math.log2(Math.max(p.tvl_usd, 1) / model.size_reference_tvl),
    model.size_floor,
    model.size_cap,
  );
  const implied = Math.max(1, Math.round(p.tvl_usd * comp * growthMult * maturityMult * sizeTilt));
  return { implied, growthPct, growthMult, maturityMult, age, comp, compSource, sizeTilt, effectiveComp: comp * sizeTilt };
}

/** One string per step, with the cost and time attached so the page can split them apart. */
export function stepText(step: FarmStep): string {
  let text = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (text.length > 600) text = `${text.slice(0, 596)}...`;
  if (text.length < 20) text = `${text} Keep the position and review the protocol's own page.`;
  return text;
}

/** Capital for one position, scaled by the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 75;
  if (age < 180) return 75;
  if (age < 365) return 60;
  return 45;
}

/** The qualifying action, chosen by the protocol's own category and chains. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the deposit receipt.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('amm') || c.includes('liquidity')) {
    return `Provide $${capital} of two-sided liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged balance in its app.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's liquid staking asset through ${name} on ${chain} and keep the receipt.`;
  }
  if (c.includes('perp') || c.includes('derivative') || c.includes('margin')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small, fully collateralised position.`;
  }
  if (c.includes('rwa') || c.includes('real world')) {
    return `Mint $${capital} of ${name}'s tokenised yield asset on ${chain} and hold the vault shares.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares in the same wallet.`;
  }
  if (c.includes('insur')) {
    return `Buy $${capital} of cover through ${name} on ${chain} and keep the policy number.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and take one small position on ${name}'s most active market.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the position.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A concrete seven-step plan, derived only from category, chains, TVL and age. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains[0] ?? 'its main chain';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const extra = p.chains.length > 1 ? ` and ${p.chains.length - 1} more chain${p.chains.length > 2 ? 's' : ''}` : '';
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm for ${p.name}, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Read ${p.name}'s own documentation for ${chain}${extra}, confirm the contract address on its official page, and sign nothing from a link in a message.`,
      cost: 'nothing to check, and never pay a stranger to confirm',
      time: '5 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, from the same wallet.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity appears in more than one eligibility snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Claim only from the official page ${p.name} publishes; ignore messages that ask you to connect elsewhere.`,
      cost: 'no fee to check, and never pay upfront to claim',
      time: '10 minutes',
    },
    {
      text: `Record the wallet, dates and transaction hashes in a farm log, then decide from that record whether to add or unwind.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** Rank every watchlist slug and the largest pre-token protocols below the floor. */
export function buildBoard(snapshot: Snapshot, comps: Comparables = fitComparables(snapshot)): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, value: valueOf(p, snapshot.as_of, comps) }));
  scored.sort((a, b) => b.value.implied - a.value.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map(({ p, value: v }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: v.age,
    implied_value_usd: v.implied,
    comp_multiple: round4(v.effectiveComp),
    comp_source: v.compSource,
    model: {
      model_version: MODEL_VERSION,
      age_days: v.age,
      growth_pct: round4(v.growthPct),
      growth_multiplier: round4(v.growthMult),
      maturity_multiplier: round4(v.maturityMult),
      size_tilt: round4(v.sizeTilt),
      comparable_multiple: round4(v.comp),
      fitted_comp: round4(v.effectiveComp),
      comp_source: v.compSource,
    },
    farm_steps: farmSteps(p, v.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the comparison view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row reduced to the fields the page renders. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    comp_multiple: row.comp_multiple,
    comp_source: row.comp_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    size_tilt: row.model.size_tilt,
    farm_steps: row.farm_steps,
  };
}

/** The board and the dashboard's dataset, from one fitted comparables set. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = fitComparables(snapshot);
  const board = buildBoard(snapshot, comps);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    comparables: {
      count: comps.count,
      global: round4(comps.global),
      category_count: comps.byCategory.size,
      chain_count: comps.byChain.size,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Parse and validate the sealed snapshot's text. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board would be refused by the gate, or null when it is sound. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, not 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** The dataset as one script the page reads without a network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
