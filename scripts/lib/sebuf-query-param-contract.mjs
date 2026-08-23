import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import ts from 'typescript';

export const NOOP_QUERY_DESCRIPTION_RE = /\b(?:accepted but currently ignored|currently (?:ignored|a no-op)|no-op|no op)\b/i;

const DEFAULT_SCOPED_PROTO_FILES = new Set([
  'eagleeye/aviation/v1/list_airport_delays.proto',
  'eagleeye/climate/v1/list_climate_anomalies.proto',
  'eagleeye/conflict/v1/list_acled_events.proto',
  'eagleeye/conflict/v1/list_ucdp_events.proto',
  'eagleeye/cyber/v1/list_cyber_threats.proto',
  'eagleeye/economic/v1/get_economic_calendar.proto',
  'eagleeye/economic/v1/get_energy_capacity.proto',
  'eagleeye/economic/v1/list_world_bank_indicators.proto',
  'eagleeye/infrastructure/v1/list_internet_outages.proto',
  'eagleeye/intelligence/v1/search_gdelt_documents.proto',
  'eagleeye/maritime/v1/list_navigational_warnings.proto',
  'eagleeye/market/v1/get_sector_summary.proto',
  'eagleeye/market/v1/list_earnings_calendar.proto',
  'eagleeye/military/v1/get_theater_posture.proto',
  'eagleeye/military/v1/list_military_flights.proto',
  'eagleeye/natural/v1/list_natural_events.proto',
  'eagleeye/prediction/v1/list_prediction_markets.proto',
  'eagleeye/research/v1/list_arxiv_papers.proto',
  'eagleeye/seismology/v1/list_earthquakes.proto',
  'eagleeye/trade/v1/get_trade_barriers.proto',
  'eagleeye/trade/v1/get_trade_restrictions.proto',
  'eagleeye/unrest/v1/list_unrest_events.proto',
  'eagleeye/wildfire/v1/list_fire_detections.proto',
]);

