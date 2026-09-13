const PUBLIC_INPUT_DESCRIPTIONS = Object.freeze({
  relai_read: new Set([
    'properties.asResource.description'
  ]),
  relai_edit: new Set([
    'description',
    'properties.file.description',
    'properties.expectedSha256.description',
    'properties.updateText.description',
    'properties.envAction.description'
  ]),
  relai_exec: new Set([
    'description',
    'properties.command.description',
    'properties.executable.description',
    'properties.input.description'
  ]),
  relai_process: new Set([
    'properties.command.description',
    'properties.executable.description',
    'properties.input.description'
  ])
});

function compactPublicInputSchema(name, inputSchema, catalogTool) {
  // Discovery is an ergonomic projection, not a second validator. Keep every
  // callable field visible to MCP clients, but leave action/form exclusivity and
  // conditional requirements to the canonical runtime contract. Some clients
  // simplify nested oneOf/anyOf/if schemas during import and can otherwise hide
  // valid fields (for example batched search queries) or collapse a tool to an
  // untyped argument object.
  const schema = importSafeInputSchema(inputSchema || {});
  const discoverySchema = name === 'relai_edit' ? hideInternalEditTransportFields(schema) : schema;
  const compact = stripDiscoveryValidationNoise(stripPublicDescriptions(discoverySchema, PUBLIC_INPUT_DESCRIPTIONS[name] || new Set()));
  const withInputForm = annotateInputForm(compact, inputSchema);
  if (name === 'relai_computer') return compactComputerInputSchema(withInputForm);
  return annotateActionGrammar(withInputForm, catalogTool);
}

function hideInternalEditTransportFields(schema) {
  if (!schema?.properties) return schema;
  const { stage: _stage, writeId: _writeId, ...properties } = schema.properties;
  return { ...schema, properties };
}

function compactComputerInputSchema(schema) {
  if (!schema?.properties?.action) return schema;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      action: {
        ...schema.properties.action,
        description: 'Fields: observe(app!,perception,maxElements); activate(app!,semanticObservationId!,targetId!); set_value(app!,semanticObservationId!,targetId!,value!); screenshot(app!,displayId); wait_for_change/wait_for_stable(app!,timeoutMs,pollMs,stableMs); move/click/double_click/right_click(app!,x!,y!,displayId); drag(app!,x!,y!,toX!,toY!,displayId); scroll(app!,direction!,distance,x,y,displayId); type(app!,text!); key(app!,key!); hotkey(app!,keys!); batch(app!,actions!,perception); approve_app/revoke_app(app!). Browsers view-only; terminals/IDEs click-only.'
      }
    }
  };
}

function importSafeInputSchema(inputSchema) {
  const {
    oneOf: _oneOf,
    anyOf: _anyOf,
    allOf: _allOf,
    if: _if,
    then: _then,
    else: _else,
    not: _not,
    propertyNames: _propertyNames,
    ...schema
  } = inputSchema;
  return schema;
}

function stripPublicDescriptions(value, retained, path = '') {
  if (Array.isArray(value)) return value.map(item => stripPublicDescriptions(item, retained, path));
  if (!value || typeof value !== 'object') return value;
  const compact = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'description' && !retained.has(childPath)) continue;
    compact[key] = stripPublicDescriptions(child, retained, childPath);
  }
  return compact;
}

function stripDiscoveryValidationNoise(value) {
  if (Array.isArray(value)) return value.map(stripDiscoveryValidationNoise);
  if (!value || typeof value !== 'object') return value;
  const compact = {};
  for (const [key, child] of Object.entries(value)) {
    if (['minLength', 'maxLength', 'minimum', 'maximum'].includes(key)) continue;
    compact[key] = stripDiscoveryValidationNoise(child);
  }
  return compact;
}

function annotateActionGrammar(schema, catalogTool) {
  const actions = (catalogTool?.actions || []).filter(entry => entry.action !== 'default');
  if (!actions.length || !schema?.properties?.action) return schema;

  const formHints = actions.map(actionInputFormHint).filter(Boolean);
  const actionGrammar = compactActionGrammar(actions);
  return {
    ...schema,
    properties: {
      ...schema.properties,
      action: {
        ...schema.properties.action,
        description: [
          actionGrammar,
          formHints.length ? `Forms: ${formHints.join('; ')}.` : ''
        ].filter(Boolean).join(' ')
      }
    }
  };
}

function annotateInputForm(schema, inputSchema) {
  const form = inputFormAlternatives(inputSchema);
  if (!form) return schema;
  return {
    ...schema,
    description: [schema.description, `Input form: ${form}.`].filter(Boolean).join(' ')
  };
}

function actionInputFormHint(entry) {
  const form = inputFormAlternatives(entry.inputSchema);
  return form ? `${entry.action}: ${form}` : '';
}

function inputFormAlternatives(schema) {
  const branches = Array.isArray(schema?.oneOf) ? schema.oneOf : Array.isArray(schema?.anyOf) ? schema.anyOf : [];
  if (branches.length < 2 || branches.length > 4) return '';
  const alternatives = branches.map(branch => [...new Set((branch?.required || [])
    .filter(field => !['workspace', 'work_id', 'action'].includes(field)))].sort());
  if (alternatives.some(fields => fields.length === 0)) return '';
  const labels = alternatives.map(fields => fields.join(' + '));
  if (new Set(labels).size !== labels.length) return '';
  return labels.join(' or ');
}

function compactActionGrammar(actions) {
  const fields = [...new Set(actions.flatMap(entry => entry.fields || []))].filter(field => field !== 'action');
  const actionSpecific = new Set(fields.filter(field => {
    const owners = actions.filter(entry => entry.fields?.includes(field));
    const requirements = owners.map(entry => entry.required?.includes(field) === true);
    return owners.length !== actions.length || new Set(requirements).size > 1;
  }));

  const parts = actions.map(entry => {
    const fieldsForAction = (entry.fields || [])
      .filter(field => actionSpecific.has(field))
      .map(field => `${field}${entry.required?.includes(field) ? '!' : ''}`);
    return fieldsForAction.length ? `${entry.action}(${fieldsForAction.join(',')})` : '';
  }).filter(Boolean);

  return parts.length ? `Fields: ${parts.join('; ')}. ! required.` : '';
}

export { compactPublicInputSchema };
