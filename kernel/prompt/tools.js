import { HOST_TOOLS } from '../control/host/tools.js';

/**
 * Tool catalog section.
 * Auto-generated from HOST_TOOLS — single source of truth.
 * When tools are added/changed in host/tools.js, the prompt updates automatically.
 */
export function buildToolsSection() {
  const lines = [
    `## Available Tools (${HOST_TOOLS.length})`,
    '',
  ];

  for (const tool of HOST_TOOLS) {
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);

    const schema = tool.inputSchema;
    if (schema?.properties) {
      const props = Object.entries(schema.properties);
      if (props.length > 0) {
        const required = new Set(schema.required || []);
        lines.push('');
        lines.push('| Param | Type | Required | Description |');
        lines.push('|-------|------|----------|-------------|');
        for (const [name, prop] of props) {
          const req = required.has(name) ? '✓' : '';
          const type = formatType(prop);
          const desc = (prop.description || '').replace(/\|/g, '\\|');
          lines.push(`| \`${name}\` | ${type} | ${req} | ${desc} |`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatType(prop) {
  const base = prop.type || 'any';
  if (prop.enum) {
    return prop.enum.map((v) => `\`${v}\``).join(' \\| ');
  }
  return base;
}
