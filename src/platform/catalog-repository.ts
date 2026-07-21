import { validateTrackCatalog } from "../domain/track-catalog";
import type { Track } from "../domain/types";

export interface TrackCatalogRepository {
  load(date: string): Promise<Track[]>;
}

export class FetchTrackCatalogRepository implements TrackCatalogRepository {
  constructor(private readonly url: URL) {}

  async load(date: string): Promise<Track[]> {
    const url = new URL(this.url);
    url.searchParams.set("date", date);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Track catalog returned ${response.status}.`);
    return validateTrackCatalog(await response.json());
  }
}