const DEFAULT_FORCED_NOOP_QUERY_PARAMS = new Set([
  'eagleeye/aviation/v1/list_airport_delays.proto:page_size',
  'eagleeye/aviation/v1/list_airport_delays.proto:cursor',
  'eagleeye/aviation/v1/list_airport_delays.proto:region',
  'eagleeye/aviation/v1/list_airport_delays.proto:min_severity',
  'eagleeye/climate/v1/list_climate_anomalies.proto:page_size',
  'eagleeye/climate/v1/list_climate_anomalies.proto:cursor',
  'eagleeye/climate/v1/list_climate_anomalies.proto:min_severity',
  'eagleeye/conflict/v1/list_acled_events.proto:page_size',
  'eagleeye/conflict/v1/list_acled_events.proto:cursor',
  'eagleeye/conflict/v1/list_ucdp_events.proto:start',
  'eagleeye/conflict/v1/list_ucdp_events.proto:end',
  'eagleeye/conflict/v1/list_ucdp_events.proto:page_size',
  'eagleeye/conflict/v1/list_ucdp_events.proto:cursor',
  'eagleeye/cyber/v1/list_cyber_threats.proto:start',
  'eagleeye/cyber/v1/list_cyber_threats.proto:end',
  'eagleeye/economic/v1/get_economic_calendar.proto:fromDate',
  'eagleeye/economic/v1/get_economic_calendar.proto:toDate',
  'eagleeye/economic/v1/get_energy_capacity.proto:years',
  'eagleeye/economic/v1/list_world_bank_indicators.proto:page_size',
  'eagleeye/economic/v1/list_world_bank_indicators.proto:cursor',
  'eagleeye/infrastructure/v1/list_internet_outages.proto:page_size',
  'eagleeye/infrastructure/v1/list_internet_outages.proto:cursor',
  'eagleeye/intelligence/v1/search_gdelt_documents.proto:timespan',
  'eagleeye/intelligence/v1/search_gdelt_documents.proto:tone_filter',
  'eagleeye/intelligence/v1/search_gdelt_documents.proto:sort',
  'eagleeye/maritime/v1/list_navigational_warnings.proto:page_size',
  'eagleeye/maritime/v1/list_navigational_warnings.proto:cursor',
  'eagleeye/market/v1/get_sector_summary.proto:period',
  'eagleeye/market/v1/list_earnings_calendar.proto:fromDate',
  'eagleeye/market/v1/list_earnings_calendar.proto:toDate',
  'eagleeye/military/v1/get_theater_posture.proto:theater',
  'eagleeye/military/v1/list_military_flights.proto:operator',
  'eagleeye/military/v1/list_military_flights.proto:aircraft_type',
  'eagleeye/natural/v1/list_natural_events.proto:days',
  'eagleeye/prediction/v1/list_prediction_markets.proto:cursor',
  'eagleeye/research/v1/list_arxiv_papers.proto:cursor',
  'eagleeye/research/v1/list_arxiv_papers.proto:query',
  'eagleeye/seismology/v1/list_earthquakes.proto:start',
  'eagleeye/seismology/v1/list_earthquakes.proto:end',
  'eagleeye/seismology/v1/list_earthquakes.proto:cursor',
  'eagleeye/seismology/v1/list_earthquakes.proto:min_magnitude',
  'eagleeye/trade/v1/get_trade_barriers.proto:countries',
  'eagleeye/trade/v1/get_trade_barriers.proto:measure_type',
  'eagleeye/trade/v1/get_trade_restrictions.proto:countries',
  'eagleeye/unrest/v1/list_unrest_events.proto:page_size',
  'eagleeye/unrest/v1/list_unrest_events.proto:cursor',
  'eagleeye/unrest/v1/list_unrest_events.proto:min_severity',
  'eagleeye/unrest/v1/list_unrest_events.proto:ne_lat',
  'eagleeye/unrest/v1/list_unrest_events.proto:ne_lon',
  'eagleeye/unrest/v1/list_unrest_events.proto:sw_lat',
  'eagleeye/unrest/v1/list_unrest_events.proto:sw_lon',
  'eagleeye/wildfire/v1/list_fire_detections.proto:start',
  'eagleeye/wildfire/v1/list_fire_detections.proto:end',
  'eagleeye/wildfire/v1/list_fire_detections.proto:page_size',
  'eagleeye/wildfire/v1/list_fire_detections.proto:cursor',
  'eagleeye/wildfire/v1/list_fire_detections.proto:ne_lat',
  'eagleeye/wildfire/v1/list_fire_detections.proto:ne_lon',
  'eagleeye/wildfire/v1/list_fire_detections.proto:sw_lat',
  'eagleeye/wildfire/v1/list_fire_detections.proto:sw_lon',
]);

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function slash(path) {
  return path.split(sep).join('/');
}

// Exported so every proto-contract gate converts proto field names the same way.
// tests/freight-indices.test.mjs's ShippingIndex gate (#6078) reads field names
// out of a .proto exactly like parseProtoQueryFields does below; two private
// copies of this rule would let the two gates disagree on the same field.
export function snakeToCamel(value) {
  return value.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

function snakeToKebab(value) {
  return value.replace(/_/g, '-');
}

function parseProtoQueryFields(protoFile) {
  const lines = readFileSync(protoFile, 'utf8').split('\n');
  const fields = [];
  let comments = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith('//')) {
      comments.push(trimmed.replace(/^\/\/\s?/, ''));
      continue;
    }
    if (trimmed === '') {
      comments = [];
      continue;
    }

    const fieldMatch = trimmed.match(/^(?:optional\s+|repeated\s+)?(?:map<[^>]+>|[A-Za-z_][\w.]*)\s+([a-z][a-z0-9_]*)\s*=\s*\d+\b/);
    if (!fieldMatch) {
      comments = [];
      continue;
    }

    const startLine = i + 1;
    let declaration = trimmed;
    while (!declaration.includes(';') && i + 1 < lines.length) {
      i++;
      declaration += ' ' + lines[i].trim();
    }

    if (declaration.includes('(sebuf.http.query)')) {
      const fieldName = fieldMatch[1];
      const queryName = declaration.match(/\(sebuf\.http\.query\)\s*=\s*\{[^}]*\bname\s*:\s*"([^"]+)"/)?.[1] ?? fieldName;
      fields.push({
        file: protoFile,
        line: startLine,
        fieldName,
        tsName: snakeToCamel(fieldName),
        queryName,
        unimplemented: /\(sebuf\.http\.unimplemented\)\s*=\s*true\b/.test(declaration),
        comment: comments.join(' '),
      });
    }

    comments = [];
  }

  return fields;
}

