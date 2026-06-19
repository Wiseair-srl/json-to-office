import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '../createComponent';
import type { ComponentDefinition } from '@json-to-office/shared-docx';

/**
 * Eldermoor Census — example custom component.
 *
 * Wraps the fixed "Regno di Eldermoor" isometric infographic and exposes its
 * textual data (title + 13 stat values) as high-level props. The decorative
 * backdrop (panels, icons, roman numerals) is a fixed template; render()
 * substitutes the data, then emits a standard `image` node that uses the new
 * inline `svg` source — so the user never touches raw SVG.
 */
const EldermoorCensusPropsSchema = Type.Object(
  {
    title: Type.Optional(
      Type.String({
        default: 'Regno di Eldermoor — Censimento della Corona',
        description: 'Headline at the top of the infographic',
      })
    ),
    manaPct: Type.Optional(
      Type.String({ default: '42,6%', description: 'Channelled mana share' })
    ),
    faithfulSubjects: Type.Optional(
      Type.String({
        default: '16,7 milioni',
        description: 'Faithful mortal subjects',
      })
    ),
    swornGuilds: Type.Optional(
      Type.String({
        default: '0,9 milioni',
        description: 'Sworn guild members',
      })
    ),
    mappedTerritoriesPct: Type.Optional(
      Type.String({
        default: '16,1%',
        description: 'Mapped territories watched by the Silver Guard',
      })
    ),
    castles: Type.Optional(
      Type.String({ default: '2.035', description: 'Castles' })
    ),
    outposts: Type.Optional(
      Type.String({ default: '4.910', description: 'Outposts' })
    ),
    watchtowers: Type.Optional(
      Type.String({ default: '3.001', description: 'Watchtowers' })
    ),
    sovereignTreasury: Type.Optional(
      Type.String({
        default: "17,4 mld d'oro",
        description: 'Sovereign treasury',
      })
    ),
    warChest: Type.Optional(
      Type.String({ default: '9,6 mld  +4,5%', description: 'War chest' })
    ),
    marketMint: Type.Optional(
      Type.String({ default: '7,8 mld  +20,6%', description: 'Market mint' })
    ),
    royalServants: Type.Optional(
      Type.String({ default: '13.187', description: 'Royal servants total' })
    ),
    servantsLeft: Type.Optional(
      Type.String({ default: '7.392', description: 'Royal servants split A' })
    ),
    servantsRight: Type.Optional(
      Type.String({ default: '5.795', description: 'Royal servants split B' })
    ),
    width: Type.Optional(
      Type.Union([Type.Number({ minimum: 1 }), Type.String()], {
        default: '100%',
        description: 'Rendered image width (px number or percentage string)',
      })
    ),
    alignment: Type.Optional(
      Type.Union(
        [Type.Literal('left'), Type.Literal('center'), Type.Literal('right')],
        { default: 'center' }
      )
    ),
    caption: Type.Optional(
      Type.String({ description: 'Optional caption below the graphic' })
    ),
  },
  { additionalProperties: false }
);

const D = {
  title: 'Regno di Eldermoor — Censimento della Corona',
  manaPct: '42,6%',
  faithfulSubjects: '16,7 milioni',
  swornGuilds: '0,9 milioni',
  mappedTerritoriesPct: '16,1%',
  castles: '2.035',
  outposts: '4.910',
  watchtowers: '3.001',
  sovereignTreasury: "17,4 mld d'oro",
  warChest: '9,6 mld  +4,5%',
  marketMint: '7,8 mld  +20,6%',
  royalServants: '13.187',
  servantsLeft: '7.392',
  servantsRight: '5.795',
};

/** Escape text-node content for safe embedding in SVG/XML. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the infographic SVG. Geometry (background, isometric panels, icons,
 * roman numerals) is fixed; every `<text>` carrying a data value is bound to a
 * prop so callers control the content, not the layout.
 */
