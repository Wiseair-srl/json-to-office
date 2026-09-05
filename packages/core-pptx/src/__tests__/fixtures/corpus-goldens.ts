/**
 * Golden part digests for the PPTX parity corpus.
 *
 * One digest per corpus case, covering every part in the package — its
 * position, its name and its exact uncompressed bytes — and nothing about how
 * the container is compressed. Recorded from the pipeline as it stood before
 * the renderer IR became the default, then carried forward unchanged when the
 * digest replaced the raw-bytes hash it used to be: the packages were
 * byte-identical at that point, so the parity claim is the same one.
 *
 * Not a hash of the file. Deflate belongs to the runtime, so a Node release
 * that changes its bundled zlib changes every byte of every package without
 * changing any deck — see `fixtures/packageDigest.ts` and #264. Byte stability
 * within one runtime is asserted separately, by rendering twice.
 *
 * A change here means the output changed. That is only ever correct with an
 * explanation, recorded in docs/architecture/office-renderer-ir.md.
 */

export const CORPUS_GOLDENS: Readonly<Record<string, string>> = {
  'theme/shared-foundation':
    '7af49a5ffbaf84ea7bed36d868a83cd4c9549dd89eaba2f6e970160883f63c17',
  'text/plain':
    '856c8d0ade8513d243155580bde179eefbbed559428189dd37637ece728cab74',
  'text/styled':
    'e61a8a6f620dfbfbad821c3376729d558247da144b86573ccc7b7eb2e36baef5',
  'text/percent-position':
    '10953cc32259391d61489fbe5b7f664ba87d5c45689e43ab445f2b28a301050d',
  'text/rich-runs':
    '77e6f38baf2e1a6dfdc7f43b9957bf56a5c93353c1018d6760be72d21b925831',
  'text/named-styles':
    '838bb96f837b3450f59cf985e62f65f4fa2af6884aee57dbb2c9f55c97c7e47d',
  'text/page-numbers':
    '6480fc818be29f07886cea7d8b1e296bbb85876e31ba26bfc6b34cd1c3f72b1d',
  'text/font-weight-alias':
    '421b7fe1fa137dfddb797b0ad6971eac2b2940c6de02c8f9e7cbedf39dd0999c',
  'deck/language-rtl':
    'c2ae3a174e1d009185add7bd15bf29fa9d916c6001b99399857b806cb0eaf9e3',
  'deck/widescreen':
    '11a4c5fb223a8e426c4cfd6cf4145428512fe3164eea38282cc332a08e4ca18b',
  'slide/notes-hidden':
    'edf43bff3c6f9faedc46fefa00293f67b7b35407d3e5305827300694c7306311',
  'slide/solid-background':
    '29890cc261afacdee7acae0803e84484d09d91b975bc465cd10a42ae8630881e',
  'slide/gradient-background':
    '4cbf897139f155024f7d08d97c73ca160ec06cf7b9ede290b7c004b10daea544',
  'shape/fills-and-lines':
    '83280db35f2f44148e0eb31e9f5fb87a9b0f7dd0b0bcca17a7e05bd583d4d283',
  'shape/with-text':
    '28e832bcfe7e5044dca85cae21927c2174666cc45669b4949b2aa86f62471926',
  'shape/text-segments':
    'dc08d615da491348bb77e203d0ae1064b08235fc9362e5300b2fce022a27bf53',
  'shape/gradient-linear':
    '28eb6e892a147d1fcee471ab79f7b492a4f42c8db96e1282769d4da90cea7cfb',
  'shape/gradient-radial':
    'c19ad937fb03fe1c9cdff519331300a0b55c59325e0964a483ea8c4ce2dd257c',
  'shape/pattern':
    '5784200bad2b3977c952d6ae387b9da2817d7241aea1ac7cf59edc1a1ffc080c',
  'shape/shadow':
    'ea5a80ba7f666f0dd0328eef162681c386a9a0d143caf3810da4e583afc15be8',
  'image/base64':
    'bc1324144a2ad5b1a621ff90f7fbf60f2a8f5d28498b0e7196c9a2398cffbaa2',
  'image/deduplicated':
    '8e411ac82ea3ce5a79b8ae9c6e8d3a6b6f12d9ce50d427f8a9f409795bfb9b07',
  'image/aspect-from-width':
    '39104e9961e6b4c240f71c447d00379b8609a72bbabefa612dccced89b77921e',
  'image/aspect-from-height':
    '39104e9961e6b4c240f71c447d00379b8609a72bbabefa612dccced89b77921e',
  'image/contain':
    '5f3f439fbe890ee10856a6a4db10e266081f2be0101d2ce2a59bafc1f071ed9b',
  'image/cover':
    'e3f4773956e58b8a61b8684920fc4b3231ee9769ebd7117c7109f79316124f77',
  'image/rounding-rotate':
    'e7d0e04790c7931d6aa1a44f64ae881a9ac6e4a204ba87b5d3e86b4c1b0988eb',
  'link/external-and-slide':
    'b670b17d96e9ca97211de83894624aec304bc450886874259f5b7b5b0d586262',
  'layout/grid':
    'a0f1131c5fe3048c3c0789eb304ea8a4ad03882a0950dc02c5c00a6e76e6ecf3',
  'template/background-and-objects':
    '77081e5b9646da95237159f1d8286439e5fea53c4a5fbf36bacabde284e8f06d',
  'template/placeholders':
    '5b0402b552e02ea0e6a982694ae074a7d80bb28e8f586136b18881c1f3df45dc',
  'table/plain':
    '4c05995aa71dd873f13b45ec39834e2b19da4b2891e66de6deb85af69cc0ade5',
  'table/formatting':
    '26b239e1f349fe5f217538e1054a6dfc120a04fbaac15ee50b6eb3fc0fb57825',
  'table/merged-cells':
    'f69f9c7228ba8bcb0ed20b76c46ffc225079e7bda7d95ec94bd2d6781d693dfb',
  'table/rounded':
    'a2ef51c34aa2c0d519a2c67df78a4614e8ac7cafd9a39e8ac0be283c9f5a6fd5',
  'table/emoji-text-presentation':
    '90a827a4b71a1390a01d4ea19730d6b24b5718a4e7b7a5b8b8e61da6164f88be',
  'chart/bar':
    'd9401548df8e8006c8ea49345087273c734ca95be7038dd22bf4304e43938605',
  'chart/configured':
    'ffe76d4a98bef73f498c480b1911db04c4b0aef64431686d5a34220f36d3f5c8',
  'chart/two-on-one-slide':
    '0527b713fa1d7dfd1e831373c6582b23996dfdd56e1542791e10a0032b844487',
  'text/single-run':
    'c8fab6b0e567d172d836f3189c5f79e8b4b1798f3636ef187177696c2587d261',
  'text/bullets':
    'ce23bedfe7f8474c23f540bd89915c665dbcf77d26f8de51ec8ab94819124863',
  'shape/no-text':
    '3ee1b87e9564fd0c037d1c69de71261f3381e3f65b9838e50c42df6731c7ba75',
  'table/auto-page':
    '3eac814b5d22bf4d67bc3c04115276d79b65334cba7138158209245b70fa8ef3',
  'table/no-size':
    'd57f347fb2fcf25536068385003cc5554f58273202e85492a5abc3da576d1611',
  'chart/line':
    '99d97b95d755bdfd1cee78ad175760f7607a79d3e2cd5c7859aa41d9549b6021',
  'chart/doughnut':
    'bc9ba1a5b5cded919e3548beefd2d97f84610184e4236d8fb367bed68440190c',
  'image/url-free-aspect':
    '407196d4d120fd4af8cd8f993a1c7d05f0e69f51038663d3adcdbd045d4a762c',
  'slide/disabled-content':
    '50c4cf5537a17f32a494132266d8745d318e56f7b6c83ee09fe418a9da563d4b',
  'template/object-page-number':
    'fa38b86e14fd8bbc3dea301fa3dd19607680715986e092f0f84efa40f8a94d67',
  'template/object-language':
    '154130fdb6be35d89c9e6b180e7249ff6ccc65c5c0cb6a0fe0b4ef0e89deac9d',
  'template/margin':
    'f91fd6c8e7af6b840c0b68cfbfece552944e2a66c0afa7dd979a1c5d131b8c70',
  'text/runs-inherit-underline':
    '508cce02c1cddbd4f550cdcbb953313d1802275339ac4d232a0542bac760a868',
  'text/runs-inherit-strike':
    'e23c7946cb3837ab82f3761ad6cf7bcd25077c36c6f41b67092fb3efe313c229',
  'text/runs-override-inherited-underline':
    'a36aed59d373949edb1a48bb7e24b6c703356971074039d4c74362237ee8c99f',
  'text/body-hyperlink-over-runs':
    'a402c6ebfa652bdfe1f18112c2e3956b5f93e4f143684de2cb52b3741c1aa6c4',
  'text/underline-false':
    '622feb8dd5536ec1e7894952b8d176f265fa0aeff1c7c295db816c26833a4a1b',
  'text/bullet-object-form':
    '37ec2827a0b2ae93362a6906686760b86afb9b3cf3f2c4ced9f29dfb0d6fdba0',
  'shape/empty-line-object':
    '8463e0114420c9f6548e224832af16cf3c38309e908c338cab91a112ca859810',
  'image/contain-without-box':
    'c275d4516875b317da911b9657c8c180022e21400bd76028c6beedae7d41520d',
  'table/rounded-single-column-width':
    '6e2353b24f3842772bea5f20c34010baa176e6ad01a15a0c1e551a27977b3328',
  'table/rounded-percent-position':
    '05d990244d0fa4ccf09d8553382ddb07368cc46d520474067c37ab66061883e6',
  'link/on-image':
    '97be9df07e1d92acb37adcc6016d346eb8acc3d91cf56df939b2794e637980ae',
  'image/rotated':
    '88418882c26bde4677b2165aa210339b7aa55ae46c73b5a3c273ba5aee820728',
  'shape/arc-family':
    'eb8fb9a1489274ea56b7c38cfb898471a8ae18cc6b6fb27b21c9a85e54ea8c58',
  'shape/geometry-aliases':
    '35c5e3473fcdc3ac9c4ebd191641d7b8657bb7cf71c8020a96a6b5f864710765',
};
