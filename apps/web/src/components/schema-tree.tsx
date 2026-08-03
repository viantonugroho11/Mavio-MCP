interface SchemaNode {
  type?: string | string[];
  description?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
  enum?: unknown[];
  format?: string;
  default?: unknown;
  $ref?: string;
}

function typeLabel(node: SchemaNode): string {
  if (node.$ref) return `→ ${node.$ref}`;
  if (Array.isArray(node.type)) return node.type.join(" | ");
  if (node.type) return node.type;
  if (node.properties) return "object";
  if (node.items) return "array";
  if (node.enum) return "enum";
  return "any";
}

export function SchemaTree({
  schema,
  depth = 0,
}: {
  schema: SchemaNode | Record<string, unknown>;
  depth?: number;
}): JSX.Element {
  const node = schema as SchemaNode;
  const required = new Set(node.required ?? []);
  const props = node.properties ?? {};
  const entries = Object.entries(props);

  if (entries.length === 0 && !node.items) {
    return (
      <div className="text-xs text-muted italic pl-4">
        {node.type ? `(${typeLabel(node)})` : "(no properties)"}
      </div>
    );
  }

  return (
    <ul className="text-xs font-mono" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      {entries.map(([name, sub]) => {
        const isRequired = required.has(name);
        const label = typeLabel(sub);
        const nested = sub.properties || sub.items;
        return (
          <li key={name} className="py-1 border-l border-rule pl-3">
            <div className="flex items-baseline gap-2">
              <span className="text-ink">{name}</span>
              {isRequired && <span className="text-bronze">*</span>}
              <span className="text-muted">:</span>
              <span className="text-accent">{label}</span>
              {sub.format && <span className="text-muted">/{sub.format}</span>}
              {sub.enum && (
                <span className="text-muted">
                  ∈ [{sub.enum.map((v) => JSON.stringify(v)).join(", ")}]
                </span>
              )}
            </div>
            {sub.description && (
              <div className="text-muted pl-3 italic normal-case">{sub.description}</div>
            )}
            {nested && (
              <SchemaTree
                schema={sub.items ?? sub}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
      {node.items && entries.length === 0 && (
        <li className="py-1 border-l border-rule pl-3">
          <div className="text-muted">item: {typeLabel(node.items)}</div>
          <SchemaTree schema={node.items} depth={depth + 1} />
        </li>
      )}
    </ul>
  );
}