function buildSvg(p: Record<string, string>): string {
  const v = (k: keyof typeof D) => esc(p[k] ?? D[k]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="44 110 454 645" font-family="Helvetica, Arial, sans-serif">
 <rect id="background" x="44" y="110" width="454" height="645" fill="#ffffff"/>
 <g id="panels">
  <polygon points="378.29,297.58 377.81,636.67 494.79,704.21 494.79,591.41 378.05,523.4 476.1,466.17 476.1,353.14" fill="#e2974f"/>
  <polygon points="377.09,410.61 279.76,466.89 279.76,579.92 378.05,636.43" fill="#cf7a36"/>
  <polygon points="83.42,354.1 82.23,465.69 181.47,523.88 181.47,636.67 279.28,580.16 181.23,523.64 180.75,409.89" fill="#fbe8d0"/>
  <polygon points="376.85,185.03 280.0,241.06 280.0,352.42 377.81,409.41" fill="#f1c894"/>
  <polygon points="181.47,410.13 181.47,523.16 280.72,580.88 280.72,692.47 280.72,581.83 284.55,583.03 279.28,579.68 280.24,466.17" fill="#ecb277"/>
  <polygon points="70.24,330.87 70.24,459.46 82.71,466.65 82.71,579.68 180.99,524.12 181.95,637.15 186.99,633.8 181.23,636.67 181.23,523.88 70.24,458.99" fill="#fdf6ec"/>
  <polygon points="476.34,466.89 379.01,523.4 475.62,579.68" fill="#f7dbb8"/>
  <polygon points="378.29,637.39 378.53,749.47 475.14,694.15" fill="#f7dbb8"/>
  <polygon points="279.52,352.42 280.24,465.93 377.57,409.65" fill="#fbe8d0"/>
  <polygon points="376.13,636.91 321.71,604.82 317.64,604.82 316.68,601.95 309.73,597.88 308.05,599.08 308.53,597.4 288.87,587.34 284.79,583.27 281.2,583.75 281.2,691.75 292.23,686.01 290.79,685.29 292.71,683.13 293.18,685.29 319.55,670.44 319.55,668.52 320.27,669.72 332.74,662.78 334.9,659.42 337.77,659.66 336.82,658.23 340.41,658.23" fill="#f1c894"/>
  <polygon points="70.72,331.59 71.2,458.99 82.71,465.21 83.18,353.14 181.47,409.65 180.99,395.76" fill="#ecb277"/>
  <polygon points="246.2,539.93 246.2,549.27 251.23,549.27 250.99,541.36 251.95,540.89 252.67,541.6 252.91,549.27 254.83,549.03 254.83,541.36 255.55,540.89 256.51,541.6 256.51,549.03 258.66,549.27 258.18,541.84 259.86,540.89 260.1,549.03 262.26,549.27 262.02,541.36 263.7,541.12 263.94,549.03 268.73,549.27 268.73,539.93" fill="#ecb277"/>
  <polygon points="444.69,356.97 444.69,358.89 444.21,359.36 444.69,360.56 444.21,361.04 445.17,361.04 445.89,361.76 448.05,360.08 449.97,360.56 450.92,361.76 452.12,364.87 452.36,364.63 452.84,365.11 452.6,365.83 453.32,366.31 453.08,366.55 457.4,368.94 459.55,371.34 461.47,372.3 463.39,375.89 462.91,377.09 464.11,375.65 463.15,374.21 463.39,372.54 464.59,371.58 465.79,371.82 462.91,370.62 461.47,369.18 461.95,368.94 461.23,368.94 461.47,369.18 460.99,369.42 457.88,366.79 457.16,364.63 456.44,364.63 456.92,364.15 454.76,363.2 453.56,361.52 454.28,359.6 453.8,358.65 454.04,357.93 457.16,356.73 457.64,356.97 457.4,356.73 457.88,356.25 456.68,355.53 454.52,355.29 453.56,354.34 452.84,355.05 450.92,355.29 451.16,355.53 449.49,356.49 449.01,356.01 449.25,356.49 448.29,357.21 447.33,357.21 446.61,356.25" fill="#e2974f"/>
  <polygon points="279.52,352.9 279.52,465.45 274.01,463.06 279.28,466.17 280.48,465.45" fill="#fdf6ec"/>
  <polygon points="351.68,211.61 351.68,213.29 350.96,213.76 351.44,214.24 350.96,214.48 351.44,219.03 351.68,218.55 351.68,219.51 352.16,219.51 351.92,219.99 353.12,221.19 352.88,221.43 353.36,221.19 354.79,223.1 354.79,222.63 355.27,223.34 355.75,222.86 355.99,223.82 361.75,224.3 362.95,223.34 364.38,223.1 366.06,221.67 366.3,220.47 366.54,221.19 366.54,220.47 367.5,219.75 368.46,216.64 368.22,213.29 367.5,213.53 367.26,214.48 366.78,214.24 366.06,214.96 365.58,216.4 366.54,217.12 365.82,217.36 365.58,218.31 363.42,219.03 363.42,221.43 362.71,221.67 363.18,222.39 362.71,222.86 362.47,222.15 362.23,222.86 361.27,223.1 361.99,223.34 361.27,224.06 360.79,223.58 360.55,224.06 358.87,224.06 357.67,222.63 357.19,219.99 357.67,219.03 356.95,219.03 356.71,217.84 355.75,218.31 355.51,217.6 353.84,217.84 353.12,216.88 352.16,217.12 352.88,216.4 352.16,213.53 352.64,213.53 352.88,214.48 352.64,213.29 353.12,213.29 352.88,212.81 353.84,212.09 354.08,210.89 353.12,210.65 352.88,209.93" fill="#f1c894"/>
  <polygon points="279.76,241.3 279.76,352.42 284.79,355.77 279.76,352.42" fill="#f7dbb8"/>
  <polygon points="251.71,535.38 251.71,535.86 262.74,535.86 262.98,536.1 263.22,536.1 262.74,535.62 262.74,535.38 262.98,535.14 263.22,535.38 263.22,534.9 262.98,534.66 262.5,533.46 261.78,532.74 261.78,532.5 261.54,532.5 261.3,532.26 261.3,532.02 261.06,532.26 260.82,532.02 260.82,531.79 260.58,532.02 260.1,531.31 259.38,531.31 259.14,531.07 258.42,531.07 258.18,531.31 257.95,531.07 257.95,530.83 257.47,530.83 257.23,531.07 256.75,531.07 256.51,531.31 255.79,531.07 255.55,531.31 255.07,531.31 254.35,532.02 253.87,532.02 253.87,532.26 252.91,532.98 253.15,533.22 252.91,533.46 252.67,533.46 252.67,533.7 252.19,534.18 252.43,534.42 252.19,534.66 251.95,534.66 252.19,535.38 251.95,535.62" fill="#ecb277"/>
  <polygon points="355.99,212.33 355.99,213.05 355.75,213.29 355.03,213.29 354.79,213.05 355.03,213.29 354.55,214.24 354.32,214.0 354.55,214.24 354.08,214.96 355.27,216.16 355.03,216.4 355.51,216.4 355.75,215.92 355.99,216.16 356.95,216.16 357.43,216.64 357.67,216.64 357.91,216.16 358.87,216.16 359.11,216.4 358.87,216.64 358.15,216.64 358.63,216.64 359.11,217.12 358.87,217.36 358.39,217.12 358.63,217.36 358.39,217.6 359.11,218.08 358.87,218.31 359.35,219.03 359.11,221.19 359.35,221.43 359.35,222.15 359.83,222.63 360.31,221.91 359.59,221.19 360.07,220.95 360.79,221.67 360.79,220.95 361.03,220.71 361.27,221.19 361.75,220.71 361.51,219.99 361.75,219.27 361.51,218.31 361.99,218.08 362.23,218.31 361.99,218.55 362.23,218.55 362.47,217.6 363.18,217.36 362.95,216.64 361.75,215.68 361.99,215.44 361.51,214.72 361.99,213.76 361.51,213.53 361.75,212.81 361.51,212.57 360.79,212.57 360.55,212.81 360.31,212.57 360.07,212.81 360.31,213.05 359.83,213.29 360.07,213.53 359.59,214.48 359.35,214.24 359.35,213.29 359.35,213.76 359.11,214.0 358.63,213.53 358.39,213.76 358.63,213.76 358.87,214.24 358.15,214.48 357.91,214.0 357.43,213.76 357.67,213.53 357.19,213.29 357.43,213.05 357.19,212.81 356.95,213.05" fill="#f1c894"/>
  <polygon points="426.95,602.19 426.95,604.82 427.19,605.06 426.95,605.3 426.95,605.78 427.19,606.02 428.63,605.54 428.87,605.3 428.63,605.06 428.87,604.82 429.59,605.06 431.27,604.11 431.75,604.11 432.23,603.63 432.71,603.63 433.42,602.91 433.66,603.15 434.14,602.67 434.62,602.67 435.1,603.15 435.1,603.39 435.58,604.11 435.58,604.58 435.58,603.87 435.1,603.39 435.34,603.15 435.34,602.19 435.1,601.95 434.86,601.23 434.62,600.99 434.38,600.99 434.14,600.75 434.14,600.51 433.9,600.75 433.66,600.51 433.66,600.27 432.95,599.8 432.71,600.03 431.99,599.56 431.75,599.8 431.51,599.8 431.27,599.56 430.79,599.56 430.55,599.8 430.31,599.56 429.59,600.03 429.35,599.8 428.87,600.27 428.15,600.51 427.67,600.99 427.67,601.71" fill="#e2974f"/>
 </g>
 <g id="labels">
  <text x="45.79" y="134.08" font-size="16.6" font-weight="700" fill="#6b1e0c">${v('title')}</text>
  <text x="293.16" y="258.4" font-size="11.1" font-weight="400" fill="#b07a4e">Mana</text>
  <text x="293.16" y="271.36" font-size="11.1" font-weight="700" fill="#8f3d18">incanalato</text>
  <text x="293.16" y="284.32" font-size="11.1" font-weight="700" fill="#8f3d18">verso boschi</text>
  <text x="293.16" y="297.4" font-size="11.1" font-weight="700" fill="#8f3d18">e fiumi</text>
  <text x="293.16" y="310.36" font-size="11.1" font-weight="700" fill="#8f3d18">del reame</text>
  <text x="293.16" y="325.32" font-size="10.1" font-weight="700" fill="#8f3d18">${v('manaPct')}</text>
  <text x="293.16" y="340.08" font-size="10.1" font-weight="400" fill="#b07a4e">delle riserve</text>
  <text x="293.16" y="351.72" font-size="10.1" font-weight="400" fill="#b07a4e">arcane</text>
  <text x="97.32" y="397.48" font-size="11.1" font-weight="700" fill="#8f3d18">Sudditi</text>
  <text x="389.64" y="399.76" font-size="11.1" font-weight="700" fill="#8f3d18">%</text>
  <text x="99.31" y="410.56" font-size="11.1" font-weight="700" fill="#8f3d18">Fedeli</text>
  <text x="389.64" y="412.72" font-size="11.1" font-weight="700" fill="#8f3d18">delle Terre</text>
  <text x="389.64" y="425.68" font-size="11.1" font-weight="700" fill="#8f3d18">cartografate</text>
  <text x="97.32" y="428.0" font-size="9.0" font-weight="400" fill="#b07a4e">Popolo mortale</text>
  <text x="389.64" y="437.76" font-size="10.1" font-weight="400" fill="#b07a4e">vegliate dai</text>
  <text x="97.32" y="438.32" font-size="9.0" font-weight="700" fill="#8f3d18">${v('faithfulSubjects')}</text>
  <text x="389.64" y="449.4" font-size="10.1" font-weight="400" fill="#b07a4e">Custodi della</text>
  <text x="97.32" y="448.76" font-size="9.0" font-weight="400" fill="#b07a4e">Gilde giurate</text>
  <text x="190.68" y="460.6" font-size="11.1" font-weight="700" fill="#8f3d18">Roccaforti</text>
  <text x="97.32" y="459.2" font-size="9.0" font-weight="700" fill="#8f3d18">${v('swornGuilds')}</text>
  <text x="389.64" y="462.16" font-size="11.1" font-weight="700" fill="#8f3d18">Guardia d'Argento</text>
  <text x="190.68" y="473.56" font-size="11.1" font-weight="700" fill="#8f3d18">della Corona</text>
  <text x="295.44" y="477.16" font-size="11.1" font-weight="400" fill="#b07a4e">Tesoreria</text>
  <text x="389.64" y="477.12" font-size="10.1" font-weight="400" fill="#b07a4e">${v('mappedTerritoriesPct')}</text>
  <text x="295.44" y="490.12" font-size="11.1" font-weight="700" fill="#8f3d18">del Reame</text>
  <text x="190.68" y="491.0" font-size="9.0" font-weight="400" fill="#b07a4e">Castelli</text>
  <text x="250.08" y="491.0" font-size="9.0" font-weight="700" fill="#8f3d18">${v('castles')}</text>
  <text x="295.44" y="503.08" font-size="11.1" font-weight="700" fill="#8f3d18">sovrana</text>
  <text x="190.68" y="501.44" font-size="9.0" font-weight="400" fill="#b07a4e">Avamposti</text>
  <text x="249.72" y="501.44" font-size="9.0" font-weight="700" fill="#8f3d18">${v('outposts')}</text>
  <text x="190.68" y="511.04" font-size="9.0" font-weight="400" fill="#b07a4e">Torri di</text>
  <text x="190.68" y="520.04" font-size="9.0" font-weight="400" fill="#b07a4e">guardia</text>
  <text x="249.96" y="520.04" font-size="9.0" font-weight="700" fill="#8f3d18">${v('watchtowers')}</text>
  <text x="295.44" y="521.64" font-size="10.1" font-weight="700" fill="#8f3d18">${v('sovereignTreasury')}</text>
  <text x="295.44" y="538.76" font-size="9.0" font-weight="400" fill="#b07a4e">Forziere di guerra</text>
  <text x="295.44" y="549.2" font-size="9.0" font-weight="700" fill="#8f3d18">${v('warChest')}</text>
  <text x="295.44" y="569.96" font-size="9.0" font-weight="400" fill="#b07a4e">Conio dei mercati</text>
  <text x="396.0" y="579.64" font-size="11.1" font-weight="700" fill="#8f3d18">Servitori reali</text>
  <text x="295.44" y="580.4" font-size="9.0" font-weight="700" fill="#8f3d18">${v('marketMint')}</text>
  <text x="396.0" y="591.6" font-size="10.1" font-weight="400" fill="#b07a4e">${v('royalServants')}</text>
  <text x="396.0" y="641.04" font-size="10.1" font-weight="700" fill="#8f3d18">${v('servantsLeft')}</text>
  <text x="427.2" y="641.04" font-size="10.1" font-weight="700" fill="#8f3d18">${v('servantsRight')}</text>
 </g>
 <g id="icons" fill="none" stroke="#46160a" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">
  <g id="icon-crown" transform="translate(158.5,481.2) scale(1.25) translate(-12,-12)"><path d="M4 18 L6 9 L9.5 13 L12 6.5 L14.5 13 L18 9 L20 18 Z M4 18 H20"/></g>
  <g id="icon-castle" transform="translate(257.6,537.4) scale(1.292) translate(-12,-12)"><path d="M4 21 V11 H6.5 V13 H9.5 V11 H12 V13 H14.5 V11 H17.5 V13 H20 V21 Z M10 21 V16.5 A2 2 0 0 1 14 16.5 V21"/></g>
  <g id="icon-coins" transform="translate(356.1,448.5) scale(1.25) translate(-12,-12)"><path d="M5 8 A7 2.6 0 1 0 19 8 A7 2.6 0 1 0 5 8 M5 8 V13 A7 2.6 0 0 0 19 13 V8 M5 10.6 A7 2.6 0 0 0 19 10.6"/></g>
  <g id="icon-leaf" transform="translate(358.0,222.4) scale(1.5) translate(-12,-12)"><path d="M12 3 C7 8 5.5 14.5 12 21 C18.5 14.5 17 8 12 3 Z M12 5 V20"/></g>
  <g id="icon-compass" transform="translate(455.5,368.0) scale(1.375) translate(-12,-12)"><path d="M12 3 A9 9 0 1 0 12.01 3 M12 6.5 L14 12 L12 17.5 L10 12 Z"/></g>
  <g id="icon-swords" transform="translate(417.0,609.6) scale(1.75) translate(-12,-12)"><path d="M4.5 20.5 L15.5 8.5 M13.5 6.5 L17.5 10.5 M3.5 21.5 L6 19 M19.5 20.5 L8.5 8.5 M6.5 6.5 L10.5 10.5 M20.5 21.5 L18 19"/></g>
 </g>
 <g id="numbers" fill="#46160a" font-weight="400" text-anchor="middle">
  <text x="115.1" y="531" font-size="22">I</text>
  <text x="214.5" y="589" font-size="22">II</text>
  <text x="312.9" y="645" font-size="22">III</text>
  <text x="313.0" y="415" font-size="22">IV</text>
  <text x="437.3" y="532" font-size="22">V</text>
  <text x="413.8" y="701" font-size="22">VI</text>
 </g>
</svg>`;
}

/**
 * @example
 * ```json
 * {
 *   "name": "eldermoor-census",
 *   "props": { "title": "Regno di Valebrook", "manaPct": "51,2%", "castles": "3.120" }
 * }
 * ```
 */
export const eldermoorCensusComponent = createComponent({
  name: 'eldermoor-census',
  versions: {
    '1.0.0': createVersion({
      propsSchema: EldermoorCensusPropsSchema,
      description:
        'Renders the Eldermoor census infographic from data props (internally an inline-SVG image)',
      render: async ({ props }) => {
        const svg = buildSvg(props as Record<string, string>);
        const components: ComponentDefinition[] = [
          {
            name: 'image',
            props: {
              svg,
              width: (props.width as number | string | undefined) ?? '100%',
              alignment: (props.alignment as any) ?? 'center',
              ...(props.caption ? { caption: props.caption as string } : {}),
            },
          },
        ];
        return components;
      },
    }),
  },
});
