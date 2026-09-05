import { Type, type Static } from '@sinclair/typebox';

/** Visual values only. Profiles and blueprints own required content. */
export const TYPE_ROLES = [
  'eyebrow',
  'display',
  'stat',
  'quote',
  'label',
  'footer',
  'tableHeader',
  'tableCell',
  'chartLabel',
  'tracker',
  'source',
] as const;
export const TypeRoleNameSchema = Type.Union(
  TYPE_ROLES.map((name) => Type.Literal(name))
);
export type TypeRoleName = (typeof TYPE_ROLES)[number];
export const CANVASES = ['a4', 'letter', 'wide169', 'standard43'] as const;
export type DesignCanvas = (typeof CANVASES)[number];
export const TextCaseSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('upper'),
  Type.Literal('smallCaps'),
]);
const ColorTokenSchema = Type.String({
  pattern: '^(#?[0-9A-Fa-f]{6}|[a-zA-Z][a-zA-Z0-9]*)$',
  description:
    'Six-digit hex or a theme color/palette token. References must resolve without cycles.',
});
export const PaletteSchema = Type.Object(
  {
    rule: Type.Optional(ColorTokenSchema),
    textMuted: Type.Optional(ColorTokenSchema),
    onPrimary: Type.Optional(ColorTokenSchema),
    surfaceInverse: Type.Optional(ColorTokenSchema),
    positive: Type.Optional(ColorTokenSchema),
    negative: Type.Optional(ColorTokenSchema),
    chart: Type.Optional(
      Type.Array(ColorTokenSchema, { minItems: 1, maxItems: 12 })
    ),
  },
  { additionalProperties: false }
);

