import type { ApiClient } from "@/services/api";
import type {
  ChildRow,
  CityRecord,
  CrawlResult,
  DistrictRecord,
  ExtractConfig,
  ProvinceRow,
  SubDistrictRecord,
} from "@/types/index";
import { PhaseProgress, logPhaseHeader, truncate } from "@/lib/progress";
import { zipToText } from "@/lib/util";

function filterProvinces(
  raw: ProvinceRow[],
  config: Pick<
    ExtractConfig,
    "dryRun" | "maxProvinces" | "provinceStart" | "provinceEnd"
  >,
): ProvinceRow[] {
  let provinces = [...raw].sort((a, b) => a.id - b.id);

  if (config.provinceStart !== undefined) {
    provinces = provinces.filter((p) => p.id >= config.provinceStart!);
  }
  if (config.provinceEnd !== undefined) {
    provinces = provinces.filter((p) => p.id <= config.provinceEnd!);
  }
  if (config.maxProvinces !== undefined) {
    provinces = provinces.slice(0, config.maxProvinces);
  }
  if (config.dryRun && provinces.length > 1) {
    provinces = [provinces[0]!];
    console.log(
      `  (dry run) using first province only: ${provinces[0]?.name} (id ${provinces[0]?.id})`,
    );
  }

  return provinces;
}

function cityLabel(
  cityId: number,
  cities: Map<number, CityRecord>,
  provincesById: Map<number, string>,
): string {
  const city = cities.get(cityId);
  if (!city) return `city id ${cityId}`;
  const prov = provincesById.get(city.province_id) ?? `province ${city.province_id}`;
  return `${truncate(city.name)} · ${truncate(prov, 28)}`;
}

function districtLabel(
  districtId: number,
  districts: Map<number, DistrictRecord>,
  cities: Map<number, CityRecord>,
  provincesById: Map<number, string>,
): string {
  const district = districts.get(districtId);
  if (!district) return `district id ${districtId}`;
  const city = cities.get(district.city_id);
  const cityName = city ? truncate(city.name) : `city ${district.city_id}`;
  const prov =
    city && provincesById.get(city.province_id)
      ? truncate(provincesById.get(city.province_id)!, 24)
      : "";
  return prov
    ? `${truncate(district.name)} · ${cityName} · ${prov}`
    : `${truncate(district.name)} · ${cityName}`;
}

async function fetchCities(
  api: ApiClient,
  provinces: ProvinceRow[],
): Promise<Map<number, CityRecord>> {
  const cities = new Map<number, CityRecord>();
  const progress = new PhaseProgress("Fetching cities by province", provinces.length);

  for (let i = 0; i < provinces.length; i++) {
    const prov = provinces[i]!;
    const n = i + 1;
    progress.tick(n, truncate(prov.name), "requesting…");

    const rows = await api.fetchJson<ChildRow[]>(`/city/${prov.id}`);
    let added = 0;
    for (const c of rows) {
      if (!cities.has(c.id)) added++;
      cities.set(c.id, {
        province_id: prov.id,
        name: c.name,
        zip_code: zipToText(c.zip_code),
      });
    }

    progress.tick(
      n,
      truncate(prov.name),
      `+${rows.length} in province · ${cities.size} cities total`,
    );
  }

  progress.done(`${cities.size} cities/regencies across ${provinces.length} province(s)`);
  return cities;
}

async function fetchDistricts(
  api: ApiClient,
  cities: Map<number, CityRecord>,
  cityIds: number[],
  provincesById: Map<number, string>,
): Promise<Map<number, DistrictRecord>> {
  const districts = new Map<number, DistrictRecord>();
  const progress = new PhaseProgress("Fetching districts by city", cityIds.length);

  for (let i = 0; i < cityIds.length; i++) {
    const cityId = cityIds[i]!;
    const n = i + 1;
    const label = cityLabel(cityId, cities, provincesById);
    progress.tick(n, label, "requesting…");

    const rows = await api.fetchJson<ChildRow[]>(`/district/${cityId}`);
    let added = 0;
    for (const d of rows) {
      if (!districts.has(d.id)) {
        added++;
        districts.set(d.id, {
          city_id: cityId,
          name: d.name,
          zip_code: zipToText(d.zip_code),
        });
      }
    }

    progress.tick(
      n,
      label,
      `+${added} districts · ${districts.size} total`,
    );
  }

  progress.done(`${districts.size} districts across ${cityIds.length} city/cities`);
  return districts;
}

