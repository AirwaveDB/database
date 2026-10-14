# Data sources

AirwaveDB imports open directory data and keeps upstream identifiers in `data/source_map.json`.

## Radio Browser

- Website: https://www.radio-browser.info/
- API documentation: https://docs.radio-browser.info/
- Role: primary station discovery and metadata source
- Imported fields: station UUID, name, country, subdivision, languages, tags, homepage, favicon, popularity metadata, and update timestamps

AirwaveDB queries entries reported as working by the directory (`hidebroken=true`) and uses a descriptive User-Agent. Multiple Radio Browser mirrors are tried before a sync is considered unavailable.

## verified-radio-streams

- Repository: https://github.com/eyalev/verified-radio-streams
- Role: independently verified stream source and secondary metadata source
- License: CC0 1.0

The dataset contains stream endpoints that returned audio during its verification run. AirwaveDB preserves the upstream verification date and source ID.

## Source precedence

No upstream source is treated as authoritative for every field. AirwaveDB groups matching source records into a stable station entity, preserves provenance, and selects display metadata deterministically. Existing source-to-station mappings are reused so normal upstream metadata changes do not unnecessarily change AirwaveDB station IDs.

A scheduled rebuild is rejected when a required upstream source is unavailable or when the resulting dataset shrinks unexpectedly. This keeps a temporary upstream failure from replacing a healthy snapshot.

Missing metadata is left empty rather than guessed. Station and stream records can change independently: stream URLs are stored in `AirwaveDB/streams`, not in this repository.
