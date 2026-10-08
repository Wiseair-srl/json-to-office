---
'@json-to-office/shared': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/json-to-pptx': minor
'@json-to-office/mcp-server': minor
---

A theme now carries Highcharts options in `componentDefaults.highcharts.options`, in both formats: the theme's `Highcharts.setOptions`, written beneath every chart's own options, key by key. Precedence is the chart's own options, then the theme's `options`, then the theme's palette and typography for whatever is still empty; `props.componentDefaults.highcharts` on the document merges over the theme's block as for every other component. Per series type, use `plotOptions.<type>` inside `options`, as Highcharts itself does. Any Highcharts option goes and is posted as it is; the library does not judge the content. A theme without the key posts exactly the request it posted before.

The PPTX `componentDefaults.highcharts` keeps its placement and `resources` defaults and takes the same `options`, which no longer have to state `chart.width` and `height`. The key appears in the generated theme and presentation JSON schemas, in `jto_describe_component` under the root component's `componentDefaults`, and in the design guide, which says when a theme states chart options.
