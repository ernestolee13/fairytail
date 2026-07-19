import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("Claude explainer is a one-turn tool-free pinned presentation surface", async () => {
  const agent = await readFile(
    join(root, "agents", "fairytail-explainer.md"),
    "utf8",
  );
  const frontmatter = agent.split("---")[1];
  const body = agent.split("---").slice(2).join("---");

  assert.match(frontmatter, /^name: fairytail-explainer$/mu);
  assert.match(frontmatter, /^model: claude-haiku-4-5-20251001$/mu);
  assert.match(frontmatter, /^effort: low$/mu);
  assert.match(frontmatter, /^maxTurns: 1$/mu);
  assert.match(frontmatter, /^tools: \[\]$/mu);
  assert.doesNotMatch(frontmatter, /inherit|sonnet|opus/u);
  assert.match(body, /exactly one JSON object/u);
  assert.match(body, /no prose/u);
  assert.match(body, /Do not add, remove, summarize, translate, or rewrite/u);
  assert.match(body, /code, commands, dependencies/u);
  assert.match(body, /safety boundaries/u);
  assert.match(body, /verification evidence/u);
  assert.match(body, /not the packet producer/u);
  assert.doesNotMatch(agent, /[가-힣]/u);
});

test("canonical concept skill takes the direct bounded path", async () => {
  const skill = await readFile(
    join(root, "skills", "fairytail-explain-concept", "SKILL.md"),
    "utf8",
  );
  const frontmatter = skill.split("---")[1];
  const body = skill.split("---").slice(2).join("---");

  assert.match(frontmatter, /^name: fairytail-explain-concept$/mu);
  assert.doesNotMatch(frontmatter, /^disable-model-invocation:/mu);
  assert.doesNotMatch(frontmatter, /^model:/mu);
  assert.match(body, /Run the bundled script as the first action/u);
  assert.match(body, /Do not inspect the repository/u);
  assert.match(body, /treat stdout as the final answer/u);
  assert.match(body, /Do not summarize, translate, reorder/u);
  assert.match(body, /no model or\s+network call/u);
  assert.match(body, /does not participate in implementation work/u);
  assert.doesNotMatch(body, /src\/|schemas?\/|tests?\//u);
  assert.doesNotMatch(skill, /[가-힣]/u);
});

test("analogy mapper is one-turn, tool-free, and limited to consent-bound role slots", async () => {
  const agent = await readFile(
    join(root, "agents", "fairytail-analogy-mapper.md"),
    "utf8",
  );
  const frontmatter = agent.split("---")[1];
  const body = agent.split("---").slice(2).join("---");

  assert.match(frontmatter, /^name: fairytail-analogy-mapper$/mu);
  assert.match(frontmatter, /^model: claude-haiku-4-5-20251001$/mu);
  assert.match(frontmatter, /^effort: low$/mu);
  assert.match(frontmatter, /^maxTurns: 1$/mu);
  assert.match(frontmatter, /^tools: \[\]$/mu);
  assert.match(body, /copy exactly one item from `familiar_contexts`/u);
  assert.match(body, /exactly every `role_ids` item/u);
  assert.match(body, /Do not repeat or rewrite the relation\s+strings/u);
  assert.match(body, /copy exactly one item from `familiar_contexts`/u);
  assert.match(body, /two\s+distinct items joined/u);
  assert.match(body, /Do not write any other word/u);
  assert.doesNotMatch(frontmatter, /inherit|sonnet|opus/u);
});

test("presentation patch schema exposes no content-authoring field", async () => {
  const schema = JSON.parse(
    await readFile(
      join(root, "schemas", "v1", "explanation-patch.schema.json"),
      "utf8",
    ),
  );
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), [
    "schema_version",
    "packet_id",
    "protected_render_hash",
    "section_order",
    "section_detail",
  ]);
  assert.equal(schema.properties.section_order.minItems, 8);
  assert.equal(schema.properties.section_order.maxItems, 8);
  assert.equal(schema.properties.section_order.uniqueItems, true);
  assert.equal(schema.properties.section_detail.additionalProperties, false);
  assert.deepEqual(schema.$defs.detail.enum, ["full", "compact"]);
  assert.doesNotMatch(
    JSON.stringify(schema.properties),
    /replacement|prose|content|code/u,
  );
});
