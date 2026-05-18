/**
 * Cities recognised by NyaaChat-MCP's tools (get_current_time / get_weather).
 *
 * Source of truth: NyaaChat-MCP README §3.7. Each entry is a value the user
 * can pick as their "where the role-play is set" location. The MCP server
 * does the actual geo resolution upstream — we send the `value` verbatim
 * (e.g. "美国" stays "美国"; the MCP server maps it to its representative
 * city, 纽约). The `resolvesTo` field is informational only, shown in the
 * typeahead candidate row so the user understands where a country/province
 * input will land.
 *
 * The list is intentionally limited to entries the upstream README
 * promises will always resolve correctly. Free-form city input (e.g.
 * "横滨") still works at the MCP server level via QWeather GeoAPI fuzzy
 * lookup, but we don't surface those as candidates here — the user can
 * just type any string and confirm it.
 */

export type McpCityGroup =
  | "country"
  | "municipality"
  | "province"
  | "autonomous"
  | "sar";

export interface McpCity {
  /** Sent verbatim to MCP tools as the location/timezone argument. */
  value: string;
  /** Display label for the candidate row. */
  label: string;
  /** All recognised aliases including `value` itself. Lowercased only at
   *  match time so the source remains readable. */
  aliases: string[];
  /** Upstream city this entry maps to. Equal to `value` for entries that
   *  are already a city (municipalities, SARs). */
  resolvesTo: string;
  group: McpCityGroup;
}