function handlerPathForProto(root, protoFile) {
  const rel = slash(relative(join(root, 'proto'), protoFile));
  const parts = rel.split('/');
  if (parts[0] !== 'eagleeye' || parts.length < 4) return null;

  const snakeDomain = parts[1];
  const version = parts[2];
  const filename = parts[3];
  const handlerName = snakeToKebab(basename(filename, '.proto'));
  return join(root, 'server', 'eagleeye', snakeToKebab(snakeDomain), version, handlerName + '.ts');
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function bindingElementUsesField(node, field) {
  const candidates = [node.propertyName, node.name].filter(Boolean);
  return candidates.some((candidate) => {
    if (ts.isIdentifier(candidate)) return candidate.text === field.tsName;
    if (isStringLiteralLike(candidate)) return candidate.text === field.tsName || candidate.text === field.queryName;
    return false;
  });
}

function bindingPatternUsesField(pattern, field) {
  return pattern.elements.some((element) => ts.isBindingElement(element) && bindingElementUsesField(element, field));
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function collectHandlerRequestNames(source, field) {
  const requestNames = new Set();
  let requestParamUsesField = false;

  function collectFunctionLike(node) {
    const requestParam = node.parameters[1];
    if (!requestParam) return;
    if (ts.isIdentifier(requestParam.name)) {
      requestNames.add(requestParam.name.text);
    } else if (ts.isObjectBindingPattern(requestParam.name) && bindingPatternUsesField(requestParam.name, field)) {
      requestParamUsesField = true;
    }
  }

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      collectFunctionLike(statement);
      continue;
    }

    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        collectFunctionLike(initializer);
      }
    }
  }

  return { requestNames, requestParamUsesField };
}

function isRequestIdentifier(expression, requestNames) {
  return ts.isIdentifier(expression) && requestNames.has(expression.text);
}