async function fetchSubDistricts(
  api: ApiClient,
  districts: Map<number, DistrictRecord>,
  cities: Map<number, CityRecord>,
  provincesById: Map<number, string>,
  districtIds: number[],
): Promise<SubDistrictRecord[]> {
  const byId = new Map<number, SubDistrictRecord>();
  const progress = new PhaseProgress("Fetching sub-districts by district", districtIds.length);

  for (let i = 0; i < districtIds.length; i++) {
    const distId = districtIds[i]!;
    const n = i + 1;
    const label = districtLabel(distId, districts, cities, provincesById);
    progress.tick(n, label, "requesting…");

    const rows = await api.fetchJson<ChildRow[]>(`/sub-district/${distId}`);
    let added = 0;
    for (const s of rows) {
      if (!byId.has(s.id)) {
        added++;
        byId.set(s.id, {
          id: s.id,
          district_id: distId,
          name: s.name,
          zip_code: zipToText(s.zip_code),
        });
      }
    }

    progress.tick(
      n,
      label,
      `+${added} kelurahan · ${byId.size} total`,
    );
  }

  const list = [...byId.values()].sort((a, b) => a.id - b.id);
  progress.done(`${list.length} sub-districts across ${districtIds.length} district(s)`);
  return list;
}

export async function crawlDestinations(
  api: ApiClient,
  config: ExtractConfig,
): Promise<CrawlResult> {
  const steps = 4;
  const provincesById = new Map<number, string>();

  logPhaseHeader(1, steps, "Provinces");
  console.log("  Requesting province list…");
  const provincesRaw = await api.fetchJson<ProvinceRow[]>("/province");
  const provinces = filterProvinces(provincesRaw, config);
  for (const p of provinces) provincesById.set(p.id, p.name);
  console.log(`  ✓ ${provinces.length} province(s) to crawl (of ${provincesRaw.length} nationwide)`);

  logPhaseHeader(2, steps, "Cities / regencies");
  const cities = await fetchCities(api, provinces);

  const cityIds = [...cities.keys()].sort((a, b) => a - b);
  const cityIdsForDistricts = config.dryRun ? cityIds.slice(0, 1) : cityIds;
  if (config.dryRun && cityIds.length > 1) {
    const sample = cities.get(cityIdsForDistricts[0]!);
    console.log(
      `  (dry run) districts for one city only: ${sample?.name ?? cityIdsForDistricts[0]}`,
    );
  }

  logPhaseHeader(3, steps, "Districts (kecamatan)");
  const districts = await fetchDistricts(
    api,
    cities,
    cityIdsForDistricts,
    provincesById,
  );

  const districtIds = [...districts.keys()].sort((a, b) => a - b);
  const districtIdsForSubs = config.dryRun ? districtIds.slice(0, 1) : districtIds;
  if (config.dryRun && districtIds.length > 1) {
    const sample = districts.get(districtIdsForSubs[0]!);
    console.log(
      `  (dry run) sub-districts for one district only: ${sample?.name ?? districtIdsForSubs[0]}`,
    );
  }

  logPhaseHeader(4, steps, "Sub-districts (kelurahan)");
  const subDistricts = await fetchSubDistricts(
    api,
    districts,
    cities,
    provincesById,
    districtIdsForSubs,
  );

  console.log("\n━━ Crawl complete ━━");
  console.log(
    `  ${provinces.length} provinces · ${cities.size} cities · ${districts.size} districts · ${subDistricts.length} sub-districts`,
  );

  return { provinces, cities, districts, subDistricts };
}