export const MCP_CITIES: McpCity[] = [
  // ---------- Countries (32) — representative city, not political capital ----------
  { value: "中国", label: "中国", resolvesTo: "北京", group: "country",
    aliases: ["中国", "China", "PRC"] },
  { value: "美国", label: "美国", resolvesTo: "纽约", group: "country",
    aliases: ["美国", "USA", "US", "America", "United States"] },
  { value: "日本", label: "日本", resolvesTo: "东京", group: "country",
    aliases: ["日本", "Japan"] },
  { value: "韩国", label: "韩国", resolvesTo: "首尔", group: "country",
    aliases: ["韩国", "南韩", "大韩民国", "Korea", "South Korea"] },
  { value: "英国", label: "英国", resolvesTo: "伦敦", group: "country",
    aliases: ["英国", "UK", "Britain", "Great Britain", "England", "United Kingdom"] },
  { value: "法国", label: "法国", resolvesTo: "巴黎", group: "country",
    aliases: ["法国", "France"] },
  { value: "德国", label: "德国", resolvesTo: "柏林", group: "country",
    aliases: ["德国", "Germany"] },
  { value: "俄罗斯", label: "俄罗斯", resolvesTo: "莫斯科", group: "country",
    aliases: ["俄罗斯", "俄国", "Russia"] },
  { value: "意大利", label: "意大利", resolvesTo: "罗马", group: "country",
    aliases: ["意大利", "Italy"] },
  { value: "西班牙", label: "西班牙", resolvesTo: "马德里", group: "country",
    aliases: ["西班牙", "Spain"] },
  { value: "加拿大", label: "加拿大", resolvesTo: "多伦多", group: "country",
    aliases: ["加拿大", "Canada"] },
  { value: "澳大利亚", label: "澳大利亚", resolvesTo: "悉尼", group: "country",
    aliases: ["澳大利亚", "澳洲", "Australia"] },
  { value: "新西兰", label: "新西兰", resolvesTo: "奥克兰", group: "country",
    aliases: ["新西兰", "New Zealand"] },
  { value: "印度", label: "印度", resolvesTo: "新德里", group: "country",
    aliases: ["印度", "India"] },
  { value: "泰国", label: "泰国", resolvesTo: "曼谷", group: "country",
    aliases: ["泰国", "Thailand"] },
  { value: "越南", label: "越南", resolvesTo: "河内", group: "country",
    aliases: ["越南", "Vietnam"] },
  { value: "马来西亚", label: "马来西亚", resolvesTo: "吉隆坡", group: "country",
    aliases: ["马来西亚", "Malaysia"] },
  { value: "印尼", label: "印尼", resolvesTo: "雅加达", group: "country",
    aliases: ["印尼", "印度尼西亚", "Indonesia"] },
  { value: "菲律宾", label: "菲律宾", resolvesTo: "马尼拉", group: "country",
    aliases: ["菲律宾", "Philippines"] },
  { value: "新加坡", label: "新加坡", resolvesTo: "新加坡", group: "country",
    aliases: ["新加坡", "Singapore"] },
  { value: "巴西", label: "巴西", resolvesTo: "圣保罗", group: "country",
    aliases: ["巴西", "Brazil"] },
  { value: "墨西哥", label: "墨西哥", resolvesTo: "墨西哥城", group: "country",
    aliases: ["墨西哥", "Mexico"] },
  { value: "阿根廷", label: "阿根廷", resolvesTo: "布宜诺斯艾利斯", group: "country",
    aliases: ["阿根廷", "Argentina"] },
  { value: "埃及", label: "埃及", resolvesTo: "开罗", group: "country",
    aliases: ["埃及", "Egypt"] },
  { value: "南非", label: "南非", resolvesTo: "约翰内斯堡", group: "country",
    aliases: ["南非", "South Africa"] },
  { value: "荷兰", label: "荷兰", resolvesTo: "阿姆斯特丹", group: "country",
    aliases: ["荷兰", "Netherlands", "Holland"] },
  { value: "瑞士", label: "瑞士", resolvesTo: "苏黎世", group: "country",
    aliases: ["瑞士", "Switzerland"] },
  { value: "瑞典", label: "瑞典", resolvesTo: "斯德哥尔摩", group: "country",
    aliases: ["瑞典", "Sweden"] },
  { value: "挪威", label: "挪威", resolvesTo: "奥斯陆", group: "country",
    aliases: ["挪威", "Norway"] },
  { value: "土耳其", label: "土耳其", resolvesTo: "伊斯坦布尔", group: "country",
    aliases: ["土耳其", "Turkey"] },
  { value: "沙特", label: "沙特", resolvesTo: "利雅得", group: "country",
    aliases: ["沙特", "沙特阿拉伯", "Saudi Arabia"] },
  { value: "阿联酋", label: "阿联酋", resolvesTo: "迪拜", group: "country",
    aliases: ["阿联酋", "阿拉伯联合酋长国", "UAE"] },

  // ---------- Municipalities (4) — self-mapping ----------
  { value: "北京", label: "北京", resolvesTo: "北京", group: "municipality",
    aliases: ["北京", "北京市", "Beijing"] },
  { value: "上海", label: "上海", resolvesTo: "上海", group: "municipality",
    aliases: ["上海", "上海市", "Shanghai"] },
  { value: "天津", label: "天津", resolvesTo: "天津", group: "municipality",
    aliases: ["天津", "天津市", "Tianjin"] },
  { value: "重庆", label: "重庆", resolvesTo: "重庆", group: "municipality",
    aliases: ["重庆", "重庆市", "Chongqing"] },

  // ---------- Provinces (23) — provincial capital ----------
  { value: "河北", label: "河北", resolvesTo: "石家庄", group: "province",
    aliases: ["河北", "河北省"] },
  { value: "山西", label: "山西", resolvesTo: "太原", group: "province",
    aliases: ["山西", "山西省"] },
  { value: "辽宁", label: "辽宁", resolvesTo: "沈阳", group: "province",
    aliases: ["辽宁", "辽宁省"] },
  { value: "吉林", label: "吉林", resolvesTo: "长春", group: "province",
    aliases: ["吉林", "吉林省"] },
  { value: "黑龙江", label: "黑龙江", resolvesTo: "哈尔滨", group: "province",
    aliases: ["黑龙江", "黑龙江省"] },
  { value: "江苏", label: "江苏", resolvesTo: "南京", group: "province",
    aliases: ["江苏", "江苏省"] },
  { value: "浙江", label: "浙江", resolvesTo: "杭州", group: "province",
    aliases: ["浙江", "浙江省"] },
  { value: "安徽", label: "安徽", resolvesTo: "合肥", group: "province",
    aliases: ["安徽", "安徽省"] },
  { value: "福建", label: "福建", resolvesTo: "福州", group: "province",
    aliases: ["福建", "福建省"] },
  { value: "江西", label: "江西", resolvesTo: "南昌", group: "province",
    aliases: ["江西", "江西省"] },
  { value: "山东", label: "山东", resolvesTo: "济南", group: "province",
    aliases: ["山东", "山东省"] },
  { value: "河南", label: "河南", resolvesTo: "郑州", group: "province",
    aliases: ["河南", "河南省"] },
  { value: "湖北", label: "湖北", resolvesTo: "武汉", group: "province",
    aliases: ["湖北", "湖北省"] },
  { value: "湖南", label: "湖南", resolvesTo: "长沙", group: "province",
    aliases: ["湖南", "湖南省"] },
  { value: "广东", label: "广东", resolvesTo: "广州", group: "province",
    aliases: ["广东", "广东省"] },
  { value: "海南", label: "海南", resolvesTo: "海口", group: "province",
    aliases: ["海南", "海南省"] },
  { value: "四川", label: "四川", resolvesTo: "成都", group: "province",
    aliases: ["四川", "四川省"] },
  { value: "贵州", label: "贵州", resolvesTo: "贵阳", group: "province",
    aliases: ["贵州", "贵州省"] },
  { value: "云南", label: "云南", resolvesTo: "昆明", group: "province",
    aliases: ["云南", "云南省"] },
  { value: "陕西", label: "陕西", resolvesTo: "西安", group: "province",
    aliases: ["陕西", "陕西省"] },
  { value: "甘肃", label: "甘肃", resolvesTo: "兰州", group: "province",
    aliases: ["甘肃", "甘肃省"] },
  { value: "青海", label: "青海", resolvesTo: "西宁", group: "province",
    aliases: ["青海", "青海省"] },
  { value: "台湾", label: "台湾", resolvesTo: "台北", group: "province",
    aliases: ["台湾", "台湾省", "Taiwan"] },

  // ---------- Autonomous regions (5) — regional capital ----------
  { value: "内蒙古", label: "内蒙古", resolvesTo: "呼和浩特", group: "autonomous",
    aliases: ["内蒙古", "内蒙古自治区"] },
  { value: "广西", label: "广西", resolvesTo: "南宁", group: "autonomous",
    aliases: ["广西", "广西壮族自治区"] },
  { value: "西藏", label: "西藏", resolvesTo: "拉萨", group: "autonomous",
    aliases: ["西藏", "西藏自治区"] },
  { value: "宁夏", label: "宁夏", resolvesTo: "银川", group: "autonomous",
    aliases: ["宁夏", "宁夏回族自治区"] },
  { value: "新疆", label: "新疆", resolvesTo: "乌鲁木齐", group: "autonomous",
    aliases: ["新疆", "新疆维吾尔自治区"] },

  // ---------- Special administrative regions (2) — self-mapping ----------
  { value: "香港", label: "香港", resolvesTo: "香港", group: "sar",
    aliases: ["香港", "香港特别行政区", "Hong Kong"] },
  { value: "澳门", label: "澳门", resolvesTo: "澳门", group: "sar",
    aliases: ["澳门", "澳门特别行政区", "Macao", "Macau"] },
];

const GROUP_RANK: Record<McpCityGroup, number> = {
  country: 0,
  municipality: 1,
  province: 2,
  autonomous: 3,
  sar: 4,
};

/**
 * Fuzzy-match candidates for the geo settings typeahead. Ranking:
 *  1. Exact alias match (case-insensitive) wins outright.
 *  2. Alias starts-with the query.
 *  3. Alias contains the query.
 * Within a tier, group order is country → municipality → province →
 * autonomous → sar so the broader picks surface first.
 */
export function searchCities(query: string, limit = 12): McpCity[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const ranked: { city: McpCity; tier: number }[] = [];
  for (const city of MCP_CITIES) {
    let best = -1;
    for (const a of city.aliases) {
      const al = a.toLowerCase();
      let tier: number;
      if (al === q) tier = 0;
      else if (al.startsWith(q)) tier = 1;
      else if (al.includes(q)) tier = 2;
      else continue;
      if (best === -1 || tier < best) best = tier;
    }
    if (best !== -1) ranked.push({ city, tier: best });
  }

  ranked.sort(
    (a, b) =>
      a.tier - b.tier || GROUP_RANK[a.city.group] - GROUP_RANK[b.city.group],
  );
  return ranked.slice(0, limit).map((r) => r.city);
}
