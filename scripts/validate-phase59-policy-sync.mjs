#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migrationPath = "supabase/migration_phase59_rls_read_policies.sql";
const schemaPath = "supabase/schema.sql";

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function normalizeSql(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractBlocks(source, pattern) {
  const blocks = new Map();
  for (const match of source.matchAll(pattern)) {
    blocks.set(match[1], normalizeSql(match[0]));
  }
  return blocks;
}

function extractPolicies(source) {
  return extractBlocks(source, /create\s+policy\s+([a-z0-9_]+)[\s\S]*?;/gi);
}

function extractCareWedoFunctions(source) {
  return extractBlocks(
    source,
    /create\s+or\s+replace\s+function\s+public\.(care_wedo_[a-z0-9_]+)\([\s\S]*?\$\$;/gi,
  );
}

function extractPolicyDrops(source) {
  return new Set([...source.matchAll(/drop\s+policy\s+if\s+exists\s+([a-z0-9_]+)/gi)].map((match) => match[1]));
}

function extractDirectWriteRevokes(source) {
  return new Set(
    [...source.matchAll(/revoke\s+insert,\s*update,\s*delete\s+on\s+(public\.[a-z0-9_]+|storage\.objects)\s+from\s+anon,\s*authenticated\s*;/gi)]
      .map((match) => normalizeSql(match[0])),
  );
}

function compareNamedBlocks(label, migrationBlocks, schemaBlocks, failures) {
  const names = Array.from(new Set([...migrationBlocks.keys(), ...schemaBlocks.keys()])).sort();
  for (const name of names) {
    if (!migrationBlocks.has(name)) {
      failures.push(`${label} missing from migration: ${name}`);
      continue;
    }
    if (!schemaBlocks.has(name)) {
      failures.push(`${label} missing from schema.sql: ${name}`);
      continue;
    }
    if (migrationBlocks.get(name) !== schemaBlocks.get(name)) {
      failures.push(`${label} drift between migration and schema.sql: ${name}`);
    }
  }
  return names.length;
}

function compareSets(label, migrationSet, schemaSet, failures) {
  const values = Array.from(new Set([...migrationSet, ...schemaSet])).sort();
  for (const value of values) {
    if (!migrationSet.has(value)) failures.push(`${label} missing from migration: ${value}`);
    if (!schemaSet.has(value)) failures.push(`${label} missing from schema.sql: ${value}`);
  }
  return values.length;
}

const migration = readProjectFile(migrationPath);
const schema = readProjectFile(schemaPath);

const migrationPolicies = extractPolicies(migration);
const schemaPolicies = extractPolicies(schema);
const migrationFunctions = extractCareWedoFunctions(migration);
const schemaFunctions = extractCareWedoFunctions(schema);
const migrationDrops = extractPolicyDrops(migration);
const schemaDrops = extractPolicyDrops(schema);
const migrationRevokes = extractDirectWriteRevokes(migration);
const schemaRevokes = extractDirectWriteRevokes(schema);

const failures = [];
const policyCount = compareNamedBlocks("policy", migrationPolicies, schemaPolicies, failures);
const functionCount = compareNamedBlocks("helper function", migrationFunctions, schemaFunctions, failures);
const revokeCount = compareSets("direct-write revoke", migrationRevokes, schemaRevokes, failures);

for (const name of migrationPolicies.keys()) {
  if (!migrationDrops.has(name)) failures.push(`migration policy is missing rollback drop: ${name}`);
}
for (const name of schemaPolicies.keys()) {
  if (!schemaDrops.has(name)) failures.push(`schema policy is missing rollback drop: ${name}`);
}

if (failures.length > 0) {
  console.error("Phase 59 RLS policy sync FAILED:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Phase 59 RLS policy sync OK: ${policyCount} policies, ${functionCount} helper functions, ${revokeCount} direct-write revokes.`);
