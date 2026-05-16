export type ApiMeta = {
  message?: string;
  code?: number;
  status?: string;
};

export type ApiResponse<T> = {
  meta: ApiMeta;
  data: T;
};

export type ProvinceRow = { id: number; name: string };
export type ChildRow = { id: number; name: string; zip_code: string | number };

export type CityRecord = {
  province_id: number;
  name: string;
  zip_code: string | null;
};

export type DistrictRecord = {
  city_id: number;
  name: string;
  zip_code: string | null;
};

export type SubDistrictRecord = {
  id: number;
  district_id: number;
  name: string;
  zip_code: string | null;
};

export type CrawlResult = {
  provinces: ProvinceRow[];
  cities: Map<number, CityRecord>;
  districts: Map<number, DistrictRecord>;
  subDistricts: SubDistrictRecord[];
};

export type ExtractConfig = {
  apiKey: string;
  outDir: string;
  delayMs: number;
  batchSize: number;
  maxRetries: number;
  dryRun: boolean;
  maxProvinces?: number;
  provinceStart?: number;
  provinceEnd?: number;
};
