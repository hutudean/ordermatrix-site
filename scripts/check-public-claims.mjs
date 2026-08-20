import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function expectIncludes(source, value, file) {
  expect(source.includes(value), `${file} must include: ${value}`);
}

function expectExcludes(source, value, file) {
  expect(!source.toLowerCase().includes(value.toLowerCase()), `${file} must not include: ${value}`);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

const [contractSource, lockSource, home, privacy] = await Promise.all([
  read("public-contract/product-claims.json"),
  read("claims.lock.json"),
  read("index.html"),
  read("privacy-policy.html"),
]);

let contract;
let lock;

try {
  contract = JSON.parse(contractSource);
} catch {
  fail("public-contract/product-claims.json must be valid JSON");
}

try {
  lock = JSON.parse(lockSource);
} catch {
  fail("claims.lock.json must be valid JSON");
}

if (contract && lock) {
  const digest = createHash("sha256").update(contractSource).digest("hex");
  expect(lock.schemaVersion === 1, "claims.lock.json schemaVersion must be 1");
  expect(lock.algorithm === "sha256", "claims.lock.json algorithm must be sha256");
  expect(
    lock.path === "public-contract/product-claims.json",
    "claims.lock.json must lock public-contract/product-claims.json",
  );
  expect(lock.sha256 === digest, `claims lock mismatch: expected ${digest}`);

  expect(contract.schemaVersion === 1, "product claims schemaVersion must be 1");
  expect(contract.releaseStatus === "private_preview", "releaseStatus must remain private_preview");
  expect(
    contract.publicAvailability?.shopifyAppStore === "not_listed",
    "Shopify App Store status must remain not_listed",
  );
  expect(contract.publicAvailability?.publicInstallation === false, "publicInstallation must be false");
  expect(contract.publicAvailability?.pilotApplications === false, "pilotApplications must be false");
  expect(
    contract.publicAvailability?.realProcurementDataAllowed === false,
    "realProcurementDataAllowed must be false",
  );
  expect(contract.contact?.email === "huan244194945@gmail.com", "contact email changed unexpectedly");
  expect(contract.contact?.responseTargetBusinessDays === 5, "response target must be 5 business days");
  expect(contract.contact?.sensitiveDataByEmailAllowed === false, "sensitive data by email must remain disallowed");

  const approvedCapabilityIds = [
    "exception_recovery",
    "shopify_native_validation",
    "smart_intake",
  ];
  const capabilityIds = contract.positioning?.capabilities?.map(({ id }) => id) ?? [];
  expect(
    JSON.stringify([...capabilityIds].sort()) === JSON.stringify(approvedCapabilityIds),
    "capabilities must remain exactly the approved private-preview set",
  );

  const approvedProcessors = [
    "GitHub Pages",
    "Gmail",
    "Google Cloud",
    "Google Gemini",
    "Shopify",
  ];
  const processorNames = contract.processors?.map(({ name }) => name) ?? [];
  expect(
    JSON.stringify([...processorNames].sort()) === JSON.stringify(approvedProcessors),
    "processors must remain exactly the approved disclosed set",
  );
  const processors = new Set(processorNames);
  for (const name of processors) {
    expectIncludes(privacy, name, "privacy-policy.html");
  }

  for (const claim of contract.prohibitedPublicClaims ?? []) {
    expectExcludes(home, claim, "index.html");
    expectExcludes(privacy, claim, "privacy-policy.html");
  }
}

const retiredClaimPatterns = [
  ["customer-group pricing", /customer[-\s]?group pricing/i],
  ["tiered or volume discounts", /tiered\s*(?:\/|or|and)\s*volume discounts?/i],
  ["local minimum-order engine", /\bmoq\b|order minimums?/i],
  ["locally provided net terms", /\bnet\s*(?:15|30|45|60|90)\b/i],
  ["wholesale registration", /wholesale registration/i],
  ["saved lists", /saved lists?/i],
  ["analytics dashboard", /analytics dashboard/i],
  ["Shopify Flow integration", /shopify flow/i],
  ["POS extension", /\bpos\b[^<]{0,30}extension/i],
  ["Checkout extension", /checkout[^<]{0,30}extension/i],
];

for (const [name, source] of [
  ["index.html", home],
  ["privacy-policy.html", privacy],
]) {
  expect(
    /<meta\s+name="robots"\s+content="noindex, nofollow"\s*\/>/i.test(source),
    `${name} must remain noindex, nofollow during private preview`,
  );
  expectIncludes(source, "huan244194945@gmail.com", name);
  expectIncludes(source, "5 business days", name);
  expectExcludes(source, "formspree", name);
  expect(
    !/<(?:form|input|textarea|select|button|script)\b/i.test(source),
    `${name} must not contain executable or data-collection controls`,
  );
  expect(!/\b(?:fetch|XMLHttpRequest)\s*\(/i.test(source), `${name} must not submit data with JavaScript`);
  expectExcludes(source, "apps.shopify.com", name);
  expectExcludes(source, "write_online_store_navigation", name);
  for (const href of source.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    expect(
      [
        "index.html",
        "privacy-policy.html",
        "mailto:huan244194945@gmail.com",
      ].includes(href[1]) || href[1].startsWith("#"),
      `${name} contains an unapproved link target: ${href[1]}`,
    );
  }
  for (const [label, pattern] of retiredClaimPatterns) {
    expect(!pattern.test(source), `${name} must not claim retired capability: ${label}`);
  }
  expect(
    !/<a\b[^>]*>[\s\S]*?\b(?:install|view listing|request pilot)\b[\s\S]*?<\/a>/i.test(source),
    `${name} must not contain an install, listing, or pilot-application CTA`,
  );
}

expectIncludes(home, "Private preview", "index.html");
expectIncludes(
  normalizeWhitespace(home),
  "Turn messy B2B purchase requests into Shopify-validated Draft Orders and RFQs.",
  "index.html",
);
expectIncludes(home, "Smart Intake", "index.html");
expectIncludes(home, "Shopify-native validation", "index.html");
expectIncludes(home, "Exception recovery", "index.html");
expectIncludes(home, "must not be used with real procurement data", "index.html");

expectIncludes(privacy, "Private Preview Privacy Notice", "privacy-policy.html");
for (const name of [
  "GitHub Pages",
  "Gmail",
  "Google Cloud",
  "Shopify",
  "Google Gemini",
]) {
  expectIncludes(privacy, name, "privacy-policy.html");
}
expectIncludes(privacy, "up to 7 days", "privacy-policy.html");
expectIncludes(privacy, "up to 30 days", "privacy-policy.html");
expectIncludes(privacy, "not a zero-data-retention guarantee", "privacy-policy.html");

if (failures.length > 0) {
  console.error("Public claims validation failed:\n");
  for (const message of failures) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log("Public claims, privacy disclosures, and SHA-256 lock are valid.");
}