export const TypeRoleSchema = Type.Object(
  {
    face: Type.Optional(
      Type.Union([
        Type.Literal('heading'),
        Type.Literal('body'),
        Type.Literal('mono'),
        Type.Literal('light'),
      ])
    ),
    weight: Type.Optional(Type.Integer({ minimum: 100, maximum: 900 })),
    size: Type.Optional(
      Type.Number({
        minimum: 5,
        maximum: 200,
        description:
          'Explicit size in points; takes precedence over the canvas scale.',
      })
    ),
    lineHeight: Type.Optional(Type.Number({ minimum: 0.5, maximum: 3 })),
    tracking: Type.Optional(
      Type.Number({ description: 'Tracking in hundredths of an em.' })
    ),
    case: Type.Optional(TextCaseSchema),
    color: Type.Optional(ColorTokenSchema),
    spaceBefore: Type.Optional(Type.Number({ minimum: 0 })),
    spaceAfter: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false }
);
// Explicit properties preserve literal keys in Static<> (Object.fromEntries does not).
export const TypeRolesSchema = Type.Object(
  {
    eyebrow: Type.Optional(TypeRoleSchema),
    display: Type.Optional(TypeRoleSchema),
    stat: Type.Optional(TypeRoleSchema),
    quote: Type.Optional(TypeRoleSchema),
    label: Type.Optional(TypeRoleSchema),
    footer: Type.Optional(TypeRoleSchema),
    tableHeader: Type.Optional(TypeRoleSchema),
    tableCell: Type.Optional(TypeRoleSchema),
    chartLabel: Type.Optional(TypeRoleSchema),
    tracker: Type.Optional(TypeRoleSchema),
    source: Type.Optional(TypeRoleSchema),
  },
  { additionalProperties: false }
);
const ScaleSchema = Type.Object(
  {
    base: Type.Number({ minimum: 5, maximum: 200 }),
    ratio: Type.Optional(Type.Number({ minimum: 1, maximum: 2 })),
    baselinePt: Type.Optional(
      Type.Number({ exclusiveMinimum: 0, maximum: 24 })
    ),
  },
  { additionalProperties: false }
);
export const TypographySchema = Type.Object(
  {
    roles: Type.Optional(TypeRolesSchema),
    scale: Type.Optional(
      Type.Object(
        {
          a4: Type.Optional(ScaleSchema),
          letter: Type.Optional(ScaleSchema),
          wide169: Type.Optional(ScaleSchema),
          standard43: Type.Optional(ScaleSchema),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: false }
);
const CanvasSpacingSchema = Type.Object(
  {
    safeAreaIn: Type.Optional(Type.Number({ minimum: 0 })),
    gutterIn: Type.Optional(Type.Number({ minimum: 0 })),
    columns: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    rows: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false }
);
export const DesignSpacingSchema = Type.Object(
  {
    basePt: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    blockGap: Type.Optional(
      Type.Object(
        {
          tight: Type.Optional(Type.Number({ minimum: 0 })),
          normal: Type.Optional(Type.Number({ minimum: 0 })),
          loose: Type.Optional(Type.Number({ minimum: 0 })),
        },
        { additionalProperties: false }
      )
    ),
    canvas: Type.Optional(
      Type.Object(
        {
          a4: Type.Optional(CanvasSpacingSchema),
          letter: Type.Optional(CanvasSpacingSchema),
          wide169: Type.Optional(CanvasSpacingSchema),
          standard43: Type.Optional(CanvasSpacingSchema),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: false }
);
const RecipeSchema = Type.Object(
  {
    type: Type.Optional(TypeRoleNameSchema),
    color: Type.Optional(ColorTokenSchema),
    fill: Type.Optional(ColorTokenSchema),
    rule: Type.Optional(
      Type.Object(
        {
          weightPt: Type.Optional(Type.Number({ minimum: 0 })),
          color: Type.Optional(ColorTokenSchema),
        },
        { additionalProperties: false }
      )
    ),
    padPt: Type.Optional(Type.Number({ minimum: 0 })),
    alignment: Type.Optional(
      Type.Union([
        Type.Literal('left'),
        Type.Literal('center'),
        Type.Literal('right'),
      ])
    ),
  },
  { additionalProperties: false }
);
export const ChromeSchema = Type.Object(
  {
    runningHead: Type.Optional(RecipeSchema),
    tracker: Type.Optional(RecipeSchema),
    actionTitle: Type.Optional(RecipeSchema),
    keyTakeaways: Type.Optional(RecipeSchema),
    sourceLine: Type.Optional(RecipeSchema),
    confidentialFooter: Type.Optional(RecipeSchema),
    logoSlot: Type.Optional(RecipeSchema),
    cover: Type.Optional(RecipeSchema),
  },
  {
    additionalProperties: false,
    description:
      'Visual recipes; consumers land in #361. No automatic content or presence requirements.',
  }
);
export const MotifSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('none'),
      Type.Literal('rule'),
      Type.Literal('corner'),
      Type.Literal('band'),
    ]),
    color: Type.Optional(ColorTokenSchema),
    weightPt: Type.Optional(Type.Number({ minimum: 0 })),
    placement: Type.Optional(
      Type.Union([
        Type.Literal('top'),
        Type.Literal('bottom'),
        Type.Literal('left'),
        Type.Literal('right'),
        Type.Literal('topLeft'),
        Type.Literal('topRight'),
        Type.Literal('bottomLeft'),
        Type.Literal('bottomRight'),
      ])
    ),
  },
  {
    additionalProperties: false,
    description: 'At most one motif. Rendering consumers land in #361.',
  }
);
export const DesignSystemProperties = {
  palette: Type.Optional(PaletteSchema),
  typography: Type.Optional(TypographySchema),
  spacing: Type.Optional(DesignSpacingSchema),
  chrome: Type.Optional(ChromeSchema),
  motif: Type.Optional(MotifSchema),
};
export const DesignSystemSchema = Type.Object(DesignSystemProperties, {
  additionalProperties: false,
});
export type DesignSystem = Static<typeof DesignSystemSchema>;
export type TypeRole = Static<typeof TypeRoleSchema>;

/** Custom paper uses A4; custom slides use the closest supported aspect ratio. */
export function designCanvas(
  format: 'docx' | 'pptx',
  size?: string | { width: number; height: number }
): DesignCanvas {
  if (format === 'docx') return size === 'LETTER' ? 'letter' : 'a4';
  const ratio = typeof size === 'object' ? size.width / size.height : 4 / 3;
  return Math.abs(ratio - 16 / 9) < Math.abs(ratio - 4 / 3)
    ? 'wide169'
    : 'standard43';
}
export const ROLE_SCALE_STEPS: Record<TypeRoleName, number> = {
  display: 4,
  stat: 3,
  quote: 1,
  tableHeader: 0,
  tableCell: 0,
  label: -1,
  eyebrow: -1,
  chartLabel: -1,
  tracker: -1,
  footer: -2,
  source: -2,
};
type Scale = Static<typeof ScaleSchema>;

/**
 * `base × ratio^step`, snapped to the nearest baseline multiple and clamped to
 * the schema's 5-200pt window. A step-0 role keeps `base` exactly: snapping a
 * role that asked for no scaling would silently retune the authored base size.
 */
function scaledSize(scale: Scale, step: number): number {
  if (step === 0) return scale.base;
  const baseline = scale.baselinePt ?? 4;
  const exact = scale.base * (scale.ratio ?? 1.25) ** step;
  return Math.max(5, Math.min(200, Math.round(exact / baseline) * baseline));
}

/** The palette minus its ordered chart array, which no scalar resolver reads. */
function paletteScalars(
  palette?: DesignSystem['palette']
): Record<string, string | undefined> {
  const scalars: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(palette ?? {})) {
    if (typeof value === 'string') scalars[key] = value;
  }
  return scalars;
}

/**
 * Case as DOCX run flags. Word inherits case from the style, so a run that
 * asks for `none` must state the flag it turns off rather than omit it.
 */
export function capsFormatting(textCase: 'none' | 'upper' | 'smallCaps'): {
  allCaps?: boolean;
  smallCaps?: boolean;
} {
  return textCase === 'upper'
    ? { allCaps: true }
    : { smallCaps: textCase === 'smallCaps' };
}

export function resolveTypeRoles(
  system: DesignSystem,
  canvas: DesignCanvas,
  base: number
): Partial<Record<TypeRoleName, TypeRole & { size: number }>> {
  const scale = system.typography?.scale?.[canvas];
  const roles: Partial<Record<TypeRoleName, TypeRole & { size: number }>> = {};
  for (const name of TYPE_ROLES) {
    const role = system.typography?.roles?.[name];
    if (!role) continue;
    roles[name] = {
      ...role,
      size:
        role.size ?? (scale ? scaledSize(scale, ROLE_SCALE_STEPS[name]) : base),
    };
  }
  return roles;
}

/** Exclude ordered chart arrays from the scalar resolver. Palette overrides legacy tokens. */
export function designColors(
  colors: Record<string, string | undefined>,
  palette?: DesignSystem['palette']
): Record<string, string | undefined> {
  return { ...colors, ...paletteScalars(palette) };
}
export function resolveDesignColor(
  value: string,
  colors: Record<string, string | undefined>
): string | undefined {
  const seen = new Set<string>();
  let current: string | undefined = value;
  while (current !== undefined && !seen.has(current)) {
    // Token lookup first, consistent with legacy resolvers.
    if (!current.startsWith('#') && Object.hasOwn(colors, current)) {
      seen.add(current);
      current = colors[current];
    } else {
      return /^#?[0-9a-f]{6}$/i.test(current)
        ? current.replace(/^#/, '')
        : undefined;
    }
  }
  return undefined;
}

/** Reject dangling/cyclic new tokens before they can become invalid OOXML. */
export function validateDesignColors(
  system: DesignSystem,
  colors: Record<string, string | undefined>
): void {
  const resolved = designColors(colors, system.palette);
  const entries = Object.entries(system.palette ?? {}).flatMap(
    ([key, value]) =>
      Array.isArray(value)
        ? value.map((entry, i) => [`palette.${key}[${i}]`, entry])
        : [[`palette.${key}`, value]]
  );
  for (const [name, role] of Object.entries(system.typography?.roles ?? {})) {
    if (role.color)
      entries.push([`typography.roles.${name}.color`, role.color]);
  }
  for (const [path, value] of entries) {
    if (value && !resolveDesignColor(value, resolved)) {
      throw new Error(
        `Unresolvable theme color at ${path}: "${value}" (unknown token or cycle)`
      );
    }
  }
}
