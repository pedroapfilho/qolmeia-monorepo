-- Give every worker template the web capabilities: webSearch (Exa — find
-- pages) and fetchUrl (Firecrawl — read a specific page as markdown). The
-- Correspondent already has both (wired in code); this covers the workers.
--
-- Two guarded UPDATEs so each skill is appended only where missing — the
-- Redator/Pesquisador already carry webSearch (from 0009), so that pass skips
-- them, and neither gets a duplicate. json_insert(..., '$[#]', x) appends.

UPDATE template
SET skill_ids = json_insert(skill_ids, '$[#]', 'webSearch'),
    updated_at = unixepoch() * 1000
WHERE skill_ids NOT LIKE '%webSearch%';

UPDATE template
SET skill_ids = json_insert(skill_ids, '$[#]', 'fetchUrl'),
    updated_at = unixepoch() * 1000
WHERE skill_ids NOT LIKE '%fetchUrl%';
