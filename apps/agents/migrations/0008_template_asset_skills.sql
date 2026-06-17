-- Give every worker template the company asset-library skills so specialists
-- can pull past references (brand brief, prior plans, earlier deliverables)
-- into context mid-task and save artifacts they produce. The Correspondent
-- already has these (wired in code); this covers the template-driven workers.
--
-- Idempotent: the WHERE guard skips templates that already carry the skills, so
-- a re-run (or a template seeded after this point already including them) is a
-- no-op. json_insert(..., '$[#]', x) appends x to the end of the JSON array.

UPDATE template
SET skill_ids = json_insert(
      json_insert(
        json_insert(skill_ids, '$[#]', 'listAssets'),
        '$[#]', 'readAsset'
      ),
      '$[#]', 'saveAsset'
    ),
    updated_at = unixepoch() * 1000
WHERE skill_ids NOT LIKE '%listAssets%';
