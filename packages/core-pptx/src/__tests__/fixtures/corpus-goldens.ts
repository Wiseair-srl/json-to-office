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
  'block/background-and-body':
    '5784841a2d936ce932421cdde26a79c3e28a4d1c52388c2dc32e21497b040eac',
  'block/slots-and-component-props':
    '534de69ea8a489a841e89e9074ed57b9ff5b335a0d595edab045fb3cf08a8bac',
  'block/row-distribution':
    'ff0db0a08a4f474f708b7b00a0d2e6fe8b2a20f6810cfff4a3f1c341adb38730',
  'block/body-page-number':
    '808da7b0fd2311fb1b8bd8b7c60e200fdf1979ddc360f17c88fc9f436ab1b038',
  'block/body-language':
    'f0a22dedf879ad51e39e920d0f6c167c70034a44eb0cda11030edf332a7be76d',
  'theme/shared-foundation':
    '78063ca9074d91fe4c03ceec27d11e98e59c748d11bb810bb4c4361cb1322c2f',
  'text/plain':
    '0e7c430732abcecd5101e1b6d6b36cbd8594d44b7be688b73546c6015ce81061',
  'text/styled':
    '7d84b50c79c9d4e7f696cdd5f2cbe21f072efea0ea978045518745ce6ef7208c',
  'text/percent-position':
    '52eb57595aceb3c06370524f2a333c0dbc87636bdf91edc0fbca5eaf0e7171b2',
  'text/rich-runs':
    'a1edaf5a63a46e874a13270fe5dfcd31f3a9d52b91b2f71da8c08ea13c2f747b',
  'text/named-styles':
    'f0b46871b4f122dccac51b039dbfa08e8fca960c94469d89656a095bfa6614f5',
  'text/page-numbers':
    '253467316db9f1ee3bcdaf2999537709b7a23596599c03a4e25f4ec86e36e0c2',
  'text/font-weight-alias':
    'd76621b65530ac550b0192b8e59f60ade88121b474e0f07f2b8f063bf9951ad2',
  'deck/language-rtl':
    '019ef1000064d32fb25022bbb1087133e6d55bb107a90528489405e9e022c3b8',
  'deck/widescreen':
    '77cf86482ef9282e49c04e27912a0383f18ffe821a76f4031ee20cb29a140684',
  'slide/notes-hidden':
    '25d1c263d51bb1a020998050a3df64227742f2086fe41a005b4c0cabd17d3b1e',
  'slide/solid-background':
    '6875cdef15002dc4f6bc2437658e84f3cccd475398fc76485253ecfd78463050',
  'slide/gradient-background':
    '0f2ae814fefef0a8517a3060b10a58cf3c2790d3489e7a3a872b15ad920db0fd',
  'shape/fills-and-lines':
    'a9163ffb4c64e6d1c1c222c49a6f4f4d58988decd8c3c5463677d454a8c050c5',
  'shape/with-text':
    '2ea89fd329213e7a5d5a7f447b81a19f0dc2e6cbc4f4923fd1da5274aa23a2e8',
  'shape/text-segments':
    'a9ddd6c69a4c4d7b43930f204e73c51c35de177d26dc5d664097495f2c4292b7',
  'shape/gradient-linear':
    '6e96a09eb83694c67dec11588c6e86912a3759bfa06db62eed2b0d4afb08e01d',
  'shape/gradient-radial':
    '91ffbb814c47e185b40ee76646066f19c11d90233a2dc5a5d7ac3723f36b30d7',
  'shape/pattern':
    '17a5ecf68d5795875d228c8785d0eef1968e12b366b55b7f5be42fdc5dbb2bdb',
  'shape/shadow':
    'b025382ac8cb6e711881f8b8690ad02fa02e4222cf114b3d43c578f4466bd54a',
  'image/base64':
    '02309f31e1922b2a29a8d857f7f83f2e9f06806c8bb56035e25a8217d0302cb6',
  'image/deduplicated':
    '4876bffeadceb1f7791ae6eae9d630d5cbebfa612cb12452f2e57796c57fd6dd',
  'image/aspect-from-width':
    '07ff68b758549e9fc4dd6796505978ac1e0ec49b7c529b8ddcaa530634da7b92',
  'image/aspect-from-height':
    '07ff68b758549e9fc4dd6796505978ac1e0ec49b7c529b8ddcaa530634da7b92',
  'image/contain':
    '5cd7d3658049cd706a0b9eef1a86a26d3250dcf660f9d4068320dc26c8506411',
  'image/cover':
    '44c6c66cb83e77b18c0a447e850d2b404b20cf66b3b5230c69b2f1b3f6786554',
  'image/rounding-rotate':
    '8490f5b4784dc614f07e7eab1433888534c5df7f389d43c667979b62ee690ff2',
  'link/external-and-slide':
    'b78e92af4dc5f023c08f43370d9331729923a8a887abdc1d1d1fff873410d420',
  'layout/grid':
    '9ee5236c6da38ac0691e95ead3e92722ca57ba066c727acdf0aef59375306a15',
  'table/plain':
    '3a23488030bc1d9f816c8533b0782620076ccecca6f0112df4892064d5ad6f65',
  'table/formatting':
    'fbe4d769ce3ac3045f540db98c2481c42bc1dd3cae919b89119816a3a09b50bc',
  'table/merged-cells':
    '0566e7bc9fcf4baac6d8edfdfb209a33fe18b5de388d97a6206a57e6eb5ce80b',
  'table/rounded':
    '4e88f28a0f53d565df4f5f2cc4436ed01a010f2d020eeb52aa69a26982a14641',
  'table/emoji-text-presentation':
    '3e5e36cf535ea138651fab955f7cd94badf22d69e4a67b8156c113880417155a',
  'chart/bar':
    'dc53f5d1b5e2821ef6782ae9ab35fc31f159d09e3a8c23574e180775e626e224',
  'chart/configured':
    '0618eacb01547f973766367029788edb6d4cc5ad7ddc6a19164a4f5c4cc02a11',
  'chart/two-on-one-slide':
    '961f179d146aaaff63f27629bce466c1a0f426eac071dbee311fe8a885ab7980',
  'text/single-run':
    'eaa8f7694fbc09f970d604966a03c98421576c8c160f969ff0f1cce30c23921b',
  'text/bullets':
    '9d45d3eae765f5047ff5714bdbbf0801cd782a45f81cc949b188a93ce3806ea5',
  'shape/no-text':
    '2cfd139ac9d666f825e1e4a9eff42fb4352e6f14dade6dcaed0a274ba0f0f4a0',
  'table/auto-page':
    'd58df693ad51f5c2d433059dc5906d77e1049a41b6e153927e85210c1e799815',
  'table/no-size':
    'c969c2c0a46de8c651041018d3c79d7dc68c14d1f424947c20cf3a0c201f096a',
  'chart/line':
    '73f3d6828039baa4ac2e5e4c6a6cf9bf41d0e7ad82078027720e3817600bd40b',
  'chart/doughnut':
    '6dd1e1214544acd4a956ebe6268d0172c03a8327afa4be3e4b5f1395f270a7bf',
  'image/url-free-aspect':
    'fa6932206bf6715f13bd30aabafa3df4d3d5e9d4ce140cacd19fa7ae88b8a230',
  'slide/disabled-content':
    'e3822575b88bf39b668d87177001f0a45120e519f852c719d0f4e2a16b3706a9',
  'text/runs-inherit-underline':
    '8d132f2fdf4b682334cba67793a22e1d68d3fd230ebeea1c29552b9f093d87e8',
  'text/runs-inherit-strike':
    '0ad8606310ef03ddda3bf1674dff8114992e6424314477f22b8521bb189faf73',
  'text/runs-override-inherited-underline':
    '5a5beca78cb5f6ae765da73c46e60c59043a5f99d3cda5133b35c576d0480c5a',
  'text/body-hyperlink-over-runs':
    '3f420f0be0d26a696336fac0b426b72505895eb6fca8142454c07e49d27d2447',
  'text/underline-false':
    'c93338d83609d6264006b36470e477d367bcd550f2a53c2e2b0fe7cc3114c500',
  'text/bullet-object-form':
    '54cb5835287652c2c38ff591e205bf3344c532e4addaff64bcd748b80f92f88b',
  'shape/empty-line-object':
    '1b0ab5534451c85fcbae56e95d107890b0916b532192c288e42ed35bc5145ed2',
  'image/contain-without-box':
    '543637992d04ea16f28c538103a0376c322859b512110ceeadc697bc76ac3c00',
  'table/rounded-single-column-width':
    '2c7f34eb5d7418575ac2fb6b6aac557f32a9eda329796a4b5bba1e84f7734eea',
  'table/rounded-percent-position':
    '1b6f03fa3fc361ebdee2df5b790ae02b2033a42ace8aba78bbec4b534973226e',
  'link/on-image':
    'a849407d19e410f7fd68ed40d0aec43800024e6608c5da913554a27fc6878503',
  'image/rotated':
    'dd8f00d3ae741c13b1563a7c8cc58772e69dba6541647a96b1c073fdbb70b2e9',
  'shape/arc-family':
    '7ecbe2ca380f01b3da931288bb50f5e9ad0dfebec267392ccf3a6d3fefb8323e',
  'shape/geometry-aliases':
    '106045ef4dfe262b62997e6a9e4506be1d669653d8f62cc986a77356c12d08c6',
};