function collectRequestAliases(source, requestNames) {
  const aliases = new Set(requestNames);
  let changed = true;

  while (changed) {
    changed = false;
    function visit(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        isRequestIdentifier(node.initializer, aliases) &&
        !aliases.has(node.name.text)
      ) {
        aliases.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  return aliases;
}

function bindingElementIsFromRequest(node, requestNames) {
  const pattern = node.parent;
  if (!ts.isObjectBindingPattern(pattern)) return false;
  const declaration = pattern.parent;
  return (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    isRequestIdentifier(declaration.initializer, requestNames)
  );
}

function handlerUsesField(handlerPath, field) {
  const source = ts.createSourceFile(
    handlerPath,
    readFileSync(handlerPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const { requestNames, requestParamUsesField } = collectHandlerRequestNames(source, field);
  if (requestParamUsesField) return true;

  const requestAliases = collectRequestAliases(source, requestNames);
  if (requestAliases.size === 0) return false;

  let used = false;

  function visit(node) {
    if (used) return;

    if (
      ts.isPropertyAccessExpression(node) &&
      isRequestIdentifier(node.expression, requestAliases) &&
      node.name.text === field.tsName
    ) {
      used = true;
      return;
    }

    if (
      ts.isElementAccessExpression(node) &&
      isRequestIdentifier(node.expression, requestAliases) &&
      node.argumentExpression &&
      isStringLiteralLike(node.argumentExpression) &&
      (node.argumentExpression.text === field.tsName || node.argumentExpression.text === field.queryName)
    ) {
      used = true;
      return;
    }

    if (ts.isBindingElement(node) && bindingElementIsFromRequest(node, requestAliases) && bindingElementUsesField(node, field)) {
      used = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return used;
}

export function collectQueryParamContractViolations(root, options = {}) {
  const scopedProtoFiles = options.scopedProtoFiles ?? DEFAULT_SCOPED_PROTO_FILES;
  const forcedNoopQueryParams = options.forcedNoopQueryParams ?? DEFAULT_FORCED_NOOP_QUERY_PARAMS;
  const seenQueryParams = new Set();
  const protoRoot = join(root, 'proto', 'eagleeye');
  const protoFiles = walk(protoRoot).filter((file) => file.endsWith('.proto'));
  const violations = [];
  const stats = {
    protoFiles: protoFiles.length,
    queryFields: 0,
    unimplementedFields: 0,
    scopedQueryFields: 0,
  };

  for (const protoFile of protoFiles) {
    const handlerPath = handlerPathForProto(root, protoFile);
    const fields = parseProtoQueryFields(protoFile);
    if (fields.length === 0) continue;

    const protoRel = slash(relative(join(root, 'proto'), protoFile));
    const isScopedProto = scopedProtoFiles.has(protoRel);
    const hasAnnotatedField = fields.some((field) => field.unimplemented);
    if (!isScopedProto && !hasAnnotatedField) continue;

    if (!handlerPath || !existsSync(handlerPath)) {
      for (const field of fields) {
        violations.push({
          file: slash(relative(root, field.file)) + ':' + field.line,
          message: 'query param "' + field.queryName + '" has no matching handler file to verify',
          remedy: 'Restore the server/eagleeye handler or move/remove the query annotation.',
        });
      }
      continue;
    }

    for (const field of fields) {
      stats.queryFields++;
      if (isScopedProto) stats.scopedQueryFields++;
      if (field.unimplemented) stats.unimplementedFields++;

      const queryParamKey = protoRel + ':' + field.queryName;
      seenQueryParams.add(queryParamKey);
      const mustBeNoop = forcedNoopQueryParams.has(queryParamKey);
      const relativeField = slash(relative(root, field.file)) + ':' + field.line;
      if (field.unimplemented && !NOOP_QUERY_DESCRIPTION_RE.test(field.comment)) {
        violations.push({
          file: relativeField,
          message: 'query param "' + field.queryName + '" is marked unimplemented but its proto comment does not disclose accepted-but-ignored/no-op behavior',
          remedy: 'Update the field comment so generated OpenAPI explicitly states the parameter is currently a no-op.',
        });
      }

      if (mustBeNoop && !field.unimplemented) {
        violations.push({
          file: relativeField,
          message: 'query param "' + field.queryName + '" is in the #4607 no-op registry but is not marked unimplemented',
          remedy: 'Mark the proto field with (sebuf.http.unimplemented) = true and document the accepted-but-ignored behavior.',
        });
      }

      if (isScopedProto && !field.unimplemented && !handlerUsesField(handlerPath, field)) {
        violations.push({
          file: relativeField,
          message: 'query param "' + field.queryName + '" is declared but not referenced by ' + slash(relative(root, handlerPath)),
          remedy: 'Implement the parameter in the handler, or mark the proto field with (sebuf.http.unimplemented) = true and document the no-op behavior in the field comment.',
        });
      }
    }
  }

  for (const forced of forcedNoopQueryParams) {
    if (!seenQueryParams.has(forced)) {
      violations.push({
        file: 'scripts/lib/sebuf-query-param-contract.mjs',
        message: '#4607 no-op registry entry "' + forced + '" no longer matches a proto query param',
        remedy: 'Update the registry after renaming/removing the query param, or restore the proto annotation.',
      });
    }
  }

  return { violations, stats };
}
